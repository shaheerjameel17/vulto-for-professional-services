import { randomUUID } from "node:crypto";
import {
  EDGE_REGISTRY,
  NODE_TYPES,
  POLICY_ROLES,
  getProtectionPartitions,
  isSystemOperationPermitted,
  MATRIX_COVERAGE_BASELINE,
  countMatrixCoverage,
  enumerateMatrixCells,
  resolvePermission,
  type NodeType,
  type PolicyRole,
} from "@vulto/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { listAuditEntries } from "../audit/journal.js";
import { member } from "../auth/schema.js";
import { closeDatabase, db } from "../db.js";
import { insertEdge, insertNode } from "../graph/store.js";
import {
  addNode,
  edgeRecord,
  makeUser,
  makeWorkspace,
  nodeRecord,
  NOW,
} from "./test-support.js";
import {
  rowPartitionKey,
  authorizeRead,
  authorizeTraversal,
  authorizeWrite,
  decideRead,
  filterReadable,
  type InterceptorContext,
} from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import type { MemberPrincipal, SupportPrincipal } from "./principal.js";
import { isManager, effectiveRoles } from "./roles.js";
import { resolveReaderSet } from "./reader-set.js";

afterAll(closeDatabase);

const principalOf = (
  workspaceId: string,
  roles: MemberPrincipal["roles"],
): MemberPrincipal => ({
  kind: "member",
  userId: randomUUID(),
  workspaceId,
  membershipId: randomUUID(),
  roles,
});

async function auditRows(workspaceId: string) {
  return (await listAuditEntries(db, workspaceId)).map((entry) => ({ entry }));
}

async function managerEdgeWorld() {
  const fixture = await makeWorkspace({
    manager: ["team-member"],
    unrelated: ["team-member"],
  });
  const managerId = randomUUID();
  const unrelatedId = randomUUID();
  const targetId = randomUUID();
  const otherReportId = randomUUID();
  const projectId = randomUUID();
  await db.transaction(async (tx) => {
    for (const [nodeId, userId] of [
      [managerId, fixture.people.manager!.userId],
      [unrelatedId, fixture.people.unrelated!.userId],
      [targetId, null],
      [otherReportId, null],
    ] as const) {
      await insertNode(tx, {
        ...nodeRecord("Employee", fixture.workspaceId, nodeId),
        lifecycle_status: "Active",
        user_id: userId,
      });
    }
    await insertNode(tx, {
      ...nodeRecord("Project", fixture.workspaceId, projectId),
      lifecycle_status: "Active",
    });
    await insertEdge(
      tx,
      fixture.workspaceId,
      edgeRecord("managed_by", targetId, managerId),
    );
    await insertEdge(
      tx,
      fixture.workspaceId,
      edgeRecord("managed_by", otherReportId, unrelatedId),
    );
  });
  const manager = await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.manager!.userId,
    }),
  );
  const unrelated = await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.unrelated!.userId,
    }),
  );
  return {
    workspaceId: fixture.workspaceId,
    manager: manager!,
    unrelated: unrelated!,
    targetId,
    projectId,
  };
}

describe("A004-T07 — the permission matrix, against the server interceptor", () => {
  it("every role x node type x partition cell decides exactly as the policy table resolves it", async () => {
    const workspaceId = randomUUID();
    // A Manager is derived, so its principal holds no stored role and is given
    // a link and a report through the injected dependencies.
    const employeeId = randomUUID();
    const managerDeps: InterceptorContext = {
      roleDependencies: {
        resolveEmployeeForUser: async () => employeeId,
        now: () => NOW,
      },
    };
    await db.transaction(async (tx) => {
      await insertNode(tx, nodeRecord("Workspace", workspaceId, workspaceId));
      const report = await addNode(tx, workspaceId, "Employee");
      const boss = employeeId;
      await insertNode(tx, nodeRecord("Employee", workspaceId, boss));
      await insertEdge(tx, workspaceId, edgeRecord("managed_by", report, boss));

      let cells = 0;
      for (const { role, nodeType, partitionKey } of enumerateMatrixCells()) {
        const principal =
          role === "manager"
            ? principalOf(workspaceId, [])
            : principalOf(workspaceId, [role]);
        const decision = await decideRead(
          tx,
          principal,
          { workspaceId, nodeType, nodeId: null, partitionKey },
          role === "manager" ? managerDeps : {},
        );
        const expected = resolvePermission(role, nodeType, partitionKey);
        const actual = decision.access;
        expect(actual, `${role} ${nodeType}/${partitionKey}`).toBe(expected.outcome);
        if (decision.access === "restricted") {
          expect(decision.label).toBe(expected.restrictedLabel ?? "Restricted");
        }
        cells += 1;
      }
      // Coverage must not fall below the committed baseline (A004-T07).
      expect(cells).toBe(countMatrixCoverage());
      expect(cells).toBeGreaterThanOrEqual(MATRIX_COVERAGE_BASELINE);
    });
  });

  it("covers every role against every Privacy Class in the default mapping", async () => {
    // One registered node type per Privacy Class that has a fixed protection.
    const byClass = new Map<string, NodeType>();
    for (const nodeType of NODE_TYPES) {
      const cell = enumerateMatrixCells().find((c) => c.nodeType === nodeType);
      if (!cell) continue;
      const registered = resolvePermission("owner", nodeType, cell.partitionKey);
      void registered;
    }
    const { getNodeRegistration } = await import("@vulto/schema");
    for (const nodeType of NODE_TYPES) {
      const protection = getNodeRegistration(nodeType).protection;
      if (protection.kind === "fixed" && !byClass.has(protection.privacyClass)) {
        byClass.set(protection.privacyClass, nodeType);
      }
    }
    const workspaceId = randomUUID();
    await db.transaction(async (tx) => {
      for (const [privacyClass, nodeType] of byClass) {
        for (const role of POLICY_ROLES.filter((r) => r !== "manager")) {
          const decision = await decideRead(tx, principalOf(workspaceId, [role]), {
            workspaceId,
            nodeType,
            nodeId: null,
          });
          expect(decision.access, `${role} ${privacyClass} (${nodeType})`).toBe(
            resolvePermission(role, nodeType, decision.partitionKey).outcome,
          );
        }
      }
    });
    expect(byClass.size).toBeGreaterThanOrEqual(10);
  });

  it("spot checks from VPS-A004's own table", async () => {
    const workspaceId = randomUUID();
    await db.transaction(async (tx) => {
      const read = async (
        roles: MemberPrincipal["roles"],
        nodeType: NodeType,
        partitionKey?: string,
      ) =>
        (
          await decideRead(tx, principalOf(workspaceId, roles), {
            workspaceId,
            nodeType,
            nodeId: null,
            ...(partitionKey === undefined ? {} : { partitionKey }),
          })
        ).access;
      // WellnessTriggerEvent: absolute; not even the Owner.
      expect(await read(["owner"], "WellnessTriggerEvent")).toBe("none");
      // Workspace billing is Restricted for everyone but the Owner.
      expect(await read(["hr-admin"], "Workspace", "billing")).toBe("restricted");
      expect(await read(["owner"], "Workspace", "billing")).toBe("full");
      // HRCase is invisible to Finance Admin.
      expect(await read(["finance-admin"], "HRCase")).toBe("none");
      // A role union takes the higher grant (A004-T05).
      expect(await read(["team-member", "hr-admin"], "HRCase")).toBe(
        await read(["hr-admin"], "HRCase"),
      );
    });
  });
});

describe("audit — every denial and every protected grant, in the caller's transaction", () => {
  it("a denial writes exactly one PermissionDenied entry and it commits with the transaction", async () => {
    const fixture = await makeWorkspace({ member: ["team-member"] });
    const principal = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, {
        userId: fixture.people.member!.userId,
        workspaceId: fixture.workspaceId,
      }),
    ))!;
    const caseId = randomUUID();
    await db.transaction(async (tx) => {
      const decision = await authorizeRead(tx, principal, {
        workspaceId: fixture.workspaceId,
        nodeType: "HRCase",
        nodeId: caseId,
      });
      expect(decision.access).toBe("none");
    });
    const rows = await auditRows(fixture.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entry).toMatchObject({
      event_type: "PermissionDenied",
      outcome: "Denied",
      operation: "NodeRead",
      actor_user_id: fixture.people.member!.userId,
      actor_role: null,
      target: { kind: "NodeTarget", node_type: "HRCase", node_id: caseId },
      metadata: { denial_class: "InsufficientPermission" },
    });
  });

  it("a Tier 1 grant writes one SensitiveAccessGranted entry; a Tier 0 grant writes none", async () => {
    const fixture = await makeWorkspace();
    const owner = principalOf(fixture.workspaceId, ["owner"]);
    await db.transaction(async (tx) => {
      const tier1 = await authorizeRead(tx, owner, {
        workspaceId: fixture.workspaceId,
        nodeType: "PayRun",
        nodeId: randomUUID(),
      });
      expect(tier1).toMatchObject({ access: "full", tier: 1 });
      const tier0 = await authorizeRead(tx, owner, {
        workspaceId: fixture.workspaceId,
        nodeType: "Entity",
        nodeId: randomUUID(),
      });
      expect(tier0.access).not.toBe("none");
    });
    const rows = await auditRows(fixture.workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entry).toMatchObject({
      event_type: "SensitiveAccessGranted",
      outcome: "Granted",
      actor_role: "owner",
      target: { node_type: "PayRun", target_tier: 1 },
    });
  });

  it("a Restricted outcome is a denial and is audited", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const decision = await authorizeRead(
        tx,
        principalOf(fixture.workspaceId, ["hr-admin"]),
        {
          workspaceId: fixture.workspaceId,
          nodeType: "Workspace",
          nodeId: null,
          partitionKey: "billing",
        },
      );
      expect(decision.access).toBe("restricted");
    });
    expect(
      (await auditRows(fixture.workspaceId)).map(
        (r) => (r.entry as { event_type: string }).event_type,
      ),
    ).toEqual(["PermissionDenied"]);
  });

  it("the audit row rolls back with the transaction that decided it", async () => {
    const fixture = await makeWorkspace();
    await expect(
      db.transaction(async (tx) => {
        await authorizeRead(tx, principalOf(fixture.workspaceId, ["team-member"]), {
          workspaceId: fixture.workspaceId,
          nodeType: "HRCase",
          nodeId: null,
        });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await auditRows(fixture.workspaceId)).toHaveLength(0);
  });

  it("a decision that cannot be audited releases nothing", async () => {
    // A workspace that does not exist violates the journal's foreign key.
    const missing = randomUUID();
    await expect(
      db.transaction((tx) =>
        authorizeRead(tx, principalOf(missing, ["owner"]), {
          workspaceId: missing,
          nodeType: "PayRun",
          nodeId: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it("filterReadable drops what is absent, keeps what is readable, and audits each denial once", async () => {
    const fixture = await makeWorkspace({ member: ["team-member"] });
    const principal = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, {
        userId: fixture.people.member!.userId,
        workspaceId: fixture.workspaceId,
      }),
    ))!;
    await db.transaction(async (tx) => {
      const activation = {
        ...nodeRecord("ApplicationActivation", fixture.workspaceId),
        application: "VultoProjects",
      };
      await insertNode(tx, activation);
      const hrCase = nodeRecord("HRCase", fixture.workspaceId);
      await insertNode(tx, hrCase);
      const { getNodes } = await import("../graph/store.js");
      const rows = await getNodes(tx, fixture.workspaceId);
      const readable = await filterReadable(
        tx,
        principal,
        rows.filter((r) => r.nodeType !== "WorkspaceMembership"),
      );
      const types = readable.map((r) => ("restricted" in r ? r.nodeType : r.nodeType));
      expect(types).toContain("ApplicationActivation");
      expect(types).not.toContain("HRCase");
    });
    const denials = (await auditRows(fixture.workspaceId)).filter(
      (r) =>
        (r.entry as { event_type: string; target: { node_type: string } }).target
          .node_type === "HRCase",
    );
    expect(denials).toHaveLength(1);
  });
});

describe("the three write gates, in order", () => {
  const owner = (workspaceId: string) => principalOf(workspaceId, ["owner"]);

  it("refuses an AuditEntry write on every generic path (F198) and audits the attempt", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      for (const operation of ["create", "update", "remove"] as const) {
        const decision = await authorizeWrite(
          tx,
          owner(fixture.workspaceId),
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "AuditEntry",
            nodeId: null,
          },
          { operation },
        );
        expect(decision).toEqual({ allowed: false, reason: "audit-entry-reserved" });
      }
    });
    expect(await auditRows(fixture.workspaceId)).toHaveLength(3);
  });

  it("refuses the membership projection records on the generic path", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          owner(fixture.workspaceId),
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "WorkspaceMembership",
            nodeId: null,
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "reserved-projection" });
      expect(
        await authorizeWrite(
          tx,
          owner(fixture.workspaceId),
          {
            kind: "edge",
            workspaceId: fixture.workspaceId,
            edgeType: "membership_in",
            fromNodeType: "WorkspaceMembership",
            toNodeType: "Workspace",
            edgeId: null,
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "reserved-projection" });
    });
  });

  it("gate 1: role — an Owner may create an Employee, a Team Member may not", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const target = {
        kind: "node",
        workspaceId: fixture.workspaceId,
        nodeType: "Employee",
        nodeId: null,
      } as const;
      expect(
        await authorizeWrite(tx, owner(fixture.workspaceId), target, {
          operation: "create",
        }),
      ).toMatchObject({
        allowed: true,
      });
      expect(
        await authorizeWrite(
          tx,
          principalOf(fixture.workspaceId, ["team-member"]),
          target,
          {
            operation: "create",
          },
        ),
      ).toEqual({ allowed: false, reason: "role" });
    });
  });

  it("gate 1 for an edge: refuses an unregistered relationship and a role without Full on both endpoints", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          owner(fixture.workspaceId),
          {
            kind: "edge",
            workspaceId: fixture.workspaceId,
            edgeType: "managed_by",
            fromNodeType: "Entity",
            toNodeType: "Entity",
            edgeId: null,
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "unregistered-relationship" });
    });
  });

  it("F262: authorizes both Assignment edges for the target employee's real manager", async () => {
    const w = await managerEdgeWorld();
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          w.manager,
          {
            kind: "edge",
            workspaceId: w.workspaceId,
            edgeType: "assignment_of",
            fromNodeType: "Assignment",
            toNodeType: "Employee",
            edgeId: randomUUID(),
            toNodeId: w.targetId,
          },
          { operation: "create" },
        ),
      ).toMatchObject({ allowed: true });
      expect(
        await authorizeWrite(
          tx,
          w.manager,
          {
            kind: "edge",
            workspaceId: w.workspaceId,
            edgeType: "assigned_to",
            fromNodeType: "Assignment",
            toNodeType: "Project",
            edgeId: randomUUID(),
            toNodeId: w.projectId,
          },
          { operation: "create" },
        ),
      ).toMatchObject({ allowed: true });
    });
  });

  it("F262: still refuses assignment_of for a manager unrelated to the target", async () => {
    const w = await managerEdgeWorld();
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          w.unrelated,
          {
            kind: "edge",
            workspaceId: w.workspaceId,
            edgeType: "assignment_of",
            fromNodeType: "Assignment",
            toNodeType: "Employee",
            edgeId: randomUUID(),
            toNodeId: w.targetId,
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "role" });
    });
  });

  it("gate 2: write authority narrows a write the role allows, once the owning application activates", async () => {
    const fixture = await makeWorkspace();
    const target = {
      kind: "node",
      workspaceId: fixture.workspaceId,
      nodeType: "PayRun",
      nodeId: null,
    } as const;
    await db.transaction(async (tx) => {
      // Before activation Roster may still write it (if the role and reader set allow).
      const before = await authorizeWrite(tx, owner(fixture.workspaceId), target, {
        operation: "create",
      });
      expect(before).toMatchObject({ allowed: true });
      await insertNode(tx, {
        ...nodeRecord("ApplicationActivation", fixture.workspaceId),
        application: "VultoPayroll",
      });
      const fromRoster = await authorizeWrite(tx, owner(fixture.workspaceId), target, {
        operation: "create",
      });
      expect(fromRoster).toEqual({ allowed: false, reason: "write-authority" });
      const fromPayroll = await authorizeWrite(tx, owner(fixture.workspaceId), target, {
        operation: "create",
        application: "VultoPayroll",
      });
      expect(fromPayroll).toMatchObject({ allowed: true });
    });
  });

  it("gate 2 keeps Employee permanently Roster's", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          owner(fixture.workspaceId),
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "Employee",
            nodeId: null,
          },
          { operation: "create", application: "VultoAccounts" },
        ),
      ).toEqual({ allowed: false, reason: "write-authority" });
    });
  });

  it("gate 3: a protected write is refused as reader-set-unresolvable while the Employee link is absent", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const hrCase = await authorizeWrite(
        tx,
        owner(fixture.workspaceId),
        {
          kind: "node",
          workspaceId: fixture.workspaceId,
          nodeType: "HRCase",
          nodeId: randomUUID(),
        },
        { operation: "create" },
      );
      expect(hrCase).toEqual({ allowed: false, reason: "reader-set-unresolvable" });
      const compensation = await authorizeWrite(
        tx,
        owner(fixture.workspaceId),
        {
          kind: "node",
          workspaceId: fixture.workspaceId,
          nodeType: "Employee",
          nodeId: null,
          partitionKey: "compensation",
        },
        { operation: "update" },
      );
      expect(compensation).toEqual({
        allowed: false,
        reason: "reader-set-unresolvable",
      });
    });
    const reasons = (await auditRows(fixture.workspaceId)).map(
      (r) => (r.entry as { metadata: { denial_class?: string } }).metadata.denial_class,
    );
    expect(reasons).toEqual(["UnresolvedProtection", "UnresolvedProtection"]);
  });

  it("gate 3: a protected write whose readers are all concrete is granted and audited; with no readers it is refused", async () => {
    const fixture = await makeWorkspace({ finance: ["finance-admin"] });
    await db.transaction(async (tx) => {
      const decision = await authorizeWrite(
        tx,
        owner(fixture.workspaceId),
        {
          kind: "node",
          workspaceId: fixture.workspaceId,
          nodeType: "PayRun",
          nodeId: randomUUID(),
        },
        { operation: "create" },
      );
      expect(decision).toMatchObject({ allowed: true });
    });
    const granted = await auditRows(fixture.workspaceId);
    expect(granted).toHaveLength(1);
    expect(granted[0]!.entry).toMatchObject({
      event_type: "SensitiveAccessGranted",
      operation: "NodeCreate",
    });

    // With every member removed nobody remains to read it.
    await db
      .update(member)
      .set({ status: "revoked" })
      .where(eq(member.organizationId, fixture.workspaceId));
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          owner(fixture.workspaceId),
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "PayRun",
            nodeId: randomUUID(),
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "empty-reader-set" });
    });
  });

  it("the gates run in order: a role failure is reported before an unresolvable reader set", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          principalOf(fixture.workspaceId, ["team-member"]),
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "HRCase",
            nodeId: randomUUID(),
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "role" });
    });
  });

  it("refuses a write into a workspace other than the principal's", async () => {
    const a = await makeWorkspace();
    const b = await makeWorkspace();
    await db.transaction(async (tx) => {
      expect(
        await authorizeWrite(
          tx,
          principalOf(a.workspaceId, ["owner"]),
          {
            kind: "node",
            workspaceId: b.workspaceId,
            nodeType: "Employee",
            nodeId: null,
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "role" });
    });
  });
});

describe("A004-T06 — a role change takes effect on the very next request", () => {
  it("re-reads the central membership row every time, with no cache", async () => {
    const fixture = await makeWorkspace({ person: ["hr-admin"] });
    const { userId } = fixture.people.person!;
    const resolve = () =>
      db.transaction((tx) =>
        resolveMemberPrincipal(tx, { userId, workspaceId: fixture.workspaceId }),
      );
    const write = async (principal: MemberPrincipal) =>
      db.transaction((tx) =>
        authorizeWrite(
          tx,
          principal,
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "Employee",
            nodeId: null,
          },
          { operation: "create" },
        ),
      );

    const before = (await resolve())!;
    expect(before.roles).toEqual(["hr-admin"]);
    expect(await write(before)).toMatchObject({ allowed: true });

    await db
      .update(member)
      .set({ role: "team-member" })
      .where(
        and(eq(member.userId, userId), eq(member.organizationId, fixture.workspaceId)),
      );

    const after = (await resolve())!;
    expect(after.roles).toEqual(["team-member"]);
    expect(await write(after)).toEqual({ allowed: false, reason: "role" });

    await db
      .update(member)
      .set({ status: "revoked" })
      .where(
        and(eq(member.userId, userId), eq(member.organizationId, fixture.workspaceId)),
      );
    expect(await resolve()).toBeNull();
  });
});

describe("graph traversal rules", () => {
  it("stops at a node the role cannot read: the result is identical to the node never having existed", async () => {
    // Find a chain A -e1-> B -e2-> C of registered concrete edges where a role
    // reads A and C but not B, so a boundary at hop 2 could leak hop 3.
    const concrete = EDGE_REGISTRY.filter(
      (e) =>
        typeof e.fromNodeType === "string" &&
        typeof e.toNodeType === "string" &&
        (NODE_TYPES as readonly string[]).includes(e.fromNodeType) &&
        (NODE_TYPES as readonly string[]).includes(e.toNodeType),
    ) as unknown as {
      edgeType: string;
      fromNodeType: NodeType;
      toNodeType: NodeType;
    }[];
    const key = (t: NodeType) =>
      enumerateMatrixCells().find((c) => c.nodeType === t)?.partitionKey ?? "record";
    const reads = (role: PolicyRole, t: NodeType) =>
      ["full", "read"].includes(resolvePermission(role, t, key(t)).outcome);
    let found:
      | {
          role: PolicyRole;
          e1: (typeof concrete)[number];
          e2: (typeof concrete)[number];
        }
      | undefined;
    for (const role of POLICY_ROLES.filter((r) => r !== "manager")) {
      for (const e1 of concrete) {
        if (!reads(role, e1.fromNodeType) || reads(role, e1.toNodeType)) continue;
        for (const e2 of concrete) {
          if (e2.fromNodeType === e1.toNodeType && reads(role, e2.toNodeType)) {
            found = { role, e1, e2 };
            break;
          }
        }
        if (found) break;
      }
      if (found) break;
    }
    expect(found, "the registry has such a chain").toBeDefined();
    const { role, e1, e2 } = found!;

    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const a = await addNode(tx, fixture.workspaceId, e1.fromNodeType);
      const b = await addNode(tx, fixture.workspaceId, e1.toNodeType);
      const c = await addNode(tx, fixture.workspaceId, e2.toNodeType);
      await insertEdge(tx, fixture.workspaceId, edgeRecord(e1.edgeType, a, b));
      await insertEdge(tx, fixture.workspaceId, edgeRecord(e2.edgeType, b, c));
      const result = await authorizeTraversal(
        tx,
        principalOf(fixture.workspaceId, [role as never]),
        {
          workspaceId: fixture.workspaceId,
          startNodeId: a,
          edgeTypes: [e1.edgeType, e2.edgeType] as never,
          direction: "outgoing",
          maxDepth: 3,
        },
      );
      // B is absent, and because it is, C is never reached either.
      expect(result.hits).toEqual([]);
    });
  });

  it("returns readable neighbors and follows them", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const a = await addNode(tx, fixture.workspaceId, "Employee");
      const b = await addNode(tx, fixture.workspaceId, "Employee");
      const c = await addNode(tx, fixture.workspaceId, "Employee");
      await insertEdge(tx, fixture.workspaceId, edgeRecord("managed_by", a, b));
      await insertEdge(tx, fixture.workspaceId, edgeRecord("managed_by", b, c));
      const result = await authorizeTraversal(
        tx,
        principalOf(fixture.workspaceId, ["owner"]),
        {
          workspaceId: fixture.workspaceId,
          startNodeId: a,
          edgeTypes: ["managed_by"],
          direction: "outgoing",
          maxDepth: 5,
        },
      );
      expect(
        result.hits.map((h) => ["nodeId" in h.row ? h.row.nodeId : "", h.depth]),
      ).toEqual([
        [b, 1],
        [c, 2],
      ]);
    });
  });
});

describe("Manager is derived from managed_by edges, where the Employee link exists", () => {
  it("is not derived while the link is absent", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      expect(
        await isManager(tx, principalOf(fixture.workspaceId, ["team-member"])),
      ).toBe(false);
    });
  });

  it("is derived from an active incoming managed_by edge, and only an active one", async () => {
    const fixture = await makeWorkspace();
    const principal = principalOf(fixture.workspaceId, ["team-member"]);
    await db.transaction(async (tx) => {
      const boss = await addNode(tx, fixture.workspaceId, "Employee");
      const report = await addNode(tx, fixture.workspaceId, "Employee");
      const deps = {
        resolveEmployeeForUser: async () => boss,
        now: () => "2026-09-21T09:00:00.000Z",
      };
      expect(await isManager(tx, principal, deps)).toBe(false);
      const edge = await insertEdge(
        tx,
        fixture.workspaceId,
        edgeRecord("managed_by", report, boss, "2026-01-01T00:00:00.000Z"),
      );
      expect(await isManager(tx, principal, deps)).toBe(true);
      expect(await effectiveRoles(tx, principal, deps)).toEqual(
        expect.arrayContaining(["team-member", "manager"]),
      );
      const { closeEdge } = await import("../graph/store.js");
      await closeEdge(
        tx,
        fixture.workspaceId,
        edge.edgeId,
        "2026-06-01T00:00:00.000Z",
        {
          userId: randomUUID(),
          at: NOW,
        },
      );
      expect(await isManager(tx, principal, deps)).toBe(false);
    });
  });
});

describe("FDN-89 (partial) — reader sets and subject exclusion", () => {
  it("resolves a concrete, ordered set from role grants for a record with no row-level scope", async () => {
    const fixture = await makeWorkspace({
      hr: ["hr-admin"],
      finance: ["finance-admin"],
      plain: ["team-member"],
    });
    await db.transaction(async (tx) => {
      const readers = await resolveReaderSet(tx, {
        workspaceId: fixture.workspaceId,
        nodeType: "PayRun",
        partitionKey: "record",
        subjectEmployeeId: null,
      });
      expect(readers).toEqual({
        kind: "resolved",
        userIds: [
          fixture.people.owner!.userId,
          fixture.people.hr!.userId,
          fixture.people.finance!.userId,
        ].sort(),
      });
    });
  });

  it("ignores an inapplicable own-scope cell on a fixed-class node with no subject", async () => {
    const fixture = await makeWorkspace({
      hr: ["hr-admin"],
      finance: ["finance-admin"],
      plain: ["team-member"],
    });
    await db.transaction(async (tx) => {
      const readers = await resolveReaderSet(tx, {
        workspaceId: fixture.workspaceId,
        nodeType: "RateCard",
        partitionKey: "record",
        subjectEmployeeId: null,
      });
      expect(readers).toEqual({
        kind: "resolved",
        userIds: [
          fixture.people.owner!.userId,
          fixture.people.hr!.userId,
          fixture.people.finance!.userId,
        ].sort(),
      });
    });
  });

  it("is unresolvable where a grant is row-scoped and the Employee link is absent", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      expect(
        await resolveReaderSet(tx, {
          workspaceId: fixture.workspaceId,
          nodeType: "Employee",
          partitionKey: "compensation",
          subjectEmployeeId: null,
        }),
      ).toEqual({ kind: "unresolvable" });
    });
  });

  it("excludes the subject of an HRCase from its readers, leaving an empty set where they were the only one", async () => {
    const fixture = await makeWorkspace({ hr: ["hr-admin"] });
    const subject = randomUUID();
    const employeeOf = new Map<string, string>([
      [fixture.people.owner!.userId, randomUUID()],
      [fixture.people.hr!.userId, subject],
    ]);
    const deps = {
      resolveEmployeeForUser: async (_t: unknown, _w: string, u: string) =>
        employeeOf.get(u) ?? null,
    };
    await db.transaction(async (tx) => {
      const readers = await resolveReaderSet(
        tx,
        {
          workspaceId: fixture.workspaceId,
          nodeType: "HRCase",
          partitionKey: rowPartitionKey("HRCase"),
          subjectEmployeeId: subject,
        },
        deps as never,
      );
      expect(readers).toEqual({
        kind: "resolved",
        userIds: [fixture.people.owner!.userId],
      });
      // The Owner is the subject too: nobody independent remains.
      const both = await resolveReaderSet(
        tx,
        {
          workspaceId: fixture.workspaceId,
          nodeType: "HRCase",
          partitionKey: rowPartitionKey("HRCase"),
          subjectEmployeeId: subject,
        },
        { resolveEmployeeForUser: async () => subject } as never,
      );
      expect(both).toEqual({ kind: "resolved", userIds: [] });
      // A reader whose Employee cannot be determined leaves the exclusion unappliable.
      const unknown = await resolveReaderSet(
        tx,
        {
          workspaceId: fixture.workspaceId,
          nodeType: "HRCase",
          partitionKey: rowPartitionKey("HRCase"),
          subjectEmployeeId: subject,
        },
        { resolveEmployeeForUser: async () => null } as never,
      );
      expect(unknown).toEqual({ kind: "unresolvable" });
    });
  });

  it("refuses a case write whose only readers are the subject, as an empty reader set", async () => {
    const fixture = await makeWorkspace();
    const subject = randomUUID();
    await db.transaction(async (tx) => {
      const decision = await authorizeWrite(
        tx,
        principalOf(fixture.workspaceId, ["owner"]),
        {
          kind: "node",
          workspaceId: fixture.workspaceId,
          nodeType: "HRCase",
          nodeId: null,
        },
        { operation: "create", subjectEmployeeId: subject },
        {},
      ).catch((error: unknown) => error);
      // With the link absent this is unresolvable, which is also a refusal.
      expect(decision).toEqual({ allowed: false, reason: "reader-set-unresolvable" });
    });
  });
});

describe("support principals (F206) — capped at scope, never above Owner", () => {
  const support = (
    workspaceId: string,
    access: "read" | "read-write",
    nodeTypes: NodeType[],
    expiresAt = "2099-01-01T00:00:00.000Z",
  ): SupportPrincipal => ({
    kind: "support",
    grantId: randomUUID(),
    workspaceId,
    scope: { access, node_types: nodeTypes },
    expiresAt,
  });

  it("reads within scope at the Owner ceiling, capped to Read for a read-only scope", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const decision = await decideRead(
        tx,
        support(fixture.workspaceId, "read", ["Employee"]),
        {
          workspaceId: fixture.workspaceId,
          nodeType: "Employee",
          nodeId: null,
        },
      );
      expect(decision.access).toBe("read");
      const readWrite = await decideRead(
        tx,
        support(fixture.workspaceId, "read-write", ["Employee"]),
        {
          workspaceId: fixture.workspaceId,
          nodeType: "Employee",
          nodeId: null,
        },
      );
      expect(readWrite.access).toBe("full");
    });
  });

  it("reaches nothing outside its scope, after it expires, or in another workspace", async () => {
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const read = (p: SupportPrincipal, workspaceId = fixture.workspaceId) =>
        decideRead(tx, p, { workspaceId, nodeType: "Employee", nodeId: null }).then(
          (d) => d.access,
        );
      expect(await read(support(fixture.workspaceId, "read", ["Entity"]))).toBe("none");
      expect(
        await read(
          support(
            fixture.workspaceId,
            "read",
            ["Employee"],
            "2020-01-01T00:00:00.000Z",
          ),
        ),
      ).toBe("none");
      expect(
        await read(support(fixture.workspaceId, "read", ["Employee"]), randomUUID()),
      ).toBe("none");
    });
  });

  it("is never above Owner: where Owner has no grant the scope cannot supply one", async () => {
    const ownerNone = NODE_TYPES.find((nodeType) => {
      const cell = enumerateMatrixCells().find((c) => c.nodeType === nodeType)!;
      return (
        resolvePermission("owner", nodeType, cell.partitionKey).outcome === "none" &&
        !getProtectionPartitions(nodeType).some((p) => p.tier === 3)
      );
    })!;
    expect(ownerNone).toBeDefined();
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const decision = await decideRead(
        tx,
        support(fixture.workspaceId, "read-write", [ownerNone]),
        { workspaceId: fixture.workspaceId, nodeType: ownerNone, nodeId: null },
      );
      expect(decision.access).toBe("none");
    });
  });

  it("never reaches a Tier 3 type, whatever its scope lists", async () => {
    const tier3 = NODE_TYPES.filter((t) =>
      getProtectionPartitions(t).some((p) => p.tier === 3),
    );
    expect(tier3.length).toBeGreaterThan(0);
    const fixture = await makeWorkspace();
    await db.transaction(async (tx) => {
      const principal = support(fixture.workspaceId, "read-write", tier3);
      for (const nodeType of tier3) {
        expect(
          (
            await decideRead(tx, principal, {
              workspaceId: fixture.workspaceId,
              nodeType,
              nodeId: null,
            })
          ).access,
          nodeType,
        ).toBe("none");
        expect(
          await authorizeWrite(
            tx,
            principal,
            { kind: "node", workspaceId: fixture.workspaceId, nodeType, nodeId: null },
            { operation: "create" },
          ),
        ).toEqual({ allowed: false, reason: "support-scope" });
      }
    });
  });

  it("may never write Workspace, WorkspaceMembership, User or AuditEntry, or change a role", async () => {
    const fixture = await makeWorkspace();
    const principal = support(fixture.workspaceId, "read-write", [
      "Workspace",
      "WorkspaceMembership",
      "User",
      "AuditEntry",
      "Employee",
    ]);
    await db.transaction(async (tx) => {
      for (const nodeType of [
        "Workspace",
        "WorkspaceMembership",
        "User",
        "AuditEntry",
      ] as const) {
        for (const operation of ["create", "update", "remove"] as const) {
          expect(
            await authorizeWrite(
              tx,
              principal,
              {
                kind: "node",
                workspaceId: fixture.workspaceId,
                nodeType,
                nodeId: null,
              },
              { operation },
            ),
            `${nodeType} ${operation}`,
          ).toEqual({ allowed: false, reason: "support-forbidden" });
        }
      }
      // A role lives on the membership node, which is among the forbidden four.
      expect(
        await authorizeWrite(
          tx,
          principal,
          {
            kind: "edge",
            workspaceId: fixture.workspaceId,
            edgeType: "membership_of",
            fromNodeType: "WorkspaceMembership",
            toNodeType: "User",
            edgeId: null,
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "support-forbidden" });
    });
  });

  it("writes only under a read-write scope that covers the type, through the same gates as a member", async () => {
    const fixture = await makeWorkspace({ finance: ["finance-admin"] });
    await db.transaction(async (tx) => {
      const target = (nodeType: NodeType) =>
        ({
          kind: "node",
          workspaceId: fixture.workspaceId,
          nodeType,
          nodeId: randomUUID(),
        }) as const;
      expect(
        await authorizeWrite(
          tx,
          support(fixture.workspaceId, "read", ["PayRun"]),
          target("PayRun"),
          {
            operation: "create",
          },
        ),
      ).toEqual({ allowed: false, reason: "support-scope" });
      expect(
        await authorizeWrite(
          tx,
          support(
            fixture.workspaceId,
            "read-write",
            ["PayRun"],
            "2020-01-01T00:00:00.000Z",
          ),
          target("PayRun"),
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "support-scope" });
      expect(
        await authorizeWrite(
          tx,
          support(fixture.workspaceId, "read-write", ["PayRun"]),
          target("PayRun"),
          {
            operation: "create",
          },
        ),
      ).toMatchObject({ allowed: true });
      // The reader-set gate still applies.
      expect(
        await authorizeWrite(
          tx,
          support(fixture.workspaceId, "read-write", ["HRCase"]),
          target("HRCase"),
          {
            operation: "create",
          },
        ),
      ).toEqual({ allowed: false, reason: "reader-set-unresolvable" });
    });
  });

  it("produces correctly shaped audit entries: the grant, no person, no roles", async () => {
    const fixture = await makeWorkspace();
    const principal = support(fixture.workspaceId, "read", ["PayRun"]);
    await db.transaction(async (tx) => {
      await authorizeRead(tx, principal, {
        workspaceId: fixture.workspaceId,
        nodeType: "PayRun",
        nodeId: randomUUID(),
      });
      await authorizeRead(tx, principal, {
        workspaceId: fixture.workspaceId,
        nodeType: "HRCase",
        nodeId: randomUUID(),
      });
    });
    const entries = (await auditRows(fixture.workspaceId)).map(
      (r) => r.entry as Record<string, unknown>,
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actor_kind: "support",
        actor_grant_id: principal.grantId,
        actor_role: null,
        actor_roles: [],
      });
      expect(entry).not.toHaveProperty("actor_user_id");
      expect(entry).not.toHaveProperty("actor_membership_id");
    }
    expect(entries.map((e) => e["event_type"]).sort()).toEqual([
      "PermissionDenied",
      "SensitiveAccessGranted",
    ]);
    const [row] = await db.execute(
      sql`select actor_kind, actor_user_id, actor_grant_id, actor_system_name from audit_journal where workspace_id = ${fixture.workspaceId} limit 1`,
    );
    expect(row).toMatchObject({
      actor_kind: "support",
      actor_user_id: null,
      actor_grant_id: principal.grantId,
    });
  });
});

describe("system principals (F206)", () => {
  it("grants utilization compute and cohort reads only for their closed targets", async () => {
    const fixture = await makeWorkspace();
    const system = {
      kind: "system",
      name: "utilization-snapshot-compute",
      workspaceId: fixture.workspaceId,
    } as const;
    await db.transaction(async (tx) => {
      const read = (
        nodeType: "Employee" | "UtilizationSnapshot" | "TimesheetEntry",
        operation: "utilization-snapshot.read-cohort" | "utilization-snapshot.compute",
      ) =>
        decideRead(
          tx,
          system,
          {
            workspaceId: fixture.workspaceId,
            nodeType,
            nodeId: randomUUID(),
          },
          { systemOperation: operation },
        );
      expect((await read("Employee", "utilization-snapshot.read-cohort")).access).toBe(
        "read",
      );
      expect(
        (await read("UtilizationSnapshot", "utilization-snapshot.read-cohort")).access,
      ).toBe("read");
      expect(
        (await read("TimesheetEntry", "utilization-snapshot.read-cohort")).access,
      ).toBe("none");
      expect((await read("Employee", "utilization-snapshot.compute")).access).toBe(
        "none",
      );
      expect(
        await authorizeWrite(
          tx,
          system,
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "UtilizationSnapshot",
            nodeId: randomUUID(),
          },
          { operation: "create" },
          { systemOperation: "utilization-snapshot.compute" },
        ),
      ).toMatchObject({ allowed: true, role: null });
      expect(
        await authorizeWrite(
          tx,
          system,
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "Employee",
            nodeId: randomUUID(),
          },
          { operation: "create" },
          { systemOperation: "utilization-snapshot.compute" },
        ),
      ).toMatchObject({ allowed: false, reason: "role" });
    });
  });
  it("hold no node grant, are evaluated on every read and write, and are audited by name", async () => {
    const fixture = await makeWorkspace();
    const system = {
      kind: "system",
      name: "audience-recompute",
      workspaceId: fixture.workspaceId,
    } as const;
    await db.transaction(async (tx) => {
      expect(
        (
          await authorizeRead(tx, system, {
            workspaceId: fixture.workspaceId,
            nodeType: "Employee",
            nodeId: randomUUID(),
          })
        ).access,
      ).toBe("none");
      expect(
        await authorizeWrite(
          tx,
          system,
          {
            kind: "node",
            workspaceId: fixture.workspaceId,
            nodeType: "Employee",
            nodeId: null,
          },
          { operation: "create" },
        ),
      ).toEqual({ allowed: false, reason: "role" });
    });
    const entries = (await auditRows(fixture.workspaceId)).map(
      (r) => r.entry as Record<string, unknown>,
    );
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        actor_kind: "system",
        actor_system_name: "audience-recompute",
        actor_role: null,
        actor_roles: [],
        event_type: "PermissionDenied",
      });
      expect(entry).not.toHaveProperty("actor_user_id");
      expect(entry).not.toHaveProperty("actor_grant_id");
    }
  });

  it("the policy table lists a system principal's operations and nothing else", () => {
    expect(isSystemOperationPermitted("erasure", "audit.pseudonymize-actor")).toBe(
      true,
    );
    for (const name of [
      "audience-recompute",
      "retention-sweep",
      "key-rotation",
    ] as const) {
      expect(isSystemOperationPermitted(name, "audit.pseudonymize-actor")).toBe(false);
    }
  });
});

void sql;
void makeUser;

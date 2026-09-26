import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  auditEntrySchema,
  SEARCHABLE_NODE_TYPES,
  type AuditEntry,
} from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, db } from "../db.js";
import * as journal from "../audit/journal.js";
import { appendAudit, listAuditEntries } from "../audit/journal.js";
import { pseudonymizeActor } from "../audit/pseudonymizer.js";
import { getKeyServices } from "../crypto/keys.js";
import { readProtected } from "../protected/read.js";
import { writeProtected } from "../protected/write.js";
import {
  isNodeTypeReplicable,
  audienceMaterializer,
} from "../audience/materializer.js";
import { syncNodeAudience } from "../audience/schema.js";
import { getNode, getEdge, insertEdge } from "../graph/store.js";
import { graphNodes, graphEdges } from "../graph/schema.js";
import { applyMutation } from "../mutations/pipeline.js";
import { appRouter } from "../router.js";
import { authorizeRead } from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { addNode, edgeRecord, makeWorkspace } from "./test-support.js";
import type { MemberPrincipal } from "./principal.js";

afterAll(closeDatabase);
async function world() {
  const w = await makeWorkspace({
    hr: ["hr-admin"],
    finance: ["finance-admin"],
    member: ["team-member"],
    manager: ["team-member"],
  });
  await db.transaction(async (tx) => {
    const manager = await addNode(tx, w.workspaceId, "Employee", {
      user_id: w.people.manager!.userId,
    });
    const member = await addNode(tx, w.workspaceId, "Employee", {
      user_id: w.people.member!.userId,
    });
    await insertEdge(tx, w.workspaceId, edgeRecord("managed_by", member, manager));
  });
  const principals: Record<string, MemberPrincipal> = {};
  for (const [name, person] of Object.entries(w.people))
    principals[name] = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, { workspaceId: w.workspaceId, userId: person.userId }),
    ))!;
  const caller = (name: string) =>
    appRouter.createCaller({
      principal: principals[name]!,
      schemaVersion: 1,
      claimedWorkspaceId: w.workspaceId,
      res: { header() {} },
    });
  return { ...w, principals, caller };
}
function event(
  workspaceId: string,
  actor: string,
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  return auditEntrySchema.parse({
    audit_entry_id: randomUUID(),
    schema_version: 1,
    workspace_id: workspaceId,
    event_type: "PermissionDenied",
    operation: "NodeRead",
    outcome: "Denied",
    actor_kind: "member",
    actor_user_id: actor,
    actor_membership_id: randomUUID(),
    actor_role: null,
    actor_roles: ["team-member"],
    actor_application: "VultoRoster",
    target: {
      kind: "NodeTarget",
      node_type: "HRCase",
      node_id: randomUUID(),
      partition_key: "identifying",
      target_tier: 1,
    },
    metadata: { denial_class: "InsufficientPermission" },
    occurred_at: "2026-09-20T12:00:00.000Z",
    ...overrides,
  });
}

describe("VPS-F004 audit log review", () => {
  it("authorizes only Owner and HR Admin, commits one event per call and never returns its own grant", async () => {
    const w = await world();
    for (const name of ["owner", "hr", "finance", "member", "manager"]) {
      const before = await listAuditEntries(db, w.workspaceId);
      if (name === "owner" || name === "hr") {
        const page = await w
          .caller(name)
          .auditLog.query({ workspace_id: w.workspaceId });
        expect(page.entries.map((e) => e.audit_entry_id).sort()).toEqual(
          before.map((e) => e.audit_entry_id).sort(),
        );
      } else {
        await expect(
          w.caller(name).auditLog.query({ workspace_id: w.workspaceId }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const after = await listAuditEntries(db, w.workspaceId);
      const added = after.filter(
        (e) => !before.some((b) => b.audit_entry_id === e.audit_entry_id),
      );
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        event_type:
          name === "owner" || name === "hr"
            ? "SensitiveAccessGranted"
            : "PermissionDenied",
        operation: "NodeList",
        target: { node_type: "AuditEntry", target_tier: 2, node_id: null },
      });
    }
    const other = await makeWorkspace();
    const before = await listAuditEntries(db, other.workspaceId);
    await expect(
      w.caller("owner").auditLog.query({ workspace_id: other.workspaceId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "workspace-mismatch" });
    expect(await listAuditEntries(db, other.workspaceId)).toEqual(before);
  });

  it("filters every indexed column with inclusive UTC dates and several event types together", async () => {
    const w = await world();
    const actor = randomUUID();
    const entries = [
      event(w.workspaceId, actor, { occurred_at: "2026-09-19T23:59:59.999Z" }),
      event(w.workspaceId, actor, { occurred_at: "2026-09-20T00:00:00.000Z" }),
      event(w.workspaceId, actor, {
        occurred_at: "2026-09-20T23:59:59.999Z",
        event_type: "SensitiveAccessGranted",
        outcome: "Granted",
        actor_role: "team-member",
      }),
      event(w.workspaceId, randomUUID(), {
        occurred_at: "2026-09-21T00:00:00.000Z",
        target: {
          kind: "NodeTarget",
          node_type: "Departure",
          node_id: randomUUID(),
          partition_key: "record",
          target_tier: 2,
        },
      }),
      event(w.workspaceId, actor, {
        event_type: "AuthorizedOperationFailed",
        outcome: "Failed",
        metadata: { failure_class: "CommitFailed" },
      }),
    ];
    await db.transaction(async (tx) => {
      for (const e of entries) await appendAudit(tx, e);
    });
    const query = (filters: object) =>
      w.caller("hr").auditLog.query({
        workspace_id: w.workspaceId,
        end_date: "2026-09-21",
        ...filters,
      });
    for (const [filters, expected] of [
      [
        { start_date: "2026-09-20", end_date: "2026-09-20" },
        entries.slice(1, 3).concat(entries[4]!),
      ],
      [{ actor_user_id: actor }, entries.filter((e) => e.actor_user_id === actor)],
      [
        { event_types: ["PermissionDenied", "SensitiveAccessGranted"] },
        entries.slice(0, 4),
      ],
      [{ target_node_type: "Departure" }, [entries[3]!]],
      [
        { target_tier: 1 },
        entries.filter(
          (e) => e.target.kind === "NodeTarget" && e.target.target_tier === 1,
        ),
      ],
      [{ event_types: [] }, []],
    ] as const) {
      const page = await query(filters);
      expect(page.entries.map((e) => e.audit_entry_id).sort()).toEqual(
        expected.map((e) => e.audit_entry_id).sort(),
      );
    }
    const foreign = await makeWorkspace();
    await db.transaction((tx) => appendAudit(tx, event(foreign.workspaceId, actor)));
    expect(
      (await query({ actor_user_id: actor })).entries.every(
        (e) => e.workspace_id === w.workspaceId,
      ),
    ).toBe(true);
  });

  it("walks more than one default page without gaps or repeats even when timestamps tie, and validates cursors", async () => {
    const w = await world();
    const entries = Array.from({ length: 123 }, (_, i) =>
      event(w.workspaceId, randomUUID(), {
        occurred_at: i < 110 ? "2026-09-20T12:00:00.000Z" : "2026-09-19T12:00:00.000Z",
      }),
    );
    await db.transaction(async (tx) => {
      for (const e of entries) await appendAudit(tx, e);
    });
    let cursor: string | undefined;
    const found: AuditEntry[] = [];
    do {
      const page = await w.caller("owner").auditLog.query({
        workspace_id: w.workspaceId,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(page.entries.length).toBeLessThanOrEqual(50);
      found.push(...page.entries);
      cursor = page.next_cursor ?? undefined;
    } while (cursor !== undefined);
    const expected = entries.sort(
      (a, b) =>
        b.occurred_at.localeCompare(a.occurred_at) ||
        b.audit_entry_id.localeCompare(a.audit_entry_id),
    );
    expect(found.map((e) => e.audit_entry_id)).toEqual(
      expected.map((e) => e.audit_entry_id),
    );
    expect(new Set(found.map((e) => e.audit_entry_id)).size).toBe(123);
    const before = await listAuditEntries(db, w.workspaceId);
    for (const bad of [{ cursor: "not-a-cursor" }, { limit: 201 }, { unknown: true }])
      await expect(
        w.caller("owner").auditLog.query({ workspace_id: w.workspaceId, ...bad }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await listAuditEntries(db, w.workspaceId)).toEqual(before);
  });

  it("keeps erased actors correlatable through the query, deletes nothing and leaves another person's Tier 1 read unaffected", async () => {
    const w = await world();
    const sentinel = `SENTINEL-Tier1-${randomUUID()}`;
    const employee = await db.transaction(async (tx) => {
      const id = await addNode(tx, w.workspaceId, "Employee");
      await writeProtected(
        tx,
        getKeyServices(),
        { workspaceId: w.workspaceId, nodeId: id, nodeType: "Employee" },
        "compensation",
        { salary: sentinel },
      );
      return id;
    });
    const readSalary = () =>
      db.transaction((tx) =>
        readProtected(tx, getKeyServices(), w.principals.hr!, {
          nodeIds: [employee],
          partitions: ["compensation"],
        }),
      );
    const originalValue = await readSalary();
    expect(originalValue[0]).toMatchObject({
      state: "available",
      value: { salary: sentinel },
    });
    const actor = randomUUID(),
      token = randomUUID();
    const mine = [event(w.workspaceId, actor), event(w.workspaceId, actor)];
    const theirs = event(w.workspaceId, w.people.hr!.userId);
    await db.transaction(async (tx) => {
      for (const e of [...mine, theirs]) await appendAudit(tx, e);
    });
    const before = await listAuditEntries(db, w.workspaceId);
    await db.transaction((tx) =>
      pseudonymizeActor(
        tx,
        { kind: "system", name: "erasure", workspaceId: w.workspaceId },
        {
          workspaceId: w.workspaceId,
          currentActorUserId: actor,
          opaqueActorToken: token,
        },
      ),
    );
    const after = await listAuditEntries(db, w.workspaceId);
    expect(after).toHaveLength(before.length);
    for (const unchanged of before.filter((e) => e.actor_user_id !== actor))
      expect(after.find((e) => e.audit_entry_id === unchanged.audit_entry_id)).toEqual(
        unchanged,
      );
    expect(after.find((e) => e.audit_entry_id === theirs.audit_entry_id)).toEqual(
      theirs,
    );
    for (const e of mine)
      expect(after.find((a) => a.audit_entry_id === e.audit_entry_id)).toEqual({
        ...e,
        actor_user_id: token,
      });
    const page = await w
      .caller("hr")
      .auditLog.query({ workspace_id: w.workspaceId, actor_user_id: token });
    expect(page.entries.map((e) => e.audit_entry_id).sort()).toEqual(
      mine.map((e) => e.audit_entry_id).sort(),
    );
    expect(await readSalary()).toEqual(originalValue);
    expect(JSON.stringify(await listAuditEntries(db, w.workspaceId))).not.toContain(
      sentinel,
    );
  });

  it("logs a Tier 2 grant and exactly one denial at each tier without auditing a Tier 0 grant", async () => {
    const w = await world();
    const before = await listAuditEntries(db, w.workspaceId);
    await db.transaction(async (tx) => {
      expect(
        await authorizeRead(tx, w.principals.owner!, {
          workspaceId: w.workspaceId,
          nodeType: "Departure",
          nodeId: null,
        }),
      ).toMatchObject({ access: "full", tier: 2 });
      expect(
        await authorizeRead(tx, w.principals.owner!, {
          workspaceId: w.workspaceId,
          nodeType: "Client",
          nodeId: null,
        }),
      ).toMatchObject({ tier: 0 });
      for (const [nodeType, tier] of [
        ["PayRun", 1],
        ["FlightRiskSignal", 2],
        ["PulseEntry", 3],
      ] as const)
        expect(
          await authorizeRead(tx, w.principals.member!, {
            workspaceId: w.workspaceId,
            nodeType,
            nodeId: null,
          }),
        ).toMatchObject({ access: "none", tier });
      expect(
        await authorizeRead(tx, w.principals.member!, {
          workspaceId: randomUUID(),
          nodeType: "Client",
          nodeId: null,
        }),
      ).toMatchObject({ access: "none", tier: 0 });
    });
    const added = (await listAuditEntries(db, w.workspaceId)).filter(
      (e) => !before.some((b) => b.audit_entry_id === e.audit_entry_id),
    );
    expect(added).toHaveLength(5);
    expect(
      added.filter((e) => e.event_type === "SensitiveAccessGranted"),
    ).toMatchObject([{ target: { target_tier: 2 } }]);
    expect(
      added
        .filter((e) => e.event_type === "PermissionDenied")
        .map((e) => (e.target.kind === "NodeTarget" ? e.target.target_tier : -1))
        .sort(),
    ).toEqual([0, 1, 2, 3]);
  });

  it("refuses all seven generic writes to retained AuditEntry identifiers, preserves originals, and never replicates them", async () => {
    const w = await world();
    const graphSnapshot = () =>
      db.transaction(async (tx) => ({
        nodes: await tx
          .select()
          .from(graphNodes)
          .where(eq(graphNodes.workspaceId, w.workspaceId))
          .orderBy(graphNodes.nodeId),
        edges: await tx
          .select()
          .from(graphEdges)
          .where(eq(graphEdges.workspaceId, w.workspaceId))
          .orderBy(graphEdges.edgeId),
      }));
    const graphBefore = await graphSnapshot();
    const retained = event(w.workspaceId, w.people.owner!.userId);
    await db.transaction((tx) => appendAudit(tx, retained));
    const cases = [
      [
        "graph.createNode",
        { node: { node_id: retained.audit_entry_id, node_type: "AuditEntry" } },
        "audit-entry-reserved",
      ],
      [
        "graph.updateNodeFields",
        {
          node_id: retained.audit_entry_id,
          expected_version: 1,
          patch: { actor_user_id: randomUUID() },
        },
        "not-found",
      ],
      ["graph.softDeleteNode", { node_id: retained.audit_entry_id }, "not-found"],
      [
        "graph.transitionLifecycle",
        {
          node_id: retained.audit_entry_id,
          expected_version: 1,
          to_status: "Inactive",
        },
        "not-found",
      ],
      [
        "graph.createEdge",
        {
          edge: {
            ...edgeRecord(
              "delivered_to",
              retained.audit_entry_id,
              w.people.owner!.userId,
            ),
          },
        },
        "invalid-args",
      ],
      [
        "graph.closeEdge",
        { edge_id: retained.audit_entry_id, effective_to: "2026-09-26T12:00:00.000Z" },
        "not-found",
      ],
      [
        "graph.updateEdgeMetadata",
        { edge_id: retained.audit_entry_id, metadata: { changed: true } },
        "not-found",
      ],
    ] as const;
    for (const [name, args, reason] of cases) {
      const before = await listAuditEntries(db, w.workspaceId);
      const result = await applyMutation(w.principals.owner!, {
        mutation_id: randomUUID(),
        name,
        args,
      });
      expect(result).toMatchObject({ status: "rejected", reason });
      expect(await graphSnapshot()).toEqual(graphBefore);
      console.info(`AuditEntry generic refusal ${name}: ${reason}`);
      const after = await listAuditEntries(db, w.workspaceId);
      for (const original of before)
        expect(after.find((e) => e.audit_entry_id === original.audit_entry_id)).toEqual(
          original,
        );
      const added = after.filter(
        (e) => !before.some((b) => b.audit_entry_id === e.audit_entry_id),
      );
      expect(added.length).toBe(name === "graph.createNode" ? 1 : 0);
      if (added.length) expect(added[0]!.event_type).toBe("PermissionDenied");
      await db.transaction(async (tx) => {
        expect(await getNode(tx, w.workspaceId, retained.audit_entry_id)).toBeNull();
        expect(await getEdge(tx, w.workspaceId, retained.audit_entry_id)).toBeNull();
      });
    }
    expect(isNodeTypeReplicable("AuditEntry")).toBe(false);
    expect(
      SEARCHABLE_NODE_TYPES.some(
        (entry) => (entry.nodeType as string) === "AuditEntry",
      ),
    ).toBe(false);
    await db.transaction((tx) =>
      audienceMaterializer.recomputeWorkspace(tx, w.workspaceId),
    );
    expect(
      await db
        .select()
        .from(syncNodeAudience)
        .where(
          and(
            eq(syncNodeAudience.workspaceId, w.workspaceId),
            eq(syncNodeAudience.nodeId, retained.audit_entry_id),
          ),
        ),
    ).toHaveLength(0);
  });

  it("measures appendAudit added time for 200 denials and 200 Tier 1 grants with a loose algorithmic ceiling", async () => {
    const w = await makeWorkspace();
    const owner: MemberPrincipal = {
      kind: "member",
      workspaceId: w.workspaceId,
      userId: w.people.owner!.userId,
      membershipId: w.people.owner!.membershipId,
      roles: ["owner"],
    };
    const times: number[] = [];
    const original = journal.appendAudit;
    const spy = vi.spyOn(journal, "appendAudit").mockImplementation(async (...args) => {
      const start = performance.now();
      const result = await original(...args);
      times.push(performance.now() - start);
      return result;
    });
    try {
      for (const kind of ["denial", "tier1-grant"] as const) {
        times.length = 0;
        for (let i = 0; i < 200; i++)
          await db.transaction((tx) =>
            authorizeRead(tx, owner, {
              workspaceId: kind === "denial" ? randomUUID() : w.workspaceId,
              nodeType: "PayRun",
              nodeId: null,
            }),
          );
        expect(times).toHaveLength(200);
        const sorted = [...times].sort((a, b) => a - b);
        const median = (sorted[99]! + sorted[100]!) / 2,
          p95 = sorted[189]!;
        console.info(
          `appendAudit overhead ${kind}: samples=200 median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms; spec=10ms`,
        );
        expect(
          p95,
          "Loose 100ms ceiling catches algorithmic regression, not the 10ms reporting target",
        ).toBeLessThan(100);
      }
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});

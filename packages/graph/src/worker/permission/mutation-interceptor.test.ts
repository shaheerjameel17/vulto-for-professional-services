import {
  EDGE_REGISTRY,
  getProtectionPartitions,
  isNodeType,
  NODE_TYPES,
  type EdgeType,
  type NodeType,
} from "@vulto/schema";
import { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { NODE_FRAGMENT_CONTAINER, readNodeFragments } from "../document-node-fragments";
import type { NodeFragmentInput } from "../materialization";
import {
  authorizeEdgeWrite,
  authorizeMutationBatch,
  authorizeNodeWrite,
  describeMutationAuditEvidence,
  diffChangedNodeFragments,
  INVALID_BATCH_REASON,
} from "./mutation-interceptor";
import { POLICY_ROLES, resolvePermission, type PolicyRole } from "./policy-table";

const ALL_ROLES: readonly PolicyRole[] = POLICY_ROLES;

/** The workspace every `baseRecord` fixture below declares as its own. */
const FIXTURE_WORKSPACE = "22222222-2222-4222-8222-222222222222";

function baseRecord(
  nodeId: string,
  nodeType: NodeType,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    node_id: nodeId,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: "Active",
    workspace_id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "33333333-3333-4333-8333-333333333333",
    updated_at: "2026-01-01T00:00:00.000Z",
    updated_by: "33333333-3333-4333-8333-333333333333",
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    ...extra,
  };
}

function fragmentInput(
  nodeId: string,
  nodeType: NodeType,
  partitionKey: string,
  extra: Record<string, unknown> = {},
): NodeFragmentInput {
  return {
    sourceDocumentId: `node-fragment:${nodeId}:${partitionKey}`,
    partitionKey,
    record: baseRecord(nodeId, nodeType, extra),
  };
}

describe("authorizeNodeWrite — Gate 1, exhaustive over every registered node type, partition, and role", () => {
  it("grants exactly where resolvePermission resolves to full, never where it resolves to read, restricted, or none", () => {
    let checked = 0;
    for (const nodeType of NODE_TYPES) {
      const partitions = getProtectionPartitions(nodeType);
      const keys = partitions.length > 0 ? partitions.map((p) => p.key) : ["record"];
      for (const key of keys) {
        for (const role of ALL_ROLES) {
          const authorization = authorizeNodeWrite(nodeType, key, [role]);
          const resolution = resolvePermission(role, nodeType, key);
          expect(authorization.allowed).toBe(resolution.outcome === "full");
          checked += 1;
        }
      }
    }
    // A sweep that silently iterated zero cells would pass vacuously — this
    // is the same guard F128's own exhaustive test uses to prove the loop
    // actually ran across the live registry, not an empty one.
    expect(checked).toBeGreaterThan(100);
  });

  it("Owner on Employee/operational: Full in the matrix, so the write is granted", () => {
    expect(authorizeNodeWrite("Employee", "operational", ["owner"]).allowed).toBe(true);
  });

  it("Team Member on Employee/compensation: not Full for this role, so the write is denied with a reason", () => {
    const authorization = authorizeNodeWrite("Employee", "compensation", [
      "team-member",
    ]);
    expect(authorization.allowed).toBe(false);
    if (!authorization.allowed) {
      expect(authorization.reason).toContain("Employee/compensation");
    }
  });

  it("A004-T05 role union: one role in the set resolving to Full is enough to grant the write", () => {
    // Owner is Full on Employee/compensation; Team Member alone is not.
    // The set {team-member, owner} must grant, exactly as the read path's
    // bestResolution already proves for reads.
    expect(
      authorizeNodeWrite("Employee", "compensation", ["team-member", "owner"]).allowed,
    ).toBe(true);
  });

  it("an empty role set never grants a write", () => {
    expect(authorizeNodeWrite("Employee", "operational", []).allowed).toBe(false);
  });
});

describe("authorizeEdgeWrite — Gate 1 endpoint approximation, exhaustive over every registered edge relationship with concrete endpoints", () => {
  const concreteRegistrations = EDGE_REGISTRY.filter(
    (
      registration,
    ): registration is typeof registration & {
      fromNodeType: NodeType;
      toNodeType: NodeType;
    } => isNodeType(registration.fromNodeType) && isNodeType(registration.toNodeType),
  );

  it("is exercised against at least one real registered relationship", () => {
    expect(concreteRegistrations.length).toBeGreaterThan(0);
  });

  /**
   * FDN-92. The governing partition for a split endpoint is the
   * registry-declared `governingPartitions[nodeType]` — never a value the
   * caller supplies. This computes the same key independently and asserts
   * `authorizeEdgeWrite` grants iff both endpoints' governing partitions
   * resolve to Full for the role.
   */
  const governingPartitionKey = (
    registration: (typeof concreteRegistrations)[number],
    nodeType: NodeType,
  ): string | null => {
    const partitions = getProtectionPartitions(nodeType);
    if (partitions.length === 1) return partitions[0]!.key;
    if (partitions.length === 0) return null;
    const declared = registration.governingPartitions[nodeType];
    return declared !== undefined && partitions.some(({ key }) => key === declared)
      ? declared
      : null;
  };

  it("grants iff both endpoints' governing partitions resolve to Full for the role", () => {
    let checked = 0;
    let grantedAtLeastOnce = false;
    for (const registration of concreteRegistrations) {
      const { edgeType, fromNodeType, toNodeType } = registration;
      for (const role of ALL_ROLES) {
        const authorization = authorizeEdgeWrite(edgeType, fromNodeType, toNodeType, [
          role,
        ]);
        const fromKey = governingPartitionKey(registration, fromNodeType);
        const toKey = governingPartitionKey(registration, toNodeType);
        const expectedAllowed =
          fromKey !== null &&
          toKey !== null &&
          resolvePermission(role, fromNodeType, fromKey).outcome === "full" &&
          resolvePermission(role, toNodeType, toKey).outcome === "full";
        expect(authorization.allowed).toBe(expectedAllowed);
        grantedAtLeastOnce ||= authorization.allowed;
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // The registry-declared governing partitions make some split-endpoint
    // edges writable — the whole point of the F136 ruling.
    expect(grantedAtLeastOnce).toBe(true);
  });

  it("has_skill / holds_certification / assignment_of: the Employee endpoint is governed by `operational`, not any partition the role happens to hold Full on", () => {
    // The registry declares `{ Employee: "operational" }` for these. A role
    // with Full ONLY on Employee/compensation (finance-admin) and NOT on
    // operational must still be DENIED — this is the proof the lookup is
    // real and not accidentally permissive in the direction opposite the
    // one the denial cases test.
    for (const edgeType of ["has_skill", "holds_certification"] as const) {
      const toNodeType = edgeType === "has_skill" ? "Skill" : "Certification";
      // finance-admin: Full on Employee/compensation, not operational.
      expect(
        resolvePermission("finance-admin", "Employee", "compensation").outcome,
      ).toBe("full");
      expect(
        resolvePermission("finance-admin", "Employee", "operational").outcome,
      ).not.toBe("full");
      const financeOnly = authorizeEdgeWrite(edgeType, "Employee", toNodeType, [
        "finance-admin",
      ]);
      expect(financeOnly.allowed).toBe(false);

      // A role with Full on Employee/operational AND Full on the other
      // endpoint is granted.
      const operationalRole = ALL_ROLES.find(
        (role) =>
          resolvePermission(role, "Employee", "operational").outcome === "full" &&
          resolvePermission(role, toNodeType, "record").outcome === "full",
      );
      expect(operationalRole).toBeDefined();
      const granted = authorizeEdgeWrite(edgeType, "Employee", toNodeType, [
        operationalRole!,
      ]);
      expect(granted.allowed).toBe(true);
    }

    // assignment_of: Employee is the `to` endpoint, same declaration.
    const assignmentFinanceOnly = authorizeEdgeWrite(
      "assignment_of",
      "Assignment",
      "Employee",
      ["finance-admin"],
    );
    expect(assignmentFinanceOnly.allowed).toBe(false);
  });

  it("membership_in: the split Workspace endpoint is governed by `display`, not `billing`", () => {
    // Registry declares `{ Workspace: "display" }`. A role with Full only on
    // Workspace/billing must be denied.
    const billingOnlyRole = ALL_ROLES.find(
      (role) =>
        resolvePermission(role, "Workspace", "billing").outcome === "full" &&
        resolvePermission(role, "Workspace", "display").outcome !== "full",
    );
    if (billingOnlyRole !== undefined) {
      expect(
        authorizeEdgeWrite("membership_in", "WorkspaceMembership", "Workspace", [
          billingOnlyRole,
        ]).allowed,
      ).toBe(false);
    }
  });

  it("managed_by (Employee -> Employee): denied for every role — Employee is split and the registry declares no governing partition for it (F136 default)", () => {
    for (const role of ALL_ROLES) {
      const authorization = authorizeEdgeWrite("managed_by", "Employee", "Employee", [
        role,
      ]);
      expect(authorization.allowed).toBe(false);
      if (!authorization.allowed) {
        expect(authorization.reason).toContain("F136");
      }
    }
  });

  it("an unregistered (edge_type, from, to) is a denial, not a throw", () => {
    let result;
    expect(() => {
      result = authorizeEdgeWrite(
        "not_a_registered_edge_type" as EdgeType,
        "User",
        "User",
        ["owner"],
      );
    }).not.toThrow();
    expect(result!.allowed).toBe(false);
  });
});

describe("diffChangedNodeFragments — the fork-then-diff half of runtime.ts's mutate", () => {
  it("returns nothing when before and after are identical", () => {
    const fragments = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational"),
    ];
    expect(diffChangedNodeFragments(fragments, fragments)).toEqual([]);
  });

  it("surfaces an added fragment", () => {
    const before: NodeFragmentInput[] = [];
    const after = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational"),
    ];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      {
        nodeId: "66666666-6666-4666-8666-666666666666",
        partitionKey: "operational",
        nodeType: "Employee",
      },
    ]);
  });

  it("surfaces a removed fragment, keyed by the BEFORE record's type and partition", () => {
    const before = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational"),
    ];
    const after: NodeFragmentInput[] = [];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      {
        nodeId: "66666666-6666-4666-8666-666666666666",
        partitionKey: "operational",
        nodeType: "Employee",
      },
    ]);
  });

  it("surfaces a changed fragment by canonical-JSON inequality, ignoring key order", () => {
    const before = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational", {
        title: "Engineer",
      }),
    ];
    const after = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational", {
        title: "Senior Engineer",
      }),
    ];
    expect(diffChangedNodeFragments(before, after)).toHaveLength(1);
  });

  it("does not surface a fragment whose fields are reordered but unchanged in value", () => {
    const before: NodeFragmentInput = {
      sourceDocumentId:
        "node-fragment:66666666-6666-4666-8666-666666666666:operational",
      partitionKey: "operational",
      record: {
        a: 1,
        ...baseRecord("66666666-6666-4666-8666-666666666666", "Employee"),
      },
    };
    const after: NodeFragmentInput = {
      sourceDocumentId:
        "node-fragment:66666666-6666-4666-8666-666666666666:operational",
      partitionKey: "operational",
      record: {
        ...baseRecord("66666666-6666-4666-8666-666666666666", "Employee"),
        a: 1,
      },
    };
    expect(diffChangedNodeFragments([before], [after])).toEqual([]);
  });

  it("only surfaces the specific fragment a batch touches, not every fragment in the snapshot", () => {
    const untouched = fragmentInput(
      "11111111-1111-4111-8111-111111111111",
      "Employee",
      "operational",
    );
    const before = [
      untouched,
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "compensation"),
    ];
    const after = [
      untouched,
      fragmentInput(
        "66666666-6666-4666-8666-666666666666",
        "Employee",
        "compensation",
        { salary: 1 },
      ),
    ];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      {
        nodeId: "66666666-6666-4666-8666-666666666666",
        partitionKey: "compensation",
        nodeType: "Employee",
      },
    ]);
  });

  it("treats two different partitions of the same node as independently diffed", () => {
    const before = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational"),
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "compensation"),
    ];
    const after = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational", {
        title: "Changed",
      }),
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "compensation"),
    ];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      {
        nodeId: "66666666-6666-4666-8666-666666666666",
        partitionKey: "operational",
        nodeType: "Employee",
      },
    ]);
  });
});

/**
 * FDN-53 stage 2. `authorizeMutationBatch` against real `LoroDoc` instances
 * — no browser needed, unlike `SQLiteGraphIndex` (see `interceptor.test.ts`'s
 * doc comment) — since the simulate-fork-diff-gate procedure never touches
 * SQLite, only the document itself. `runtime.ts#mutate` is the thin
 * production wrapper: authorize here, then commit through the ordinary
 * `applyDeltaBatch` path on success.
 */
describe("authorizeMutationBatch — the fork-then-diff-then-gate integration, against a real LoroDoc", () => {
  const OWNER: readonly PolicyRole[] = ["owner"];
  const TEAM_MEMBER: readonly PolicyRole[] = ["team-member"];

  function writeFragment(
    document: LoroDoc,
    nodeId: string,
    nodeType: NodeType,
    partitionKey: string,
    extra: Record<string, unknown> = {},
  ): void {
    const key = `${nodeId}:${partitionKey}`;
    const fragment = document
      .getMap(NODE_FRAGMENT_CONTAINER)
      .setContainer(key, new LoroMap());
    for (const [field, value] of Object.entries(baseRecord(nodeId, nodeType, extra))) {
      fragment.set(field, value);
    }
  }

  /** A scratch document holding one node-fragment write, exported as importable snapshot bytes — the shape a real delta batch takes. */
  function nodeFragmentBatch(
    nodeId: string,
    nodeType: NodeType,
    partitionKey: string,
    extra: Record<string, unknown> = {},
  ): Uint8Array {
    const scratch = new LoroDoc();
    writeFragment(scratch, nodeId, nodeType, partitionKey, extra);
    scratch.commit();
    const bytes = scratch.export({ mode: "snapshot" });
    scratch.free();
    return bytes;
  }

  it("authorizes and reports nothing to refuse when the caller has Full write on the only changed fragment", async () => {
    const document = new LoroDoc();
    const batch = nodeFragmentBatch(
      "66666666-6666-4666-8666-666666666666",
      "Employee",
      "operational",
      {
        title: "Engineer",
      },
    );
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome).toEqual({ status: "authorized" });
    document.free();
  });

  it("denies when the caller does not have Full write on the changed fragment, and names it in the reason", async () => {
    const document = new LoroDoc();
    const batch = nodeFragmentBatch(
      "66666666-6666-4666-8666-666666666666",
      "Employee",
      "compensation",
      {
        salary: 1,
      },
    );
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      TEAM_MEMBER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") {
      expect(outcome.reason).toContain("Employee/compensation");
    }
    document.free();
  });

  it("never mutates the real document — a denied batch's fragment never lands", async () => {
    const document = new LoroDoc();
    const nodeId = "66666666-6666-4666-8666-666666666666";
    const batch = nodeFragmentBatch(nodeId, "Employee", "compensation");

    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      TEAM_MEMBER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("denied");

    // `readNodeFragments`, not raw `toJSON()`: calling `document.getMap(...)`
    // during authorization lazily vivifies an EMPTY node-fragment container
    // handle on the real document — a JS-heap-side accounting artifact of
    // Loro's container API, not a CRDT op, and not something a peer would
    // ever see on sync. The property this test actually needs to prove is
    // narrower and more meaningful: the denied fragment itself never landed.
    expect(readNodeFragments(document)).toEqual([]);
    document.free();
  });

  it("refuses the whole batch as unsupported when it touches the Movable Tree, even alongside an otherwise-authorized fragment write", async () => {
    const scratch = new LoroDoc();
    writeFragment(
      scratch,
      "66666666-6666-4666-8666-666666666666",
      "Employee",
      "operational",
    );
    scratch.getTree("org_hierarchy").createNode();
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();

    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("unsupported");
    if (outcome.status === "unsupported") {
      expect(outcome.reason).toContain("org_hierarchy");
    }
    document.free();
  });

  it("refuses as unsupported for a container this stage does not recognize at all, not just the Tree by name — proving the check is exhaustive, not an allow-list", async () => {
    const scratch = new LoroDoc();
    scratch.getMap("some_future_container_nobody_has_written_yet").set("k", "v");
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();

    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("unsupported");
    if (outcome.status === "unsupported") {
      expect(outcome.reason).toContain("some_future_container_nobody_has_written_yet");
    }
    document.free();
  });

  it("refuses the whole batch when ONE of several changed fragments is denied — no partial commit signaled", async () => {
    const scratch = new LoroDoc();
    writeFragment(
      scratch,
      "44444444-4444-4444-8444-444444444444",
      "Employee",
      "operational",
    );
    writeFragment(
      scratch,
      "55555555-5555-4555-8555-555555555555",
      "Employee",
      "compensation",
    );
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();

    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      TEAM_MEMBER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("denied");
    document.free();
  });

  it("authorizes a batch that changes nothing relative to the current document (idempotent re-apply), regardless of role", async () => {
    const document = new LoroDoc();
    const batch = nodeFragmentBatch(
      "66666666-6666-4666-8666-666666666666",
      "Employee",
      "operational",
    );
    // Land it for real first, the same way runtime.ts#mutate would commit
    // an authorized batch, so "before" already contains this fragment.
    document.import(batch);
    document.commit();

    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      [],
      FIXTURE_WORKSPACE,
    );
    expect(outcome).toEqual({ status: "authorized" });
    document.free();
  });

  // ── FDN-92: the edge-fragment commit path ──────────────────────────────
  const EDGE_CONTAINER = "__vulto_edge_fragments";
  const EMPLOYEE_ID = "66666666-6666-4666-8666-666666666666";
  const SKILL_ID = "77777777-7777-4777-8777-777777777777";
  const EDGE_ID = "88888888-8888-4888-8888-888888888888";

  function edgeRecord(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      edge_id: EDGE_ID,
      edge_type: "has_skill",
      from_node_id: EMPLOYEE_ID,
      to_node_id: SKILL_ID,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
      created_at: "2025-12-20T08:00:00.000Z",
      created_by: "33333333-3333-4333-8333-333333333333",
      metadata: {},
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
      ...overrides,
    };
  }

  function writeEdge(document: LoroDoc, record: Record<string, unknown>): void {
    const fragment = document
      .getMap(EDGE_CONTAINER)
      .setContainer(record["edge_id"] as string, new LoroMap());
    for (const [field, value] of Object.entries(record)) fragment.set(field, value);
  }

  /** Snapshot bytes holding an edge-fragment write, optionally with its endpoints. */
  function edgeBatch(withEndpoints: boolean): Uint8Array {
    const scratch = new LoroDoc();
    if (withEndpoints) {
      writeFragment(scratch, EMPLOYEE_ID, "Employee", "operational");
      writeFragment(scratch, SKILL_ID, "Skill", "record");
    }
    writeEdge(scratch, edgeRecord());
    scratch.commit();
    const bytes = scratch.export({ mode: "snapshot" });
    scratch.free();
    return bytes;
  }

  function documentWithEndpoints(): LoroDoc {
    const document = new LoroDoc();
    writeFragment(document, EMPLOYEE_ID, "Employee", "operational");
    writeFragment(document, SKILL_ID, "Skill", "record");
    document.commit();
    return document;
  }

  it("authorizes a has_skill edge write when the role has Full on Employee/operational and Skill", async () => {
    const document = documentWithEndpoints();
    const outcome = await authorizeMutationBatch(
      document,
      [edgeBatch(false)],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome).toEqual({ status: "authorized" });
    document.free();
  });

  it("denies a has_skill edge write for a role with Full only on Employee/compensation (governing partition is operational)", async () => {
    const document = documentWithEndpoints();
    const outcome = await authorizeMutationBatch(
      document,
      [edgeBatch(false)],
      ["finance-admin"],
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("denied");
    if (outcome.status === "denied") {
      expect(outcome.reason).toContain("Employee/operational");
    }
    document.free();
  });

  it("authorizes an edge and its endpoint node fragments created in one batch", async () => {
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [edgeBatch(true)],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome).toEqual({ status: "authorized" });
    document.free();
  });

  it("describes a split-role processed_in edge grant using canonical role precedence", () => {
    const timesheetEntryId = "99999999-9999-4999-8999-999999999999";
    const invoiceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const processedInEdgeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const document = new LoroDoc();
    writeFragment(document, timesheetEntryId, "TimesheetEntry", "record");
    writeFragment(document, invoiceId, "Invoice", "record");
    document.commit();

    const baseVersion = document.oplogVersion();
    const candidate = document.fork();
    writeEdge(
      candidate,
      edgeRecord({
        edge_id: processedInEdgeId,
        edge_type: "processed_in",
        from_node_id: timesheetEntryId,
        to_node_id: invoiceId,
      }),
    );
    candidate.commit();
    const delta = candidate.export({ mode: "update", from: baseVersion });

    const evidence = describeMutationAuditEvidence(
      document,
      [delta],
      ["hr-admin", "finance-admin"],
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      operation: "EdgeCreate",
      target: {
        kind: "EdgeTarget",
        edge_type: "processed_in",
        edge_id: processedInEdgeId,
        from_node_type: "TimesheetEntry",
        to_node_type: "Invoice",
        target_tier: 1,
      },
      tier: 1,
      decision: {
        outcome: "full",
        decidingRole: "hr-admin",
        rolesSnapshot: ["hr-admin", "finance-admin"],
      },
    });

    candidate.free();
    document.free();
  });

  it("refuses an edge whose endpoint is not materialized as invalid, not denied", async () => {
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [edgeBatch(false)],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("invalid");
    document.free();
  });

  it("still refuses as unsupported when an edge write rides alongside a Movable Tree change", async () => {
    const scratch = new LoroDoc();
    writeFragment(scratch, EMPLOYEE_ID, "Employee", "operational");
    writeFragment(scratch, SKILL_ID, "Skill", "record");
    writeEdge(scratch, edgeRecord());
    scratch.getTree("org_hierarchy").createNode();
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();

    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("unsupported");
    if (outcome.status === "unsupported") {
      expect(outcome.reason).toContain("org_hierarchy");
    }
    document.free();
  });
});

/**
 * FDN-85 Stage 1 — the generic `mutate` gate refuses the Workspace/membership
 * projection records. Workspace and WorkspaceMembership nodes and the
 * `membership_of` / `membership_in` edges are a one-way projection of the
 * Better Auth control plane, written only by FDN-85's privileged projection
 * command. A generic batch touching one is refused `unsupported`, the same
 * treatment a Movable Tree change gets — a committable representation exists,
 * but not through this entrypoint.
 */
describe("authorizeMutationBatch — FDN-85 reserves the Workspace/membership projection records", () => {
  const OWNER: readonly PolicyRole[] = ["owner"];
  const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
  const MEMBERSHIP_ID = "a1111111-1111-4111-8111-111111111111";
  const USER_ID = "a2222222-2222-4222-8222-222222222222";
  const EDGE_ID = "a3333333-3333-4333-8333-333333333333";

  function writeFragment(
    document: LoroDoc,
    nodeId: string,
    nodeType: NodeType,
    partitionKey: string,
  ): void {
    const fragment = document
      .getMap(NODE_FRAGMENT_CONTAINER)
      .setContainer(`${nodeId}:${partitionKey}`, new LoroMap());
    const record = baseRecord(nodeId, nodeType);
    // User and Workspace are unscoped node types — they carry no workspace_id.
    if (nodeType === "User" || nodeType === "Workspace") delete record.workspace_id;
    for (const [field, value] of Object.entries(record)) {
      fragment.set(field, value);
    }
  }

  function writeEdge(
    document: LoroDoc,
    edgeType: EdgeType,
    fromNodeId: string,
    toNodeId: string,
  ): void {
    const fragment = document
      .getMap("__vulto_edge_fragments")
      .setContainer(EDGE_ID, new LoroMap());
    const record: Record<string, unknown> = {
      edge_id: EDGE_ID,
      edge_type: edgeType,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
      created_at: "2026-01-01T00:00:00.000Z",
      created_by: "33333333-3333-4333-8333-333333333333",
      metadata: {},
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
    };
    for (const [field, value] of Object.entries(record)) fragment.set(field, value);
  }

  async function refuse(build: (scratch: LoroDoc) => void): Promise<string> {
    const scratch = new LoroDoc();
    build(scratch);
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      WORKSPACE_ID,
    );
    document.free();
    expect(outcome.status).toBe("unsupported");
    return outcome.status === "unsupported" ? outcome.reason : "";
  }

  it("refuses a Workspace node fragment write, even for an Owner", async () => {
    const reason = await refuse((s) =>
      writeFragment(s, WORKSPACE_ID, "Workspace", "display"),
    );
    expect(reason).toContain("Workspace");
  });

  it("refuses a WorkspaceMembership node fragment write", async () => {
    const reason = await refuse((s) =>
      writeFragment(s, MEMBERSHIP_ID, "WorkspaceMembership", "record"),
    );
    expect(reason).toContain("WorkspaceMembership");
  });

  it("refuses a membership_of edge write", async () => {
    const reason = await refuse((s) =>
      writeEdge(s, "membership_of" as EdgeType, MEMBERSHIP_ID, USER_ID),
    );
    expect(reason).toContain("membership_of");
  });

  it("refuses a membership_in edge write", async () => {
    const reason = await refuse((s) =>
      writeEdge(s, "membership_in" as EdgeType, MEMBERSHIP_ID, WORKSPACE_ID),
    );
    expect(reason).toContain("membership_in");
  });

  it("refuses the whole batch when a reserved write rides alongside an otherwise-authorized Employee fragment", async () => {
    const reason = await refuse((s) => {
      writeFragment(
        s,
        "66666666-6666-4666-8666-666666666666",
        "Employee",
        "operational",
      );
      writeFragment(s, MEMBERSHIP_ID, "WorkspaceMembership", "record");
    });
    expect(reason).toContain("WorkspaceMembership");
  });

  it("does NOT reserve the User node type — an Owner may write a User fragment through the generic path", async () => {
    const scratch = new LoroDoc();
    writeFragment(scratch, USER_ID, "User", "record");
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      WORKSPACE_ID,
    );
    document.free();
    expect(outcome).toEqual({ status: "authorized" });
  });
});

describe("authorizeMutationBatch — FDN-68 reserves AuditEntry for every policy role and generic mutation shape", () => {
  const workspaceId = "22222222-2222-4222-8222-222222222222";
  const auditId = "68000000-0000-4000-8000-000000000001";
  const createdAuditId = "68000000-0000-4000-8000-000000000002";
  const actorId = "68686868-6868-4868-8868-686868686868";

  function writeAudit(document: LoroDoc, nodeId: string): void {
    const fragment = document
      .getMap(NODE_FRAGMENT_CONTAINER)
      .setContainer(`${nodeId}:record`, new LoroMap());
    const record = {
      node_id: nodeId,
      workspace_id: workspaceId,
      node_type: "AuditEntry",
      schema_version: 1,
      lifecycle_status: "Recorded",
      created_at: "2026-09-10T09:00:00.000Z",
      created_by: actorId,
      actor_user_id: actorId,
      actor_membership_id: "68686868-6868-4868-8868-686868686869",
      actor_role: null,
      actor_roles: ["owner"],
      actor_application: "VultoRoster",
      event_type: "PermissionDenied",
      operation: "NodeRead",
      outcome: "Denied",
      target: {
        kind: "NodeTarget",
        node_type: "Skill",
        node_id: null,
        partition_key: "record",
        target_tier: 0,
      },
      metadata: {
        denial_class: "InsufficientPermission",
        result_cardinality: "Single",
      },
      occurred_at: "2026-09-10T09:00:00.000Z",
    };
    for (const [field, value] of Object.entries(record)) fragment.set(field, value);
  }

  function snapshots(): Record<
    "seed" | "create" | "alter" | "remove" | "typeChange",
    Uint8Array
  > {
    const seed = new LoroDoc();
    seed.setPeerId(680n);
    writeAudit(seed, auditId);
    seed.commit();
    const seedBytes = seed.export({ mode: "snapshot" });
    seed.free();

    const create = new LoroDoc();
    create.setPeerId(681n);
    writeAudit(create, createdAuditId);
    create.commit();
    const createBytes = create.export({ mode: "snapshot" });
    create.free();

    const alter = new LoroDoc();
    alter.setPeerId(682n);
    alter.import(seedBytes);
    const altered = alter
      .getMap(NODE_FRAGMENT_CONTAINER)
      .get(`${auditId}:record`) as LoroMap;
    altered.set("event_type", "SensitiveAccessGranted");
    alter.commit();
    const alterBytes = alter.export({ mode: "snapshot" });
    alter.free();

    const remove = new LoroDoc();
    remove.setPeerId(683n);
    remove.import(seedBytes);
    remove.getMap(NODE_FRAGMENT_CONTAINER).delete(`${auditId}:record`);
    remove.commit();
    const removeBytes = remove.export({ mode: "snapshot" });
    remove.free();

    const typeChange = new LoroDoc();
    typeChange.setPeerId(684n);
    typeChange.import(seedBytes);
    const changed = typeChange
      .getMap(NODE_FRAGMENT_CONTAINER)
      .get(`${auditId}:record`) as LoroMap;
    changed.set("node_type", "Skill");
    changed.set("lifecycle_status", "Active");
    changed.set("updated_at", "2026-09-10T09:00:00.000Z");
    changed.set("updated_by", actorId);
    changed.set("is_soft_deleted", false);
    changed.set("soft_deleted_at", null);
    changed.set("soft_deleted_by", null);
    changed.set("name", "Forbidden type change");
    typeChange.commit();
    const typeChangeBytes = typeChange.export({ mode: "snapshot" });
    typeChange.free();

    return {
      seed: seedBytes,
      create: createBytes,
      alter: alterBytes,
      remove: removeBytes,
      typeChange: typeChangeBytes,
    };
  }

  for (const role of ALL_ROLES) {
    for (const shape of ["create", "alter", "remove", "typeChange"] as const) {
      it(`${role}: ${shape} is unsupported before ordinary write authorization`, async () => {
        const proof = snapshots();
        const document = new LoroDoc();
        if (shape !== "create") document.import(proof.seed);
        const outcome = await authorizeMutationBatch(
          document,
          [proof[shape]],
          [role],
          workspaceId,
        );
        expect(outcome.status).toBe("unsupported");
        if (outcome.status !== "unsupported") throw new Error("expected refusal");
        expect(outcome.reason).toContain("AuditEntry");
        document.free();
      });
    }
  }
});

/**
 * F138 — the named unit-level half of the regression proof. The end-to-end
 * half lives in `services/api/browser-tests-device-store/graph-mutation-poisoning.spec.ts`
 * and runs against the real Worker, real SealedStore and real WASM.
 *
 * Every vector below was CONFIRMED to pass Gate 1 and then be refused by
 * `materialization.ts` before this fix existed — verified directly against
 * `authorizeMutationBatch`, not reasoned about. The refusal must now happen
 * on the fork, before anything merges, and must be a returned outcome rather
 * than a throw: a throw becomes a fatal `runtime-failure` that terminates the
 * Worker and leaves every later caller hanging forever (F142).
 */
describe("F138 — an authorized-but-incoherent batch is refused before it can merge", () => {
  const OWNER: readonly PolicyRole[] = ["owner"];

  function poisonDoc(write: (document: LoroDoc) => void): Uint8Array {
    const scratch = new LoroDoc();
    write(scratch);
    scratch.commit();
    const bytes = scratch.export({ mode: "snapshot" });
    scratch.free();
    return bytes;
  }

  function writeRaw(
    document: LoroDoc,
    nodeId: string,
    partitionKey: string,
    record: Record<string, unknown>,
  ): void {
    const fragment = document
      .getMap(NODE_FRAGMENT_CONTAINER)
      .setContainer(`${nodeId}:${partitionKey}`, new LoroMap());
    for (const [key, value] of Object.entries(record)) fragment.set(key, value);
  }

  const NODE = "66666666-6666-4666-8666-666666666666";

  it("a fragment carrying a FOREIGN workspace_id is refused as invalid, not authorized", async () => {
    const batch = poisonDoc((scratch) =>
      writeRaw(scratch, NODE, "operational", {
        ...baseRecord(NODE, "Employee"),
        workspace_id: "99999999-9999-4999-8999-999999999999",
      }),
    );
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("invalid");
    // The canonical document must be untouched — that is the whole point.
    expect(readNodeFragments(document)).toEqual([]);
    document.free();
  });

  it("two partitions of one node id disagreeing about node_type are refused as invalid", async () => {
    const batch = poisonDoc((scratch) => {
      writeRaw(scratch, NODE, "operational", baseRecord(NODE, "Employee"));
      writeRaw(scratch, NODE, "record", baseRecord(NODE, "Project"));
    });
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("invalid");
    expect(readNodeFragments(document)).toEqual([]);
    document.free();
  });

  it("a malformed record is refused as invalid rather than throwing out of the gate (F142)", async () => {
    const batch = poisonDoc((scratch) =>
      writeRaw(scratch, NODE, "operational", {
        ...baseRecord(NODE, "Employee"),
        lifecycle_status: "Archived",
      }),
    );
    const document = new LoroDoc();
    // Before the fix this rejected with a raw ZodError, which `entry.ts`
    // reported as a FATAL runtime-failure.
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome.status).toBe("invalid");
    expect(readNodeFragments(document)).toEqual([]);
    document.free();
  });

  it("the refusal reason never echoes the underlying validation message, which would be an existence oracle", async () => {
    const batch = poisonDoc((scratch) =>
      writeRaw(scratch, NODE, "operational", {
        ...baseRecord(NODE, "Employee"),
        workspace_id: "99999999-9999-4999-8999-999999999999",
      }),
    );
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    if (outcome.status !== "invalid") throw new Error("expected an invalid outcome");
    expect(outcome.reason).toBe(INVALID_BATCH_REASON);
    // Neither the offending node id nor either workspace id may appear.
    expect(outcome.reason).not.toContain(NODE);
    expect(outcome.reason).not.toContain("99999999");
    expect(outcome.reason).not.toContain(FIXTURE_WORKSPACE);
    document.free();
  });

  it("a coherent batch is still authorized — the coherence check does not refuse everything", async () => {
    const batch = poisonDoc((scratch) =>
      writeRaw(scratch, NODE, "operational", baseRecord(NODE, "Employee")),
    );
    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(
      document,
      [batch],
      OWNER,
      FIXTURE_WORKSPACE,
    );
    expect(outcome).toEqual({ status: "authorized" });
    document.free();
  });
});

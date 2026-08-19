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
  diffChangedNodeFragments,
} from "./mutation-interceptor";
import { POLICY_ROLES, resolvePermission, type PolicyRole } from "./policy-table";

const ALL_ROLES: readonly PolicyRole[] = POLICY_ROLES;

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
    (registration): registration is typeof registration & {
      fromNodeType: NodeType;
      toNodeType: NodeType;
    } => isNodeType(registration.fromNodeType) && isNodeType(registration.toNodeType),
  );

  it("is exercised against at least one real registered relationship", () => {
    expect(concreteRegistrations.length).toBeGreaterThan(0);
  });

  it("grants only when both endpoints have exactly one privacy partition and both resolve to full for the role", () => {
    let checked = 0;
    for (const { edgeType, fromNodeType, toNodeType } of concreteRegistrations) {
      for (const role of ALL_ROLES) {
        const authorization = authorizeEdgeWrite(edgeType, fromNodeType, toNodeType, [
          role,
        ]);
        const fromPartitions = getProtectionPartitions(fromNodeType);
        const toPartitions = getProtectionPartitions(toNodeType);
        const expectedAllowed =
          fromPartitions.length === 1 &&
          toPartitions.length === 1 &&
          resolvePermission(role, fromNodeType, fromPartitions[0]!.key).outcome ===
            "full" &&
          resolvePermission(role, toNodeType, toPartitions[0]!.key).outcome === "full";
        expect(authorization.allowed).toBe(expectedAllowed);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("managed_by (Employee -> Employee): denied for every role, since Employee has split protection and F136 resolves that conservatively to none", () => {
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

  it("an edge type absent from EDGE_TYPES entirely still resolves rather than throwing, when both endpoints are real node types", () => {
    // authorizeEdgeWrite takes a bare string edgeType — it never validates
    // registration, only endpoint permission, since VPS-A004 assigns no
    // write-permission column to the edge type itself.
    expect(() =>
      authorizeEdgeWrite("not_a_registered_edge_type" as EdgeType, "User", "User", [
        "owner",
      ]),
    ).not.toThrow();
  });
});

describe("diffChangedNodeFragments — the fork-then-diff half of runtime.ts's mutate", () => {
  it("returns nothing when before and after are identical", () => {
    const fragments = [fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational")];
    expect(diffChangedNodeFragments(fragments, fragments)).toEqual([]);
  });

  it("surfaces an added fragment", () => {
    const before: NodeFragmentInput[] = [];
    const after = [fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational")];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      { nodeId: "66666666-6666-4666-8666-666666666666", partitionKey: "operational", nodeType: "Employee" },
    ]);
  });

  it("surfaces a removed fragment, keyed by the BEFORE record's type and partition", () => {
    const before = [fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational")];
    const after: NodeFragmentInput[] = [];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      { nodeId: "66666666-6666-4666-8666-666666666666", partitionKey: "operational", nodeType: "Employee" },
    ]);
  });

  it("surfaces a changed fragment by canonical-JSON inequality, ignoring key order", () => {
    const before = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational", { title: "Engineer" }),
    ];
    const after = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational", { title: "Senior Engineer" }),
    ];
    expect(diffChangedNodeFragments(before, after)).toHaveLength(1);
  });

  it("does not surface a fragment whose fields are reordered but unchanged in value", () => {
    const before: NodeFragmentInput = {
      sourceDocumentId: "node-fragment:66666666-6666-4666-8666-666666666666:operational",
      partitionKey: "operational",
      record: { a: 1, ...baseRecord("66666666-6666-4666-8666-666666666666", "Employee") },
    };
    const after: NodeFragmentInput = {
      sourceDocumentId: "node-fragment:66666666-6666-4666-8666-666666666666:operational",
      partitionKey: "operational",
      record: { ...baseRecord("66666666-6666-4666-8666-666666666666", "Employee"), a: 1 },
    };
    expect(diffChangedNodeFragments([before], [after])).toEqual([]);
  });

  it("only surfaces the specific fragment a batch touches, not every fragment in the snapshot", () => {
    const untouched = fragmentInput("11111111-1111-4111-8111-111111111111", "Employee", "operational");
    const before = [untouched, fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "compensation")];
    const after = [
      untouched,
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "compensation", { salary: 1 }),
    ];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      { nodeId: "66666666-6666-4666-8666-666666666666", partitionKey: "compensation", nodeType: "Employee" },
    ]);
  });

  it("treats two different partitions of the same node as independently diffed", () => {
    const before = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational"),
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "compensation"),
    ];
    const after = [
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "operational", { title: "Changed" }),
      fragmentInput("66666666-6666-4666-8666-666666666666", "Employee", "compensation"),
    ];
    const changed = diffChangedNodeFragments(before, after);
    expect(changed).toEqual([
      { nodeId: "66666666-6666-4666-8666-666666666666", partitionKey: "operational", nodeType: "Employee" },
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
    const fragment = document.getMap(NODE_FRAGMENT_CONTAINER).setContainer(
      key,
      new LoroMap(),
    );
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
    const batch = nodeFragmentBatch("66666666-6666-4666-8666-666666666666", "Employee", "operational", {
      title: "Engineer",
    });
    const outcome = await authorizeMutationBatch(document, [batch], OWNER);
    expect(outcome).toEqual({ status: "authorized" });
    document.free();
  });

  it("denies when the caller does not have Full write on the changed fragment, and names it in the reason", async () => {
    const document = new LoroDoc();
    const batch = nodeFragmentBatch("66666666-6666-4666-8666-666666666666", "Employee", "compensation", {
      salary: 1,
    });
    const outcome = await authorizeMutationBatch(document, [batch], TEAM_MEMBER);
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

    const outcome = await authorizeMutationBatch(document, [batch], TEAM_MEMBER);
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
    writeFragment(scratch, "66666666-6666-4666-8666-666666666666", "Employee", "operational");
    scratch.getTree("org_hierarchy").createNode();
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();

    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(document, [batch], OWNER);
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
    const outcome = await authorizeMutationBatch(document, [batch], OWNER);
    expect(outcome.status).toBe("unsupported");
    if (outcome.status === "unsupported") {
      expect(outcome.reason).toContain("some_future_container_nobody_has_written_yet");
    }
    document.free();
  });

  it("refuses the whole batch when ONE of several changed fragments is denied — no partial commit signaled", async () => {
    const scratch = new LoroDoc();
    writeFragment(scratch, "44444444-4444-4444-8444-444444444444", "Employee", "operational");
    writeFragment(scratch, "55555555-5555-4555-8555-555555555555", "Employee", "compensation");
    scratch.commit();
    const batch = scratch.export({ mode: "snapshot" });
    scratch.free();

    const document = new LoroDoc();
    const outcome = await authorizeMutationBatch(document, [batch], TEAM_MEMBER);
    expect(outcome.status).toBe("denied");
    document.free();
  });

  it("authorizes a batch that changes nothing relative to the current document (idempotent re-apply), regardless of role", async () => {
    const document = new LoroDoc();
    const batch = nodeFragmentBatch("66666666-6666-4666-8666-666666666666", "Employee", "operational");
    // Land it for real first, the same way runtime.ts#mutate would commit
    // an authorized batch, so "before" already contains this fragment.
    document.import(batch);
    document.commit();

    const outcome = await authorizeMutationBatch(document, [batch], []);
    expect(outcome).toEqual({ status: "authorized" });
    document.free();
  });
});

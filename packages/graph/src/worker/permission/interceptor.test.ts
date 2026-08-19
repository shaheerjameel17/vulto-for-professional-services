import type { NodeType } from "@vulto/schema";
import { describe, expect, it, vi } from "vitest";
import type { GraphQuery } from "../../query";
import type {
  GraphQueryResult,
  MaterializedNode,
  MaterializedNodeFragment,
  SQLiteGraphIndex,
} from "../storage/sqlite-graph-index";
import { executeWithPermissions, filterNode, isNodeTypeReadable } from "./interceptor";

/**
 * A `SQLiteGraphIndex`-shaped test double. The real class needs a browser
 * (`wa-sqlite`'s WASM loader calls `fetch`, unavailable under plain Vitest —
 * confirmed while scoping this stage), so unit coverage here exercises the
 * interceptor's own filtering and traversal logic against a hand-built
 * fixture, and the full real-Chromium/real-Postgres/real-SQLite path is
 * proven separately in `services/api/browser-tests-device-store/`.
 */
function fakeIndex(execute: (query: GraphQuery) => Promise<GraphQueryResult>): {
  index: SQLiteGraphIndex;
  execute: typeof execute;
} {
  const spy = vi.fn(execute);
  return { index: { execute: spy } as unknown as SQLiteGraphIndex, execute: spy };
}

function fragment(
  partitionKey: string,
  record: Record<string, unknown>,
): MaterializedNodeFragment {
  return {
    partitionKey,
    sourceDocumentId: `node-fragment:${String(record.node_id)}:${partitionKey}`,
    record: record as MaterializedNodeFragment["record"],
  };
}

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

function employeeNode(nodeId: string): MaterializedNode {
  return {
    nodeId,
    nodeType: "Employee",
    fragments: [
      fragment(
        "operational",
        baseRecord(nodeId, "Employee", { job_title: "Engineer" }),
      ),
      fragment("compensation", baseRecord(nodeId, "Employee", { base_salary: 150000 })),
    ],
  };
}

describe("filterNode", () => {
  it("drops a fragment the role set cannot read at all, keeps and redacts the one it can only see Restricted", () => {
    const node = employeeNode("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    // Manager: operational is "Full (direct reports)" — a row-identity
    // qualifier this stage cannot resolve, so per F128 it resolves to
    // `none` and the fragment is dropped entirely, not kept as "Full."
    // compensation is Restricted ("Visible to Finance Admin"), unaffected —
    // that matrix cell carries no qualifier at all ("any" scope), so its
    // literal outcome stands.
    const filtered = filterNode(node, ["manager"]);
    expect(filtered).not.toBeNull();
    expect(filtered!.fragments).toHaveLength(1);
    const compensation = filtered!.fragments.find(
      (f) => f.partitionKey === "compensation",
    )!;
    expect(filtered!.fragments.find((f) => f.partitionKey === "operational")).toBe(
      undefined,
    );
    expect(
      (compensation.record as Record<string, unknown>).base_salary,
    ).toBeUndefined();
    expect((compensation.record as Record<string, unknown>).__restricted).toBe(true);
    expect((compensation.record as Record<string, unknown>).__restrictedLabel).toBe(
      "Visible to Finance Admin",
    );
    // Universal fields survive on the placeholder — the box says "this node
    // type always has this," per A004-T19.
    expect((compensation.record as Record<string, unknown>).node_id).toBe(node.nodeId);
  });

  it("returns the node unchanged when every fragment is readable in full", () => {
    const node = employeeNode("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const filtered = filterNode(node, ["owner"]);
    expect(filtered).toEqual(node);
  });

  it("structurally omits a node whose every fragment resolves to none — not present, not a placeholder", () => {
    // OrgScenario: "Owner and HR Admin only", an unqualified ("any"-scope)
    // matrix cell for every role — Owner and HR Admin get "full", everyone
    // else "none". Chosen deliberately over a qualified cell (e.g.
    // WellnessTriggerEvent's "Full (own only)") so this test proves
    // structural omission on its own terms, not by relying on F128's
    // conservative default for an unresolved row-identity qualifier.
    const node: MaterializedNode = {
      nodeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      nodeType: "OrgScenario",
      fragments: [
        fragment(
          "record",
          baseRecord("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "OrgScenario"),
        ),
      ],
    };
    expect(filterNode(node, ["owner"])).not.toBeNull();
    expect(filterNode(node, ["hr-admin"])).not.toBeNull();
    expect(filterNode(node, ["finance-admin"])).toBeNull();
    expect(filterNode(node, ["team-member"])).toBeNull();
  });

  it("A004-T05 union: the higher grant wins across a held role set", () => {
    const node = employeeNode("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    // team-member alone: compensation is "read" (own only, coarse). Owner
    // held simultaneously: compensation is "full". Union picks "full".
    const filtered = filterNode(node, ["team-member", "owner"]);
    const compensation = filtered!.fragments.find(
      (f) => f.partitionKey === "compensation",
    )!;
    expect((compensation.record as Record<string, unknown>).base_salary).toBe(150000);
  });
});

describe("isNodeTypeReadable", () => {
  it("is false for a node type with inherited protection, for every role", () => {
    expect(
      isNodeTypeReadable("Document", [
        "owner",
        "hr-admin",
        "finance-admin",
        "team-member",
      ]),
    ).toBe(false);
  });

  it("is true when at least one partition is readable", () => {
    // Manager: operational is "Full (direct reports)", a row-identity
    // qualifier F128 resolves to `none`. compensation is "Restricted"
    // ("Visible to Finance Admin") — an unqualified, "any"-scope matrix
    // cell, and `restricted` is not `none`. Employee is therefore still
    // "readable" overall for Manager, on the strength of the one partition
    // whose grant this stage can actually resolve.
    expect(isNodeTypeReadable("Employee", ["manager"])).toBe(true);
  });
});

describe("executeWithPermissions — node-get / node-list", () => {
  it("node-get returns null instead of the interceptor's own placeholder shape when nothing is visible", async () => {
    const node: MaterializedNode = {
      nodeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      nodeType: "OrgScenario",
      fragments: [
        fragment(
          "record",
          baseRecord("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "OrgScenario"),
        ),
      ],
    };
    const { index } = fakeIndex(async () => ({ kind: "node-get", node }));
    const result = await executeWithPermissions(
      index,
      {
        kind: "node-get",
        nodeId: node.nodeId,
        nodeType: "OrgScenario",
        includeSoftDeleted: false,
      },
      { roles: ["team-member"] },
    );
    expect(result).toEqual({ kind: "node-get", node: null });
  });

  it("node-list drops every node the role set cannot see and keeps the rest, unfiltered", async () => {
    // Role is "manager", not "team-member": Employee(operational) for
    // Manager is "Full (direct reports)", a row-identity qualifier F128
    // resolves to `none` — but Employee(compensation) for Manager is
    // "Restricted" (any-scope, unaffected), so the Employee node as a
    // whole still survives filtering, with its operational fragment
    // dropped and its compensation fragment redacted. OrgScenario is
    // `none` for Manager on every fragment, so it is dropped entirely.
    const visible = employeeNode("11111111-1111-4111-8111-111111111111");
    const invisible: MaterializedNode = {
      nodeId: "44444444-4444-4444-8444-444444444444",
      nodeType: "OrgScenario",
      fragments: [
        fragment(
          "record",
          baseRecord("44444444-4444-4444-8444-444444444444", "OrgScenario"),
        ),
      ],
    };
    const { index } = fakeIndex(async () => ({
      kind: "node-list",
      nodes: [visible, invisible],
      nextNodeId: null,
    }));
    const result = await executeWithPermissions(
      index,
      { kind: "node-list", nodeType: "Employee", limit: 50, includeSoftDeleted: false },
      { roles: ["manager"] },
    );
    expect(result.kind).toBe("node-list");
    if (result.kind !== "node-list") throw new Error("unreachable");
    expect(result.nodes.map((n) => n.nodeId)).toEqual([visible.nodeId]);
  });
});

describe("executeWithPermissions — edge-neighbors traversal rules", () => {
  const edgeQuery: Extract<GraphQuery, { kind: "edge-neighbors" }> = {
    kind: "edge-neighbors",
    startNodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    direction: "outgoing",
    edgeType: "managed_by",
    fromNodeType: "Employee",
    toNodeType: "Employee",
    asOf: "2026-01-01T00:00:00.000Z",
    limit: 50,
    includeSoftDeleted: false,
  };

  it("Node A unreadable: returns empty without even querying the index", async () => {
    const { index, execute } = fakeIndex(async () => {
      throw new Error("must not be called — Node A was not readable");
    });
    // OrgScenario as the start node type: None for every role we pass.
    const result = await executeWithPermissions(
      index,
      { ...edgeQuery, fromNodeType: "OrgScenario", toNodeType: "Employee" },
      { roles: ["team-member"] },
    );
    expect(result).toEqual({ kind: "edge-neighbors", neighbors: [], nextEdgeId: null });
    expect(execute).not.toHaveBeenCalled();
  });

  it("drops a neighbor edge and node together when Node B is unreadable, keeps a readable one", async () => {
    const readableNeighbor = employeeNode("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const unreadableNeighbor: MaterializedNode = {
      nodeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      nodeType: "OrgScenario",
      fragments: [
        fragment(
          "record",
          baseRecord("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "OrgScenario"),
        ),
      ],
    };
    const { index } = fakeIndex(async () => ({
      kind: "edge-neighbors",
      neighbors: [
        {
          edge: {
            edge_id: "d1111111-1111-4111-8111-111111111111",
            edge_type: "managed_by",
            from_node_id: edgeQuery.startNodeId,
            to_node_id: readableNeighbor.nodeId,
            effective_from: null,
            effective_to: null,
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: "33333333-3333-4333-8333-333333333333",
            metadata: null,
            is_soft_deleted: false,
            soft_deleted_at: null,
            soft_deleted_by: null,
          },
          node: readableNeighbor,
        },
        {
          edge: {
            edge_id: "d2222222-2222-4222-8222-222222222222",
            edge_type: "managed_by",
            from_node_id: edgeQuery.startNodeId,
            to_node_id: unreadableNeighbor.nodeId,
            effective_from: null,
            effective_to: null,
            created_at: "2026-01-01T00:00:00.000Z",
            created_by: "33333333-3333-4333-8333-333333333333",
            metadata: null,
            is_soft_deleted: false,
            soft_deleted_at: null,
            soft_deleted_by: null,
          },
          node: unreadableNeighbor,
        },
      ],
      nextEdgeId: null,
    }));
    // Role is "manager", not "team-member" — same reasoning as the
    // node-list test above: Employee is readable overall for Manager only
    // via its unaffected, any-scope compensation partition ("Restricted"),
    // and Employee(operational)'s own row-identity qualifier resolves to
    // `none` under F128 either way.
    const result = await executeWithPermissions(index, edgeQuery, {
      roles: ["manager"],
    });
    expect(result.kind).toBe("edge-neighbors");
    if (result.kind !== "edge-neighbors") throw new Error("unreachable");
    expect(result.neighbors).toHaveLength(1);
    expect(result.neighbors[0]!.node.nodeId).toBe(readableNeighbor.nodeId);
  });
});

describe("executeWithPermissions — recursive-neighbors, hop-2 non-leakage", () => {
  /**
   * The mutation-tested property (VPS-A004: "a boundary at hop 2 does not
   * expose the existence of nodes at hop 3"): hop 1 -> hop 2 is readable,
   * hop 2 is itself invisible to the caller's role, and hop 2 -> hop 3
   * WOULD be readable if the traversal ever reached it. This proves the
   * interceptor's recursive walk never expands past a denied node — not by
   * checking that hop 3 is merely absent from the final list (a query that
   * simply never looked past hop 1 would also produce that), but by
   * asserting the fake index was never even ASKED for hop 2's neighbors.
   */
  it("never expands the frontier past a node the caller cannot see", async () => {
    const hop1 = "11111111-1111-4111-8111-111111111111";
    const hop2 = "22222222-2222-4222-8222-222222222222"; // OrgScenario: invisible to team-member.
    const hop3 = employeeNode("33333333-3333-4333-8333-333333333333");

    const hop2Node: MaterializedNode = {
      nodeId: hop2,
      nodeType: "OrgScenario",
      fragments: [fragment("record", baseRecord(hop2, "OrgScenario"))],
    };

    function edgeFrom(fromId: string, toId: string, edgeId: string) {
      return {
        edge_id: edgeId,
        edge_type: "managed_by" as const,
        from_node_id: fromId,
        to_node_id: toId,
        effective_from: null,
        effective_to: null,
        created_at: "2026-01-01T00:00:00.000Z",
        created_by: "33333333-3333-4333-8333-333333333333",
        metadata: null,
        is_soft_deleted: false,
        soft_deleted_at: null,
        soft_deleted_by: null,
      };
    }

    const { index, execute } = fakeIndex(async (query) => {
      if (query.kind !== "edge-neighbors") throw new Error("unexpected query kind");
      if (query.startNodeId === hop1) {
        return {
          kind: "edge-neighbors",
          neighbors: [
            {
              edge: edgeFrom(hop1, hop2, "d1111111-1111-4111-8111-111111111111"),
              node: hop2Node,
            },
          ],
          nextEdgeId: null,
        };
      }
      if (query.startNodeId === hop2) {
        // If the interceptor ever calls this, the leak has already
        // happened — hop 2 was invisible and must never have been used to
        // expand the frontier.
        return {
          kind: "edge-neighbors",
          neighbors: [
            {
              edge: edgeFrom(hop2, hop3.nodeId, "d2222222-2222-4222-8222-222222222222"),
              node: hop3,
            },
          ],
          nextEdgeId: null,
        };
      }
      return { kind: "edge-neighbors", neighbors: [], nextEdgeId: null };
    });

    const result = await executeWithPermissions(
      index,
      {
        kind: "recursive-neighbors",
        startNodeId: hop1,
        direction: "outgoing",
        edgeType: "managed_by",
        fromNodeType: "Employee",
        toNodeType: "Employee",
        asOf: "2026-01-01T00:00:00.000Z",
        maxDepth: 4,
        maxResults: 200,
        includeSoftDeleted: false,
      },
      { roles: ["team-member"] },
    );

    expect(result.kind).toBe("recursive-neighbors");
    if (result.kind !== "recursive-neighbors") throw new Error("unreachable");
    expect(result.neighbors).toHaveLength(0);
    expect(result.truncated).toBe(false);
    // The load-bearing assertion: hop 2 never became a frontier member, so
    // its own neighbors (hop 3) were never even queried for.
    expect(execute).not.toHaveBeenCalledWith(
      expect.objectContaining({ startNodeId: hop2 }),
    );
  });
});

import { parseGraphQuery } from "../../query";
import type { EdgeInput, NodeFragmentInput } from "../materialization";
import { GraphQuerySubscription } from "../query-subscription";
import { SQLiteGraphIndex } from "../storage/sqlite-graph-index";

interface ProofResult {
  readonly generation: number;
  readonly nodeCount: number;
  readonly twoHopCount: number;
  readonly historicalHandoffTarget: string | null;
  readonly subscriptionObservedCommit: boolean;
  readonly indexedPlan: boolean;
  readonly deterministicRebuild: boolean;
  readonly failedBatchPreservedGeneration: boolean;
  readonly durationMs: number;
}

interface ProofScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: unknown): void;
}

const scope = self as unknown as ProofScope;
const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const ACTOR = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-08-17T10:30:00.000Z";

function id(prefix: number, value: number): string {
  return `00000000-0000-4${prefix.toString(16).padStart(3, "0")}-8000-${value.toString(16).padStart(12, "0")}`;
}

function fixtures(): {
  nodeFragments: NodeFragmentInput[];
  edges: EdgeInput[];
} {
  const nodeFragments: NodeFragmentInput[] = Array.from(
    { length: 150 },
    (_, index) => ({
      sourceDocumentId: `employee-document-${index}`,
      partitionKey: "operational",
      record: {
        node_id: id(1, index + 1),
        workspace_id: WORKSPACE,
        node_type: "Employee",
        schema_version: 1,
        lifecycle_status: "Active",
        created_at: NOW,
        created_by: ACTOR,
        updated_at: NOW,
        updated_by: ACTOR,
        is_soft_deleted: false,
        soft_deleted_at: null,
        soft_deleted_by: null,
        display_name: `Employee ${index + 1}`,
      },
    }),
  );
  const edges: EdgeInput[] = Array.from({ length: 149 }, (_, index) => ({
    sourceDocumentId: `manager-edge-document-${index}`,
    record: {
      edge_id: id(2, index + 1),
      edge_type: "managed_by",
      from_node_id: id(1, index + 1),
      to_node_id: id(1, index + 2),
      effective_from: index === 0 ? NOW : null,
      effective_to: null,
      created_at: NOW,
      created_by: ACTOR,
      metadata: {},
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
    },
  }));
  edges.push({
    sourceDocumentId: "historical-manager-edge-document",
    record: {
      edge_id: id(2, 1_000),
      edge_type: "managed_by",
      from_node_id: id(1, 1),
      to_node_id: id(1, 3),
      effective_from: null,
      effective_to: NOW,
      created_at: NOW,
      created_by: ACTOR,
      metadata: {},
      is_soft_deleted: false,
      soft_deleted_at: null,
      soft_deleted_by: null,
    },
  });
  return { nodeFragments, edges };
}

async function runProof(): Promise<ProofResult> {
  const startedAt = performance.now();
  const snapshot = fixtures();
  const index = new SQLiteGraphIndex(WORKSPACE);
  const second = new SQLiteGraphIndex(WORKSPACE);
  await index.initialize();
  await second.initialize();
  try {
    const listQuery = parseGraphQuery({
      kind: "node-list",
      nodeType: "Employee",
      limit: 200,
    });
    let subscriptionObservedCommit = false;
    let resolveCommit: (() => void) | undefined;
    const committed = new Promise<void>((resolve) => {
      resolveCommit = resolve;
    });
    const subscription = new GraphQuerySubscription(index, listQuery, (result) => {
      if (result.kind === "node-list" && result.nodes.length === 150) {
        subscriptionObservedCommit = true;
        resolveCommit?.();
      }
    });
    await subscription.start();
    const generation = await index.rebuild(snapshot);
    await committed;
    subscription.dispose();

    const list = await index.execute(listQuery);
    if (list.kind !== "node-list") throw new Error("Unexpected node-list result");
    const recursiveQuery = parseGraphQuery({
      kind: "recursive-neighbors",
      startNodeId: id(1, 1),
      direction: "outgoing",
      asOf: NOW,
      edgeType: "managed_by",
      fromNodeType: "Employee",
      toNodeType: "Employee",
      maxDepth: 2,
      maxResults: 10,
    });
    const recursive = await index.execute(recursiveQuery);
    if (recursive.kind !== "recursive-neighbors") {
      throw new Error("Unexpected recursive result");
    }
    const edgeQuery = parseGraphQuery({
      kind: "edge-neighbors",
      startNodeId: id(1, 1),
      direction: "outgoing",
      asOf: NOW,
      edgeType: "managed_by",
      fromNodeType: "Employee",
      toNodeType: "Employee",
      limit: 10,
    });
    if (edgeQuery.kind !== "edge-neighbors") throw new Error("Unexpected query");
    const plan = await index.explain(edgeQuery);
    const historical = await index.execute(
      parseGraphQuery({
        ...edgeQuery,
        asOf: "2026-08-16T10:30:00Z",
      }),
    );

    const canonicalBeforeFailure = index.canonicalSnapshot();
    let rejectedInvalidBatch = false;
    try {
      await index.apply({
        nodeFragments: [],
        edges: [
          {
            sourceDocumentId: "invalid-second-manager",
            record: {
              edge_id: id(3, 1),
              edge_type: "managed_by",
              from_node_id: id(1, 1),
              to_node_id: id(1, 3),
              effective_from: null,
              effective_to: null,
              created_at: NOW,
              created_by: ACTOR,
              metadata: {},
              is_soft_deleted: false,
              soft_deleted_at: null,
              soft_deleted_by: null,
            },
          },
        ],
      });
    } catch {
      rejectedInvalidBatch = true;
    }
    const generationAfterFailure = await index.generation;

    await second.rebuild({
      nodeFragments: [...snapshot.nodeFragments].reverse(),
      edges: [...snapshot.edges].reverse(),
    });
    return {
      generation,
      nodeCount: list.nodes.length,
      twoHopCount: recursive.neighbors.length,
      historicalHandoffTarget:
        historical.kind === "edge-neighbors"
          ? (historical.neighbors[0]?.node.nodeId ?? null)
          : null,
      subscriptionObservedCommit,
      indexedPlan: plan.some((line) => line.includes("graph_edges_outgoing")),
      deterministicRebuild: index.canonicalSnapshot() === second.canonicalSnapshot(),
      failedBatchPreservedGeneration:
        rejectedInvalidBatch &&
        generationAfterFailure === generation &&
        index.canonicalSnapshot() === canonicalBeforeFailure,
      durationMs: performance.now() - startedAt,
    };
  } finally {
    await index.dispose();
    await second.dispose();
  }
}

scope.onmessage = () => {
  void runProof()
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((error: unknown) =>
      scope.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown browser proof failure",
      }),
    );
};

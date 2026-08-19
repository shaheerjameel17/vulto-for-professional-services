import { getProtectionPartitions, type NodeRecord, type NodeType } from "@vulto/schema";
import type { GraphQuery } from "../../query";
import type {
  GraphQueryResult,
  MaterializedNeighbor,
  MaterializedNode,
  MaterializedNodeFragment,
  MaterializedRecursiveNeighbor,
  SQLiteGraphIndex,
} from "../storage/sqlite-graph-index";
import {
  resolvePermission,
  type PermissionOutcome,
  type PolicyRole,
  type PolicyResolution,
} from "./policy-table";

/**
 * FDN-53 stage 1. The `VPS-A004` permission interceptor.
 *
 * Wraps `SQLiteGraphIndex.execute()` — the same private executor the
 * test-only harnesses under `worker/testing/` already call — with
 * `policy-table.ts`'s role-ceiling resolution. Per F105, this module is the
 * FIRST caller of `execute()` reachable from a production protocol message;
 * `worker/entry.ts`'s new `query` case routes through this, never through
 * `SQLiteGraphIndex` directly.
 *
 * **Universal fields kept on a `Restricted` placeholder.** Deliberately
 * duplicated from `materialization.ts`'s own `universalKeys` rather than
 * importing it — that module is explicitly not to be modified for this
 * stage, and re-exporting a symbol from it to avoid a nine-line duplicate
 * list was judged the worse trade.
 */
const UNIVERSAL_NODE_KEYS = [
  "node_id",
  "node_type",
  "schema_version",
  "lifecycle_status",
  "workspace_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "is_soft_deleted",
  "soft_deleted_at",
  "soft_deleted_by",
] as const;

const OUTCOME_RANK: Readonly<Record<PermissionOutcome, number>> = {
  full: 3,
  read: 2,
  restricted: 1,
  none: 0,
};

const NONE_RESOLUTION: PolicyResolution = { outcome: "none" };

/**
 * A004-T05: role combinations resolve as the union — the higher grant
 * wherever rules differ.
 *
 * Exported for FDN-53 stage 2's mutation interceptor, which reuses this
 * unchanged: `resolvePermission`'s `full` outcome is the same ceiling for a
 * write that `read`/`restricted` are for a read, and A004-T05's role-union
 * rule is stated for "role combinations," not for reads specifically.
 */
export function bestResolution(
  roles: readonly PolicyRole[],
  nodeType: NodeType,
  partitionKey: string,
): PolicyResolution {
  let best = NONE_RESOLUTION;
  for (const role of roles) {
    const resolution = resolvePermission(role, nodeType, partitionKey);
    if (OUTCOME_RANK[resolution.outcome] > OUTCOME_RANK[best.outcome]) {
      best = resolution;
    }
  }
  return best;
}

/**
 * A004-T19: a `Restricted` render built only from what this node type's
 * schema guarantees exists — never from the specific instance's received
 * bytes. Every feature-specific (passthrough) field is dropped; only the
 * universal fields every fragment already carries survive, alongside a
 * marker application code renders as the restricted state.
 */
function restrictedPlaceholder(record: NodeRecord, label: string): NodeRecord {
  const source = record as unknown as Record<string, unknown>;
  const placeholder: Record<string, unknown> = {
    __restricted: true,
    __restrictedLabel: label,
  };
  for (const key of UNIVERSAL_NODE_KEYS) {
    if (key in source) placeholder[key] = source[key];
  }
  return placeholder as unknown as NodeRecord;
}

function filterFragment(
  fragment: MaterializedNodeFragment,
  nodeType: NodeType,
  roles: readonly PolicyRole[],
): MaterializedNodeFragment | null {
  const resolution = bestResolution(roles, nodeType, fragment.partitionKey);
  if (resolution.outcome === "none") return null;
  if (resolution.outcome === "restricted") {
    return {
      ...fragment,
      record: restrictedPlaceholder(
        fragment.record,
        resolution.restrictedLabel ?? "Restricted",
      ),
    };
  }
  return fragment;
}

/**
 * `node-get`/`node-list` row filtering: a node with every fragment denied is
 * structurally absent (`null`); a node with some fragments denied and some
 * granted keeps the granted ones, drops the denied ones outright, and
 * replaces a `Restricted` fragment's content with a schema-derived
 * placeholder — never a mix that leaks which partitions exist beyond what
 * `Restricted` already discloses.
 */
export function filterNode(
  node: MaterializedNode,
  roles: readonly PolicyRole[],
): MaterializedNode | null {
  const fragments = node.fragments
    .map((fragment) => filterFragment(fragment, node.nodeType, roles))
    .filter((fragment): fragment is MaterializedNodeFragment => fragment !== null);
  if (fragments.length === 0) return null;
  return { ...node, fragments };
}

/**
 * Whether a node TYPE is reachable at all for this role set, independent of
 * any particular instance's materialized fragments — used for the traversal
 * rule's "Read on Node A" check, where Node A is never refetched. A node
 * type with no registered partitions (`inherited` protection) is
 * unresolvable this stage and conservatively not traversable; see
 * `policy-table.ts`'s doc comment.
 */
export function isNodeTypeReadable(
  nodeType: NodeType,
  roles: readonly PolicyRole[],
): boolean {
  const partitions = getProtectionPartitions(nodeType);
  return partitions.some(
    (partition) => bestResolution(roles, nodeType, partition.key).outcome !== "none",
  );
}

export interface PermissionContext {
  /** The effective role set for this query, already resolved to the union per A004-T05. */
  readonly roles: readonly PolicyRole[];
}

function filterNeighbor(
  neighbor: MaterializedNeighbor,
  roles: readonly PolicyRole[],
): MaterializedNeighbor | null {
  const node = filterNode(neighbor.node, roles);
  // Graph traversal rule #2/#3: where Read on Node B is absent, the
  // traversal stops at Node A — the edge and Node B are both omitted, not
  // hidden or replaced with a placeholder or count.
  if (node === null) return null;
  return { edge: neighbor.edge, node };
}

/**
 * Single-hop `edge-neighbors`, permission-filtered per `VPS-A004`'s graph
 * traversal rules:
 *
 * 1. Read is required on Node A (the start node's type), Node B (each
 *    neighbor's type), and the edge type.
 * 2/3. A neighbor whose node is not readable is omitted entirely — the
 *    result is identical to the edge and node never having existed.
 *
 * **The edge-type leg of rule 1 is not enforced this stage.** Neither
 * `VPS-A004`'s matrix nor `VPS-A002`'s edge registry (`EDGE_GROUPS`) assigns
 * a Privacy Class, or any protection metadata at all, to an edge TYPE —
 * only to node types and node-type partitions. There is nothing to look up.
 * Treating "Read on the edge type" as always satisfied once both endpoints
 * are readable is the conservative reading available without inventing a
 * table the specification does not define: it grants nothing beyond what
 * the two endpoint checks already allow, so no traversal becomes visible
 * that this function's node-level checks would not already have permitted.
 * Recorded as a candidate finding rather than guessed at a real per-edge-type
 * policy.
 */
async function interceptedEdgeNeighbors(
  index: SQLiteGraphIndex,
  query: Extract<GraphQuery, { kind: "edge-neighbors" }>,
  roles: readonly PolicyRole[],
): Promise<Extract<GraphQueryResult, { kind: "edge-neighbors" }>> {
  const startNodeType =
    query.direction === "outgoing" ? query.fromNodeType : query.toNodeType;
  if (!isNodeTypeReadable(startNodeType, roles)) {
    return { kind: "edge-neighbors", neighbors: [], nextEdgeId: null };
  }

  const raw = await index.execute(query);
  if (raw.kind !== "edge-neighbors") {
    throw new Error("Invalid edge-neighbors result from the graph index");
  }
  const neighbors = raw.neighbors
    .map((neighbor) => filterNeighbor(neighbor, roles))
    .filter((neighbor): neighbor is MaterializedNeighbor => neighbor !== null);
  return { kind: "edge-neighbors", neighbors, nextEdgeId: raw.nextEdgeId };
}

/**
 * Multi-hop `recursive-neighbors`, reimplemented at THIS layer rather than
 * delegated to `SQLiteGraphIndex`'s own `recursive-neighbors` case.
 *
 * `SQLiteGraphIndex.execute()`'s recursive branch calls `this.execute(...)`
 * on itself for each hop — the RAW, unfiltered executor, entirely bypassing
 * whatever a caller wrapped the top-level call with. Wrapping only the
 * top-level call here would filter the final result but not the
 * intermediate hops the raw traversal used to reach it, which is exactly
 * the shape of leak Graph traversal rule 4 exists to prevent: "a boundary
 * at hop 2 does not expose the existence of nodes at hop 3." A permission
 * boundary at hop 2 in the RAW traversal would still have let the raw
 * recursion continue through the denied node to reach hop 3, and this
 * function would then filter hop 3 fine on its own but the denied hop-2
 * node's outgoing structure would already have shaped which hop-3 nodes
 * were even candidates — an indirect existence leak no amount of
 * result-filtering after the fact removes.
 *
 * This mirrors `SQLiteGraphIndex`'s own frontier-expansion loop exactly,
 * substituting `interceptedEdgeNeighbors` for the raw per-hop call so every
 * hop is permission-filtered before its neighbors become the next frontier.
 */
async function interceptedRecursiveNeighbors(
  index: SQLiteGraphIndex,
  query: Extract<GraphQuery, { kind: "recursive-neighbors" }>,
  roles: readonly PolicyRole[],
): Promise<Extract<GraphQueryResult, { kind: "recursive-neighbors" }>> {
  const visited = new Set([query.startNodeId]);
  let frontier = [query.startNodeId];
  const neighbors: MaterializedRecursiveNeighbor[] = [];
  let truncated = false;

  for (let depth = 1; depth <= query.maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const startNodeId of frontier) {
      const step = await interceptedEdgeNeighbors(
        index,
        {
          ...query,
          kind: "edge-neighbors",
          startNodeId,
          afterEdgeId: undefined,
          limit: 200,
        },
        roles,
      );
      for (const neighbor of step.neighbors) {
        if (visited.has(neighbor.node.nodeId)) continue;
        visited.add(neighbor.node.nodeId);
        next.push(neighbor.node.nodeId);
        neighbors.push({ ...neighbor, depth });
        if (neighbors.length === query.maxResults) {
          truncated = true;
          return { kind: "recursive-neighbors", neighbors, truncated };
        }
      }
    }
    frontier = next;
  }
  return { kind: "recursive-neighbors", neighbors, truncated };
}

/**
 * The single entry point every production graph query passes through
 * (A004-T01, A004-T02). Resolves `node-get`/`node-list` by filtering
 * `SQLiteGraphIndex.execute()`'s raw result; resolves `edge-neighbors` and
 * `recursive-neighbors` per the graph traversal rules above.
 */
export async function executeWithPermissions(
  index: SQLiteGraphIndex,
  query: GraphQuery,
  context: PermissionContext,
): Promise<GraphQueryResult> {
  /**
   * S3 (FDN-54). One role set, decided once, for the whole query.
   *
   * `recursive-neighbors` walks hop by hop with an `await` between every
   * hop, and `bestResolution` re-reads the role array on every fragment it
   * filters. So a role array MUTATED IN PLACE between hops changes how the
   * remaining hops are filtered, and the query returns a result no single
   * role set would ever have produced — hop 1 resolved as an Owner, hop 2
   * onward as a Team Member. `readonly PolicyRole[]` does not prevent this:
   * it stops THIS function mutating the caller's array, not the caller
   * mutating its own.
   *
   * That is reachable in principle and unreachable in practice today, and
   * the difference is an accident rather than a decision: both call sites
   * in `runtime.ts` build a fresh array per call via `deriveEffectiveRoles`,
   * and `SealedStore.refreshRoles` replaces `#roles` rather than mutating
   * it, so the array reaching this function is private to this call. The
   * one obvious optimization — caching the derived array instead of
   * rebuilding it per query — would silently make it reachable.
   *
   * Copying here makes the guarantee this function's own, so it holds
   * whatever a caller does. It is also the answer to S3's actual question:
   * a query is evaluated against the roles held when it STARTED. A role
   * change lands on the next query, never partway through one.
   */
  const roles: readonly PolicyRole[] = [...context.roles];

  switch (query.kind) {
    case "node-get": {
      const raw = await index.execute(query);
      if (raw.kind !== "node-get") throw new Error("Invalid node-get result");
      return {
        kind: "node-get",
        node: raw.node ? filterNode(raw.node, roles) : null,
      };
    }
    case "node-list": {
      const raw = await index.execute(query);
      if (raw.kind !== "node-list") throw new Error("Invalid node-list result");
      const nodes = raw.nodes
        .map((node) => filterNode(node, roles))
        .filter((node): node is MaterializedNode => node !== null);
      return { kind: "node-list", nodes, nextNodeId: raw.nextNodeId };
    }
    case "edge-neighbors":
      return interceptedEdgeNeighbors(index, query, roles);
    case "recursive-neighbors":
      return interceptedRecursiveNeighbors(index, query, roles);
  }
}

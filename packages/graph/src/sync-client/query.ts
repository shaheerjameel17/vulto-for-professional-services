import type { GraphQuery } from "../query";
import type { SqlValue, SyncDatabase } from "./database";

/**
 * The typed query layer over the device cache (VPS-A001 "Local graph query
 * layer"). `GraphQuery` is the same public type as before; it now runs against
 * `cache_nodes` and `cache_edges`, with recursive traversal as a recursive CTE.
 * Every read is local and never waits for the network. Which rows exist here is
 * decided by the server's sync audience, so no permission logic lives here.
 */
export interface CacheNode {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly lifecycleStatus: string;
  readonly isSoftDeleted: boolean;
  readonly version: number;
  readonly record: Record<string, unknown>;
}

export interface CacheEdge {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
}

export interface CacheNeighbor {
  readonly edge: CacheEdge;
  readonly node: CacheNode;
}

export type CacheQueryResult =
  | { readonly kind: "node-get"; readonly node: CacheNode | null }
  | {
      readonly kind: "node-list";
      readonly nodes: readonly CacheNode[];
      readonly nextNodeId: string | null;
    }
  | {
      readonly kind: "edge-neighbors";
      readonly neighbors: readonly CacheNeighbor[];
      readonly nextEdgeId: string | null;
    }
  | {
      readonly kind: "recursive-neighbors";
      readonly neighbors: readonly (CacheNeighbor & { readonly depth: number })[];
      readonly truncated: boolean;
    };

const nodeOf = (row: Record<string, SqlValue>, prefix = ""): CacheNode => ({
  nodeId: String(row[`${prefix}node_id`]),
  nodeType: String(row[`${prefix}node_type`]),
  lifecycleStatus: String(row[`${prefix}lifecycle_status`]),
  isSoftDeleted: row[`${prefix}is_soft_deleted`] === 1,
  version: Number(row[`${prefix}version`]),
  record: JSON.parse(String(row[`${prefix}record_json`])) as Record<string, unknown>,
});

const edgeOf = (row: Record<string, SqlValue>): CacheEdge => ({
  edgeId: String(row["edge_id"]),
  edgeType: String(row["edge_type"]),
  fromNodeId: String(row["from_node_id"]),
  toNodeId: String(row["to_node_id"]),
  effectiveFrom: (row["effective_from"] as string | null) ?? null,
  effectiveTo: (row["effective_to"] as string | null) ?? null,
});

/** The half-open interval test: `effective_from` inclusive, `effective_to` exclusive. */
const ACTIVE = `(e.effective_from IS NULL OR e.effective_from <= ?) AND (e.effective_to IS NULL OR e.effective_to > ?)`;

const NEIGHBOR_COLUMNS = `e.edge_id, e.edge_type, e.from_node_id, e.to_node_id, e.effective_from, e.effective_to,
  n.node_id AS n_node_id, n.node_type AS n_node_type, n.lifecycle_status AS n_lifecycle_status,
  n.is_soft_deleted AS n_is_soft_deleted, n.version AS n_version, n.record_json AS n_record_json`;

export async function runCacheQuery(
  database: SyncDatabase,
  query: GraphQuery,
): Promise<CacheQueryResult> {
  switch (query.kind) {
    case "node-get": {
      const [row] = await database.all(
        `SELECT * FROM cache_nodes WHERE node_id = ? AND node_type = ? ${query.includeSoftDeleted ? "" : "AND is_soft_deleted = 0"}`,
        [query.nodeId, query.nodeType],
      );
      return { kind: "node-get", node: row ? nodeOf(row) : null };
    }
    case "node-list": {
      const params: SqlValue[] = [query.nodeType];
      let where = "node_type = ?";
      if (query.lifecycleStatus !== undefined) {
        where += " AND lifecycle_status = ?";
        params.push(query.lifecycleStatus);
      }
      if (!query.includeSoftDeleted) where += " AND is_soft_deleted = 0";
      if (query.afterNodeId !== undefined) {
        where += " AND node_id > ?";
        params.push(query.afterNodeId);
      }
      const rows = await database.all(
        `SELECT * FROM cache_nodes WHERE ${where} ORDER BY node_id LIMIT ?`,
        [...params, query.limit + 1],
      );
      const page = rows.slice(0, query.limit).map((r) => nodeOf(r));
      return {
        kind: "node-list",
        nodes: page,
        nextNodeId: rows.length > query.limit ? (page.at(-1)?.nodeId ?? null) : null,
      };
    }
    case "edge-neighbors": {
      const outgoing = query.direction === "outgoing";
      const startColumn = outgoing ? "e.from_node_id" : "e.to_node_id";
      const neighborColumn = outgoing ? "e.to_node_id" : "e.from_node_id";
      const neighborType = outgoing ? query.toNodeType : query.fromNodeType;
      const params: SqlValue[] = [
        query.edgeType,
        query.startNodeId,
        neighborType,
        query.asOf,
        query.asOf,
      ];
      let where = `e.edge_type = ? AND ${startColumn} = ? AND n.node_type = ? AND ${ACTIVE}`;
      if (!query.includeSoftDeleted)
        where += " AND e.is_soft_deleted = 0 AND n.is_soft_deleted = 0";
      if (query.afterEdgeId !== undefined) {
        where += " AND e.edge_id > ?";
        params.push(query.afterEdgeId);
      }
      const rows = await database.all(
        `SELECT ${NEIGHBOR_COLUMNS} FROM cache_edges e JOIN cache_nodes n ON n.node_id = ${neighborColumn}
         WHERE ${where} ORDER BY e.edge_id LIMIT ?`,
        [...params, query.limit + 1],
      );
      const page = rows
        .slice(0, query.limit)
        .map((r) => ({ edge: edgeOf(r), node: nodeOf(r, "n_") }));
      return {
        kind: "edge-neighbors",
        neighbors: page,
        nextEdgeId:
          rows.length > query.limit ? (page.at(-1)?.edge.edgeId ?? null) : null,
      };
    }
    case "recursive-neighbors": {
      const outgoing = query.direction === "outgoing";
      const startColumn = outgoing ? "e.from_node_id" : "e.to_node_id";
      const neighborColumn = outgoing ? "e.to_node_id" : "e.from_node_id";
      const neighborType = outgoing ? query.toNodeType : query.fromNodeType;
      const soft = query.includeSoftDeleted
        ? ""
        : "AND e.is_soft_deleted = 0 AND n.is_soft_deleted = 0";
      const rows = await database.all(
        `WITH RECURSIVE walk(edge_id, node_id, depth, path) AS (
           SELECT e.edge_id, n.node_id, 1, ',' || ? || ',' || n.node_id || ','
           FROM cache_edges e JOIN cache_nodes n ON n.node_id = ${neighborColumn}
           WHERE e.edge_type = ? AND ${startColumn} = ? AND n.node_type = ? AND ${ACTIVE} ${soft}
           UNION ALL
           SELECT e.edge_id, n.node_id, w.depth + 1, w.path || n.node_id || ','
           FROM walk w JOIN cache_edges e ON ${startColumn} = w.node_id
           JOIN cache_nodes n ON n.node_id = ${neighborColumn}
           WHERE w.depth < ? AND e.edge_type = ? AND n.node_type = ? AND ${ACTIVE} ${soft}
             AND instr(w.path, ',' || n.node_id || ',') = 0
         )
         SELECT w.depth, ${NEIGHBOR_COLUMNS}
         FROM walk w JOIN cache_edges e ON e.edge_id = w.edge_id JOIN cache_nodes n ON n.node_id = w.node_id
         ORDER BY w.depth, e.edge_id LIMIT ?`,
        [
          query.startNodeId,
          query.edgeType,
          query.startNodeId,
          neighborType,
          query.asOf,
          query.asOf,
          query.maxDepth,
          query.edgeType,
          neighborType,
          query.asOf,
          query.asOf,
          query.maxResults + 1,
        ],
      );
      const kept = rows.slice(0, query.maxResults);
      return {
        kind: "recursive-neighbors",
        neighbors: kept.map((r) => ({
          edge: edgeOf(r),
          node: nodeOf(r, "n_"),
          depth: Number(r["depth"]),
        })),
        truncated: rows.length > query.maxResults,
      };
    }
  }
}

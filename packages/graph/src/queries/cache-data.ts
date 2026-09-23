import type { SqlValue, SyncDatabase } from "../sync-client/database";

export interface LocalNode {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly lifecycleStatus: string;
  readonly record: Record<string, unknown>;
}

export interface LocalEdge {
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
}

const nodeOf = (row: Record<string, SqlValue>): LocalNode => ({
  nodeId: String(row["node_id"]),
  nodeType: String(row["node_type"]),
  lifecycleStatus: String(row["lifecycle_status"]),
  record: JSON.parse(String(row["record_json"])) as Record<string, unknown>,
});

const edgeOf = (row: Record<string, SqlValue>): LocalEdge => ({
  edgeId: String(row["edge_id"]),
  edgeType: String(row["edge_type"]),
  fromNodeId: String(row["from_node_id"]),
  toNodeId: String(row["to_node_id"]),
  effectiveFrom: (row["effective_from"] as string | null) ?? null,
  effectiveTo: (row["effective_to"] as string | null) ?? null,
});

export async function localNodes(
  database: SyncDatabase,
  types: readonly string[],
): Promise<LocalNode[]> {
  if (types.length === 0) return [];
  const rows = await database.all(
    `SELECT * FROM cache_nodes WHERE is_soft_deleted = 0 AND node_type IN (${types.map(() => "?").join(",")}) ORDER BY node_id`,
    types,
  );
  return rows.map(nodeOf);
}

export async function localEdges(
  database: SyncDatabase,
  types: readonly string[],
): Promise<LocalEdge[]> {
  if (types.length === 0) return [];
  const rows = await database.all(
    `SELECT * FROM cache_edges WHERE is_soft_deleted = 0 AND edge_type IN (${types.map(() => "?").join(",")}) ORDER BY edge_id`,
    types,
  );
  return rows.map(edgeOf);
}

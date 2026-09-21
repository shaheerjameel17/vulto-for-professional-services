import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";

/**
 * The sync audience (VPS-A003 "Reads", F202): which person may hold which Tier 0
 * node or edge on a device. Identifiers only — never content. Written only by
 * the audience materializer, which evaluates the interceptor; replicated to
 * devices only as the subquery source of each person's two shapes.
 *
 * Keyed by workspace as well, because a `User` node's `node_id` repeats across
 * workspaces (F204).
 */
export const syncNodeAudience = pgTable(
  "sync_node_audience",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    nodeId: uuid("node_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.nodeId] }),
    index("sync_node_audience_node_idx").on(table.workspaceId, table.nodeId),
  ],
);

export const syncEdgeAudience = pgTable(
  "sync_edge_audience",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    edgeId: uuid("edge_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.edgeId] }),
    index("sync_edge_audience_edge_idx").on(table.workspaceId, table.edgeId),
  ],
);

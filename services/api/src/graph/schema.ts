import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * VPS-A003 "The canonical store" — the Tier 0 graph in PostgreSQL.
 *
 * Every row belongs to exactly one workspace (F204). A `User` is stored once
 * per workspace it belongs to, under the same `node_id`, which is why the node
 * key is `(workspace_id, node_id)` and why every other node type's `node_id`
 * is kept globally unique by a partial index.
 *
 * Two constraints Drizzle cannot express — the `btree_gist` extension and the
 * `managed_by` / `scoped_to_entity` exclusion constraint — are appended by
 * hand to the migration that creates these tables.
 *
 * There is deliberately no foreign key to the Better Auth tables. Consistency
 * with them is enforced in code, in the same transaction.
 */
export const graphNodes = pgTable(
  "graph_nodes",
  {
    nodeId: uuid("node_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    nodeType: text("node_type").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    isSoftDeleted: boolean("is_soft_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
    softDeletedAt: timestamp("soft_deleted_at", { withTimezone: true }),
    softDeletedBy: uuid("soft_deleted_by"),
    record: jsonb("record").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.nodeId] }),
    check(
      "graph_nodes_record_node_id_check",
      sql`${table.record}->>'node_id' = ${table.nodeId}::text`,
    ),
    check(
      "graph_nodes_record_lifecycle_check",
      sql`${table.record}->>'lifecycle_status' = ${table.lifecycleStatus}`,
    ),
    check(
      "graph_nodes_workspace_self_check",
      sql`${table.nodeType} <> 'Workspace' or ${table.workspaceId} = ${table.nodeId}`,
    ),
    index("graph_nodes_workspace_type_lifecycle_idx")
      .on(table.workspaceId, table.nodeType, table.lifecycleStatus)
      .where(sql`not ${table.isSoftDeleted}`),
    uniqueIndex("graph_nodes_node_id_non_user_uidx")
      .on(table.nodeId)
      .where(sql`${table.nodeType} <> 'User'`),
  ],
);

export const graphEdges = pgTable(
  "graph_edges",
  {
    edgeId: uuid("edge_id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    edgeType: text("edge_type").notNull(),
    fromNodeId: uuid("from_node_id").notNull(),
    toNodeId: uuid("to_node_id").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    isSoftDeleted: boolean("is_soft_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    updatedBy: uuid("updated_by"),
    softDeletedAt: timestamp("soft_deleted_at", { withTimezone: true }),
    softDeletedBy: uuid("soft_deleted_by"),
    record: jsonb("record").notNull(),
  },
  (table) => [
    // An edge can never join two workspaces: both endpoints are looked up by
    // the edge's own workspace.
    foreignKey({
      name: "graph_edges_from_node_fk",
      columns: [table.workspaceId, table.fromNodeId],
      foreignColumns: [graphNodes.workspaceId, graphNodes.nodeId],
    }),
    foreignKey({
      name: "graph_edges_to_node_fk",
      columns: [table.workspaceId, table.toNodeId],
      foreignColumns: [graphNodes.workspaceId, graphNodes.nodeId],
    }),
    check(
      "graph_edges_record_edge_id_check",
      sql`${table.record}->>'edge_id' = ${table.edgeId}::text`,
    ),
    index("graph_edges_from_idx").on(
      table.workspaceId,
      table.edgeType,
      table.fromNodeId,
      table.effectiveFrom,
      table.effectiveTo,
    ),
    index("graph_edges_to_idx").on(
      table.workspaceId,
      table.edgeType,
      table.toNodeId,
      table.effectiveFrom,
      table.effectiveTo,
    ),
    uniqueIndex("graph_edges_single_active_outgoing_uidx")
      .on(table.edgeType, table.fromNodeId)
      .where(
        sql`${table.effectiveTo} is null and not ${table.isSoftDeleted} and ${table.edgeType} in ('managed_by','scoped_to_entity')`,
      ),
  ],
);

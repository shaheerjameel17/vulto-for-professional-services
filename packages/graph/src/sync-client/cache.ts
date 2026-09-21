import type { CachedEdge, CachedNode, OptimisticCache } from "../mutators/cache";
import type { SqlValue, SyncDatabase } from "./database";

/** The two shape templates a device subscribes to, and nothing else (A003-T72). */
export type ShapeTemplateName = "nodes" | "edges";

export interface RowChange {
  readonly operation: "insert" | "update" | "delete";
  /** For an update, only the changed columns and the key. */
  readonly value: Readonly<Record<string, unknown>>;
  /** The reasons this row is in the shape, added by this change. */
  readonly tags?: readonly string[];
  readonly removedTags?: readonly string[];
}

/** The rows admitted only by these audience entries have left the person's audience. */
export interface MoveOut {
  readonly operation: "move-out";
  readonly patterns: readonly { readonly pos: number; readonly value: string }[];
}

export type ShapeChange = RowChange | MoveOut;

export interface ShapeCursor {
  readonly handle: string | null;
  readonly offset: string | null;
}

/** A timestamp as an ISO-8601 UTC string, whatever shape the replication client produced. */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(
      value.includes("T")
        ? value
        : value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
    );
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

const toNumber = (value: unknown): number => Number(value ?? 0);
const toFlag = (value: unknown): number =>
  value === true || value === 1 || value === "t" ? 1 : 0;
const toJson = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value ?? {});

const rowToNode = (row: Record<string, SqlValue>): CachedNode => ({
  nodeId: String(row["node_id"]),
  nodeType: String(row["node_type"]),
  lifecycleStatus: String(row["lifecycle_status"]),
  isSoftDeleted: row["is_soft_deleted"] === 1,
  version: Number(row["version"]),
  record: JSON.parse(String(row["record_json"])) as Record<string, unknown>,
});

const rowToEdge = (row: Record<string, SqlValue>): CachedEdge => ({
  edgeId: String(row["edge_id"]),
  edgeType: String(row["edge_type"]),
  fromNodeId: String(row["from_node_id"]),
  toNodeId: String(row["to_node_id"]),
  effectiveFrom: (row["effective_from"] as string | null) ?? null,
  effectiveTo: (row["effective_to"] as string | null) ?? null,
  isSoftDeleted: row["is_soft_deleted"] === 1,
  version: Number(row["version"]),
  record: JSON.parse(String(row["record_json"])) as Record<string, unknown>,
});

/**
 * The device cache: what the optimistic mutators write to and the query layer
 * reads from. Tier 0 only.
 */
export class SqliteCache implements OptimisticCache {
  constructor(readonly database: SyncDatabase) {}

  async getNode(nodeId: string) {
    const [row] = await this.database.all(
      "SELECT * FROM cache_nodes WHERE node_id = ?",
      [nodeId],
    );
    return row ? rowToNode(row) : undefined;
  }

  async putNode(node: CachedNode) {
    await this.database.run(
      `INSERT INTO cache_nodes (node_id, node_type, lifecycle_status, is_soft_deleted, version, record_json)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (node_id) DO UPDATE SET node_type = excluded.node_type,
         lifecycle_status = excluded.lifecycle_status, is_soft_deleted = excluded.is_soft_deleted,
         version = excluded.version, record_json = excluded.record_json`,
      [
        node.nodeId,
        node.nodeType,
        node.lifecycleStatus,
        node.isSoftDeleted ? 1 : 0,
        node.version,
        JSON.stringify(node.record),
      ],
    );
  }

  async deleteNode(nodeId: string) {
    await this.database.run("DELETE FROM cache_nodes WHERE node_id = ?", [nodeId]);
  }

  async getEdge(edgeId: string) {
    const [row] = await this.database.all(
      "SELECT * FROM cache_edges WHERE edge_id = ?",
      [edgeId],
    );
    return row ? rowToEdge(row) : undefined;
  }

  async putEdge(edge: CachedEdge) {
    await this.database.run(
      `INSERT INTO cache_edges (edge_id, edge_type, from_node_id, to_node_id, effective_from, effective_to, is_soft_deleted, version, record_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (edge_id) DO UPDATE SET edge_type = excluded.edge_type, from_node_id = excluded.from_node_id,
         to_node_id = excluded.to_node_id, effective_from = excluded.effective_from,
         effective_to = excluded.effective_to, is_soft_deleted = excluded.is_soft_deleted,
         version = excluded.version, record_json = excluded.record_json`,
      [
        edge.edgeId,
        edge.edgeType,
        edge.fromNodeId,
        edge.toNodeId,
        edge.effectiveFrom,
        edge.effectiveTo,
        edge.isSoftDeleted ? 1 : 0,
        edge.version,
        JSON.stringify(edge.record),
      ],
    );
  }

  async deleteEdge(edgeId: string) {
    await this.database.run("DELETE FROM cache_edges WHERE edge_id = ?", [edgeId]);
  }

  async edgesFrom(nodeId: string, edgeType: string) {
    const rows = await this.database.all(
      "SELECT * FROM cache_edges WHERE from_node_id = ? AND edge_type = ? ORDER BY effective_from, edge_id",
      [nodeId, edgeType],
    );
    return rows.map(rowToEdge);
  }

  // ── Replication ───────────────────────────────────────────────────────────

  async readCursor(template: ShapeTemplateName): Promise<ShapeCursor> {
    const [row] = await this.database.all(
      'SELECT handle, "offset" AS offset FROM sync_cursor WHERE template = ?',
      [template],
    );
    return {
      handle: (row?.["handle"] as string | null) ?? null,
      offset: (row?.["offset"] as string | null) ?? null,
    };
  }

  /**
   * Applies one batch of shape changes and stores the cursor in the same
   * transaction, so a crash can never leave rows applied with a stale cursor
   * or the reverse.
   */
  async applyBatch(
    template: ShapeTemplateName,
    changes: readonly ShapeChange[],
    cursor: ShapeCursor,
  ): Promise<void> {
    await this.database.transaction(async () => {
      for (const change of changes) {
        if (change.operation === "move-out") {
          await this.#applyMoveOut(template, change);
          continue;
        }
        if (template === "nodes") await this.#applyNode(change);
        else await this.#applyEdge(change);
        await this.#applyTags(template, change);
      }
      await this.database.run(
        `INSERT INTO sync_cursor (template, handle, "offset") VALUES (?, ?, ?)
         ON CONFLICT (template) DO UPDATE SET handle = excluded.handle, "offset" = excluded."offset"`,
        [template, cursor.handle, cursor.offset],
      );
    });
  }

  /** The server said the shape is gone: drop what it delivered and start over. */
  async resetTemplate(template: ShapeTemplateName): Promise<void> {
    await this.database.transaction(async () => {
      await this.database.run(
        template === "nodes" ? "DELETE FROM cache_nodes" : "DELETE FROM cache_edges",
      );
      await this.database.run("DELETE FROM cache_tags WHERE template = ?", [template]);
      await this.database.run("DELETE FROM sync_cursor WHERE template = ?", [template]);
    });
  }

  async #applyTags(template: ShapeTemplateName, change: RowChange): Promise<void> {
    const id = String(
      template === "nodes" ? change.value["node_id"] : change.value["edge_id"],
    );
    if (change.operation === "delete") {
      await this.database.run(
        "DELETE FROM cache_tags WHERE template = ? AND row_id = ?",
        [template, id],
      );
      return;
    }
    for (const tag of change.removedTags ?? []) {
      await this.database.run(
        "DELETE FROM cache_tags WHERE template = ? AND row_id = ? AND tag = ?",
        [template, id, tag],
      );
    }
    for (const tag of change.tags ?? []) {
      await this.database.run(
        "INSERT OR IGNORE INTO cache_tags (template, row_id, tag) VALUES (?, ?, ?)",
        [template, id, tag],
      );
    }
  }

  /**
   * Removes the named tags, then every row left with none. A tag is `<pos>/<hash>`
   * for this shape, whose one subquery is the audience.
   */
  async #applyMoveOut(template: ShapeTemplateName, change: MoveOut): Promise<void> {
    for (const pattern of change.patterns) {
      const tag = `${pattern.pos}/${pattern.value}`;
      const rows = await this.database.all(
        "SELECT row_id FROM cache_tags WHERE template = ? AND tag = ?",
        [template, tag],
      );
      await this.database.run("DELETE FROM cache_tags WHERE template = ? AND tag = ?", [
        template,
        tag,
      ]);
      for (const { row_id } of rows) {
        if (row_id === undefined) continue;
        const remaining = await this.database.all(
          "SELECT 1 AS one FROM cache_tags WHERE template = ? AND row_id = ? LIMIT 1",
          [template, row_id],
        );
        if (remaining.length > 0) continue;
        if (template === "nodes") await this.deleteNode(String(row_id));
        else await this.deleteEdge(String(row_id));
      }
    }
  }

  async #applyNode(change: RowChange) {
    const value = change.value;
    const id = String(value["node_id"]);
    if (change.operation === "delete") {
      await this.deleteNode(id);
      return;
    }
    const existing = change.operation === "update" ? await this.getNode(id) : undefined;
    const record =
      "record" in value
        ? typeof value["record"] === "string"
          ? JSON.parse(value["record"] as string)
          : value["record"]
        : (existing?.record ?? {});
    await this.putNode({
      nodeId: id,
      nodeType: String(value["node_type"] ?? existing?.nodeType),
      lifecycleStatus: String(value["lifecycle_status"] ?? existing?.lifecycleStatus),
      isSoftDeleted:
        "is_soft_deleted" in value
          ? toFlag(value["is_soft_deleted"]) === 1
          : (existing?.isSoftDeleted ?? false),
      version:
        "version" in value ? toNumber(value["version"]) : (existing?.version ?? 1),
      record: record as Record<string, unknown>,
    });
  }

  async #applyEdge(change: RowChange) {
    const value = change.value;
    const id = String(value["edge_id"]);
    if (change.operation === "delete") {
      await this.deleteEdge(id);
      return;
    }
    const existing = change.operation === "update" ? await this.getEdge(id) : undefined;
    const record =
      "record" in value
        ? typeof value["record"] === "string"
          ? JSON.parse(value["record"] as string)
          : value["record"]
        : (existing?.record ?? {});
    await this.putEdge({
      edgeId: id,
      edgeType: String(value["edge_type"] ?? existing?.edgeType),
      fromNodeId: String(value["from_node_id"] ?? existing?.fromNodeId),
      toNodeId: String(value["to_node_id"] ?? existing?.toNodeId),
      effectiveFrom:
        "effective_from" in value
          ? toIso(value["effective_from"])
          : (existing?.effectiveFrom ?? null),
      effectiveTo:
        "effective_to" in value
          ? toIso(value["effective_to"])
          : (existing?.effectiveTo ?? null),
      isSoftDeleted:
        "is_soft_deleted" in value
          ? toFlag(value["is_soft_deleted"]) === 1
          : (existing?.isSoftDeleted ?? false),
      version:
        "version" in value ? toNumber(value["version"]) : (existing?.version ?? 1),
      record: record as Record<string, unknown>,
    });
  }
}

export { toJson };

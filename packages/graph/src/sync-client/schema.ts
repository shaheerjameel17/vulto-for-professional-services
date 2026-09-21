/**
 * The device cache schema (VPS-A003 "Reads", VPS-A001 "Local graph query
 * layer"). Tier 0 only: the two replicated shapes carry nothing else, and a
 * Tier 1 or Tier 2 value is never written here — it lives in worker memory
 * (`protected-store.ts`). `session_hint` holds identifiers, never a token.
 */
export const CACHE_SCHEMA_VERSION = 1;

export const CREATE_CACHE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS cache_nodes (
    node_id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL,
    is_soft_deleted INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cache_nodes_by_type
    ON cache_nodes (node_type, lifecycle_status, is_soft_deleted, node_id);

  CREATE TABLE IF NOT EXISTS cache_edges (
    edge_id TEXT PRIMARY KEY,
    edge_type TEXT NOT NULL,
    from_node_id TEXT NOT NULL,
    to_node_id TEXT NOT NULL,
    effective_from TEXT,
    effective_to TEXT,
    is_soft_deleted INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cache_edges_outgoing
    ON cache_edges (edge_type, from_node_id, effective_from, effective_to, edge_id);
  CREATE INDEX IF NOT EXISTS cache_edges_incoming
    ON cache_edges (edge_type, to_node_id, effective_from, effective_to, edge_id);

  -- Why each row is in the shape: Electric tags a row with the audience entry that
  -- admits it, and a move-out names the tags that no longer apply. A row with no
  -- tag left is deleted. Identifiers only.
  CREATE TABLE IF NOT EXISTS cache_tags (
    template TEXT NOT NULL,
    row_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (template, row_id, tag)
  );
  CREATE INDEX IF NOT EXISTS cache_tags_by_tag ON cache_tags (template, tag);

  CREATE TABLE IF NOT EXISTS sync_cursor (
    template TEXT PRIMARY KEY,
    handle TEXT,
    "offset" TEXT
  );

  CREATE TABLE IF NOT EXISTS outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    mutation_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    args_json TEXT NOT NULL,
    undo_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'inflight', 'rejected')),
    reason TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session_hint (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL
  );
`;

export const CACHE_TABLES = [
  "cache_nodes",
  "cache_edges",
  "cache_tags",
  "sync_cursor",
  "outbox",
  "session_hint",
] as const;

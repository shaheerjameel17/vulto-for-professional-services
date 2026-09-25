import { SEARCHABLE_NODE_TYPES } from "@vulto/schema";

/**
 * The device cache schema (VPS-A003 "Reads", VPS-A001 "Local graph query
 * layer"). Tier 0 only: the two replicated shapes carry nothing else, and a
 * Tier 1 or Tier 2 value is never written here — it lives in worker memory
 * (`protected-store.ts`). `session_hint` holds identifiers, never a token.
 */
/**
 * Bumped whenever a replicated table changes. A database at any other version (or
 * a pre-versioning one) has only its replicated tables dropped and refilled by
 * resync: they are disposable, replicated from the server. The outbox is not
 * touched (see `OUTBOX_SCHEMA_VERSION`). 2: `cache_tags` added (F211).
 * 3: trigger-maintained `cache_search` added (VPS-F002).
 */
export const CACHE_SCHEMA_VERSION = 3;

const textValue = (field: string): string => {
  const path = `$.${field}`;
  return `CASE WHEN json_type(NEW.record_json, '${path}') = 'text'
    AND json_extract(NEW.record_json, '${path}') <> ''
    THEN json_extract(NEW.record_json, '${path}') END`;
};

const triggerInsertions = SEARCHABLE_NODE_TYPES.map((registration) => {
  const label =
    registration.labelFields.length === 1
      ? textValue(registration.labelFields[0]!)
      : `coalesce(${registration.labelFields.map(textValue).join(", ")})`;
  let joined = "''";
  for (const field of registration.indexedFields) {
    const value = textValue(field);
    joined = `(${joined} || CASE WHEN ${value} IS NULL THEN ''
      ELSE CASE WHEN ${joined} = '' THEN '' ELSE ' ' END || ${value} END)`;
  }
  return `INSERT INTO cache_search (node_id, node_type, label, lifecycle_status, search_text)
    SELECT NEW.node_id, NEW.node_type, ${label}, NEW.lifecycle_status, lower(${joined})
    WHERE NEW.node_type = '${registration.nodeType}' AND NEW.is_soft_deleted = 0
      AND ${label} IS NOT NULL;`;
}).join("\n");

/** Generated only from the validated, Tier 0 registry; no runtime values enter SQL. */
const SEARCH_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS cache_search_after_insert AFTER INSERT ON cache_nodes BEGIN
    DELETE FROM cache_search WHERE node_id = NEW.node_id;
    ${triggerInsertions}
  END;
  CREATE TRIGGER IF NOT EXISTS cache_search_after_update AFTER UPDATE ON cache_nodes BEGIN
    DELETE FROM cache_search WHERE node_id = NEW.node_id;
    ${triggerInsertions}
  END;
  CREATE TRIGGER IF NOT EXISTS cache_search_after_delete AFTER DELETE ON cache_nodes BEGIN
    DELETE FROM cache_search WHERE node_id = OLD.node_id;
  END;
`;

/**
 * The outbox is the person's own queued work, not a copy of anything on the
 * server, so it is versioned separately from the replicated tables and is never
 * dropped by a cache version change. A change to its shape needs an explicit
 * migration in `OUTBOX_MIGRATIONS`; there is no fallback that wipes it.
 */
export const OUTBOX_SCHEMA_VERSION = 1;

/** `OUTBOX_MIGRATIONS[n]` migrates an outbox at version n to n + 1. */
export const OUTBOX_MIGRATIONS: Readonly<
  Record<number, (exec: (sql: string) => Promise<void>) => Promise<void>>
> = {};

/** The replicated tables: dropped and refilled by resync whenever the cache version changes. */
export const CREATE_REPLICATED_SCHEMA = `
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

  CREATE TABLE IF NOT EXISTS cache_search (
    node_id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    label TEXT NOT NULL,
    lifecycle_status TEXT NOT NULL,
    search_text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cache_search_by_type ON cache_search (node_type);
  ${SEARCH_TRIGGERS}

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
`;

/** The person's own state: kept across cache version changes, erased only by sign-out or revocation. */
export const CREATE_LOCAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
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

export const CREATE_CACHE_SCHEMA = CREATE_REPLICATED_SCHEMA + CREATE_LOCAL_SCHEMA;

export const REPLICATED_TABLES = [
  "cache_nodes",
  "cache_search",
  "cache_edges",
  "cache_tags",
  "sync_cursor",
] as const;

export const CACHE_TABLES = [
  ...REPLICATED_TABLES,
  "schema_meta",
  "outbox",
  "session_hint",
] as const;

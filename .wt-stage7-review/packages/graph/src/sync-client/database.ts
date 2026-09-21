import * as SQLite from "wa-sqlite";
import SQLiteAsyncESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import { IDBBatchAtomicVFS } from "wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import { MemoryVFS } from "wa-sqlite/src/examples/MemoryVFS.js";
import {
  CACHE_SCHEMA_VERSION,
  CREATE_CACHE_SCHEMA,
  OUTBOX_MIGRATIONS,
  OUTBOX_SCHEMA_VERSION,
  REPLICATED_TABLES,
} from "./schema";

/**
 * The cache database as the sync client sees it: SQL in, rows out. The real one
 * is wa-sqlite; tests use the same class over an in-memory VFS.
 */
export type SqlValue = string | number | null;

export interface SyncDatabase {
  all(sql: string, params?: readonly SqlValue[]): Promise<Record<string, SqlValue>[]>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Runs several statements with no parameters. */
  exec(sql: string): Promise<void>;
  /** Runs `work` in one transaction: all of it, or none of it. */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export type DatabaseLocation =
  { readonly kind: "memory" } | { readonly kind: "idb"; readonly name: string };

type Sqlite = ReturnType<typeof SQLite.Factory>;

/** The name of a person's cache in a workspace: one database per `(workspace, user)`. */
export const cacheDatabaseName = (workspaceId: string, userId: string): string =>
  `vulto:${workspaceId}:${userId}`;

/**
 * Statements run directly. The async wa-sqlite build allows one call at a time,
 * so the sync engine serializes every use of the database with one mutex; this
 * class deliberately does not try to.
 */
class WaSqliteDatabase implements SyncDatabase {
  readonly #sqlite: Sqlite;
  readonly #handle: number;
  readonly #vfs: { close?(): Promise<void> } | null;

  constructor(sqlite: Sqlite, handle: number, vfs: { close?(): Promise<void> } | null) {
    this.#sqlite = sqlite;
    this.#handle = handle;
    this.#vfs = vfs;
  }

  async all(sql: string, params: readonly SqlValue[] = []) {
    const result = await this.#sqlite.execWithParams(this.#handle, sql, [...params]);
    return result.rows.map((row) =>
      Object.fromEntries(
        result.columns.map((column, i) => [column, row[i] as SqlValue]),
      ),
    );
  }

  async run(sql: string, params: readonly SqlValue[] = []) {
    await this.all(sql, params);
  }

  async exec(sql: string) {
    await this.#sqlite.exec(this.#handle, sql);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.#sqlite.exec(this.#handle, "BEGIN IMMEDIATE");
    try {
      const value = await work();
      await this.#sqlite.exec(this.#handle, "COMMIT");
      return value;
    } catch (error) {
      await this.#sqlite.exec(this.#handle, "ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  async close() {
    await this.#sqlite.close(this.#handle);
    await this.#vfs?.close?.();
  }
}

/** Stops the client rather than guess: an outbox at a version this build cannot migrate is never wiped. */
export class OutboxVersionError extends Error {
  constructor(found: number) {
    super(
      `The outbox is at version ${found}; this build has no migration to ${OUTBOX_SCHEMA_VERSION}`,
    );
    this.name = "OutboxVersionError";
  }
}

/** Every version below the current one must have a migration; a test enforces it at build time. */
export function missingOutboxMigrations(
  current: number = OUTBOX_SCHEMA_VERSION,
  migrations: Readonly<Record<number, unknown>> = OUTBOX_MIGRATIONS,
): number[] {
  const missing: number[] = [];
  for (let from = 1; from < current; from += 1)
    if (!(from in migrations)) missing.push(from);
  return missing;
}

/**
 * Brings the schema to the current versions.
 *
 * - Replicated tables: a database at another cache version, or with tables and
 *   no version (from before versioning), has only `cache_nodes`, `cache_edges`,
 *   `cache_tags` and `sync_cursor` dropped, and replication refills them.
 * - Outbox: never dropped. An older version is migrated by the explicit
 *   migrations; a newer or unmigratable one throws `OutboxVersionError`.
 *
 * Returns true when the replicated tables had to start over.
 */
export async function prepareCacheSchema(
  database: SyncDatabase,
  migrations: Readonly<
    Record<number, (exec: (sql: string) => Promise<void>) => Promise<void>>
  > = OUTBOX_MIGRATIONS,
  outboxVersion: number = OUTBOX_SCHEMA_VERSION,
): Promise<boolean> {
  const [{ user_version: version } = { user_version: 0 }] =
    await database.all("PRAGMA user_version");
  const existing = await database.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  const stale =
    version !== CACHE_SCHEMA_VERSION && (Number(version) !== 0 || existing.length > 0);
  if (stale) {
    for (const table of REPLICATED_TABLES) {
      await database.run(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
  await database.exec(CREATE_CACHE_SCHEMA);
  await database.run(`PRAGMA user_version = ${CACHE_SCHEMA_VERSION}`);

  // An outbox with no recorded version is version 1 (the shape before versioning).
  const [row] = await database.all(
    "SELECT value FROM schema_meta WHERE key = 'outbox_version'",
  );
  let found = row ? Number(row["value"]) : 1;
  if (found > outboxVersion) throw new OutboxVersionError(found);
  while (found < outboxVersion) {
    const migrate = migrations[found];
    if (!migrate) throw new OutboxVersionError(found);
    await database.transaction(async () => {
      await migrate((sql) => database.exec(sql));
    });
    found += 1;
  }
  await database.run(
    "INSERT INTO schema_meta (key, value) VALUES ('outbox_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    [outboxVersion],
  );
  return stale;
}

let vfsCounter = 0;

/** Opens (creating if needed) the cache database and its schema. */
export async function openSyncDatabase(
  location: DatabaseLocation,
  options: { readonly wasmBinary?: Uint8Array } = {},
): Promise<SyncDatabase> {
  // The async build is web-only; outside a browser (tests) the caller supplies the bytes.
  const factory = SQLiteAsyncESMFactory as (
    config?: Record<string, unknown>,
  ) => Promise<unknown>;
  const module = await factory(
    options.wasmBinary ? { wasmBinary: options.wasmBinary } : undefined,
  );
  const sqlite = SQLite.Factory(module as never);
  let handle: number;
  let vfs: { name: string; close?(): Promise<void> };
  if (location.kind === "idb") {
    // Batch-atomic IndexedDB storage, safe across the tabs of one origin.
    vfs = new IDBBatchAtomicVFS(location.name) as never;
    sqlite.vfs_register(vfs as never, false);
    // The file name inside the VFS is fixed; the IndexedDB database carries the identity.
    handle = await sqlite.open_v2("cache.db", undefined, vfs.name);
  } else {
    vfs = new MemoryVFS() as never;
    const name = `memory-${(vfsCounter += 1)}`;
    (vfs as { name: string }).name = name;
    sqlite.vfs_register(vfs as never, false);
    handle = await sqlite.open_v2(name, undefined, name);
  }
  const database = new WaSqliteDatabase(sqlite, handle, vfs);
  await prepareCacheSchema(database);
  return database;
}

/**
 * Deletes a cache database. Resolves only once it is gone. An error is a
 * failure; a blocked delete (another connection still open) is waited out, and
 * fails if it has not completed within `timeoutMs`.
 */
export async function deleteIdbDatabase(
  name: string,
  timeoutMs = 10_000,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Deleting ${name} did not finish`)),
      timeoutMs,
    );
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error(`Deleting ${name} failed`));
    };
    // onblocked: other connections are closing (they were told to); wait for success.
  });
}

/** The names of the origin's IndexedDB databases, or `null` where the browser cannot list them. */
export async function listIdbDatabases(): Promise<string[] | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function")
    return null;
  const infos = await indexedDB.databases();
  return infos.flatMap((info) => (info.name ? [info.name] : []));
}

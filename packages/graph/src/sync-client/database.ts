import * as SQLite from "wa-sqlite";
import SQLiteAsyncESMFactory from "wa-sqlite/dist/wa-sqlite-async.mjs";
import { IDBBatchAtomicVFS } from "wa-sqlite/src/examples/IDBBatchAtomicVFS.js";
import { MemoryVFS } from "wa-sqlite/src/examples/MemoryVFS.js";
import { CREATE_CACHE_SCHEMA } from "./schema";

/**
 * The cache database as the sync client sees it: SQL in, rows out. The real one
 * is wa-sqlite; tests use the same class over an in-memory VFS.
 */
export type SqlValue = string | number | null;

export interface SyncDatabase {
  all(sql: string, params?: readonly SqlValue[]): Promise<Record<string, SqlValue>[]>;
  run(sql: string, params?: readonly SqlValue[]): Promise<void>;
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
  await sqlite.exec(handle, CREATE_CACHE_SCHEMA);
  return database;
}

/** Deletes a person's cache database outright (sign-out, revocation). */
export async function deleteIdbDatabase(name: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

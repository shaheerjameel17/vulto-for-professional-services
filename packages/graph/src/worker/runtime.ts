import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import * as SQLite from "wa-sqlite";
import SQLiteESMFactory from "wa-sqlite/dist/wa-sqlite.mjs";
import type { GraphAvailability } from "../protocol";

/**
 * FDN-77 scaffolding only. This table proves that SQLite-WASM materialization
 * happens in the Worker. FDN-48 replaces it with the durable graph read model.
 */
const CREATE_PROBE_TABLE = `
  CREATE TABLE fdn77_materialization_probe (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    byte_length INTEGER NOT NULL
  )
`;

export interface RuntimeDeltaBatchResult {
  mergedDeltaCount: number;
  materializedProbeRows: number;
  workerDurationMs: number;
}

export class LocalGraphWorkerRuntime {
  #availability: GraphAvailability = { state: "mid-sync" };
  #database: number | null = null;
  #document: LoroDoc | null = null;
  #sqlite: ReturnType<typeof SQLite.Factory> | null = null;
  #workspaceId: string | null = null;

  get availability(): GraphAvailability {
    return this.#availability;
  }

  get workspaceId(): string | null {
    return this.#workspaceId;
  }

  async initialize(workspaceId: string): Promise<void> {
    if (this.#workspaceId !== null) {
      throw new Error("The Worker is already bound to a workspace");
    }
    this.#availability = { state: "mid-sync" };

    await initializeLoro();
    const module = await SQLiteESMFactory();
    this.#sqlite = SQLite.Factory(module);
    this.#database = await this.#sqlite.open_v2(":memory:");
    await this.#sqlite.exec(this.#database, CREATE_PROBE_TABLE);
    this.#document = new LoroDoc();
    this.#workspaceId = workspaceId;
    this.#availability = { state: "ready" };
  }

  async applyDeltaBatch(
    deltas: readonly ArrayBuffer[],
  ): Promise<RuntimeDeltaBatchResult> {
    const sqlite = this.#requireSqlite();
    const database = this.#requireDatabase();
    const document = this.#requireDocument();
    this.#availability = { state: "mid-sync" };
    const startedAt = performance.now();

    await sqlite.exec(database, "BEGIN IMMEDIATE");
    try {
      for (const delta of deltas) {
        document.import(new Uint8Array(delta));
        await sqlite.execWithParams(
          database,
          "INSERT INTO fdn77_materialization_probe (byte_length) VALUES (?)",
          [delta.byteLength],
        );
      }
      await sqlite.exec(database, "COMMIT");
    } catch (error) {
      await sqlite.exec(database, "ROLLBACK");
      throw error;
    }

    const count = await sqlite.execWithParams(
      database,
      "SELECT COUNT(*) FROM fdn77_materialization_probe",
    );
    const materializedProbeRows = Number(count.rows[0]?.[0] ?? 0);
    this.#availability = { state: "ready" };

    return {
      mergedDeltaCount: deltas.length,
      materializedProbeRows,
      workerDurationMs: performance.now() - startedAt,
    };
  }

  async dispose(): Promise<void> {
    if (this.#sqlite !== null && this.#database !== null) {
      await this.#sqlite.close(this.#database);
    }
    this.#database = null;
    this.#document?.free();
    this.#document = null;
    this.#sqlite = null;
    this.#workspaceId = null;
    this.#availability = { state: "mid-sync" };
  }

  #requireSqlite(): ReturnType<typeof SQLite.Factory> {
    if (this.#sqlite === null) throw new Error("Worker is not initialized");
    return this.#sqlite;
  }

  #requireDatabase(): number {
    if (this.#database === null) throw new Error("Worker is not initialized");
    return this.#database;
  }

  #requireDocument(): LoroDoc {
    if (this.#document === null) throw new Error("Worker is not initialized");
    return this.#document;
  }
}

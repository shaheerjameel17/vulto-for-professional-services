import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import type { GraphAvailability } from "../protocol";
import { SQLiteGraphIndex } from "./storage/sqlite-graph-index";

export interface RuntimeDeltaBatchResult {
  mergedDeltaCount: number;
  materializationGeneration: number;
  workerDurationMs: number;
}

export class LocalGraphWorkerRuntime {
  #availability: GraphAvailability = { state: "mid-sync" };
  #document: LoroDoc | null = null;
  #index: SQLiteGraphIndex | null = null;
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
    this.#index = new SQLiteGraphIndex(workspaceId);
    await this.#index.initialize();
    this.#document = new LoroDoc();
    this.#workspaceId = workspaceId;
    this.#availability = { state: "ready" };
  }

  async applyDeltaBatch(
    deltas: readonly ArrayBuffer[],
  ): Promise<RuntimeDeltaBatchResult> {
    const document = this.#requireDocument();
    const index = this.#requireIndex();
    this.#availability = { state: "mid-sync" };
    const startedAt = performance.now();

    for (const delta of deltas) {
      document.import(new Uint8Array(delta));
    }
    this.#availability = { state: "ready" };

    return {
      mergedDeltaCount: deltas.length,
      materializationGeneration: await index.generation,
      workerDurationMs: performance.now() - startedAt,
    };
  }

  async dispose(): Promise<void> {
    await this.#index?.dispose();
    this.#index = null;
    this.#document?.free();
    this.#document = null;
    this.#workspaceId = null;
    this.#availability = { state: "mid-sync" };
  }

  #requireIndex(): SQLiteGraphIndex {
    if (this.#index === null) throw new Error("Worker is not initialized");
    return this.#index;
  }

  #requireDocument(): LoroDoc {
    if (this.#document === null) throw new Error("Worker is not initialized");
    return this.#document;
  }
}

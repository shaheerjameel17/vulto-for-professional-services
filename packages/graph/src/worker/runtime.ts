import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import type { GraphAvailability } from "../protocol";
import { SealedStore, SealedStoreLockedError } from "./storage/sealed-store";
import { SQLiteGraphIndex } from "./storage/sqlite-graph-index";
import { graphSnapshotStoreKey } from "./storage/storage-keys";

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
  /**
   * Every new Worker instance starts with a fresh, locked SealedStore.
   * There is no mechanism anywhere in this class that carries an unlocked
   * state from a prior instance — a cold restart, browser restart, or a
   * plain tab reload always requires unlockSealedStore() again.
   */
  #sealedStore = new SealedStore();

  get availability(): GraphAvailability {
    return this.#availability;
  }

  get workspaceId(): string | null {
    return this.#workspaceId;
  }

  get sealedStoreLocked(): boolean {
    return !this.#sealedStore.isUnlocked;
  }

  async unlockSealedStore(workspaceId: string, apiOrigin: string): Promise<void> {
    await this.#sealedStore.unlockOnline(workspaceId, apiOrigin);
  }

  lockSealedStore(): void {
    this.#sealedStore.lock();
  }

  async sealPayload(storeKey: string, plaintext: Uint8Array): Promise<void> {
    await this.#sealedStore.put(storeKey, plaintext);
  }

  async openPayload(storeKey: string): Promise<Uint8Array | null> {
    return this.#sealedStore.get(storeKey);
  }

  async initialize(workspaceId: string): Promise<void> {
    if (this.#workspaceId !== null) {
      throw new Error("The Worker is already bound to a workspace");
    }
    // Fail before touching WASM/index/document state: reading through a
    // locked sealed store is never attempted, silently or otherwise.
    if (!this.#sealedStore.isUnlocked) {
      throw new SealedStoreLockedError();
    }
    this.#availability = { state: "mid-sync" };

    await initializeLoro();
    this.#index = new SQLiteGraphIndex(workspaceId);
    await this.#index.initialize();
    this.#document = new LoroDoc();

    const persisted = await this.#sealedStore.get(graphSnapshotStoreKey(workspaceId));
    if (persisted !== null) {
      this.#document.import(persisted);
    }

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
    await this.#persist(document);
    this.#availability = { state: "ready" };

    return {
      mergedDeltaCount: deltas.length,
      materializationGeneration: await index.generation,
      workerDurationMs: performance.now() - startedAt,
    };
  }

  /**
   * FDN-50 stage 1: a direct, undebounced write-through. Runs synchronously
   * after every applyDeltaBatch completes — the only mutation entrypoint
   * this class currently has. Debouncing and shallow/full snapshot choice
   * are stage 2, not this one.
   */
  async #persist(document: LoroDoc): Promise<void> {
    const workspaceId = this.#workspaceId;
    if (workspaceId === null) throw new Error("Worker is not initialized");
    const snapshot = document.export({ mode: "snapshot" });
    await this.#sealedStore.put(graphSnapshotStoreKey(workspaceId), snapshot);
  }

  async dispose(): Promise<void> {
    await this.#index?.dispose();
    this.#index = null;
    this.#document?.free();
    this.#document = null;
    this.#workspaceId = null;
    this.#availability = { state: "mid-sync" };
    this.#sealedStore.dispose();
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

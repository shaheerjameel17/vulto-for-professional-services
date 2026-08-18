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

/**
 * FDN-50 stage 2: how long an in-memory mutation can sit before it is
 * durably flushed to SealedStore. Chosen in the low hundreds of
 * milliseconds, not seconds, specifically to bound the data-loss window
 * described on `#persist` below to something a founder reviewing this
 * tradeoff would recognize as "a moment," not "noticeable work lost." 250ms
 * is long enough that a burst of rapid edits (drag, fast typing, a bulk
 * paste materializing as several small delta batches) coalesces into one
 * flush rather than one write per keystroke, while staying well clear of
 * the "seconds" range the decision memo ruled out. It is not read from
 * VPS-D003 or VPS-A003 — neither specifies a debounce window, only the 16ms
 * optimistic write-acknowledgment budget this value does not touch, since
 * the in-memory mutation is visible immediately in `applyDeltaBatch` and
 * only the durable flush is deferred.
 */
const FLUSH_DEBOUNCE_MS = 250;

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
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #flushInFlight: Promise<void> | null = null;
  /**
   * A flush that fires from the debounce timer (not from `dispose()`'s
   * synchronous drain) runs with nothing awaiting it. If it fails — for
   * example the sealed store was locked in between the mutation and the
   * timer firing — that failure must not vanish silently. It is captured
   * here and re-thrown at the start of the next `applyDeltaBatch` or
   * `dispose()` call, so a caller always eventually observes it instead of
   * the runtime quietly continuing to accept mutations it cannot persist.
   */
  #pendingFlushError: unknown = null;

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
    this.#throwPendingFlushError();
    const document = this.#requireDocument();
    const index = this.#requireIndex();
    this.#availability = { state: "mid-sync" };
    const startedAt = performance.now();

    for (const delta of deltas) {
      document.import(new Uint8Array(delta));
    }
    // The mutation above is already visible/queryable in-memory and through
    // the index at this point. Only the durable flush to SealedStore is
    // deferred — see #scheduleFlush and #persist.
    this.#scheduleFlush();
    this.#availability = { state: "ready" };

    return {
      mergedDeltaCount: deltas.length,
      materializationGeneration: await index.generation,
      workerDurationMs: performance.now() - startedAt,
    };
  }

  /**
   * FDN-50 stage 2: standard debounce, not a throttle. Every call pushes the
   * pending flush out by FLUSH_DEBOUNCE_MS again; multiple mutations that
   * land inside one window coalesce into a single flush of the document's
   * current state when the window finally elapses with no further activity.
   *
   * A flush scheduled here runs on the timer's own turn, unawaited by the
   * caller that scheduled it (per the 16ms optimistic write-acknowledgment
   * budget: `applyDeltaBatch` returns without waiting on durability). This
   * is the specific tradeoff the decision memo named and the founder
   * accepted: if this device is hard-killed (not a clean `dispose()` —
   * an actual process kill, browser crash, or `kill -9`) while a debounce
   * window is still open, the mutation(s) inside that window are not
   * durable on this device alone. They may already be durable elsewhere —
   * another device, or the server — via ordinary sync ahead of the crash;
   * this class has no visibility into that and makes no claim about it
   * either way. A clean shutdown never loses this window: dispose() below
   * flushes synchronously before tearing down.
   */
  #scheduleFlush(): void {
    if (this.#flushTimer !== null) clearTimeout(this.#flushTimer);
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flushInFlight = this.#persist()
        .catch((error: unknown) => {
          this.#pendingFlushError = error;
        })
        .finally(() => {
          this.#flushInFlight = null;
        });
    }, FLUSH_DEBOUNCE_MS);
  }

  #throwPendingFlushError(): void {
    if (this.#pendingFlushError !== null) {
      const error = this.#pendingFlushError;
      this.#pendingFlushError = null;
      throw error;
    }
  }

  /**
   * FDN-50 stage 2 Decision 2 (shallow-anchor a flush against the previous
   * durable frontier, full snapshot only as the bootstrap) is NOT
   * implemented here — every flush still writes a full `{ mode: "snapshot"
   * }`, same as stage 1. Building it surfaced a defect in the plan, not a
   * bug in this file: `document.export({ mode: "shallow-snapshot",
   * frontiers })` throws "You cannot switch a document to a version before
   * the shallow history's start version" on import, as soon as the
   * document has merged in ops from a peer that did not yet exist when
   * `frontiers` was captured. Reproduced against the real pinned
   * loro-crdt@1.14.1 in isolated scripts with no runtime.ts involved at
   * all, and across all three frontier sources this file could plausibly
   * have used (`oplogFrontiers()`, `frontiers()`, `vvToFrontiers(version())`
   * at anchor time) — same failure every time. Since this Worker's document
   * only ever grows by importing foreign deltas (never local edits) and
   * every distinct scratch/session/device that has ever produced a delta
   * is its own Loro peer, a workspace whose sync history spans more than
   * one peer — the ordinary case, not an edge case — cannot be
   * shallow-anchored against a stale frontier without hitting this. Filed
   * as a candidate finding rather than worked around; see this stage's
   * report for the three variants tried and their results.
   */
  async #persist(): Promise<void> {
    const workspaceId = this.#workspaceId;
    const document = this.#document;
    if (workspaceId === null || document === null) {
      throw new Error("Worker is not initialized");
    }

    const snapshot = document.export({ mode: "snapshot" });
    await this.#sealedStore.put(graphSnapshotStoreKey(workspaceId), snapshot);
  }

  /**
   * Flushes any pending debounced write synchronously before the document
   * is freed, so a clean dispose() never loses the in-flight window — only
   * a genuine crash can (see #scheduleFlush's comment). A pending timer is
   * cancelled and its flush run directly; a flush already in flight
   * (the timer already fired, its callback already started #persist) is
   * awaited rather than duplicated. A failure here is captured the same way
   * the debounce timer's own failures are (`#pendingFlushError`), never
   * thrown from inside this method — dispose() must still tear the rest of
   * the runtime down even when this flush failed, and reports the failure
   * itself only once teardown is otherwise complete.
   */
  async #flushBeforeTeardown(): Promise<void> {
    if (this.#flushTimer !== null) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
      if (this.#document !== null) {
        try {
          await this.#persist();
        } catch (error: unknown) {
          this.#pendingFlushError = error;
        }
      }
      return;
    }
    if (this.#flushInFlight !== null) {
      await this.#flushInFlight;
    }
  }

  async dispose(): Promise<void> {
    await this.#flushBeforeTeardown();
    await this.#index?.dispose();
    this.#index = null;
    this.#document?.free();
    this.#document = null;
    this.#workspaceId = null;
    this.#availability = { state: "mid-sync" };
    this.#sealedStore.dispose();
    // Reported last, after every resource above is fully torn down: a
    // background flush failure (this dispose()'s own drain, or one the
    // caller never observed via a prior applyDeltaBatch) must still surface
    // to whoever called dispose(), but must never leave teardown half-done.
    this.#throwPendingFlushError();
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

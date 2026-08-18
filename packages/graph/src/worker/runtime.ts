import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import type { GraphAvailability } from "../protocol";
import {
  assertDocumentSchemaGenerationReadable,
  stampDocumentSchemaGeneration,
} from "./document-schema-gate";
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
      // FDN-50 stage 3: the document-level gate. Runs AFTER the import (the
      // recorded generation is document state, so it cannot be read before
      // the bytes are in) and BEFORE this runtime is usable — nothing has
      // been materialized or bound yet at this point, and if the gate
      // refuses, nothing ever is.
      //
      // A workspace with no persisted snapshot never reaches here at all:
      // that is the bootstrap case, it has no recorded generation by
      // definition, and it initializes cleanly. Its first #persist stamps
      // the current generation.
      try {
        assertDocumentSchemaGenerationReadable(this.#document);
      } catch (error: unknown) {
        // Fail closed, and leave nothing half-open behind. Every resource
        // built above this line is torn down before the refusal propagates,
        // and #workspaceId is deliberately still null — so no delta can be
        // applied, no flush can be scheduled, and #persist cannot run and
        // overwrite the newer document with an older client's snapshot.
        await this.#index.dispose();
        this.#index = null;
        this.#document.free();
        this.#document = null;
        this.#availability = { state: "mid-sync" };
        throw error;
      }
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
   * }`, same as stage 1. Building it surfaced a constraint in
   * loro-crdt@1.14.1 that the scoped design cannot be written around, not a
   * frontier-tracking bug in this file. Verified twice over: once in
   * isolated Node scripts, and once as a fully instrumented implementation
   * running in real Chromium against the real Worker, the real SealedStore,
   * and the real `loro-crdt/web` WASM build this file imports.
   *
   * Two things about the failure matter more than the message itself, and
   * both are easy to get wrong on a first reading:
   *
   * 1. `export({ mode: "shallow-snapshot", frontiers })` SUCCEEDS. It is
   *    `import()` of the bytes it produced that throws "You cannot switch a
   *    document to a version before the shallow history's start version"
   *    (thrown as a bare string, with no `.message` and no `.stack`). A
   *    flush that does not round-trip its own bytes before committing them
   *    therefore writes a snapshot that cannot be read back, and the
   *    workspace only fails on the NEXT `initialize()` — silent durable
   *    corruption, discovered long after the flush that caused it.
   *
   * 2. The trigger is NOT "the document merged ops from a peer that did not
   *    exist when `frontiers` was captured." A brand-new peer whose ops are
   *    causal descendants of the anchor round-trips perfectly, repeatedly,
   *    across reopen cycles. The shape that reproducibly fails is narrower:
   *    a document whose history is two or more CONCURRENT ROOT ops, with
   *    the anchor naming only some of them. That distinction is why this
   *    reproduces here but did not reproduce in earlier scripts, which
   *    happened to build causally ordered histories.
   *
   *    The precise boundary is narrower still than "any anchor that fails
   *    to dominate the document," and is not fully characterized here: a
   *    concurrent op grafted onto a deeper shared history, anchored
   *    mid-chain, did round-trip cleanly. Do not read this comment as a
   *    general rule about Loro; read it as the one shape this Worker
   *    actually produces, which is a forest of concurrent roots, because
   *    every delta it merges arrives as an independently authored document
   *    whose first op is its own root.
   *
   * The previous durable frontier is exactly such an anchor whenever a
   * delta arriving after it is concurrent with it rather than descended
   * from it — which for a CRDT merging independently authored history is
   * ordinary, not exotic. All three frontier sources this file could have
   * used (`oplogFrontiers()`, `frontiers()`, `vvToFrontiers(version())`)
   * return identical values at the failure point, so the accessor choice is
   * not the variable. The only anchor that always round-trips is the
   * document's current frontier at export time, which dominates everything
   * by construction — but that drops all history rather than anchoring at
   * the previous durable version, so it is a different decision than the
   * one scoped, and it degenerates to a full snapshot exactly when
   * concurrent roots are present. Filed as a candidate finding rather than
   * worked around; see this stage's report for the captured state at
   * failure.
   */
  async #persist(): Promise<void> {
    const workspaceId = this.#workspaceId;
    const document = this.#document;
    if (workspaceId === null || document === null) {
      throw new Error("Worker is not initialized");
    }

    // FDN-50 stage 3: every durable write records the generation it was
    // written under, so the gate in initialize() has something to read on
    // the next reopen. Stamped here rather than in initialize() so that the
    // bootstrap case behaves exactly as stage 1 proved it does — a fresh
    // workspace that never mutates writes nothing at all, and its FIRST
    // persist is what records the generation. This is a no-op on every
    // later flush (the value is already present and equal), so it neither
    // grows history nor changes the debounce behavior above it.
    stampDocumentSchemaGeneration(document);

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

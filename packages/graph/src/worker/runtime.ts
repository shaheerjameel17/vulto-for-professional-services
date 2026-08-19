import type { WorkspaceRole } from "@vulto/schema";
import { LoroDoc } from "loro-crdt/web";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import type { GraphAvailability } from "../protocol";
import type { GraphQuery } from "../query";
import {
  assertDocumentSchemaGenerationReadable,
  stampDocumentSchemaGeneration,
} from "./document-schema-gate";
import { readNodeFragments } from "./document-node-fragments";
import { materializeManagedByEdges } from "./managed-by-materialization";
import { deriveEffectiveRoles } from "./permission/effective-roles";
import { executeWithPermissions } from "./permission/interceptor";
import { fetchCurrentRoles, RoleRefreshDeniedError } from "./permission/role-refresh";
import { SealedStore, SealedStoreLockedError } from "./storage/sealed-store";
import { SQLiteGraphIndex, type GraphQueryResult } from "./storage/sqlite-graph-index";
import { graphSnapshotStoreKey } from "./storage/storage-keys";

/**
 * F127's explicitly-labeled PLACEHOLDER delivery mechanism for the live
 * role-refresh channel. FDN-53 must prove the whole refresh path end to
 * end now, real signal to real effect, rather than assert it against a
 * mock (per F127's closing paragraph) — so this stage builds a working
 * minimal transport rather than only the receiving surface. `FDN-63` is
 * named as the natural place to replace this poll with a real push
 * mechanism once device-level revocation transport exists anyway, behind
 * the `refreshRoleOnline()` method below, which does not change shape when
 * that happens.
 *
 * `VPS-F001`'s Security Considerations (F127) bound a role narrowing to
 * reach an online session "within the same window already specified for
 * device wipe: within 60 seconds while online." An interval must land
 * comfortably inside that bound, not graze it — request latency, a slow
 * tick, or a device briefly busy with a flush (FDN-50 stage 2) all eat into
 * it. 15 seconds gives four polls per 60-second window: the worst case is a
 * narrowing that lands the instant after one poll fires, caught by the
 * next at most ~15s later, leaving roughly 45s of margin against the 60s
 * bound. That is also far from hammering `/device-store/roles` — one
 * request per unlocked Worker per 15s, not per second. Not read from any
 * specification; none names a poll interval, only the 60-second bound this
 * value must land inside, the same way stage 2's `FLUSH_DEBOUNCE_MS` was
 * reasoned about rather than looked up.
 */
const ROLE_REFRESH_POLL_INTERVAL_MS = 15_000;

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
  /** Set on a successful unlock, cleared on lock/dispose. Reused by the role-refresh poll below, never persisted. */
  #apiOrigin: string | null = null;
  #rolePollTimer: ReturnType<typeof setInterval> | null = null;

  get availability(): GraphAvailability {
    return this.#availability;
  }

  get workspaceId(): string | null {
    return this.#workspaceId;
  }

  get sealedStoreLocked(): boolean {
    return !this.#sealedStore.isUnlocked;
  }

  /** The role set the permission interceptor currently reads. Throws when locked, same as `SealedStore.roles`. */
  get roles(): readonly WorkspaceRole[] {
    return this.#sealedStore.roles;
  }

  /**
   * FDN-50 stage 5: Worker-private access to the materialized index, for
   * the proof seam that has to read back what the live path wrote.
   *
   * This is NOT an application-facing read path and does not become one.
   * `packages/graph`'s public surface is the Worker client and its
   * validated protocol; no protocol message reaches this getter, `entry.ts`
   * never calls it, and nothing outside the Worker can obtain a
   * `LocalGraphWorkerRuntime` to call it on. Per F105, FDN-53 remains the
   * first application-callable read path over graph state, behind
   * `VPS-A004`'s permission interceptor — this getter is the same category
   * of test seam as stage 4's materializer, reached only from
   * `src/worker/testing/`.
   *
   * Named for what it is so that adding a protocol message that exposes it
   * reads as the deliberate scope violation it would be.
   */
  get materializedIndexForDiagnostics(): SQLiteGraphIndex | null {
    return this.#index;
  }

  async unlockSealedStore(workspaceId: string, apiOrigin: string): Promise<void> {
    await this.#sealedStore.unlockOnline(workspaceId, apiOrigin);
    this.#apiOrigin = apiOrigin;
    this.#startRolePolling(workspaceId);
  }

  lockSealedStore(): void {
    this.#stopRolePolling();
    this.#sealedStore.lock();
    this.#apiOrigin = null;
  }

  /**
   * F127's live role-refresh entrypoint. Re-validates against the server
   * (`POST /device-store/roles`, reusing `requireCurrentWorkspaceSession`'s
   * exact revalidation) and updates the in-memory role set the interceptor
   * reads — no full re-`unlock()`, no re-derivation of the AES key. Called
   * directly by the `refresh-role` protocol message and, on a timer, by the
   * placeholder poll started in `unlockSealedStore` above.
   *
   * A denial (membership revoked, session invalid) locks the store: this
   * stage does not build a distinct "role became unresolvable while
   * otherwise online" state, and a device that can no longer prove its
   * session current should not keep serving reads from the role it cached
   * before that became true.
   */
  async refreshRoleOnline(workspaceId: string): Promise<void> {
    const apiOrigin = this.#apiOrigin;
    if (apiOrigin === null) throw new SealedStoreLockedError();
    try {
      const result = await fetchCurrentRoles(apiOrigin, workspaceId);
      this.#sealedStore.refreshRoles(result.roles);
    } catch (error) {
      if (error instanceof RoleRefreshDeniedError) {
        this.lockSealedStore();
      }
      throw error;
    }
  }

  #startRolePolling(workspaceId: string): void {
    this.#stopRolePolling();
    this.#rolePollTimer = setInterval(() => {
      // A poll tick's own failure (network blip while offline, or a
      // transient server error) must not crash the Worker or stop future
      // ticks — F106/F127 already treat offline staleness as expected,
      // resolved on next connection. A genuine denial is handled inside
      // refreshRoleOnline itself (locks the store), so nothing further is
      // needed here beyond not letting a rejected promise go unobserved.
      void this.refreshRoleOnline(workspaceId).catch(() => {});
    }, ROLE_REFRESH_POLL_INTERVAL_MS);
  }

  #stopRolePolling(): void {
    if (this.#rolePollTimer !== null) {
      clearInterval(this.#rolePollTimer);
      this.#rolePollTimer = null;
    }
  }

  /**
   * FDN-53 stage 1: the first application-callable read path over graph
   * state, per F105. Routes through `executeWithPermissions` rather than
   * `SQLiteGraphIndex.execute()` directly — every production query is
   * permission-filtered, never raw.
   */
  async executeQuery(query: GraphQuery): Promise<GraphQueryResult> {
    const index = this.#requireIndex();
    const roles = deriveEffectiveRoles(this.#sealedStore.roles);
    return executeWithPermissions(index, query, { roles });
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

    // FDN-50 stage 5: a reopened document must produce its edges again.
    // The SQLite index is a disposable read model that does not survive the
    // Worker — every new instance starts with an empty one — so a workspace
    // whose Tree moves and node fragments were all merged in a PREVIOUS
    // session would otherwise reopen fully populated as a document and
    // completely empty as a query surface. Materializing here is what makes
    // "closed, reopened, materialized, and queried" one continuous path
    // rather than three that happen to share a document.
    //
    // Its own try/catch rather than an extension of the gate's above: the
    // gate is stage 3's and is deliberately left untouched. The teardown is
    // the same, and for the same reason — a workspace whose document cannot
    // be materialized must not be left half-open, with #workspaceId still
    // null so no delta can be applied and no flush can overwrite it.
    try {
      await this.#materialize();
    } catch (error: unknown) {
      await this.#index.dispose();
      this.#index = null;
      this.#document.free();
      this.#document = null;
      this.#availability = { state: "mid-sync" };
      throw error;
    }

    this.#workspaceId = workspaceId;
    this.#availability = { state: "ready" };
  }

  /**
   * FDN-50 stage 5: the whole of the CRDT-to-query-layer mapping, in one
   * place, run on exactly two occasions — a reopen, and every merged delta
   * batch.
   *
   * **This is a full re-materialization, deliberately.** Every call reads
   * the document's complete current state and hands `rebuild` a whole
   * snapshot, which replaces the index's contents outright. An incremental
   * path — diffing which fragments and which Tree subtrees a batch touched,
   * and applying only those — would be faster, and is not built here
   * because it cannot yet be proven correct: a merged CRDT batch can change
   * the resolved winner of a move that the batch itself does not contain
   * (stage 4's concurrent-loser elimination is a property of the whole
   * history, not of one delta), so "which edges changed" is not a function
   * of the incoming bytes alone. A clever incremental path that is wrong in
   * that case would produce a query layer that quietly disagrees with the
   * document, which is precisely the failure this issue exists to rule out.
   *
   * Full re-materialization also makes idempotency free rather than
   * argued: the index becomes a pure function of the document, so running
   * this twice on unchanged state produces an identical index. Stage 4's
   * deterministic edge ids (SHA-256 over replicated inputs, forced to v4
   * shape) are what let that hold across devices as well as across reruns —
   * a random edge id would make the same Tree state materialize as
   * different rows on every pass.
   *
   * The cost is bounded by workspace size rather than batch size, and is
   * paid inside the Worker, never on the main thread (A001-T06). When it
   * stops being acceptable, the replacement needs its own proof, not a
   * quiet substitution.
   */
  async #materialize(): Promise<number> {
    const document = this.#requireDocument();
    const index = this.#requireIndex();
    const { edges } = await materializeManagedByEdges(document);
    return index.rebuild({ nodeFragments: readNodeFragments(document), edges });
  }

  async applyDeltaBatch(
    deltas: readonly ArrayBuffer[],
  ): Promise<RuntimeDeltaBatchResult> {
    this.#throwPendingFlushError();
    const document = this.#requireDocument();
    this.#requireIndex();
    this.#availability = { state: "mid-sync" };
    const startedAt = performance.now();

    for (const delta of deltas) {
      document.import(new Uint8Array(delta));
    }
    // FDN-50 stage 5: the merged document is mapped into the SQLite index
    // BEFORE the durable flush is scheduled, so a batch this Worker cannot
    // materialize is never scheduled for a durable write. That ordering is
    // not cosmetic — a batch that reaches disk but cannot be materialized
    // makes the NEXT initialize() refuse the workspace, turning a rejected
    // mutation into an unopenable document.
    //
    // It does not make the in-memory merge conditional: the deltas are
    // already in the document above, and a materialization failure throws
    // out of this call with them merged. That is the honest position for
    // this stage — a CRDT merge is not undoable, and pretending otherwise
    // by discarding the document would lose ops from peers that are
    // perfectly valid. See this stage's report for the case it leaves open.
    const materializationGeneration = await this.#materialize();
    // The mutation above is already visible/queryable in-memory and through
    // the index at this point. Only the durable flush to SealedStore is
    // deferred — see #scheduleFlush and #persist.
    this.#scheduleFlush();
    this.#availability = { state: "ready" };

    return {
      mergedDeltaCount: deltas.length,
      materializationGeneration,
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
    this.#stopRolePolling();
    this.#apiOrigin = null;
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

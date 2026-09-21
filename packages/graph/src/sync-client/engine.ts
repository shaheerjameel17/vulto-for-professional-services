import { getMutationDefinition } from "@vulto/schema";
import { applyOptimistic, applyUndo, OptimisticRejection } from "../mutators";
import { parseGraphQuery, type GraphQuery } from "../query";
import { ApiError, type ApiClient, type MutationEnvelope } from "./api";
import { SqliteCache, type ShapeTemplateName } from "./cache";
import type { SyncDatabase } from "./database";
import { backoffDelayMs, Outbox } from "./outbox";
import { ProtectedStore, type ProtectedItem } from "./protected-store";
import { runCacheQuery, type CacheQueryResult } from "./query";
import type { ShapeEvent, ShapeFailure, ShapeSource } from "./shape-source";
import { computeSyncStatus, type SyncState } from "./status";

/**
 * The sync engine: one per `(workspace, user)` device cache. It owns the cache
 * database, replicates the two shapes into it, queues and uploads named
 * mutations, answers queries locally, and holds protected values in memory only.
 * It runs inside a worker; nothing here touches the main thread or any browser
 * storage other than the cache database it is handed.
 */
export type QueryAvailability = "ready" | "mid-sync";
export type ProtectedAvailability =
  "ready" | "requires-connection" | "permission-absence";

export interface QueryOutcome {
  readonly availability: QueryAvailability;
  readonly result: CacheQueryResult;
}

export interface ProtectedReadOutcome {
  readonly availability: ProtectedAvailability;
  readonly items: readonly ProtectedItem[];
}

export type MutateOutcome =
  | { readonly accepted: true; readonly mutationId: string }
  | { readonly accepted: false; readonly reason: string };

export interface EngineOptions {
  readonly workspaceId: string;
  readonly userId: string;
  readonly database: SyncDatabase;
  readonly api: ApiClient;
  readonly createShapeSource: (
    template: ShapeTemplateName,
    resume: { handle: string | null; offset: string | null },
  ) => ShapeSource;
  /** Deletes this device's cache for the workspace. Called before anything else on revocation. */
  readonly eraseLocalData: () => Promise<void>;
  readonly deviceId?: string;
  readonly deviceName?: string;
  readonly now?: () => string;
  readonly newId?: () => string;
  /** Timers, injectable so tests need not wait. */
  readonly setTimer?: (work: () => void, ms: number) => () => void;
  /** Tells other tabs the cache changed. */
  readonly onCacheChanged?: () => void;
}

const TEMPLATES: readonly ShapeTemplateName[] = ["nodes", "edges"];
const UPLOAD_BATCH = 100;

type Connectivity = "unknown" | "online" | "offline";

export class SyncEngine {
  readonly #options: EngineOptions;
  readonly #cache: SqliteCache;
  readonly #outbox: Outbox;
  readonly #protected = new ProtectedStore();
  readonly #sources = new Map<ShapeTemplateName, ShapeSource>();
  readonly #synced = new Set<ShapeTemplateName>();
  readonly #stateListeners = new Set<(state: SyncState) => void>();
  readonly #querySubscriptions = new Set<{
    query: GraphQuery;
    last: string;
    callback: (o: QueryOutcome) => void;
  }>();
  readonly #restartTimers = new Map<ShapeTemplateName, () => void>();
  readonly #restartFailures = new Map<ShapeTemplateName, number>();
  #connectivity: Connectivity = "unknown";
  #draining = false;
  #drainRun: Promise<void> | null = null;
  #drainAgain = false;
  #uploadFailures = 0;
  #cancelDrainTimer: (() => void) | null = null;
  #stopped = false;
  #state: SyncState = { status: "Syncing", signedOut: false, attention: [] };
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: EngineOptions) {
    this.#options = options;
    this.#cache = new SqliteCache(options.database);
    this.#outbox = new Outbox(options.database);
  }

  /** One use of the database at a time (the async wa-sqlite build allows one call in flight). */
  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(work, work);
    this.#tail = next.catch(() => undefined);
    return next;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Identifiers only: the ids this cache belongs to. No token is ever stored. */
  async start(): Promise<void> {
    const { database, workspaceId, userId } = this.#options;
    await this.#exclusive(async () => {
      await database.run(
        `INSERT INTO session_hint (singleton, user_id, workspace_id) VALUES (1, ?, ?)
         ON CONFLICT (singleton) DO UPDATE SET user_id = excluded.user_id, workspace_id = excluded.workspace_id`,
        [userId, workspaceId],
      );
      await this.#outbox.requeueInflight();
      // A cursor for both shapes means this device has caught up at least once.
      for (const template of TEMPLATES) {
        if ((await this.#cache.readCursor(template)).handle !== null)
          this.#synced.add(template);
      }
    });
    await this.#refreshState();
    await this.promote();
  }

  /**
   * A follower reads and writes the shared cache but does not replicate or
   * upload; another tab's worker leads (dedicated-worker fallback only).
   */
  async startFollower(): Promise<void> {
    const { database, workspaceId, userId } = this.#options;
    await this.#exclusive(async () => {
      await database.run(
        `INSERT INTO session_hint (singleton, user_id, workspace_id) VALUES (1, ?, ?)
         ON CONFLICT (singleton) DO UPDATE SET user_id = excluded.user_id, workspace_id = excluded.workspace_id`,
        [userId, workspaceId],
      );
      for (const template of TEMPLATES) {
        if ((await this.#cache.readCursor(template)).handle !== null)
          this.#synced.add(template);
      }
    });
    await this.#refreshState();
  }

  /** Becomes the tab that replicates and uploads. */
  async promote(): Promise<void> {
    if (this.#sources.size > 0) return;
    await this.#exclusive(() => this.#outbox.requeueInflight());
    // The proxy refuses a device it does not know, so this device is registered
    // before its first shape request. Offline, this fails fast and replication
    // starts from the cache regardless.
    await this.#registerDevice();
    for (const template of TEMPLATES) await this.#startSource(template);
    void this.drain();
  }

  async #registerDevice(): Promise<void> {
    const { deviceId, deviceName, api } = this.#options;
    if (!deviceId) return;
    try {
      await api.registerDevice(deviceId, deviceName ?? "Web browser");
    } catch {
      // Offline or not signed in: the shape request will say which.
    }
  }

  async #startSource(template: ShapeTemplateName): Promise<void> {
    if (this.#stopped) return;
    this.#sources.get(template)?.stop();
    const resume = await this.#exclusive(() => this.#cache.readCursor(template));
    const source = this.#options.createShapeSource(template, resume);
    this.#sources.set(template, source);
    source.start({
      onEvents: (events) => this.#onEvents(template, events),
      onFailure: (failure) => void this.#onFailure(template, failure),
    });
  }

  async #onEvents(
    template: ShapeTemplateName,
    events: readonly ShapeEvent[],
  ): Promise<void> {
    if (this.#stopped) return;
    let touchedRows = false;
    await this.#exclusive(async () => {
      for (const event of events) {
        if (event.type === "must-refetch") {
          await this.#cache.resetTemplate(template);
          this.#synced.delete(template);
          this.#protected.clear();
          touchedRows = true;
        } else if (event.type === "changes") {
          await this.#cache.applyBatch(template, event.changes, event.cursor);
          touchedRows = true;
          // A removed row or a change to a membership can narrow what this person
          // may read; protected values are re-fetched rather than trusted.
          if (
            event.changes.some(
              (c) =>
                c.operation === "delete" ||
                c.operation === "move-out" ||
                (template === "nodes" &&
                  c.value["node_type"] === "WorkspaceMembership"),
            )
          ) {
            this.#protected.clear();
          }
        } else {
          await this.#cache.applyBatch(template, [], event.cursor);
          this.#synced.add(template);
        }
      }
    });
    this.#connectivity = "online";
    this.#restartFailures.set(template, 0);
    await this.#changed(touchedRows);
    if (this.#connectivity === "online") void this.drain();
  }

  async #onFailure(template: ShapeTemplateName, failure: ShapeFailure): Promise<void> {
    if (this.#stopped) return;
    if (failure.kind === "access-revoked") {
      await this.#handleRevoked();
      return;
    }
    if (failure.kind === "network") {
      this.#connectivity = "offline";
      const failures = (this.#restartFailures.get(template) ?? 0) + 1;
      this.#restartFailures.set(template, failures);
      this.#restartTimers.get(template)?.();
      this.#restartTimers.set(
        template,
        this.#timer(() => void this.#startSource(template), backoffDelayMs(failures)),
      );
    } else if (failure.kind === "unauthenticated") {
      // The session lapsed. What is cached stays readable; nothing more syncs.
      this.#connectivity = "offline";
    }
    await this.#refreshState();
  }

  /**
   * Access was revoked: the device wipes this workspace's local database BEFORE
   * anything else runs (A003-T67). Nothing is read, uploaded or shown first.
   */
  async #handleRevoked(): Promise<void> {
    this.#stopped = true;
    for (const source of this.#sources.values()) source.stop();
    this.#sources.clear();
    this.#protected.clear();
    await this.#options.eraseLocalData();
    this.#publish({
      status: "Offline",
      signedOut: true,
      reason: "access-revoked",
      attention: [],
    });
  }

  /** The network came back: try again now instead of waiting out the backoff. */
  notifyOnline(): void {
    if (this.#stopped) return;
    for (const cancel of this.#restartTimers.values()) cancel();
    this.#restartTimers.clear();
    for (const template of TEMPLATES) void this.#startSource(template);
    this.#uploadFailures = 0;
    void this.drain();
  }

  async signOut(): Promise<void> {
    this.#stopped = true;
    for (const source of this.#sources.values()) source.stop();
    this.#sources.clear();
    for (const cancel of this.#restartTimers.values()) cancel();
    this.#cancelDrainTimer?.();
    this.#protected.clear();
    this.#querySubscriptions.clear();
    await this.#options.eraseLocalData();
    this.#publish({
      status: "Offline",
      signedOut: true,
      reason: "signed-out",
      attention: [],
    });
  }

  /** Stops replication without erasing anything (the tab closed). */
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const source of this.#sources.values()) source.stop();
    for (const cancel of this.#restartTimers.values()) cancel();
    this.#cancelDrainTimer?.();
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  async query(input: unknown): Promise<QueryOutcome> {
    const query = parseGraphQuery(input);
    const result = await this.#exclusive(() =>
      runCacheQuery(this.#options.database, query),
    );
    return {
      availability: this.#synced.size === TEMPLATES.length ? "ready" : "mid-sync",
      result,
    };
  }

  /** Calls `callback` now and again whenever the result changes. */
  subscribe(input: unknown, callback: (outcome: QueryOutcome) => void): () => void {
    const query = parseGraphQuery(input);
    const subscription = { query, last: "", callback };
    this.#querySubscriptions.add(subscription);
    void this.#rerun(subscription);
    return () => this.#querySubscriptions.delete(subscription);
  }

  async #rerun(subscription: {
    query: GraphQuery;
    last: string;
    callback: (o: QueryOutcome) => void;
  }) {
    if (this.#stopped) return;
    const outcome = await this.query(subscription.query);
    const serialized = JSON.stringify(outcome);
    if (serialized !== subscription.last) {
      subscription.last = serialized;
      subscription.callback(outcome);
    }
  }

  // ── Writes ──────────────────────────────────────────────────────────────

  async mutate(name: string, args: unknown): Promise<MutateOutcome> {
    const definition = getMutationDefinition(name);
    if (!definition) return { accepted: false, reason: "unknown-mutation" };
    // A protected or online-only mutation is never queued (A003-T63).
    if (definition.onlineOnly && this.#connectivity !== "online") {
      return { accepted: false, reason: "requires-connection" };
    }
    const mutationId = (this.#options.newId ?? (() => crypto.randomUUID()))();
    const now = (this.#options.now ?? (() => new Date().toISOString()))();
    class Refused extends Error {
      constructor(readonly reason: string) {
        super(reason);
      }
    }
    try {
      await this.#exclusive(() =>
        this.#options.database.transaction(async () => {
          let undo;
          try {
            undo = await applyOptimistic(
              {
                cache: this.#cache,
                workspaceId: this.#options.workspaceId,
                userId: this.#options.userId,
                mutationId,
                now,
              },
              name,
              args,
            );
          } catch (error) {
            if (error instanceof OptimisticRejection) throw new Refused(error.reason);
            throw error;
          }
          await this.#outbox.append({ mutationId, name, args, undo, createdAt: now });
        }),
      );
    } catch (error) {
      if (error instanceof Refused) return { accepted: false, reason: error.reason };
      throw error;
    }
    await this.#changed(true);
    void this.drain();
    return { accepted: true, mutationId };
  }

  /** Uploads queued mutations in order. Safe to call at any time. */
  drain(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    // A call while one is running is not lost: the run repeats until the queue is empty.
    if (this.#drainRun) {
      this.#drainAgain = true;
      return this.#drainRun;
    }
    this.#drainRun = this.#drainLoop().finally(() => {
      this.#drainRun = null;
    });
    return this.#drainRun;
  }

  async #drainLoop(): Promise<void> {
    this.#draining = true;
    try {
      for (;;) {
        this.#drainAgain = false;
        const finished = await this.#drainOnce();
        // Someone asked again while this ran: honor it, even after a failed upload.
        if (this.#drainAgain) continue;
        if (!finished) return;
        break;
      }
    } finally {
      this.#draining = false;
      await this.#refreshState();
    }
  }

  /** Returns false when an upload failed and the rest should wait for a retry. */
  async #drainOnce(): Promise<boolean> {
    {
      for (;;) {
        const rows = await this.#exclusive(async () => {
          const next = await this.#outbox.nextPending(UPLOAD_BATCH);
          await this.#outbox.markInflight(next.map((r) => r.mutationId));
          return next;
        });
        if (rows.length === 0) break;
        const envelopes: MutationEnvelope[] = rows.map((r) => ({
          mutation_id: r.mutationId,
          name: r.name,
          args: r.args,
        }));
        let outcomes;
        try {
          outcomes = await this.#options.api.applyMutations(envelopes);
        } catch (error) {
          await this.#exclusive(() => this.#outbox.requeueInflight());
          if (error instanceof ApiError && error.kind === "network") {
            this.#connectivity = "offline";
            this.#uploadFailures += 1;
            this.#cancelDrainTimer?.();
            this.#cancelDrainTimer = this.#timer(
              () => void this.drain(),
              backoffDelayMs(this.#uploadFailures),
            );
          }
          await this.#refreshState();
          return false;
        }
        this.#uploadFailures = 0;
        this.#connectivity = "online";
        await this.#exclusive(async () => {
          for (const outcome of outcomes) {
            const row = rows.find((r) => r.mutationId === outcome.mutation_id);
            if (!row) continue;
            if (outcome.status === "rejected") {
              if (outcome.reason === "blocked-by-earlier-rejection") {
                await this.#outbox.requeue(row.mutationId);
              } else {
                // The optimistic effect is reverted and the person is told why (A003-T64).
                await applyUndo(this.#cache, row.undo);
                await this.#outbox.reject(row.mutationId, outcome.reason ?? "rejected");
              }
            } else {
              await this.#outbox.remove(row.mutationId);
            }
          }
        });
        await this.#changed(true);
      }
      return true;
    }
  }

  /** Clears a rejection the person has seen. */
  async dismissRejected(mutationId: string): Promise<void> {
    await this.#exclusive(() => this.#outbox.remove(mutationId));
    await this.#refreshState();
  }

  // ── Protected values: memory only ───────────────────────────────────────

  async protectedRead(nodeIds: readonly string[]): Promise<ProtectedReadOutcome> {
    // Always try: the connectivity flag is a hint, and a request that works is the cure.
    try {
      const items = await this.#options.api.protectedRead(nodeIds);
      this.#protected.put(items);
      this.#connectivity = "online";
      return {
        availability: items.length === 0 ? "permission-absence" : "ready",
        items,
      };
    } catch (error) {
      if (error instanceof ApiError && error.kind === "network") {
        this.#connectivity = "offline";
        await this.#refreshState();
      }
      return {
        availability: "requires-connection",
        items: this.#protected.forNodes(nodeIds),
      };
    }
  }

  async prefetchProtected(nodeIds: readonly string[]): Promise<void> {
    await this.protectedRead(nodeIds);
  }

  /** A role change: whatever protected values are held may no longer be permitted. */
  noteRoleChange(): void {
    this.#protected.clear();
  }

  // ── State ───────────────────────────────────────────────────────────────

  getState(): SyncState {
    return this.#state;
  }

  onState(listener: (state: SyncState) => void): () => void {
    this.#stateListeners.add(listener);
    listener(this.#state);
    return () => this.#stateListeners.delete(listener);
  }

  /** Exclusive access to the cache database, for inspection and the browser tests' storage scan. */
  withDatabase<T>(work: (database: SyncDatabase) => Promise<T>): Promise<T> {
    return this.#exclusive(() => work(this.#options.database));
  }

  /** For tests and the worker's memory scan. */
  get protectedStoreSize(): number {
    return this.#protected.size;
  }

  /** Re-reads counts and rows, e.g. when another tab changed the shared cache. */
  async refresh(): Promise<void> {
    await this.#changed(true, false);
  }

  async #changed(rowsChanged: boolean, broadcast = true): Promise<void> {
    if (this.#stopped) return;
    await this.#refreshState();
    if (rowsChanged) {
      for (const subscription of [...this.#querySubscriptions])
        await this.#rerun(subscription);
      if (broadcast) this.#options.onCacheChanged?.();
    }
  }

  async #refreshState(): Promise<void> {
    if (this.#stopped && this.#state.signedOut) return;
    const { pending, rejected, attention } = await this.#exclusive(async () => {
      const counts = await this.#outbox.counts();
      const rows = (await this.#outbox.rejected()).map((r) => ({
        mutationId: r.mutationId,
        name: r.name,
        reason: r.reason ?? "rejected",
      }));
      return { ...counts, attention: rows };
    });
    const status = computeSyncStatus({
      online: this.#connectivity !== "offline",
      syncing:
        this.#connectivity === "unknown" ||
        this.#synced.size < TEMPLATES.length ||
        this.#draining,
      pending,
      rejected,
    });
    this.#publish({ status, signedOut: false, attention });
  }

  #publish(state: SyncState): void {
    const same = JSON.stringify(state) === JSON.stringify(this.#state);
    this.#state = state;
    if (!same) for (const listener of this.#stateListeners) listener(state);
  }

  #timer(work: () => void, ms: number): () => void {
    if (this.#options.setTimer) return this.#options.setTimer(work, ms);
    const handle = setTimeout(work, ms);
    return () => clearTimeout(handle);
  }
}

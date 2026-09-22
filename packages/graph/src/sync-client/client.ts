import type { GraphQuery } from "../query";
import type { MutateOutcome, ProtectedReadOutcome, QueryOutcome } from "./engine";
import type {
  CachedWorkspaceHint,
  InitPayload,
  WorkerMessage,
  WorkerRequest,
} from "./protocol";
import type { SyncState } from "./status";

/**
 * The public sync client (VPS-A001 "Local graph query layer"). Everything it
 * does happens in a worker: the main thread only sends messages and receives
 * results, so no read, write or replication ever blocks the interface.
 *
 * The client stores nothing in the browser itself; the worker owns the cache
 * database. It never handles a token: the worker's own requests carry the
 * session cookie.
 */
export interface GraphClientOptions extends InitPayload {
  /** For tests: supplies the worker. */
  readonly createWorker?: () => { port: MessagePortLike; kind: "shared" | "dedicated" };
}

interface MessagePortLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  start?(): void;
}

export interface SyncStatusHandle {
  get(): SyncState;
  subscribe(listener: (state: SyncState) => void): () => void;
}

export interface GraphClient {
  query(query: GraphQuery): Promise<QueryOutcome>;
  subscribe(query: GraphQuery, listener: (outcome: QueryOutcome) => void): () => void;
  mutate(name: string, args: unknown): Promise<MutateOutcome>;
  protectedRead(nodeIds: readonly string[]): Promise<ProtectedReadOutcome>;
  prefetchProtected(nodeIds: readonly string[]): Promise<void>;
  dismissRejected(mutationId: string): Promise<void>;
  syncStatus: SyncStatusHandle;
  signOut(): Promise<void>;
  /** Test support: what the cache tables hold. */
  dump(): Promise<Record<string, unknown[]>>;
  /** Which kind of worker is serving this tab. */
  readonly workerKind: "shared" | "dedicated";
}

/** Discovers only identifier hints, inside the sync worker, before a workspace is selected. */
export async function listCachedWorkspaces(
  userId?: string,
): Promise<CachedWorkspaceHint[]> {
  const shared = typeof SharedWorker !== "undefined";
  const worker = shared
    ? new SharedWorker(new URL("./sync-worker.ts", import.meta.url), {
        type: "module",
        name: "vulto-sync:discovery",
      })
    : new Worker(new URL("./sync-worker.ts", import.meta.url), { type: "module" });
  const port = shared ? (worker as SharedWorker).port : (worker as Worker);
  try {
    return await new Promise<CachedWorkspaceHint[]>((resolve, reject) => {
      port.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if ("event" in message || message.id !== 1) return;
        if (message.ok) resolve(message.data as CachedWorkspaceHint[]);
        else reject(new Error(message.error));
      };
      if (shared) (port as MessagePort).start();
      port.postMessage({ id: 1, op: "discoverCaches", payload: { userId } });
    });
  } finally {
    if (shared) (port as MessagePort).close();
    else (worker as Worker).terminate();
  }
}

function defaultWorker(init: InitPayload): {
  port: MessagePortLike;
  kind: "shared" | "dedicated";
} {
  const name = `vulto-sync:${init.workspaceId}:${init.userId}`;
  // The `new URL(...)` must sit inside each constructor call: that literal form is
  // what the bundler recognizes and compiles as a worker entry.
  if (typeof SharedWorker !== "undefined") {
    const worker = new SharedWorker(new URL("./sync-worker.ts", import.meta.url), {
      type: "module",
      name,
    });
    return { port: worker.port as unknown as MessagePortLike, kind: "shared" };
  }
  const worker = new Worker(new URL("./sync-worker.ts", import.meta.url), {
    type: "module",
    name,
  });
  return { port: worker as unknown as MessagePortLike, kind: "dedicated" };
}

export async function createGraphClient(
  options: GraphClientOptions,
): Promise<GraphClient> {
  const { port, kind } = (options.createWorker ?? (() => defaultWorker(options)))();
  let nextId = 1;
  let nextSubscription = 1;
  let state: SyncState = { status: "Syncing", signedOut: false, attention: [] };
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  const stateListeners = new Set<(state: SyncState) => void>();
  const queryListeners = new Map<number, (outcome: QueryOutcome) => void>();

  port.onmessage = (event) => {
    const message = event.data;
    if ("event" in message) {
      if (message.event === "state") {
        state = message.state;
        for (const listener of stateListeners) listener(state);
      } else {
        queryListeners.get(message.subscriptionId)?.(message.outcome);
      }
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.ok) waiter.resolve(message.data);
    else waiter.reject(new Error(message.error));
  };
  port.start?.();

  function request<T>(build: (id: number) => WorkerRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      port.postMessage(build(id));
    });
  }

  await request<SyncState>((id) => ({
    id,
    op: "init",
    payload: {
      workspaceId: options.workspaceId,
      userId: options.userId,
      apiOrigin: options.apiOrigin,
    },
  }));

  // The network coming back is worth an immediate retry, not a wait.
  if (typeof addEventListener === "function") {
    addEventListener(
      "online",
      () => void request((id) => ({ id, op: "notifyOnline" })),
    );
  }

  return {
    workerKind: kind,
    query: (query) => request((id) => ({ id, op: "query", payload: query })),
    subscribe(query, listener) {
      const subscriptionId = nextSubscription++;
      queryListeners.set(subscriptionId, listener);
      void request((id) => ({
        id,
        op: "subscribe",
        payload: { subscriptionId, query },
      }));
      return () => {
        queryListeners.delete(subscriptionId);
        void request((id) => ({ id, op: "unsubscribe", payload: { subscriptionId } }));
      };
    },
    mutate: (name, args) =>
      request((id) => ({ id, op: "mutate", payload: { name, args } })),
    protectedRead: (nodeIds) =>
      request((id) => ({
        id,
        op: "protectedRead",
        payload: { nodeIds: [...nodeIds] },
      })),
    prefetchProtected: (nodeIds) =>
      request((id) => ({
        id,
        op: "prefetchProtected",
        payload: { nodeIds: [...nodeIds] },
      })),
    dismissRejected: (mutationId) =>
      request((id) => ({ id, op: "dismissRejected", payload: { mutationId } })),
    syncStatus: {
      get: () => state,
      subscribe(listener) {
        stateListeners.add(listener);
        listener(state);
        return () => stateListeners.delete(listener);
      },
    },
    signOut: () => request((id) => ({ id, op: "signOut" })),
    dump: () => request((id) => ({ id, op: "dump" })),
  };
}

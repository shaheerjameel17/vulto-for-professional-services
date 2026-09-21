import { createApiClient } from "./api";
import {
  cacheDatabaseName,
  deleteIdbDatabase,
  openSyncDatabase,
  type SyncDatabase,
} from "./database";
import { getOrCreateDeviceId } from "./device-identity";
import { SyncEngine } from "./engine";
import type {
  InitPayload,
  WorkerMessage,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";
import { createElectricSource } from "./shape-source";

/**
 * The worker side of the sync client. One host per `(workspace, user)` cache:
 *
 * - **SharedWorker** (the normal case): every tab connects to the one worker,
 *   which holds the one engine, so all tabs share one connection and one cache
 *   (A003-T66).
 * - **Dedicated Worker** (where SharedWorker does not exist): each tab has its
 *   own worker over the same IndexedDB cache. One of them holds
 *   `navigator.locks` `vulto-sync:<workspace>:<user>` and is the leader that
 *   replicates and uploads; the others read the same database and are told of
 *   changes over `BroadcastChannel`.
 */
export interface HostPort {
  postMessage(message: WorkerMessage): void;
}

interface Session {
  readonly engine: SyncEngine;
  readonly channel: BroadcastChannel | null;
  readonly ports: Set<HostPort>;
  readonly subscriptions: Map<HostPort, Map<number, () => void>>;
  leader: boolean;
}

const sessions = new Map<string, Session>();

const lockName = (workspaceId: string, userId: string) =>
  `vulto-sync:${workspaceId}:${userId}`;

async function createSession(
  init: InitPayload,
  mode: "shared" | "dedicated",
): Promise<Session> {
  const name = cacheDatabaseName(init.workspaceId, init.userId);
  const deviceId = await getOrCreateDeviceId();
  const database: SyncDatabase = await openSyncDatabase({ kind: "idb", name });
  const api = createApiClient({ apiOrigin: init.apiOrigin });
  const channelName = lockName(init.workspaceId, init.userId);
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
  const ports = new Set<HostPort>();
  const engine: SyncEngine = new SyncEngine({
    workspaceId: init.workspaceId,
    userId: init.userId,
    database,
    api,
    deviceId,
    createShapeSource: (template, resume) =>
      createElectricSource({
        apiOrigin: init.apiOrigin,
        workspaceId: init.workspaceId,
        deviceId,
        template,
        resume,
      }),
    // Wipe the cache database, then every other tab's connection to it.
    eraseLocalData: async () => {
      channel?.postMessage({ type: "erase" });
      await engine.withDatabase((d) => d.close()).catch(() => undefined);
      await deleteIdbDatabase(name);
    },
    onCacheChanged: () => channel?.postMessage({ type: "changed" }),
  });

  const session: Session = {
    engine,
    channel,
    ports,
    subscriptions: new Map(),
    leader: mode === "shared",
  };

  engine.onState((state) => {
    for (const port of ports) port.postMessage({ event: "state", state });
  });

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const type = (event.data as { type?: string }).type;
      if (type === "erase") {
        void engine.withDatabase((d) => d.close()).catch(() => undefined);
      } else if (type === "changed") {
        // Another tab changed the shared cache: re-read it, and upload if we lead.
        void engine.refresh();
        if (session.leader) void engine.drain();
      }
    };
  }

  if (mode === "shared") {
    await engine.start();
  } else {
    await engine.startFollower();
    if ("locks" in navigator) {
      // Waits its turn; the lock is held for the life of the worker, so when the
      // leading tab closes the next one takes over.
      void navigator.locks.request(channelName, async () => {
        session.leader = true;
        await engine.promote();
        await new Promise<void>(() => undefined);
      });
    } else {
      session.leader = true;
      await engine.promote();
    }
  }
  return session;
}

/** Handles one request from a tab. Returns the reply for the tab to receive. */
export async function handleRequest(
  port: HostPort,
  request: WorkerRequest,
  mode: "shared" | "dedicated",
): Promise<WorkerResponse> {
  try {
    if (request.op === "init") {
      const key = lockName(request.payload.workspaceId, request.payload.userId);
      let session = sessions.get(key);
      if (!session) {
        session = await createSession(request.payload, mode);
        sessions.set(key, session);
      }
      session.ports.add(port);
      port.postMessage({ event: "state", state: session.engine.getState() });
      return { id: request.id, ok: true, data: session.engine.getState() };
    }
    const session = [...sessions.values()].find((s) => s.ports.has(port));
    if (!session) throw new Error("not initialized");
    const { engine } = session;
    switch (request.op) {
      case "query":
        return { id: request.id, ok: true, data: await engine.query(request.payload) };
      case "subscribe": {
        const perPort =
          session.subscriptions.get(port) ?? new Map<number, () => void>();
        session.subscriptions.set(port, perPort);
        const { subscriptionId, query } = request.payload;
        perPort.set(
          subscriptionId,
          engine.subscribe(query, (outcome) =>
            port.postMessage({ event: "query", subscriptionId, outcome }),
          ),
        );
        return { id: request.id, ok: true, data: null };
      }
      case "unsubscribe":
        session.subscriptions.get(port)?.get(request.payload.subscriptionId)?.();
        session.subscriptions.get(port)?.delete(request.payload.subscriptionId);
        return { id: request.id, ok: true, data: null };
      case "mutate":
        return {
          id: request.id,
          ok: true,
          data: await engine.mutate(request.payload.name, request.payload.args),
        };
      case "protectedRead":
        return {
          id: request.id,
          ok: true,
          data: await engine.protectedRead(request.payload.nodeIds),
        };
      case "prefetchProtected":
        await engine.prefetchProtected(request.payload.nodeIds);
        return { id: request.id, ok: true, data: null };
      case "dismissRejected":
        await engine.dismissRejected(request.payload.mutationId);
        return { id: request.id, ok: true, data: null };
      case "notifyOnline":
        engine.notifyOnline();
        return { id: request.id, ok: true, data: null };
      case "signOut":
        await engine.signOut();
        return { id: request.id, ok: true, data: null };
      case "dump":
        // Test support: what the cache tables hold, so a scan can prove no protected value is there.
        return {
          id: request.id,
          ok: true,
          data: await engine.withDatabase(async (d) => {
            const tables = await d.all(
              "SELECT name FROM sqlite_master WHERE type = 'table'",
            );
            const out: Record<string, unknown[]> = {};
            for (const { name } of tables)
              out[String(name)] = await d.all(`SELECT * FROM "${String(name)}"`);
            return out;
          }),
        };
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Forgets a tab that went away, so its subscriptions stop. */
export function detach(port: HostPort): void {
  for (const session of sessions.values()) {
    session.ports.delete(port);
    for (const cancel of session.subscriptions.get(port)?.values() ?? []) cancel();
    session.subscriptions.delete(port);
  }
}

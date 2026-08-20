import type { WorkspaceRole } from "@vulto/schema";
import {
  GRAPH_WORKER_PROTOCOL_VERSION,
  parseGraphWorkerResponse,
  type GraphAvailability,
  type GraphWorkerError,
  type GraphWorkerRequest,
  type GraphWorkerResponse,
  type GraphWorkerSuccess,
} from "./protocol";
import type { GraphQuery } from "./query";
import type { GraphQueryResult } from "./worker/storage/sqlite-graph-index";

export interface DeltaBatchResult {
  availability: GraphAvailability;
  mergedDeltaCount: number;
  materializationGeneration: number;
  workerDurationMs: number;
}

/**
 * FDN-53 stage 2 (F131). `mutate`'s three outcomes: authorized and
 * committed (`applied`, carrying the same fields `DeltaBatchResult` always
 * has), refused by `VPS-A004` Gate 1 (`denied`), or refused because the
 * batch touches state this stage cannot commit at all — an edge type, the
 * Movable Tree, or anything outside the node-fragment container (F132/F134,
 * `unsupported`). See `LocalGraphWorkerRuntime#mutate`'s doc comment for the
 * full simulate-then-diff-then-gate procedure this result comes from.
 */
export type MutationOutcome =
  | ({ readonly status: "applied" } & DeltaBatchResult)
  | { readonly status: "denied"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }
  /** F138: the batch itself is not applicable — no role could apply it. */
  | { readonly status: "invalid"; readonly reason: string };

export interface LocalGraphClient {
  readonly workspaceId: string;
  initialize(): Promise<GraphAvailability>;
  /**
   * FDN-53 stage 2: the real, permission-gated local WRITE path (F131) —
   * the write-side counterpart to `query` below. Replaces the pre-stage-2
   * `applyDeltaBatch`, which is no longer part of this interface; see F131
   * in `docs/Foundations_Findings.md`.
   */
  mutate(deltas: readonly Uint8Array[]): Promise<MutationOutcome>;
  getAvailability(): Promise<GraphAvailability>;
  switchWorkspace(workspaceId: string): Promise<GraphAvailability>;
  /** Requests the server's unlock half and derives the sealed-store key, entirely inside the Worker. */
  unlockSealedStore(apiOrigin: string): Promise<void>;
  /** FDN-87: `VPS-F001` G04's erase. The mechanism; the signal is FDN-63's. */
  eraseLocalStore(workspaceId: string): Promise<void>;
  /** Drops the sealed-store key from Worker memory without disposing the Worker. */
  lockSealedStore(): Promise<void>;
  getSealedStoreStatus(): Promise<{ locked: boolean }>;
  sealPayload(storeKey: string, plaintext: Uint8Array): Promise<void>;
  openPayload(storeKey: string): Promise<Uint8Array | null>;
  /**
   * FDN-53 stage 1: the first application-callable read path over graph
   * state (F105), permission-filtered per `VPS-A004` before it ever leaves
   * the Worker.
   */
  query(query: GraphQuery): Promise<GraphQueryResult>;
  /** F127's live role-refresh entrypoint: re-validates against the server and returns the caller's current roles. */
  refreshRole(): Promise<WorkspaceRole[]>;
  dispose(): Promise<void>;
}

interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

type WorkerFactory = () => WorkerPort;

interface PendingRequest {
  resolve: (response: GraphWorkerSuccess) => void;
  reject: (error: Error) => void;
}

export class GraphWorkerProtocolError extends Error {
  /**
   * The Worker's own error code, when this error came from a Worker error
   * response rather than from the client's own protocol checks.
   *
   * Carried as a field, not left buried in the message string, so a caller
   * distinguishes FDN-50 stage 3's
   * `document-schema-generation-unsupported` from the sealed-store codes and
   * from `not-initialized` by inspection rather than by matching prose.
   */
  readonly code: GraphWorkerError["error"]["code"] | null;

  constructor(message: string, code: GraphWorkerError["error"]["code"] | null = null) {
    super(message);
    this.name = "GraphWorkerProtocolError";
    this.code = code;
  }
}

function createBrowserWorker(): WorkerPort {
  return new Worker(new URL("./worker/entry.ts", import.meta.url), {
    name: "vulto-local-graph",
    type: "module",
  });
}

function now(): string {
  return new Date().toISOString();
}

function requestId(): string {
  return crypto.randomUUID();
}

class BrowserLocalGraphClient implements LocalGraphClient {
  #worker: WorkerPort;
  #workspaceId: string;
  #initialized = false;
  #disposed = false;
  /**
   * F142. Set whenever the Worker behind this client is torn down by a fatal
   * protocol error, and cleared only when a genuinely new Worker replaces it.
   *
   * Without it, a fatal error left this client with `#disposed === false` and
   * `#initialized === true`: the next call passed both guards, `postMessage`d
   * into a terminated thread, and returned a promise that NEVER SETTLED. Not
   * an error a caller could catch — a permanent, silent hang of every
   * subsequent query and mutation, reproduced end to end on the real stack
   * while proving F138. Failing fast with the original cause is the whole
   * fix: the caller learns the graph layer is gone, and why.
   */
  #fatalError: Error | null = null;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #workerFactory: WorkerFactory;

  constructor(workspaceId: string, workerFactory: WorkerFactory) {
    if (workspaceId.length === 0) throw new Error("workspaceId must not be empty");
    this.#workspaceId = workspaceId;
    this.#workerFactory = workerFactory;
    this.#worker = this.#createWorker();
  }

  get workspaceId(): string {
    return this.#workspaceId;
  }

  async initialize(): Promise<GraphAvailability> {
    this.#assertUsable();
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "initialize",
      workspaceId: this.#workspaceId,
    });
    if (response.result.kind !== "initialized") {
      throw this.#fatal("Worker returned the wrong result for initialize");
    }
    this.#initialized = true;
    return response.availability;
  }

  /**
   * FDN-53 stage 2 (F131). Demoted off the `LocalGraphClient` interface —
   * this method still exists on the concrete class only because
   * `@vulto/graph/testing/unchecked-mutation` widens the public type to
   * include it, for the pre-FDN-53 browser proofs that need synthetic,
   * non-schema-conformant CRDT bytes committed unchecked on this same
   * Worker instance. No application code should reach this; `mutate` below
   * is the gated entrypoint the public interface exposes instead.
   */
  async applyDeltaBatch(deltas: readonly Uint8Array[]): Promise<DeltaBatchResult> {
    this.#assertInitialized();
    if (deltas.length === 0) throw new Error("A delta batch must not be empty");

    const buffers = deltas.map((delta) => delta.slice().buffer);
    const response = await this.#send(
      {
        protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
        requestId: requestId(),
        sentAt: now(),
        type: "apply-delta-batch",
        deltas: buffers,
      },
      buffers,
    );
    if (response.result.kind !== "delta-batch-applied") {
      throw this.#fatal("Worker returned the wrong result for apply-delta-batch");
    }
    return {
      availability: response.availability,
      mergedDeltaCount: response.result.mergedDeltaCount,
      materializationGeneration: response.result.materializationGeneration,
      workerDurationMs: response.result.workerDurationMs,
    };
  }

  async mutate(deltas: readonly Uint8Array[]): Promise<MutationOutcome> {
    this.#assertInitialized();
    if (deltas.length === 0) throw new Error("A delta batch must not be empty");

    const buffers = deltas.map((delta) => delta.slice().buffer);
    const response = await this.#send(
      {
        protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
        requestId: requestId(),
        sentAt: now(),
        type: "mutate",
        deltas: buffers,
      },
      buffers,
    );
    switch (response.result.kind) {
      case "mutation-applied":
        return {
          status: "applied",
          availability: response.availability,
          mergedDeltaCount: response.result.mergedDeltaCount,
          materializationGeneration: response.result.materializationGeneration,
          workerDurationMs: response.result.workerDurationMs,
        };
      case "mutation-denied":
        return { status: "denied", reason: response.result.reason };
      case "mutation-unsupported":
        return { status: "unsupported", reason: response.result.reason };
      case "mutation-invalid":
        return { status: "invalid", reason: response.result.reason };
      default:
        throw this.#fatal("Worker returned the wrong result for mutate");
    }
  }

  async getAvailability(): Promise<GraphAvailability> {
    this.#assertInitialized();
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "get-availability",
    });
    if (response.result.kind !== "availability") {
      throw this.#fatal("Worker returned the wrong result for get-availability");
    }
    return response.availability;
  }

  /**
   * F139. Switching workspaces is a CLEAN, deliberate shutdown of the
   * previous workspace's Worker, so it flushes the debounce window exactly
   * the way `dispose()` does.
   *
   * It did not, before this fix: it called `#terminate()` directly, killing
   * the Worker thread and every timer inside it. Up to `FLUSH_DEBOUNCE_MS` of
   * already-acknowledged writes went with it — silently, and squarely outside
   * the hard-kill caveat `#scheduleFlush` explicitly accepted ("A clean
   * shutdown never loses this window: dispose() below flushes synchronously
   * before tearing down"). A user picking a different workspace from a menu
   * is not a crash.
   *
   * A Worker already torn down by a fatal error has nothing to flush and
   * cannot answer a `dispose` message, so that case still terminates
   * directly. A flush failure does not abandon the switch — the caller asked
   * to change workspace and ends up on the new one either way — but it is
   * re-thrown once the new workspace is live, because unflushed data on the
   * workspace just left is something the caller must be told about.
   */
  async switchWorkspace(workspaceId: string): Promise<GraphAvailability> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    if (workspaceId.length === 0) throw new Error("workspaceId must not be empty");

    let flushError: unknown = null;
    if (this.#initialized && this.#fatalError === null) {
      try {
        await this.dispose();
      } catch (error: unknown) {
        flushError = error;
      }
    } else {
      this.#terminate(new Error("Workspace changed"));
    }

    this.#workspaceId = workspaceId;
    this.#disposed = false;
    this.#initialized = false;
    this.#worker = this.#createWorker();
    const availability = await this.initialize();
    if (flushError !== null) throw flushError;
    return availability;
  }

  async unlockSealedStore(apiOrigin: string): Promise<void> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "unlock-sealed-store",
      workspaceId: this.#workspaceId,
      apiOrigin,
    });
    if (response.result.kind !== "sealed-store-unlocked") {
      throw this.#fatal("Worker returned the wrong result for unlock-sealed-store");
    }
  }

  async lockSealedStore(): Promise<void> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "lock-sealed-store",
    });
    if (response.result.kind !== "sealed-store-locked") {
      throw this.#fatal("Worker returned the wrong result for lock-sealed-store");
    }
  }

  async getSealedStoreStatus(): Promise<{ locked: boolean }> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "get-sealed-store-status",
    });
    if (response.result.kind !== "sealed-store-status") {
      throw this.#fatal("Worker returned the wrong result for get-sealed-store-status");
    }
    return { locked: response.result.locked };
  }

  async sealPayload(storeKey: string, plaintext: Uint8Array): Promise<void> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    const buffer = plaintext.slice().buffer;
    const response = await this.#send(
      {
        protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
        requestId: requestId(),
        sentAt: now(),
        type: "seal-payload",
        storeKey,
        plaintext: buffer,
      },
      [buffer],
    );
    if (response.result.kind !== "payload-sealed") {
      throw this.#fatal("Worker returned the wrong result for seal-payload");
    }
  }

  async openPayload(storeKey: string): Promise<Uint8Array | null> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "open-payload",
      storeKey,
    });
    if (response.result.kind !== "payload-opened") {
      throw this.#fatal("Worker returned the wrong result for open-payload");
    }
    return response.result.plaintext ? new Uint8Array(response.result.plaintext) : null;
  }

  async query(query: GraphQuery): Promise<GraphQueryResult> {
    this.#assertInitialized();
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "query",
      query,
    });
    // The result's own `kind` matches one of GraphQueryResult's four
    // variants directly (node-get/node-list/edge-neighbors/recursive-neighbors);
    // every other Worker result kind is a different message type entirely,
    // so anything else here is a Worker protocol violation.
    if (
      response.result.kind !== "node-get" &&
      response.result.kind !== "node-list" &&
      response.result.kind !== "edge-neighbors" &&
      response.result.kind !== "recursive-neighbors"
    ) {
      throw this.#fatal("Worker returned the wrong result for query");
    }
    return response.result;
  }

  async refreshRole(): Promise<WorkspaceRole[]> {
    this.#assertInitialized();
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: requestId(),
      sentAt: now(),
      type: "refresh-role",
    });
    if (response.result.kind !== "role-refreshed") {
      throw this.#fatal("Worker returned the wrong result for refresh-role");
    }
    return response.result.roles;
  }

  /**
   * FDN-87. `VPS-F001` G04's erase, exposed so the revocation orchestration
   * FDN-63 builds has something to call. This client decides nothing about
   * WHEN — see the protocol message's comment for why that boundary is real.
   */
  async eraseLocalStore(workspaceId: string): Promise<void> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    this.#assertWorkerAlive();
    const response = await this.#send({
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      type: "erase-local-store",
      workspaceId,
    });
    if (response.result.kind !== "local-store-erased") {
      throw this.#fatal("Worker returned the wrong result for erase-local-store");
    }
    // The Worker is back to its pre-initialize state, so this client must be
    // too — otherwise its own guard would refuse the re-initialize that a
    // device legitimately regaining access performs.
    this.#initialized = false;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    if (this.#initialized) {
      const response = await this.#send({
        protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
        requestId: requestId(),
        sentAt: now(),
        type: "dispose",
      });
      if (response.result.kind !== "disposed") {
        throw this.#fatal("Worker returned the wrong result for dispose");
      }
    }
    this.#disposed = true;
    this.#initialized = false;
    this.#terminate(new Error("Graph client disposed"));
  }

  #createWorker(): WorkerPort {
    // A new Worker is a clean slate: whatever killed the previous one has no
    // bearing on this one (F142).
    this.#fatalError = null;
    const worker = this.#workerFactory();
    worker.onmessage = (event) => this.#receive(event.data);
    worker.onerror = (event) => {
      this.#terminate(new Error(event.message || "The local graph Worker crashed"));
    };
    return worker;
  }

  #send(
    request: GraphWorkerRequest,
    transfer: Transferable[] = [],
  ): Promise<GraphWorkerSuccess> {
    return new Promise((resolve, reject) => {
      this.#pending.set(request.requestId, { resolve, reject });
      this.#worker.postMessage(request, transfer);
    });
  }

  #receive(value: unknown): void {
    let parsed: GraphWorkerResponse;
    try {
      parsed = parseGraphWorkerResponse(value);
    } catch {
      this.#terminate(
        new GraphWorkerProtocolError(
          "Worker response failed runtime protocol validation",
        ),
      );
      return;
    }
    if (parsed.type === "error") {
      const error = new GraphWorkerProtocolError(
        `${parsed.error.code}: ${parsed.error.message}`,
        parsed.error.code,
      );
      if (parsed.requestId !== null) {
        this.#pending.get(parsed.requestId)?.reject(error);
        this.#pending.delete(parsed.requestId);
      }
      if (parsed.error.fatal) this.#terminate(error);
      return;
    }

    const pending = this.#pending.get(parsed.requestId);
    if (!pending) {
      this.#terminate(
        new GraphWorkerProtocolError(
          `Worker replied to unknown request ${parsed.requestId}`,
        ),
      );
      return;
    }
    this.#pending.delete(parsed.requestId);
    pending.resolve(parsed);
  }

  #fatal(message: string): GraphWorkerProtocolError {
    const error = new GraphWorkerProtocolError(message);
    this.#terminate(error);
    return error;
  }

  #terminate(error: Error): void {
    this.#fatalError = error;
    this.#worker.terminate();
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("Graph client is disposed");
    this.#assertWorkerAlive();
    if (this.#initialized) throw new Error("Graph client is already initialized");
  }

  #assertInitialized(): void {
    if (this.#disposed) throw new Error("Graph client is disposed");
    this.#assertWorkerAlive();
    if (!this.#initialized) throw new Error("Graph client is not initialized");
  }

  /** F142: never post into a Worker that is already gone — that call would never return. */
  #assertWorkerAlive(): void {
    if (this.#fatalError !== null) {
      throw new GraphWorkerProtocolError(
        `The local graph Worker was terminated and cannot serve further requests: ${this.#fatalError.message}`,
      );
    }
  }
}

export function createLocalGraphClient(workspaceId: string): LocalGraphClient {
  return new BrowserLocalGraphClient(workspaceId, createBrowserWorker);
}

/** Package-private test seam; not exported from `@vulto/graph`. */
export function createLocalGraphClientWithFactory(
  workspaceId: string,
  workerFactory: WorkerFactory,
): LocalGraphClient {
  return new BrowserLocalGraphClient(workspaceId, workerFactory);
}

/**
 * FDN-53 stage 2 (F131). A `LocalGraphClient` widened to include the
 * demoted, unchecked `applyDeltaBatch` — the real production browser Worker
 * underneath is unchanged, so a caller of this type shares the exact same
 * document, materialization, and persistence behavior any application
 * caller would see, minus `mutate`'s permission gate.
 *
 * Reachable only via `@vulto/graph/testing/unchecked-mutation`, never from
 * `@vulto/graph`'s main entry point — the same subpath-boundary convention
 * `./testing`, `./testing/chain` and `./testing/permission` already use for
 * the other test-only surfaces this package exposes.
 */
export interface UncheckedLocalGraphClient extends LocalGraphClient {
  applyDeltaBatch(deltas: readonly Uint8Array[]): Promise<DeltaBatchResult>;
}

/** Backs `@vulto/graph/testing/unchecked-mutation`; not exported from `@vulto/graph`'s main entry point. */
export function createUncheckedLocalGraphClient(
  workspaceId: string,
): UncheckedLocalGraphClient {
  return new BrowserLocalGraphClient(workspaceId, createBrowserWorker);
}

/** Package-private test seam for `createUncheckedLocalGraphClient`, injectable with a fake Worker; not exported from `@vulto/graph`. */
export function createUncheckedLocalGraphClientWithFactory(
  workspaceId: string,
  workerFactory: WorkerFactory,
): UncheckedLocalGraphClient {
  return new BrowserLocalGraphClient(workspaceId, workerFactory);
}

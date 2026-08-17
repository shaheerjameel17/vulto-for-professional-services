import {
  GRAPH_WORKER_PROTOCOL_VERSION,
  parseGraphWorkerResponse,
  type GraphAvailability,
  type GraphWorkerRequest,
  type GraphWorkerResponse,
  type GraphWorkerSuccess,
} from "./protocol";

export interface DeltaBatchResult {
  availability: GraphAvailability;
  mergedDeltaCount: number;
  materializationGeneration: number;
  workerDurationMs: number;
}

export interface LocalGraphClient {
  readonly workspaceId: string;
  initialize(): Promise<GraphAvailability>;
  applyDeltaBatch(deltas: readonly Uint8Array[]): Promise<DeltaBatchResult>;
  getAvailability(): Promise<GraphAvailability>;
  switchWorkspace(workspaceId: string): Promise<GraphAvailability>;
  /** Requests the server's unlock half and derives the sealed-store key, entirely inside the Worker. */
  unlockSealedStore(apiOrigin: string): Promise<void>;
  /** Drops the sealed-store key from Worker memory without disposing the Worker. */
  lockSealedStore(): Promise<void>;
  getSealedStoreStatus(): Promise<{ locked: boolean }>;
  sealPayload(storeKey: string, plaintext: Uint8Array): Promise<void>;
  openPayload(storeKey: string): Promise<Uint8Array | null>;
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
  constructor(message: string) {
    super(message);
    this.name = "GraphWorkerProtocolError";
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

  async switchWorkspace(workspaceId: string): Promise<GraphAvailability> {
    if (this.#disposed) throw new Error("Graph client is disposed");
    if (workspaceId.length === 0) throw new Error("workspaceId must not be empty");
    this.#terminate(new Error("Workspace changed"));
    this.#workspaceId = workspaceId;
    this.#disposed = false;
    this.#initialized = false;
    this.#worker = this.#createWorker();
    return this.initialize();
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
    this.#worker.terminate();
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("Graph client is disposed");
    if (this.#initialized) throw new Error("Graph client is already initialized");
  }

  #assertInitialized(): void {
    if (this.#disposed) throw new Error("Graph client is disposed");
    if (!this.#initialized) throw new Error("Graph client is not initialized");
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

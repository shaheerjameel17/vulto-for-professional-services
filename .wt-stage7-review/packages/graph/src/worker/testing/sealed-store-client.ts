interface TestWorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export class TestingSealedStoreClient {
  readonly #worker: TestWorkerPort;
  readonly #pending = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor() {
    this.#worker = new Worker(new URL("./sealed-store-entry.ts", import.meta.url), {
      name: "vulto-test-sealed-store",
      type: "module",
    });
    this.#worker.onmessage = (event) => {
      const value = event.data as Record<string, unknown>;
      const requestId = typeof value.requestId === "string" ? value.requestId : "";
      const pending = this.#pending.get(requestId);
      if (!pending) return;
      this.#pending.delete(requestId);
      if (value.ok === true) pending.resolve(value);
      else pending.reject(new Error(String(value.error ?? "Test sealed-store failed")));
    };
    this.#worker.onerror = (event) => {
      const error = new Error(event.message || "Test sealed-store Worker crashed");
      for (const pending of this.#pending.values()) pending.reject(error);
      this.#pending.clear();
    };
  }

  async unlock(workspaceId: string, apiOrigin: string): Promise<void> {
    await this.#send({ type: "unlock", workspaceId, apiOrigin });
  }

  async lock(): Promise<void> {
    await this.#send({ type: "lock" });
  }

  async seal(storeKey: string, plaintext: Uint8Array): Promise<void> {
    const buffer = plaintext.slice().buffer;
    await this.#send({ type: "seal", storeKey, plaintext: buffer }, [buffer]);
  }

  async open(storeKey: string): Promise<Uint8Array | null> {
    const response = await this.#send({ type: "open", storeKey });
    return response.plaintext instanceof ArrayBuffer
      ? new Uint8Array(response.plaintext)
      : null;
  }

  async dispose(): Promise<void> {
    try {
      await this.#send({ type: "dispose" });
    } finally {
      this.#worker.terminate();
    }
  }

  #send(
    message: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<Record<string, unknown>> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
      this.#worker.postMessage({ ...message, requestId }, transfer);
    });
  }
}

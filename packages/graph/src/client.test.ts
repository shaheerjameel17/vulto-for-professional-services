import { describe, expect, it } from "vitest";
import { createLocalGraphClientWithFactory } from "./client";
import { GRAPH_WORKER_PROTOCOL_VERSION, type GraphWorkerRequest } from "./protocol";

class FakeWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  transferred: Transferable[] = [];

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const request = message as GraphWorkerRequest;
    this.transferred = transfer;
    const base = {
      protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      sentAt: "2026-08-17T12:00:00.000Z",
      type: "success" as const,
      availability: { state: "ready" as const },
    };
    const result =
      request.type === "initialize"
        ? { kind: "initialized" as const, workspaceId: request.workspaceId }
        : request.type === "apply-delta-batch"
          ? {
              kind: "delta-batch-applied" as const,
              mergedDeltaCount: request.deltas.length,
              materializationGeneration: 0,
              workerDurationMs: 10,
            }
          : request.type === "get-availability"
            ? { kind: "availability" as const }
            : { kind: "disposed" as const };
    queueMicrotask(() =>
      this.onmessage?.({ data: { ...base, result } } as MessageEvent),
    );
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("local graph client lifecycle", () => {
  it("initializes, transfers opaque deltas, and terminates on dispose", async () => {
    const worker = new FakeWorker();
    const client = createLocalGraphClientWithFactory("workspace-1", () => worker);

    await expect(client.initialize()).resolves.toEqual({ state: "ready" });
    await expect(
      client.applyDeltaBatch([new Uint8Array([1, 2, 3])]),
    ).resolves.toMatchObject({ mergedDeltaCount: 1, availability: { state: "ready" } });
    expect(worker.transferred).toHaveLength(1);
    expect(worker.transferred[0]).toBeInstanceOf(ArrayBuffer);

    await client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("terminates the old Worker before switching workspaces", async () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let index = 0;
    const client = createLocalGraphClientWithFactory(
      "workspace-1",
      () => workers[index++]!,
    );

    await client.initialize();
    await client.switchWorkspace("workspace-2");

    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.terminated).toBe(false);
    expect(client.workspaceId).toBe("workspace-2");
  });

  it("terminates on a malformed Worker response", async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => {
      queueMicrotask(() =>
        worker.onmessage?.({ data: { type: "surprise" } } as MessageEvent),
      );
    };
    const client = createLocalGraphClientWithFactory("workspace-1", () => worker);

    await expect(client.initialize()).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it("rejects pending work and terminates when the Worker crashes", async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => undefined;
    const client = createLocalGraphClientWithFactory("workspace-1", () => worker);

    const initialization = client.initialize();
    worker.onerror?.({ message: "worker crashed" } as ErrorEvent);

    await expect(initialization).rejects.toThrow("worker crashed");
    expect(worker.terminated).toBe(true);
  });

  it("does not allow a disposed client to be resurrected", async () => {
    const worker = new FakeWorker();
    const client = createLocalGraphClientWithFactory("workspace-1", () => worker);

    await client.initialize();
    await client.dispose();

    await expect(client.switchWorkspace("workspace-2")).rejects.toThrow(
      "Graph client is disposed",
    );
  });
});

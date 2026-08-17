import { z } from "zod";
import {
  GRAPH_WORKER_PROTOCOL_VERSION,
  graphWorkerRequestSchema,
  type GraphWorkerError,
  type GraphWorkerRequest,
  type GraphWorkerSuccess,
} from "../protocol";
import { LocalGraphWorkerRuntime } from "./runtime";

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
}

const scope = self as unknown as WorkerScope;
const runtime = new LocalGraphWorkerRuntime();
let work = Promise.resolve();

function sentAt(): string {
  return new Date().toISOString();
}

function success(
  request: GraphWorkerRequest,
  result: GraphWorkerSuccess["result"],
): GraphWorkerSuccess {
  return {
    protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
    requestId: request.requestId,
    sentAt: sentAt(),
    type: "success",
    availability: runtime.availability,
    result,
  };
}

function errorResponse(
  requestId: string | null,
  code: GraphWorkerError["error"]["code"],
  message: string,
  fatal: boolean,
): GraphWorkerError {
  return {
    protocolVersion: GRAPH_WORKER_PROTOCOL_VERSION,
    requestId,
    sentAt: sentAt(),
    type: "error",
    error: { code, message, fatal },
  };
}

async function handle(request: GraphWorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case "initialize": {
        if (runtime.workspaceId !== null) {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "already-initialized",
              "A local graph Worker may serve exactly one workspace",
              true,
            ),
          );
          return;
        }
        await runtime.initialize(request.workspaceId);
        scope.postMessage(
          success(request, {
            kind: "initialized",
            workspaceId: request.workspaceId,
          }),
        );
        return;
      }
      case "apply-delta-batch": {
        if (runtime.workspaceId === null) {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "not-initialized",
              "Initialize the Worker before applying deltas",
              true,
            ),
          );
          return;
        }
        const result = await runtime.applyDeltaBatch(request.deltas);
        scope.postMessage(success(request, { kind: "delta-batch-applied", ...result }));
        return;
      }
      case "get-availability": {
        if (runtime.workspaceId === null) {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "not-initialized",
              "Initialize the Worker before reading availability",
              true,
            ),
          );
          return;
        }
        scope.postMessage(success(request, { kind: "availability" }));
        return;
      }
      case "dispose": {
        await runtime.dispose();
        scope.postMessage(success(request, { kind: "disposed" }));
        scope.close();
      }
    }
  } catch (error) {
    scope.postMessage(
      errorResponse(
        request.requestId,
        "runtime-failure",
        error instanceof Error ? error.message : "Unknown Worker runtime failure",
        true,
      ),
    );
  }
}

scope.onmessage = (event) => {
  const requestIdResult = z
    .object({ requestId: z.string().min(1) })
    .safeParse(event.data);
  const versionResult = z.object({ protocolVersion: z.number() }).safeParse(event.data);
  const parsed = graphWorkerRequestSchema.safeParse(event.data);

  if (!parsed.success) {
    const isMismatch =
      versionResult.success &&
      versionResult.data.protocolVersion !== GRAPH_WORKER_PROTOCOL_VERSION;
    scope.postMessage(
      errorResponse(
        requestIdResult.success ? requestIdResult.data.requestId : null,
        isMismatch ? "protocol-mismatch" : "invalid-message",
        isMismatch
          ? `Unsupported graph Worker protocol version ${versionResult.data.protocolVersion}`
          : "Graph Worker request failed runtime validation",
        true,
      ),
    );
    return;
  }

  work = work.then(() => handle(parsed.data));
};

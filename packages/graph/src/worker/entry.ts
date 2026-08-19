import { z } from "zod";
import {
  GRAPH_WORKER_PROTOCOL_VERSION,
  graphWorkerRequestSchema,
  type GraphWorkerError,
  type GraphWorkerRequest,
  type GraphWorkerSuccess,
} from "../protocol";
import { UnsupportedDocumentSchemaGenerationError } from "./document-schema-gate";
import { RoleRefreshDeniedError } from "./permission/role-refresh";
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
        try {
          await runtime.initialize(request.workspaceId);
        } catch (error) {
          // FDN-50 stage 3: the document-level gate's refusal carries its
          // own code across the boundary rather than collapsing into the
          // generic runtime-failure the catch below would produce. Fatal,
          // because this Worker can never serve this workspace: there is no
          // retry, re-unlock, or re-sync that makes an older build able to
          // read a newer build's document.
          if (error instanceof UnsupportedDocumentSchemaGenerationError) {
            scope.postMessage(
              errorResponse(
                request.requestId,
                "document-schema-generation-unsupported",
                error.message,
                true,
              ),
            );
            return;
          }
          throw error;
        }
        scope.postMessage(
          success(request, {
            kind: "initialized",
            workspaceId: request.workspaceId,
          }),
        );
        return;
      }
      case "apply-delta-batch": {
        // FDN-53 stage 2 (F131): still no permission check, deliberately —
        // this case exists only for `@vulto/graph/testing/unchecked-mutation`,
        // never for `LocalGraphClient`. See `runtime.ts#applyDeltaBatch`'s
        // doc comment.
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
      case "mutate": {
        if (runtime.workspaceId === null) {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "not-initialized",
              "Initialize the Worker before mutating it",
              true,
            ),
          );
          return;
        }
        const outcome = await runtime.mutate(request.deltas);
        switch (outcome.status) {
          case "applied":
            scope.postMessage(
              success(request, {
                kind: "mutation-applied",
                mergedDeltaCount: outcome.mergedDeltaCount,
                materializationGeneration: outcome.materializationGeneration,
                workerDurationMs: outcome.workerDurationMs,
              }),
            );
            return;
          case "denied":
            scope.postMessage(
              success(request, { kind: "mutation-denied", reason: outcome.reason }),
            );
            return;
          case "unsupported":
            scope.postMessage(
              success(request, { kind: "mutation-unsupported", reason: outcome.reason }),
            );
            return;
          case "invalid":
            scope.postMessage(
              success(request, { kind: "mutation-invalid", reason: outcome.reason }),
            );
            return;
          default: {
            const exhaustive: never = outcome;
            throw new Error(`Unhandled mutation outcome: ${JSON.stringify(exhaustive)}`);
          }
        }
      }
      case "unlock-sealed-store": {
        try {
          await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
        } catch {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "sealed-store-denied",
              "The sealed local store could not be unlocked",
              false,
            ),
          );
          return;
        }
        scope.postMessage(success(request, { kind: "sealed-store-unlocked" }));
        return;
      }
      case "lock-sealed-store": {
        runtime.lockSealedStore();
        scope.postMessage(success(request, { kind: "sealed-store-locked" }));
        return;
      }
      case "get-sealed-store-status": {
        scope.postMessage(
          success(request, {
            kind: "sealed-store-status",
            locked: runtime.sealedStoreLocked,
          }),
        );
        return;
      }
      case "seal-payload": {
        try {
          await runtime.sealPayload(
            request.storeKey,
            new Uint8Array(request.plaintext),
          );
        } catch (error) {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "sealed-store-locked",
              error instanceof Error ? error.message : "The sealed store is locked",
              false,
            ),
          );
          return;
        }
        scope.postMessage(success(request, { kind: "payload-sealed" }));
        return;
      }
      case "open-payload": {
        try {
          const plaintext = await runtime.openPayload(request.storeKey);
          scope.postMessage(
            success(request, {
              kind: "payload-opened",
              plaintext: plaintext ? plaintext.slice().buffer : null,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown sealed store error";
          scope.postMessage(
            errorResponse(
              request.requestId,
              message.includes("locked")
                ? "sealed-store-locked"
                : "sealed-store-cannot-open",
              message,
              false,
            ),
          );
        }
        return;
      }
      case "query": {
        if (runtime.workspaceId === null) {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "not-initialized",
              "Initialize the Worker before querying it",
              true,
            ),
          );
          return;
        }
        const result = await runtime.executeQuery(request.query);
        // The interceptor's return type uses `readonly` arrays throughout
        // (SQLiteGraphIndex's own convention); the protocol's zod-inferred
        // result type does not carry that modifier. Structurally identical
        // data, so this is a readonly-to-mutable widening, not an unsafe cast.
        scope.postMessage(success(request, result as GraphWorkerSuccess["result"]));
        return;
      }
      case "refresh-role": {
        if (runtime.workspaceId === null) {
          scope.postMessage(
            errorResponse(
              request.requestId,
              "not-initialized",
              "Initialize the Worker before refreshing its role",
              true,
            ),
          );
          return;
        }
        try {
          await runtime.refreshRoleOnline(runtime.workspaceId);
        } catch (error) {
          // F148. A denial and a failure are different answers and must not
          // be reported with the same code. Only the first one means the
          // server ruled on this device and the sealed store is now locked.
          //
          // The bare `catch` this replaces also reported "the server denied
          // this device" for a refresh attempted on an ALREADY-locked store,
          // where `#apiOrigin` is null and no request is ever sent — telling
          // the caller about a server decision that never happened.
          const denied = error instanceof RoleRefreshDeniedError;
          scope.postMessage(
            errorResponse(
              request.requestId,
              denied ? "role-refresh-denied" : "role-refresh-unavailable",
              denied
                ? "The server denied this device's role refresh request"
                : "The role refresh checkpoint could not be reached",
              false,
            ),
          );
          return;
        }
        scope.postMessage(
          success(request, { kind: "role-refreshed", roles: [...runtime.roles] }),
        );
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

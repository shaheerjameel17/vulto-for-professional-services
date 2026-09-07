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
import { LocalGraphWorkerRuntime, PendingFlushDiscardedError } from "./runtime";

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
              success(request, {
                kind: "mutation-unsupported",
                reason: outcome.reason,
              }),
            );
            return;
          case "invalid":
            scope.postMessage(
              success(request, { kind: "mutation-invalid", reason: outcome.reason }),
            );
            return;
          default: {
            const exhaustive: never = outcome;
            throw new Error(
              `Unhandled mutation outcome: ${JSON.stringify(exhaustive)}`,
            );
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
          const sessionEnd = runtime.lastSessionEnd;
          // F144. A denial that also cost the caller acknowledged writes is
          // not the same event as a denial that cost nothing, and must not
          // report as one. The denial itself is still non-enumerating: this
          // code says what happened to THIS device's data, never why the
          // server refused.
          const discarded = denied && sessionEnd?.discardedWrites === true;
          // F151. Takes priority over `discarded`: once the local store is
          // ERASED, any writes it lost on the way are subsumed by the erase
          // rather than a separate fact worth its own code — the whole
          // workspace is gone locally either way, and reporting
          // `local-writes-discarded` here would understate what happened.
          const erased = denied && sessionEnd?.erased === true;
          const code = erased
            ? sessionEnd!.eraseReason === "device-revoked"
              ? "device-revoked"
              : "membership-revoked"
            : discarded
              ? "local-writes-discarded"
              : denied
                ? "role-refresh-denied"
                : "role-refresh-unavailable";
          const message = erased
            ? sessionEnd!.eraseReason === "device-revoked"
              ? "This device was revoked and its local store has been erased"
              : "This workspace's membership was revoked and this device's local store has been erased"
            : discarded
              ? "This device's access ended and writes that had been acknowledged were discarded"
              : denied
                ? "The server denied this device's role refresh request"
                : "The role refresh checkpoint could not be reached";
          scope.postMessage(errorResponse(request.requestId, code, message, false));
          return;
        }
        scope.postMessage(
          success(request, { kind: "role-refreshed", roles: [...runtime.roles] }),
        );
        return;
      }
      case "erase-local-store": {
        // FDN-87. The mechanism, reachable. Deliberately does NOT require an
        // initialized runtime or an unlocked store: a device that has lost
        // authority can never unlock again, which is exactly when erasing
        // matters. Erasing destroys ciphertext rather than reading it, so it
        // needs no key.
        await runtime.eraseLocalStore(request.workspaceId);
        scope.postMessage(success(request, { kind: "local-store-erased" }));
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
    // F144. A discarded durability window is a statement about DATA, not a
    // Worker fault, and it carries its own code rather than collapsing into
    // the generic runtime-failure that made it indistinguishable from an
    // ordinary locked store. Non-fatal on purpose: terminating the Worker
    // here is precisely what destroyed the report before anyone read it.
    if (error instanceof PendingFlushDiscardedError) {
      scope.postMessage(
        errorResponse(
          request.requestId,
          "local-writes-discarded",
          error.message,
          false,
        ),
      );
      return;
    }
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

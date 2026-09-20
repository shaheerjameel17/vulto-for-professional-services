/// <reference lib="webworker" />

import { auditEntrySchema } from "@vulto/schema";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { resolvePermissionDecision, type PolicyRole } from "../permission/policy-table";
import { LocalGraphWorkerRuntime } from "../runtime";

type Request =
  | { kind: "open"; workspaceId: string; apiOrigin: string }
  | { kind: "context" }
  | { kind: "lock" }
  | { kind: "reopen"; workspaceId: string; apiOrigin: string }
  | { kind: "decisions"; permutations: PolicyRole[][] }
  | { kind: "validate"; entries: unknown[] }
  | { kind: "dispose" };

let runtime: LocalGraphWorkerRuntime | null = null;

function currentRuntime(): LocalGraphWorkerRuntime {
  if (runtime === null) throw new Error("Audit context proof is not open");
  return runtime;
}

async function handle(request: Request): Promise<unknown> {
  if (request.kind === "open") {
    await initializeLoro();
    runtime = new LocalGraphWorkerRuntime();
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    return {
      context: runtime.authenticatedWorkerContext(),
      deviceId: await runtime.deviceIdForDiagnostics(),
    };
  }
  if (request.kind === "context") {
    return currentRuntime().authenticatedWorkerContext();
  }
  if (request.kind === "lock") {
    currentRuntime().lockSealedStore();
    try {
      currentRuntime().authenticatedWorkerContext();
      return { contextAvailable: true };
    } catch {
      return { contextAvailable: false };
    }
  }
  if (request.kind === "reopen") {
    await currentRuntime().unlockSealedStore(request.workspaceId, request.apiOrigin);
    return currentRuntime().authenticatedWorkerContext();
  }
  if (request.kind === "decisions") {
    return request.permutations.map((roles) =>
      resolvePermissionDecision(roles, "AuditEntry", "record"),
    );
  }
  if (request.kind === "validate") {
    return request.entries.map((entry) => auditEntrySchema.safeParse(entry).success);
  }
  await currentRuntime().dispose();
  runtime = null;
  return { disposed: true };
}

self.onmessage = (event: MessageEvent<Request>) => {
  void handle(event.data).then(
    (result) => self.postMessage({ ok: true, result }),
    (error: unknown) =>
      self.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
};

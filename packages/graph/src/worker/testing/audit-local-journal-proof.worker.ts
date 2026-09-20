/// <reference lib="webworker" />

import type { GraphQuery } from "../../query";
import { LocalGraphWorkerRuntime } from "../runtime";
import {
  AUDIT_LOCAL_IDS,
  buildAuditLocalSeed,
  buildAuthorizedFailureMutation,
  buildDeniedMutation,
  buildTier1EdgeMutation,
  buildTier1Mutation,
} from "./audit-local-journal-proof";

type Request =
  | { kind: "open"; workspaceId: string; apiOrigin: string }
  | { kind: "seed" }
  | { kind: "query-tier"; tier: 0 | 1 | 2 | 3 }
  | { kind: "query-tier-list"; tier: 0 | 1 }
  | { kind: "query-skill" }
  | { kind: "snapshot" }
  | { kind: "append-audit-for-cache-proof"; entry: unknown }
  | { kind: "flush-outbox" }
  | {
      kind: "pseudonymize-actor";
      workspaceId: string;
      currentActorUserId: string;
      opaqueActorToken: string;
    }
  | { kind: "reopen-journal" }
  | { kind: "prove-idempotency" }
  | { kind: "lock" }
  | { kind: "reunlock"; workspaceId: string; apiOrigin: string }
  | { kind: "abort-next-audit" }
  | { kind: "force-authorized-failure" }
  | { kind: "mutate-tier1" }
  | { kind: "mutate-tier1-edge" }
  | { kind: "mutate-denied" }
  | { kind: "measure"; count: number }
  | { kind: "dispose" };

let runtime: LocalGraphWorkerRuntime | null = null;
let workspaceId: string | null = null;

function current(): LocalGraphWorkerRuntime {
  if (runtime === null) throw new Error("Audit local-journal proof is not open");
  return runtime;
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function queryForTier(tier: 0 | 1 | 2 | 3): GraphQuery {
  const nodeType = [
    "HeadcountSnapshot",
    "RateCard",
    "FlightRiskSignal",
    "WellnessTriggerEvent",
  ][tier] as
    "HeadcountSnapshot" | "RateCard" | "FlightRiskSignal" | "WellnessTriggerEvent";
  const nodeId = [
    AUDIT_LOCAL_IDS.tier0,
    AUDIT_LOCAL_IDS.tier1,
    AUDIT_LOCAL_IDS.tier2,
    AUDIT_LOCAL_IDS.tier3,
  ][tier]!;
  return { kind: "node-get", nodeType, nodeId, includeSoftDeleted: false };
}

async function handle(request: Request): Promise<unknown> {
  if (request.kind === "open") {
    workspaceId = request.workspaceId;
    runtime = new LocalGraphWorkerRuntime();
    await runtime.unlockSealedStore(request.workspaceId, request.apiOrigin);
    await runtime.initialize(request.workspaceId);
    return runtime.authenticatedWorkerContext();
  }
  if (request.kind === "seed") {
    const id = workspaceId;
    if (id === null) throw new Error("workspace missing");
    return current().applyDeltaBatch([exactBuffer(buildAuditLocalSeed(id))]);
  }
  if (request.kind === "query-tier") {
    const result = await current().executeQuery(queryForTier(request.tier));
    return {
      result,
      appendDurationMs: current().auditLastAppendDurationForDiagnostics(),
    };
  }
  if (request.kind === "query-tier-list") {
    const nodeType = request.tier === 0 ? "HeadcountSnapshot" : "RateCard";
    return current().executeQuery({
      kind: "node-list",
      nodeType,
      limit: 50,
      includeSoftDeleted: false,
    });
  }
  if (request.kind === "query-skill") {
    return current().executeQuery({
      kind: "node-get",
      nodeType: "Skill",
      nodeId: AUDIT_LOCAL_IDS.skill,
      includeSoftDeleted: false,
    });
  }
  if (request.kind === "snapshot") return current().auditSnapshotForDiagnostics();
  if (request.kind === "append-audit-for-cache-proof") {
    return current().appendAuditEntryForDiagnostics(request.entry);
  }
  if (request.kind === "flush-outbox") {
    return current().flushAuditOutboxForDiagnostics();
  }
  if (request.kind === "pseudonymize-actor") {
    return current().pseudonymizeAuditActorForDiagnostics(
      request.workspaceId,
      request.currentActorUserId,
      request.opaqueActorToken,
    );
  }
  if (request.kind === "reopen-journal") {
    return current().reopenAuditJournalForDiagnostics();
  }
  if (request.kind === "prove-idempotency") {
    return current().proveAuditIdempotencyForDiagnostics();
  }
  if (request.kind === "lock") {
    current().lockSealedStore();
    return { locked: true };
  }
  if (request.kind === "reunlock") {
    await current().unlockSealedStore(request.workspaceId, request.apiOrigin);
    return current().authenticatedWorkerContext();
  }
  if (request.kind === "abort-next-audit") {
    current().abortNextAuditTransactionForDiagnostics();
    return { armed: true };
  }
  if (request.kind === "force-authorized-failure") {
    const id = workspaceId;
    if (id === null) throw new Error("workspace missing");
    current().failNextAuthorizedOperationForAuditProof();
    try {
      await current().mutate([exactBuffer(buildAuthorizedFailureMutation(id))]);
      return { failed: false };
    } catch (error) {
      return {
        failed: true,
        callerError: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (request.kind === "mutate-tier1") {
    const id = workspaceId;
    if (id === null) throw new Error("workspace missing");
    return current().mutate([exactBuffer(buildTier1Mutation(id))]);
  }
  if (request.kind === "mutate-tier1-edge") {
    return current().mutate([exactBuffer(buildTier1EdgeMutation())]);
  }
  if (request.kind === "mutate-denied") {
    const id = workspaceId;
    if (id === null) throw new Error("workspace missing");
    return current().mutate([exactBuffer(buildDeniedMutation(id))]);
  }
  if (request.kind === "measure") {
    const durations: number[] = [];
    for (let index = 0; index < request.count; index += 1) {
      await current().executeQuery(queryForTier(1));
      const duration = current().auditLastAppendDurationForDiagnostics();
      if (duration !== null) durations.push(duration);
    }
    return { durations };
  }
  await current().dispose();
  runtime = null;
  workspaceId = null;
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

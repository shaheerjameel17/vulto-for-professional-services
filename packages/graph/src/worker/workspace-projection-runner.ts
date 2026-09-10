import type { WorkspaceRole } from "@vulto/schema";
import initializeLoro from "loro-crdt/web/loro_wasm.js";
import { LocalGraphWorkerRuntime } from "./runtime";
import {
  acceptProjectionGrant,
  acceptTransitionGrant,
  type ProjectionKind,
  type WorkspaceProjectionOutboxEntry,
} from "./workspace-projection";
import {
  projectMembershipRevocation,
  projectMembershipRoleChange,
  projectWorkspaceAdmission,
} from "./workspace-projection-delta";

/**
 * FDN-85 Stage 4 — the sealed-store wiring for a projection command.
 *
 * The founding-admission projection runs in a **projection-only runtime**: a
 * fresh `LocalGraphWorkerRuntime` opened with the grant's server unlock-secret
 * half, used for exactly one `commitPrivilegedProjection`, then disposed. The
 * instance is a function-local `const` here — it is never returned to a
 * caller and never assigned to a field — so the still-`pending` membership it
 * opened for cannot be used for an ordinary `mutate` through any surviving
 * handle. `dispose()` flushes the projection durably (synchronous drain)
 * before tearing the instance down; no sync-engine acknowledgment is awaited
 * (founder ruling Q1d — `#enqueueLocalDeltasForSync` is fire-and-forget).
 */

export interface ConsumedProjectionInput {
  kind: ProjectionKind;
  workspaceId: string;
  membershipId: string;
  deviceId: string;
  roles: readonly WorkspaceRole[];
  /** Only for `admission`. */
  userId?: string;
  membershipOfEdgeId?: string;
  membershipInEdgeId?: string;
  /** The grant's unlock half. */
  serverHalf: string;
  keyEpoch: number;
}

export interface ProjectionDetailsInput {
  workspaceName: string;
  actorUserId: string;
  occurredAt: string;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function buildProjection(
  input: ConsumedProjectionInput,
  details: ProjectionDetailsInput,
) {
  if (input.kind === "admission") {
    if (
      input.userId === undefined ||
      input.membershipOfEdgeId === undefined ||
      input.membershipInEdgeId === undefined
    ) {
      throw new Error("An admission projection needs userId and both edge ids");
    }
    return projectWorkspaceAdmission(
      acceptProjectionGrant({
        workspaceId: input.workspaceId,
        membershipId: input.membershipId,
        userId: input.userId,
        roles: input.roles,
        membershipOfEdgeId: input.membershipOfEdgeId,
        membershipInEdgeId: input.membershipInEdgeId,
      }),
      details,
    );
  }
  const grant = acceptTransitionGrant({
    kind: input.kind,
    workspaceId: input.workspaceId,
    membershipId: input.membershipId,
    roles: input.roles,
  });
  return input.kind === "revocation"
    ? projectMembershipRevocation(grant, details)
    : projectMembershipRoleChange(grant, details);
}

/**
 * Opens a bounded projection-only runtime, commits the one projection delta,
 * flushes it durably, and disposes the runtime. Returns the outbox entry
 * (marked `committedLocally`) for the reconciler to confirm.
 */
export async function runWorkspaceProjection(
  input: ConsumedProjectionInput,
  details: ProjectionDetailsInput,
): Promise<{ outboxEntry: WorkspaceProjectionOutboxEntry }> {
  await initializeLoro();
  const projection = buildProjection(input, details);
  const runtime = new LocalGraphWorkerRuntime();
  try {
    await runtime.unlockSealedStoreForProjection({
      workspaceId: input.workspaceId,
      deviceId: input.deviceId,
      serverHalf: input.serverHalf,
      keyEpoch: input.keyEpoch,
      membershipId: input.membershipId,
      roles: input.roles,
    });
    await runtime.initialize(input.workspaceId);
    await runtime.commitPrivilegedProjection(bufferOf(projection.delta));
    return { outboxEntry: { ...projection.outboxEntry, committedLocally: true } };
  } finally {
    // Synchronous durable drain, then full teardown. The instance never
    // escapes this function.
    await runtime.dispose();
  }
}

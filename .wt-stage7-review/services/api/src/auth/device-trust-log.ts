import type { DeviceTrustEventType } from "@vulto/schema";
import { db } from "../db.js";
import { deviceTrustEvent } from "./schema.js";

/**
 * FDN-63 Stage 2 — the append-only device/trust audit log writer.
 *
 * Its own module, importing only `db` and the schema, so both
 * `device-registry.ts` and `workspace-session.ts` can record events without a
 * circular import between them.
 */

/**
 * Any Drizzle executor — the top-level `db` or a transaction handle — so a
 * trust event enlists in the same transaction as the state change it records.
 */
export type DbExecutor =
  typeof db | Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export interface TrustEvent {
  deviceId: string;
  userId: string;
  workspaceId?: string | null;
  eventType: DeviceTrustEventType;
  actorUserId?: string | null;
  reason?: string | null;
}

/**
 * Append one row to the immutable device/trust log. There is no update or
 * delete path anywhere for this table — the log is the audit trail for every
 * registration, trust decision and revocation.
 */
export async function recordTrustEvent(
  executor: DbExecutor,
  event: TrustEvent,
): Promise<void> {
  await executor.insert(deviceTrustEvent).values({
    deviceId: event.deviceId,
    userId: event.userId,
    workspaceId: event.workspaceId ?? null,
    eventType: event.eventType,
    actorUserId: event.actorUserId ?? null,
    reason: event.reason ?? null,
  });
}

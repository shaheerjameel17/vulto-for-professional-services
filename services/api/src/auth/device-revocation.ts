import { uuidV4Schema } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { parseDeviceId } from "./device-revocation-store.js";
import { recordTrustEvent } from "./device-trust-log.js";
import { device, deviceWorkspaceRevocation, member } from "./schema.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
} from "./workspace-session.js";

export { parseDeviceId };

/**
 * Non-enumerating, matching every other device checkpoint's denial shape: this is
 * the session-level guard (is the caller allowed to revoke at all).
 */
export class DeviceRevokeDeniedError extends Error {
  constructor() {
    super("This session is not authorized to revoke devices in this workspace");
  }
}

export interface DeviceRevokeRequest {
  workspaceId: string;
  deviceId: string;
  /**
   * `"stale"` records the revocation as `stale-flagged` rather than
   * `revoked-explicit`, which is the one reason an Owner may later reverse
   * (`reapproveStaleDevice`). Anything else is a deliberate, irreversible
   * judgment about the device.
   */
  reason?: "stale";
}

export function parseDeviceRevokeRequest(value: unknown): DeviceRevokeRequest {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid request body");
  const record = value as Record<string, unknown>;
  if (record.reason !== undefined && record.reason !== "stale") {
    throw new Error("Invalid revocation reason");
  }
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    deviceId: parseDeviceId(record.deviceId),
    reason: record.reason,
  };
}

/**
 * F151/FDN-63. `VPS-F001`'s Devices-table Revoke action: an explicit,
 * single-device revocation. The device may belong to a DIFFERENT member of the
 * workspace ("wipes a colleague's local data"), so it is gated to `owner`.
 *
 * Idempotent: revoking an already-revoked device, or one that does not belong to
 * a member of this workspace, succeeds silently, so a second click is never a
 * visible failure and nothing is enumerated.
 *
 * **STRICTLY WORKSPACE-SCOPED (F191).** It writes one `device_workspace_revocation`
 * row for THIS workspace and nothing else: it never touches `device.is_revoked`,
 * which spans workspaces. Only the device's own user may retire a device
 * globally (`retireOwnDevice`).
 *
 * A `revoked-explicit` (or `stale-flagged`) trust event is written in the same
 * transaction, carrying this workspace's id.
 */
export async function revokeDevice(
  headers: Headers,
  workspaceIdInput: string,
  deviceIdInput: string,
  options?: { readonly stale?: boolean },
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(workspaceIdInput);
  const deviceId = parseDeviceId(deviceIdInput);

  let current;
  try {
    current = await requireCurrentWorkspaceSession(headers, workspaceId);
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) {
      throw new DeviceRevokeDeniedError();
    }
    throw error;
  }
  if (!current.roles.includes("owner")) {
    throw new DeviceRevokeDeniedError();
  }

  await db.transaction(async (tx) => {
    // Only a device of a member of this workspace can be revoked here.
    const [target] = await tx
      .select({ userId: device.userId })
      .from(device)
      .innerJoin(
        member,
        and(eq(member.userId, device.userId), eq(member.organizationId, workspaceId)),
      )
      .where(eq(device.id, deviceId))
      .limit(1);
    if (!target) return;

    const [revoked] = await tx
      .insert(deviceWorkspaceRevocation)
      .values({
        workspaceId,
        deviceId,
        revokedBy: current.userId,
        reason: options?.stale ? "stale" : "explicit",
      })
      .onConflictDoNothing()
      .returning({ deviceId: deviceWorkspaceRevocation.deviceId });

    // Only log when this call is the one that revoked something.
    if (revoked) {
      await recordTrustEvent(tx, {
        deviceId,
        userId: target.userId,
        workspaceId,
        eventType: options?.stale ? "stale-flagged" : "revoked-explicit",
        actorUserId: current.userId,
      });
    }
  });
}

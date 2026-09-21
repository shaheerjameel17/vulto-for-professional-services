import { and, eq, sql } from "drizzle-orm";
import type { db } from "../db.js";
import { deviceWorkspaceRevocation } from "./schema.js";

/**
 * The rows of `device_workspace_revocation` and the ways they are written and
 * read (F191, F210). One table records every way a device stops being
 * acceptable in one workspace: an Owner's explicit revoke, a staleness revoke, a
 * membership removal and an account suspension. The session path and the shape
 * proxy both read it through `isDeviceRevokedInWorkspace`; nothing else decides
 * this. Kept free of the session module so that module can use it.
 */

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function parseDeviceId(value: unknown): string {
  if (typeof value !== "string" || !DEVICE_ID_PATTERN.test(value)) {
    throw new Error("Invalid device identifier");
  }
  return value;
}

type Executor = Pick<typeof db, "select" | "insert" | "delete" | "execute">;

export type DeviceRevocationReason =
  "explicit" | "stale" | "membership-revoked" | "user-suspended";

/** True when the workspace has revoked this device. */
export async function isDeviceRevokedInWorkspace(
  executor: Pick<typeof db, "select">,
  workspaceId: string,
  deviceId: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ deviceId: deviceWorkspaceRevocation.deviceId })
    .from(deviceWorkspaceRevocation)
    .where(
      and(
        eq(deviceWorkspaceRevocation.workspaceId, workspaceId),
        eq(deviceWorkspaceRevocation.deviceId, deviceId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Revokes every registered device of `userId` in one workspace. Used when the
 * person's membership is removed. Idempotent. Workspace-scoped on purpose (F191):
 * it never touches the canonical `device.is_revoked`, which spans workspaces.
 */
export async function revokeUserDevicesInWorkspace(
  executor: Executor,
  input: {
    workspaceId: string;
    userId: string;
    reason: DeviceRevocationReason;
    revokedBy: string | null;
  },
): Promise<void> {
  await executor.execute(sql`
    INSERT INTO device_workspace_revocation (workspace_id, device_id, revoked_by, reason)
    SELECT ${input.workspaceId}::uuid, d.id, ${input.revokedBy}::uuid, ${input.reason}
    FROM device d
    WHERE d.user_id = ${input.userId}::uuid
    ON CONFLICT DO NOTHING
  `);
}

/** Revokes every registered device of `userId` in every workspace they belong to (account suspension). */
export async function revokeUserDevicesEverywhere(
  executor: Executor,
  input: { userId: string; reason: DeviceRevocationReason },
): Promise<void> {
  await executor.execute(sql`
    INSERT INTO device_workspace_revocation (workspace_id, device_id, reason)
    SELECT m.organization_id, d.id, ${input.reason}
    FROM member m
    JOIN device d ON d.user_id = m.user_id
    WHERE m.user_id = ${input.userId}::uuid
    ON CONFLICT DO NOTHING
  `);
}

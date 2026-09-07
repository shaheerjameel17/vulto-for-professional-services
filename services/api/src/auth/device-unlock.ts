import { randomBytes } from "node:crypto";
import { uuidV4Schema, type WorkspaceRole } from "@vulto/schema";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db.js";
import { auth } from "./config.js";
import { deviceUnlockSecret, member, user } from "./schema.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
} from "./workspace-session.js";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function parseDeviceId(value: unknown): string {
  if (typeof value !== "string" || !DEVICE_ID_PATTERN.test(value)) {
    throw new Error("Invalid device identifier");
  }
  return value;
}

export interface DeviceStoreUnlockRequest {
  workspaceId: string;
  deviceId: string;
}

export function parseDeviceStoreUnlockRequest(
  value: unknown,
): DeviceStoreUnlockRequest {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid request body");
  const record = value as Record<string, unknown>;
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    deviceId: parseDeviceId(record.deviceId),
  };
}

/**
 * Non-enumerating: callers cannot distinguish "no session," "wrong
 * workspace," "revoked membership" or "device secret revoked" from this
 * error alone, matching UnauthorizedWorkspaceSessionError's shape.
 */
export class DeviceUnlockDeniedError extends Error {
  constructor() {
    super("This device is not authorized to unlock the local store");
  }
}

export interface DeviceUnlockEnvelope {
  workspaceId: string;
  deviceId: string;
  keyEpoch: number;
  algorithm: "AES-GCM-256";
  createdAt: string;
}

/**
 * FDN-53 stage 1 (F127, F128 candidate). `roles` and `membershipId` are
 * siblings of `envelope`, deliberately not folded into it: `envelope` is
 * durable on-disk contract on the device side (`SealedStore.unlock()`
 * persists it to IndexedDB to detect a workspace/key-epoch mismatch on a
 * later unlock), and role data must never behave that way — it is a live
 * fact from THIS `requireCurrentWorkspaceSession` call, held only in the
 * Worker's memory, and refreshed independently of the envelope by the
 * role-refresh endpoint below.
 */
export interface DeviceUnlockGrant {
  serverHalf: string;
  envelope: DeviceUnlockEnvelope;
  roles: WorkspaceRole[];
  membershipId: string;
}

function toGrant(
  row: {
    workspaceId: string;
    deviceId: string;
    keyEpoch: number;
    serverHalf: string;
    createdAt: Date;
  },
  roles: WorkspaceRole[],
  membershipId: string,
): DeviceUnlockGrant {
  return {
    serverHalf: row.serverHalf,
    envelope: {
      workspaceId: row.workspaceId,
      deviceId: row.deviceId,
      keyEpoch: row.keyEpoch,
      algorithm: "AES-GCM-256",
      createdAt: row.createdAt.toISOString(),
    },
    roles,
    membershipId,
  };
}

/**
 * The server-side checkpoint FDN-84's unlock flow calls. Validates the
 * current authenticated session against the requested workspace via
 * requireCurrentWorkspaceSession (FDN-60), then releases the server half
 * of a two-part unlock secret for the given device. The device combines
 * this with its own locally held half (useless alone) to derive the
 * AES-256-GCM key that opens the sealed local store, entirely in Worker
 * memory. This function never sees or produces the storage key itself.
 */
export async function requestDeviceUnlock(
  headers: Headers,
  workspaceIdInput: string,
  deviceIdInput: string,
): Promise<DeviceUnlockGrant> {
  const workspaceId = uuidV4Schema.parse(workspaceIdInput);
  const deviceId = parseDeviceId(deviceIdInput);

  let current;
  try {
    current = await requireCurrentWorkspaceSession(headers, workspaceId);
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) {
      throw new DeviceUnlockDeniedError();
    }
    throw error;
  }

  const [existing] = await db
    .select()
    .from(deviceUnlockSecret)
    .where(
      and(
        eq(deviceUnlockSecret.workspaceId, current.workspaceId),
        eq(deviceUnlockSecret.deviceId, deviceId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.revokedAt !== null || existing.userId !== current.userId) {
      throw new DeviceUnlockDeniedError();
    }
    return toGrant(existing, current.roles, current.membershipId);
  }

  const serverHalf = randomBytes(32).toString("base64");
  const [created] = await db
    .insert(deviceUnlockSecret)
    .values({
      workspaceId: current.workspaceId,
      userId: current.userId,
      deviceId,
      serverHalf,
      keyEpoch: 1,
    })
    .returning();

  if (!created) throw new DeviceUnlockDeniedError();
  return toGrant(created, current.roles, current.membershipId);
}

export interface DeviceRoleRefreshRequest {
  workspaceId: string;
  /** F151. Optional for backward compatibility; every real client sends it. */
  deviceId?: string;
}

export interface DeviceRoleRefreshResult {
  roles: WorkspaceRole[];
  membershipId: string;
}

export function parseDeviceRoleRefreshRequest(
  value: unknown,
): DeviceRoleRefreshRequest {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid request body");
  const record = value as Record<string, unknown>;
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    deviceId:
      record.deviceId === undefined ? undefined : parseDeviceId(record.deviceId),
  };
}

/**
 * F151 (FDN-63, FDN-87). The two, and only two, positive events this
 * project's specs name as revocation: an explicit single-device revocation
 * (`VPS-F001`'s Devices-table Revoke action) and a membership revocation or
 * account offboarding (A003-T16 — "a demotion or role change removing Tier
 * 1 authorization is a revocation event in its own right"). Nothing else
 * may produce either value: a session merely expiring, a transient server
 * failure, or a pending/unconfirmed membership all fall through to
 * `undefined`, the same conservative default F148 already proved correct
 * for locking. Extending that default to erasing is the whole point of this
 * type — an erase-eligible reason must be exactly as hard to reach by
 * accident as a lock-eligible one was made to be.
 */
export type DeviceRoleRefreshDenialReason = "device-revoked" | "membership-revoked";

/**
 * Distinct from `DeviceUnlockDeniedError` deliberately: the unlock
 * checkpoint denies with no further meaning (a first unlock either
 * succeeds or it does not), but this checkpoint's denial can carry a
 * classified `reason` an already-unlocked caller may act on — see
 * `LocalGraphWorkerRuntime#endLocalSession`, which erases the local store
 * only when `reason` is one of the two values above, never on `undefined`.
 */
export class DeviceRoleRefreshDeniedError extends Error {
  constructor(readonly reason?: DeviceRoleRefreshDenialReason) {
    super("This device is not authorized to refresh its role in this workspace");
  }
}

/**
 * Classifies WHY `requireCurrentWorkspaceSession` already denied — never an
 * authorization decision itself, since the denial has already happened by
 * the time this runs. Queries `member.status` and `user.status`
 * INDEPENDENTLY, using their own positive values, never an absence: a
 * merely-expired session, a transiently unreachable database, or a
 * pending/unconfirmed membership all resolve to `undefined` here, by
 * construction, because none of those states ever writes `'revoked'` or
 * `'suspended'` into either column.
 *
 * `user.status === 'suspended'` is folded into `'membership-revoked'`
 * rather than given a third value: `suspendUserAndRevokeSessions` already
 * revokes every device-unlock secret and deletes every session for that
 * user, identically to a workspace-membership revocation's own cascade —
 * this codebase's own model already treats account suspension as
 * offboarding, not as a distinct milder condition. Named explicitly here so
 * the choice is checkable rather than assumed.
 */
async function classifyRevocationReason(
  headers: Headers,
  workspaceId: string,
): Promise<DeviceRoleRefreshDenialReason | undefined> {
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!current) return undefined;

  const [row] = await db
    .select({ memberStatus: member.status, userStatus: user.status })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(
      and(eq(member.userId, current.user.id), eq(member.organizationId, workspaceId)),
    )
    .limit(1);

  if (row?.memberStatus === "revoked" || row?.userStatus === "suspended") {
    return "membership-revoked";
  }
  return undefined;
}

/**
 * F127's live role-refresh checkpoint (FDN-53 stage 1). A minimal,
 * lightweight sibling of `requestDeviceUnlock` above: it reuses the exact
 * same `requireCurrentWorkspaceSession` revalidation — current database
 * session, active user, exact workspace, active confirmed membership — but
 * releases no server-half and derives no key. It exists so an already
 * unlocked, still-online Worker can learn of a narrowing role change
 * without a full re-unlock, per `VPS-F001`'s Security Considerations
 * (F127): a role narrowing must reach a live session within the same
 * bound already specified for device wipe, not only at the next cold
 * restart.
 *
 * F151 extends it with a second, independent check once membership is
 * already confirmed valid: whether THIS SPECIFIC device's own unlock
 * secret has been revoked (`VPS-F001`'s single-device Revoke action) even
 * though the user's membership itself is otherwise fine — the "wipes a
 * colleague's local data" case, distinct from a workspace-wide membership
 * revocation.
 *
 * The two checks are deliberately ordered broader-first: a membership
 * revocation also revokes every device's secret as part of the same
 * transaction (`revokeWorkspaceAdmission`), so if BOTH are true, the wider,
 * more informative reason is reported.
 */
export async function requestDeviceRoleRefresh(
  headers: Headers,
  workspaceIdInput: string,
  deviceIdInput?: string,
): Promise<DeviceRoleRefreshResult> {
  const workspaceId = uuidV4Schema.parse(workspaceIdInput);
  const deviceId =
    deviceIdInput === undefined ? undefined : parseDeviceId(deviceIdInput);

  let current;
  try {
    current = await requireCurrentWorkspaceSession(headers, workspaceId);
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) {
      const reason = await classifyRevocationReason(headers, workspaceId);
      throw new DeviceRoleRefreshDeniedError(reason);
    }
    throw error;
  }

  if (deviceId !== undefined) {
    const [secret] = await db
      .select({ revokedAt: deviceUnlockSecret.revokedAt })
      .from(deviceUnlockSecret)
      .where(
        and(
          eq(deviceUnlockSecret.workspaceId, workspaceId),
          eq(deviceUnlockSecret.deviceId, deviceId),
        ),
      )
      .limit(1);
    if (secret?.revokedAt != null) {
      throw new DeviceRoleRefreshDeniedError("device-revoked");
    }
  }

  return { roles: current.roles, membershipId: current.membershipId };
}

/**
 * Non-enumerating, matching the unlock endpoint's own denial shape — this
 * is the SESSION-level guard (is the caller allowed to revoke at all), not
 * the classified signal a refreshing device receives.
 */
export class DeviceRevokeDeniedError extends Error {
  constructor() {
    super("This session is not authorized to revoke devices in this workspace");
  }
}

export interface DeviceRevokeRequest {
  workspaceId: string;
  deviceId: string;
}

export function parseDeviceRevokeRequest(value: unknown): DeviceRevokeRequest {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid request body");
  const record = value as Record<string, unknown>;
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    deviceId: parseDeviceId(record.deviceId),
  };
}

/**
 * F151/FDN-63. `VPS-F001`'s Devices-table Revoke action: an explicit,
 * single-device revocation distinct from a full membership revocation. The
 * device whose secret is revoked here may belong to a DIFFERENT user in
 * the same workspace — "wipes a colleague's local data," in `VPS-F001`'s
 * own words — so this is gated to `owner`, the workspace's highest role,
 * rather than to being merely logged in. A device revoking its own secret
 * still goes through this same Owner gate; self-revocation by a
 * non-Owner is not built here and is a deliberate, narrower scope than
 * VPS-F001's full Devices-table feature.
 *
 * Idempotent: revoking an already-revoked or nonexistent (workspace,
 * device) pair succeeds silently rather than erroring, so a second click
 * on Revoke is never a visible failure.
 */
export async function revokeDevice(
  headers: Headers,
  workspaceIdInput: string,
  deviceIdInput: string,
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

  await db
    .update(deviceUnlockSecret)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceUnlockSecret.workspaceId, workspaceId),
        eq(deviceUnlockSecret.deviceId, deviceId),
        isNull(deviceUnlockSecret.revokedAt),
      ),
    );
}

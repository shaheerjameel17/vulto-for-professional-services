import { randomBytes } from "node:crypto";
import {
  deviceIdSchema,
  deviceRegistrationInputSchema,
  uuidV4Schema,
  type DeviceApplication,
  type DevicePlatform,
} from "@vulto/schema";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db.js";
import { auth } from "./config.js";
import { recordTrustEvent } from "./device-trust-log.js";
import { device, deviceTrustEvent, deviceUnlockSecret } from "./schema.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
} from "./workspace-session.js";

/**
 * FDN-63 Stage 1. The canonical Device identity lifecycle: registration,
 * per-workspace listing, and last-active bookkeeping. `VPS-F001`'s
 * `device.register` / `device.revoke` / `device.listForWorkspace` contract.
 *
 * `device` rows are the trust record: a row that exists and is not
 * `is_revoked` is a trusted device. `VPS-F001` is explicit that "device trust
 * has no silent auto-approval" — `registerDevice` is the only path that
 * creates one, and (Stage 3) nothing unlocks a workspace without it.
 */

const DEVICE_ID_BYTES = 24;

/**
 * FDN-63 Stage 5. How long a device may go without a successful authorized
 * checkpoint before it is *surfaced* as stale.
 *
 * Not read from any specification — `VPS-F001` names no staleness window, so
 * this is reasoned about the way `FLUSH_DEBOUNCE_MS` and
 * `ROLE_REFRESH_POLL_INTERVAL_MS` were, and recorded here rather than left
 * as a bare number. Thirty days is long enough that ordinary absence — a
 * holiday, parental leave, a secondary laptop used monthly — does not flag a
 * healthy device and train an Owner to ignore the column, and short enough
 * that a genuinely lost device surfaces inside a review cycle rather than a
 * year later. Approved by the founder at the FDN-63 plan checkpoint.
 *
 * **This is a display fact, not an authorization one.** Staleness grants
 * nothing and takes nothing away: it is derived at read from `last_active_at`
 * and never stored (the never-store-what-can-be-derived rule), and the only
 * thing that acts on it is a human deciding whether to revoke.
 */
export const DEVICE_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale `last_active_at` must be before a checkpoint bothers writing it
 * again. The role-refresh poll runs every 15 seconds per unlocked Worker;
 * without this every device would rewrite its own row four times a minute
 * forever to move a value nothing reads at that resolution. Five minutes is
 * far finer than the thirty-day window above needs, and turns the write into
 * a rounding error.
 */
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

/** Non-enumerating, mirroring the unlock/revoke checkpoints' own denial shape. */
export class DeviceRegistrationDeniedError extends Error {
  constructor() {
    super("This session is not authorized to register a device");
  }
}

export class DeviceListDeniedError extends Error {
  constructor() {
    super("This session is not authorized to list devices in this workspace");
  }
}

export interface DeviceRegistrationRequest {
  deviceId?: string;
  deviceName: string;
  platform: DevicePlatform;
  application: DeviceApplication;
  pushToken: string | null;
}

export function parseDeviceRegistrationRequest(
  value: unknown,
): DeviceRegistrationRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  const parsed = deviceRegistrationInputSchema.parse(record);
  return {
    deviceId:
      record.deviceId === undefined ? undefined : deviceIdSchema.parse(record.deviceId),
    deviceName: parsed.deviceName,
    platform: parsed.platform,
    application: parsed.application,
    pushToken: parsed.pushToken ?? null,
  };
}

export interface DeviceRecord {
  deviceId: string;
  userId: string;
  deviceName: string;
  platform: string;
  application: string;
  registeredAt: string;
  lastActiveAt: string;
  /**
   * F191. Two different facts, deliberately not collapsed into one flag —
   * they have different scopes and different people may act on them:
   *
   * `revokedInWorkspace` — this device's unlock secret for THIS workspace is
   * revoked. An Owner's action, undoable by an Owner when it was a staleness
   * revocation.
   *
   * `retiredByOwner` — the canonical `device.is_revoked` flag: the device's
   * own user retired it everywhere. No Owner may set or clear this.
   */
  revokedInWorkspace: boolean;
  retiredByOwner: boolean;
  /** FDN-63 Stage 5. Derived at read from `lastActiveAt`; never stored. */
  isStale: boolean;
}

/**
 * `pushToken` is deliberately absent from `DeviceRecord`. It is a bearer
 * credential for addressing the device, it is of no use to the Devices table,
 * and an Owner listing a colleague's devices has no business receiving it.
 */
function toDeviceRecord(
  row: typeof device.$inferSelect,
  input: { readonly revokedInWorkspace: boolean; readonly now: number },
): DeviceRecord {
  return {
    deviceId: row.id,
    userId: row.userId,
    deviceName: row.deviceName,
    platform: row.platform,
    application: row.application,
    registeredAt: row.registeredAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    revokedInWorkspace: input.revokedInWorkspace,
    retiredByOwner: row.isRevoked,
    isStale: input.now - row.lastActiveAt.getTime() > DEVICE_STALE_AFTER_MS,
  };
}

/**
 * `VPS-F001`: "User and session identity derive from the httpOnly cookie on the
 * request." The device supplies its own generated identifier (its
 * `SealedStore.deviceId()`, persisted in IndexedDB); when absent — a first
 * registration before the sealed store exists — the server mints one and the
 * device adopts it.
 *
 * Idempotent on `(id)`: re-registering the same device updates its mutable
 * fields (name, push token) and, deliberately, does NOT clear `is_revoked` — a
 * revoked device cannot un-revoke itself by calling register again. The
 * staleness re-approval path (Stage 5) is the only way back.
 */
export async function registerDevice(
  headers: Headers,
  request: DeviceRegistrationRequest,
): Promise<{ deviceId: string }> {
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) throw new DeviceRegistrationDeniedError();
  const userId = session.user.id;

  const deviceId = request.deviceId ?? randomBase64Url(DEVICE_ID_BYTES);

  const [existing] = await db
    .select()
    .from(device)
    .where(eq(device.id, deviceId))
    .limit(1);

  if (existing) {
    // A device id belongs to exactly one user. A mismatch is a caller error
    // or a collision, not something to silently reassign.
    if (existing.userId !== userId) throw new DeviceRegistrationDeniedError();
    await db
      .update(device)
      .set({
        deviceName: request.deviceName,
        platform: request.platform,
        application: request.application,
        pushToken: request.pushToken,
        lastActiveAt: new Date(),
      })
      .where(eq(device.id, deviceId));
    return { deviceId };
  }

  await db.transaction(async (tx) => {
    await tx.insert(device).values({
      id: deviceId,
      userId,
      deviceName: request.deviceName,
      platform: request.platform,
      application: request.application,
      pushToken: request.pushToken,
    });
    await recordTrustEvent(tx, {
      deviceId,
      userId,
      eventType: "registered",
      actorUserId: userId,
      reason: `${request.platform} · ${request.application}`,
    });
  });
  return { deviceId };
}

export interface DeviceListRequest {
  workspaceId: string;
}

export function parseDeviceListRequest(value: unknown): DeviceListRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  return { workspaceId: uuidV4Schema.parse(record.workspaceId) };
}

/**
 * `VPS-F001`'s Devices table data. An Owner sees every device that holds an
 * unlock secret in this workspace — "wipes a colleague's local data" implies
 * seeing the colleague's devices. A non-Owner sees only their own rows, with
 * no indication others exist (the Restricted system state).
 *
 * Scoped through `device_unlock_secret` rather than `device.userId` alone: a
 * device is "in" a workspace when it has unlocked it, and a person may own
 * devices that never touched this workspace.
 */
export async function listDevicesForWorkspace(
  headers: Headers,
  workspaceIdInput: string,
): Promise<DeviceRecord[]> {
  const workspaceId = uuidV4Schema.parse(workspaceIdInput);

  let current;
  try {
    current = await requireCurrentWorkspaceSession(headers, workspaceId);
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) {
      throw new DeviceListDeniedError();
    }
    throw error;
  }

  const restrictToSelf = !current.roles.includes("owner");

  const rows = await db
    .select({ device, secretRevokedAt: deviceUnlockSecret.revokedAt })
    .from(deviceUnlockSecret)
    .innerJoin(device, eq(device.id, deviceUnlockSecret.deviceId))
    .where(
      restrictToSelf
        ? and(
            eq(deviceUnlockSecret.workspaceId, workspaceId),
            eq(device.userId, current.userId),
          )
        : eq(deviceUnlockSecret.workspaceId, workspaceId),
    )
    .orderBy(desc(device.lastActiveAt));

  const now = Date.now();
  return rows.map((row) =>
    toDeviceRecord(row.device, {
      revokedInWorkspace: row.secretRevokedAt !== null,
      now,
    }),
  );
}

/** Non-enumerating, matching every other device checkpoint's denial shape. */
export class DeviceRetireDeniedError extends Error {
  constructor() {
    super("This session is not authorized to retire that device");
  }
}

export interface DeviceRetireRequest {
  deviceId: string;
}

export function parseDeviceRetireRequest(value: unknown): DeviceRetireRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  return { deviceId: deviceIdSchema.parse(record.deviceId) };
}

/**
 * FDN-63 / F191 — **global** device retirement, and the only path that may
 * set `device.is_revoked`.
 *
 * The founder ruling this implements: a workspace Owner's Revoke action is
 * strictly workspace-scoped (`revokeDevice` in `device-unlock.ts`), because
 * the `device` row spans workspaces and letting one tenant flip a global
 * flag would destroy another tenant's local data on the same physical
 * device — with no authority over that workspace and no visibility into it.
 * Retiring a device everywhere is a real and necessary action (a lost or
 * stolen laptop), but it belongs to **the person who owns the device**, who
 * is the only party with authority over every workspace it holds.
 *
 * Authorized by the account session alone — no workspace context, because
 * the action deliberately has no workspace scope. The device must belong to
 * the session's own user; an Owner cannot reach another user's device here.
 *
 * Revokes every unlock secret the device holds, in every workspace, in the
 * same transaction, so the effect is immediate rather than waiting on the
 * `is_revoked` gate alone. Clears `push_token` per `VPS-F001` ("invalidated
 * on revocation"). Idempotent: retiring an already-retired device succeeds
 * and writes no second audit row.
 */
export async function retireOwnDevice(
  headers: Headers,
  deviceIdInput: string,
): Promise<void> {
  const deviceId = deviceIdSchema.parse(deviceIdInput);

  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) throw new DeviceRetireDeniedError();
  const userId = session.user.id;

  const [owned] = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.id, deviceId), eq(device.userId, userId)))
    .limit(1);
  // Non-enumerating: "not yours" and "does not exist" are one answer.
  if (!owned) throw new DeviceRetireDeniedError();

  await db.transaction(async (tx) => {
    const [retired] = await tx
      .update(device)
      .set({ isRevoked: true, pushToken: null })
      .where(
        and(
          eq(device.id, deviceId),
          eq(device.userId, userId),
          eq(device.isRevoked, false),
        ),
      )
      .returning({ id: device.id });

    // Every workspace, deliberately — this is what "global" means, and it is
    // sound precisely because the acting user owns the device in all of them.
    await tx
      .update(deviceUnlockSecret)
      .set({ revokedAt: new Date() })
      .where(eq(deviceUnlockSecret.deviceId, deviceId));

    if (retired) {
      await recordTrustEvent(tx, {
        deviceId,
        userId,
        eventType: "retired-by-user",
        actorUserId: userId,
      });
    }
  });
}

/**
 * Bump `last_active_at`, at most once every `ACTIVITY_WRITE_INTERVAL_MS`.
 * Called from the unlock and role-refresh checkpoints on success — the two
 * places the server has just confirmed this device is authorized, which is
 * exactly what "active" should mean here rather than "made a request."
 *
 * A missing row is not an error: Stage 3's unlock gate is what refuses an
 * unregistered device; this is bookkeeping, not a check. Failures are
 * swallowed by the callers for the same reason — a stale activity timestamp
 * must never turn an otherwise-successful authorization into a denial.
 */
export async function touchDeviceActivity(deviceId: string): Promise<void> {
  const staleBefore = new Date(Date.now() - ACTIVITY_WRITE_INTERVAL_MS);
  await db
    .update(device)
    .set({ lastActiveAt: new Date() })
    .where(and(eq(device.id, deviceId), lt(device.lastActiveAt, staleBefore)));
}

/** Owner-gated, like the revoke it undoes. */
export class DeviceReapprovalDeniedError extends Error {
  constructor() {
    super("This session is not authorized to re-approve that device");
  }
}

/** Raised when the revocation being undone was not a staleness one. */
export class DeviceNotReapprovableError extends Error {
  constructor() {
    super("This device's revocation is not reversible");
  }
}

export interface DeviceReapprovalRequest {
  workspaceId: string;
  deviceId: string;
}

export function parseDeviceReapprovalRequest(value: unknown): DeviceReapprovalRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    deviceId: deviceIdSchema.parse(record.deviceId),
  };
}

/**
 * FDN-63 Stage 5 — the narrow, deliberate exception to `VPS-F001`'s
 * "revocation is destructive, irreversible from the user's side."
 *
 * A staleness revocation is a *precaution*, not a judgment: an Owner saw a
 * device that had not checked in for a month and cut it off. When the answer
 * turns out to be parental leave rather than a lost laptop, forcing the
 * colleague to re-register from scratch punishes the Owner for having been
 * careful. So exactly one revocation reason is reversible, and the rule is
 * checked against the audit log rather than inferred:
 *
 *   **The most recent trust event for this device in this workspace must be
 *   `stale-flagged`.** A `revoked-explicit` (a deliberate judgment about the
 *   device), a `revoked-membership` (the person is no longer a member) or
 *   anything else refuses. A later event of any kind supersedes an earlier
 *   `stale-flagged`, so a device flagged stale and *then* explicitly revoked
 *   is not reversible.
 *
 * Workspace-scoped, exactly like the revoke it undoes (F191): it clears this
 * workspace's `device_unlock_secret.revokedAt` and nothing else. It cannot
 * clear `device.is_revoked` — an Owner has no authority to undo the device
 * owner's own global retirement — and refuses outright while that flag is
 * set, rather than appearing to succeed and leaving the device still locked
 * out.
 */
export async function reapproveStaleDevice(
  headers: Headers,
  workspaceIdInput: string,
  deviceIdInput: string,
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(workspaceIdInput);
  const deviceId = deviceIdSchema.parse(deviceIdInput);

  let current;
  try {
    current = await requireCurrentWorkspaceSession(headers, workspaceId);
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) {
      throw new DeviceReapprovalDeniedError();
    }
    throw error;
  }
  if (!current.roles.includes("owner")) {
    throw new DeviceReapprovalDeniedError();
  }

  const [identity] = await db
    .select({ isRevoked: device.isRevoked })
    .from(device)
    .where(eq(device.id, deviceId))
    .limit(1);
  if (!identity) throw new DeviceReapprovalDeniedError();
  if (identity.isRevoked) {
    // The device's own user retired it. Not an Owner's to undo, and saying so
    // is not enumeration — the caller already knows this device exists.
    throw new DeviceNotReapprovableError();
  }

  const [latest] = await db
    .select({ eventType: deviceTrustEvent.eventType })
    .from(deviceTrustEvent)
    .where(
      and(
        eq(deviceTrustEvent.deviceId, deviceId),
        eq(deviceTrustEvent.workspaceId, workspaceId),
      ),
    )
    .orderBy(desc(deviceTrustEvent.createdAt), desc(deviceTrustEvent.id))
    .limit(1);
  if (latest?.eventType !== "stale-flagged") {
    throw new DeviceNotReapprovableError();
  }

  await db.transaction(async (tx) => {
    const [restored] = await tx
      .update(deviceUnlockSecret)
      .set({ revokedAt: null })
      .where(
        and(
          eq(deviceUnlockSecret.workspaceId, workspaceId),
          eq(deviceUnlockSecret.deviceId, deviceId),
        ),
      )
      .returning({ userId: deviceUnlockSecret.userId });
    if (!restored) throw new DeviceNotReapprovableError();

    await recordTrustEvent(tx, {
      deviceId,
      userId: restored.userId,
      workspaceId,
      eventType: "re-approved",
      actorUserId: current.userId,
    });
  });
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

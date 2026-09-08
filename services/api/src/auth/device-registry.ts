import { randomBytes } from "node:crypto";
import {
  deviceIdSchema,
  deviceRegistrationInputSchema,
  uuidV4Schema,
  type DeviceApplication,
  type DevicePlatform,
} from "@vulto/schema";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db.js";
import { auth } from "./config.js";
import { recordTrustEvent } from "./device-trust-log.js";
import { device, deviceUnlockSecret } from "./schema.js";
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
  pushToken: string | null;
  registeredAt: string;
  lastActiveAt: string;
  isRevoked: boolean;
}

function toDeviceRecord(row: typeof device.$inferSelect): DeviceRecord {
  return {
    deviceId: row.id,
    userId: row.userId,
    deviceName: row.deviceName,
    platform: row.platform,
    application: row.application,
    pushToken: row.pushToken,
    registeredAt: row.registeredAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    isRevoked: row.isRevoked,
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
    .select({ device })
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

  return rows.map((row) => toDeviceRecord(row.device));
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
 * Bump `last_active_at`. Called from the unlock and role-refresh checkpoints
 * on success. A missing row is not an error here — Stage 3's unlock gate is
 * what refuses an unregistered device; this is bookkeeping, not a check.
 */
export async function touchDeviceActivity(deviceId: string): Promise<void> {
  await db
    .update(device)
    .set({ lastActiveAt: new Date() })
    .where(eq(device.id, deviceId));
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

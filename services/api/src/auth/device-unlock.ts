import { randomBytes } from "node:crypto";
import { uuidV4Schema } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { deviceUnlockSecret } from "./schema.js";
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

export interface DeviceUnlockGrant {
  serverHalf: string;
  envelope: DeviceUnlockEnvelope;
}

function toGrant(row: {
  workspaceId: string;
  deviceId: string;
  keyEpoch: number;
  serverHalf: string;
  createdAt: Date;
}): DeviceUnlockGrant {
  return {
    serverHalf: row.serverHalf,
    envelope: {
      workspaceId: row.workspaceId,
      deviceId: row.deviceId,
      keyEpoch: row.keyEpoch,
      algorithm: "AES-GCM-256",
      createdAt: row.createdAt.toISOString(),
    },
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
    return toGrant(existing);
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
  return toGrant(created);
}

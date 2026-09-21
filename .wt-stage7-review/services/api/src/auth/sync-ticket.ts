import { createHash, randomBytes } from "node:crypto";
import { uuidV4Schema } from "@vulto/schema";
import { and, eq, lt, or } from "drizzle-orm";
import { db } from "../db.js";
import { deviceUnlockSecret, syncTicket } from "./schema.js";
import { parseDeviceId } from "./device-unlock.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
} from "./workspace-session.js";

/**
 * FDN-51 Stage 4a — mint a short-lived sync-handshake ticket.
 *
 * The browser's graph Worker cannot read the httpOnly Better Auth session
 * cookie, so it cannot put a raw `session.token` in the relay's `Hello`. This
 * endpoint, authenticated by that same cookie, hands back a random ticket bound
 * to one `(workspace, device)` for a few minutes. The relay
 * (`PgSessionAuthorizer`) validates the ticket's SHA-256 hash against
 * `sync_ticket` instead of a session token, then runs the identical
 * membership / status / device-revocation checks.
 *
 * The raw ticket is a bearer credential: it is returned to the caller once and
 * never stored — only its hash lands in the database.
 */

/** Every ticket string starts with this so the relay can tell a ticket from a raw session token. */
export const SYNC_TICKET_PREFIX = "vlt_sync_";

/**
 * Ticket lifetime. Deliberately short — a leaked ticket is worth at most this
 * many seconds of sync for one workspace and one device. The Worker re-mints
 * and reconnects before expiry; the relay's auto-replay-from-ack makes that
 * reconnect seamless (FDN-51 Stage 3).
 */
export const SYNC_TICKET_TTL_SECONDS = 600;

export interface SyncTicketRequest {
  workspaceId: string;
  deviceId: string;
}

export function parseSyncTicketRequest(value: unknown): SyncTicketRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    deviceId: parseDeviceId(record.deviceId),
  };
}

export interface SyncTicketGrant {
  ticket: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Non-enumerating, matching `DeviceUnlockDeniedError`: a caller cannot tell
 * "no session" from "wrong workspace" from "revoked device" from this error.
 */
export class SyncTicketDeniedError extends Error {
  constructor() {
    super("This device is not authorized to synchronize this workspace");
  }
}

function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket, "utf8").digest("hex");
}

export async function mintSyncTicket(
  headers: Headers,
  workspaceIdInput: string,
  deviceIdInput: string,
): Promise<SyncTicketGrant> {
  const workspaceId = uuidV4Schema.parse(workspaceIdInput);
  const deviceId = parseDeviceId(deviceIdInput);

  let current;
  try {
    current = await requireCurrentWorkspaceSession(headers, workspaceId);
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) {
      throw new SyncTicketDeniedError();
    }
    throw error;
  }

  // The device must have a live unlock secret in this workspace, owned by this
  // user, not revoked — the same gate `requestDeviceUnlock` applies. The relay
  // re-checks device revocation on every re-auth, but there is no reason to
  // mint a ticket for a device that is already locked out.
  const [device] = await db
    .select({
      revokedAt: deviceUnlockSecret.revokedAt,
      userId: deviceUnlockSecret.userId,
    })
    .from(deviceUnlockSecret)
    .where(
      and(
        eq(deviceUnlockSecret.workspaceId, current.workspaceId),
        eq(deviceUnlockSecret.deviceId, deviceId),
      ),
    )
    .limit(1);
  if (!device || device.revokedAt !== null || device.userId !== current.userId) {
    throw new SyncTicketDeniedError();
  }

  const ticket = SYNC_TICKET_PREFIX + randomBytes(32).toString("base64url");
  const tokenHash = hashTicket(ticket);
  const expiresAt = new Date(Date.now() + SYNC_TICKET_TTL_SECONDS * 1000);

  await db.transaction(async (tx) => {
    // Keep the table small: a device only ever needs its newest ticket, and
    // dropping the previous one immediately narrows the window a stale ticket
    // is usable.
    await tx
      .delete(syncTicket)
      .where(
        or(
          and(
            eq(syncTicket.workspaceId, current.workspaceId),
            eq(syncTicket.deviceId, deviceId),
          ),
          lt(syncTicket.expiresAt, new Date()),
        ),
      );
    await tx.insert(syncTicket).values({
      tokenHash,
      workspaceId: current.workspaceId,
      userId: current.userId,
      deviceId,
      expiresAt,
    });
  });

  return {
    ticket,
    expiresAt: expiresAt.toISOString(),
    ttlSeconds: SYNC_TICKET_TTL_SECONDS,
  };
}

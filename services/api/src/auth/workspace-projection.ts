import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseWorkspaceRoles, uuidV4Schema, type WorkspaceRole } from "@vulto/schema";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "../db.js";
import { auth } from "./config.js";
import { parseDeviceId } from "./device-unlock.js";
import {
  device,
  deviceUnlockSecret,
  member,
  organization,
  user,
  workspaceProjectionGrant,
} from "./schema.js";
import {
  confirmWorkspaceAdmission,
  createPendingWorkspaceAdmission,
} from "./workspace-session.js";

/**
 * FDN-85 Stage 2 — the founding workspace-admission projection.
 *
 * A newly created workspace's membership is `pending`, so
 * `requireCurrentWorkspaceSession` refuses it and the graph Worker cannot run
 * an ordinary `mutate`. This module is the one narrow way in:
 *
 *   1. `createWorkspaceWithPendingOwner` records the pending
 *      `organization` + `member` rows (via FDN-60's
 *      `createPendingWorkspaceAdmission`) and mints a single-use projection
 *      grant bound to that exact `(workspace, device, membership)`.
 *   2. The graph Worker consumes the grant, opens the sealed store with the
 *      server half it carries, and runs its privileged projection command —
 *      which writes exactly the five reserved-type records and nothing else.
 *   3. `confirmWorkspaceProjection` records that the projection is durable,
 *      flipping the membership to `active/confirmed` so
 *      `requireCurrentWorkspaceSession` will finally admit it.
 *
 * The grant bypasses per-write role authorization by design (founder ruling
 * Q1c, option (b) narrowed): the command's own gating IS the authorization —
 * `createPendingWorkspaceAdmission` already succeeded server-side, the grant
 * is single-use and hash-verified, and the projection command is
 * structurally incapable of writing anything but the five reserved types.
 * This exception covers this issue's projection command only; any future
 * privileged write needs its own ruling.
 */

export const PROJECTION_GRANT_PREFIX = "vlt_proj_";

/**
 * Deliberately short — the Worker consumes the grant immediately after the
 * `workspace.create` round-trip. A leaked grant is worth, at most, one
 * projection write for one pending membership on one device, and the
 * projection command can write nothing else.
 */
export const PROJECTION_GRANT_TTL_SECONDS = 300;

/** Non-enumerating, matching `DeviceUnlockDeniedError` / `SyncTicketDeniedError`. */
export class WorkspaceProjectionDeniedError extends Error {
  constructor() {
    super("This session is not authorized to project this workspace admission");
  }
}

function hashGrant(grant: string): string {
  return createHash("sha256").update(grant, "utf8").digest("hex");
}

/**
 * A deterministic UUID v4-shaped id from a seed, so re-projection and
 * reconciliation are idempotent (a membership always yields the same edge
 * ids). Computed server-side and carried in the grant — the graph Worker
 * never derives an id of its own.
 */
function deterministicUuid(seed: string): string {
  const h = createHash("sha256").update(seed, "utf8").digest();
  h[6] = (h[6]! & 0x0f) | 0x40;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function membershipOfEdgeId(membershipId: string): string {
  return deterministicUuid(`membership_of:${membershipId}`);
}
export function membershipInEdgeId(membershipId: string): string {
  return deterministicUuid(`membership_in:${membershipId}`);
}

function slugFor(workspaceName: string, workspaceId: string): string {
  const base = workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base.length > 0 ? base : "workspace"}-${workspaceId}`;
}

export interface WorkspaceProjectionGrant {
  /** The raw grant string. Returned once; only its hash is stored. */
  grant: string;
  workspaceId: string;
  membershipId: string;
  /** The stable account id whose `User` node the projection must write. */
  userId: string;
  roles: WorkspaceRole[];
  /** Deterministic, server-computed. The graph Worker never derives its own. */
  membershipOfEdgeId: string;
  membershipInEdgeId: string;
  /**
   * The server half of this device's sealed-store unlock secret, so the
   * Worker can open the store for the projection write. Combined on-device
   * with the device-held half; useless alone.
   */
  serverHalf: string;
  keyEpoch: number;
  expiresAt: string;
  ttlSeconds: number;
}

async function sessionUserId(headers: Headers): Promise<string> {
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!current) throw new WorkspaceProjectionDeniedError();
  return current.user.id;
}

/**
 * Provisions (or re-reads) this device's server unlock-secret half for the
 * workspace, the same lazy provisioning `requestDeviceUnlock` does — except
 * it runs for a still-`pending` membership, which is exactly what the
 * projection needs and the ordinary unlock path forbids.
 */
async function provisionServerHalf(
  workspaceId: string,
  userId: string,
  deviceId: string,
): Promise<{ serverHalf: string; keyEpoch: number }> {
  const [existing] = await db
    .select()
    .from(deviceUnlockSecret)
    .where(
      and(
        eq(deviceUnlockSecret.workspaceId, workspaceId),
        eq(deviceUnlockSecret.deviceId, deviceId),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.revokedAt !== null || existing.userId !== userId) {
      throw new WorkspaceProjectionDeniedError();
    }
    return { serverHalf: existing.serverHalf, keyEpoch: existing.keyEpoch };
  }
  const serverHalf = randomBytes(32).toString("base64");
  const [created] = await db
    .insert(deviceUnlockSecret)
    .values({ workspaceId, userId, deviceId, serverHalf, keyEpoch: 1 })
    .returning();
  if (!created) throw new WorkspaceProjectionDeniedError();
  return { serverHalf: created.serverHalf, keyEpoch: created.keyEpoch };
}

export async function mintWorkspaceProjectionGrant(
  headers: Headers,
  input: { workspaceId: string; deviceId: string; membershipId: string },
): Promise<WorkspaceProjectionGrant> {
  const workspaceId = uuidV4Schema.parse(input.workspaceId);
  const membershipId = uuidV4Schema.parse(input.membershipId);
  const deviceId = parseDeviceId(input.deviceId);
  const userId = await sessionUserId(headers);

  const [pending] = await db
    .select({ roles: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.userId, userId),
        eq(member.organizationId, workspaceId),
        eq(member.status, "pending"),
        eq(member.projectionState, "pending"),
        eq(user.status, "active"),
        eq(organization.status, "active"),
      ),
    )
    .limit(1);
  if (!pending) throw new WorkspaceProjectionDeniedError();

  // FDN-63: the device must hold a registered, non-revoked identity row for
  // this user — the same gate `requestDeviceUnlock` applies.
  const [identity] = await db
    .select({ isRevoked: device.isRevoked })
    .from(device)
    .where(and(eq(device.id, deviceId), eq(device.userId, userId)))
    .limit(1);
  if (!identity || identity.isRevoked) throw new WorkspaceProjectionDeniedError();

  let roles: WorkspaceRole[];
  try {
    roles = parseWorkspaceRoles(pending.roles);
  } catch {
    throw new WorkspaceProjectionDeniedError();
  }

  const { serverHalf, keyEpoch } = await provisionServerHalf(
    workspaceId,
    userId,
    deviceId,
  );

  const grant = PROJECTION_GRANT_PREFIX + randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PROJECTION_GRANT_TTL_SECONDS * 1000);

  await db.transaction(async (tx) => {
    await tx
      .delete(workspaceProjectionGrant)
      .where(
        or(
          and(
            eq(workspaceProjectionGrant.membershipId, membershipId),
            eq(workspaceProjectionGrant.deviceId, deviceId),
          ),
          lt(workspaceProjectionGrant.expiresAt, new Date()),
        ),
      );
    await tx.insert(workspaceProjectionGrant).values({
      tokenHash: hashGrant(grant),
      workspaceId,
      userId,
      membershipId,
      deviceId,
      expiresAt,
    });
  });

  return {
    grant,
    workspaceId,
    membershipId,
    userId,
    roles,
    membershipOfEdgeId: membershipOfEdgeId(membershipId),
    membershipInEdgeId: membershipInEdgeId(membershipId),
    serverHalf,
    keyEpoch,
    expiresAt: expiresAt.toISOString(),
    ttlSeconds: PROJECTION_GRANT_TTL_SECONDS,
  };
}

export interface CreateWorkspaceRequest {
  workspaceName: string;
  deviceId: string;
}

export function parseCreateWorkspaceRequest(value: unknown): CreateWorkspaceRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  const name =
    typeof record.workspaceName === "string" ? record.workspaceName.trim() : "";
  if (name.length === 0 || name.length > 120) {
    throw new Error("Invalid workspace name");
  }
  return { workspaceName: name, deviceId: parseDeviceId(record.deviceId) };
}

/**
 * The server half of the `workspace.create` matched pair (FDN-85 owns both
 * halves; FDN-69 wires UI to this, per founder ruling Q7). Records the
 * pending owner admission and returns a projection grant the caller's graph
 * Worker consumes.
 */
export async function createWorkspaceWithPendingOwner(
  headers: Headers,
  request: CreateWorkspaceRequest,
): Promise<WorkspaceProjectionGrant> {
  const userId = await sessionUserId(headers);
  const [account] = await db
    .select({ status: user.status })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!account || account.status !== "active") {
    throw new WorkspaceProjectionDeniedError();
  }

  const workspaceId = randomUUID();
  const membershipId = randomUUID();

  await createPendingWorkspaceAdmission({
    workspaceId,
    workspaceName: request.workspaceName,
    workspaceSlug: slugFor(request.workspaceName, workspaceId),
    membershipId,
    userId,
    roles: ["owner"],
  });

  return mintWorkspaceProjectionGrant(headers, {
    workspaceId,
    deviceId: request.deviceId,
    membershipId,
  });
}

export interface ConsumedProjectionGrant {
  workspaceId: string;
  membershipId: string;
  userId: string;
  deviceId: string;
  roles: WorkspaceRole[];
  membershipOfEdgeId: string;
  membershipInEdgeId: string;
}

/**
 * Single-use. The CAS on `consumed_at IS NULL` is what makes it single-use:
 * a replayed grant updates zero rows and is denied. Also re-checks that the
 * membership is still `pending/pending` — a grant minted before a race
 * revocation cannot be used to project a since-revoked membership.
 */
export async function consumeWorkspaceProjectionGrant(
  rawGrant: string,
  bound: { workspaceId: string; membershipId: string; deviceId: string },
): Promise<ConsumedProjectionGrant> {
  if (typeof rawGrant !== "string" || !rawGrant.startsWith(PROJECTION_GRANT_PREFIX)) {
    throw new WorkspaceProjectionDeniedError();
  }
  const workspaceId = uuidV4Schema.parse(bound.workspaceId);
  const membershipId = uuidV4Schema.parse(bound.membershipId);
  const deviceId = parseDeviceId(bound.deviceId);

  const [consumed] = await db
    .update(workspaceProjectionGrant)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(workspaceProjectionGrant.tokenHash, hashGrant(rawGrant)),
        eq(workspaceProjectionGrant.workspaceId, workspaceId),
        eq(workspaceProjectionGrant.membershipId, membershipId),
        eq(workspaceProjectionGrant.deviceId, deviceId),
        isNull(workspaceProjectionGrant.consumedAt),
        gt(workspaceProjectionGrant.expiresAt, new Date()),
      ),
    )
    .returning({ userId: workspaceProjectionGrant.userId });
  if (!consumed) throw new WorkspaceProjectionDeniedError();

  const [pending] = await db
    .select({ roles: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.userId, consumed.userId),
        eq(member.organizationId, workspaceId),
        eq(member.status, "pending"),
        eq(member.projectionState, "pending"),
      ),
    )
    .limit(1);
  if (!pending) throw new WorkspaceProjectionDeniedError();

  return {
    workspaceId,
    membershipId,
    userId: consumed.userId,
    deviceId,
    roles: parseWorkspaceRoles(pending.roles),
    membershipOfEdgeId: membershipOfEdgeId(membershipId),
    membershipInEdgeId: membershipInEdgeId(membershipId),
  };
}

export interface ConfirmProjectionRequest {
  workspaceId: string;
  membershipId: string;
}

export function parseConfirmProjectionRequest(
  value: unknown,
): ConfirmProjectionRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    membershipId: uuidV4Schema.parse(record.membershipId),
  };
}

/**
 * The reconciler's server call: the graph Worker invokes this once the
 * projection delta is durably flushed locally (no sync-engine ack required,
 * founder ruling Q1d). Cookie-authenticated — the session must own the exact
 * pending membership. Delegates the state transition to FDN-60's
 * `confirmWorkspaceAdmission` CAS, which fails by construction if a
 * revocation raced in (`pending/pending` is no longer true).
 */
export async function confirmWorkspaceProjection(
  headers: Headers,
  request: ConfirmProjectionRequest,
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(request.workspaceId);
  const membershipId = uuidV4Schema.parse(request.membershipId);
  const userId = await sessionUserId(headers);

  const [owned] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.userId, userId),
        eq(member.organizationId, workspaceId),
        eq(member.status, "pending"),
        eq(member.projectionState, "pending"),
      ),
    )
    .limit(1);
  if (!owned) throw new WorkspaceProjectionDeniedError();

  await confirmWorkspaceAdmission(membershipId);
}

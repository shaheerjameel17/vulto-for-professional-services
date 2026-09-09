import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  parseWorkspaceRoles,
  serializeWorkspaceRoles,
  workspaceRoleSchema,
  uuidV4Schema,
  type WorkspaceRole,
} from "@vulto/schema";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
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
  confirmWorkspaceRevocationProjection,
  createPendingWorkspaceAdmission,
  revokeWorkspaceAdmission,
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
      grantKind: "admission",
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

// ── FDN-85 Stage 3 — removal and role-change projection ──────────────────────

export type MembershipTransitionKind = "revocation" | "role-change";

export interface WorkspaceTransitionGrant {
  grant: string;
  kind: MembershipTransitionKind;
  workspaceId: string;
  membershipId: string;
  /** The target's current role set — history the projection records. */
  roles: WorkspaceRole[];
  serverHalf: string;
  keyEpoch: number;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * The actor must be a confirmed Owner of the workspace. Owner-gated for both
 * kinds: `VPS-F001` puts role and membership changes under the workspace's
 * highest role, and a revocation "wipes a colleague's local data".
 */
async function requireConfirmedOwner(
  headers: Headers,
  workspaceId: string,
): Promise<{ actorUserId: string }> {
  const actorUserId = await sessionUserId(headers);
  const [owner] = await db
    .select({ roles: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.userId, actorUserId),
        eq(member.organizationId, workspaceId),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
        eq(user.status, "active"),
        eq(organization.status, "active"),
      ),
    )
    .limit(1);
  if (!owner) throw new WorkspaceProjectionDeniedError();
  let roles: WorkspaceRole[];
  try {
    roles = parseWorkspaceRoles(owner.roles);
  } catch {
    throw new WorkspaceProjectionDeniedError();
  }
  if (!roles.includes("owner")) throw new WorkspaceProjectionDeniedError();
  return { actorUserId };
}

/** The control-plane state a transition grant of each kind is valid against. */
function transitionMemberState(kind: MembershipTransitionKind): {
  status: "revoked" | "active";
  projectionState: "revocation-pending" | "confirmed";
} {
  return kind === "revocation"
    ? { status: "revoked", projectionState: "revocation-pending" }
    : { status: "active", projectionState: "confirmed" };
}

/**
 * Mints a single-use grant for the actor's device that authorizes projecting
 * ONE membership transition (a revocation or a role change) into graph
 * history. The target membership must already be in the control-plane state
 * that transition follows — the projection only ever records what the server
 * has already decided.
 */
export async function mintMembershipTransitionGrant(
  headers: Headers,
  input: {
    workspaceId: string;
    membershipId: string;
    deviceId: string;
    kind: MembershipTransitionKind;
  },
): Promise<WorkspaceTransitionGrant> {
  const workspaceId = uuidV4Schema.parse(input.workspaceId);
  const membershipId = uuidV4Schema.parse(input.membershipId);
  const deviceId = parseDeviceId(input.deviceId);
  const { actorUserId } = await requireConfirmedOwner(headers, workspaceId);

  const [identity] = await db
    .select({ isRevoked: device.isRevoked })
    .from(device)
    .where(and(eq(device.id, deviceId), eq(device.userId, actorUserId)))
    .limit(1);
  if (!identity || identity.isRevoked) throw new WorkspaceProjectionDeniedError();

  const wanted = transitionMemberState(input.kind);
  const [target] = await db
    .select({ roles: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.organizationId, workspaceId),
        eq(member.status, wanted.status),
        eq(member.projectionState, wanted.projectionState),
      ),
    )
    .limit(1);
  if (!target) throw new WorkspaceProjectionDeniedError();

  const { serverHalf, keyEpoch } = await provisionServerHalf(
    workspaceId,
    actorUserId,
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
            eq(workspaceProjectionGrant.grantKind, input.kind),
          ),
          lt(workspaceProjectionGrant.expiresAt, new Date()),
        ),
      );
    await tx.insert(workspaceProjectionGrant).values({
      tokenHash: hashGrant(grant),
      grantKind: input.kind,
      workspaceId,
      userId: actorUserId,
      membershipId,
      deviceId,
      expiresAt,
    });
  });

  return {
    grant,
    kind: input.kind,
    workspaceId,
    membershipId,
    roles: parseWorkspaceRoles(target.roles),
    serverHalf,
    keyEpoch,
    expiresAt: expiresAt.toISOString(),
    ttlSeconds: PROJECTION_GRANT_TTL_SECONDS,
  };
}

export interface TransitionGrantRequest {
  workspaceId: string;
  membershipId: string;
  deviceId: string;
  kind: MembershipTransitionKind;
}

export function parseTransitionGrantRequest(value: unknown): TransitionGrantRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== "revocation" && record.kind !== "role-change") {
    throw new Error("Invalid transition kind");
  }
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    membershipId: uuidV4Schema.parse(record.membershipId),
    deviceId: parseDeviceId(record.deviceId),
    kind: record.kind,
  };
}

export interface ConsumedTransitionGrant {
  kind: MembershipTransitionKind;
  workspaceId: string;
  membershipId: string;
  deviceId: string;
  roles: WorkspaceRole[];
}

/** Single-use, same CAS shape as the admission grant. Re-checks the target is
 * still in the state the transition follows — a grant minted before a race
 * cannot project a stale transition. */
export async function consumeMembershipTransitionGrant(
  rawGrant: string,
  bound: {
    workspaceId: string;
    membershipId: string;
    deviceId: string;
    kind: MembershipTransitionKind;
  },
): Promise<ConsumedTransitionGrant> {
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
        eq(workspaceProjectionGrant.grantKind, bound.kind),
        isNull(workspaceProjectionGrant.consumedAt),
        gt(workspaceProjectionGrant.expiresAt, new Date()),
      ),
    )
    .returning({ id: workspaceProjectionGrant.tokenHash });
  if (!consumed) throw new WorkspaceProjectionDeniedError();

  const wanted = transitionMemberState(bound.kind);
  const [target] = await db
    .select({ roles: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.organizationId, workspaceId),
        eq(member.status, wanted.status),
        eq(member.projectionState, wanted.projectionState),
      ),
    )
    .limit(1);
  if (!target) throw new WorkspaceProjectionDeniedError();

  return {
    kind: bound.kind,
    workspaceId,
    membershipId,
    deviceId,
    roles: parseWorkspaceRoles(target.roles),
  };
}

// ── Role change: one path, direction determines ordering ─────────────────────

export type RoleChangeDirection = "widen" | "narrow";

/** `widen` iff every current role is retained and at least one is added;
 * anything else (a removal, or a swap) is `narrow` — the fail-closed default,
 * because the more-restrictive interpretation of a mixed change is the safe
 * one. */
export function roleChangeDirection(
  before: readonly WorkspaceRole[],
  after: readonly WorkspaceRole[],
): RoleChangeDirection {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const retainedAll = [...beforeSet].every((role) => afterSet.has(role));
  const added = [...afterSet].some((role) => !beforeSet.has(role));
  return retainedAll && added ? "widen" : "narrow";
}

const OWNER_CAP = 3;

export interface ChangeRoleRequest {
  workspaceId: string;
  membershipId: string;
  deviceId: string;
  roles: WorkspaceRole[];
}

export function parseChangeRoleRequest(value: unknown): ChangeRoleRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  const roles = Array.isArray(record.roles)
    ? record.roles.map((role) => workspaceRoleSchema.parse(role))
    : [];
  if (roles.length === 0) throw new Error("A role change must name at least one role");
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    membershipId: uuidV4Schema.parse(record.membershipId),
    deviceId: parseDeviceId(record.deviceId),
    roles,
  };
}

export interface RoleChangeResult {
  direction: RoleChangeDirection;
  before: WorkspaceRole[];
  after: WorkspaceRole[];
  grant: WorkspaceTransitionGrant;
}

/**
 * The founder ruling Q2 ordering, made concrete:
 *
 *  - **narrow** — update `member.role` centrally FIRST (the F127 poll then
 *    narrows every live session within its window), then hand back a
 *    role-change grant so the graph records the new role as history. A
 *    window where the graph still says the wider role is harmless — the
 *    graph is not the access decision — and the central plane is already
 *    strict.
 *  - **widen** — mint the grant FIRST, against the still-current role. The
 *    central `member.role` update is deferred to `confirmRoleChangeProjection`,
 *    after the graph has recorded the wider role. A window where the graph
 *    says more than the central grant is the safe direction for a widen.
 */
export async function changeWorkspaceRole(
  headers: Headers,
  request: ChangeRoleRequest,
): Promise<RoleChangeResult> {
  const workspaceId = uuidV4Schema.parse(request.workspaceId);
  const membershipId = uuidV4Schema.parse(request.membershipId);
  await requireConfirmedOwner(headers, workspaceId);

  const [target] = await db
    .select({ roles: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.organizationId, workspaceId),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
      ),
    )
    .limit(1);
  if (!target) throw new WorkspaceProjectionDeniedError();

  const before = parseWorkspaceRoles(target.roles);
  const after = [...new Set(request.roles)];
  const direction = roleChangeDirection(before, after);

  if (after.includes("owner") && !before.includes("owner")) {
    const owners = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, workspaceId),
          eq(member.status, "active"),
          sql`${member.role} ~ '(^|,)owner($|,)'`,
        ),
      );
    if (owners.length >= OWNER_CAP) throw new WorkspaceProjectionDeniedError();
  }

  if (direction === "narrow") {
    await db
      .update(member)
      .set({ role: serializeWorkspaceRoles(after) })
      .where(
        and(
          eq(member.id, membershipId),
          eq(member.status, "active"),
          eq(member.projectionState, "confirmed"),
        ),
      );
  }

  const grant = await mintMembershipTransitionGrant(headers, {
    workspaceId,
    membershipId,
    deviceId: request.deviceId,
    kind: "role-change",
  });
  return { direction, before, after, grant: { ...grant, roles: after } };
}

export interface ConfirmTransitionRequest {
  workspaceId: string;
  membershipId: string;
  /** Only for a role-change confirm: the role set the graph now records. */
  roles?: WorkspaceRole[];
}

export function parseConfirmTransitionRequest(
  value: unknown,
): ConfirmTransitionRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid request body");
  }
  const record = value as Record<string, unknown>;
  return {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    membershipId: uuidV4Schema.parse(record.membershipId),
    roles: Array.isArray(record.roles)
      ? record.roles.map((role) => workspaceRoleSchema.parse(role))
      : undefined,
  };
}

/** Actor-owner-gated wrapper over FDN-60's `confirmWorkspaceRevocationProjection`
 * CAS. Fails by construction unless the target is still
 * `revoked/revocation-pending`. */
export async function confirmRevocationProjectionForActor(
  headers: Headers,
  request: ConfirmTransitionRequest,
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(request.workspaceId);
  const membershipId = uuidV4Schema.parse(request.membershipId);
  await requireConfirmedOwner(headers, workspaceId);

  const [pendingRevocation] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.organizationId, workspaceId),
        eq(member.status, "revoked"),
        eq(member.projectionState, "revocation-pending"),
      ),
    )
    .limit(1);
  if (!pendingRevocation) throw new WorkspaceProjectionDeniedError();

  await confirmWorkspaceRevocationProjection(membershipId);
}

/**
 * Role-change confirm. Idempotent for a narrow (the role is already set);
 * for a widen this is where `member.role` finally advances — the graph has
 * recorded the wider role by now. CAS-guarded on `active/confirmed`.
 */
export async function confirmRoleChangeProjection(
  headers: Headers,
  request: ConfirmTransitionRequest,
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(request.workspaceId);
  const membershipId = uuidV4Schema.parse(request.membershipId);
  await requireConfirmedOwner(headers, workspaceId);
  if (!request.roles || request.roles.length === 0) {
    throw new WorkspaceProjectionDeniedError();
  }
  const [updated] = await db
    .update(member)
    .set({ role: serializeWorkspaceRoles([...new Set(request.roles)]) })
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.organizationId, workspaceId),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
      ),
    )
    .returning({ id: member.id });
  if (!updated) throw new WorkspaceProjectionDeniedError();
}

export interface RevokeMemberRequest {
  workspaceId: string;
  membershipId: string;
}

export function parseRevokeMemberRequest(value: unknown): RevokeMemberRequest {
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
 * The trigger for a removal: an Owner denies a membership centrally. This is a
 * thin, owner-gated wrapper over FDN-60's `revokeWorkspaceAdmission` (which
 * owns the cascade — sessions, unlock secrets, audit); FDN-85 adds only the
 * caller check and, downstream, the history projection. "Deny centrally
 * first" — this returns before any graph write.
 */
export async function revokeMembershipForActor(
  headers: Headers,
  request: RevokeMemberRequest,
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(request.workspaceId);
  const membershipId = uuidV4Schema.parse(request.membershipId);
  const { actorUserId } = await requireConfirmedOwner(headers, workspaceId);

  const [target] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.id, membershipId), eq(member.organizationId, workspaceId)))
    .limit(1);
  if (!target) throw new WorkspaceProjectionDeniedError();
  // The founding Owner's own membership can never be revoked (VPS-F001).
  if (target.userId === actorUserId) throw new WorkspaceProjectionDeniedError();

  await revokeWorkspaceAdmission(membershipId);
}

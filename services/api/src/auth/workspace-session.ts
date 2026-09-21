import {
  parseWorkspaceRoles,
  serializeWorkspaceRoles,
  uuidV4Schema,
  type WorkspaceRole,
} from "@vulto/schema";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db.js";
import { auth } from "./config.js";
import { recordTrustEvent } from "./device-trust-log.js";
import {
  revokeUserDevicesEverywhere,
  revokeUserDevicesInWorkspace,
} from "./device-revocation-store.js";
import { audienceMaterializer } from "../audience/materializer.js";
import { ensureWorkspaceKek, getKeyServices } from "../crypto/keys.js";
import { writeFoundingRecords } from "../graph/founding.js";
import {
  projectMemberAdmission,
  projectMemberRemoval,
} from "../graph/membership-changes.js";
import { membershipInEdgeId, membershipOfEdgeId } from "./membership-edge-ids.js";
import { device, member, organization, session, user } from "./schema.js";

export interface CurrentWorkspaceSession {
  sessionId: string;
  userId: string;
  workspaceId: string;
  membershipId: string;
  roles: WorkspaceRole[];
}

export class UnauthorizedWorkspaceSessionError extends Error {
  constructor() {
    super("The current session is not authorized for this workspace");
  }
}

export async function requireCurrentWorkspaceSession(
  headers: Headers,
  requestedWorkspaceId: string,
): Promise<CurrentWorkspaceSession> {
  const workspaceId = uuidV4Schema.parse(requestedWorkspaceId);
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!current) throw new UnauthorizedWorkspaceSessionError();

  const [admission] = await db
    .select({
      sessionId: session.id,
      userId: user.id,
      workspaceId: organization.id,
      membershipId: member.id,
      roles: member.role,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .innerJoin(
      member,
      and(eq(member.userId, user.id), eq(member.organizationId, workspaceId)),
    )
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(session.id, current.session.id),
        eq(session.userId, current.user.id),
        gt(session.expiresAt, new Date()),
        eq(user.status, "active"),
        eq(organization.status, "active"),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
      ),
    )
    .limit(1);

  if (!admission) throw new UnauthorizedWorkspaceSessionError();

  try {
    return { ...admission, roles: parseWorkspaceRoles(admission.roles) };
  } catch {
    throw new UnauthorizedWorkspaceSessionError();
  }
}

export interface PendingWorkspaceAdmission {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  membershipId: string;
  userId: string;
  roles: readonly WorkspaceRole[];
}

/**
 * FDN-85 calls this before graph projection. The row cannot authorize access
 * until confirmWorkspaceAdmission records the projection acknowledgment.
 */
export async function createPendingWorkspaceAdmission(
  input: PendingWorkspaceAdmission,
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(input.workspaceId);
  const membershipId = uuidV4Schema.parse(input.membershipId);
  const userId = uuidV4Schema.parse(input.userId);

  await db.transaction(async (transaction) => {
    await transaction.insert(organization).values({
      id: workspaceId,
      name: input.workspaceName,
      slug: input.workspaceSlug,
      createdAt: new Date(),
      status: "active",
    });
    // Stage 2: the graph rows commit or roll back with the central rows. They
    // are written before the membership row so a failure of either is a real
    // rollback of the other.
    await writeFoundingRecords(transaction, {
      workspaceId,
      workspaceName: input.workspaceName,
      membershipId,
      userId,
      roles: input.roles,
      membershipOfEdgeId: membershipOfEdgeId(membershipId),
      membershipInEdgeId: membershipInEdgeId(membershipId),
      occurredAt: new Date().toISOString(),
    });
    // The workspace's key-encryption key, created with the workspace and shown
    // to nobody (VPS-A003).
    await ensureWorkspaceKek(transaction, getKeyServices(), workspaceId);
    await transaction.insert(member).values({
      id: membershipId,
      organizationId: workspaceId,
      userId,
      role: serializeWorkspaceRoles(input.roles),
      createdAt: new Date(),
      status: "pending",
      projectionState: "pending",
    });
  });
}

export interface WorkspaceMemberAdmission {
  workspaceId: string;
  membershipId: string;
  userId: string;
  roles: readonly WorkspaceRole[];
  /** Who admitted them. */
  actorUserId: string;
}

/**
 * Invitation acceptance: the central membership row and its graph records
 * commit together. Active and confirmed at once, because the graph copy is
 * written in this transaction and no device projection follows. The invitation
 * flow that calls this is FDN-86.
 */
export async function admitWorkspaceMember(
  input: WorkspaceMemberAdmission,
): Promise<void> {
  const workspaceId = uuidV4Schema.parse(input.workspaceId);
  const membershipId = uuidV4Schema.parse(input.membershipId);
  const userId = uuidV4Schema.parse(input.userId);
  const actorUserId = uuidV4Schema.parse(input.actorUserId);

  await db.transaction(async (transaction) => {
    await projectMemberAdmission(transaction, {
      workspaceId,
      membershipId,
      userId,
      roles: input.roles,
      membershipOfEdgeId: membershipOfEdgeId(membershipId),
      membershipInEdgeId: membershipInEdgeId(membershipId),
      actorUserId,
      occurredAt: new Date().toISOString(),
    });
    await transaction.insert(member).values({
      id: membershipId,
      organizationId: workspaceId,
      userId,
      role: serializeWorkspaceRoles(input.roles),
      createdAt: new Date(),
      status: "active",
      projectionState: "confirmed",
    });
    await audienceMaterializer.recomputeWorkspace(transaction, workspaceId);
  });
}

export async function confirmWorkspaceAdmission(
  membershipIdInput: string,
): Promise<void> {
  const membershipId = uuidV4Schema.parse(membershipIdInput);
  await db.transaction(async (transaction) => {
    const [confirmed] = await transaction
      .update(member)
      .set({ status: "active", projectionState: "confirmed" })
      .where(
        and(
          eq(member.id, membershipId),
          eq(member.status, "pending"),
          eq(member.projectionState, "pending"),
        ),
      )
      .returning({ id: member.id, workspaceId: member.organizationId });

    if (!confirmed) {
      throw new Error("Workspace admission was not pending confirmation");
    }
    // A confirmed member is now someone the audience is computed for.
    await audienceMaterializer.recomputeWorkspace(transaction, confirmed.workspaceId);
  });
}

/**
 * Removes a member. The central row, the graph copy of the membership, the
 * audience, the person's sessions in the workspace and their devices'
 * acceptance in the workspace all change in one transaction (F210): the
 * server is the only writer, so there is no later step to confirm.
 */
export async function revokeWorkspaceAdmission(
  membershipIdInput: string,
  actorUserIdInput: string,
): Promise<void> {
  const membershipId = uuidV4Schema.parse(membershipIdInput);
  const actorUserId = uuidV4Schema.parse(actorUserIdInput);

  await db.transaction(async (transaction) => {
    const [revoked] = await transaction
      .update(member)
      .set({ status: "revoked", projectionState: "confirmed" })
      .where(eq(member.id, membershipId))
      .returning({ userId: member.userId, workspaceId: member.organizationId });
    if (!revoked) throw new Error("Workspace membership does not exist");

    // The graph copy changes in the same transaction as the central row.
    await projectMemberRemoval(transaction, {
      workspaceId: revoked.workspaceId,
      membershipId,
      actorUserId,
      occurredAt: new Date().toISOString(),
    });
    // A removed member's audience rows go with the membership.
    await audienceMaterializer.recomputeWorkspace(transaction, revoked.workspaceId);

    await transaction
      .update(session)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(session.userId, revoked.userId),
          eq(session.activeOrganizationId, revoked.workspaceId),
        ),
      );

    // The person's devices are revoked in THIS workspace (F210).
    await revokeUserDevicesInWorkspace(transaction, {
      workspaceId: revoked.workspaceId,
      userId: revoked.userId,
      reason: "membership-revoked",
      revokedBy: actorUserId,
    });

    // FDN-63. Audit only. The cascade above is workspace-scoped — it revokes
    // this user's devices IN THIS WORKSPACE — and per F191 it must
    // stay that way: the canonical `device.is_revoked` flag spans workspaces,
    // so setting it here would let an offboarding from one client destroy the
    // same laptop's local data for another client. Only the device's own user
    // may retire a device globally (`retireOwnDevice`).
    await recordMembershipRevocationEvents(
      transaction,
      revoked.workspaceId,
      revoked.userId,
    );
  });
}

/**
 * FDN-63 cascade helper. Writes one `revoked-membership` trust event per
 * registered device of `userId` for `workspaceId`, so the
 * audit trail records which devices this workspace-scoped revocation
 * actually reached. Writes no `device` state — see F191.
 *
 * Joined against `device` rather than read from `device_unlock_secret`
 * alone, because the trust log has a foreign key to `device.id`: a legacy
 * secret with no identity row must be skipped, not made to abort the
 * revocation transaction.
 */
async function recordMembershipRevocationEvents(
  transaction: Parameters<Parameters<(typeof db)["transaction"]>[0]>[0],
  workspaceId: string,
  userId: string,
): Promise<void> {
  const affected = await transaction
    .select({ deviceId: device.id })
    .from(device)
    .where(eq(device.userId, userId));

  for (const row of affected) {
    await recordTrustEvent(transaction, {
      deviceId: row.deviceId,
      userId,
      workspaceId,
      eventType: "revoked-membership",
    });
  }
}

export async function suspendUserAndRevokeSessions(userIdInput: string): Promise<void> {
  const userId = uuidV4Schema.parse(userIdInput);
  await db.transaction(async (transaction) => {
    const [suspended] = await transaction
      .update(user)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(and(eq(user.id, userId), eq(user.status, "active")))
      .returning({ id: user.id });
    if (!suspended) throw new Error("Active user does not exist");
    await transaction.delete(session).where(eq(session.userId, userId));
    await revokeUserDevicesEverywhere(transaction, {
      userId,
      reason: "user-suspended",
    });

    // FDN-63. Audit only, for the same reason the membership cascade is
    // (F191). Suspension already revokes every device this user holds
    // in every workspace, so access is blocked everywhere without touching
    // `device.is_revoked` — and leaving that flag alone keeps it meaning
    // exactly one thing: the device's own user retired it. This codebase
    // treats suspension as offboarding (F151), so the classifier reports
    // `membership-revoked`, which the audit rows match.
    const owned = await transaction
      .select({ id: device.id })
      .from(device)
      .where(eq(device.userId, userId));
    for (const row of owned) {
      await recordTrustEvent(transaction, {
        deviceId: row.id,
        userId,
        eventType: "revoked-membership",
      });
    }
  });
}

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
  device,
  deviceUnlockSecret,
  member,
  organization,
  session,
  user,
} from "./schema.js";

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

export async function confirmWorkspaceAdmission(
  membershipIdInput: string,
): Promise<void> {
  const membershipId = uuidV4Schema.parse(membershipIdInput);
  const [confirmed] = await db
    .update(member)
    .set({ status: "active", projectionState: "confirmed" })
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.status, "pending"),
        eq(member.projectionState, "pending"),
      ),
    )
    .returning({ id: member.id });

  if (!confirmed) {
    throw new Error("Workspace admission was not pending confirmation");
  }
}

/**
 * Deny centrally first. FDN-85 confirms the historical graph projection
 * later. This also revokes every device's sealed local-store unlock secret
 * for this user in this workspace (FDN-84): the device's own key half and
 * its ciphertext are untouched, but the server denies the next unlock
 * attempt at the cold-restart checkpoint before either half is combined.
 */
export async function revokeWorkspaceAdmission(
  membershipIdInput: string,
): Promise<void> {
  const membershipId = uuidV4Schema.parse(membershipIdInput);

  await db.transaction(async (transaction) => {
    const [revoked] = await transaction
      .update(member)
      .set({ status: "revoked", projectionState: "revocation-pending" })
      .where(eq(member.id, membershipId))
      .returning({ userId: member.userId, workspaceId: member.organizationId });
    if (!revoked) throw new Error("Workspace membership does not exist");

    await transaction
      .update(session)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(session.userId, revoked.userId),
          eq(session.activeOrganizationId, revoked.workspaceId),
        ),
      );

    await transaction
      .update(deviceUnlockSecret)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(deviceUnlockSecret.workspaceId, revoked.workspaceId),
          eq(deviceUnlockSecret.userId, revoked.userId),
        ),
      );

    // FDN-63. Audit only. The cascade above is workspace-scoped — it revokes
    // this user's unlock secrets IN THIS WORKSPACE — and per F191 it must
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
 * device of `userId` that holds an unlock secret in `workspaceId`, so the
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
    .select({ deviceId: deviceUnlockSecret.deviceId })
    .from(deviceUnlockSecret)
    .innerJoin(device, eq(device.id, deviceUnlockSecret.deviceId))
    .where(
      and(
        eq(deviceUnlockSecret.workspaceId, workspaceId),
        eq(deviceUnlockSecret.userId, userId),
      ),
    );

  for (const row of affected) {
    await recordTrustEvent(transaction, {
      deviceId: row.deviceId,
      userId,
      workspaceId,
      eventType: "revoked-membership",
    });
  }
}

export async function confirmWorkspaceRevocationProjection(
  membershipIdInput: string,
): Promise<void> {
  const membershipId = uuidV4Schema.parse(membershipIdInput);
  const [confirmed] = await db
    .update(member)
    .set({ projectionState: "confirmed" })
    .where(
      and(
        eq(member.id, membershipId),
        eq(member.status, "revoked"),
        eq(member.projectionState, "revocation-pending"),
      ),
    )
    .returning({ id: member.id });

  if (!confirmed) {
    throw new Error("Workspace revocation was not awaiting projection");
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
    await transaction
      .update(deviceUnlockSecret)
      .set({ revokedAt: new Date() })
      .where(eq(deviceUnlockSecret.userId, userId));

    // FDN-63. Audit only, for the same reason the membership cascade is
    // (F191). Suspension already revokes every unlock secret this user holds
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

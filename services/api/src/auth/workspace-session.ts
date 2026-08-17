import {
  parseWorkspaceRoles,
  serializeWorkspaceRoles,
  uuidV4Schema,
  type WorkspaceRole,
} from "@vulto/schema";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db.js";
import { auth } from "./config.js";
import { deviceUnlockSecret, member, organization, session, user } from "./schema.js";

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
  });
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
  });
}

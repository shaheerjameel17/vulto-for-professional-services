import { randomUUID } from "node:crypto";
import {
  parseWorkspaceRoles,
  serializeWorkspaceRoles,
  workspaceRoleSchema,
  uuidV4Schema,
  type WorkspaceRole,
} from "@vulto/schema";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { auth } from "./config.js";
import { audienceMaterializer } from "../audience/materializer.js";
import { projectRoleChange } from "../graph/membership-changes.js";
import { membershipInEdgeId, membershipOfEdgeId } from "./membership-edge-ids.js";
import { member, organization, user } from "./schema.js";
import {
  confirmWorkspaceAdmission,
  createPendingWorkspaceAdmission,
  revokeWorkspaceAdmission,
} from "./workspace-session.js";

/**
 * Workspace creation, role changes and member removal.
 *
 * Every one of these is a single server transaction (F199): the central
 * Better Auth rows, the graph copy of the membership, the audience and, for a
 * removal, the person's devices all change together, so there is no device-side
 * step to wait for and no grant to hand a device. (Until Stage 7 a device-side
 * projection ran alongside; that dual write and its grants are gone.)
 */

export { membershipInEdgeId, membershipOfEdgeId };

/** Non-enumerating: every reason a workspace change is refused reads the same. */
export class WorkspaceProjectionDeniedError extends Error {
  constructor() {
    super("This session is not authorized to project this workspace admission");
  }
}

function slugFor(workspaceName: string, workspaceId: string): string {
  const base = workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base.length > 0 ? base : "workspace"}-${workspaceId}`;
}

async function sessionUserId(headers: Headers): Promise<string> {
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!current) throw new WorkspaceProjectionDeniedError();
  return current.user.id;
}

export interface CreateWorkspaceRequest {
  workspaceName: string;
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
  return { workspaceName: name };
}

export interface CreatedWorkspace {
  workspaceId: string;
  membershipId: string;
}

/**
 * Creates a workspace with its founding Owner. The central rows, the five
 * founding graph records and the audience are written together, and the Owner's
 * membership is confirmed in the same step: nothing waits on a device.
 */
export async function createWorkspace(
  headers: Headers,
  request: CreateWorkspaceRequest,
): Promise<CreatedWorkspace> {
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
  await confirmWorkspaceAdmission(membershipId);
  return { workspaceId, membershipId };
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
    roles,
  };
}

export interface RoleChangeResult {
  direction: RoleChangeDirection;
  before: WorkspaceRole[];
  after: WorkspaceRole[];
}

/**
 * Changes a member's roles. Widening and narrowing take the same path: the
 * central `member.role`, the graph copy of the membership and the audience change
 * in one transaction, and every live session sees the new roles on its next
 * request (F127). `direction` is reported for the caller and the audit trail.
 */
export async function changeWorkspaceRole(
  headers: Headers,
  request: ChangeRoleRequest,
): Promise<RoleChangeResult> {
  const workspaceId = uuidV4Schema.parse(request.workspaceId);
  const membershipId = uuidV4Schema.parse(request.membershipId);
  const { actorUserId } = await requireConfirmedOwner(headers, workspaceId);

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

  await db.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(member)
      .set({ role: serializeWorkspaceRoles(after) })
      .where(
        and(
          eq(member.id, membershipId),
          eq(member.status, "active"),
          eq(member.projectionState, "confirmed"),
        ),
      )
      .returning({ id: member.id });
    if (!updated) throw new WorkspaceProjectionDeniedError();
    await projectRoleChange(transaction, {
      workspaceId,
      membershipId,
      roles: after,
      actorUserId,
      occurredAt: new Date().toISOString(),
    });
    await audienceMaterializer.recomputeWorkspace(transaction, workspaceId);
  });

  return { direction, before, after };
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
 * thin, owner-gated wrapper over `revokeWorkspaceAdmission`, which owns the
 * cascade (graph copy, audience, sessions, devices, audit) in one transaction.
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

  await revokeWorkspaceAdmission(membershipId, actorUserId);
}

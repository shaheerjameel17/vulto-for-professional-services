import { parseWorkspaceRoles } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { member, organization, user } from "../auth/schema.js";
import type { GraphTx } from "../graph/tx.js";
import type { MemberPrincipal } from "./principal.js";

/**
 * Resolves a member principal from the central Better Auth rows — the
 * membership, the account and the workspace must all be active. Read on every
 * call and never cached (A004-T06), so a role change or removal is seen by the
 * very next request. Returns `null` when the person no longer holds the
 * membership, and a job that re-resolves its principal treats that as
 * "withdrawn".
 */
export async function resolveMemberPrincipal(
  tx: GraphTx,
  input: { readonly userId: string; readonly workspaceId: string },
): Promise<MemberPrincipal | null> {
  const [row] = await tx
    .select({ membershipId: member.id, roles: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.userId, input.userId),
        eq(member.organizationId, input.workspaceId),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
        eq(user.status, "active"),
        eq(organization.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  try {
    return {
      kind: "member",
      userId: input.userId,
      workspaceId: input.workspaceId,
      membershipId: row.membershipId,
      roles: parseWorkspaceRoles(row.roles),
    };
  } catch {
    return null;
  }
}

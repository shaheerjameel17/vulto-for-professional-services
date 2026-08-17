import { z } from "zod";

/** Roles persisted on a server-side WorkspaceMembership. */
export const WORKSPACE_ROLES = [
  "owner",
  "hr-admin",
  "finance-admin",
  "team-member",
] as const;

export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

export const passkeyRegistrationInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().trim().toLowerCase(),
});
export type PasskeyRegistrationInput = z.infer<typeof passkeyRegistrationInputSchema>;

export const USER_STATUSES = ["active", "suspended", "deleted"] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const WORKSPACE_STATUSES = ["active", "suspended", "canceled"] as const;
export const workspaceStatusSchema = z.enum(WORKSPACE_STATUSES);
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

export const WORKSPACE_MEMBERSHIP_STATUSES = ["pending", "active", "revoked"] as const;
export const workspaceMembershipStatusSchema = z.enum(WORKSPACE_MEMBERSHIP_STATUSES);
export type WorkspaceMembershipStatus = z.infer<typeof workspaceMembershipStatusSchema>;

export const MEMBERSHIP_PROJECTION_STATES = [
  "pending",
  "confirmed",
  "revocation-pending",
] as const;
export const membershipProjectionStateSchema = z.enum(MEMBERSHIP_PROJECTION_STATES);
export type MembershipProjectionState = z.infer<typeof membershipProjectionStateSchema>;

export function serializeWorkspaceRoles(roles: readonly WorkspaceRole[]): string {
  const unique = [...new Set(roles)].sort();
  if (unique.length === 0) {
    throw new Error("A workspace membership must carry at least one role");
  }
  return unique.map((role) => workspaceRoleSchema.parse(role)).join(",");
}

export function parseWorkspaceRoles(value: string): WorkspaceRole[] {
  const roles = value
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0)
    .map((role) => workspaceRoleSchema.parse(role));

  if (roles.length === 0) {
    throw new Error("A workspace membership must carry at least one role");
  }

  return [...new Set(roles)];
}

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

/**
 * FDN-63. `VPS-F001`'s Device identity record. A control-plane row, not a
 * graph node (F189) and not `VPS-A003`'s per-workspace `device_unlock_secret`
 * (F151) — one identity row per `(user, application)`, carrying exactly the
 * nine fields `VPS-F001`'s Graph model names.
 */
export const DEVICE_PLATFORMS = ["web", "ios", "android", "macos", "windows"] as const;
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

/**
 * The suite applications a device can register against. `VPS-F001`: "the same
 * physical laptop running Roster and Vulto Accounts presents two separate web
 * origins and needs two independently synced, independently revocable local
 * graphs." Default `VultoRoster`.
 */
export const DEVICE_APPLICATIONS = [
  "VultoRoster",
  "VultoAccounts",
  "VultoProjects",
  "VultoLegal",
] as const;
export const deviceApplicationSchema = z.enum(DEVICE_APPLICATIONS);
export type DeviceApplication = z.infer<typeof deviceApplicationSchema>;

/**
 * A device identifier is generated once on the device and persisted in its
 * sealed store (`SealedStore.deviceId()`); it is not a UUID. Same pattern the
 * `device_unlock_secret` unlock checkpoint already validates.
 */
export const deviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,128}$/, "Invalid device identifier");
export type DeviceId = z.infer<typeof deviceIdSchema>;

export const deviceRegistrationInputSchema = z.object({
  deviceName: z.string().trim().min(1).max(100),
  platform: devicePlatformSchema,
  application: deviceApplicationSchema.default("VultoRoster"),
  pushToken: z.string().trim().min(1).max(512).nullish(),
});
export type DeviceRegistrationInput = z.input<typeof deviceRegistrationInputSchema>;

/**
 * The reason a device's trust changed, carried on the append-only trust-event
 * log (FDN-63 Stage 2). The scope each one had matters as much as the reason,
 * so they are not interchangeable (F191):
 *
 * - `revoked-explicit` / `revoked-membership` / `stale-flagged` are
 *   **workspace-scoped** — the event row carries the workspace whose unlock
 *   secret was revoked, and the device keeps its access to every other one.
 * - `retired-by-user` is **global**, and only the device's own user may
 *   cause it: `device.is_revoked` set, every unlock secret revoked.
 * - `stale-flagged` alone is recoverable by an Owner re-approval.
 *
 * There is deliberately no `activity-refreshed`. An earlier draft declared
 * one and never wrote it, which is the F130/F133/F143 pattern in miniature —
 * a reader would find a named event type and reasonably assume something
 * emitted it. Activity is `device.last_active_at`, a column that is already
 * the record; a row every five minutes per device would be noise around a
 * fact that is not a trust decision.
 */
export const DEVICE_TRUST_EVENT_TYPES = [
  "registered",
  "revoked-explicit",
  "revoked-membership",
  "retired-by-user",
  "stale-flagged",
  "re-approved",
] as const;
export const deviceTrustEventTypeSchema = z.enum(DEVICE_TRUST_EVENT_TYPES);
export type DeviceTrustEventType = z.infer<typeof deviceTrustEventTypeSchema>;

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

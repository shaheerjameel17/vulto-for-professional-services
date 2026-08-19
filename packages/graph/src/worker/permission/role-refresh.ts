import { workspaceRoleSchema, type WorkspaceRole } from "@vulto/schema";
import { z } from "zod";

/**
 * FDN-53 stage 1 (F127). The Worker-side client for the lightweight
 * `POST /device-store/roles` checkpoint (`services/api/src/auth/device-unlock.ts`'s
 * `requestDeviceRoleRefresh`), which revalidates the current session via
 * `requireCurrentWorkspaceSession` and returns the caller's current roles
 * without releasing a server-half or deriving a key. Used both by the
 * explicit `refresh-role` protocol message and by the placeholder polling
 * loop in `runtime.ts`.
 */

const roleRefreshResponseSchema = z
  .object({
    roles: z.array(workspaceRoleSchema).min(1),
    membershipId: z.string().min(1),
  })
  .strict();

export interface RoleRefreshResult {
  readonly roles: WorkspaceRole[];
  readonly membershipId: string;
}

/** Non-enumerating, matching the unlock endpoint's own denial shape. */
export class RoleRefreshDeniedError extends Error {
  constructor() {
    super("The server denied this device's role refresh request");
  }
}

export async function fetchCurrentRoles(
  apiOrigin: string,
  workspaceId: string,
): Promise<RoleRefreshResult> {
  const response = await fetch(`${apiOrigin}/device-store/roles`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId }),
  });
  if (!response.ok) throw new RoleRefreshDeniedError();
  const parsed = roleRefreshResponseSchema.parse(await response.json());
  return { roles: parsed.roles, membershipId: parsed.membershipId };
}

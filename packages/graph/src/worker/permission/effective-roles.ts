import type { WorkspaceRole } from "@vulto/schema";
import type { PolicyRole } from "./policy-table";

/**
 * Maps the stored `WorkspaceRole` set (from a device-unlock grant or a
 * role-refresh response) to the coarse `PolicyRole` set the policy table
 * understands.
 *
 * `"manager"` is deliberately never produced here. Manager permission is
 * derived from `managed_by` edges targeting the caller's own Employee node
 * (`VPS-F001` G06), which requires knowing which Employee node the caller
 * IS — a User-to-Employee identity link `VRS-F002` (Atomic Employee
 * Profiles) has not built yet, and `VRS-F002` is out of scope for this
 * phase per `CLAUDE.md`. This stage cannot determine whether the caller
 * manages anyone, so it never grants Manager permission rather than
 * guessing. See `policy-table.ts`'s doc comment and this stage's report
 * (candidate finding F128).
 */
export function deriveEffectiveRoles(
  storedRoles: readonly WorkspaceRole[],
): PolicyRole[] {
  const roles = new Set<PolicyRole>();
  for (const role of storedRoles) roles.add(role);
  return [...roles];
}

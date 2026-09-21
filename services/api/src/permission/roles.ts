import { deriveEffectiveRoles, type PolicyRole } from "@vulto/schema";
import { incoming, type GraphTx } from "../graph/store.js";
import { resolveEmployeeForUser } from "./employee-link.js";
import type { MemberPrincipal } from "./principal.js";

export interface RoleDependencies {
  readonly resolveEmployeeForUser: typeof resolveEmployeeForUser;
  /** UTC ISO-8601 instant at which "active" is judged. */
  readonly now: () => string;
}

const defaultDependencies: RoleDependencies = {
  resolveEmployeeForUser,
  now: () => new Date().toISOString(),
};

/**
 * Manager is derived, not assigned (VPS-A004): a member is a Manager when the
 * Employee they are has at least one active `managed_by` edge pointing at
 * them. It applies only where the User-to-Employee link exists, so today it
 * resolves to nothing. Read from Postgres at request time; never cached.
 */
export async function isManager(
  tx: GraphTx,
  principal: MemberPrincipal,
  deps: RoleDependencies = defaultDependencies,
): Promise<boolean> {
  const employeeId = await deps.resolveEmployeeForUser(
    tx,
    principal.workspaceId,
    principal.userId,
  );
  if (employeeId === null) return false;
  const reports = await incoming(
    tx,
    principal.workspaceId,
    employeeId,
    "managed_by",
    deps.now(),
  );
  return reports.length > 0;
}

/**
 * The union of a member's stored roles and any derived Manager role
 * (A004-T05), computed fresh for each request so a role change lands on the
 * very next one (A004-T06).
 */
export async function effectiveRoles(
  tx: GraphTx,
  principal: MemberPrincipal,
  deps: RoleDependencies = defaultDependencies,
): Promise<PolicyRole[]> {
  const roles = new Set<PolicyRole>(deriveEffectiveRoles(principal.roles));
  if (await isManager(tx, principal, deps)) roles.add("manager");
  return [...roles];
}

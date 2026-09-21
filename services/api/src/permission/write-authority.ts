import { getOwnershipRegistration, type NodeType } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { graphNodes } from "../graph/schema.js";
import type { GraphTx } from "../graph/store.js";

/**
 * Gate 2 (VPS-F008, A004-T11): which application currently holds write
 * authority for a node type. It runs after the role gate and only ever narrows.
 *
 * The rule is read from `OWNERSHIP_REGISTRY`, never re-decided here:
 *  - `permanent`: only the owning application may write.
 *  - `activation-handoff`: the pre-activation writer (Roster) writes until the
 *    owning application is activated for the workspace, and the owner alone
 *    thereafter.
 *  - `concurrent`: both may write; field-level authority is an application
 *    concern (A004 "Field-level write authority").
 * Only the four activatable applications have an activation record (VPS-F008
 * G01); an owner outside them (Vulto Sales for Client) has nothing to hand off
 * to, so no restriction applies.
 */
const ACTIVATABLE_OWNERS = new Set([
  "Vulto Projects",
  "Vulto Accounts",
  "Vulto Legal",
  "Vulto Payroll",
]);

/** `VultoRoster` -> `Vulto Roster`, the spelling the ownership registry uses. */
export function registryApplicationName(application: string): string {
  return application.replace(/^Vulto(?=[A-Z])/, "Vulto ");
}

async function activatedApplications(
  tx: GraphTx,
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await tx
    .select({ record: graphNodes.record })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.workspaceId, workspaceId),
        eq(graphNodes.nodeType, "ApplicationActivation"),
        eq(graphNodes.lifecycleStatus, "Active"),
        eq(graphNodes.isSoftDeleted, false),
      ),
    );
  const active = new Set<string>();
  for (const { record } of rows) {
    const application = (record as Record<string, unknown>)["application"];
    if (typeof application === "string")
      active.add(registryApplicationName(application));
  }
  return active;
}

export type WriteAuthorityResult = { allowed: true } | { allowed: false };

export async function checkWriteAuthority(
  tx: GraphTx,
  workspaceId: string,
  nodeType: NodeType,
  application: string,
): Promise<WriteAuthorityResult> {
  const registration = getOwnershipRegistration(nodeType);
  if (registration === undefined || registration.mode === "concurrent") {
    return { allowed: true };
  }
  const caller = registryApplicationName(application);
  const owner = registration.authoritativeOwner.replace(
    / (once activated|bootstrap)$/,
    "",
  );
  if (registration.mode === "permanent") {
    return { allowed: caller === owner };
  }
  // activation-handoff: an Active activation for the owner makes it exclusive.
  // Without one, nothing narrows the write beyond the role gate.
  if (!ACTIVATABLE_OWNERS.has(owner)) return { allowed: true };
  const activated = await activatedApplications(tx, workspaceId);
  return { allowed: activated.has(owner) ? caller === owner : true };
}

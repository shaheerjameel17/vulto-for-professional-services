import { randomUUID } from "node:crypto";
import type { WorkspaceRole } from "@vulto/schema";
import { writeMembershipUser } from "./membership-projection.js";
import { insertEdge, insertNode, type GraphTx } from "./store.js";
import { createInitialCalendar } from "../mutations/calendar.js";

export interface FoundingRecords {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly membershipId: string;
  /** The Better Auth account id — the `User` node's `node_id`. */
  readonly userId: string;
  readonly roles: readonly WorkspaceRole[];
  readonly membershipOfEdgeId: string;
  readonly membershipInEdgeId: string;
  /** UTC ISO-8601. Supplied by the caller. */
  readonly occurredAt: string;
}

/** Sorted, de-duplicated, comma-joined, so comparison is order-independent. */
export function canonicalRoles(roles: readonly WorkspaceRole[]): string {
  return [...new Set(roles)].slice().sort().join(",");
}

/**
 * Writes the eight graph records every workspace starts with — the Workspace,
 * default Entity and WorkingCalendar nodes, the founding member's User node,
 * the WorkspaceMembership node, and their three founding edges — in the caller's transaction, so
 * they commit or roll back together with the central membership row.
 *
 * The User node is one row per workspace (F204); its record carries no
 * `workspace_id`.
 */
export async function writeFoundingRecords(
  tx: GraphTx,
  input: FoundingRecords,
): Promise<void> {
  const base = (nodeId: string, nodeType: string, extra: Record<string, unknown>) => ({
    node_id: nodeId,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: input.occurredAt,
    created_by: input.userId,
    updated_at: input.occurredAt,
    updated_by: input.userId,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    ...extra,
  });

  await insertNode(
    tx,
    base(input.workspaceId, "Workspace", { name: input.workspaceName }),
  );
  const entityId = randomUUID();
  await insertNode(
    tx,
    base(entityId, "Entity", {
      workspace_id: input.workspaceId,
      name: input.workspaceName,
      legal_name: null,
      jurisdiction: "Global",
      registered_address: null,
      registration_number: null,
      default_currency: "USD",
    }),
  );
  await createInitialCalendar(tx, {
    workspaceId: input.workspaceId,
    entityId,
    jurisdiction: "Global",
    userId: input.userId,
    now: input.occurredAt,
    calendarId: randomUUID(),
    edgeId: randomUUID(),
  });
  await writeMembershipUser(tx, input.workspaceId, base(input.userId, "User", {}));
  await insertNode(
    tx,
    base(input.membershipId, "WorkspaceMembership", {
      workspace_id: input.workspaceId,
      role: canonicalRoles(input.roles),
    }),
  );

  const edge = {
    effective_from: input.occurredAt,
    effective_to: null,
    created_at: input.occurredAt,
    created_by: input.userId,
    metadata: {},
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
  await insertEdge(tx, input.workspaceId, {
    ...edge,
    edge_id: input.membershipOfEdgeId,
    edge_type: "membership_of",
    from_node_id: input.membershipId,
    to_node_id: input.userId,
  });
  await insertEdge(tx, input.workspaceId, {
    ...edge,
    edge_id: input.membershipInEdgeId,
    edge_type: "membership_in",
    from_node_id: input.membershipId,
    to_node_id: input.workspaceId,
  });
}

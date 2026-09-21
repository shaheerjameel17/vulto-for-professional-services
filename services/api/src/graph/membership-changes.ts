import type { WorkspaceRole } from "@vulto/schema";
import { writeMembershipUser } from "./membership-projection.js";
import { canonicalRoles } from "./founding.js";
import {
  closeEdge,
  getNode,
  insertEdge,
  insertNode,
  outgoing,
  updateNodeFields,
  type GraphTx,
} from "./store.js";

/**
 * Membership changes reach the graph in the same transaction as the Better Auth
 * change, the way `workspace.create` does (Stage 3). The graph copy is history,
 * and the input the sync audience recompute listens to (Stage 6); permission
 * decisions still read the central Better Auth row.
 */

const baseNode = (
  nodeId: string,
  nodeType: string,
  occurredAt: string,
  actorUserId: string,
  extra: Record<string, unknown>,
) => ({
  node_id: nodeId,
  node_type: nodeType,
  schema_version: 1,
  lifecycle_status: "Active",
  created_at: occurredAt,
  created_by: actorUserId,
  updated_at: occurredAt,
  updated_by: actorUserId,
  is_soft_deleted: false,
  soft_deleted_at: null,
  soft_deleted_by: null,
  ...extra,
});

const baseEdge = (occurredAt: string, actorUserId: string) => ({
  effective_from: occurredAt,
  effective_to: null,
  created_at: occurredAt,
  created_by: actorUserId,
  metadata: {},
  is_soft_deleted: false,
  soft_deleted_at: null,
  soft_deleted_by: null,
});

export interface MemberAdmission {
  readonly workspaceId: string;
  readonly membershipId: string;
  /** The Better Auth account id of the person being admitted. */
  readonly userId: string;
  readonly roles: readonly WorkspaceRole[];
  readonly membershipOfEdgeId: string;
  readonly membershipInEdgeId: string;
  /** Who admitted them. */
  readonly actorUserId: string;
  readonly occurredAt: string;
}

/**
 * Invitation acceptance: the person's User row in this workspace (one per
 * workspace, F204; skipped if it already exists), their WorkspaceMembership
 * node, and the two edges joining them. The invitation flow itself is FDN-86;
 * it calls this inside its own transaction.
 */
export async function projectMemberAdmission(
  tx: GraphTx,
  input: MemberAdmission,
): Promise<void> {
  if (!(await getNode(tx, input.workspaceId, input.userId))) {
    await writeMembershipUser(
      tx,
      input.workspaceId,
      baseNode(input.userId, "User", input.occurredAt, input.actorUserId, {}),
    );
  }
  await insertNode(
    tx,
    baseNode(
      input.membershipId,
      "WorkspaceMembership",
      input.occurredAt,
      input.actorUserId,
      {
        workspace_id: input.workspaceId,
        role: canonicalRoles(input.roles),
      },
    ),
  );
  const edge = baseEdge(input.occurredAt, input.actorUserId);
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

/** A role change: the WorkspaceMembership node's `role`, unless it already matches. */
export async function projectRoleChange(
  tx: GraphTx,
  input: {
    readonly workspaceId: string;
    readonly membershipId: string;
    readonly roles: readonly WorkspaceRole[];
    readonly actorUserId: string;
    readonly occurredAt: string;
  },
): Promise<void> {
  const node = await getNode(tx, input.workspaceId, input.membershipId);
  const role = canonicalRoles(input.roles);
  if (node && node.record["role"] === role) return;
  await updateNodeFields(tx, input.workspaceId, input.membershipId, null, {
    role,
    updated_at: input.occurredAt,
    updated_by: input.actorUserId,
  });
}

/**
 * Removal: the WorkspaceMembership node becomes `Revoked` and its two edges are
 * closed at the removal instant. Nothing is deleted (A002-T11); the person's
 * User row stays as history.
 */
export async function projectMemberRemoval(
  tx: GraphTx,
  input: {
    readonly workspaceId: string;
    readonly membershipId: string;
    readonly actorUserId: string;
    readonly occurredAt: string;
  },
): Promise<void> {
  await updateNodeFields(tx, input.workspaceId, input.membershipId, null, {
    lifecycle_status: "Revoked",
    updated_at: input.occurredAt,
    updated_by: input.actorUserId,
  });
  for (const edgeType of ["membership_of", "membership_in"] as const) {
    for (const edge of await outgoing(
      tx,
      input.workspaceId,
      input.membershipId,
      edgeType,
    )) {
      if (edge.effectiveTo !== null) continue;
      // An edge cannot end at or before it began.
      const from = edge.effectiveFrom === null ? 0 : Date.parse(edge.effectiveFrom);
      const effectiveTo = new Date(
        Math.max(Date.parse(input.occurredAt), from + 1),
      ).toISOString();
      await closeEdge(tx, input.workspaceId, edge.edgeId, effectiveTo, {
        userId: input.actorUserId,
        at: input.occurredAt,
      });
    }
  }
}

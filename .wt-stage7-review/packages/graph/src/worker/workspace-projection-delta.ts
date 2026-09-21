import { type NodeType } from "@vulto/schema";
import { LoroDoc, LoroMap } from "loro-crdt/web";
import { EDGE_FRAGMENT_CONTAINER } from "./document-edge-fragments";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "./document-node-fragments";
import {
  canonicalRoles,
  PROJECTION_AUTHORIZATION_PATH,
  type ProjectionKind,
  type WorkspaceAdmissionDetails,
  type WorkspaceAdmissionGrant,
  type WorkspaceAdmissionProjection,
  type WorkspaceProjectionOutboxEntry,
  type WorkspaceTransitionGrant,
} from "./workspace-projection";

/**
 * FDN-85 — the Loro delta builders for the workspace/membership projection.
 *
 * Split from `workspace-projection.ts` (which stays free of any Loro import so
 * its pure logic — the outbox reconciler, the reconciliation-trigger
 * classifier, `canonicalRoles`, the grant acceptors — is unit-testable in
 * Node) because a browser Worker bundle can only carry `loro-crdt/web`, not
 * the plain `loro-crdt` build webpack cannot parse without a wasm experiment
 * flag. Same reason FDN-92's `edge-write-proof.ts` is a separate `/web` file.
 */

function outboxEntry(
  kind: ProjectionKind,
  ids: { membershipId: string; workspaceId: string },
  occurredAt: string,
): WorkspaceProjectionOutboxEntry {
  return {
    kind,
    membershipId: ids.membershipId,
    workspaceId: ids.workspaceId,
    authorizationPath: PROJECTION_AUTHORIZATION_PATH,
    createdAt: occurredAt,
    committedLocally: false,
    confirmed: false,
  };
}

function writeNodeFragment(
  document: LoroDoc,
  nodeId: string,
  nodeType: NodeType,
  partitionKey: string,
  details: WorkspaceAdmissionDetails,
  extra: Record<string, unknown>,
): void {
  const fragment = document
    .getMap(NODE_FRAGMENT_CONTAINER)
    .setContainer(nodeFragmentKey(nodeId, partitionKey), new LoroMap());
  const record: Record<string, unknown> = {
    node_id: nodeId,
    node_type: nodeType,
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: details.occurredAt,
    created_by: details.actorUserId,
    updated_at: details.occurredAt,
    updated_by: details.actorUserId,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    ...extra,
  };
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    fragment.set(key, value);
  }
}

function writeEdgeFragment(document: LoroDoc, record: Record<string, unknown>): void {
  const fragment = document
    .getMap(EDGE_FRAGMENT_CONTAINER)
    .setContainer(record["edge_id"] as string, new LoroMap());
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
}

/**
 * Builds the projection delta: exactly five records, one Loro commit.
 *
 * - `Workspace` / `display`  — unscoped (no `workspace_id`), carries `name`.
 * - `WorkspaceMembership` / `record` — workspace-scoped, carries `role`
 *   (the serialized `WorkspaceRole[]`, kept as durable history — the live
 *    permission decision still comes from the cached server grant, Q2).
 * - `User` / `record` — unscoped, the `membership_of` endpoint.
 * - `membership_of` edge — WorkspaceMembership -> User.
 * - `membership_in` edge — WorkspaceMembership -> Workspace.
 */
export function buildWorkspaceAdmissionDelta(
  grant: WorkspaceAdmissionGrant,
  details: WorkspaceAdmissionDetails,
): Uint8Array {
  const document = new LoroDoc();
  document.setPeerId(85n);
  const { workspaceId, membershipId, userId, roles } = grant;

  // Workspace and User are unscoped node types — no `workspace_id`.
  writeNodeFragment(document, workspaceId, "Workspace", "display", details, {
    name: details.workspaceName,
  });
  writeNodeFragment(document, userId, "User", "record", details, {});
  writeNodeFragment(document, membershipId, "WorkspaceMembership", "record", details, {
    workspace_id: workspaceId,
    role: canonicalRoles(roles),
  });

  const edgeBase = {
    effective_from: details.occurredAt,
    effective_to: null,
    created_at: details.occurredAt,
    created_by: details.actorUserId,
    metadata: {},
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
  writeEdgeFragment(document, {
    ...edgeBase,
    edge_id: grant.membershipOfEdgeId,
    edge_type: "membership_of",
    from_node_id: membershipId,
    to_node_id: userId,
  });
  writeEdgeFragment(document, {
    ...edgeBase,
    edge_id: grant.membershipInEdgeId,
    edge_type: "membership_in",
    from_node_id: membershipId,
    to_node_id: workspaceId,
  });

  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return bytes;
}

export function projectWorkspaceAdmission(
  grant: WorkspaceAdmissionGrant,
  details: WorkspaceAdmissionDetails,
): WorkspaceAdmissionProjection {
  return {
    delta: buildWorkspaceAdmissionDelta(grant, details),
    outboxEntry: outboxEntry("admission", grant, details.occurredAt),
  };
}

/**
 * A one-record delta: the WorkspaceMembership node fragment, in full, with the
 * transition applied. Written as an idempotent upsert keyed by the same
 * fragment key the admission projection used, so it merges field-by-field
 * into any workspace graph that already carries the node (or creates it, for
 * a graph that has not yet synced the admission).
 */
function buildMembershipFragmentDelta(
  grant: WorkspaceTransitionGrant,
  details: WorkspaceAdmissionDetails,
  lifecycleStatus: "Active" | "Revoked",
): Uint8Array {
  const document = new LoroDoc();
  document.setPeerId(85n);
  const fragment = document
    .getMap(NODE_FRAGMENT_CONTAINER)
    .setContainer(nodeFragmentKey(grant.membershipId, "record"), new LoroMap());
  const record: Record<string, unknown> = {
    node_id: grant.membershipId,
    node_type: "WorkspaceMembership",
    schema_version: 1,
    lifecycle_status: lifecycleStatus,
    workspace_id: grant.workspaceId,
    role: canonicalRoles(grant.roles),
    created_at: details.occurredAt,
    created_by: details.actorUserId,
    updated_at: details.occurredAt,
    updated_by: details.actorUserId,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
  for (const [key, value] of Object.entries(record)) fragment.set(key, value);
  document.commit();
  const bytes = document.export({ mode: "snapshot" });
  document.free();
  return bytes;
}

export function projectMembershipRevocation(
  grant: WorkspaceTransitionGrant,
  details: WorkspaceAdmissionDetails,
): WorkspaceAdmissionProjection {
  if (grant.kind !== "revocation") {
    throw new Error("projectMembershipRevocation requires a revocation grant");
  }
  return {
    delta: buildMembershipFragmentDelta(grant, details, "Revoked"),
    outboxEntry: outboxEntry("revocation", grant, details.occurredAt),
  };
}

export function projectMembershipRoleChange(
  grant: WorkspaceTransitionGrant,
  details: WorkspaceAdmissionDetails,
): WorkspaceAdmissionProjection {
  if (grant.kind !== "role-change") {
    throw new Error("projectMembershipRoleChange requires a role-change grant");
  }
  return {
    delta: buildMembershipFragmentDelta(grant, details, "Active"),
    outboxEntry: outboxEntry("role-change", grant, details.occurredAt),
  };
}

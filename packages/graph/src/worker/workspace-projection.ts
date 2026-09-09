import {
  serializeWorkspaceRoles,
  type NodeType,
  type WorkspaceRole,
} from "@vulto/schema";
import { LoroDoc, LoroMap } from "loro-crdt";
import { EDGE_FRAGMENT_CONTAINER } from "./document-edge-fragments";
import { NODE_FRAGMENT_CONTAINER, nodeFragmentKey } from "./document-node-fragments";

/**
 * FDN-85 Stage 2 — the privileged workspace-admission projection command.
 *
 * This is the ONLY writer of the five reserved-type records the generic
 * `mutate` gate refuses (Stage 1): the Workspace node, the WorkspaceMembership
 * node, the member's User node, and the `membership_of` / `membership_in`
 * edges. It is a deterministic one-way projection of the Better Auth control
 * plane — every value comes from a consumed server grant or the small
 * `WorkspaceAdmissionDetails` bundle, never from an arbitrary caller-supplied
 * fragment.
 *
 * "Reachable only through a valid grant" is structural, not a runtime flag:
 * `projectWorkspaceAdmission` takes a `WorkspaceAdmissionGrant`, and the only
 * way to obtain one is `acceptProjectionGrant`, called with a server
 * `POST /workspace/create` response the server has already validated and
 * marked consumed. The command reads the workspace / membership / user ids,
 * the role set, and the two edge ids from the grant — never from its other
 * arguments — so a caller cannot point it at a different membership or inject
 * a record of any other shape.
 */

export interface WorkspaceAdmissionGrant {
  /** Branded so a plain object literal cannot stand in for a consumed grant. */
  readonly __brand: "vulto.workspace-admission-grant";
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly roles: readonly WorkspaceRole[];
  /** Deterministic, server-computed. Idempotent re-projection reuses them. */
  readonly membershipOfEdgeId: string;
  readonly membershipInEdgeId: string;
}

/**
 * The boundary between the server's consumed-grant response and the
 * privileged command. Everything the command trusts passes through here.
 */
export function acceptProjectionGrant(consumed: {
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly userId: string;
  readonly roles: readonly WorkspaceRole[];
  readonly membershipOfEdgeId: string;
  readonly membershipInEdgeId: string;
}): WorkspaceAdmissionGrant {
  return {
    __brand: "vulto.workspace-admission-grant",
    workspaceId: consumed.workspaceId,
    membershipId: consumed.membershipId,
    userId: consumed.userId,
    roles: [...consumed.roles],
    membershipOfEdgeId: consumed.membershipOfEdgeId,
    membershipInEdgeId: consumed.membershipInEdgeId,
  };
}

export interface WorkspaceAdmissionDetails {
  /** Display name for the Workspace node's `display` partition. */
  readonly workspaceName: string;
  /** The account id performing the projection — the records' `created_by`. */
  readonly actorUserId: string;
  /** ISO-8601 UTC. `created_at` / `updated_at` / `effective_from`;
   * caller-supplied, never a Worker `Date.now()` (F124's mistake). */
  readonly occurredAt: string;
}

/**
 * The audit marker required by founder ruling Q1c: a projection write is
 * recorded in the outbox as having taken the privileged-exception path,
 * distinguishable from an ordinary role-authorized `mutate`.
 */
export const PROJECTION_AUTHORIZATION_PATH = "privileged-projection-exception" as const;

export interface WorkspaceProjectionOutboxEntry {
  readonly membershipId: string;
  readonly workspaceId: string;
  /** The Q1c audit marker. Never any other value for this command. */
  readonly authorizationPath: typeof PROJECTION_AUTHORIZATION_PATH;
  readonly createdAt: string;
  /** Set true once the delta is durably flushed to the sealed store. */
  readonly committedLocally: boolean;
  /** Set true once `confirmWorkspaceProjection` has acknowledged it. */
  readonly confirmed: boolean;
}

export interface WorkspaceAdmissionProjection {
  /** One Loro snapshot carrying exactly the five reserved-type records. */
  readonly delta: Uint8Array;
  readonly outboxEntry: WorkspaceProjectionOutboxEntry;
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
    role: serializeWorkspaceRoles([...roles]),
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
    outboxEntry: {
      membershipId: grant.membershipId,
      workspaceId: grant.workspaceId,
      authorizationPath: PROJECTION_AUTHORIZATION_PATH,
      createdAt: details.occurredAt,
      committedLocally: false,
      confirmed: false,
    },
  };
}

export interface ProjectionReconcileResult {
  readonly entries: readonly WorkspaceProjectionOutboxEntry[];
  readonly confirmed: readonly string[];
}

/**
 * The reconciler: for every outbox entry whose projection is durably flushed
 * (`isProjectionDurable`) but not yet confirmed, calls `confirm` (in
 * production, `POST /workspace/confirm-projection`, cookie-authenticated) and
 * marks it confirmed. Idempotent — a re-run over already-confirmed entries is
 * a no-op, and `confirm` itself is a CAS server-side (Q4).
 *
 * No sync-engine acknowledgment is required before confirming, per founder
 * ruling Q1d: another device cannot unlock into the workspace until its own
 * `requireCurrentWorkspaceSession` passes centrally, so a not-yet-synced
 * projection exposes nothing.
 */
export async function reconcileWorkspaceProjectionOutbox(
  entries: readonly WorkspaceProjectionOutboxEntry[],
  deps: {
    readonly isProjectionDurable: (entry: WorkspaceProjectionOutboxEntry) => boolean;
    readonly confirm: (entry: WorkspaceProjectionOutboxEntry) => Promise<void>;
  },
): Promise<ProjectionReconcileResult> {
  const next: WorkspaceProjectionOutboxEntry[] = [];
  const confirmed: string[] = [];
  for (const entry of entries) {
    const durable = entry.committedLocally || deps.isProjectionDurable(entry);
    if (entry.confirmed || !durable) {
      next.push(durable ? { ...entry, committedLocally: true } : entry);
      continue;
    }
    await deps.confirm(entry);
    confirmed.push(entry.membershipId);
    next.push({ ...entry, committedLocally: true, confirmed: true });
  }
  return { entries: next, confirmed };
}

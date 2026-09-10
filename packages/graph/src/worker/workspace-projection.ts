import { type WorkspaceRole } from "@vulto/schema";

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

/** Sorted, de-duplicated, comma-joined — the canonical form stored on the
 * WorkspaceMembership node's `role` field so drift comparison is
 * order-independent. */
export function canonicalRoles(roles: readonly WorkspaceRole[]): string {
  return [...new Set(roles)].slice().sort().join(",");
}

export type ProjectionKind = "admission" | "revocation" | "role-change";

export interface WorkspaceProjectionOutboxEntry {
  readonly kind: ProjectionKind;
  readonly membershipId: string;
  readonly workspaceId: string;
  /** The Q1c audit marker. Never any other value for a projection write. */
  readonly authorizationPath: typeof PROJECTION_AUTHORIZATION_PATH;
  readonly createdAt: string;
  /** Set true once the delta is durably flushed to the sealed store. */
  readonly committedLocally: boolean;
  /** Set true once the matching server confirm endpoint has acknowledged it. */
  readonly confirmed: boolean;
}

export interface WorkspaceAdmissionProjection {
  /** One Loro snapshot carrying exactly the five reserved-type records. */
  readonly delta: Uint8Array;
  readonly outboxEntry: WorkspaceProjectionOutboxEntry;
}

// ── FDN-85 Stage 3 — removal and role-change projection ──────────────────────

export interface WorkspaceTransitionGrant {
  readonly __brand: "vulto.workspace-transition-grant";
  readonly kind: "revocation" | "role-change";
  readonly workspaceId: string;
  readonly membershipId: string;
  /** The role set the WM node records after this transition. For a revocation
   * it is unchanged; for a role change it is the new set. */
  readonly roles: readonly WorkspaceRole[];
}

export function acceptTransitionGrant(consumed: {
  readonly kind: "revocation" | "role-change";
  readonly workspaceId: string;
  readonly membershipId: string;
  readonly roles: readonly WorkspaceRole[];
}): WorkspaceTransitionGrant {
  return {
    __brand: "vulto.workspace-transition-grant",
    kind: consumed.kind,
    workspaceId: consumed.workspaceId,
    membershipId: consumed.membershipId,
    roles: [...consumed.roles],
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

// ── Reconciliation triggers (Q4) ────────────────────────────────────────────

/** What the server currently says about this session's membership — the
 * output of `requireCurrentWorkspaceSession` (confirmed, with roles) or a
 * classified denial from the F127 role-refresh poll. */
export type MembershipGrantState =
  | { readonly status: "confirmed"; readonly roles: readonly WorkspaceRole[] }
  | { readonly status: "revoked" }
  | { readonly status: "pending" }
  | { readonly status: "absent" };

/** The WorkspaceMembership node as currently materialized in the local graph,
 * or `null` if it has not been projected/synced here yet. */
export interface ProjectedMembershipState {
  readonly lifecycleStatus: "Active" | "Revoked";
  readonly role: string;
}

export type ReconcileAction =
  | { readonly type: "retry-confirm"; readonly entry: WorkspaceProjectionOutboxEntry }
  | {
      readonly type: "re-project";
      readonly kind: ProjectionKind;
      readonly reason:
        "startup-missing-projection" | "poll-role-drift" | "revocation-not-projected";
    };

export interface ReconcilePlanInput {
  readonly membershipId: string;
  readonly workspaceId: string;
  readonly grant: MembershipGrantState;
  readonly projected: ProjectedMembershipState | null;
  readonly outbox: readonly WorkspaceProjectionOutboxEntry[];
  readonly now: number;
  readonly confirmDeadlineMs: number;
}

/**
 * The four triggers the memo names, as one pure classifier:
 *
 *  - **unlock / startup compare** — the server confirms the membership but the
 *    local graph has no (Active) WorkspaceMembership node → re-project.
 *  - **F127 poll drift** — the server's role set differs from the WM node's
 *    recorded role → re-project the role (history follows the grant, never
 *    overrules it).
 *  - **outbox deadline** — an unconfirmed outbox entry older than
 *    `confirmDeadlineMs` → retry its confirm.
 *  - **server-initiated** — the server says revoked but the WM node still
 *    reads Active → re-project the revocation. (A server signal is delivered
 *    as this state; the classifier does not need a separate input for it.)
 *
 * Fail-closed: anything ambiguous produces a re-project action rather than
 * silence, and the projection itself is an idempotent upsert.
 */
export function planProjectionReconciliation(
  input: ReconcilePlanInput,
): readonly ReconcileAction[] {
  const actions: ReconcileAction[] = [];

  for (const entry of input.outbox) {
    if (entry.membershipId !== input.membershipId || entry.confirmed) continue;
    if (input.now - Date.parse(entry.createdAt) >= input.confirmDeadlineMs) {
      actions.push({ type: "retry-confirm", entry });
    }
  }

  if (input.grant.status === "confirmed") {
    if (input.projected === null || input.projected.lifecycleStatus !== "Active") {
      actions.push({
        type: "re-project",
        kind: "admission",
        reason: "startup-missing-projection",
      });
    } else if (input.projected.role !== canonicalRoles(input.grant.roles)) {
      actions.push({
        type: "re-project",
        kind: "role-change",
        reason: "poll-role-drift",
      });
    }
  } else if (input.grant.status === "revoked") {
    if (input.projected !== null && input.projected.lifecycleStatus !== "Revoked") {
      actions.push({
        type: "re-project",
        kind: "revocation",
        reason: "revocation-not-projected",
      });
    }
  }

  return actions;
}

import { randomUUID } from "node:crypto";
import {
  assertRegisteredRelationship,
  getProtectionPartitions,
  getSubjectExclusion,
  POLICY_ROLES,
  resolvePolicyCell,
  type AuditEntry,
  type AuditOperation,
  type DataTier,
  type EdgeType,
  type NodeType,
  type PermissionOutcome,
  type PolicyRole,
  type PolicyScope,
} from "@vulto/schema";
import { appendAudit } from "../audit/journal.js";
import {
  incoming,
  outgoing,
  getNode,
  type GraphTx,
  type StoredNode,
} from "../graph/store.js";
import type { RoleDependencies } from "./roles.js";
import { effectiveRoles } from "./roles.js";
import type { MemberPrincipal, Principal } from "./principal.js";
import { resolveReaderSet, resolveSubjectEmployee } from "./reader-set.js";
import { checkWriteAuthority } from "./write-authority.js";

/**
 * The VPS-A004 interceptor — the only place access is decided (A004-T01,
 * A004-T02, A004-T20). It runs in `services/api`, reads the central membership
 * row on every request, and writes an audit entry, in the caller's
 * transaction, for every denial and every grant of Tier 1, 2 or 3 data.
 *
 * `decide*` functions are pure decisions with no side effects (the sync
 * audience materializer will use them); `authorize*` functions decide and
 * audit. A caller commits the transaction it passed, so the audit row and the
 * data release stand or fall together (A003-T59).
 */

export interface InterceptorContext {
  /** UTC ISO-8601 instant for audit timestamps and "active" edge checks. */
  readonly now?: () => string;
  readonly newId?: () => string;
  readonly roleDependencies?: RoleDependencies;
}

const RANK: Readonly<Record<PermissionOutcome, number>> = {
  full: 3,
  read: 2,
  restricted: 1,
  none: 0,
};

/** Thrown for a decision that cannot be audited. Nothing is released without its entry. */
export class NonMemberAuditUnsupportedError extends Error {
  constructor() {
    super(
      "Support and system principals cannot be audited until F206 defines how an audit entry names them",
    );
    this.name = "NonMemberAuditUnsupportedError";
  }
}

// ── Row scope ───────────────────────────────────────────────────────────────

/**
 * Whether a row-qualified grant ("own only", "direct reports"...) holds for a
 * specific row. Every such scope needs the row's Employee and the caller's
 * Employee, and the User-to-Employee link does not exist yet (RST-33), so
 * none can be honored: they resolve to `none`, exactly as the device-side
 * policy table did under F128. This is the one seam that changes when the
 * link lands.
 */
function rowScopeSatisfied(scope: PolicyScope): boolean {
  return scope === "any";
}

// ── Targets and decisions ───────────────────────────────────────────────────

export interface NodeReadTarget {
  readonly workspaceId: string;
  readonly nodeType: NodeType;
  readonly nodeId: string | null;
  /** Defaults to the node's Tier 0 partition (or its first). */
  readonly partitionKey?: string;
}

export type ReadDecision =
  | {
      readonly access: "full" | "read";
      readonly role: PolicyRole;
      readonly tier: DataTier;
      readonly partitionKey: string;
    }
  | {
      readonly access: "restricted";
      readonly label: string;
      readonly tier: DataTier;
      readonly partitionKey: string;
    }
  | { readonly access: "none"; readonly tier: DataTier; readonly partitionKey: string };

/** The partition a stored `graph_nodes` row represents: its Tier 0 half, else its first. */
export function rowPartitionKey(nodeType: NodeType): string {
  const partitions = getProtectionPartitions(nodeType);
  return (partitions.find((p) => p.tier === 0) ?? partitions[0])?.key ?? "record";
}

function partitionTier(nodeType: NodeType, partitionKey: string): DataTier {
  const partition = getProtectionPartitions(nodeType).find(
    (p) => p.key === partitionKey,
  );
  // Inherited protection has no concrete tier without its source, so it is
  // labeled at the most protected tier rather than the least (A002-T10).
  return partition?.tier ?? 3;
}

function requireMember(principal: Principal): MemberPrincipal {
  if (principal.kind !== "member") throw new NonMemberAuditUnsupportedError();
  return principal;
}

function bestCell(
  roles: readonly PolicyRole[],
  nodeType: NodeType,
  partitionKey: string,
): { outcome: PermissionOutcome; role: PolicyRole | null; label?: string } {
  let best: { outcome: PermissionOutcome; role: PolicyRole | null; label?: string } = {
    outcome: "none",
    role: null,
  };
  for (const role of roles) {
    const cell = resolvePolicyCell(role, nodeType, partitionKey);
    const outcome = rowScopeSatisfied(cell.scope) ? cell.outcome : "none";
    if (RANK[outcome] > RANK[best.outcome]) {
      best = {
        outcome,
        role,
        ...(cell.restrictedLabel === undefined ? {} : { label: cell.restrictedLabel }),
      };
    }
  }
  return best;
}

/** A read decision with no side effects. */
export async function decideRead(
  tx: GraphTx,
  principal: Principal,
  target: NodeReadTarget,
  context: InterceptorContext = {},
): Promise<ReadDecision> {
  const partitionKey = target.partitionKey ?? rowPartitionKey(target.nodeType);
  const tier = partitionTier(target.nodeType, partitionKey);
  // Support and system principals have no node-level read grants: their
  // policy rows are not defined yet (F206), so they resolve to `none`.
  if (principal.kind !== "member" || principal.workspaceId !== target.workspaceId) {
    return { access: "none", tier, partitionKey };
  }
  const roles = await effectiveRoles(tx, principal, context.roleDependencies);
  const best = bestCell(roles, target.nodeType, partitionKey);
  if (best.outcome === "full" || best.outcome === "read") {
    return { access: best.outcome, role: best.role!, tier, partitionKey };
  }
  if (best.outcome === "restricted") {
    return {
      access: "restricted",
      label: best.label ?? "Restricted",
      tier,
      partitionKey,
    };
  }
  return { access: "none", tier, partitionKey };
}

// ── Auditing ────────────────────────────────────────────────────────────────

function canonicalRoles(roles: readonly PolicyRole[]): PolicyRole[] {
  const held = new Set(roles);
  return POLICY_ROLES.filter((role) => held.has(role));
}

async function audit(
  tx: GraphTx,
  principal: MemberPrincipal,
  roles: readonly PolicyRole[],
  entry: {
    readonly eventType: "PermissionDenied" | "SensitiveAccessGranted";
    readonly operation: AuditOperation;
    readonly actorRole: PolicyRole | null;
    readonly target: AuditEntry["target"];
    readonly denialClass?: "InsufficientPermission" | "UnresolvedProtection";
  },
  context: InterceptorContext,
): Promise<void> {
  const held = canonicalRoles(roles);
  await appendAudit(tx, {
    audit_entry_id: (context.newId ?? randomUUID)(),
    schema_version: 1,
    workspace_id: principal.workspaceId,
    event_type: entry.eventType,
    operation: entry.operation,
    outcome: entry.eventType === "PermissionDenied" ? "Denied" : "Granted",
    actor_user_id: principal.userId,
    actor_membership_id: principal.membershipId,
    actor_role: entry.actorRole,
    actor_roles: held.length > 0 ? held : ["team-member"],
    actor_application: "VultoRoster",
    target: entry.target,
    metadata: {
      ...(entry.denialClass === undefined ? {} : { denial_class: entry.denialClass }),
      result_cardinality: "Single",
    },
    occurred_at: (context.now ?? (() => new Date().toISOString()))(),
  });
}

function nodeTarget(
  target: NodeReadTarget,
  partitionKey: string,
  tier: DataTier,
): AuditEntry["target"] {
  return {
    kind: "NodeTarget",
    node_type: target.nodeType,
    node_id: target.nodeId,
    partition_key: partitionKey,
    target_tier: tier,
  };
}

/**
 * Decides a node read and audits it: a denial (`none` or `restricted`) writes a
 * `PermissionDenied` entry, and a grant of Tier 1, 2 or 3 writes a
 * `SensitiveAccessGranted` entry, both in `tx`.
 */
export async function authorizeRead(
  tx: GraphTx,
  principal: Principal,
  target: NodeReadTarget,
  context: InterceptorContext = {},
  operation: AuditOperation = "NodeRead",
): Promise<ReadDecision> {
  const member = requireMember(principal);
  const decision = await decideRead(tx, principal, target, context);
  const roles = await effectiveRoles(tx, member, context.roleDependencies);
  const auditTarget = nodeTarget(target, decision.partitionKey, decision.tier);
  if (decision.access === "none" || decision.access === "restricted") {
    await audit(
      tx,
      member,
      roles,
      {
        eventType: "PermissionDenied",
        operation,
        actorRole: null,
        target: auditTarget,
        denialClass:
          getProtectionPartitions(target.nodeType).length === 0
            ? "UnresolvedProtection"
            : "InsufficientPermission",
      },
      context,
    );
  } else if (decision.tier > 0) {
    await audit(
      tx,
      member,
      roles,
      {
        eventType: "SensitiveAccessGranted",
        operation,
        actorRole: decision.role,
        target: auditTarget,
      },
      context,
    );
  }
  return decision;
}

// ── Filtering ───────────────────────────────────────────────────────────────

const UNIVERSAL_KEYS = [
  "node_id",
  "node_type",
  "schema_version",
  "lifecycle_status",
  "workspace_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "is_soft_deleted",
  "soft_deleted_at",
  "soft_deleted_by",
] as const;

export interface RestrictedNode {
  readonly restricted: true;
  readonly label: string;
  readonly workspaceId: string;
  readonly nodeType: string;
  readonly nodeId: string;
  /** Universal fields only (A004-T19): drawn from the schema, never from content. */
  readonly record: Record<string, unknown>;
}

export type ReadableRow = StoredNode | RestrictedNode;

function placeholder(row: StoredNode, label: string): RestrictedNode {
  const record: Record<string, unknown> = {};
  for (const key of UNIVERSAL_KEYS)
    if (key in row.record) record[key] = row.record[key];
  return {
    restricted: true,
    label,
    workspaceId: row.workspaceId,
    nodeType: row.nodeType,
    nodeId: row.nodeId,
    record,
  };
}

/**
 * Filters stored rows to what the principal may read. A row with no grant is
 * dropped as though it did not exist; a `Restricted` row keeps its identity
 * and universal fields with the reason (A004-T18/T19). Each denial and each
 * protected grant is audited once, per row.
 */
export async function filterReadable(
  tx: GraphTx,
  principal: Principal,
  rows: readonly StoredNode[],
  context: InterceptorContext = {},
  operation: AuditOperation = "NodeList",
): Promise<ReadableRow[]> {
  const out: ReadableRow[] = [];
  for (const row of rows) {
    const decision = await authorizeRead(
      tx,
      principal,
      {
        workspaceId: row.workspaceId,
        nodeType: row.nodeType as NodeType,
        nodeId: row.nodeId,
      },
      context,
      operation,
    );
    if (decision.access === "full" || decision.access === "read") out.push(row);
    else if (decision.access === "restricted")
      out.push(placeholder(row, decision.label));
  }
  return out;
}

// ── Traversal ───────────────────────────────────────────────────────────────

export interface TraversalRequest {
  readonly workspaceId: string;
  readonly startNodeId: string;
  readonly edgeTypes: readonly EdgeType[];
  readonly direction: "outgoing" | "incoming";
  readonly maxDepth: number;
  readonly maxResults?: number;
}

export interface TraversalHit {
  readonly row: ReadableRow;
  readonly depth: number;
  readonly viaEdgeId: string;
}

/**
 * VPS-A004 graph traversal rules. A hop is permitted only where Read holds on
 * both nodes. A neighbor with no Read is dropped and never expanded, so a
 * boundary at hop 2 exposes nothing at hop 3 (rule 4). A `Restricted` neighbor
 * is shown as a placeholder but not expanded: Restricted is not Read.
 *
 * The edge-type leg of rule 1 is not enforced: neither A004 nor A002 assigns
 * an edge type a class, so it adds nothing beyond the two endpoint checks.
 */
export async function authorizeTraversal(
  tx: GraphTx,
  principal: Principal,
  request: TraversalRequest,
  context: InterceptorContext = {},
): Promise<{ hits: TraversalHit[]; truncated: boolean }> {
  requireMember(principal);
  const operation: AuditOperation =
    request.maxDepth > 1 ? "RecursiveTraversal" : "EdgeTraversal";
  const maxResults = request.maxResults ?? 200;
  const start = await getNode(tx, request.workspaceId, request.startNodeId);
  if (!start || start.isSoftDeleted) return { hits: [], truncated: false };
  const startDecision = await authorizeRead(
    tx,
    principal,
    {
      workspaceId: start.workspaceId,
      nodeType: start.nodeType as NodeType,
      nodeId: start.nodeId,
    },
    context,
    operation,
  );
  if (startDecision.access !== "full" && startDecision.access !== "read") {
    return { hits: [], truncated: false };
  }

  const visited = new Set([start.nodeId]);
  let frontier = [start.nodeId];
  const hits: TraversalHit[] = [];
  for (let depth = 1; depth <= request.maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const fromId of frontier) {
      for (const edgeType of request.edgeTypes) {
        const edges =
          request.direction === "outgoing"
            ? await outgoing(tx, request.workspaceId, fromId, edgeType, context.now?.())
            : await incoming(
                tx,
                request.workspaceId,
                fromId,
                edgeType,
                context.now?.(),
              );
        for (const edge of edges) {
          const neighborId =
            request.direction === "outgoing" ? edge.toNodeId : edge.fromNodeId;
          if (visited.has(neighborId)) continue;
          const neighbor = await getNode(tx, request.workspaceId, neighborId);
          if (!neighbor || neighbor.isSoftDeleted) continue;
          visited.add(neighborId);
          const decision = await authorizeRead(
            tx,
            principal,
            {
              workspaceId: neighbor.workspaceId,
              nodeType: neighbor.nodeType as NodeType,
              nodeId: neighbor.nodeId,
            },
            context,
            operation,
          );
          if (decision.access === "none") continue;
          if (decision.access === "restricted") {
            hits.push({
              row: placeholder(neighbor, decision.label),
              depth,
              viaEdgeId: edge.edgeId,
            });
          } else {
            hits.push({ row: neighbor, depth, viaEdgeId: edge.edgeId });
            next.push(neighborId);
          }
          if (hits.length >= maxResults) return { hits, truncated: true };
        }
      }
    }
    frontier = next;
  }
  return { hits, truncated: false };
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type WriteTarget =
  | {
      readonly kind: "node";
      readonly workspaceId: string;
      readonly nodeType: NodeType;
      readonly nodeId: string | null;
      readonly partitionKey?: string;
    }
  | {
      readonly kind: "edge";
      readonly workspaceId: string;
      readonly edgeType: EdgeType;
      readonly fromNodeType: NodeType;
      readonly toNodeType: NodeType;
      readonly edgeId: string | null;
    };

export interface WriteChange {
  readonly operation: "create" | "update" | "remove";
  /** The suite application issuing the write. Defaults to Roster. */
  readonly application?: string;
  /** The Employee a subject-excluding record concerns, when the caller knows it. */
  readonly subjectEmployeeId?: string | null;
}

export type WriteRefusalReason =
  | "audit-entry-reserved"
  | "reserved-projection"
  | "unregistered-relationship"
  | "role"
  | "write-authority"
  | "reader-set-unresolvable"
  | "empty-reader-set";

export type WriteDecision =
  | { readonly allowed: true; readonly role: PolicyRole | null }
  | { readonly allowed: false; readonly reason: WriteRefusalReason };

const NODE_OPERATIONS: Record<WriteChange["operation"], AuditOperation> = {
  create: "NodeCreate",
  update: "NodeUpdate",
  remove: "NodeRemoveAttempt",
};
const EDGE_OPERATIONS: Record<WriteChange["operation"], AuditOperation> = {
  create: "EdgeCreate",
  update: "EdgeUpdate",
  remove: "EdgeRemoveAttempt",
};

/** Written only by the membership projection, never by a generic write (F132/FDN-85). */
const RESERVED_PROJECTION_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  "Workspace",
  "WorkspaceMembership",
  "User",
]);
const RESERVED_PROJECTION_EDGE_TYPES: ReadonlySet<string> = new Set([
  "membership_of",
  "membership_in",
]);

/** Gate 1 for an edge: Full on both endpoint node types, through each governing partition. */
function edgeRoleDecision(
  roles: readonly PolicyRole[],
  target: Extract<WriteTarget, { kind: "edge" }>,
): "role" | "unregistered-relationship" | null {
  let registration;
  try {
    registration = assertRegisteredRelationship(
      target.edgeType,
      target.fromNodeType,
      target.toNodeType,
    );
  } catch {
    return "unregistered-relationship";
  }
  for (const nodeType of [target.fromNodeType, target.toNodeType]) {
    const partitions = getProtectionPartitions(nodeType);
    let partitionKey: string;
    if (partitions.length === 1) {
      partitionKey = partitions[0]!.key;
    } else if (partitions.length > 1) {
      const declared = registration.governingPartitions[nodeType];
      if (declared === undefined || !partitions.some(({ key }) => key === declared)) {
        return "role";
      }
      partitionKey = declared;
    } else {
      return "role";
    }
    if (bestCell(roles, nodeType, partitionKey).outcome !== "full") return "role";
  }
  return null;
}

/**
 * The three write gates, in order (A004-T17): role permission, write authority,
 * and a non-empty reader set for a protected record. A denial, and a grant of
 * a Tier 1, 2 or 3 write, is audited in `tx`. `AuditEntry` is reserved from
 * every generic write path (F198): `appendAudit` is its only writer.
 */
export async function authorizeWrite(
  tx: GraphTx,
  principal: Principal,
  target: WriteTarget,
  change: WriteChange,
  context: InterceptorContext = {},
): Promise<WriteDecision> {
  const member = requireMember(principal);
  const roles = await effectiveRoles(tx, member, context.roleDependencies);
  const operation =
    target.kind === "node"
      ? NODE_OPERATIONS[change.operation]
      : EDGE_OPERATIONS[change.operation];

  const auditTargetFor = (
    tier: DataTier,
    partitionKey: string,
  ): AuditEntry["target"] =>
    target.kind === "node"
      ? {
          kind: "NodeTarget",
          node_type: target.nodeType,
          node_id: target.nodeId,
          partition_key: partitionKey,
          target_tier: tier,
        }
      : {
          kind: "EdgeTarget",
          edge_type: target.edgeType,
          edge_id: target.edgeId,
          from_node_type: target.fromNodeType,
          to_node_type: target.toNodeType,
          target_tier: tier,
        };

  const partitionKey =
    target.kind === "node"
      ? (target.partitionKey ?? rowPartitionKey(target.nodeType))
      : "record";
  const tier: DataTier =
    target.kind === "node" ? partitionTier(target.nodeType, partitionKey) : 0;

  const refuse = async (
    reason: WriteRefusalReason,
    denialClass:
      "InsufficientPermission" | "UnresolvedProtection" = "InsufficientPermission",
  ): Promise<WriteDecision> => {
    await audit(
      tx,
      member,
      roles,
      {
        eventType: "PermissionDenied",
        operation,
        actorRole: null,
        target: auditTargetFor(tier, partitionKey),
        denialClass,
      },
      context,
    );
    return { allowed: false, reason };
  };

  if (principal.workspaceId !== target.workspaceId) return refuse("role");

  // Reservations come first: they are not a matter of role.
  if (target.kind === "node") {
    if (target.nodeType === "AuditEntry") return refuse("audit-entry-reserved");
    if (RESERVED_PROJECTION_NODE_TYPES.has(target.nodeType))
      return refuse("reserved-projection");
  } else if (RESERVED_PROJECTION_EDGE_TYPES.has(target.edgeType)) {
    return refuse("reserved-projection");
  }

  // Gate 1 — role.
  let role: PolicyRole | null = null;
  if (target.kind === "node") {
    const best = bestCell(roles, target.nodeType, partitionKey);
    if (best.outcome !== "full") return refuse("role");
    role = best.role;
  } else {
    const failure = edgeRoleDecision(roles, target);
    if (failure === "unregistered-relationship") return refuse(failure);
    if (failure !== null) return refuse("role");
  }

  // Gate 2 — write authority, only ever narrowing.
  if (target.kind === "node") {
    const authority = await checkWriteAuthority(
      tx,
      target.workspaceId,
      target.nodeType,
      change.application ?? "VultoRoster",
    );
    if (!authority.allowed) return refuse("write-authority");
  }

  // Gate 3 — a protected record must have someone who can read it.
  if (
    target.kind === "node" &&
    change.operation !== "remove" &&
    (tier === 1 || tier === 3 || getSubjectExclusion(target.nodeType) !== undefined)
  ) {
    let subject = change.subjectEmployeeId ?? null;
    if (subject === null && target.nodeId !== null) {
      subject = await resolveSubjectEmployee(
        tx,
        target.workspaceId,
        target.nodeType,
        target.nodeId,
      );
    }
    const readers = await resolveReaderSet(tx, {
      workspaceId: target.workspaceId,
      nodeType: target.nodeType,
      partitionKey,
      subjectEmployeeId: subject,
    });
    if (readers.kind === "unresolvable") {
      return refuse("reader-set-unresolvable", "UnresolvedProtection");
    }
    if (readers.userIds.length === 0)
      return refuse("empty-reader-set", "UnresolvedProtection");
  }

  if (tier > 0) {
    await audit(
      tx,
      member,
      roles,
      {
        eventType: "SensitiveAccessGranted",
        operation,
        actorRole: role,
        target: auditTargetFor(tier, partitionKey),
      },
      context,
    );
  }
  return { allowed: true, role };
}

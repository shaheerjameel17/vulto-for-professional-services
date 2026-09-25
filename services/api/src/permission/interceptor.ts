import { randomUUID } from "node:crypto";
import {
  assertRegisteredRelationship,
  getProtectionPartitions,
  getSubjectExclusion,
  isSystemOperationPermitted,
  SYSTEM_OPERATION_TARGETS,
  SYSTEM_EDGE_OPERATION_TARGETS,
  PARTICIPANT_GRANTS,
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
  type SystemOperation,
} from "@vulto/schema";
import { appendAudit } from "../audit/journal.js";
import {
  incoming,
  outgoing,
  getNode,
  type GraphTx,
  type StoredNode,
} from "../graph/store.js";
import { resolveEmployeeForUser } from "./employee-link.js";
import type { RoleDependencies } from "./roles.js";
import { effectiveRoles } from "./roles.js";
import type { Principal, SupportPrincipal } from "./principal.js";
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
  /** The named system operation requested by a server-owned caller. */
  readonly systemOperation?: SystemOperation;
}

const RANK: Readonly<Record<PermissionOutcome, number>> = {
  full: 3,
  read: 2,
  restricted: 1,
  none: 0,
};

// ── Row scope ───────────────────────────────────────────────────────────────

/** What a row-qualified grant is judged against: the row, and who is asking. */
interface RowScopeContext {
  readonly tx: GraphTx;
  readonly principal: Principal;
  readonly nodeType: NodeType;
  readonly nodeId: string | null;
  readonly context: InterceptorContext;
  /** Only a pre-write create may use the mutation's declared subject. */
  readonly creating?: boolean;
  readonly declaredSubjectEmployeeId?: string | null;
}

/** The stored-row subject path shared by reads, updates, and post-create verification. */
export async function resolveStoredSubjectEmployeeId(
  tx: GraphTx,
  workspaceId: string,
  nodeType: NodeType,
  nodeId: string,
  asOf: string,
): Promise<string | null> {
  if (nodeType === "Employee") return nodeId;
  if (nodeType === "BurnoutAlert" || nodeType === "TimesheetAnomalyFlag") {
    const [subject] = await outgoing(tx, workspaceId, nodeId, "triggered_by", asOf);
    return subject?.toNodeId ?? null;
  }
  if (
    nodeType === "TimesheetEntry" ||
    nodeType === "TimesheetWeekSubmission" ||
    nodeType === "UtilizationSnapshot"
  ) {
    const node = await getNode(tx, workspaceId, nodeId);
    const employeeId = node?.record["employee_id"];
    return typeof employeeId === "string" ? employeeId : null;
  }
  return null;
}

/**
 * Whether a row-qualified grant ("own only", "direct reports"...) holds for a
 * specific row. It needs the row's Employee and the caller's Employee, which
 * the User-to-Employee link (RST-33) now provides, so the scopes that can be
 * decided from that link are honored for an Employee row:
 *
 *  - `own`: the row is the caller's own Employee.
 *  - `direct-reports`: the caller is the row's active manager.
 *  - `own-plus-team`: `own`, or the row shares the caller's active manager.
 *
 * BurnoutAlert and TimesheetAnomalyFlag resolve through their registered
 * `triggered_by` paths. Tier 0 TimesheetEntry resolves through its own stored
 * employee_id. Other node types still resolve conservatively until their
 * owning feature supplies a registered subject path.
 */
async function rowScopeSatisfied(
  scope: PolicyScope,
  row?: RowScopeContext,
): Promise<boolean> {
  if (scope === "any") return true;
  if (row === undefined || row.principal.kind !== "member" || row.nodeId === null) {
    return false;
  }
  const { tx, principal, nodeId, context } = row;
  const resolve =
    context.roleDependencies?.resolveEmployeeForUser ?? resolveEmployeeForUser;
  const me = await resolve(tx, principal.workspaceId, principal.userId);
  if (me === null) return false;
  const asOf = (context.now ?? nowIso)();
  const subjectEmployeeId =
    row.creating === true &&
    (row.nodeType === "TimesheetEntry" || row.nodeType === "TimesheetWeekSubmission")
      ? (row.declaredSubjectEmployeeId ?? null)
      : await resolveStoredSubjectEmployeeId(
          tx,
          principal.workspaceId,
          row.nodeType,
          nodeId,
          asOf,
        );
  if (subjectEmployeeId === null) return false;
  if (scope === "own") return me === subjectEmployeeId;
  const managerOf = async (employeeId: string) =>
    (await outgoing(tx, principal.workspaceId, employeeId, "managed_by", asOf))[0]
      ?.toNodeId ?? null;
  if (scope === "direct-reports") return (await managerOf(subjectEmployeeId)) === me;
  if (scope === "own-plus-team") {
    if (me === subjectEmployeeId) return true;
    const theirs = await managerOf(subjectEmployeeId);
    return theirs !== null && theirs === (await managerOf(me));
  }
  return false;
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
      readonly role: PolicyRole | null;
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

/** A support scope never reaches a type with a Tier 3 partition, whatever it lists. */
function hasTier3(nodeType: NodeType): boolean {
  return getProtectionPartitions(nodeType).some((p) => p.tier === 3);
}

/** Written only by the membership projection or `appendAudit`; a support principal may never write them. */
const SUPPORT_NEVER_WRITES: ReadonlySet<NodeType> = new Set<NodeType>([
  "Workspace",
  "WorkspaceMembership",
  "User",
  "AuditEntry",
]);

function supportExpired(
  principal: SupportPrincipal,
  context: InterceptorContext,
): boolean {
  return Date.parse(principal.expiresAt) <= Date.parse((context.now ?? nowIso)());
}

const nowIso = () => new Date().toISOString();

/** A004-T25: node grants are exclusively the operation's closed target list. */
function systemNodeTargetPermitted(
  principal: Extract<Principal, { kind: "system" }>,
  operation: SystemOperation | undefined,
  nodeType: NodeType,
  partitionKey: string,
): boolean {
  return (
    operation !== undefined &&
    isSystemOperationPermitted(principal.name, operation) &&
    (SYSTEM_OPERATION_TARGETS[operation]?.some(
      (target) => target.nodeType === nodeType && target.partitionKey === partitionKey,
    ) ??
      false)
  );
}

/** The roles a decision is made under, and whether the principal is capped at read. */
async function decisionRoles(
  tx: GraphTx,
  principal: Principal,
  nodeType: NodeType,
  operation: "read" | "write",
  context: InterceptorContext,
): Promise<{ roles: PolicyRole[]; readOnly: boolean }> {
  if (principal.kind === "member") {
    return {
      roles: await effectiveRoles(tx, principal, context.roleDependencies),
      readOnly: false,
    };
  }
  if (principal.kind === "support") {
    const inScope = principal.scope.node_types.includes(nodeType);
    const allowed =
      inScope &&
      !hasTier3(nodeType) &&
      !supportExpired(principal, context) &&
      (operation === "read" || principal.scope.access === "read-write") &&
      (operation === "read" || !SUPPORT_NEVER_WRITES.has(nodeType));
    // Owner is the ceiling, and the scope only narrows it.
    return {
      roles: allowed ? ["owner"] : [],
      readOnly: principal.scope.access === "read",
    };
  }
  // A system principal holds no node grant; its policy rows list operations.
  return { roles: [], readOnly: true };
}

async function bestCell(
  roles: readonly PolicyRole[],
  nodeType: NodeType,
  partitionKey: string,
  row?: RowScopeContext,
  operation: "read" | "write" = "write",
): Promise<{ outcome: PermissionOutcome; role: PolicyRole | null; label?: string }> {
  let best: { outcome: PermissionOutcome; role: PolicyRole | null; label?: string } = {
    outcome: "none",
    role: null,
  };
  for (const role of roles) {
    const cell = resolvePolicyCell(role, nodeType, partitionKey);
    const withinScope = await rowScopeSatisfied(cell.scope, row);
    const outcome = withinScope
      ? cell.outcome
      : operation === "read" &&
          (cell.outcome === "full" || cell.outcome === "read") &&
          cell.readScope !== undefined &&
          (await rowScopeSatisfied(cell.readScope, row))
        ? "read"
        : "none";
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
  if (principal.workspaceId !== target.workspaceId) {
    return { access: "none", tier, partitionKey };
  }
  if (principal.kind === "system") {
    return systemNodeTargetPermitted(
      principal,
      context.systemOperation,
      target.nodeType,
      partitionKey,
    )
      ? { access: "read", role: null, tier, partitionKey }
      : { access: "none", tier, partitionKey };
  }
  const { roles, readOnly } = await decisionRoles(
    tx,
    principal,
    target.nodeType,
    "read",
    context,
  );
  const best = await bestCell(
    roles,
    target.nodeType,
    partitionKey,
    {
      tx,
      principal,
      nodeType: target.nodeType,
      nodeId: target.nodeId,
      context,
    },
    "read",
  );
  if (readOnly && best.outcome === "full") best.outcome = "read";
  // Subject exclusion (A004-T16): the person a record concerns is removed from
  // its readers, whatever role would otherwise grant it. The same decision feeds
  // `protected.read` and the materialized audience. A reader with no Employee
  // record is not any Employee's login and so cannot be the subject.
  if (
    (best.outcome === "full" || best.outcome === "read") &&
    principal.kind === "member" &&
    target.nodeId !== null &&
    getSubjectExclusion(target.nodeType) !== undefined
  ) {
    const subject = await resolveSubjectEmployee(
      tx,
      principal.workspaceId,
      target.nodeType,
      target.nodeId,
    );
    if (subject !== null) {
      const resolve =
        context.roleDependencies?.resolveEmployeeForUser ?? resolveEmployeeForUser;
      const me = await resolve(tx, principal.workspaceId, principal.userId);
      if (me !== null && me === subject) {
        return {
          access: "restricted",
          label: "Restricted — this record concerns you.",
          tier,
          partitionKey,
        };
      }
    }
  }
  if (best.outcome === "full" || best.outcome === "read") {
    return { access: best.outcome, role: best.role, tier, partitionKey };
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

function actorFields(principal: Principal, roles: readonly PolicyRole[]) {
  if (principal.kind === "member") {
    const held = canonicalRoles(roles);
    return {
      actor_kind: "member" as const,
      actor_user_id: principal.userId,
      actor_membership_id: principal.membershipId,
      actor_roles: held.length > 0 ? held : ["team-member" as const],
    };
  }
  if (principal.kind === "support") {
    return {
      actor_kind: "support" as const,
      actor_grant_id: principal.grantId,
      actor_roles: [] as PolicyRole[],
    };
  }
  return {
    actor_kind: "system" as const,
    actor_system_name: principal.name,
    actor_roles: [] as PolicyRole[],
  };
}

/** A member's held roles, for the audit entry; a support or system principal holds none. */
async function auditRoles(
  tx: GraphTx,
  principal: Principal,
  context: InterceptorContext,
): Promise<PolicyRole[]> {
  return principal.kind === "member"
    ? effectiveRoles(tx, principal, context.roleDependencies)
    : [];
}

async function audit(
  tx: GraphTx,
  principal: Principal,
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
  await appendAudit(tx, {
    audit_entry_id: (context.newId ?? randomUUID)(),
    schema_version: 1,
    workspace_id: principal.workspaceId,
    event_type: entry.eventType,
    operation: entry.operation,
    outcome: entry.eventType === "PermissionDenied" ? "Denied" : "Granted",
    ...actorFields(principal, roles),
    actor_role: principal.kind === "member" ? entry.actorRole : null,
    actor_application: "VultoRoster",
    target: entry.target,
    metadata: {
      ...(entry.denialClass === undefined ? {} : { denial_class: entry.denialClass }),
      result_cardinality: "Single",
    },
    occurred_at: (context.now ?? nowIso)(),
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
  const decision = await decideRead(tx, principal, target, context);
  const roles = await auditRoles(tx, principal, context);
  const auditTarget = nodeTarget(target, decision.partitionKey, decision.tier);
  if (decision.access === "none" || decision.access === "restricted") {
    await audit(
      tx,
      principal,
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
      principal,
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
      readonly fromNodeId?: string | null;
      readonly toNodeId?: string | null;
    };

export interface WriteChange {
  readonly operation: "create" | "update" | "remove";
  /** The suite application issuing the write. Defaults to Roster. */
  readonly application?: string;
  /** The Employee a subject-excluding record concerns, when the caller knows it. */
  readonly subjectEmployeeId?: string | null;
  /** F274: validated plan-builder subject for a new self-service row (Gate 1). */
  readonly declaredSubjectEmployeeId?: string | null;
}

export type WriteRefusalReason =
  | "audit-entry-reserved"
  | "reserved-projection"
  | "unregistered-relationship"
  | "role"
  | "support-scope"
  | "support-forbidden"
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

/** Resolve a declared participant grant through the caller's own active edge. */
async function participantGrantSatisfied(
  tx: GraphTx,
  principal: Principal,
  nodeType: NodeType,
  nodeId: string,
  asOf: string,
  context: InterceptorContext,
): Promise<boolean> {
  if (principal.kind !== "member") return false;
  const grant = PARTICIPANT_GRANTS[nodeType];
  if (grant === undefined || grant.fromNodeType !== "Employee") return false;
  const resolve =
    context.roleDependencies?.resolveEmployeeForUser ?? resolveEmployeeForUser;
  const employeeId = await resolve(tx, principal.workspaceId, principal.userId);
  if (employeeId === null) return false;
  const active = await outgoing(
    tx,
    principal.workspaceId,
    employeeId,
    grant.viaEdgeType,
    asOf,
  );
  return active.some((edge) => edge.toNodeId === nodeId);
}

/** Gate 1 for an edge: role-based or declared participant endpoint authority. */
async function edgeRoleDecision(
  tx: GraphTx,
  principal: Principal,
  roles: readonly PolicyRole[],
  target: Extract<WriteTarget, { kind: "edge" }>,
  change: WriteChange,
  context: InterceptorContext,
): Promise<"role" | "unregistered-relationship" | null> {
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
  for (const [nodeType, nodeId] of [
    [target.fromNodeType, target.fromNodeId],
    [target.toNodeType, target.toNodeId],
  ] as const) {
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
    const row: RowScopeContext | undefined =
      nodeId === undefined || nodeId === null
        ? undefined
        : {
            tx,
            principal,
            nodeType,
            nodeId,
            context,
            creating: change.operation === "create",
            declaredSubjectEmployeeId: change.declaredSubjectEmployeeId,
          };
    const outcome = (await bestCell(roles, nodeType, partitionKey, row)).outcome;
    const roleSufficient =
      outcome === "full" ||
      (outcome === "read" && registration.readSufficientEndpoints[nodeType] === true);
    const sufficient =
      roleSufficient ||
      (nodeId != null &&
        (await participantGrantSatisfied(
          tx,
          principal,
          nodeType,
          nodeId,
          (context.now ?? nowIso)(),
          context,
        )));
    if (!sufficient) return "role";
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
  const roles = await auditRoles(tx, principal, context);
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
      principal,
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

  // Reservations come first: they are not a matter of role. A support
  // principal is refused for the same types below, under its own reason.
  if (principal.kind === "support") {
    // handled by the support restrictions
  } else if (target.kind === "node") {
    if (target.nodeType === "AuditEntry") return refuse("audit-entry-reserved");
    if (RESERVED_PROJECTION_NODE_TYPES.has(target.nodeType))
      return refuse("reserved-projection");
  } else if (RESERVED_PROJECTION_EDGE_TYPES.has(target.edgeType)) {
    return refuse("reserved-projection");
  }

  // A support principal is checked against its scope before any policy row.
  if (principal.kind === "support") {
    const endpoints =
      target.kind === "node"
        ? [target.nodeType]
        : [target.fromNodeType, target.toNodeType];
    if (endpoints.some((t) => SUPPORT_NEVER_WRITES.has(t)))
      return refuse("support-forbidden");
    if (
      supportExpired(principal, context) ||
      principal.scope.access !== "read-write" ||
      endpoints.some((t) => !principal.scope.node_types.includes(t) || hasTier3(t))
    ) {
      return refuse("support-scope");
    }
  }

  // Gate 1 — system principals have only named operations, never roles.
  let role: PolicyRole | null = null;
  if (principal.kind === "system") {
    const permitted =
      target.kind === "node"
        ? systemNodeTargetPermitted(
            principal,
            context.systemOperation,
            target.nodeType,
            partitionKey,
          )
        : Object.entries(SYSTEM_EDGE_OPERATION_TARGETS).some(
            ([operation, shapes]) =>
              isSystemOperationPermitted(
                principal.name,
                operation as SystemOperation,
              ) &&
              (!context.systemOperation || context.systemOperation === operation) &&
              shapes?.some(
                (shape) =>
                  shape.edgeType === target.edgeType &&
                  shape.fromNodeType === target.fromNodeType &&
                  shape.toNodeType === target.toNodeType,
              ),
          );
    if (!permitted) return refuse("role");
  } else {
    const gateRoles: readonly PolicyRole[] =
      principal.kind === "member"
        ? await effectiveRoles(tx, principal, context.roleDependencies)
        : ["owner"];
    if (target.kind === "node") {
      const best = await bestCell(gateRoles, target.nodeType, partitionKey, {
        tx,
        principal,
        nodeType: target.nodeType,
        nodeId: target.nodeId,
        context,
        creating: change.operation === "create",
        declaredSubjectEmployeeId: change.declaredSubjectEmployeeId,
      });
      if (best.outcome !== "full") return refuse("role");
      role = best.role;
    } else {
      const failure = await edgeRoleDecision(
        tx,
        principal,
        gateRoles,
        target,
        change,
        context,
      );
      if (failure === "unregistered-relationship") return refuse(failure);
      if (failure !== null) return refuse("role");
    }
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
      principal,
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

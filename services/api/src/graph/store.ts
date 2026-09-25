import {
  assertRegisteredRelationship,
  edgeRecordSchema,
  getNodeRegistration,
  getProtectionPartitions,
  nodeRecordSchema,
  resolveRegisteredProtectionTier,
  type EdgeRecord,
  type EdgeRegistration,
  type EdgeType,
  type NodeRecord,
  type NodeType,
} from "@vulto/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { graphEdges, graphNodes } from "./schema.js";
import type { GraphTx } from "./tx.js";

/**
 * The canonical graph store (VPS-A003 "The canonical store", Stage 2).
 *
 * INTERNAL — not an API. `pnpm arch:check` restricts who may import this file
 * to the graph, permission, mutations, protected, audience and jobs folders of
 * `services/api/src`. It contains no permission logic: Stage 3's interceptor
 * sits above it. Every function takes a Drizzle transaction first, and every
 * read and write takes the workspace — there is no workspace-less lookup (F204).
 */

export type { GraphTx };

export class GraphValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphValidationError";
  }
}

export class GraphNotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found in this workspace`);
    this.name = "GraphNotFoundError";
  }
}

export class StaleVersionError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Expected version ${expectedVersion} but the row is at version ${actualVersion}`,
    );
    this.name = "StaleVersionError";
  }
}

// ── Who may write a User row ────────────────────────────────────────────────

const issuedAuthorities = new WeakSet<object>();

/** Proof that the caller is the membership projection. Only it may write `User` rows. */
export interface MembershipProjectionAuthority {
  readonly kind: "membership-projection";
}

/**
 * Referenced only from `graph/membership-projection.ts` — `pnpm arch:check`
 * fails the build if any other file names it.
 */
export function grantMembershipProjectionAuthority(): MembershipProjectionAuthority {
  const authority: MembershipProjectionAuthority = { kind: "membership-projection" };
  issuedAuthorities.add(authority);
  return authority;
}

/**
 * F198: AuditEntry is never a graph node written through the store. Its one
 * writer is `audit/journal.ts::appendAudit`, and the only later change is the
 * actor pseudonymization in `audit/pseudonymizer.ts`.
 */
function refuseAuditEntry(nodeType: string): void {
  if (nodeType === "AuditEntry") {
    throw new GraphValidationError("AuditEntry is written only by appendAudit (F198)");
  }
}

function requireAuthority(authority: MembershipProjectionAuthority | undefined): void {
  if (authority === undefined || !issuedAuthorities.has(authority)) {
    throw new GraphValidationError(
      "A User node is written only by the membership projection",
    );
  }
}

// ── Records and what is stored of them ──────────────────────────────────────

export interface StoredNode {
  readonly workspaceId: string;
  readonly nodeId: string;
  readonly nodeType: string;
  readonly lifecycleStatus: string;
  readonly schemaVersion: number;
  readonly version: number;
  readonly isSoftDeleted: boolean;
  readonly record: Record<string, unknown>;
}

export interface StoredEdge {
  readonly workspaceId: string;
  readonly edgeId: string;
  readonly edgeType: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly version: number;
  readonly isSoftDeleted: boolean;
  readonly record: Record<string, unknown>;
}

export interface Actor {
  readonly userId: string;
  /** Caller-supplied, UTC ISO-8601. The store never reads the clock. */
  readonly at: string;
}

const UNIVERSAL_FIELDS = [
  "node_id",
  "node_type",
  "workspace_id",
  "schema_version",
  "lifecycle_status",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "is_soft_deleted",
  "soft_deleted_at",
  "soft_deleted_by",
] as const;

const IMMUTABLE_PATCH_KEYS = new Set([
  "node_id",
  "node_type",
  "workspace_id",
  "created_at",
  "created_by",
  "is_soft_deleted",
  "soft_deleted_at",
  "soft_deleted_by",
]);

function partitionTiers(nodeType: NodeType): readonly (number | "Inherited")[] {
  const protection = getNodeRegistration(nodeType).protection;
  if (protection.kind === "fixed") return [protection.tier];
  if (protection.kind === "split") return protection.partitions.map((p) => p.tier);
  return ["Inherited"];
}

/**
 * Only the Tier 0 part of a node belongs in `graph_nodes.record`. A type with a
 * Tier 0 partition keeps the record it was given (the caller supplies the Tier 0
 * partition); a type with none — every partition Tier 1, 2 or 3, or inherited,
 * which fails closed — keeps only its universal fields. Content arrives in
 * Stage 5.
 */
function keepsContent(nodeType: NodeType): boolean {
  return partitionTiers(nodeType).some((tier) => tier === 0);
}

/** F289: edge content follows the registered governing endpoint partition. */
function protectsEdgeMetadata(
  registration: EdgeRegistration,
  endpointTypes: readonly NodeType[],
): boolean {
  return endpointTypes.some((nodeType) => {
    const partitions = getProtectionPartitions(nodeType);
    if (partitions.length === 0) return true; // Inherited protection fails closed.
    const partitionKey =
      partitions.length === 1
        ? partitions[0]!.key
        : registration.governingPartitions[nodeType];
    if (!partitionKey || !partitions.some(({ key }) => key === partitionKey))
      return true;
    try {
      return (
        resolveRegisteredProtectionTier({
          nodeType,
          schemaPartition: partitionKey,
        }) !== 0
      );
    } catch {
      return true;
    }
  });
}

function pickUniversal(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of UNIVERSAL_FIELDS) if (key in record) out[key] = record[key];
  return out;
}

function parseNode(value: unknown): NodeRecord {
  const parsed = nodeRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new GraphValidationError(
      `Invalid node record: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

function parseEdge(value: unknown): EdgeRecord {
  const parsed = edgeRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new GraphValidationError(
      `Invalid edge record: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

const asDate = (value: string | null | undefined): Date | null =>
  value === null || value === undefined ? null : new Date(value);
const asIso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

function toStoredNode(row: typeof graphNodes.$inferSelect): StoredNode {
  return {
    workspaceId: row.workspaceId,
    nodeId: row.nodeId,
    nodeType: row.nodeType,
    lifecycleStatus: row.lifecycleStatus,
    schemaVersion: row.schemaVersion,
    version: row.version,
    isSoftDeleted: row.isSoftDeleted,
    record: row.record as Record<string, unknown>,
  };
}

function toStoredEdge(row: typeof graphEdges.$inferSelect): StoredEdge {
  return {
    workspaceId: row.workspaceId,
    edgeId: row.edgeId,
    edgeType: row.edgeType,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    effectiveFrom: asIso(row.effectiveFrom),
    effectiveTo: asIso(row.effectiveTo),
    version: row.version,
    isSoftDeleted: row.isSoftDeleted,
    record: row.record as Record<string, unknown>,
  };
}

function nodeColumns(record: NodeRecord, stored: Record<string, unknown>) {
  const r = record as Record<string, unknown>;
  return {
    nodeType: record.node_type,
    lifecycleStatus: record.lifecycle_status,
    schemaVersion: record.schema_version,
    isSoftDeleted: (r["is_soft_deleted"] as boolean | undefined) ?? false,
    createdAt: asDate(r["created_at"] as string | undefined),
    createdBy: (r["created_by"] as string | undefined) ?? null,
    updatedAt: asDate(r["updated_at"] as string | undefined),
    updatedBy: (r["updated_by"] as string | undefined) ?? null,
    softDeletedAt: asDate(r["soft_deleted_at"] as string | null | undefined),
    softDeletedBy: (r["soft_deleted_by"] as string | null | undefined) ?? null,
    record: stored,
  };
}

// ── Nodes ───────────────────────────────────────────────────────────────────

async function writeNode(
  tx: GraphTx,
  workspaceId: string,
  record: NodeRecord,
): Promise<StoredNode> {
  const nodeType = record.node_type as NodeType;
  const full = record as Record<string, unknown>;
  const stored = keepsContent(nodeType) ? full : pickUniversal(full);
  const columns = nodeColumns(record, stored);
  const [row] = await tx
    .insert(graphNodes)
    .values({
      nodeId: record.node_id,
      workspaceId,
      version: 1,
      ...columns,
    })
    .returning();
  return toStoredNode(row!);
}

/**
 * Inserts a node. A `Workspace` is filed under its own id; every other type
 * reads `workspace_id` from the record. A `User` is refused here — see
 * `insertUserNode`.
 */
export async function insertNode(tx: GraphTx, record: unknown): Promise<StoredNode> {
  const parsed = parseNode(record);
  refuseAuditEntry(parsed.node_type);
  if (parsed.node_type === "User") {
    throw new GraphValidationError(
      "A User node is written only by the membership projection",
    );
  }
  const workspaceId =
    parsed.node_type === "Workspace"
      ? parsed.node_id
      : (parsed as { workspace_id?: string }).workspace_id;
  if (workspaceId === undefined) {
    throw new GraphValidationError(`${parsed.node_type} requires a workspace_id`);
  }
  return writeNode(tx, workspaceId, parsed);
}

/** One `User` row for one workspace, its `record` carrying no `workspace_id`. */
export async function insertUserNode(
  tx: GraphTx,
  workspaceId: string,
  record: unknown,
  authority: MembershipProjectionAuthority,
): Promise<StoredNode> {
  requireAuthority(authority);
  const parsed = parseNode(record);
  if (parsed.node_type !== "User") {
    throw new GraphValidationError("insertUserNode writes User nodes only");
  }
  return writeNode(tx, workspaceId, parsed);
}

async function lockNode(
  tx: GraphTx,
  workspaceId: string,
  nodeId: string,
): Promise<typeof graphNodes.$inferSelect> {
  const [row] = await tx
    .select()
    .from(graphNodes)
    .where(and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.nodeId, nodeId)))
    .for("update");
  if (!row) throw new GraphNotFoundError(`Node ${nodeId}`);
  return row;
}

async function replaceNodeRecord(
  tx: GraphTx,
  row: typeof graphNodes.$inferSelect,
  merged: Record<string, unknown>,
): Promise<StoredNode> {
  const parsed = parseNode(merged);
  const nodeType = parsed.node_type as NodeType;
  const stored = keepsContent(nodeType)
    ? (parsed as Record<string, unknown>)
    : pickUniversal(parsed as Record<string, unknown>);
  const columns = nodeColumns(parsed, stored);
  const [updated] = await tx
    .update(graphNodes)
    .set({
      lifecycleStatus: columns.lifecycleStatus,
      schemaVersion: columns.schemaVersion,
      isSoftDeleted: columns.isSoftDeleted,
      updatedAt: columns.updatedAt,
      updatedBy: columns.updatedBy,
      softDeletedAt: columns.softDeletedAt,
      softDeletedBy: columns.softDeletedBy,
      record: columns.record,
      version: sql`${graphNodes.version} + 1`,
    })
    .where(
      and(
        eq(graphNodes.workspaceId, row.workspaceId),
        eq(graphNodes.nodeId, row.nodeId),
      ),
    )
    .returning();
  return toStoredNode(updated!);
}

/**
 * Merges `patch` into a node and increments `version`. `expectedVersion`, when
 * given, must equal the stored version or `StaleVersionError` is thrown and
 * nothing changes.
 */
export async function updateNodeFields(
  tx: GraphTx,
  workspaceId: string,
  nodeId: string,
  expectedVersion: number | null,
  patch: Record<string, unknown>,
  authority?: MembershipProjectionAuthority,
): Promise<StoredNode> {
  const row = await lockNode(tx, workspaceId, nodeId);
  refuseAuditEntry(row.nodeType);
  if (row.nodeType === "User") requireAuthority(authority);
  if (expectedVersion !== null && row.version !== expectedVersion) {
    throw new StaleVersionError(expectedVersion, row.version);
  }
  for (const key of Object.keys(patch)) {
    if (IMMUTABLE_PATCH_KEYS.has(key)) {
      throw new GraphValidationError(`${key} cannot be changed by a field update`);
    }
  }
  if (!keepsContent(row.nodeType as NodeType)) {
    const extra = Object.keys(patch).filter(
      (key) => !(UNIVERSAL_FIELDS as readonly string[]).includes(key),
    );
    if (extra.length > 0) {
      throw new GraphValidationError(
        `${row.nodeType} has no Tier 0 content; protected fields are written elsewhere (${extra.join(", ")})`,
      );
    }
  }
  return replaceNodeRecord(tx, row, {
    ...(row.record as Record<string, unknown>),
    ...patch,
  });
}

export async function softDeleteNode(
  tx: GraphTx,
  workspaceId: string,
  nodeId: string,
  actor: Actor,
  authority?: MembershipProjectionAuthority,
): Promise<StoredNode> {
  const row = await lockNode(tx, workspaceId, nodeId);
  refuseAuditEntry(row.nodeType);
  if (row.nodeType === "User") requireAuthority(authority);
  const policy = getNodeRegistration(row.nodeType as NodeType).universalFields;
  const deletion =
    policy === "anonymous-contribution"
      ? { is_soft_deleted: true }
      : {
          is_soft_deleted: true,
          soft_deleted_at: actor.at,
          soft_deleted_by: actor.userId,
        };
  return replaceNodeRecord(tx, row, {
    ...(row.record as Record<string, unknown>),
    ...deletion,
  });
}

export async function getNode(
  tx: GraphTx,
  workspaceId: string,
  nodeId: string,
): Promise<StoredNode | null> {
  const [row] = await tx
    .select()
    .from(graphNodes)
    .where(and(eq(graphNodes.workspaceId, workspaceId), eq(graphNodes.nodeId, nodeId)));
  return row ? toStoredNode(row) : null;
}

export interface NodeFilter {
  readonly nodeType?: NodeType;
  readonly lifecycleStatus?: string;
  readonly includeSoftDeleted?: boolean;
}

export async function getNodes(
  tx: GraphTx,
  workspaceId: string,
  filter: NodeFilter = {},
): Promise<StoredNode[]> {
  const conditions = [eq(graphNodes.workspaceId, workspaceId)];
  if (filter.nodeType) conditions.push(eq(graphNodes.nodeType, filter.nodeType));
  if (filter.lifecycleStatus) {
    conditions.push(eq(graphNodes.lifecycleStatus, filter.lifecycleStatus));
  }
  if (!filter.includeSoftDeleted) conditions.push(eq(graphNodes.isSoftDeleted, false));
  const rows = await tx
    .select()
    .from(graphNodes)
    .where(and(...conditions));
  return rows.map(toStoredNode);
}

/**
 * The live node of a type whose Tier 0 record holds `value` in `field`, or
 * `null`. For the identity link (`user_id`) and the workspace-scoped
 * uniqueness rules (`email`, `employee_code`); a field compared here is never a
 * protected one, because the record holds Tier 0 only.
 */
export async function findNodeByRecordField(
  tx: GraphTx,
  workspaceId: string,
  nodeType: NodeType,
  field: string,
  value: string,
  options: { readonly excludeNodeId?: string } = {},
): Promise<StoredNode | null> {
  const conditions = [
    eq(graphNodes.workspaceId, workspaceId),
    eq(graphNodes.nodeType, nodeType),
    eq(graphNodes.isSoftDeleted, false),
    sql`lower(${graphNodes.record}->>${field}) = lower(${value})`,
  ];
  if (options.excludeNodeId !== undefined) {
    conditions.push(sql`${graphNodes.nodeId} <> ${options.excludeNodeId}`);
  }
  const [row] = await tx
    .select()
    .from(graphNodes)
    .where(and(...conditions))
    .limit(1);
  return row ? toStoredNode(row) : null;
}

// ── Edges ───────────────────────────────────────────────────────────────────

/**
 * Inserts an edge after checking that both endpoints exist in this workspace
 * and that the (edge type, from type, to type) triple is registered. Metadata
 * is written only when each endpoint's registered governing partition is Tier 0;
 * a missing declaration or protected partition strips it (F289).
 */
export async function insertEdge(
  tx: GraphTx,
  workspaceId: string,
  record: unknown,
): Promise<StoredEdge> {
  const parsed = parseEdge(record);
  const endpoints = await tx
    .select({ nodeId: graphNodes.nodeId, nodeType: graphNodes.nodeType })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.workspaceId, workspaceId),
        inArray(graphNodes.nodeId, [parsed.from_node_id, parsed.to_node_id]),
      ),
    );
  const from = endpoints.find((e) => e.nodeId === parsed.from_node_id);
  const to = endpoints.find((e) => e.nodeId === parsed.to_node_id);
  if (!from || !to) {
    throw new GraphValidationError(
      "Both endpoints of an edge must exist in the edge's workspace",
    );
  }
  let registration: EdgeRegistration;
  try {
    registration = assertRegisteredRelationship(
      parsed.edge_type as EdgeType,
      from.nodeType as NodeType,
      to.nodeType as NodeType,
    );
  } catch (error) {
    throw new GraphValidationError(
      error instanceof Error ? error.message : "Unregistered relationship",
    );
  }
  const protectedEndpoint = protectsEdgeMetadata(registration, [
    from.nodeType as NodeType,
    to.nodeType as NodeType,
  ]);
  const stored = {
    ...(parsed as Record<string, unknown>),
    ...(protectedEndpoint ? { metadata: {} } : {}),
  };
  const [row] = await tx
    .insert(graphEdges)
    .values({
      edgeId: parsed.edge_id,
      workspaceId,
      edgeType: parsed.edge_type,
      fromNodeId: parsed.from_node_id,
      toNodeId: parsed.to_node_id,
      effectiveFrom: asDate(parsed.effective_from),
      effectiveTo: asDate(parsed.effective_to),
      version: 1,
      isSoftDeleted: parsed.is_soft_deleted,
      createdAt: new Date(parsed.created_at),
      createdBy: parsed.created_by,
      softDeletedAt: asDate(parsed.soft_deleted_at),
      softDeletedBy: parsed.soft_deleted_by,
      record: stored,
    })
    .returning();
  return toStoredEdge(row!);
}

export async function getEdge(
  tx: GraphTx,
  workspaceId: string,
  edgeId: string,
): Promise<StoredEdge | null> {
  const [row] = await tx
    .select()
    .from(graphEdges)
    .where(and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.edgeId, edgeId)));
  return row ? toStoredEdge(row) : null;
}

/** Replaces Tier 0 edge metadata in place; protected or undeclared content stays absent. */
export async function updateEdgeMetadata(
  tx: GraphTx,
  workspaceId: string,
  edgeId: string,
  metadata: unknown,
  actor: Actor,
): Promise<StoredEdge> {
  const [row] = await tx
    .select()
    .from(graphEdges)
    .where(and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.edgeId, edgeId)))
    .for("update");
  if (!row) throw new GraphNotFoundError(`Edge ${edgeId}`);
  if (row.isSoftDeleted) throw new GraphValidationError("The edge is deleted");
  const endpoints = await tx
    .select({ nodeId: graphNodes.nodeId, nodeType: graphNodes.nodeType })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.workspaceId, workspaceId),
        inArray(graphNodes.nodeId, [row.fromNodeId, row.toNodeId]),
      ),
    );
  const from = endpoints.find(({ nodeId }) => nodeId === row.fromNodeId);
  const to = endpoints.find(({ nodeId }) => nodeId === row.toNodeId);
  if (!from || !to) throw new GraphValidationError("Missing edge endpoint");
  const registration = assertRegisteredRelationship(
    row.edgeType as EdgeType,
    from.nodeType as NodeType,
    to.nodeType as NodeType,
  );
  const protectedEndpoint = protectsEdgeMetadata(registration, [
    from.nodeType as NodeType,
    to.nodeType as NodeType,
  ]);
  const parsed = parseEdge({
    ...(row.record as Record<string, unknown>),
    metadata: protectedEndpoint ? {} : metadata,
  });
  const [updated] = await tx
    .update(graphEdges)
    .set({
      record: parsed as Record<string, unknown>,
      version: sql`${graphEdges.version} + 1`,
      updatedAt: new Date(actor.at),
      updatedBy: actor.userId,
    })
    .where(and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.edgeId, edgeId)))
    .returning();
  return toStoredEdge(updated!);
}

/** Sets `effective_to` on an open edge. History is closed, never rewritten. */
export async function closeEdge(
  tx: GraphTx,
  workspaceId: string,
  edgeId: string,
  effectiveTo: string,
  actor: Actor,
): Promise<StoredEdge> {
  const [row] = await tx
    .select()
    .from(graphEdges)
    .where(and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.edgeId, edgeId)))
    .for("update");
  if (!row) throw new GraphNotFoundError(`Edge ${edgeId}`);
  if (row.effectiveTo !== null) {
    throw new GraphValidationError("The edge is already closed");
  }
  const parsed = parseEdge({
    ...(row.record as Record<string, unknown>),
    effective_to: effectiveTo,
  });
  const [updated] = await tx
    .update(graphEdges)
    .set({
      effectiveTo: new Date(effectiveTo),
      record: parsed as Record<string, unknown>,
      version: sql`${graphEdges.version} + 1`,
      updatedAt: new Date(actor.at),
      updatedBy: actor.userId,
    })
    .where(and(eq(graphEdges.workspaceId, workspaceId), eq(graphEdges.edgeId, edgeId)))
    .returning();
  return toStoredEdge(updated!);
}

/**
 * The edge is in force at `at` (half-open: `effective_from` inclusive,
 * `effective_to` exclusive). With no `at`, no temporal filter applies and the
 * whole non-deleted history is returned.
 */
function activeAt(at: string | undefined) {
  if (at === undefined) return sql`true`;
  return sql`(e.effective_from is null or e.effective_from <= ${at}::timestamptz)
    and (e.effective_to is null or e.effective_to > ${at}::timestamptz)`;
}

async function adjacent(
  tx: GraphTx,
  side: "from_node_id" | "to_node_id",
  workspaceId: string,
  nodeId: string,
  edgeType: EdgeType,
  at: string | undefined,
): Promise<StoredEdge[]> {
  const column = sql.raw(`e.${side}`);
  const rows = await tx.execute(sql`
    select e.* from graph_edges e
    where e.workspace_id = ${workspaceId}
      and ${column} = ${nodeId}
      and e.edge_type = ${edgeType}
      and not e.is_soft_deleted
      and ${activeAt(at)}
    order by e.effective_from nulls first, e.edge_id`);
  return (rows as unknown as Record<string, unknown>[]).map((r) =>
    toStoredEdge({
      workspaceId: r["workspace_id"] as string,
      edgeId: r["edge_id"] as string,
      edgeType: r["edge_type"] as string,
      fromNodeId: r["from_node_id"] as string,
      toNodeId: r["to_node_id"] as string,
      effectiveFrom: r["effective_from"]
        ? new Date(r["effective_from"] as string)
        : null,
      effectiveTo: r["effective_to"] ? new Date(r["effective_to"] as string) : null,
      version: Number(r["version"]),
      isSoftDeleted: r["is_soft_deleted"] as boolean,
      createdAt: new Date(r["created_at"] as string),
      createdBy: (r["created_by"] as string | null) ?? null,
      updatedAt: null,
      updatedBy: null,
      softDeletedAt: null,
      softDeletedBy: null,
      record: r["record"] as Record<string, unknown>,
    }),
  );
}

export const outgoing = (
  tx: GraphTx,
  workspaceId: string,
  nodeId: string,
  edgeType: EdgeType,
  at?: string,
): Promise<StoredEdge[]> =>
  adjacent(tx, "from_node_id", workspaceId, nodeId, edgeType, at);

export const incoming = (
  tx: GraphTx,
  workspaceId: string,
  nodeId: string,
  edgeType: EdgeType,
  at?: string,
): Promise<StoredEdge[]> =>
  adjacent(tx, "to_node_id", workspaceId, nodeId, edgeType, at);

export interface TraversalStep {
  readonly nodeId: string;
  readonly depth: number;
  readonly viaEdgeId: string;
}

const MAX_TRAVERSAL_DEPTH = 64;

/**
 * Follows outgoing edges of the given types from `startNodeId`, up to
 * `maxDepth` hops, never revisiting a node on the same path.
 */
export async function traverse(
  tx: GraphTx,
  workspaceId: string,
  startNodeId: string,
  edgeTypes: readonly EdgeType[],
  maxDepth: number,
  at?: string,
): Promise<TraversalStep[]> {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > MAX_TRAVERSAL_DEPTH) {
    throw new GraphValidationError(
      `maxDepth must be an integer from 1 to ${MAX_TRAVERSAL_DEPTH}`,
    );
  }
  if (edgeTypes.length === 0) {
    throw new GraphValidationError("traverse requires at least one edge type");
  }
  const types = sql.join(
    edgeTypes.map((t) => sql`${t}`),
    sql`, `,
  );
  const rows = await tx.execute(sql`
    with recursive walk(node_id, depth, edge_id, path) as (
      select e.to_node_id, 1, e.edge_id, array[e.from_node_id, e.to_node_id]
      from graph_edges e
      where e.workspace_id = ${workspaceId}
        and e.from_node_id = ${startNodeId}
        and e.edge_type in (${types})
        and not e.is_soft_deleted
        and ${activeAt(at)}
      union all
      select e.to_node_id, w.depth + 1, e.edge_id, w.path || e.to_node_id
      from walk w
      join graph_edges e
        on e.workspace_id = ${workspaceId}
       and e.from_node_id = w.node_id
      where w.depth < ${maxDepth}
        and e.edge_type in (${types})
        and not e.is_soft_deleted
        and ${activeAt(at)}
        and not (e.to_node_id = any(w.path))
    )
    select node_id, depth, edge_id from walk order by depth, node_id`);
  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    nodeId: r["node_id"] as string,
    depth: Number(r["depth"]),
    viaEdgeId: r["edge_id"] as string,
  }));
}

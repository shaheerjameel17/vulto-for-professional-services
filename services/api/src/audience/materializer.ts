import {
  assertRegisteredRelationship,
  getProtectionPartitions,
  isSystemOperationPermitted,
  parseWorkspaceRoles,
  type EdgeType,
  type NodeType,
} from "@vulto/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { member, organization, user } from "../auth/schema.js";
import { graphEdges, graphNodes } from "../graph/schema.js";
import type { GraphTx } from "../graph/tx.js";
import {
  decideRead,
  rowPartitionKey,
  type InterceptorContext,
} from "../permission/interceptor.js";
import type { MemberPrincipal, SystemPrincipal } from "../permission/principal.js";
import type { AudienceMaterializer } from "./index.js";
import { syncEdgeAudience, syncNodeAudience } from "./schema.js";

/**
 * The sync audience materializer (A003-T57, F202). The interceptor decides who
 * may read a row; this records that decision as identifiers, so every device
 * subscribes to the same two fixed shapes filtered by it. It is the only writer
 * of `sync_node_audience` and `sync_edge_audience`, and it decides with the
 * side-effect-free `decideRead`, so it writes no audit entries: recording who
 * may hold which row is the audience table itself (ruled 21 September 2026).
 *
 * Only Tier 0 rows are ever eligible. A node type with no Tier 0 partition holds
 * only universal fields in `graph_nodes`, and even their existence stays on the
 * server. An edge is eligible only if both endpoints are, and, for a split
 * endpoint, only through a governing partition that is Tier 0.
 */

const READABLE = new Set(["full", "read"]);
const SEPARATOR = "|";
const pair = (a: string, b: string) => `${a}${SEPARATOR}${b}`;

/** Whether a stored node row may ever replicate: its type has a Tier 0 partition. */
export function isNodeTypeReplicable(nodeType: NodeType): boolean {
  return getProtectionPartitions(nodeType).some((partition) => partition.tier === 0);
}

/** Whether an edge between two node types may ever replicate. */
export function isEdgeReplicable(
  edgeType: EdgeType,
  fromType: NodeType,
  toType: NodeType,
): boolean {
  if (!isNodeTypeReplicable(fromType) || !isNodeTypeReplicable(toType)) return false;
  let registration;
  try {
    registration = assertRegisteredRelationship(edgeType, fromType, toType);
  } catch {
    return false;
  }
  for (const nodeType of [fromType, toType]) {
    const partitions = getProtectionPartitions(nodeType);
    if (partitions.length <= 1) continue;
    const governing = registration.governingPartitions[nodeType];
    // A split endpoint with no reviewed declaration stays on the server (F136).
    if (governing === undefined) return false;
    if (partitions.find((p) => p.key === governing)?.tier !== 0) return false;
  }
  return true;
}

async function activeMembers(
  tx: GraphTx,
  workspaceId: string,
): Promise<MemberPrincipal[]> {
  const rows = await tx
    .select({ userId: member.userId, membershipId: member.id, roles: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
        eq(user.status, "active"),
        eq(organization.status, "active"),
      ),
    );
  const out: MemberPrincipal[] = [];
  for (const row of rows) {
    try {
      out.push({
        kind: "member",
        userId: row.userId,
        workspaceId,
        membershipId: row.membershipId,
        roles: parseWorkspaceRoles(row.roles),
      });
    } catch {
      // A membership whose roles cannot be read holds nothing.
    }
  }
  return out;
}

interface NodeRow {
  readonly nodeId: string;
  readonly nodeType: NodeType;
}
interface EdgeRow {
  readonly edgeId: string;
  readonly edgeType: EdgeType;
  readonly fromNodeId: string;
  readonly toNodeId: string;
}

const NO_ID = "00000000-0000-4000-8000-000000000000";

export interface MaterializerOptions {
  readonly interceptor?: InterceptorContext;
}

export class DatabaseAudienceMaterializer implements AudienceMaterializer {
  readonly #context: InterceptorContext;

  constructor(options: MaterializerOptions = {}) {
    this.#context = options.interceptor ?? {};
  }

  /**
   * Re-decides the touched rows (and the edges around touched nodes) for every
   * active member, inside the mutation's transaction. A change to a
   * `managed_by` edge can change scope for many rows at once, so it triggers a
   * full recompute of that workspace.
   */
  async onRowsChanged(tx: GraphTx, changedRowIds: readonly string[]): Promise<void> {
    if (changedRowIds.length === 0) return;
    const ids = [...new Set(changedRowIds)];
    const touchedNodes = await tx
      .select({ workspaceId: graphNodes.workspaceId, nodeId: graphNodes.nodeId })
      .from(graphNodes)
      .where(inArray(graphNodes.nodeId, ids));
    const touchedEdges = await tx
      .select({
        workspaceId: graphEdges.workspaceId,
        edgeId: graphEdges.edgeId,
        edgeType: graphEdges.edgeType,
      })
      .from(graphEdges)
      .where(inArray(graphEdges.edgeId, ids));

    const workspaces = new Set(
      [...touchedNodes, ...touchedEdges].map((row) => row.workspaceId),
    );
    for (const workspaceId of workspaces) {
      if (
        touchedEdges.some(
          (e) => e.workspaceId === workspaceId && e.edgeType === "managed_by",
        )
      ) {
        await this.recomputeWorkspace(tx, workspaceId);
        continue;
      }
      await this.#recompute(
        tx,
        workspaceId,
        touchedNodes.filter((n) => n.workspaceId === workspaceId).map((n) => n.nodeId),
        touchedEdges.filter((e) => e.workspaceId === workspaceId).map((e) => e.edgeId),
      );
    }
  }

  /** A full recompute, run as the `audience-recompute` system principal. */
  async recomputeWorkspace(tx: GraphTx, workspaceId: string): Promise<void> {
    const principal: SystemPrincipal = {
      kind: "system",
      name: "audience-recompute",
      workspaceId,
    };
    if (!isSystemOperationPermitted(principal.name, "audience.recompute")) {
      throw new Error("The audience-recompute principal is not permitted to recompute");
    }
    await this.#recompute(tx, workspaceId, null, null);
  }

  /** `null` for both lists means every row of the workspace. */
  async #recompute(
    tx: GraphTx,
    workspaceId: string,
    nodeIds: readonly string[] | null,
    edgeIds: readonly string[] | null,
  ): Promise<void> {
    const members = await activeMembers(tx, workspaceId);
    const memberIds = new Set(members.map((m) => m.userId));
    const full = nodeIds === null;

    const nodes = (await tx
      .select({ nodeId: graphNodes.nodeId, nodeType: graphNodes.nodeType })
      .from(graphNodes)
      .where(
        full
          ? eq(graphNodes.workspaceId, workspaceId)
          : and(
              eq(graphNodes.workspaceId, workspaceId),
              inArray(graphNodes.nodeId, [...nodeIds]),
            ),
      )) as NodeRow[];

    const touched = nodeIds ?? [];
    const edges = (await tx
      .select({
        edgeId: graphEdges.edgeId,
        edgeType: graphEdges.edgeType,
        fromNodeId: graphEdges.fromNodeId,
        toNodeId: graphEdges.toNodeId,
      })
      .from(graphEdges)
      .where(
        full
          ? eq(graphEdges.workspaceId, workspaceId)
          : and(
              eq(graphEdges.workspaceId, workspaceId),
              or(
                inArray(
                  graphEdges.edgeId,
                  edgeIds && edgeIds.length > 0 ? [...edgeIds] : [NO_ID],
                ),
                touched.length > 0
                  ? inArray(graphEdges.fromNodeId, [...touched])
                  : sql`false`,
                touched.length > 0
                  ? inArray(graphEdges.toNodeId, [...touched])
                  : sql`false`,
              ),
            ),
      )) as EdgeRow[];

    // An edge's endpoints may lie outside the touched set; load their types.
    const typeOf = new Map<string, NodeType>(nodes.map((n) => [n.nodeId, n.nodeType]));
    const missing = [
      ...new Set(edges.flatMap((e) => [e.fromNodeId, e.toNodeId])),
    ].filter((id) => !typeOf.has(id));
    const endpointNodes: NodeRow[] = [];
    if (missing.length > 0) {
      const rows = (await tx
        .select({ nodeId: graphNodes.nodeId, nodeType: graphNodes.nodeType })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.workspaceId, workspaceId),
            inArray(graphNodes.nodeId, missing),
          ),
        )) as NodeRow[];
      for (const row of rows) {
        typeOf.set(row.nodeId, row.nodeType);
        endpointNodes.push(row);
      }
    }
    const decidable = [...nodes, ...endpointNodes];

    const wantNodes = new Set<string>();
    const wantEdges = new Set<string>();
    for (const principal of members) {
      const readable = new Set<string>();
      for (const node of decidable) {
        if (!isNodeTypeReplicable(node.nodeType)) continue;
        const decision = await decideRead(
          tx,
          principal,
          {
            workspaceId,
            nodeType: node.nodeType,
            nodeId: node.nodeId,
            partitionKey: rowPartitionKey(node.nodeType),
          },
          this.#context,
        );
        if (READABLE.has(decision.access)) readable.add(node.nodeId);
      }
      for (const node of nodes) {
        if (readable.has(node.nodeId))
          wantNodes.add(pair(principal.userId, node.nodeId));
      }
      for (const edge of edges) {
        const fromType = typeOf.get(edge.fromNodeId);
        const toType = typeOf.get(edge.toNodeId);
        if (
          fromType &&
          toType &&
          isEdgeReplicable(edge.edgeType, fromType, toType) &&
          readable.has(edge.fromNodeId) &&
          readable.has(edge.toNodeId)
        ) {
          wantEdges.add(pair(principal.userId, edge.edgeId));
        }
      }
    }

    // Diff against what is recorded, for the rows in scope only.
    const scopeNodeIds = nodes.map((n) => n.nodeId);
    const scopeEdgeIds = edges.map((e) => e.edgeId);
    const haveNodes = full
      ? await tx
          .select()
          .from(syncNodeAudience)
          .where(eq(syncNodeAudience.workspaceId, workspaceId))
      : scopeNodeIds.length === 0
        ? []
        : await tx
            .select()
            .from(syncNodeAudience)
            .where(
              and(
                eq(syncNodeAudience.workspaceId, workspaceId),
                inArray(syncNodeAudience.nodeId, scopeNodeIds),
              ),
            );
    const haveEdges = full
      ? await tx
          .select()
          .from(syncEdgeAudience)
          .where(eq(syncEdgeAudience.workspaceId, workspaceId))
      : scopeEdgeIds.length === 0
        ? []
        : await tx
            .select()
            .from(syncEdgeAudience)
            .where(
              and(
                eq(syncEdgeAudience.workspaceId, workspaceId),
                inArray(syncEdgeAudience.edgeId, scopeEdgeIds),
              ),
            );

    const haveNodeKeys = new Set(haveNodes.map((r) => pair(r.userId, r.nodeId)));
    const haveEdgeKeys = new Set(haveEdges.map((r) => pair(r.userId, r.edgeId)));

    // A person no longer an active member holds nothing.
    for (const row of haveNodes) {
      if (!wantNodes.has(pair(row.userId, row.nodeId)) || !memberIds.has(row.userId)) {
        await tx
          .delete(syncNodeAudience)
          .where(
            and(
              eq(syncNodeAudience.workspaceId, workspaceId),
              eq(syncNodeAudience.userId, row.userId),
              eq(syncNodeAudience.nodeId, row.nodeId),
            ),
          );
      }
    }
    for (const row of haveEdges) {
      if (!wantEdges.has(pair(row.userId, row.edgeId)) || !memberIds.has(row.userId)) {
        await tx
          .delete(syncEdgeAudience)
          .where(
            and(
              eq(syncEdgeAudience.workspaceId, workspaceId),
              eq(syncEdgeAudience.userId, row.userId),
              eq(syncEdgeAudience.edgeId, row.edgeId),
            ),
          );
      }
    }
    const newNodes = [...wantNodes]
      .filter((k) => !haveNodeKeys.has(k))
      .map((k) => {
        const [userId, nodeId] = k.split(SEPARATOR) as [string, string];
        return { workspaceId, userId, nodeId };
      });
    const newEdges = [...wantEdges]
      .filter((k) => !haveEdgeKeys.has(k))
      .map((k) => {
        const [userId, edgeId] = k.split(SEPARATOR) as [string, string];
        return { workspaceId, userId, edgeId };
      });
    if (newNodes.length > 0)
      await tx.insert(syncNodeAudience).values(newNodes).onConflictDoNothing();
    if (newEdges.length > 0)
      await tx.insert(syncEdgeAudience).values(newEdges).onConflictDoNothing();
  }
}

export const audienceMaterializer = new DatabaseAudienceMaterializer();

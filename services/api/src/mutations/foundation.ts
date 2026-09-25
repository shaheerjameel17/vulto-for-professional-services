import {
  FEATURE_LIFECYCLE_NODE_TYPES,
  isNodeType,
  isTier0Only,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  moveEmployeeEdgeId,
  wouldCreateCycle,
  type EdgeType,
  type MutationArgs,
  type MutationName,
  type NodeType,
} from "@vulto/schema";
import {
  getEdge,
  getNode,
  GraphNotFoundError,
  GraphValidationError,
  insertEdge,
  insertNode,
  outgoing,
  softDeleteNode,
  StaleVersionError,
  closeEdge,
  updateNodeFields,
  updateEdgeMetadata,
  type StoredNode,
} from "../graph/store.js";
import {
  MutationRejection,
  type MutationContext,
  type ServerMutation,
  type WriteCheck,
} from "./types.js";

type Args<Name extends MutationName> = MutationArgs<Name>;

const translate = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StaleVersionError) throw new MutationRejection("stale-state");
    if (error instanceof GraphNotFoundError) throw new MutationRejection("not-found");
    if (error instanceof GraphValidationError)
      throw new MutationRejection("invalid-args");
    throw error;
  }
};

const asNodeType = (value: unknown): NodeType => {
  if (typeof value !== "string" || !isNodeType(value)) {
    throw new MutationRejection("invalid-args");
  }
  return value;
};

const asId = (value: unknown): string => {
  if (typeof value !== "string") throw new MutationRejection("invalid-args");
  return value;
};

const provenance = (ctx: MutationContext<unknown>) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});

async function requireNode(
  ctx: MutationContext<unknown>,
  nodeId: string,
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, nodeId);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  return node;
}

const nodeTarget = (
  ctx: MutationContext<unknown>,
  nodeType: NodeType,
  nodeId: string | null,
) =>
  ({ kind: "node", workspaceId: ctx.principal.workspaceId, nodeType, nodeId }) as const;

async function edgeTarget(
  ctx: MutationContext<unknown>,
  edgeType: string,
  fromId: string,
  toId: string,
  edgeId: string | null,
) {
  const from = await getNode(ctx.tx, ctx.principal.workspaceId, fromId);
  const to = await getNode(ctx.tx, ctx.principal.workspaceId, toId);
  if (!from || !to) throw new MutationRejection("invalid-args");
  return {
    kind: "edge",
    workspaceId: ctx.principal.workspaceId,
    edgeType: edgeType as EdgeType,
    fromNodeType: from.nodeType as NodeType,
    toNodeType: to.nodeType as NodeType,
    edgeId,
  } as const;
}

const nothing = async () => {};

export const createNode: ServerMutation<Args<"graph.createNode">> = async (ctx) => {
  const node = ctx.args.node;
  const nodeType = asNodeType(node["node_type"]);
  const nodeId = asId(node["node_id"]);
  return {
    checks: [
      { target: nodeTarget(ctx, nodeType, nodeId), change: { operation: "create" } },
    ],
    async validate() {
      if (FEATURE_LIFECYCLE_NODE_TYPES.has(nodeType))
        throw new MutationRejection("requires-feature-mutation");
      if (!isTier0Only(nodeType))
        throw new MutationRejection("requires-feature-mutation");
      const claimed = node["workspace_id"];
      if (claimed !== undefined && claimed !== ctx.principal.workspaceId) {
        throw new MutationRejection("invalid-args");
      }
    },
    async apply() {
      const stored = await translate(() =>
        insertNode(ctx.tx, stampNewNode(node, nodeType, provenance(ctx))),
      );
      return {
        result: { node_id: stored.nodeId, version: stored.version },
        changedRowIds: [stored.nodeId],
      };
    },
  };
};

export const updateNodeFieldsMutation: ServerMutation<
  Args<"graph.updateNodeFields">
> = async (ctx) => {
  const node = await requireNode(ctx, ctx.args.node_id);
  const nodeType = node.nodeType as NodeType;
  return {
    checks: [
      {
        target: nodeTarget(ctx, nodeType, node.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (FEATURE_LIFECYCLE_NODE_TYPES.has(nodeType))
        throw new MutationRejection("requires-feature-mutation");
      if (!isTier0Only(nodeType))
        throw new MutationRejection("requires-feature-mutation");
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          node.nodeId,
          ctx.args.expected_version,
          {
            ...ctx.args.patch,
            ...updateStamp(node.nodeType, provenance(ctx)),
          },
        ),
      );
      return {
        result: { node_id: updated.nodeId, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

export const softDeleteNodeMutation: ServerMutation<
  Args<"graph.softDeleteNode">
> = async (ctx) => {
  const node = await requireNode(ctx, ctx.args.node_id);
  return {
    checks: [
      {
        target: nodeTarget(ctx, node.nodeType as NodeType, node.nodeId),
        change: { operation: "remove" },
      },
    ],
    async validate() {
      if (FEATURE_LIFECYCLE_NODE_TYPES.has(node.nodeType))
        throw new MutationRejection("requires-feature-mutation");
    },
    async apply() {
      const deleted = await translate(() =>
        softDeleteNode(ctx.tx, ctx.principal.workspaceId, node.nodeId, {
          userId: ctx.principal.userId,
          at: ctx.now,
        }),
      );
      return {
        result: { node_id: deleted.nodeId, version: deleted.version },
        changedRowIds: [deleted.nodeId],
      };
    },
  };
};

export const createEdgeMutation: ServerMutation<Args<"graph.createEdge">> = async (
  ctx,
) => {
  const edge = ctx.args.edge;
  const target = await edgeTarget(
    ctx,
    asId(edge["edge_type"]),
    asId(edge["from_node_id"]),
    asId(edge["to_node_id"]),
    asId(edge["edge_id"]),
  );
  return {
    checks: [{ target, change: { operation: "create" } }],
    validate: nothing,
    async apply() {
      const stored = await translate(() =>
        insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          stampNewEdge(edge, provenance(ctx)),
        ),
      );
      return { result: { edge_id: stored.edgeId }, changedRowIds: [stored.edgeId] };
    },
  };
};

export const closeEdgeMutation: ServerMutation<Args<"graph.closeEdge">> = async (
  ctx,
) => {
  const edge = await getEdge(ctx.tx, ctx.principal.workspaceId, ctx.args.edge_id);
  if (!edge) throw new MutationRejection("not-found");
  if (edge.isSoftDeleted) throw new MutationRejection("target-deleted");
  const target = await edgeTarget(
    ctx,
    edge.edgeType,
    edge.fromNodeId,
    edge.toNodeId,
    edge.edgeId,
  );
  return {
    checks: [{ target, change: { operation: "update" } }],
    validate: nothing,
    async apply() {
      const closed = await translate(() =>
        closeEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          edge.edgeId,
          ctx.args.effective_to,
          {
            userId: ctx.principal.userId,
            at: ctx.now,
          },
        ),
      );
      return {
        result: { edge_id: closed.edgeId, version: closed.version },
        changedRowIds: [closed.edgeId],
      };
    },
  };
};

export const updateEdgeMetadataMutation: ServerMutation<
  Args<"graph.updateEdgeMetadata">
> = async (ctx) => {
  const edge = await getEdge(ctx.tx, ctx.principal.workspaceId, ctx.args.edge_id);
  if (!edge) throw new MutationRejection("not-found");
  if (edge.isSoftDeleted) throw new MutationRejection("target-deleted");
  const target = await edgeTarget(
    ctx,
    edge.edgeType,
    edge.fromNodeId,
    edge.toNodeId,
    edge.edgeId,
  );
  return {
    checks: [{ target, change: { operation: "update" } }],
    validate: nothing,
    async apply() {
      const updated = await translate(() =>
        updateEdgeMetadata(
          ctx.tx,
          ctx.principal.workspaceId,
          edge.edgeId,
          ctx.args.metadata,
          { userId: ctx.principal.userId, at: ctx.now },
        ),
      );
      return {
        result: { edge_id: updated.edgeId, version: updated.version },
        changedRowIds: [updated.edgeId],
      };
    },
  };
};

/** A state transition carries the version it was decided against (A003-T54). */
export const transitionLifecycle: ServerMutation<
  Args<"graph.transitionLifecycle">
> = async (ctx) => {
  const node = await requireNode(ctx, ctx.args.node_id);
  return {
    checks: [
      {
        target: nodeTarget(ctx, node.nodeType as NodeType, node.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      // A type whose lifecycle a feature owns has its own transition table.
      if (FEATURE_LIFECYCLE_NODE_TYPES.has(node.nodeType))
        throw new MutationRejection("requires-feature-mutation");
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          node.nodeId,
          ctx.args.expected_version,
          {
            lifecycle_status: ctx.args.to_status,
            ...updateStamp(node.nodeType, provenance(ctx)),
          },
        ),
      );
      return {
        result: { node_id: updated.nodeId, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

/**
 * A reporting-line move (A003-T69). The pipeline runs it in a serializable
 * transaction. It rejects a loop, closes the prior `managed_by` edge and opens
 * the new one at the same caller-supplied instant, so history is half-open and
 * never overlaps. The clock is not read.
 */
export const moveEmployee: ServerMutation<Args<"org.moveEmployee">> = async (ctx) => {
  const {
    employee_id: employeeId,
    new_manager_id: newManagerId,
    effective_from: effectiveFrom,
  } = ctx.args;
  const workspaceId = ctx.principal.workspaceId;
  const employee = await requireNode(ctx, employeeId);
  if (employee.nodeType !== "Employee") throw new MutationRejection("invalid-args");
  if (newManagerId !== null) {
    const manager = await requireNode(ctx, newManagerId);
    if (manager.nodeType !== "Employee") throw new MutationRejection("invalid-args");
    const managerOf = async (id: string) =>
      (await outgoing(ctx.tx, workspaceId, id, "managed_by", effectiveFrom))[0]
        ?.toNodeId ?? null;
    if (await wouldCreateCycle(managerOf, employeeId, newManagerId)) {
      throw new MutationRejection("cycle");
    }
  }
  const prior = (await outgoing(ctx.tx, workspaceId, employeeId, "managed_by")).find(
    (edge) => edge.effectiveTo === null,
  );
  if ((prior?.toNodeId ?? null) === newManagerId)
    throw new MutationRejection("no-change");

  const managedBy = (edgeId: string) =>
    ({
      kind: "edge",
      workspaceId,
      edgeType: "managed_by",
      fromNodeType: "Employee",
      toNodeType: "Employee",
      edgeId,
    }) as const;
  const newEdgeId = moveEmployeeEdgeId(ctx.mutationId);
  const checks: WriteCheck[] = [];
  if (prior)
    checks.push({ target: managedBy(prior.edgeId), change: { operation: "update" } });
  if (newManagerId !== null) {
    checks.push({ target: managedBy(newEdgeId), change: { operation: "create" } });
  }

  return {
    checks,
    validate: nothing,
    async apply() {
      const changed: string[] = [];
      let closedEdgeId: string | null = null;
      if (prior) {
        await translate(() =>
          closeEdge(ctx.tx, workspaceId, prior.edgeId, effectiveFrom, {
            userId: ctx.principal.userId,
            at: ctx.now,
          }),
        );
        closedEdgeId = prior.edgeId;
        changed.push(prior.edgeId);
      }
      if (newManagerId !== null) {
        await translate(() =>
          insertEdge(ctx.tx, workspaceId, {
            edge_id: newEdgeId,
            edge_type: "managed_by",
            from_node_id: employeeId,
            to_node_id: newManagerId,
            effective_from: effectiveFrom,
            effective_to: null,
            created_at: ctx.now,
            created_by: ctx.principal.userId,
            metadata: {},
            is_soft_deleted: false,
            soft_deleted_at: null,
            soft_deleted_by: null,
          }),
        );
        changed.push(newEdgeId);
      }
      return {
        result: {
          closed_edge_id: closedEdgeId,
          opened_edge_id: newManagerId === null ? null : newEdgeId,
        },
        changedRowIds: changed,
      };
    },
  };
};

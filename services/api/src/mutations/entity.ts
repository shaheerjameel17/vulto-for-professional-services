import {
  moveEmployeeEdgeId,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type MutationArgs,
} from "@vulto/schema";
import {
  countActiveEmployeesForEntity,
  resolveEntityAssignment,
  resolveForEmployee,
} from "../graph/entity-resolution.js";
import {
  closeEdge,
  getNode,
  getNodes,
  GraphNotFoundError,
  GraphValidationError,
  insertEdge,
  insertNode,
  StaleVersionError,
  updateNodeFields,
  type StoredNode,
} from "../graph/store.js";
import {
  MutationRejection,
  type MutationContext,
  type ServerMutation,
  type WriteCheck,
} from "./types.js";

const provenance = (ctx: MutationContext<unknown>) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});

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

async function requireEntity(
  ctx: MutationContext<unknown>,
  entityId: string,
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, entityId);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (node.nodeType !== "Entity") throw new MutationRejection("invalid-args");
  return node;
}

const entityTarget = (ctx: MutationContext<unknown>, entityId: string) => ({
  kind: "node" as const,
  workspaceId: ctx.principal.workspaceId,
  nodeType: "Entity" as const,
  nodeId: entityId,
});

export const entityCreate: ServerMutation<MutationArgs<"entity.create">> = async (
  ctx,
) => {
  const entityId = moveEmployeeEdgeId(ctx.mutationId);
  return {
    checks: [{ target: entityTarget(ctx, entityId), change: { operation: "create" } }],
    async validate() {},
    async apply() {
      const stored = await translate(() =>
        insertNode(
          ctx.tx,
          stampNewNode(
            {
              node_id: entityId,
              node_type: "Entity",
              schema_version: 1,
              lifecycle_status: "Active",
              name: ctx.args.name,
              legal_name: ctx.args.fields?.legal_name ?? null,
              jurisdiction: ctx.args.jurisdiction,
              registered_address: ctx.args.fields?.registered_address ?? null,
              registration_number: ctx.args.fields?.registration_number ?? null,
              default_currency: ctx.args.default_currency,
            },
            "Entity",
            provenance(ctx),
          ),
        ),
      );
      return { result: { entity_id: stored.nodeId }, changedRowIds: [stored.nodeId] };
    },
  };
};

export const entityUpdate: ServerMutation<MutationArgs<"entity.update">> = async (
  ctx,
) => {
  const node = await requireEntity(ctx, ctx.args.entity_id);
  return {
    checks: [
      { target: entityTarget(ctx, node.nodeId), change: { operation: "update" } },
    ],
    async validate() {},
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(ctx.tx, ctx.principal.workspaceId, node.nodeId, null, {
          ...ctx.args.fields,
          ...updateStamp("Entity", provenance(ctx)),
        }),
      );
      return {
        result: { success: true, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

export const entityDeactivate: ServerMutation<
  MutationArgs<"entity.deactivate">
> = async (ctx) => {
  const node = await requireEntity(ctx, ctx.args.entity_id);
  return {
    checks: [
      { target: entityTarget(ctx, node.nodeId), change: { operation: "update" } },
    ],
    async validate() {
      if (ctx.args.expected_version !== node.version)
        throw new MutationRejection("stale-state");
      if (node.lifecycleStatus !== "Active") throw new MutationRejection("no-change");
      const activeEmployees = await countActiveEmployeesForEntity(
        ctx.tx,
        ctx.principal.workspaceId,
        node.nodeId,
        ctx.now,
      );
      if (activeEmployees > 0) {
        throw new MutationRejection(`active-employees:${activeEmployees}`);
      }
      const activeEntities = await getNodes(ctx.tx, ctx.principal.workspaceId, {
        nodeType: "Entity",
        lifecycleStatus: "Active",
      });
      if (activeEntities.length <= 1) throw new MutationRejection("last-active-entity");
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          node.nodeId,
          ctx.args.expected_version,
          { lifecycle_status: "Dissolved", ...updateStamp("Entity", provenance(ctx)) },
        ),
      );
      return {
        result: { success: true, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

export const employeeSetEntity: ServerMutation<
  MutationArgs<"employee.setEntity">
> = async (ctx) => {
  const workspaceId = ctx.principal.workspaceId;
  const employee = await getNode(ctx.tx, workspaceId, ctx.args.employee_id);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee") {
    throw new MutationRejection("invalid-args");
  }
  const destination = await requireEntity(ctx, ctx.args.entity_id);
  if (destination.lifecycleStatus !== "Active")
    throw new MutationRejection("entity-dissolved");
  const currentEntity = await resolveForEmployee(
    ctx.tx,
    workspaceId,
    employee.nodeId,
    ctx.args.effective_from,
  );
  const prior = await resolveEntityAssignment(
    ctx.tx,
    workspaceId,
    employee.nodeId,
    "open",
  );
  if (!currentEntity || !prior) throw new MutationRejection("not-found");
  if (prior.entity.nodeId === destination.nodeId)
    throw new MutationRejection("no-change");
  const edgeTarget = (edgeId: string) => ({
    kind: "edge" as const,
    workspaceId,
    edgeType: "scoped_to_entity" as const,
    fromNodeType: "Employee" as const,
    toNodeType: "Entity" as const,
    edgeId,
  });
  const newEdgeId = moveEmployeeEdgeId(ctx.mutationId);
  const checks: WriteCheck[] = [
    { target: edgeTarget(prior.edge.edgeId), change: { operation: "update" } },
    { target: edgeTarget(newEdgeId), change: { operation: "create" } },
  ];
  return {
    checks,
    async validate() {},
    async apply() {
      await translate(() =>
        closeEdge(ctx.tx, workspaceId, prior.edge.edgeId, ctx.args.effective_from, {
          userId: ctx.principal.userId,
          at: ctx.now,
        }),
      );
      const edge = await translate(() =>
        insertEdge(
          ctx.tx,
          workspaceId,
          stampNewEdge(
            {
              edge_id: newEdgeId,
              edge_type: "scoped_to_entity",
              from_node_id: employee.nodeId,
              to_node_id: destination.nodeId,
              effective_from: ctx.args.effective_from,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      return {
        result: { edge_id: edge.edgeId },
        changedRowIds: [prior.edge.edgeId, edge.edgeId],
      };
    },
  };
};

import { stampNewEdge, stampNewNode, type MutationArgs } from "@vulto/schema";
import {
  closeEdge,
  getNode,
  insertEdge,
  insertNode,
  outgoing,
  type StoredNode,
} from "../graph/store.js";
import {
  MutationRejection,
  type MutationContext,
  type ServerMutation,
} from "./types.js";

const provenance = (ctx: MutationContext<unknown>) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});

async function requireNode(
  ctx: MutationContext<unknown>,
  id: string,
  type: "Pitch" | "Employee" | "Client",
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, id);
  if (!node || node.isSoftDeleted) throw new MutationRejection("not-found");
  if (node.nodeType !== type) throw new MutationRejection("invalid-args");
  return node;
}

const pitchTarget = (ctx: MutationContext<unknown>, pitchId: string) => ({
  kind: "node" as const,
  workspaceId: ctx.principal.workspaceId,
  nodeType: "Pitch" as const,
  nodeId: pitchId,
  partitionKey: "identifying",
});

const staffingTarget = (
  ctx: MutationContext<unknown>,
  employeeId: string,
  pitchId: string,
  edgeId: string,
) => ({
  kind: "edge" as const,
  workspaceId: ctx.principal.workspaceId,
  edgeType: "staffed_on" as const,
  fromNodeType: "Employee" as const,
  fromNodeId: employeeId,
  toNodeType: "Pitch" as const,
  toNodeId: pitchId,
  edgeId,
});

export const pitchCreate: ServerMutation<MutationArgs<"pitch.create">> = async (
  ctx,
) => {
  const pitchId = ctx.mutationId;
  const client = ctx.args.client_id
    ? await requireNode(ctx, ctx.args.client_id, "Client")
    : null;
  return {
    checks: [{ target: pitchTarget(ctx, pitchId), change: { operation: "create" } }],
    async validate() {
      if (client && client.lifecycleStatus !== "Active")
        throw new MutationRejection("invalid-args");
    },
    async apply() {
      await insertNode(
        ctx.tx,
        stampNewNode(
          {
            node_id: pitchId,
            node_type: "Pitch",
            schema_version: 1,
            lifecycle_status: "Active",
            name: ctx.args.name,
            client_id: client?.nodeId ?? null,
            projected_start_date: ctx.args.projected_start_date ?? null,
          },
          "Pitch",
          provenance(ctx),
        ),
      );
      return { result: { pitchId }, changedRowIds: [pitchId] };
    },
  };
};

async function staffingPlan(
  ctx: MutationContext<MutationArgs<"pitch.staffEmployee">>,
  action: "staff" | "unstaff",
) {
  await requireNode(ctx, ctx.args.employee_id, "Employee");
  await requireNode(ctx, ctx.args.pitch_id, "Pitch");
  const active = (
    await outgoing(
      ctx.tx,
      ctx.principal.workspaceId,
      ctx.args.employee_id,
      "staffed_on",
    )
  ).find((edge) => edge.toNodeId === ctx.args.pitch_id && edge.effectiveTo === null);
  const edgeId =
    action === "staff" ? ctx.mutationId : (active?.edgeId ?? ctx.mutationId);
  return {
    checks: [
      {
        target: staffingTarget(ctx, ctx.args.employee_id, ctx.args.pitch_id, edgeId),
        change: {
          operation: action === "staff" ? ("create" as const) : ("update" as const),
        },
      },
    ],
    async validate() {},
    async apply() {
      if (action === "staff") {
        if (active) return { result: { success: true }, changedRowIds: [] };
        await insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          stampNewEdge(
            {
              edge_id: edgeId,
              edge_type: "staffed_on",
              from_node_id: ctx.args.employee_id,
              to_node_id: ctx.args.pitch_id,
              effective_from: ctx.now,
              effective_to: null,
            },
            provenance(ctx),
          ),
        );
      } else {
        if (!active) return { result: { success: true }, changedRowIds: [] };
        await closeEdge(ctx.tx, ctx.principal.workspaceId, active.edgeId, ctx.now, {
          userId: ctx.principal.userId,
          at: ctx.now,
        });
      }
      return { result: { success: true }, changedRowIds: [edgeId] };
    },
  };
}

export const pitchStaffEmployee: ServerMutation<MutationArgs<"pitch.staffEmployee">> = (
  ctx,
) => staffingPlan(ctx, "staff");
export const pitchUnstaffEmployee: ServerMutation<
  MutationArgs<"pitch.unstaffEmployee">
> = (ctx) => staffingPlan(ctx, "unstaff");

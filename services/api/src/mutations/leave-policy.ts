import {
  mutationDerivedId,
  stampNewNode,
  stampNewEdge,
  updateStamp,
  leavePolicyFieldsSchema,
  type MutationArgs,
} from "@vulto/schema";
import {
  getNode,
  insertNode,
  insertEdge,
  updateNodeFields,
  StaleVersionError,
} from "../graph/store.js";
import { MutationRejection, type ServerMutation } from "./types.js";

const provenance = (ctx: Parameters<ServerMutation<unknown>>[0]) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});
const target = (ctx: Parameters<ServerMutation<unknown>>[0], nodeId: string) =>
  ({
    kind: "node",
    workspaceId: ctx.principal.workspaceId,
    nodeType: "LeavePolicy",
    nodeId,
    partitionKey: "record",
  }) as const;

export const leavePolicyCreate: ServerMutation<
  MutationArgs<"leavePolicy.create">
> = async (ctx) => ({
  checks: [{ target: target(ctx, ctx.mutationId), change: { operation: "create" } }],
  async validate() {},
  async apply() {
    const record = leavePolicyFieldsSchema.parse(
      stampNewNode(
        {
          node_id: ctx.mutationId,
          node_type: "LeavePolicy",
          schema_version: 1,
          lifecycle_status: "Active",
          ...ctx.args,
          version: 1,
          supersedes_id: null,
          is_active: true,
        },
        "LeavePolicy",
        provenance(ctx),
      ),
    );
    await insertNode(ctx.tx, record);
    return { result: { policy_id: ctx.mutationId }, changedRowIds: [ctx.mutationId] };
  },
});

export const leavePolicyUpdate: ServerMutation<
  MutationArgs<"leavePolicy.update">
> = async (ctx) => {
  const prior = await getNode(ctx.tx, ctx.principal.workspaceId, ctx.args.policy_id);
  if (!prior) throw new MutationRejection("not-found");
  if (prior.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (prior.nodeType !== "LeavePolicy") throw new MutationRejection("invalid-args");
  const edgeId = mutationDerivedId(ctx.mutationId, 1);
  const effectiveFrom = ctx.args.effective_from ?? ctx.now.slice(0, 10);
  return {
    checks: [
      { target: target(ctx, prior.nodeId), change: { operation: "update" } },
      { target: target(ctx, ctx.mutationId), change: { operation: "create" } },
      {
        target: {
          kind: "edge",
          workspaceId: ctx.principal.workspaceId,
          edgeType: "supersedes",
          fromNodeType: "LeavePolicy",
          toNodeType: "LeavePolicy",
          edgeId,
        },
        change: { operation: "create" },
      },
    ],
    async validate() {
      if (
        ctx.args.expected_version !== prior.version ||
        prior.record["is_active"] !== true
      )
        throw new MutationRejection("stale-state");
      if (effectiveFrom < ctx.now.slice(0, 10))
        throw new MutationRejection("invalid-args");
    },
    async apply() {
      try {
        await updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          prior.nodeId,
          ctx.args.expected_version,
          { is_active: false },
        );
      } catch (error) {
        if (error instanceof StaleVersionError)
          throw new MutationRejection("stale-state");
        throw error;
      }
      const old = leavePolicyFieldsSchema.parse(prior.record);
      const next = leavePolicyFieldsSchema.parse({
        ...old,
        ...updateStamp("LeavePolicy", provenance(ctx)),
        node_id: ctx.mutationId,
        created_at: ctx.now,
        created_by: ctx.principal.userId,
        leave_types: ctx.args.leave_types,
        overtime_policy: ctx.args.overtime_policy ?? old.overtime_policy,
        blackout_periods: ctx.args.blackout_periods ?? old.blackout_periods,
        effective_from: effectiveFrom,
        version: old.version + 1,
        supersedes_id: prior.nodeId,
        is_active: true,
      });
      await insertNode(ctx.tx, next);
      await insertEdge(
        ctx.tx,
        ctx.principal.workspaceId,
        stampNewEdge(
          {
            edge_id: edgeId,
            edge_type: "supersedes",
            from_node_id: ctx.mutationId,
            to_node_id: prior.nodeId,
            effective_from: ctx.now,
            effective_to: null,
          },
          provenance(ctx),
        ),
      );
      return {
        result: { new_policy_id: ctx.mutationId },
        changedRowIds: [prior.nodeId, ctx.mutationId, edgeId],
      };
    },
  };
};

import { type MutationArgs } from "@vulto/schema";
import { getNode, getNodes, updateNodeFields } from "../graph/store.js";
import { decideRead } from "../permission/interceptor.js";
import {
  MutationRejection,
  type ServerMutation,
  type MutationContext,
} from "./types.js";

async function recipientCanRead(ctx: MutationContext<unknown>, nodeId: string) {
  const decision = await decideRead(
    ctx.tx,
    ctx.principal,
    {
      nodeType: "Notification",
      nodeId,
      workspaceId: ctx.principal.workspaceId,
      partitionKey: "record",
    },
    { now: () => ctx.now },
  );
  return decision.access === "full";
}

async function ownNotifications(ctx: MutationContext<unknown>) {
  const nodes = await getNodes(ctx.tx, ctx.principal.workspaceId, {
    nodeType: "Notification",
  });
  const own = [];
  for (const node of nodes) {
    if (await recipientCanRead(ctx, node.nodeId)) own.push(node);
  }
  return own;
}

const readState =
  (dismiss: boolean): ServerMutation<MutationArgs<"notification.markRead">> =>
  async (ctx) => {
    const node = await getNode(
      ctx.tx,
      ctx.principal.workspaceId,
      ctx.args.notification_id,
    );
    if (
      !node ||
      node.isSoftDeleted ||
      node.nodeType !== "Notification" ||
      !(await recipientCanRead(ctx, node.nodeId))
    )
      throw new MutationRejection("not-found");
    return plan(ctx, [node], dismiss);
  };

function plan(
  ctx: MutationContext<unknown>,
  nodes: Awaited<ReturnType<typeof ownNotifications>>,
  dismiss: boolean,
) {
  return {
    checks: nodes.map((node) => ({
      target: {
        kind: "node" as const,
        workspaceId: ctx.principal.workspaceId,
        nodeType: "Notification" as const,
        nodeId: node.nodeId,
        partitionKey: "record",
      },
      change: { operation: "update" as const },
    })),
    async validate() {},
    async apply() {
      const changedRowIds: string[] = [];
      for (const node of nodes) {
        const patch: Record<string, unknown> = {};
        if (node.record["read_at"] === null) patch["read_at"] = ctx.now;
        if (dismiss && node.record["dismissed_at"] === null)
          patch["dismissed_at"] = ctx.now;
        if (Object.keys(patch).length) {
          await updateNodeFields(
            ctx.tx,
            ctx.principal.workspaceId,
            node.nodeId,
            null,
            patch,
          );
          changedRowIds.push(node.nodeId);
        }
      }
      return { result: { success: true }, changedRowIds };
    },
  };
}
export const notificationMarkRead = readState(false);
export const notificationDismiss = readState(true);
export const notificationMarkAllRead: ServerMutation<
  MutationArgs<"notification.markAllRead">
> = async (ctx) =>
  plan(
    ctx,
    (await ownNotifications(ctx)).filter((node) => node.record["read_at"] === null),
    false,
  );

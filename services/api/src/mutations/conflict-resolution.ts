import type { MutationArgs } from "@vulto/schema";
import { getNode, outgoing } from "../graph/store.js";
import {
  buildAssignmentCreatePlan,
  type AssignmentCreationInput,
} from "./assignment.js";
import { MutationRejection, type ServerMutation } from "./types.js";

async function callerMayOverride(
  ctx: Parameters<
    ServerMutation<MutationArgs<"conflictResolution.overrideAndProceed">>
  >[0],
  employeeId: string,
): Promise<boolean> {
  if (ctx.principal.roles.includes("owner")) return true;
  const managerEdge = (
    await outgoing(ctx.tx, ctx.principal.workspaceId, employeeId, "managed_by", ctx.now)
  ).find((edge) => !edge.isSoftDeleted && edge.effectiveTo === null);
  if (!managerEdge) return false;
  const manager = await getNode(
    ctx.tx,
    ctx.principal.workspaceId,
    managerEdge.toNodeId,
  );
  return (
    manager?.nodeType === "Employee" &&
    !manager.isSoftDeleted &&
    manager.record["user_id"] === ctx.principal.userId
  );
}

export const conflictResolutionOverrideAndProceed: ServerMutation<
  MutationArgs<"conflictResolution.overrideAndProceed">
> = async (ctx) => {
  if (!(await callerMayOverride(ctx, ctx.args.proposed.employee_id))) {
    throw new MutationRejection("not-authorized");
  }
  const proposed: AssignmentCreationInput = {
    employeeId: ctx.args.proposed.employee_id,
    projectId: ctx.args.proposed.project_id,
    startDate: ctx.args.proposed.start_date,
    endDate: ctx.args.proposed.end_date,
    billablePercentage: ctx.args.proposed.billable_percentage,
    rateCardId: ctx.args.proposed.rate_card_id ?? null,
  };
  return buildAssignmentCreatePlan(ctx, proposed, {
    enforceCapacity: false,
    capacityOverride: {
      reason: ctx.args.reason,
      by: ctx.principal.userId,
      at: ctx.now,
    },
  });
};

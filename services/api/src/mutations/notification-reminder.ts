import {
  deriveEffectiveRoles,
  resolvePolicyCell,
  type MutationArgs,
} from "@vulto/schema";
import { listSubmissionStatus } from "../permission/timesheet-queries.js";
import { weekStartForEmployee } from "../graph/timesheet-week.js";
import { db } from "../db.js";
import { withoutWriteScope } from "../graph/write-log.js";
import { deliverNotification } from "./notification-delivery.js";
import { MutationRejection, type ServerMutation } from "./types.js";

export const hrComplianceSendReminder: ServerMutation<
  MutationArgs<"hrCompliance.sendReminder">
> = async (ctx) => {
  // No Manager-only cell is Full-any; deriving stored roles needs no graph read.
  const allowed = deriveEffectiveRoles(ctx.principal.roles).some((role) => {
    const cell = resolvePolicyCell(role, "TimesheetEntry", "record");
    return cell.outcome === "full" && cell.scope === "any";
  });
  if (!allowed) throw new MutationRejection("role");
  const eligible = new Set(
    (
      await listSubmissionStatus(
        ctx.tx,
        ctx.principal,
        ctx.principal.workspaceId,
        ctx.args.week_start_date,
      )
    )
      .filter((row) => row.weekStatus === "Draft" || row.weekStatus === "Not-Started")
      .map((row) => row.employeeId),
  );
  if (ctx.args.employee_ids.some((id) => !eligible.has(id)))
    throw new MutationRejection("not-found");
  // Use the existing calendar-owned week identity, just as submitWeek does;
  // two dates within one week must not become two reminder dedupe keys.
  const weekStarts = new Map<string, string>();
  for (const employeeId of new Set(ctx.args.employee_ids)) {
    const weekStart = await weekStartForEmployee(
      ctx.tx,
      ctx.principal.workspaceId,
      employeeId,
      ctx.args.week_start_date,
    );
    if (weekStart === null) throw new MutationRejection("not-found");
    weekStarts.set(employeeId, weekStart);
  }
  return {
    checks: [],
    async validate() {},
    async apply() {
      return { result: { success: true }, changedRowIds: [] };
    },
    async afterCommit() {
      try {
        await withoutWriteScope(() =>
          db.transaction(async (tx) => {
            for (const employeeId of new Set(ctx.args.employee_ids)) {
              const weekStartDate = weekStarts.get(employeeId)!;
              await deliverNotification(
                tx,
                {
                  workspaceId: ctx.principal.workspaceId,
                  subjectEmployeeId: employeeId,
                  recipient: "employee-self",
                  sourceNodeType: "Employee",
                  sourceNodeId: employeeId,
                  ruleId: "timesheet-reminder",
                  dedupeKey: `timesheet-reminder:${employeeId}:${weekStartDate}:${ctx.now.slice(0, 10)}`,
                  category: "ActionNeeded",
                  message: `Please submit your timesheet for the week starting ${weekStartDate}.`,
                },
                ctx.now,
              );
            }
          }),
        );
      } catch (error) {
        console.error(
          "notification-delivery-failed",
          error instanceof Error ? error.name : "unknown-error",
        );
      }
    },
  };
};

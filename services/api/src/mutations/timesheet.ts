import {
  mutationDerivedId,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  validateTimeClassification,
  type JsonValue,
  type MutationArgs,
} from "@vulto/schema";
import { weekStartForEmployee } from "../graph/timesheet-week.js";
import { timesheetAnomalyEvaluate } from "./timesheet-anomaly.js";
import {
  getNode,
  getNodes,
  insertEdge,
  insertNode,
  outgoing,
  softDeleteNode,
  updateNodeFields,
  type StoredNode,
} from "../graph/store.js";
import {
  MutationRejection,
  type MutationContext,
  type Plan,
  type ServerMutation,
  type WriteCheck,
} from "./types.js";

const provenance = (ctx: MutationContext<unknown>) => ({
  workspaceId: ctx.principal.workspaceId,
  userId: ctx.principal.userId,
  now: ctx.now,
});

const nodeCheck = (
  ctx: MutationContext<unknown>,
  nodeType: "TimesheetEntry" | "TimesheetWeekSubmission",
  nodeId: string,
  operation: "create" | "update" | "remove",
  declaredSubjectEmployeeId?: string,
): WriteCheck => ({
  target: { kind: "node", workspaceId: ctx.principal.workspaceId, nodeType, nodeId },
  change: {
    operation,
    ...(declaredSubjectEmployeeId ? { declaredSubjectEmployeeId } : {}),
  },
});

const entriesFor = async (ctx: MutationContext<unknown>, employeeId: string) =>
  (
    await getNodes(ctx.tx, ctx.principal.workspaceId, { nodeType: "TimesheetEntry" })
  ).filter((entry) => entry.record["employee_id"] === employeeId);

const markersFor = async (ctx: MutationContext<unknown>, employeeId: string) =>
  (
    await getNodes(ctx.tx, ctx.principal.workspaceId, {
      nodeType: "TimesheetWeekSubmission",
    })
  ).filter((marker) => marker.record["employee_id"] === employeeId);

const cellMatches = (
  entry: StoredNode,
  args: MutationArgs<"timesheet.saveCell">,
): boolean => {
  if (entry.record["date"] !== args.date) return false;
  if (args.row_context.kind === "assignment")
    return entry.record["assignment_id"] === args.row_context.assignment_id;
  if (args.row_context.kind === "pitch")
    return entry.record["pitch_id"] === args.row_context.pitch_id;
  return entry.record["time_category"] === "NonBillable";
};

export const timesheetSaveCell: ServerMutation<
  MutationArgs<"timesheet.saveCell">
> = async (ctx) => {
  const { args } = ctx;
  const employee = await getNode(ctx.tx, ctx.principal.workspaceId, args.employee_id);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
    throw new MutationRejection("not-found");
  const weekStart = await weekStartForEmployee(
    ctx.tx,
    ctx.principal.workspaceId,
    args.employee_id,
    args.date,
  );
  if (weekStart === null) throw new MutationRejection("not-found");
  const entries = await entriesFor(ctx, args.employee_id);
  const existing = entries.find((entry) => cellMatches(entry, args)) ?? null;
  const entryId = existing?.nodeId ?? ctx.mutationId;
  const category =
    args.row_context.kind === "assignment"
      ? "Billable"
      : args.row_context.kind === "pitch"
        ? "Pitch"
        : "NonBillable";
  const assignmentId =
    args.row_context.kind === "assignment" ? args.row_context.assignment_id : null;
  const pitchId = args.row_context.kind === "pitch" ? args.row_context.pitch_id : null;
  const internalCategory = args.internal_category ?? null;
  const edgeId = mutationDerivedId(ctx.mutationId, 1);
  const checks: WriteCheck[] = [
    nodeCheck(
      ctx,
      "TimesheetEntry",
      entryId,
      existing ? "update" : "create",
      existing ? undefined : args.employee_id,
    ),
  ];
  if (!existing && args.row_context.kind !== "non-billable") {
    checks.push({
      target: {
        kind: "edge",
        workspaceId: ctx.principal.workspaceId,
        edgeType: "logged_against",
        edgeId,
        fromNodeType: "TimesheetEntry",
        fromNodeId: entryId,
        toNodeType: args.row_context.kind === "assignment" ? "Assignment" : "Pitch",
        toNodeId:
          args.row_context.kind === "assignment"
            ? args.row_context.assignment_id
            : args.row_context.pitch_id,
      },
      change: { operation: "create", declaredSubjectEmployeeId: args.employee_id },
    });
  }
  return {
    checks,
    async validate() {
      try {
        validateTimeClassification({
          time_category: category,
          internal_category: internalCategory,
          assignment_id: assignmentId,
          pitch_id: pitchId,
        });
      } catch {
        throw new MutationRejection("invalid-args");
      }
      const total = entries
        .filter(
          (entry) => entry.record["date"] === args.date && entry.nodeId !== entryId,
        )
        .reduce((sum, entry) => sum + Number(entry.record["hours"] ?? 0), args.hours);
      if (total > 24)
        throw new MutationRejection(`invalid-args:date=${args.date}:total=${total}`);
      if (assignmentId !== null) {
        const assignment = await getNode(
          ctx.tx,
          ctx.principal.workspaceId,
          assignmentId,
        );
        if (
          !assignment ||
          assignment.isSoftDeleted ||
          assignment.nodeType !== "Assignment" ||
          assignment.record["employee_id"] !== args.employee_id
        )
          throw new MutationRejection("invalid-args");
      }
      if (pitchId !== null) {
        const pitch = await getNode(ctx.tx, ctx.principal.workspaceId, pitchId);
        const staffed = (
          await outgoing(
            ctx.tx,
            ctx.principal.workspaceId,
            args.employee_id,
            "staffed_on",
            ctx.now,
          )
        ).some((edge) => edge.toNodeId === pitchId);
        if (!pitch || pitch.isSoftDeleted || pitch.nodeType !== "Pitch" || !staffed)
          throw new MutationRejection("invalid-args");
      }
    },
    async apply() {
      const fields = {
        employee_id: args.employee_id,
        assignment_id: assignmentId,
        pitch_id: pitchId,
        time_category: category,
        internal_category: internalCategory,
        date: args.date,
        hours: args.hours,
        week_start_date: weekStart,
        notes: args.notes ?? null,
      };
      if (existing) {
        await updateNodeFields(ctx.tx, ctx.principal.workspaceId, entryId, null, {
          ...fields,
          week_start_date: existing.record["week_start_date"],
          ...updateStamp("TimesheetEntry", provenance(ctx)),
        });
        return { result: { entryId }, changedRowIds: [entryId] };
      }
      await insertNode(
        ctx.tx,
        stampNewNode(
          {
            node_id: entryId,
            node_type: "TimesheetEntry",
            schema_version: 1,
            lifecycle_status: "Draft",
            submitted_at: null,
            ...fields,
          },
          "TimesheetEntry",
          provenance(ctx),
        ),
      );
      if (args.row_context.kind !== "non-billable") {
        await insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          stampNewEdge(
            {
              edge_id: edgeId,
              edge_type: "logged_against",
              from_node_id: entryId,
              to_node_id:
                args.row_context.kind === "assignment" ? assignmentId : pitchId,
              effective_from: ctx.now,
              effective_to: null,
            },
            provenance(ctx),
          ),
        );
      }
      return {
        result: { entryId },
        changedRowIds:
          args.row_context.kind === "non-billable" ? [entryId] : [entryId, edgeId],
      };
    },
  };
};

const weekPlan = async (
  ctx: MutationContext<MutationArgs<"timesheet.submitWeek">>,
  action: "submit" | "unlock",
): Promise<Plan> => {
  const weekStart = await weekStartForEmployee(
    ctx.tx,
    ctx.principal.workspaceId,
    ctx.args.employee_id,
    ctx.args.week_start_date,
  );
  if (weekStart === null) throw new MutationRejection("not-found");
  const allEntries = (await entriesFor(ctx, ctx.args.employee_id))
    .filter((entry) => entry.record["week_start_date"] === weekStart)
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const changing = allEntries.filter(
    (entry) => entry.lifecycleStatus === (action === "submit" ? "Draft" : "Submitted"),
  );
  const marker =
    (await markersFor(ctx, ctx.args.employee_id)).find(
      (row) => row.record["week_start_date"] === weekStart,
    ) ?? null;
  const createMarker =
    action === "submit" && allEntries.length === 0 && marker === null;
  const checks: WriteCheck[] = changing.map((entry) =>
    nodeCheck(ctx, "TimesheetEntry", entry.nodeId, "update"),
  );
  if (createMarker)
    checks.push(
      nodeCheck(
        ctx,
        "TimesheetWeekSubmission",
        ctx.mutationId,
        "create",
        ctx.args.employee_id,
      ),
    );
  if (action === "unlock" && marker)
    checks.push(nodeCheck(ctx, "TimesheetWeekSubmission", marker.nodeId, "remove"));
  return {
    checks,
    async validate() {},
    ...(action === "submit"
      ? {
          afterCommit: async () => {
            await timesheetAnomalyEvaluate(
              ctx.principal.workspaceId,
              ctx.args.employee_id,
              weekStart,
              ctx.now,
            );
          },
        }
      : {}),
    async apply() {
      const changedRowIds: string[] = [];
      for (const entry of changing) {
        await updateNodeFields(ctx.tx, ctx.principal.workspaceId, entry.nodeId, null, {
          lifecycle_status: action === "submit" ? "Submitted" : "Draft",
          submitted_at: action === "submit" ? ctx.now : null,
          ...updateStamp("TimesheetEntry", provenance(ctx)),
        });
        changedRowIds.push(entry.nodeId);
      }
      if (createMarker) {
        await insertNode(
          ctx.tx,
          stampNewNode(
            {
              node_id: ctx.mutationId,
              node_type: "TimesheetWeekSubmission",
              schema_version: 1,
              lifecycle_status: "Submitted",
              employee_id: ctx.args.employee_id,
              week_start_date: weekStart,
              submitted_at: ctx.now,
            },
            "TimesheetWeekSubmission",
            provenance(ctx),
          ),
        );
        changedRowIds.push(ctx.mutationId);
      }
      if (action === "unlock" && marker) {
        await softDeleteNode(ctx.tx, ctx.principal.workspaceId, marker.nodeId, {
          userId: ctx.principal.userId,
          at: ctx.now,
        });
        changedRowIds.push(marker.nodeId);
      }
      const result: JsonValue =
        action === "submit"
          ? { success: true, entriesLocked: changing.length }
          : { success: true };
      return { result, changedRowIds };
    },
  };
};

export const timesheetSubmitWeek: ServerMutation<
  MutationArgs<"timesheet.submitWeek">
> = (ctx) => weekPlan(ctx, "submit");
export const timesheetUnlockWeek: ServerMutation<
  MutationArgs<"timesheet.unlockWeek">
> = (ctx) => weekPlan(ctx, "unlock");

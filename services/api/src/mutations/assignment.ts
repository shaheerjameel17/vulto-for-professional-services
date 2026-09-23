import {
  mutationDerivedId,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type MutationArgs,
} from "@vulto/schema";
import {
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
  ConflictError,
  MutationRejection,
  type MutationContext,
  type ServerMutation,
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

const assignmentTarget = (ctx: MutationContext<unknown>, nodeId: string) => ({
  kind: "node" as const,
  workspaceId: ctx.principal.workspaceId,
  nodeType: "Assignment" as const,
  nodeId,
});

const edgeTarget = (
  ctx: MutationContext<unknown>,
  edgeType: "assignment_of" | "assigned_to",
  toNodeType: "Employee" | "Project",
  edgeId: string,
) => ({
  kind: "edge" as const,
  workspaceId: ctx.principal.workspaceId,
  edgeType,
  fromNodeType: "Assignment" as const,
  toNodeType,
  edgeId,
});

async function requireNode(
  ctx: MutationContext<unknown>,
  id: string,
  nodeType: "Employee" | "Project" | "Assignment",
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, id);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (node.nodeType !== nodeType) throw new MutationRejection("invalid-args");
  return node;
}

const eachDate = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (const cursor = new Date(`${from}T00:00:00.000Z`); ;) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > to) break;
    out.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
};

async function validateCapacity(
  ctx: MutationContext<unknown>,
  input: {
    readonly employeeId: string;
    readonly startDate: string;
    readonly endDate: string;
    readonly attempted: number;
    readonly excludeAssignmentId?: string;
  },
): Promise<void> {
  const active = (
    await getNodes(ctx.tx, ctx.principal.workspaceId, {
      nodeType: "Assignment",
      lifecycleStatus: "Active",
    })
  ).filter(
    (assignment) =>
      assignment.nodeId !== input.excludeAssignmentId &&
      assignment.record["employee_id"] === input.employeeId,
  );
  for (const date of eachDate(input.startDate, input.endDate)) {
    const currentTotal = active.reduce((total, assignment) => {
      const start = String(assignment.record["start_date"]);
      const end = String(assignment.record["end_date"]);
      return start <= date && date <= end
        ? total + Number(assignment.record["billable_percentage"] ?? 0)
        : total;
    }, 0);
    if (currentTotal + input.attempted > 100) {
      throw new ConflictError(currentTotal, input.attempted);
    }
  }
}

export const assignmentCreate: ServerMutation<
  MutationArgs<"assignment.create">
> = async (ctx) => {
  const employee = await requireNode(ctx, ctx.args.employee_id, "Employee");
  const project = await requireNode(ctx, ctx.args.project_id, "Project");
  const assignmentId = ctx.mutationId;
  const employeeEdgeId = mutationDerivedId(ctx.mutationId, 1);
  const projectEdgeId = mutationDerivedId(ctx.mutationId, 2);
  return {
    checks: [
      { target: assignmentTarget(ctx, assignmentId), change: { operation: "create" } },
      {
        target: edgeTarget(ctx, "assignment_of", "Employee", employeeEdgeId),
        change: { operation: "create" },
      },
      {
        target: edgeTarget(ctx, "assigned_to", "Project", projectEdgeId),
        change: { operation: "create" },
      },
    ],
    async validate() {
      await validateCapacity(ctx, {
        employeeId: employee.nodeId,
        startDate: ctx.args.start_date,
        endDate: ctx.args.end_date,
        attempted: ctx.args.billable_percentage,
      });
    },
    async apply() {
      const assignment = await translate(() =>
        insertNode(
          ctx.tx,
          stampNewNode(
            {
              node_id: assignmentId,
              node_type: "Assignment",
              schema_version: 1,
              lifecycle_status: "Active",
              employee_id: employee.nodeId,
              project_id: project.nodeId,
              start_date: ctx.args.start_date,
              end_date: ctx.args.end_date,
              billable_percentage: ctx.args.billable_percentage,
              rate_card_id: ctx.args.rate_card_id ?? null,
              rate_override_hourly: null,
              rate_override_reason: null,
              effective_billing_rate:
                (employee.record["billing_rate_default"] as
                  number | null | undefined) ?? null,
              capacity_override_reason: null,
              capacity_override_by: null,
              capacity_override_at: null,
            },
            "Assignment",
            provenance(ctx),
          ),
        ),
      );
      await translate(() =>
        insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          stampNewEdge(
            {
              edge_id: employeeEdgeId,
              edge_type: "assignment_of",
              from_node_id: assignment.nodeId,
              to_node_id: employee.nodeId,
              effective_from: `${ctx.args.start_date}T00:00:00.000Z`,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      await translate(() =>
        insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          stampNewEdge(
            {
              edge_id: projectEdgeId,
              edge_type: "assigned_to",
              from_node_id: assignment.nodeId,
              to_node_id: project.nodeId,
              effective_from: `${ctx.args.start_date}T00:00:00.000Z`,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      return {
        result: { assignment_id: assignment.nodeId },
        changedRowIds: [assignment.nodeId, employeeEdgeId, projectEdgeId],
      };
    },
  };
};

export const assignmentUpdate: ServerMutation<
  MutationArgs<"assignment.update">
> = async (ctx) => {
  const assignment = await requireNode(ctx, ctx.args.assignment_id, "Assignment");
  const startDate =
    ctx.args.fields.start_date ?? String(assignment.record["start_date"]);
  const endDate = ctx.args.fields.end_date ?? String(assignment.record["end_date"]);
  const attempted =
    ctx.args.fields.billable_percentage ??
    Number(assignment.record["billable_percentage"]);
  return {
    checks: [
      {
        target: assignmentTarget(ctx, assignment.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (endDate < startDate) throw new MutationRejection("invalid-args");
      if (assignment.lifecycleStatus !== "Active")
        throw new MutationRejection("not-found");
      await validateCapacity(ctx, {
        employeeId: String(assignment.record["employee_id"]),
        startDate,
        endDate,
        attempted,
        excludeAssignmentId: assignment.nodeId,
      });
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(ctx.tx, ctx.principal.workspaceId, assignment.nodeId, null, {
          ...ctx.args.fields,
          ...updateStamp("Assignment", provenance(ctx)),
        }),
      );
      return {
        result: { success: true, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

export const assignmentCancel: ServerMutation<
  MutationArgs<"assignment.cancel">
> = async (ctx) => {
  const assignment = await requireNode(ctx, ctx.args.assignment_id, "Assignment");
  return {
    checks: [
      {
        target: assignmentTarget(ctx, assignment.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (assignment.version !== ctx.args.expected_version)
        throw new MutationRejection("stale-state");
      if (assignment.lifecycleStatus !== "Active")
        throw new MutationRejection("invalid-transition");
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          assignment.nodeId,
          ctx.args.expected_version,
          {
            lifecycle_status: "Canceled",
            ...updateStamp("Assignment", provenance(ctx)),
          },
        ),
      );
      return {
        result: { success: true, version: updated.version },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

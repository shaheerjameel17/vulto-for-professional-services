import {
  mutationDerivedId,
  resolveAssignmentRate,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type MutationArgs,
  type SeniorityLevel,
} from "@vulto/schema";
import { getKeyServices } from "../crypto/keys.js";
import {
  closeEdge,
  getNode,
  getNodes,
  GraphNotFoundError,
  GraphValidationError,
  insertEdge,
  insertNode,
  outgoing,
  StaleVersionError,
  updateNodeFields,
  type StoredNode,
} from "../graph/store.js";
import { readRateCardLine } from "../permission/rate-card-queries.js";
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
  edgeType: "assignment_of" | "assigned_to" | "governed_by",
  toNodeType: "Employee" | "Project" | "RateCard",
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
  nodeType: "Employee" | "Project" | "Assignment" | "RateCard",
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, id);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (node.nodeType !== nodeType) throw new MutationRejection("invalid-args");
  return node;
}

async function resolvedRate(
  ctx: MutationContext<unknown>,
  input: {
    readonly employee: StoredNode;
    readonly rateCardId: string | null;
    readonly overrideHourly: number | null;
  },
): Promise<number | null> {
  if (input.overrideHourly !== null) {
    return resolveAssignmentRate({
      overrideHourly: input.overrideHourly,
      cardHourlyRate: null,
      billingRateDefault:
        (input.employee.record["billing_rate_default"] as number | null | undefined) ??
        null,
    });
  }
  const seniority = input.employee.record["seniority_level"] as
    SeniorityLevel | null | undefined;
  const line =
    input.rateCardId !== null && seniority
      ? await readRateCardLine(
          ctx.tx,
          getKeyServices(),
          ctx.principal,
          input.rateCardId,
          seniority,
        )
      : null;
  return resolveAssignmentRate({
    overrideHourly: input.overrideHourly,
    cardHourlyRate: line?.hourly_rate ?? null,
    billingRateDefault:
      (input.employee.record["billing_rate_default"] as number | null | undefined) ??
      null,
  });
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
  const rateCard =
    ctx.args.rate_card_id === null || ctx.args.rate_card_id === undefined
      ? null
      : await requireNode(ctx, ctx.args.rate_card_id, "RateCard");
  const rateCardEdgeId = mutationDerivedId(ctx.mutationId, 3);
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
      ...(rateCard
        ? [
            {
              target: edgeTarget(ctx, "governed_by", "RateCard", rateCardEdgeId),
              change: { operation: "create" as const },
            },
          ]
        : []),
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
      const effectiveBillingRate = await resolvedRate(ctx, {
        employee,
        rateCardId: rateCard?.nodeId ?? null,
        overrideHourly: null,
      });
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
              effective_billing_rate: effectiveBillingRate,
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
      if (rateCard) {
        await translate(() =>
          insertEdge(
            ctx.tx,
            ctx.principal.workspaceId,
            stampNewEdge(
              {
                edge_id: rateCardEdgeId,
                edge_type: "governed_by",
                from_node_id: assignment.nodeId,
                to_node_id: rateCard.nodeId,
                effective_from: ctx.now,
                effective_to: null,
              },
              provenance(ctx),
            ),
          ),
        );
      }
      return {
        result: {
          assignment_id: assignment.nodeId,
          effective_billing_rate: effectiveBillingRate,
        },
        changedRowIds: [
          assignment.nodeId,
          employeeEdgeId,
          projectEdgeId,
          ...(rateCard ? [rateCardEdgeId] : []),
        ],
      };
    },
  };
};

export const assignmentSetRateCard: ServerMutation<
  MutationArgs<"assignment.setRateCard">
> = async (ctx) => {
  const assignment = await requireNode(ctx, ctx.args.assignment_id, "Assignment");
  const rateCard = await requireNode(ctx, ctx.args.rate_card_id, "RateCard");
  const employee = await requireNode(
    ctx,
    String(assignment.record["employee_id"]),
    "Employee",
  );
  const prior = (
    await outgoing(ctx.tx, ctx.principal.workspaceId, assignment.nodeId, "governed_by")
  ).find((edge) => edge.effectiveTo === null);
  const edgeId = mutationDerivedId(ctx.mutationId, 1);
  return {
    checks: [
      {
        target: assignmentTarget(ctx, assignment.nodeId),
        change: { operation: "update" },
      },
      ...(prior
        ? [
            {
              target: edgeTarget(ctx, "governed_by", "RateCard", prior.edgeId),
              change: { operation: "update" as const },
            },
          ]
        : []),
      {
        target: edgeTarget(ctx, "governed_by", "RateCard", edgeId),
        change: { operation: "create" },
      },
    ],
    async validate() {
      if (assignment.lifecycleStatus !== "Active")
        throw new MutationRejection("not-found");
      if (assignment.record["rate_card_id"] === rateCard.nodeId)
        throw new MutationRejection("no-change");
    },
    async apply() {
      const effectiveBillingRate = await resolvedRate(ctx, {
        employee,
        rateCardId: rateCard.nodeId,
        overrideHourly:
          (assignment.record["rate_override_hourly"] as number | null | undefined) ??
          null,
      });
      const updated = await translate(() =>
        updateNodeFields(ctx.tx, ctx.principal.workspaceId, assignment.nodeId, null, {
          rate_card_id: rateCard.nodeId,
          effective_billing_rate: effectiveBillingRate,
          ...updateStamp("Assignment", provenance(ctx)),
        }),
      );
      const changed = [updated.nodeId];
      if (prior) {
        const closed = await translate(() =>
          closeEdge(ctx.tx, ctx.principal.workspaceId, prior.edgeId, ctx.now, {
            userId: ctx.principal.userId,
            at: ctx.now,
          }),
        );
        changed.push(closed.edgeId);
      }
      await translate(() =>
        insertEdge(
          ctx.tx,
          ctx.principal.workspaceId,
          stampNewEdge(
            {
              edge_id: edgeId,
              edge_type: "governed_by",
              from_node_id: assignment.nodeId,
              to_node_id: rateCard.nodeId,
              effective_from: ctx.now,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      changed.push(edgeId);
      return {
        result: { effective_billing_rate: effectiveBillingRate },
        changedRowIds: changed,
      };
    },
  };
};

export const assignmentSetRateOverride: ServerMutation<
  MutationArgs<"assignment.setRateOverride">
> = async (ctx) => {
  const assignment = await requireNode(ctx, ctx.args.assignment_id, "Assignment");
  const employee = await requireNode(
    ctx,
    String(assignment.record["employee_id"]),
    "Employee",
  );
  return {
    checks: [
      {
        target: assignmentTarget(ctx, assignment.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (assignment.lifecycleStatus !== "Active")
        throw new MutationRejection("not-found");
    },
    async apply() {
      const effectiveBillingRate = await resolvedRate(ctx, {
        employee,
        rateCardId:
          (assignment.record["rate_card_id"] as string | null | undefined) ?? null,
        overrideHourly: ctx.args.hourly,
      });
      const updated = await translate(() =>
        updateNodeFields(ctx.tx, ctx.principal.workspaceId, assignment.nodeId, null, {
          rate_override_hourly: ctx.args.hourly,
          rate_override_reason: ctx.args.reason,
          effective_billing_rate: effectiveBillingRate,
          ...updateStamp("Assignment", provenance(ctx)),
        }),
      );
      return {
        result: { effective_billing_rate: effectiveBillingRate },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

export const assignmentClearRateOverride: ServerMutation<
  MutationArgs<"assignment.clearRateOverride">
> = async (ctx) => {
  const assignment = await requireNode(ctx, ctx.args.assignment_id, "Assignment");
  const employee = await requireNode(
    ctx,
    String(assignment.record["employee_id"]),
    "Employee",
  );
  return {
    checks: [
      {
        target: assignmentTarget(ctx, assignment.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (assignment.lifecycleStatus !== "Active")
        throw new MutationRejection("not-found");
      if (assignment.record["rate_override_hourly"] === null)
        throw new MutationRejection("no-change");
    },
    async apply() {
      const effectiveBillingRate = await resolvedRate(ctx, {
        employee,
        rateCardId:
          (assignment.record["rate_card_id"] as string | null | undefined) ?? null,
        overrideHourly: null,
      });
      const updated = await translate(() =>
        updateNodeFields(ctx.tx, ctx.principal.workspaceId, assignment.nodeId, null, {
          rate_override_hourly: null,
          rate_override_reason: null,
          effective_billing_rate: effectiveBillingRate,
          ...updateStamp("Assignment", provenance(ctx)),
        }),
      );
      return {
        result: { effective_billing_rate: effectiveBillingRate },
        changedRowIds: [updated.nodeId],
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

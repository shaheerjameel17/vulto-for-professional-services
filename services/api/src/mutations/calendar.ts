import {
  initialCalendarEdgeId,
  initialCalendarId,
  initialWorkingWeekFor,
  moveEmployeeEdgeId,
  mutationDerivedId,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type MutationArgs,
  type ReducedHoursPeriod,
} from "@vulto/schema";
import {
  getNode,
  getNodes,
  incoming,
  insertEdge,
  insertNode,
  outgoing,
  updateNodeFields,
  GraphNotFoundError,
  GraphValidationError,
  StaleVersionError,
  type GraphTx,
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
const atMidnight = (date: string) => `${date}T00:00:00.000Z`;

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

const nodeTarget = (
  ctx: MutationContext<unknown>,
  nodeType: "WorkingCalendar" | "Holiday" | "WorkingPattern",
  nodeId: string | null,
) => ({
  kind: "node" as const,
  workspaceId: ctx.principal.workspaceId,
  nodeType,
  nodeId,
});
const edgeTarget = (
  ctx: MutationContext<unknown>,
  edgeType: "governed_by_calendar" | "holiday_in" | "pattern_for" | "supersedes",
  fromNodeType: "Entity" | "Holiday" | "WorkingPattern" | "WorkingCalendar",
  toNodeType: "WorkingCalendar" | "Employee",
  edgeId: string | null,
) => ({
  kind: "edge" as const,
  workspaceId: ctx.principal.workspaceId,
  edgeType,
  fromNodeType,
  toNodeType,
  edgeId,
});

async function requireNode(
  ctx: MutationContext<unknown>,
  id: string,
  type: "WorkingCalendar" | "Holiday" | "WorkingPattern" | "Employee",
): Promise<StoredNode> {
  const node = await getNode(ctx.tx, ctx.principal.workspaceId, id);
  if (!node) throw new MutationRejection("not-found");
  if (node.isSoftDeleted) throw new MutationRejection("target-deleted");
  if (node.nodeType !== type) throw new MutationRejection("invalid-args");
  return node;
}

export interface InitialCalendarInput {
  readonly workspaceId: string;
  readonly entityId: string;
  readonly jurisdiction: string;
  readonly userId: string;
  readonly now: string;
  readonly calendarId: string;
  readonly edgeId: string;
}

/** F227/F233: both Entity creation paths use this one atomic server helper. */
export async function createInitialCalendar(
  tx: GraphTx,
  input: InitialCalendarInput,
): Promise<{ calendarId: string; edgeId: string }> {
  const template = initialWorkingWeekFor(input.jurisdiction);
  await insertNode(
    tx,
    stampNewNode(
      {
        node_id: input.calendarId,
        node_type: "WorkingCalendar",
        schema_version: 1,
        lifecycle_status: "Active",
        entity_id: input.entityId,
        name: `${input.jurisdiction} working calendar`,
        ...template,
        reduced_hours_periods: [],
      },
      "WorkingCalendar",
      { workspaceId: input.workspaceId, userId: input.userId, now: input.now },
    ),
  );
  await insertEdge(
    tx,
    input.workspaceId,
    stampNewEdge(
      {
        edge_id: input.edgeId,
        edge_type: "governed_by_calendar",
        from_node_id: input.entityId,
        to_node_id: input.calendarId,
        effective_from: input.now,
        effective_to: null,
      },
      { workspaceId: input.workspaceId, userId: input.userId, now: input.now },
    ),
  );
  return { calendarId: input.calendarId, edgeId: input.edgeId };
}

async function calendarEntity(
  ctx: MutationContext<unknown>,
  calendarId: string,
): Promise<string | null> {
  return (
    (
      await incoming(
        ctx.tx,
        ctx.principal.workspaceId,
        calendarId,
        "governed_by_calendar",
      )
    )[0]?.fromNodeId ?? null
  );
}

async function holidayCalendar(
  ctx: MutationContext<unknown>,
  holidayId: string,
): Promise<StoredNode | null> {
  const edge = (
    await outgoing(ctx.tx, ctx.principal.workspaceId, holidayId, "holiday_in")
  )[0];
  return edge ? getNode(ctx.tx, ctx.principal.workspaceId, edge.toNodeId) : null;
}

async function currentPattern(
  ctx: MutationContext<unknown>,
  employeeId: string,
): Promise<StoredNode | null> {
  const edges = await incoming(
    ctx.tx,
    ctx.principal.workspaceId,
    employeeId,
    "pattern_for",
  );
  for (const edge of edges) {
    const node = await getNode(ctx.tx, ctx.principal.workspaceId, edge.fromNodeId);
    if (
      node &&
      !node.isSoftDeleted &&
      node.nodeType === "WorkingPattern" &&
      node.lifecycleStatus === "Active"
    )
      return node;
  }
  return null;
}

export const calendarUpdate: ServerMutation<MutationArgs<"calendar.update">> = async (
  ctx,
) => {
  const prior = await requireNode(ctx, ctx.args.calendar_id, "WorkingCalendar");
  const entityId = await calendarEntity(ctx, prior.nodeId);
  if (!entityId) throw new MutationRejection("not-found");
  const holidays = (
    await getNodes(ctx.tx, ctx.principal.workspaceId, {
      nodeType: "Holiday",
      lifecycleStatus: "Active",
    })
  )
    .filter((node) => node.record["calendar_id"] === prior.nodeId)
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const nextId = ctx.mutationId;
  const governedEdgeId = mutationDerivedId(ctx.mutationId, 1);
  const supersedesEdgeId = mutationDerivedId(ctx.mutationId, 2);
  const checks: WriteCheck[] = [
    {
      target: nodeTarget(ctx, "WorkingCalendar", prior.nodeId),
      change: { operation: "update" },
    },
    {
      target: nodeTarget(ctx, "WorkingCalendar", nextId),
      change: { operation: "create" },
    },
    {
      target: edgeTarget(
        ctx,
        "governed_by_calendar",
        "Entity",
        "WorkingCalendar",
        governedEdgeId,
      ),
      change: { operation: "create" },
    },
    {
      target: edgeTarget(
        ctx,
        "supersedes",
        "WorkingCalendar",
        "WorkingCalendar",
        supersedesEdgeId,
      ),
      change: { operation: "create" },
    },
  ];
  holidays.forEach((holiday, index) => {
    checks.push({
      target: nodeTarget(
        ctx,
        "Holiday",
        mutationDerivedId(ctx.mutationId, 10 + index * 2),
      ),
      change: { operation: "create" },
    });
    checks.push({
      target: edgeTarget(
        ctx,
        "holiday_in",
        "Holiday",
        "WorkingCalendar",
        mutationDerivedId(ctx.mutationId, 11 + index * 2),
      ),
      change: { operation: "create" },
    });
  });
  return {
    checks,
    async validate() {
      if (ctx.args.expected_version !== prior.version)
        throw new MutationRejection("stale-state");
      if (prior.lifecycleStatus !== "Active") throw new MutationRejection("not-found");
    },
    async apply() {
      const nextPeriods =
        ctx.args.reduced_hours_periods ??
        (prior.record["reduced_hours_periods"] as ReducedHoursPeriod[] | undefined) ??
        [];
      await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          prior.nodeId,
          ctx.args.expected_version,
          {
            lifecycle_status: "Superseded",
            ...updateStamp("WorkingCalendar", provenance(ctx)),
          },
        ),
      );
      await translate(() =>
        insertNode(
          ctx.tx,
          stampNewNode(
            {
              ...prior.record,
              node_id: nextId,
              lifecycle_status: "Active",
              working_week: ctx.args.working_week,
              standard_daily_hours: ctx.args.daily_hours,
              reduced_hours_periods: nextPeriods,
            },
            "WorkingCalendar",
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
              edge_id: governedEdgeId,
              edge_type: "governed_by_calendar",
              from_node_id: entityId,
              to_node_id: nextId,
              effective_from: ctx.now,
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
              edge_id: supersedesEdgeId,
              edge_type: "supersedes",
              from_node_id: nextId,
              to_node_id: prior.nodeId,
              effective_from: ctx.now,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      const changed = [prior.nodeId, nextId, governedEdgeId, supersedesEdgeId];
      for (const [index, holiday] of holidays.entries()) {
        const holidayId = mutationDerivedId(ctx.mutationId, 10 + index * 2);
        const edgeId = mutationDerivedId(ctx.mutationId, 11 + index * 2);
        await translate(() =>
          insertNode(
            ctx.tx,
            stampNewNode(
              {
                ...holiday.record,
                node_id: holidayId,
                calendar_id: nextId,
                lifecycle_status: "Active",
              },
              "Holiday",
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
                edge_id: edgeId,
                edge_type: "holiday_in",
                from_node_id: holidayId,
                to_node_id: nextId,
                effective_from: ctx.now,
                effective_to: null,
              },
              provenance(ctx),
            ),
          ),
        );
        changed.push(holidayId, edgeId);
      }
      return { result: { calendar_id: nextId }, changedRowIds: changed };
    },
  };
};

export const holidayAdd: ServerMutation<MutationArgs<"holiday.add">> = async (ctx) => {
  const calendar = await requireNode(ctx, ctx.args.calendar_id, "WorkingCalendar");
  const holidayId = ctx.mutationId;
  const edgeId = moveEmployeeEdgeId(ctx.mutationId);
  return {
    checks: [
      {
        target: nodeTarget(ctx, "Holiday", holidayId),
        change: { operation: "create" },
      },
      {
        target: edgeTarget(ctx, "holiday_in", "Holiday", "WorkingCalendar", edgeId),
        change: { operation: "create" },
      },
    ],
    async validate() {
      if (calendar.lifecycleStatus !== "Active")
        throw new MutationRejection("not-found");
    },
    async apply() {
      const date = ctx.args.fields.date ?? ctx.args.fields.estimated_date!;
      await translate(() =>
        insertNode(
          ctx.tx,
          stampNewNode(
            {
              node_id: holidayId,
              node_type: "Holiday",
              schema_version: 1,
              lifecycle_status: "Active",
              calendar_id: calendar.nodeId,
              ...ctx.args.fields,
              date,
              confirmed_at: null,
              confirmed_by: null,
            },
            "Holiday",
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
              edge_id: edgeId,
              edge_type: "holiday_in",
              from_node_id: holidayId,
              to_node_id: calendar.nodeId,
              effective_from: ctx.now,
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      return { result: { holiday_id: holidayId }, changedRowIds: [holidayId, edgeId] };
    },
  };
};

export const holidayConfirm: ServerMutation<MutationArgs<"holiday.confirm">> = async (
  ctx,
) => {
  const holiday = await requireNode(ctx, ctx.args.holiday_id, "Holiday");
  const calendar = await holidayCalendar(ctx, holiday.nodeId);
  return {
    checks: [
      {
        target: nodeTarget(ctx, "Holiday", holiday.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (!calendar || calendar.lifecycleStatus !== "Active")
        throw new MutationRejection("not-found");
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(ctx.tx, ctx.principal.workspaceId, holiday.nodeId, null, {
          date: ctx.args.actual_date,
          is_provisional: false,
          confirmed_at: ctx.now,
          confirmed_by: ctx.principal.userId,
          ...updateStamp("Holiday", provenance(ctx)),
        }),
      );
      return {
        result: {
          success: true,
          affected_range: [String(holiday.record["date"]), ctx.args.actual_date],
        },
        changedRowIds: [updated.nodeId],
      };
    },
  };
};

export const holidayCancel: ServerMutation<MutationArgs<"holiday.cancel">> = async (
  ctx,
) => {
  const holiday = await requireNode(ctx, ctx.args.holiday_id, "Holiday");
  const calendar = await holidayCalendar(ctx, holiday.nodeId);
  return {
    checks: [
      {
        target: nodeTarget(ctx, "Holiday", holiday.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (ctx.args.expected_version !== holiday.version)
        throw new MutationRejection("stale-state");
      if (!calendar || calendar.lifecycleStatus !== "Active")
        throw new MutationRejection("not-found");
    },
    async apply() {
      const updated = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          holiday.nodeId,
          ctx.args.expected_version,
          { lifecycle_status: "Canceled", ...updateStamp("Holiday", provenance(ctx)) },
        ),
      );
      return { result: { success: true }, changedRowIds: [updated.nodeId] };
    },
  };
};

export const patternSet: ServerMutation<MutationArgs<"pattern.set">> = async (ctx) => {
  await requireNode(ctx, ctx.args.employee_id, "Employee");
  const prior = await currentPattern(ctx, ctx.args.employee_id);
  const patternId = ctx.mutationId;
  const edgeId = moveEmployeeEdgeId(ctx.mutationId);
  const checks: WriteCheck[] = [
    ...(prior
      ? [
          {
            target: nodeTarget(ctx, "WorkingPattern", prior.nodeId),
            change: { operation: "update" as const },
          },
        ]
      : []),
    {
      target: nodeTarget(ctx, "WorkingPattern", patternId),
      change: { operation: "create" },
    },
    {
      target: edgeTarget(ctx, "pattern_for", "WorkingPattern", "Employee", edgeId),
      change: { operation: "create" },
    },
  ];
  return {
    checks,
    async validate() {
      if (prior) {
        if (ctx.args.expected_version !== prior.version)
          throw new MutationRejection("stale-state");
        if (ctx.args.effective_from < String(prior.record["effective_from"]))
          throw new MutationRejection("invalid-args");
      } else if (ctx.args.expected_version !== undefined)
        throw new MutationRejection("stale-state");
    },
    async apply() {
      const changed: string[] = [];
      if (prior) {
        const closed = await translate(() =>
          updateNodeFields(
            ctx.tx,
            ctx.principal.workspaceId,
            prior.nodeId,
            ctx.args.expected_version!,
            {
              lifecycle_status: "Superseded",
              effective_to: ctx.args.effective_from,
              ...updateStamp("WorkingPattern", provenance(ctx)),
            },
          ),
        );
        changed.push(closed.nodeId);
      }
      await translate(() =>
        insertNode(
          ctx.tx,
          stampNewNode(
            {
              node_id: patternId,
              node_type: "WorkingPattern",
              schema_version: 1,
              lifecycle_status: "Active",
              employee_id: ctx.args.employee_id,
              working_week: ctx.args.working_week,
              effective_from: ctx.args.effective_from,
              effective_to: null,
            },
            "WorkingPattern",
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
              edge_id: edgeId,
              edge_type: "pattern_for",
              from_node_id: patternId,
              to_node_id: ctx.args.employee_id,
              effective_from: atMidnight(ctx.args.effective_from),
              effective_to: null,
            },
            provenance(ctx),
          ),
        ),
      );
      changed.push(patternId, edgeId);
      return { result: { pattern_id: patternId }, changedRowIds: changed };
    },
  };
};

export const patternClear: ServerMutation<MutationArgs<"pattern.clear">> = async (
  ctx,
) => {
  await requireNode(ctx, ctx.args.employee_id, "Employee");
  const prior = await currentPattern(ctx, ctx.args.employee_id);
  if (!prior) throw new MutationRejection("not-found");
  return {
    checks: [
      {
        target: nodeTarget(ctx, "WorkingPattern", prior.nodeId),
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (ctx.args.expected_version !== prior.version)
        throw new MutationRejection("stale-state");
      if (ctx.args.effective_from < String(prior.record["effective_from"]))
        throw new MutationRejection("invalid-args");
    },
    async apply() {
      const closed = await translate(() =>
        updateNodeFields(
          ctx.tx,
          ctx.principal.workspaceId,
          prior.nodeId,
          ctx.args.expected_version,
          {
            lifecycle_status: "Superseded",
            effective_to: ctx.args.effective_from,
            ...updateStamp("WorkingPattern", provenance(ctx)),
          },
        ),
      );
      return { result: { success: true }, changedRowIds: [closed.nodeId] };
    },
  };
};

export { initialCalendarId, initialCalendarEdgeId };

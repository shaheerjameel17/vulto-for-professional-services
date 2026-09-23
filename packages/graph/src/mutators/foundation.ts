import {
  MUTATIONS,
  employeeOperationalRecord,
  employeeTransitionOutcome,
  FEATURE_LIFECYCLE_NODE_TYPES,
  getMutationDefinition,
  isNodeType,
  isTier0Only,
  initialCalendarEdgeId,
  initialCalendarId,
  initialWorkingWeekFor,
  moveEmployeeEdgeId,
  mutationDerivedId,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  wouldCreateCycle,
  type MutationName,
  type NodeType,
} from "@vulto/schema";
import type { CachedEdge, CachedNode, OptimisticCache, UndoEntry } from "./cache";

/**
 * The optimistic halves of the foundation mutations (A003-T53). Each applies a
 * mutation's effect to the device cache at once and returns the before-images
 * that revert it. They decide nothing about access: the client may hide an
 * action a person cannot take, never grant one, and the server's answer is
 * final. They do share the definition's input schema, the provenance stamps and
 * the Tier 0 and loop rules with the server, so what shows here is what
 * replication later delivers.
 */

/** A refusal decided locally, before the mutation is queued. */
export class OptimisticRejection extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "OptimisticRejection";
  }
}

export interface MutatorContext {
  readonly cache: OptimisticCache;
  readonly workspaceId: string;
  readonly userId: string;
  readonly mutationId: string;
  /** UTC ISO-8601 time for provenance stamps. */
  readonly now: string;
}

export type OptimisticMutator = (
  context: MutatorContext,
  args: unknown,
) => Promise<UndoEntry[]>;

const provenance = (c: MutatorContext) => ({
  workspaceId: c.workspaceId,
  userId: c.userId,
  now: c.now,
});

const toCachedNode = (
  record: Record<string, unknown>,
  version: number,
): CachedNode => ({
  nodeId: String(record["node_id"]),
  nodeType: String(record["node_type"]),
  lifecycleStatus: String(record["lifecycle_status"]),
  isSoftDeleted: record["is_soft_deleted"] === true,
  version,
  record,
});

const toCachedEdge = (
  record: Record<string, unknown>,
  version: number,
): CachedEdge => ({
  edgeId: String(record["edge_id"]),
  edgeType: String(record["edge_type"]),
  fromNodeId: String(record["from_node_id"]),
  toNodeId: String(record["to_node_id"]),
  effectiveFrom: (record["effective_from"] as string | null) ?? null,
  effectiveTo: (record["effective_to"] as string | null) ?? null,
  isSoftDeleted: record["is_soft_deleted"] === true,
  version,
  record,
});

async function liveNode(cache: OptimisticCache, nodeId: string): Promise<CachedNode> {
  const node = await cache.getNode(nodeId);
  if (!node) throw new OptimisticRejection("not-found");
  if (node.isSoftDeleted) throw new OptimisticRejection("target-deleted");
  return node;
}

function parse<Name extends MutationName>(name: Name, args: unknown) {
  const parsed = MUTATIONS[name].input.safeParse(args);
  if (!parsed.success) throw new OptimisticRejection("invalid-args");
  return parsed.data as never as Record<string, unknown> &
    import("@vulto/schema").MutationArgs<Name>;
}

/** Applies a new version of a node, returning what it replaced. */
async function writeNode(
  cache: OptimisticCache,
  before: CachedNode,
  record: Record<string, unknown>,
): Promise<UndoEntry> {
  await cache.putNode(toCachedNode(record, before.version + 1));
  return { kind: "node", id: before.nodeId, before };
}

const createNode: OptimisticMutator = async (c, raw) => {
  const { node } = parse("graph.createNode", raw);
  const type = node["node_type"];
  if (
    typeof type !== "string" ||
    !isNodeType(type) ||
    typeof node["node_id"] !== "string"
  ) {
    throw new OptimisticRejection("invalid-args");
  }
  if (!isTier0Only(type as NodeType))
    throw new OptimisticRejection("requires-feature-mutation");
  if (FEATURE_LIFECYCLE_NODE_TYPES.has(type))
    throw new OptimisticRejection("requires-feature-mutation");
  if (await c.cache.getNode(node["node_id"]))
    throw new OptimisticRejection("invalid-args");
  const stamped = stampNewNode(node, type as NodeType, provenance(c));
  await c.cache.putNode(toCachedNode(stamped, 1));
  return [{ kind: "node", id: node["node_id"], before: null }];
};

const updateNodeFields: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.updateNodeFields", raw);
  const node = await liveNode(c.cache, args.node_id);
  if (
    !isTier0Only(node.nodeType as NodeType) ||
    FEATURE_LIFECYCLE_NODE_TYPES.has(node.nodeType)
  ) {
    throw new OptimisticRejection("requires-feature-mutation");
  }
  if (args.expected_version !== null && args.expected_version !== node.version) {
    throw new OptimisticRejection("stale-state");
  }
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      ...args.patch,
      ...updateStamp(node.nodeType, provenance(c)),
    }),
  ];
};

const softDeleteNode: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.softDeleteNode", raw);
  const node = await liveNode(c.cache, args.node_id);
  if (FEATURE_LIFECYCLE_NODE_TYPES.has(node.nodeType))
    throw new OptimisticRejection("requires-feature-mutation");
  const anonymous =
    node.record["created_at"] === undefined && node.record["updated_at"] === undefined;
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      is_soft_deleted: true,
      ...(anonymous ? {} : { soft_deleted_at: c.now, soft_deleted_by: c.userId }),
    }),
  ];
};

const createEdge: OptimisticMutator = async (c, raw) => {
  const { edge } = parse("graph.createEdge", raw);
  const edgeId = edge["edge_id"];
  if (typeof edgeId !== "string" || (await c.cache.getEdge(edgeId))) {
    throw new OptimisticRejection("invalid-args");
  }
  await liveNode(c.cache, String(edge["from_node_id"]));
  await liveNode(c.cache, String(edge["to_node_id"]));
  await c.cache.putEdge(toCachedEdge(stampNewEdge(edge, provenance(c)), 1));
  return [{ kind: "edge", id: edgeId, before: null }];
};

async function closeAt(
  cache: OptimisticCache,
  edge: CachedEdge,
  effectiveTo: string,
): Promise<UndoEntry> {
  if (edge.effectiveTo !== null) throw new OptimisticRejection("invalid-args");
  if (
    edge.effectiveFrom !== null &&
    Date.parse(effectiveTo) <= Date.parse(edge.effectiveFrom)
  ) {
    throw new OptimisticRejection("invalid-args");
  }
  await cache.putEdge(
    toCachedEdge({ ...edge.record, effective_to: effectiveTo }, edge.version + 1),
  );
  return { kind: "edge", id: edge.edgeId, before: edge };
}

const closeEdge: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.closeEdge", raw);
  const edge = await c.cache.getEdge(args.edge_id);
  if (!edge) throw new OptimisticRejection("not-found");
  return [await closeAt(c.cache, edge, args.effective_to)];
};

const transitionLifecycle: OptimisticMutator = async (c, raw) => {
  const args = parse("graph.transitionLifecycle", raw);
  const node = await liveNode(c.cache, args.node_id);
  if (FEATURE_LIFECYCLE_NODE_TYPES.has(node.nodeType))
    throw new OptimisticRejection("requires-feature-mutation");
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      lifecycle_status: args.to_status,
      ...updateStamp(node.nodeType, provenance(c)),
    }),
  ];
};

const moveEmployee: OptimisticMutator = async (c, raw) => {
  const args = parse("org.moveEmployee", raw);
  const employee = await liveNode(c.cache, args.employee_id);
  if (employee.nodeType !== "Employee") throw new OptimisticRejection("invalid-args");
  const activeAt = (edge: CachedEdge) =>
    !edge.isSoftDeleted &&
    (edge.effectiveFrom === null ||
      Date.parse(edge.effectiveFrom) <= Date.parse(args.effective_from)) &&
    (edge.effectiveTo === null ||
      Date.parse(edge.effectiveTo) > Date.parse(args.effective_from));
  if (args.new_manager_id !== null) {
    const manager = await liveNode(c.cache, args.new_manager_id);
    if (manager.nodeType !== "Employee") throw new OptimisticRejection("invalid-args");
    const managerOf = async (id: string) =>
      (await c.cache.edgesFrom(id, "managed_by")).find(activeAt)?.toNodeId ?? null;
    if (await wouldCreateCycle(managerOf, args.employee_id, args.new_manager_id)) {
      throw new OptimisticRejection("cycle");
    }
  }
  const prior = (await c.cache.edgesFrom(args.employee_id, "managed_by")).find(
    (edge) => !edge.isSoftDeleted && edge.effectiveTo === null,
  );
  if ((prior?.toNodeId ?? null) === args.new_manager_id) {
    throw new OptimisticRejection("no-change");
  }
  const undo: UndoEntry[] = [];
  if (prior) undo.push(await closeAt(c.cache, prior, args.effective_from));
  if (args.new_manager_id !== null) {
    const edgeId = moveEmployeeEdgeId(c.mutationId);
    await c.cache.putEdge(
      toCachedEdge(
        stampNewEdge(
          {
            edge_id: edgeId,
            edge_type: "managed_by",
            from_node_id: args.employee_id,
            to_node_id: args.new_manager_id,
            effective_from: args.effective_from,
            effective_to: null,
          },
          provenance(c),
        ),
        1,
      ),
    );
    undo.push({ kind: "edge", id: edgeId, before: null });
  }
  return undo;
};

// ── Employee (RST-33) ───────────────────────────────────────────────────────

const liveEmployee = async (cache: OptimisticCache, id: string) => {
  const node = await liveNode(cache, id);
  if (node.nodeType !== "Employee") throw new OptimisticRejection("invalid-args");
  return node;
};

const employeeCreate: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.create", raw);
  if (await c.cache.getNode(args.employee_id))
    throw new OptimisticRejection("invalid-args");
  const entity = await c.cache.getNode(args.entity_id);
  if (!entity || entity.nodeType !== "Entity" || entity.isSoftDeleted)
    throw new OptimisticRejection("invalid-args");
  const node = stampNewNode(
    {
      node_id: args.employee_id,
      node_type: "Employee",
      schema_version: 1,
      lifecycle_status: "Active",
      ...employeeOperationalRecord(args.fields),
    },
    "Employee",
    provenance(c),
  );
  await c.cache.putNode(toCachedNode(node, 1));
  const edgeId = moveEmployeeEdgeId(c.mutationId);
  await c.cache.putEdge(
    toCachedEdge(
      stampNewEdge(
        {
          edge_id: edgeId,
          edge_type: "scoped_to_entity",
          from_node_id: args.employee_id,
          to_node_id: args.entity_id,
          effective_from: args.effective_from,
          effective_to: null,
        },
        provenance(c),
      ),
      1,
    ),
  );
  return [
    { kind: "node", id: args.employee_id, before: null },
    { kind: "edge", id: edgeId, before: null },
  ];
};

const employeeUpdate: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.update", raw);
  const node = await liveEmployee(c.cache, args.employee_id);
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  const patch = { ...args.patch } as Record<string, unknown>;
  if (typeof patch["email"] === "string") patch["email"] = patch["email"].toLowerCase();
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      ...patch,
      ...updateStamp("Employee", provenance(c)),
    }),
  ];
};

const employeeTransitionStatus: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.transitionStatus", raw);
  const node = await liveEmployee(c.cache, args.employee_id);
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  const outcome = employeeTransitionOutcome(
    node.lifecycleStatus,
    args.to_status,
    args.end_date,
    (node.record["end_date"] as string | null | undefined) ?? null,
  );
  if (!outcome.ok) throw new OptimisticRejection(outcome.reason);
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      lifecycle_status: args.to_status,
      end_date: outcome.endDate,
      ...updateStamp("Employee", provenance(c)),
    }),
  ];
};

const employeeLinkUser: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.linkUser", raw);
  const node = await liveEmployee(c.cache, args.employee_id);
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      user_id: args.user_id,
      ...updateStamp("Employee", provenance(c)),
    }),
  ];
};

/** Tier 1: never applied to the cache, because a protected value never reaches one. */
const employeeSetCompensation: OptimisticMutator = async (_c, raw) => {
  parse("employee.setCompensation", raw);
  return [];
};

// ── Entity (VRS-F003) ───────────────────────────────────────────────────────

const liveEntity = async (cache: OptimisticCache, id: string) => {
  const node = await liveNode(cache, id);
  if (node.nodeType !== "Entity") throw new OptimisticRejection("invalid-args");
  return node;
};

const entityCreate: OptimisticMutator = async (c, raw) => {
  const args = parse("entity.create", raw);
  const entityId = moveEmployeeEdgeId(c.mutationId);
  if (await c.cache.getNode(entityId)) throw new OptimisticRejection("invalid-args");
  const record = stampNewNode(
    {
      node_id: entityId,
      node_type: "Entity",
      schema_version: 1,
      lifecycle_status: "Active",
      name: args.name,
      legal_name: args.fields?.legal_name ?? null,
      jurisdiction: args.jurisdiction,
      registered_address: args.fields?.registered_address ?? null,
      registration_number: args.fields?.registration_number ?? null,
      default_currency: args.default_currency,
    },
    "Entity",
    provenance(c),
  );
  await c.cache.putNode(toCachedNode(record, 1));
  const calendarId = initialCalendarId(c.mutationId);
  const calendarEdgeId = initialCalendarEdgeId(c.mutationId);
  const template = initialWorkingWeekFor(args.jurisdiction);
  const calendar = stampNewNode(
    {
      node_id: calendarId,
      node_type: "WorkingCalendar",
      schema_version: 1,
      lifecycle_status: "Active",
      entity_id: entityId,
      name: `${args.jurisdiction} working calendar`,
      ...template,
      reduced_hours_periods: [],
    },
    "WorkingCalendar",
    provenance(c),
  );
  await c.cache.putNode(toCachedNode(calendar, 1));
  await c.cache.putEdge(
    toCachedEdge(
      stampNewEdge(
        {
          edge_id: calendarEdgeId,
          edge_type: "governed_by_calendar",
          from_node_id: entityId,
          to_node_id: calendarId,
          effective_from: c.now,
          effective_to: null,
        },
        provenance(c),
      ),
      1,
    ),
  );
  return [
    { kind: "node", id: entityId, before: null },
    { kind: "node", id: calendarId, before: null },
    { kind: "edge", id: calendarEdgeId, before: null },
  ];
};

const entityUpdate: OptimisticMutator = async (c, raw) => {
  const args = parse("entity.update", raw);
  const node = await liveEntity(c.cache, args.entity_id);
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      ...args.fields,
      ...updateStamp("Entity", provenance(c)),
    }),
  ];
};

/** G04/G05 are server-only aggregate checks; a refusal uses the existing undo. */
const entityDeactivate: OptimisticMutator = async (c, raw) => {
  const args = parse("entity.deactivate", raw);
  const node = await liveEntity(c.cache, args.entity_id);
  if (args.expected_version !== node.version)
    throw new OptimisticRejection("stale-state");
  return [
    await writeNode(c.cache, node, {
      ...node.record,
      lifecycle_status: "Dissolved",
      ...updateStamp("Entity", provenance(c)),
    }),
  ];
};

const employeeSetEntity: OptimisticMutator = async (c, raw) => {
  const args = parse("employee.setEntity", raw);
  await liveEmployee(c.cache, args.employee_id);
  const destination = await liveEntity(c.cache, args.entity_id);
  if (destination.lifecycleStatus !== "Active")
    throw new OptimisticRejection("entity-dissolved");
  // F224: the mutation's own mechanical open-edge lookup, never an asOf read.
  const prior = (await c.cache.edgesFrom(args.employee_id, "scoped_to_entity")).find(
    (edge) => !edge.isSoftDeleted && edge.effectiveTo === null,
  );
  if (!prior) throw new OptimisticRejection("not-found");
  if (prior.toNodeId === args.entity_id) throw new OptimisticRejection("no-change");
  const closed = await closeAt(c.cache, prior, args.effective_from);
  const edgeId = moveEmployeeEdgeId(c.mutationId);
  await c.cache.putEdge(
    toCachedEdge(
      stampNewEdge(
        {
          edge_id: edgeId,
          edge_type: "scoped_to_entity",
          from_node_id: args.employee_id,
          to_node_id: args.entity_id,
          effective_from: args.effective_from,
          effective_to: null,
        },
        provenance(c),
      ),
      1,
    ),
  );
  return [closed, { kind: "edge", id: edgeId, before: null }];
};

// ── Working calendar and patterns (VRS-F004) ───────────────────────────────

const liveTypedNode = async (cache: OptimisticCache, id: string, type: string) => {
  const node = await liveNode(cache, id);
  if (node.nodeType !== type) throw new OptimisticRejection("invalid-args");
  return node;
};

const putNewNode = async (
  c: MutatorContext,
  id: string,
  type: NodeType,
  fields: Record<string, unknown>,
) => {
  if (await c.cache.getNode(id)) throw new OptimisticRejection("invalid-args");
  const record = stampNewNode(
    { ...fields, node_id: id, node_type: type, schema_version: 1 },
    type,
    provenance(c),
  );
  await c.cache.putNode(toCachedNode(record, 1));
  return { kind: "node" as const, id, before: null };
};

const putNewEdge = async (
  c: MutatorContext,
  id: string,
  fields: Record<string, unknown>,
) => {
  if (await c.cache.getEdge(id)) throw new OptimisticRejection("invalid-args");
  const record = stampNewEdge({ edge_id: id, ...fields }, provenance(c));
  await c.cache.putEdge(toCachedEdge(record, 1));
  return { kind: "edge" as const, id, before: null };
};

const calendarUpdate: OptimisticMutator = async (c, raw) => {
  const args = parse("calendar.update", raw);
  const prior = await liveTypedNode(c.cache, args.calendar_id, "WorkingCalendar");
  if (args.expected_version !== prior.version)
    throw new OptimisticRejection("stale-state");
  if (prior.lifecycleStatus !== "Active") throw new OptimisticRejection("not-found");
  const ownership = (await c.cache.edgesTo(prior.nodeId, "governed_by_calendar"))[0];
  if (!ownership) throw new OptimisticRejection("not-found");
  const holidays: CachedNode[] = [];
  for (const edge of await c.cache.edgesTo(prior.nodeId, "holiday_in")) {
    const holiday = await c.cache.getNode(edge.fromNodeId);
    if (
      holiday &&
      !holiday.isSoftDeleted &&
      holiday.nodeType === "Holiday" &&
      holiday.lifecycleStatus === "Active"
    )
      holidays.push(holiday);
  }
  holidays.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const nextId = c.mutationId;
  const undo: UndoEntry[] = [
    await writeNode(c.cache, prior, {
      ...prior.record,
      lifecycle_status: "Superseded",
      ...updateStamp("WorkingCalendar", provenance(c)),
    }),
  ];
  undo.push(
    await putNewNode(c, nextId, "WorkingCalendar", {
      ...prior.record,
      lifecycle_status: "Active",
      working_week: args.working_week,
      standard_daily_hours: args.daily_hours,
      reduced_hours_periods:
        args.reduced_hours_periods ?? prior.record["reduced_hours_periods"] ?? [],
    }),
  );
  undo.push(
    await putNewEdge(c, mutationDerivedId(c.mutationId, 1), {
      edge_type: "governed_by_calendar",
      from_node_id: ownership.fromNodeId,
      to_node_id: nextId,
      effective_from: c.now,
      effective_to: null,
    }),
  );
  undo.push(
    await putNewEdge(c, mutationDerivedId(c.mutationId, 2), {
      edge_type: "supersedes",
      from_node_id: nextId,
      to_node_id: prior.nodeId,
      effective_from: c.now,
      effective_to: null,
    }),
  );
  for (const [index, holiday] of holidays.entries()) {
    const holidayId = mutationDerivedId(c.mutationId, 10 + index * 2);
    const edgeId = mutationDerivedId(c.mutationId, 11 + index * 2);
    undo.push(
      await putNewNode(c, holidayId, "Holiday", {
        ...holiday.record,
        calendar_id: nextId,
        lifecycle_status: "Active",
      }),
    );
    undo.push(
      await putNewEdge(c, edgeId, {
        edge_type: "holiday_in",
        from_node_id: holidayId,
        to_node_id: nextId,
        effective_from: c.now,
        effective_to: null,
      }),
    );
  }
  return undo;
};

const holidayAdd: OptimisticMutator = async (c, raw) => {
  const args = parse("holiday.add", raw);
  const calendar = await liveTypedNode(c.cache, args.calendar_id, "WorkingCalendar");
  if (calendar.lifecycleStatus !== "Active") throw new OptimisticRejection("not-found");
  const holidayId = c.mutationId;
  const edgeId = moveEmployeeEdgeId(c.mutationId);
  return [
    await putNewNode(c, holidayId, "Holiday", {
      lifecycle_status: "Active",
      calendar_id: calendar.nodeId,
      ...args.fields,
      date: args.fields.date ?? args.fields.estimated_date,
      confirmed_at: null,
      confirmed_by: null,
    }),
    await putNewEdge(c, edgeId, {
      edge_type: "holiday_in",
      from_node_id: holidayId,
      to_node_id: calendar.nodeId,
      effective_from: c.now,
      effective_to: null,
    }),
  ];
};

const activeHolidayCalendar = async (cache: OptimisticCache, holidayId: string) => {
  const edge = (await cache.edgesFrom(holidayId, "holiday_in"))[0];
  if (!edge) throw new OptimisticRejection("not-found");
  const calendar = await liveTypedNode(cache, edge.toNodeId, "WorkingCalendar");
  if (calendar.lifecycleStatus !== "Active") throw new OptimisticRejection("not-found");
};

const holidayConfirm: OptimisticMutator = async (c, raw) => {
  const args = parse("holiday.confirm", raw);
  const holiday = await liveTypedNode(c.cache, args.holiday_id, "Holiday");
  await activeHolidayCalendar(c.cache, holiday.nodeId);
  return [
    await writeNode(c.cache, holiday, {
      ...holiday.record,
      date: args.actual_date,
      is_provisional: false,
      confirmed_at: c.now,
      confirmed_by: c.userId,
      ...updateStamp("Holiday", provenance(c)),
    }),
  ];
};

const holidayCancel: OptimisticMutator = async (c, raw) => {
  const args = parse("holiday.cancel", raw);
  const holiday = await liveTypedNode(c.cache, args.holiday_id, "Holiday");
  if (args.expected_version !== holiday.version)
    throw new OptimisticRejection("stale-state");
  await activeHolidayCalendar(c.cache, holiday.nodeId);
  return [
    await writeNode(c.cache, holiday, {
      ...holiday.record,
      lifecycle_status: "Canceled",
      ...updateStamp("Holiday", provenance(c)),
    }),
  ];
};

const currentPattern = async (cache: OptimisticCache, employeeId: string) => {
  for (const edge of await cache.edgesTo(employeeId, "pattern_for")) {
    const node = await cache.getNode(edge.fromNodeId);
    if (
      node &&
      !node.isSoftDeleted &&
      node.nodeType === "WorkingPattern" &&
      node.lifecycleStatus === "Active"
    )
      return node;
  }
  return undefined;
};

const patternSet: OptimisticMutator = async (c, raw) => {
  const args = parse("pattern.set", raw);
  await liveEmployee(c.cache, args.employee_id);
  const prior = await currentPattern(c.cache, args.employee_id);
  const undo: UndoEntry[] = [];
  if (prior) {
    if (args.expected_version !== prior.version)
      throw new OptimisticRejection("stale-state");
    if (args.effective_from < String(prior.record["effective_from"]))
      throw new OptimisticRejection("invalid-args");
    undo.push(
      await writeNode(c.cache, prior, {
        ...prior.record,
        lifecycle_status: "Superseded",
        effective_to: args.effective_from,
        ...updateStamp("WorkingPattern", provenance(c)),
      }),
    );
  } else if (args.expected_version !== undefined)
    throw new OptimisticRejection("stale-state");
  undo.push(
    await putNewNode(c, c.mutationId, "WorkingPattern", {
      lifecycle_status: "Active",
      employee_id: args.employee_id,
      working_week: args.working_week,
      effective_from: args.effective_from,
      effective_to: null,
    }),
  );
  undo.push(
    await putNewEdge(c, moveEmployeeEdgeId(c.mutationId), {
      edge_type: "pattern_for",
      from_node_id: c.mutationId,
      to_node_id: args.employee_id,
      effective_from: `${args.effective_from}T00:00:00.000Z`,
      effective_to: null,
    }),
  );
  return undo;
};

const patternClear: OptimisticMutator = async (c, raw) => {
  const args = parse("pattern.clear", raw);
  await liveEmployee(c.cache, args.employee_id);
  const prior = await currentPattern(c.cache, args.employee_id);
  if (!prior) throw new OptimisticRejection("not-found");
  if (args.expected_version !== prior.version)
    throw new OptimisticRejection("stale-state");
  if (args.effective_from < String(prior.record["effective_from"]))
    throw new OptimisticRejection("invalid-args");
  return [
    await writeNode(c.cache, prior, {
      ...prior.record,
      lifecycle_status: "Superseded",
      effective_to: args.effective_from,
      ...updateStamp("WorkingPattern", provenance(c)),
    }),
  ];
};

// ── Assignments (VRS-F005) ────────────────────────────────────────────────

const assignmentCreate: OptimisticMutator = async (c, raw) => {
  const args = parse("assignment.create", raw);
  const employee = await liveTypedNode(c.cache, args.employee_id, "Employee");
  const project = await liveTypedNode(c.cache, args.project_id, "Project");
  // Capacity is deliberately server-only: one device may not have another
  // device's newest Assignment yet. A refusal uses the outbox's undo path.
  return [
    await putNewNode(c, c.mutationId, "Assignment", {
      lifecycle_status: "Active",
      employee_id: employee.nodeId,
      project_id: project.nodeId,
      start_date: args.start_date,
      end_date: args.end_date,
      billable_percentage: args.billable_percentage,
      rate_card_id: args.rate_card_id ?? null,
      rate_override_hourly: null,
      rate_override_reason: null,
      effective_billing_rate:
        (employee.record["billing_rate_default"] as number | null | undefined) ?? null,
      capacity_override_reason: null,
      capacity_override_by: null,
      capacity_override_at: null,
    }),
    await putNewEdge(c, mutationDerivedId(c.mutationId, 1), {
      edge_type: "assignment_of",
      from_node_id: c.mutationId,
      to_node_id: employee.nodeId,
      effective_from: `${args.start_date}T00:00:00.000Z`,
      effective_to: null,
    }),
    await putNewEdge(c, mutationDerivedId(c.mutationId, 2), {
      edge_type: "assigned_to",
      from_node_id: c.mutationId,
      to_node_id: project.nodeId,
      effective_from: `${args.start_date}T00:00:00.000Z`,
      effective_to: null,
    }),
  ];
};

const assignmentUpdate: OptimisticMutator = async (c, raw) => {
  const args = parse("assignment.update", raw);
  const assignment = await liveTypedNode(c.cache, args.assignment_id, "Assignment");
  const start = args.fields.start_date ?? String(assignment.record["start_date"]);
  const end = args.fields.end_date ?? String(assignment.record["end_date"]);
  if (end < start) throw new OptimisticRejection("invalid-args");
  return [
    await writeNode(c.cache, assignment, {
      ...assignment.record,
      ...args.fields,
      ...updateStamp("Assignment", provenance(c)),
    }),
  ];
};

const assignmentCancel: OptimisticMutator = async (c, raw) => {
  const args = parse("assignment.cancel", raw);
  const assignment = await liveTypedNode(c.cache, args.assignment_id, "Assignment");
  if (assignment.version !== args.expected_version)
    throw new OptimisticRejection("stale-state");
  return [
    await writeNode(c.cache, assignment, {
      ...assignment.record,
      lifecycle_status: "Canceled",
      ...updateStamp("Assignment", provenance(c)),
    }),
  ];
};

const assignmentSetRateCard: OptimisticMutator = async (c, raw) => {
  const args = parse("assignment.setRateCard", raw);
  const assignment = await liveTypedNode(c.cache, args.assignment_id, "Assignment");
  return [
    await writeNode(c.cache, assignment, {
      ...assignment.record,
      rate_card_id: args.rate_card_id,
      ...updateStamp("Assignment", provenance(c)),
    }),
  ];
};

const assignmentSetRateOverride: OptimisticMutator = async (c, raw) => {
  const args = parse("assignment.setRateOverride", raw);
  const assignment = await liveTypedNode(c.cache, args.assignment_id, "Assignment");
  return [
    await writeNode(c.cache, assignment, {
      ...assignment.record,
      rate_override_hourly: args.hourly,
      rate_override_reason: args.reason,
      effective_billing_rate: args.hourly,
      ...updateStamp("Assignment", provenance(c)),
    }),
  ];
};

const assignmentClearRateOverride: OptimisticMutator = async (c, raw) => {
  const args = parse("assignment.clearRateOverride", raw);
  const assignment = await liveTypedNode(c.cache, args.assignment_id, "Assignment");
  let effectiveBillingRate = assignment.record["effective_billing_rate"];
  if (assignment.record["rate_card_id"] === null) {
    const employee = await liveTypedNode(
      c.cache,
      String(assignment.record["employee_id"]),
      "Employee",
    );
    const daily = employee.record["billing_rate_default"] as number | null | undefined;
    effectiveBillingRate = daily == null ? null : daily / 8;
  }
  return [
    await writeNode(c.cache, assignment, {
      ...assignment.record,
      rate_override_hourly: null,
      rate_override_reason: null,
      effective_billing_rate: effectiveBillingRate,
      ...updateStamp("Assignment", provenance(c)),
    }),
  ];
};

export const OPTIMISTIC_MUTATORS: Readonly<
  Partial<Record<MutationName, OptimisticMutator>>
> = {
  "employee.create": employeeCreate,
  "employee.update": employeeUpdate,
  "employee.transitionStatus": employeeTransitionStatus,
  "employee.linkUser": employeeLinkUser,
  "employee.setCompensation": employeeSetCompensation,
  "employee.setEntity": employeeSetEntity,
  "entity.create": entityCreate,
  "entity.update": entityUpdate,
  "entity.deactivate": entityDeactivate,
  "calendar.update": calendarUpdate,
  "holiday.add": holidayAdd,
  "holiday.confirm": holidayConfirm,
  "holiday.cancel": holidayCancel,
  "pattern.set": patternSet,
  "pattern.clear": patternClear,
  "assignment.create": assignmentCreate,
  "assignment.update": assignmentUpdate,
  "assignment.cancel": assignmentCancel,
  "assignment.setRateCard": assignmentSetRateCard,
  "assignment.setRateOverride": assignmentSetRateOverride,
  "assignment.clearRateOverride": assignmentClearRateOverride,
  "graph.createNode": createNode,
  "graph.updateNodeFields": updateNodeFields,
  "graph.softDeleteNode": softDeleteNode,
  "graph.createEdge": createEdge,
  "graph.closeEdge": closeEdge,
  "graph.transitionLifecycle": transitionLifecycle,
  "org.moveEmployee": moveEmployee,
};

/** Applies a named mutation to the cache, or throws `OptimisticRejection`. */
export async function applyOptimistic(
  context: MutatorContext,
  name: string,
  args: unknown,
): Promise<UndoEntry[]> {
  const definition = getMutationDefinition(name);
  if (!definition) throw new OptimisticRejection("unknown-mutation");
  const mutator = OPTIMISTIC_MUTATORS[name as MutationName];
  if (!mutator) {
    if (definition.onlineOnly) return [];
    throw new OptimisticRejection("missing-optimistic-mutator");
  }
  return mutator(context, args);
}

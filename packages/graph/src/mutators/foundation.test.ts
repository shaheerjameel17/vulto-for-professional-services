import {
  initialCalendarEdgeId,
  initialCalendarId,
  moveEmployeeEdgeId,
  mutationDerivedId,
} from "@vulto/schema";
import { describe, expect, it } from "vitest";
import { applyUndo, type MutatorContext } from "./index";
import { applyOptimistic, OptimisticRejection } from "./foundation";
import { MemoryCache } from "./memory-cache";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-09-21T09:00:00.000Z";
let counter = 0;
const uuid = () =>
  `${(++counter).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

const context = (cache: MemoryCache, mutationId = uuid()): MutatorContext => ({
  cache,
  workspaceId: WORKSPACE,
  userId: USER,
  mutationId,
  now: NOW,
});

const genericNode = (nodeId = uuid()) => ({
  node_id: nodeId,
  node_type: "Project",
  schema_version: 1,
  lifecycle_status: "Active",
});

const seedEntity = async (cache: MemoryCache, id = uuid(), version = 1) => {
  await cache.putNode({
    nodeId: id,
    nodeType: "Entity",
    lifecycleStatus: "Active",
    isSoftDeleted: false,
    version,
    record: { node_id: id, node_type: "Entity", lifecycle_status: "Active" },
  });
  return id;
};

const seedEmployee = async (cache: MemoryCache) => {
  const id = uuid();
  await cache.putNode({
    nodeId: id,
    nodeType: "Employee",
    lifecycleStatus: "Active",
    isSoftDeleted: false,
    version: 1,
    record: { node_id: id, node_type: "Employee", lifecycle_status: "Active" },
  });
  return id;
};

const seedCalendar = async (cache: MemoryCache, id = uuid()) => {
  await cache.putNode({
    nodeId: id,
    nodeType: "WorkingCalendar",
    lifecycleStatus: "Active",
    isSoftDeleted: false,
    version: 1,
    record: {
      node_id: id,
      node_type: "WorkingCalendar",
      lifecycle_status: "Active",
      working_week: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        day,
        is_working: day <= 5,
        hours: day <= 5 ? 8 : 0,
      })),
      standard_daily_hours: 8,
      reduced_hours_periods: [],
    },
  });
  return id;
};

const rejects = async (work: Promise<unknown>, reason: string) => {
  await expect(work).rejects.toMatchObject({ name: "OptimisticRejection", reason });
};

describe("the optimistic foundation mutators", () => {
  it("createNode stamps provenance like the server and is undone by its before-image", async () => {
    const cache = new MemoryCache();
    const node = genericNode();
    const undo = await applyOptimistic(context(cache), "graph.createNode", { node });
    const stored = cache.nodes.get(node.node_id)!;
    expect(stored.version).toBe(1);
    expect(stored.record).toMatchObject({
      workspace_id: WORKSPACE,
      created_by: USER,
      created_at: NOW,
      is_soft_deleted: false,
    });
    await applyUndo(cache, undo);
    expect(cache.nodes.size).toBe(0);
  });

  it("createNode refuses a split, protected or unregistered type, and a duplicate id", async () => {
    const cache = new MemoryCache();
    for (const type of ["Employee", "Entity", "PayRun", "HRCase"]) {
      await rejects(
        applyOptimistic(context(cache), "graph.createNode", {
          node: { ...genericNode(), node_type: type },
        }),
        "requires-feature-mutation",
      );
    }
    await rejects(
      applyOptimistic(context(cache), "graph.createNode", {
        node: { ...genericNode(), node_type: "Nope" },
      }),
      "invalid-args",
    );
    const node = genericNode();
    await applyOptimistic(context(cache), "graph.createNode", { node });
    await rejects(
      applyOptimistic(context(cache), "graph.createNode", { node }),
      "invalid-args",
    );
  });

  it("updateNodeFields merges, bumps the version, checks the base version, and reverts", async () => {
    const cache = new MemoryCache();
    const node = genericNode();
    await applyOptimistic(context(cache), "graph.createNode", { node });
    const undo = await applyOptimistic(context(cache), "graph.updateNodeFields", {
      node_id: node.node_id,
      expected_version: 1,
      patch: { display_name: "A" },
    });
    expect(cache.nodes.get(node.node_id)).toMatchObject({
      version: 2,
      record: { display_name: "A" },
    });
    await rejects(
      applyOptimistic(context(cache), "graph.updateNodeFields", {
        node_id: node.node_id,
        expected_version: 1,
        patch: { display_name: "B" },
      }),
      "stale-state",
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.get(node.node_id)).toMatchObject({ version: 1 });
    expect(cache.nodes.get(node.node_id)!.record).not.toHaveProperty("display_name");
  });

  it("updateNodeFields refuses a split type, as the server does", async () => {
    const cache = new MemoryCache();
    const employee = await seedEmployee(cache);
    await rejects(
      applyOptimistic(context(cache), "graph.updateNodeFields", {
        node_id: employee,
        expected_version: null,
        patch: { display_name: "x" },
      }),
      "requires-feature-mutation",
    );
  });

  it("softDeleteNode marks the row and refuses a second delete", async () => {
    const cache = new MemoryCache();
    const node = genericNode();
    await applyOptimistic(context(cache), "graph.createNode", { node });
    const undo = await applyOptimistic(context(cache), "graph.softDeleteNode", {
      node_id: node.node_id,
    });
    expect(cache.nodes.get(node.node_id)).toMatchObject({
      isSoftDeleted: true,
      version: 2,
      record: { soft_deleted_by: USER, soft_deleted_at: NOW },
    });
    await rejects(
      applyOptimistic(context(cache), "graph.softDeleteNode", {
        node_id: node.node_id,
      }),
      "target-deleted",
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.get(node.node_id)!.isSoftDeleted).toBe(false);
  });

  it("transitionLifecycle carries the base version: a stale one is refused locally", async () => {
    const cache = new MemoryCache();
    const employee = uuid();
    await cache.putNode({
      nodeId: employee,
      nodeType: "Project",
      lifecycleStatus: "Active",
      isSoftDeleted: false,
      version: 1,
      record: { node_id: employee, node_type: "Project", lifecycle_status: "Active" },
    });
    const undo = await applyOptimistic(context(cache), "graph.transitionLifecycle", {
      node_id: employee,
      to_status: "Completed",
      expected_version: 1,
    });
    expect(cache.nodes.get(employee)).toMatchObject({
      lifecycleStatus: "Completed",
      version: 2,
    });
    await rejects(
      applyOptimistic(context(cache), "graph.transitionLifecycle", {
        node_id: employee,
        to_status: "Archived",
        expected_version: 1,
      }),
      "stale-state",
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.get(employee)).toMatchObject({
      lifecycleStatus: "Active",
      version: 1,
    });
  });

  it("createEdge and closeEdge apply, bump the version and revert", async () => {
    const cache = new MemoryCache();
    const a = await seedEmployee(cache);
    const b = await seedEmployee(cache);
    const edgeId = uuid();
    const edge = {
      edge_id: edgeId,
      edge_type: "managed_by",
      from_node_id: a,
      to_node_id: b,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
    };
    const created = await applyOptimistic(context(cache), "graph.createEdge", { edge });
    expect(cache.edges.get(edgeId)).toMatchObject({ version: 1, effectiveTo: null });
    const closed = await applyOptimistic(context(cache), "graph.closeEdge", {
      edge_id: edgeId,
      effective_to: "2026-02-01T00:00:00.000Z",
    });
    expect(cache.edges.get(edgeId)).toMatchObject({
      version: 2,
      effectiveTo: "2026-02-01T00:00:00.000Z",
    });
    await rejects(
      applyOptimistic(context(cache), "graph.closeEdge", {
        edge_id: edgeId,
        effective_to: "2026-03-01T00:00:00.000Z",
      }),
      "invalid-args",
    );
    await applyUndo(cache, [...created, ...closed]);
    expect(cache.edges.size).toBe(0);
  });

  it("moveEmployee closes and opens at one instant, rejects loops, and reverts", async () => {
    const cache = new MemoryCache();
    const [a, b, c] = [
      await seedEmployee(cache),
      await seedEmployee(cache),
      await seedEmployee(cache),
    ];
    const move = (
      employee: string,
      manager: string | null,
      from: string,
      id = uuid(),
    ) =>
      applyOptimistic(context(cache, id), "org.moveEmployee", {
        employee_id: employee,
        new_manager_id: manager,
        effective_from: from,
      });
    await move(a, b, "2026-01-01T00:00:00.000Z");
    await rejects(move(b, a, "2026-02-01T00:00:00.000Z"), "cycle");
    await move(b, c, "2026-02-01T00:00:00.000Z");
    await rejects(move(c, a, "2026-03-01T00:00:00.000Z"), "cycle");
    await rejects(move(a, a, "2026-03-01T00:00:00.000Z"), "cycle");
    await rejects(move(a, b, "2026-04-01T00:00:00.000Z"), "no-change");

    const id = uuid();
    const undo = await move(a, c, "2026-06-01T00:00:00.000Z", id);
    const edges = (await cache.edgesFrom(a, "managed_by")).sort((x, y) =>
      String(x.effectiveFrom).localeCompare(String(y.effectiveFrom)),
    );
    expect(edges.map((e) => [e.effectiveFrom, e.effectiveTo])).toEqual([
      ["2026-01-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z"],
      ["2026-06-01T00:00:00.000Z", null],
    ]);
    // The opened edge has the id the server derives from the same mutation.
    expect(edges[1]!.edgeId).toBe(moveEmployeeEdgeId(id));
    await applyUndo(cache, undo);
    const after = await cache.edgesFrom(a, "managed_by");
    expect(after).toHaveLength(1);
    expect(after[0]!.effectiveTo).toBeNull();
  });

  it("creates and updates Entity through its named mutations", async () => {
    const cache = new MemoryCache();
    const mutationId = uuid();
    const entityId = moveEmployeeEdgeId(mutationId);
    const created = await applyOptimistic(context(cache, mutationId), "entity.create", {
      name: "Vulto UK",
      jurisdiction: "UK",
      default_currency: "GBP",
    });
    expect(cache.nodes.get(entityId)).toMatchObject({
      nodeType: "Entity",
      lifecycleStatus: "Active",
      version: 1,
      record: { name: "Vulto UK", jurisdiction: "UK", default_currency: "GBP" },
    });
    expect(cache.nodes.get(initialCalendarId(mutationId))).toMatchObject({
      nodeType: "WorkingCalendar",
      lifecycleStatus: "Active",
      record: {
        entity_id: entityId,
        standard_daily_hours: 8,
      },
    });
    expect(cache.edges.get(initialCalendarEdgeId(mutationId))).toMatchObject({
      edgeType: "governed_by_calendar",
      fromNodeId: entityId,
      toNodeId: initialCalendarId(mutationId),
    });
    const updated = await applyOptimistic(context(cache), "entity.update", {
      entity_id: entityId,
      fields: { name: "Vulto London" },
    });
    expect(cache.nodes.get(entityId)).toMatchObject({
      version: 2,
      record: { name: "Vulto London", default_currency: "GBP" },
    });
    await applyUndo(cache, updated);
    expect(cache.nodes.get(entityId)?.record["name"]).toBe("Vulto UK");
    await applyUndo(cache, created);
    expect(cache.nodes.has(entityId)).toBe(false);
    expect(cache.nodes.has(initialCalendarId(mutationId))).toBe(false);
    expect(cache.edges.has(initialCalendarEdgeId(mutationId))).toBe(false);
  });

  it("supersedes a calendar optimistically and carries or replaces reduced hours", async () => {
    const cache = new MemoryCache();
    const entityId = await seedEntity(cache);
    const calendarId = uuid();
    await cache.putNode({
      nodeId: calendarId,
      nodeType: "WorkingCalendar",
      lifecycleStatus: "Active",
      isSoftDeleted: false,
      version: 1,
      record: {
        node_id: calendarId,
        node_type: "WorkingCalendar",
        lifecycle_status: "Active",
        working_week: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
          day,
          is_working: day <= 5,
          hours: day <= 5 ? 8 : 0,
        })),
        standard_daily_hours: 8,
        reduced_hours_periods: [
          {
            name: "Ramadan",
            start_date: "2026-02-18",
            end_date: "2026-03-19",
            factor: 0.75,
            is_provisional: false,
            estimated_start_date: null,
          },
        ],
      },
    });
    const ownershipId = uuid();
    await cache.putEdge({
      edgeId: ownershipId,
      edgeType: "governed_by_calendar",
      fromNodeId: entityId,
      toNodeId: calendarId,
      effectiveFrom: NOW,
      effectiveTo: null,
      isSoftDeleted: false,
      version: 1,
      record: {
        edge_id: ownershipId,
        edge_type: "governed_by_calendar",
        from_node_id: entityId,
        to_node_id: calendarId,
        effective_from: NOW,
        effective_to: null,
      },
    });
    const mutationId = uuid();
    const week = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      day,
      is_working: day <= 4,
      hours: day <= 4 ? 8 : 0,
    }));
    const undo = await applyOptimistic(context(cache, mutationId), "calendar.update", {
      calendar_id: calendarId,
      working_week: week,
      daily_hours: 8,
      expected_version: 1,
    });
    expect(cache.nodes.get(calendarId)).toMatchObject({
      lifecycleStatus: "Superseded",
      version: 2,
    });
    expect(cache.nodes.get(mutationId)?.record["reduced_hours_periods"]).toEqual(
      cache.nodes.get(calendarId)?.record["reduced_hours_periods"],
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.get(calendarId)).toMatchObject({
      lifecycleStatus: "Active",
      version: 1,
    });
    expect(cache.nodes.has(mutationId)).toBe(false);

    const replacementId = uuid();
    const replaced = await applyOptimistic(
      context(cache, replacementId),
      "calendar.update",
      {
        calendar_id: calendarId,
        working_week: week,
        daily_hours: 8,
        expected_version: 1,
        reduced_hours_periods: [],
      },
    );
    expect(cache.nodes.get(replacementId)?.record["reduced_hours_periods"]).toEqual([]);
    await applyUndo(cache, replaced);
  });

  it("applies and undoes every Holiday and WorkingPattern handler", async () => {
    const cache = new MemoryCache();
    const calendarId = await seedCalendar(cache);
    const employeeId = await seedEmployee(cache);

    const holidayId = uuid();
    const added = await applyOptimistic(context(cache, holidayId), "holiday.add", {
      calendar_id: calendarId,
      fields: {
        name: "Moon Day",
        holiday_type: "Public",
        is_provisional: true,
        estimated_date: "2026-05-04",
      },
    });
    expect(cache.nodes.get(holidayId)?.record).toMatchObject({
      date: "2026-05-04",
      estimated_date: "2026-05-04",
      is_provisional: true,
    });

    const confirmed = await applyOptimistic(context(cache), "holiday.confirm", {
      holiday_id: holidayId,
      actual_date: "2026-05-05",
    });
    expect(cache.nodes.get(holidayId)?.record).toMatchObject({
      date: "2026-05-05",
      estimated_date: "2026-05-04",
      is_provisional: false,
      confirmed_by: USER,
    });
    await rejects(
      applyOptimistic(context(cache), "holiday.cancel", {
        holiday_id: holidayId,
        expected_version: 1,
      }),
      "stale-state",
    );
    const canceled = await applyOptimistic(context(cache), "holiday.cancel", {
      holiday_id: holidayId,
      expected_version: 2,
    });
    expect(cache.nodes.get(holidayId)).toMatchObject({
      lifecycleStatus: "Canceled",
      version: 3,
    });
    await applyUndo(cache, canceled);
    await applyUndo(cache, confirmed);
    await applyUndo(cache, added);
    expect(cache.nodes.has(holidayId)).toBe(false);

    const firstPatternId = uuid();
    const first = await applyOptimistic(context(cache, firstPatternId), "pattern.set", {
      employee_id: employeeId,
      working_week: [{ day: 3, is_working: false, hours: 0 }],
      effective_from: "2026-03-01",
    });
    expect(cache.edges.get(moveEmployeeEdgeId(firstPatternId))).toMatchObject({
      edgeType: "pattern_for",
      fromNodeId: firstPatternId,
      toNodeId: employeeId,
    });
    await rejects(
      applyOptimistic(context(cache), "pattern.set", {
        employee_id: employeeId,
        working_week: [],
        effective_from: "2026-02-28",
        expected_version: 999,
      }),
      "stale-state",
    );
    const secondPatternId = uuid();
    const second = await applyOptimistic(
      context(cache, secondPatternId),
      "pattern.set",
      {
        employee_id: employeeId,
        working_week: [],
        effective_from: "2026-03-01",
        expected_version: 1,
      },
    );
    expect(cache.nodes.get(firstPatternId)).toMatchObject({
      lifecycleStatus: "Superseded",
      record: { effective_to: "2026-03-01" },
    });
    const cleared = await applyOptimistic(context(cache), "pattern.clear", {
      employee_id: employeeId,
      effective_from: "2026-04-01",
      expected_version: 1,
    });
    expect(cache.nodes.get(secondPatternId)).toMatchObject({
      lifecycleStatus: "Superseded",
      record: { effective_to: "2026-04-01" },
    });
    await applyUndo(cache, cleared);
    await applyUndo(cache, second);
    await applyUndo(cache, first);
    expect(cache.nodes.has(firstPatternId)).toBe(false);
    expect(cache.nodes.has(secondPatternId)).toBe(false);
  });

  it("setEntity closes only the currently open edge and opens a deterministic new edge", async () => {
    const cache = new MemoryCache();
    const employeeId = await seedEmployee(cache);
    const uk = await seedEntity(cache);
    const pk = await seedEntity(cache);
    const historicalId = uuid();
    const openId = uuid();
    const edge = (
      edgeId: string,
      toNodeId: string,
      from: string,
      to: string | null,
    ) => ({
      edgeId,
      edgeType: "scoped_to_entity",
      fromNodeId: employeeId,
      toNodeId,
      effectiveFrom: from,
      effectiveTo: to,
      isSoftDeleted: false,
      version: 1,
      record: {
        edge_id: edgeId,
        edge_type: "scoped_to_entity",
        from_node_id: employeeId,
        to_node_id: toNodeId,
        effective_from: from,
        effective_to: to,
      },
    });
    await cache.putEdge(
      edge(historicalId, uk, "2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    );
    await cache.putEdge(edge(openId, uk, "2026-01-01T00:00:00.000Z", null));
    const mutationId = uuid();
    const transferDate = "2026-03-01T00:00:00.000Z";
    const undo = await applyOptimistic(
      context(cache, mutationId),
      "employee.setEntity",
      {
        employee_id: employeeId,
        entity_id: pk,
        effective_from: transferDate,
      },
    );
    expect(cache.edges.get(historicalId)?.effectiveTo).toBe("2026-01-01T00:00:00.000Z");
    expect(cache.edges.get(openId)).toMatchObject({
      effectiveTo: transferDate,
      version: 2,
    });
    expect(cache.edges.get(moveEmployeeEdgeId(mutationId))).toMatchObject({
      toNodeId: pk,
      effectiveFrom: transferDate,
      effectiveTo: null,
      version: 1,
    });
    await applyUndo(cache, undo);
    expect(cache.edges.get(openId)).toMatchObject({ effectiveTo: null, version: 1 });
    expect(cache.edges.has(moveEmployeeEdgeId(mutationId))).toBe(false);
  });

  it("deactivates a sole Entity optimistically using only its base version", async () => {
    const cache = new MemoryCache();
    const entityId = await seedEntity(cache);
    await rejects(
      applyOptimistic(context(cache), "entity.deactivate", {
        entity_id: entityId,
        expected_version: 2,
      }),
      "stale-state",
    );
    const undo = await applyOptimistic(context(cache), "entity.deactivate", {
      entity_id: entityId,
      expected_version: 1,
    });
    expect(cache.nodes.get(entityId)).toMatchObject({
      lifecycleStatus: "Dissolved",
      version: 2,
    });
    await applyUndo(cache, undo);
    expect(cache.nodes.get(entityId)).toMatchObject({
      lifecycleStatus: "Active",
      version: 1,
    });
  });

  it("creates the complete Ghost pair offline and leaves promotion for server confirmation", async () => {
    const cache = new MemoryCache();
    const skillId = uuid();
    await cache.putNode({
      nodeId: skillId,
      nodeType: "Skill",
      lifecycleStatus: "Active",
      isSoftDeleted: false,
      version: 1,
      record: { node_id: skillId, node_type: "Skill", lifecycle_status: "Active" },
    });
    const mutationId = uuid();
    const undo = await applyOptimistic(
      context(cache, mutationId),
      "ghostResource.create",
      {
        role_title: "Senior React Developer",
        projected_start_date: "2026-06-01",
        seniority_level: "Senior",
        target_skill_ids: [skillId],
        expected_rate: 1_200,
      },
    );
    const employeeId = mutationDerivedId(mutationId, 1);
    expect(cache.nodes.get(employeeId)?.record).toMatchObject({
      employee_type: "Ghost",
      employee_code: null,
      full_name: null,
      email: null,
      employment_type: null,
      contracted_hours: 40,
      job_title: "Senior React Developer",
      start_date: "2026-06-01",
      seniority_level: "Senior",
      billing_rate_default: 1_200,
    });
    expect(cache.nodes.get(mutationId)?.record).toMatchObject({
      ghost_employee_id: employeeId,
    });
    expect(cache.edges.get(mutationDerivedId(mutationId, 10))).toMatchObject({
      edgeType: "has_skill",
      fromNodeId: employeeId,
      toNodeId: skillId,
    });
    expect(
      await applyOptimistic(context(cache), "ghostResource.promote", {
        ghost_id: mutationId,
        expected_version: 1,
        details: {
          employee_code: "E-1",
          full_name: "Person",
          email: "person@example.test",
          employment_type: "FullTime",
          start_date: "2026-06-22",
        },
      }),
    ).toEqual([]);
    expect(cache.nodes.get(mutationId)?.lifecycleStatus).toBe("Active");
    await applyUndo(cache, undo);
    expect(cache.nodes.has(employeeId)).toBe(false);
    expect(cache.nodes.has(mutationId)).toBe(false);
  });

  it("refuses unknown mutations and malformed arguments", async () => {
    const cache = new MemoryCache();
    await rejects(
      applyOptimistic(context(cache), "nope.nothing", {}),
      "unknown-mutation",
    );
    await rejects(
      applyOptimistic(context(cache), "graph.createNode", { extra: 1 }),
      "invalid-args",
    );
    expect(new OptimisticRejection("x").name).toBe("OptimisticRejection");
  });
});

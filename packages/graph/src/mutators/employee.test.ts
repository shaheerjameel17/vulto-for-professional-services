import { describe, expect, it } from "vitest";
import { applyUndo, type MutatorContext } from "./index";
import { applyOptimistic, OptimisticRejection } from "./foundation";
import { MemoryCache } from "./memory-cache";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-09-21T09:00:00.000Z";
let counter = 100;
const uuid = () =>
  `${(++counter).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const context = (cache: MemoryCache): MutatorContext => ({
  cache,
  workspaceId: WORKSPACE,
  userId: USER,
  mutationId: uuid(),
  now: NOW,
});

const fields = {
  employee_code: "E1",
  full_name: "Ada Lovelace",
  email: "Ada@Example.com",
  job_title: "Engineer",
  employment_type: "FullTime",
  start_date: "2026-02-01",
};

async function withEntity() {
  const cache = new MemoryCache();
  const entityId = uuid();
  await cache.putNode({
    nodeId: entityId,
    nodeType: "Entity",
    lifecycleStatus: "Active",
    isSoftDeleted: false,
    version: 1,
    record: { node_id: entityId, node_type: "Entity", lifecycle_status: "Active" },
  });
  return { cache, entityId };
}

describe("the optimistic Employee mutators", () => {
  it("creates the Tier 0 record and the entity edge, and reverts both", async () => {
    const { cache, entityId } = await withEntity();
    const employeeId = uuid();
    const undo = await applyOptimistic(context(cache), "employee.create", {
      employee_id: employeeId,
      entity_id: entityId,
      effective_from: NOW,
      fields,
    });
    const node = await cache.getNode(employeeId);
    expect(node).toMatchObject({
      nodeType: "Employee",
      lifecycleStatus: "Active",
      version: 1,
    });
    expect(node?.record).toMatchObject({
      email: "ada@example.com",
      contracted_hours: 40,
    });
    expect([...cache.edges.values()].map((e) => e.edgeType)).toEqual([
      "scoped_to_entity",
    ]);
    await applyUndo(cache, undo);
    expect(await cache.getNode(employeeId)).toBeUndefined();
    expect(cache.edges.size).toBe(0);
  });

  it("applies the same status table as the server, and refuses a stale version", async () => {
    const { cache, entityId } = await withEntity();
    const employeeId = uuid();
    await applyOptimistic(context(cache), "employee.create", {
      employee_id: employeeId,
      entity_id: entityId,
      effective_from: NOW,
      fields,
    });
    const go = (to: string, version: number, extra = {}) =>
      applyOptimistic(context(cache), "employee.transitionStatus", {
        employee_id: employeeId,
        to_status: to,
        expected_version: version,
        ...extra,
      });
    await expect(go("Inactive", 1)).rejects.toMatchObject({
      reason: "end-date-required",
    });
    await go("Inactive", 1, { end_date: "2026-11-30" });
    expect((await cache.getNode(employeeId))?.record["end_date"]).toBe("2026-11-30");
    await expect(go("Converted", 2)).rejects.toMatchObject({
      reason: "invalid-transition",
    });
    await expect(go("Active", 1)).rejects.toMatchObject({ reason: "stale-state" });
    await go("Active", 2);
    expect((await cache.getNode(employeeId))?.record["end_date"]).toBeNull();
  });

  it("refuses the generic mutators on an Employee, and never puts compensation in the cache", async () => {
    const { cache, entityId } = await withEntity();
    const employeeId = uuid();
    await applyOptimistic(context(cache), "employee.create", {
      employee_id: employeeId,
      entity_id: entityId,
      effective_from: NOW,
      fields,
    });
    await expect(
      applyOptimistic(context(cache), "graph.transitionLifecycle", {
        node_id: employeeId,
        to_status: "Converted",
        expected_version: 1,
      }),
    ).rejects.toBeInstanceOf(OptimisticRejection);
    const before = JSON.stringify([...cache.nodes.values()]);
    const undo = await applyOptimistic(context(cache), "employee.setCompensation", {
      employee_id: employeeId,
      compensation: {
        base_compensation_amount: 918273645,
        compensation_frequency: "Annual",
        compensation_currency: "AED",
      },
    });
    expect(undo).toEqual([]);
    expect(JSON.stringify([...cache.nodes.values()])).toBe(before);
    expect(before).not.toContain("918273645");
    // A compensation field in an ordinary update is not valid input at all.
    await expect(
      applyOptimistic(context(cache), "employee.update", {
        employee_id: employeeId,
        expected_version: 1,
        patch: { base_compensation_amount: 1 },
      }),
    ).rejects.toMatchObject({ reason: "invalid-args" });
  });
});

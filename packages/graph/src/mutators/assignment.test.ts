import { mutationDerivedId } from "@vulto/schema";
import { describe, expect, it } from "vitest";
import { applyUndo } from "./cache";
import { applyOptimistic, type MutatorContext } from "./foundation";
import { MemoryCache } from "./memory-cache";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMPLOYEE = "10000000-0000-4000-8000-000000000001";
const PROJECT = "10000000-0000-4000-8000-000000000002";
const MUTATION = "10000000-0000-4000-8000-000000000003";

const context = (cache: MemoryCache): MutatorContext => ({
  cache,
  workspaceId: WORKSPACE,
  userId: USER,
  mutationId: MUTATION,
  now: "2026-03-01T00:00:00.000Z",
});

const seed = async (cache: MemoryCache, id: string, type: string, record = {}) =>
  cache.putNode({
    nodeId: id,
    nodeType: type,
    lifecycleStatus: "Active",
    isSoftDeleted: false,
    version: 1,
    record: { node_id: id, node_type: type, lifecycle_status: "Active", ...record },
  });

describe("Assignment optimistic mutators", () => {
  it("creates locally without capacity logic and rolls a server refusal back cleanly", async () => {
    const cache = new MemoryCache();
    await seed(cache, EMPLOYEE, "Employee", { billing_rate_default: 900 });
    await seed(cache, PROJECT, "Project");
    // An existing 100% Assignment is deliberately present. The optimistic
    // handler still applies; only the server owns the capacity decision.
    await seed(cache, "10000000-0000-4000-8000-000000000004", "Assignment", {
      employee_id: EMPLOYEE,
      start_date: "2026-03-01",
      end_date: "2026-03-31",
      billable_percentage: 100,
    });
    const undo = await applyOptimistic(context(cache), "assignment.create", {
      employee_id: EMPLOYEE,
      project_id: PROJECT,
      start_date: "2026-03-10",
      end_date: "2026-03-20",
      billable_percentage: 50,
    });
    expect(cache.nodes.get(MUTATION)?.record).toMatchObject({
      effective_billing_rate: 900,
      billable_percentage: 50,
    });
    expect(cache.edges.get(mutationDerivedId(MUTATION, 1))?.edgeType).toBe(
      "assignment_of",
    );
    expect(cache.edges.get(mutationDerivedId(MUTATION, 2))?.edgeType).toBe(
      "assigned_to",
    );
    await applyUndo(cache, undo);
    expect(cache.nodes.has(MUTATION)).toBe(false);
  });

  it("checks the cancellation version before changing status", async () => {
    const cache = new MemoryCache();
    await seed(cache, MUTATION, "Assignment");
    await expect(
      applyOptimistic(context(cache), "assignment.cancel", {
        assignment_id: MUTATION,
        expected_version: 99,
      }),
    ).rejects.toMatchObject({ reason: "stale-state" });
    expect(cache.nodes.get(MUTATION)?.lifecycleStatus).toBe("Active");
    await applyOptimistic(context(cache), "assignment.cancel", {
      assignment_id: MUTATION,
      expected_version: 1,
    });
    expect(cache.nodes.get(MUTATION)?.lifecycleStatus).toBe("Canceled");
  });
});

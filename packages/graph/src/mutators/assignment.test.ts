import { mutationDerivedId } from "@vulto/schema";
import { describe, expect, it } from "vitest";
import { applyUndo } from "./cache";
import {
  applyOptimistic,
  OPTIMISTIC_MUTATORS,
  type MutatorContext,
} from "./foundation";
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

  it("updates only device-knowable rate fields and never writes governed_by", async () => {
    const cache = new MemoryCache();
    const assignment = "10000000-0000-4000-8000-000000000004";
    const card = "10000000-0000-4000-8000-000000000005";
    await seed(cache, EMPLOYEE, "Employee", { billing_rate_default: 800 });
    await seed(cache, assignment, "Assignment", {
      employee_id: EMPLOYEE,
      rate_card_id: null,
      rate_override_hourly: null,
      rate_override_reason: null,
      effective_billing_rate: 100,
    });

    await applyOptimistic(context(cache), "assignment.setRateCard", {
      assignment_id: assignment,
      rate_card_id: card,
    });
    expect(cache.nodes.get(assignment)?.record).toMatchObject({
      rate_card_id: card,
      effective_billing_rate: 100,
    });
    expect(
      [...cache.edges.values()].some((edge) => edge.edgeType === "governed_by"),
    ).toBe(false);

    await applyOptimistic(context(cache), "assignment.setRateOverride", {
      assignment_id: assignment,
      hourly: 155,
      reason: "Negotiated",
    });
    expect(cache.nodes.get(assignment)?.record).toMatchObject({
      rate_override_hourly: 155,
      rate_override_reason: "Negotiated",
      effective_billing_rate: 155,
    });

    await applyOptimistic(context(cache), "assignment.clearRateOverride", {
      assignment_id: assignment,
    });
    expect(cache.nodes.get(assignment)?.record).toMatchObject({
      rate_override_hourly: null,
      rate_override_reason: null,
      effective_billing_rate: 155,
    });
  });

  it("resolves clearRateOverride locally only when no card lookup is needed", async () => {
    const cache = new MemoryCache();
    const assignment = "10000000-0000-4000-8000-000000000004";
    await seed(cache, EMPLOYEE, "Employee", { billing_rate_default: 800 });
    await seed(cache, assignment, "Assignment", {
      employee_id: EMPLOYEE,
      rate_card_id: null,
      rate_override_hourly: 140,
      rate_override_reason: "Temporary",
      effective_billing_rate: 140,
    });
    await applyOptimistic(context(cache), "assignment.clearRateOverride", {
      assignment_id: assignment,
    });
    expect(cache.nodes.get(assignment)?.record["effective_billing_rate"]).toBe(100);
  });

  it("has no optimistic RateCard handler", async () => {
    expect(OPTIMISTIC_MUTATORS["rateCard.create"]).toBeUndefined();
    expect(OPTIMISTIC_MUTATORS["rateCard.update"]).toBeUndefined();
    expect(
      await applyOptimistic(context(new MemoryCache()), "rateCard.create", {
        name: "Standard",
        currency: "USD",
        lines: [],
      }),
    ).toEqual([]);
  });
});

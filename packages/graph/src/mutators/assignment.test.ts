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

const seedEdge = async (
  cache: MemoryCache,
  id: string,
  type: string,
  from: string,
  to: string,
) =>
  cache.putEdge({
    edgeId: id,
    edgeType: type,
    fromNodeId: from,
    toNodeId: to,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    isSoftDeleted: false,
    version: 1,
    record: {
      edge_id: id,
      edge_type: type,
      from_node_id: from,
      to_node_id: to,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: null,
    },
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

  it("gates an offline override from membership/manager facts and rolls it back", async () => {
    const membership = "10000000-0000-4000-8000-000000000010";
    const manager = "10000000-0000-4000-8000-000000000011";
    const membershipEdge = "20000000-0000-4000-8000-000000000010";
    const managerEdge = "20000000-0000-4000-8000-000000000011";
    const args = {
      proposed: {
        employee_id: EMPLOYEE,
        project_id: PROJECT,
        start_date: "2026-03-10",
        end_date: "2026-03-20",
        billable_percentage: 50,
      },
      reason: "Short launch sprint",
    };

    const ownerCache = new MemoryCache();
    await seed(ownerCache, EMPLOYEE, "Employee", { employee_type: "Ghost" });
    await seed(ownerCache, PROJECT, "Project");
    await seed(ownerCache, membership, "WorkspaceMembership", { role: "owner" });
    await seedEdge(ownerCache, membershipEdge, "membership_of", membership, USER);
    await seed(ownerCache, "10000000-0000-4000-8000-000000000012", "Assignment", {
      employee_id: EMPLOYEE,
      start_date: "2026-03-01",
      end_date: "2026-03-31",
      billable_percentage: 100,
    });
    const undo = await applyOptimistic(
      context(ownerCache),
      "conflictResolution.overrideAndProceed",
      args,
    );
    expect(ownerCache.nodes.get(MUTATION)?.record).toMatchObject({
      employee_id: EMPLOYEE,
      capacity_override_reason: "Short launch sprint",
      capacity_override_by: USER,
      capacity_override_at: "2026-03-01T00:00:00.000Z",
    });
    await applyUndo(ownerCache, undo);
    expect(ownerCache.nodes.has(MUTATION)).toBe(false);

    const managerCache = new MemoryCache();
    await seed(managerCache, EMPLOYEE, "Employee", { employee_type: "Ghost" });
    await seed(managerCache, PROJECT, "Project");
    await seed(managerCache, membership, "WorkspaceMembership", {
      role: "team-member",
    });
    await seed(managerCache, manager, "Employee", { user_id: USER });
    await seedEdge(managerCache, membershipEdge, "membership_of", membership, USER);
    await seedEdge(managerCache, managerEdge, "managed_by", EMPLOYEE, manager);
    await expect(
      applyOptimistic(
        context(managerCache),
        "conflictResolution.overrideAndProceed",
        args,
      ),
    ).resolves.toHaveLength(3);

    const deniedCache = new MemoryCache();
    await seed(deniedCache, EMPLOYEE, "Employee");
    await seed(deniedCache, PROJECT, "Project");
    await seed(deniedCache, membership, "WorkspaceMembership", {
      role: "team-member",
    });
    await seedEdge(deniedCache, membershipEdge, "membership_of", membership, USER);
    await expect(
      applyOptimistic(
        context(deniedCache),
        "conflictResolution.overrideAndProceed",
        args,
      ),
    ).rejects.toMatchObject({ reason: "not-authorized" });
    expect(deniedCache.nodes.has(MUTATION)).toBe(false);
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

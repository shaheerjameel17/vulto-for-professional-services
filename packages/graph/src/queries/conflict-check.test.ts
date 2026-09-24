import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteCache } from "../sync-client/cache";
import { openTestDatabase } from "../sync-client/test-database";
import { evaluateConflict } from "./conflict-check";

const ids = {
  caller: "10000000-0000-4000-8000-000000000001",
  membership: "10000000-0000-4000-8000-000000000002",
  employee: "10000000-0000-4000-8000-000000000003",
  manager: "10000000-0000-4000-8000-000000000004",
  entity: "10000000-0000-4000-8000-000000000005",
  calendar: "10000000-0000-4000-8000-000000000006",
  holiday: "10000000-0000-4000-8000-000000000007",
  project: "10000000-0000-4000-8000-000000000008",
  assignment: "10000000-0000-4000-8000-000000000009",
};

afterEach(() => vi.restoreAllMocks());

describe("VRS-F008 local conflict evaluation", () => {
  it("uses only cached working-day and caller-role facts across both thresholds", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const put = (id: string, type: string, record: Record<string, unknown>) =>
      cache.putNode({
        nodeId: id,
        nodeType: type,
        lifecycleStatus: "Active",
        isSoftDeleted: false,
        version: 1,
        record: {
          node_id: id,
          node_type: type,
          lifecycle_status: "Active",
          ...record,
        },
      });
    const edge = (id: string, type: string, from: string, to: string) =>
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
    await put(ids.membership, "WorkspaceMembership", { role: "owner" });
    await put(ids.employee, "Employee", {
      employee_type: "Ghost",
      location: null,
    });
    await put(ids.manager, "Employee", { user_id: ids.caller });
    await put(ids.entity, "Entity", {});
    await put(ids.calendar, "WorkingCalendar", {
      working_week: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        day,
        is_working: day <= 5,
        hours: day <= 5 ? 8 : 0,
      })),
      standard_daily_hours: 8,
      reduced_hours_periods: [],
    });
    await put(ids.holiday, "Holiday", {
      calendar_id: ids.calendar,
      date: "2026-03-04",
      applies_to_locations: null,
      is_half_day: false,
    });
    await put(ids.project, "Project", { name: "Alpha" });
    await put(ids.assignment, "Assignment", {
      employee_id: ids.employee,
      project_id: ids.project,
      start_date: "2026-03-02",
      end_date: "2026-03-08",
      billable_percentage: 80,
    });
    await edge(
      "20000000-0000-4000-8000-000000000001",
      "membership_of",
      ids.membership,
      ids.caller,
    );
    await edge(
      "20000000-0000-4000-8000-000000000002",
      "scoped_to_entity",
      ids.employee,
      ids.entity,
    );
    await edge(
      "20000000-0000-4000-8000-000000000003",
      "governed_by_calendar",
      ids.entity,
      ids.calendar,
    );
    await edge(
      "20000000-0000-4000-8000-000000000004",
      "managed_by",
      ids.employee,
      ids.manager,
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("network cut"));
    const common = {
      employeeId: ids.employee,
      startDate: "2026-03-02",
      endDate: "2026-03-08",
      nearCapacityWarningThreshold: 90,
      callerUserId: ids.caller,
    };
    const warning = await evaluateConflict(database, {
      ...common,
      billablePercentage: 15,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(warning).toMatchObject({
      currentTotal: 80,
      combinedTotal: 95,
      wouldConflict: false,
      wouldWarn: true,
      suggestedFit: 20,
      overlappingAssignments: [
        {
          assignmentId: ids.assignment,
          projectName: "Alpha",
          callerCanEdit: true,
        },
      ],
    });
    expect(warning.overlapWorkingDays).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-05",
      "2026-03-06",
    ]);
    expect(
      await evaluateConflict(database, { ...common, billablePercentage: 25 }),
    ).toMatchObject({ wouldConflict: true, wouldWarn: false, combinedTotal: 105 });
    expect(
      await evaluateConflict(database, {
        ...common,
        startDate: "2026-03-07",
        endDate: "2026-03-08",
        billablePercentage: 25,
      }),
    ).toMatchObject({
      currentTotal: 0,
      overlapWorkingDays: [],
      wouldConflict: false,
      wouldWarn: false,
    });
    await database.close();
  });
});

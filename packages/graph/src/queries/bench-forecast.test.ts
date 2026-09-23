import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteCache } from "../sync-client/cache";
import { openTestDatabase } from "../sync-client/test-database";
import { getBenchForecast } from "./bench-forecast";

const ids = {
  employee: "10000000-0000-4000-8000-000000000001",
  entity: "10000000-0000-4000-8000-000000000002",
  calendar: "10000000-0000-4000-8000-000000000003",
  project: "10000000-0000-4000-8000-000000000004",
  assignment: "10000000-0000-4000-8000-000000000005",
  skill: "10000000-0000-4000-8000-000000000006",
  ghostEmployee: "10000000-0000-4000-8000-000000000007",
  ghostAssignment: "10000000-0000-4000-8000-000000000008",
};

afterEach(() => vi.restoreAllMocks());

describe("the local Bench Forecast query", () => {
  it("derives bars and bench days with the network cut and applies the shared filters", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const put = (nodeId: string, nodeType: string, record: Record<string, unknown>) =>
      cache.putNode({
        nodeId,
        nodeType,
        lifecycleStatus: "Active",
        isSoftDeleted: false,
        version: 1,
        record: {
          node_id: nodeId,
          node_type: nodeType,
          lifecycle_status: "Active",
          ...record,
        },
      });
    await put(ids.employee, "Employee", {
      full_name: "Local Person",
      employee_type: "Employee",
      seniority_level: "Senior",
      department: "Engineering",
      location: null,
    });
    await put(ids.ghostEmployee, "Employee", {
      full_name: null,
      employee_type: "Ghost",
      job_title: "Planned consultant",
      seniority_level: "Senior",
      department: "Engineering",
      location: null,
    });
    await put(ids.entity, "Entity", { name: "Entity" });
    await put(ids.calendar, "WorkingCalendar", {
      working_week: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        day,
        is_working: day <= 5,
        hours: day <= 5 ? 8 : 0,
      })),
      standard_daily_hours: 8,
      reduced_hours_periods: [],
    });
    await put(ids.project, "Project", { name: "Alpha" });
    await put(ids.skill, "Skill", { name: "TypeScript" });
    await put(ids.assignment, "Assignment", {
      employee_id: ids.employee,
      project_id: ids.project,
      start_date: "2026-03-02",
      end_date: "2026-03-03",
      billable_percentage: 100,
    });
    await put(ids.ghostAssignment, "Assignment", {
      employee_id: ids.ghostEmployee,
      project_id: ids.project,
      start_date: "2026-03-02",
      end_date: "2026-03-03",
      billable_percentage: 100,
    });
    const edge = (
      edgeId: string,
      edgeType: string,
      fromNodeId: string,
      toNodeId: string,
    ) =>
      cache.putEdge({
        edgeId,
        edgeType,
        fromNodeId,
        toNodeId,
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        isSoftDeleted: false,
        version: 1,
        record: {
          edge_id: edgeId,
          edge_type: edgeType,
          from_node_id: fromNodeId,
          to_node_id: toNodeId,
          effective_from: "2026-01-01T00:00:00.000Z",
          effective_to: null,
        },
      });
    await edge(
      "20000000-0000-4000-8000-000000000001",
      "scoped_to_entity",
      ids.employee,
      ids.entity,
    );
    await edge(
      "20000000-0000-4000-8000-000000000004",
      "scoped_to_entity",
      ids.ghostEmployee,
      ids.entity,
    );
    await edge(
      "20000000-0000-4000-8000-000000000005",
      "has_skill",
      ids.ghostEmployee,
      ids.skill,
    );
    await edge(
      "20000000-0000-4000-8000-000000000002",
      "governed_by_calendar",
      ids.entity,
      ids.calendar,
    );
    await edge(
      "20000000-0000-4000-8000-000000000003",
      "has_skill",
      ids.employee,
      ids.skill,
    );
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("offline"));
    const result = await getBenchForecast(database, {
      window: { from_date: "2026-03-02", to_date: "2026-03-06" },
      filters: {
        skillIds: [ids.skill],
        seniorityLevels: ["Senior"],
        departments: ["Engineering"],
        entityIds: [ids.entity],
        availability: { fromDate: "2026-03-04", toDate: "2026-03-06" },
      },
      now: "2026-03-01T00:00:00.000Z",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      employeeId: ids.employee,
      benchDayCount: 3,
      assignments: [{ projectId: ids.project, projectName: "Alpha" }],
      benchPeriods: [{ fromDate: "2026-03-04", toDate: "2026-03-06", workingDays: 3 }],
    });
    expect(result.rows[1]).toMatchObject({
      employeeId: ids.ghostEmployee,
      employee: { employee_type: "Ghost" },
      benchDayCount: 3,
      assignments: [{ projectId: ids.project, projectName: "Alpha" }],
      benchPeriods: [{ fromDate: "2026-03-04", toDate: "2026-03-06", workingDays: 3 }],
    });
    await database.close();
  });
});

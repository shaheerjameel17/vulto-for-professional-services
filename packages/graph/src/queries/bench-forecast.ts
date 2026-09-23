import {
  isoDatesInclusive,
  matchesBenchForecastFilters,
  resolveWorkingDay,
  type BenchForecastFilters,
  type BenchForecastWindow,
  type ReducedHoursPeriod,
  type WorkingWeek,
} from "@vulto/schema";
import type { SyncDatabase } from "../sync-client/database";
import { localEdges, localNodes, type LocalEdge, type LocalNode } from "./cache-data";

export interface BenchAssignmentBar {
  readonly assignmentId: string;
  readonly projectId: string;
  readonly projectName: string | null;
  readonly clientId: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly billablePercentage: number;
}

export interface BenchPeriod {
  readonly fromDate: string;
  readonly toDate: string;
  readonly workingDays: number;
}

export interface BenchForecastRow {
  readonly employeeId: string;
  readonly employee: Readonly<Record<string, unknown>>;
  readonly assignments: readonly BenchAssignmentBar[];
  readonly benchPeriods: readonly BenchPeriod[];
  readonly benchDayCount: number;
}

const currentOpenEdge = (
  edges: readonly LocalEdge[],
  fromNodeId: string,
  type: string,
  now: string,
) =>
  edges.find(
    (edge) =>
      edge.edgeType === type &&
      edge.fromNodeId === fromNodeId &&
      edge.effectiveTo === null &&
      (edge.effectiveFrom === null || edge.effectiveFrom <= now),
  );

const groupBench = (
  days: readonly { date: string; fraction: number }[],
): BenchPeriod[] => {
  const groups: BenchPeriod[] = [];
  for (const day of days) {
    const prior = groups.at(-1);
    const priorNext = prior ? new Date(`${prior.toDate}T00:00:00.000Z`) : undefined;
    priorNext?.setUTCDate(priorNext.getUTCDate() + 1);
    if (prior && priorNext?.toISOString().slice(0, 10) === day.date) {
      groups[groups.length - 1] = {
        ...prior,
        toDate: day.date,
        workingDays: prior.workingDays + day.fraction,
      };
    } else {
      groups.push({ fromDate: day.date, toDate: day.date, workingDays: day.fraction });
    }
  }
  return groups;
};

const nodeMap = (nodes: readonly LocalNode[]) =>
  new Map(nodes.map((node) => [node.nodeId, node]));

export async function getBenchForecast(
  database: SyncDatabase,
  input: {
    readonly window: BenchForecastWindow;
    readonly filters?: BenchForecastFilters;
    readonly now?: string;
  },
): Promise<{ readonly rows: readonly BenchForecastRow[] }> {
  const now = input.now ?? new Date().toISOString();
  const nodes = await localNodes(database, [
    "Employee",
    "Assignment",
    "Project",
    "Client",
    "GhostResource",
    "OpenRole",
    "Entity",
    "WorkingCalendar",
    "Holiday",
    "WorkingPattern",
    "Skill",
  ]);
  const edges = await localEdges(database, [
    "scoped_to_entity",
    "governed_by_calendar",
    "pattern_for",
    "holiday_in",
    "has_skill",
    "belongs_to",
  ]);
  const byId = nodeMap(nodes);
  const assignments = nodes.filter(
    (node) => node.nodeType === "Assignment" && node.lifecycleStatus === "Active",
  );
  const visibleDates = isoDatesInclusive(input.window.from_date, input.window.to_date);
  const availability = input.filters?.availability;
  const derivedFrom = availability
    ? [input.window.from_date, availability.fromDate].sort()[0]!
    : input.window.from_date;
  const derivedTo = availability
    ? [input.window.to_date, availability.toDate].sort().at(-1)!
    : input.window.to_date;
  const derivedDates = isoDatesInclusive(derivedFrom, derivedTo);
  const rows: BenchForecastRow[] = [];
  for (const employee of nodes.filter(
    (node) =>
      node.nodeType === "Employee" &&
      node.lifecycleStatus === "Active" &&
      node.record["employee_type"] !== "Ghost",
  )) {
    const entityEdge = currentOpenEdge(edges, employee.nodeId, "scoped_to_entity", now);
    const entityId = entityEdge?.toNodeId ?? null;
    const calendarEdge =
      entityId === null
        ? undefined
        : edges.find(
            (edge) =>
              edge.edgeType === "governed_by_calendar" &&
              edge.fromNodeId === entityId &&
              byId.get(edge.toNodeId)?.lifecycleStatus === "Active",
          );
    const calendar = calendarEdge ? byId.get(calendarEdge.toNodeId) : undefined;
    if (!calendar) continue;
    const employeeAssignments = assignments.filter(
      (assignment) => assignment.record["employee_id"] === employee.nodeId,
    );
    const holidayNodes = nodes.filter(
      (node) =>
        node.nodeType === "Holiday" &&
        node.lifecycleStatus === "Active" &&
        node.record["calendar_id"] === calendar.nodeId,
    );
    const patterns = edges
      .filter(
        (edge) => edge.edgeType === "pattern_for" && edge.toNodeId === employee.nodeId,
      )
      .flatMap((edge) => {
        const node = byId.get(edge.fromNodeId);
        return node?.nodeType === "WorkingPattern" ? [node] : [];
      });
    const benchDays: { date: string; fraction: number }[] = [];
    for (const date of derivedDates) {
      const pattern = patterns
        .filter((candidate) => {
          const from = String(candidate.record["effective_from"]);
          const to = candidate.record["effective_to"] as string | null;
          return from <= date && (to === null || date < to);
        })
        .sort((a, b) =>
          String(b.record["effective_from"]).localeCompare(
            String(a.record["effective_from"]),
          ),
        )[0];
      const resolved = resolveWorkingDay({
        calendar: {
          workingWeek: calendar.record["working_week"] as WorkingWeek,
          standardDailyHours: Number(calendar.record["standard_daily_hours"] ?? 8),
          reducedHoursPeriods:
            (calendar.record["reduced_hours_periods"] as
              ReducedHoursPeriod[] | undefined) ?? [],
        },
        pattern: pattern
          ? { workingWeek: pattern.record["working_week"] as WorkingWeek }
          : null,
        holidays: holidayNodes.map((holiday) => ({
          date: String(holiday.record["date"]),
          appliesToLocations:
            (holiday.record["applies_to_locations"] as string[] | null | undefined) ??
            null,
          isHalfDay: holiday.record["is_half_day"] === true,
        })),
        date,
        location: (employee.record["location"] as string | null | undefined) ?? null,
      });
      const covered = employeeAssignments.some(
        (assignment) =>
          String(assignment.record["start_date"]) <= date &&
          date <= String(assignment.record["end_date"]),
      );
      if (resolved.isWorking && !covered) {
        benchDays.push({ date, fraction: resolved.dayFraction });
      }
    }
    const skillIds = edges
      .filter(
        (edge) => edge.edgeType === "has_skill" && edge.fromNodeId === employee.nodeId,
      )
      .map((edge) => edge.toNodeId);
    if (
      !matchesBenchForecastFilters(
        {
          skillIds,
          seniorityLevel:
            (employee.record["seniority_level"] as string | null | undefined) ?? null,
          department:
            (employee.record["department"] as string | null | undefined) ?? null,
          entityId,
          benchDays: benchDays.map(({ date }) => date),
        },
        input.filters,
      )
    ) {
      continue;
    }
    const bars = employeeAssignments
      .filter(
        (assignment) =>
          String(assignment.record["start_date"]) <= input.window.to_date &&
          input.window.from_date <= String(assignment.record["end_date"]),
      )
      .map((assignment): BenchAssignmentBar => {
        const projectId = String(assignment.record["project_id"]);
        const project = byId.get(projectId);
        const clientEdge = edges.find(
          (edge) => edge.edgeType === "belongs_to" && edge.fromNodeId === projectId,
        );
        return {
          assignmentId: assignment.nodeId,
          projectId,
          projectName: (project?.record["name"] as string | null | undefined) ?? null,
          clientId: clientEdge?.toNodeId ?? null,
          startDate: String(assignment.record["start_date"]),
          endDate: String(assignment.record["end_date"]),
          billablePercentage: Number(assignment.record["billable_percentage"]),
        };
      });
    const visibleBenchDays = benchDays.filter(({ date }) =>
      visibleDates.includes(date),
    );
    rows.push({
      employeeId: employee.nodeId,
      employee: employee.record,
      assignments: bars,
      benchPeriods: groupBench(visibleBenchDays),
      benchDayCount: visibleBenchDays.reduce((sum, day) => sum + day.fraction, 0),
    });
  }
  return { rows };
}

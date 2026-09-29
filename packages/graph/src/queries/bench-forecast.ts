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
  readonly version: number;
  readonly projectId: string;
  readonly projectName: string | null;
  readonly clientId: string | null;
  readonly clientName: string | null;
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
  readonly entityId: string | null;
  readonly entityName: string | null;
  readonly skills: readonly { readonly id: string; readonly name: string }[];
  readonly ghostResourceId: string | null;
  readonly ghostResourceVersion: number | null;
  readonly revenueGapAlertId: string | null;
  readonly calendarDays: readonly {
    readonly date: string;
    readonly isWorking: boolean;
    readonly note: string | null;
  }[];
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
  days: readonly { date: string; fraction: number; eligible: boolean }[],
): BenchPeriod[] => {
  const groups: BenchPeriod[] = [];
  let start: string | null = null;
  let end: string | null = null;
  let workingDays = 0;
  const close = () => {
    if (start !== null && end !== null && workingDays > 0)
      groups.push({ fromDate: start, toDate: end, workingDays });
    start = null;
    end = null;
    workingDays = 0;
  };
  for (const day of days) {
    if (!day.eligible) {
      close();
      continue;
    }
    start ??= day.date;
    end = day.date;
    workingDays += day.fraction;
  }
  close();
  return groups;
};

const nodeMap = (nodes: readonly LocalNode[]) =>
  new Map(nodes.map((node) => [node.nodeId, node]));

/** The local Assignment coverage rule shared by the forecast and skill holders. */
export const assignmentCoversDate = (assignment: LocalNode, date: string) =>
  assignment.nodeType === "Assignment" &&
  assignment.lifecycleStatus === "Active" &&
  String(assignment.record["start_date"]) <= date &&
  date <= String(assignment.record["end_date"]);

export async function getBenchForecast(
  database: SyncDatabase,
  input: {
    readonly window: BenchForecastWindow;
    readonly filters?: BenchForecastFilters;
    readonly now?: string;
  },
): Promise<{
  readonly rows: readonly BenchForecastRow[];
  readonly projects: readonly { readonly id: string; readonly name: string }[];
}> {
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
    "TimesheetEntry",
    "RevenueGapAlert",
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
    (node) => node.nodeType === "Employee" && node.lifecycleStatus === "Active",
  )) {
    const entityEdge = currentOpenEdge(edges, employee.nodeId, "scoped_to_entity", now);
    const entityId = entityEdge?.toNodeId ?? null;
    const entityName =
      entityId === null
        ? null
        : ((byId.get(entityId)?.record["name"] as string | null | undefined) ?? null);
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
    const ghostResource =
      employee.record["employee_type"] === "Ghost"
        ? nodes.find(
            (node) =>
              node.nodeType === "GhostResource" &&
              node.record["ghost_employee_id"] === employee.nodeId,
          )
        : undefined;
    const pitchDates = new Set(
      nodes
        .filter(
          (node) =>
            node.nodeType === "TimesheetEntry" &&
            node.record["employee_id"] === employee.nodeId &&
            node.record["time_category"] === "Pitch" &&
            typeof node.record["date"] === "string" &&
            derivedFrom <= node.record["date"] &&
            node.record["date"] <= derivedTo,
        )
        .map((node) => String(node.record["date"])),
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
    const derivedDayStates: { date: string; fraction: number; eligible: boolean }[] =
      [];
    const calendarDays: { date: string; isWorking: boolean; note: string | null }[] =
      [];
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
      const covered = employeeAssignments.some((assignment) =>
        assignmentCoversDate(assignment, date),
      );
      const holiday = holidayNodes.find(
        (candidate) =>
          candidate.record["date"] === date &&
          (candidate.record["applies_to_locations"] === null ||
            (Array.isArray(candidate.record["applies_to_locations"]) &&
              candidate.record["applies_to_locations"].includes(
                employee.record["location"],
              ))),
      );
      if (visibleDates.includes(date))
        calendarDays.push({
          date,
          isWorking: resolved.isWorking,
          note:
            typeof holiday?.record["name"] === "string" ? holiday.record["name"] : null,
        });
      const eligible = !covered && !pitchDates.has(date);
      derivedDayStates.push({
        date,
        eligible,
        fraction: eligible && resolved.isWorking ? resolved.dayFraction : 0,
      });
    }
    const benchDays = derivedDayStates.filter((day) => day.fraction > 0);
    const skillIds = edges
      .filter(
        (edge) => edge.edgeType === "has_skill" && edge.fromNodeId === employee.nodeId,
      )
      .map((edge) => edge.toNodeId);
    const skills = skillIds.flatMap((id) => {
      const skill = byId.get(id);
      return skill?.nodeType === "Skill" && typeof skill.record["name"] === "string"
        ? [{ id, name: skill.record["name"] }]
        : [];
    });
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
        const clientId = clientEdge?.toNodeId ?? null;
        return {
          assignmentId: assignment.nodeId,
          version: assignment.version,
          projectId,
          projectName: (project?.record["name"] as string | null | undefined) ?? null,
          clientId,
          clientName:
            clientId === null
              ? null
              : ((byId.get(clientId)?.record["name"] as string | null | undefined) ??
                null),
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
      entityId,
      entityName,
      skills,
      ghostResourceId: ghostResource?.nodeId ?? null,
      ghostResourceVersion: ghostResource?.version ?? null,
      revenueGapAlertId:
        nodes.find(
          (node) =>
            node.nodeType === "RevenueGapAlert" &&
            node.lifecycleStatus === "Active" &&
            node.record["employee_id"] === employee.nodeId,
        )?.nodeId ?? null,
      calendarDays,
      assignments: bars,
      benchPeriods: groupBench(
        derivedDayStates.filter(({ date }) => visibleDates.includes(date)),
      ),
      benchDayCount: visibleBenchDays.reduce((sum, day) => sum + day.fraction, 0),
    });
  }
  return {
    rows,
    projects: nodes
      .filter(
        (node) => node.nodeType === "Project" && node.lifecycleStatus === "Active",
      )
      .map((node) => ({
        id: node.nodeId,
        name:
          typeof node.record["name"] === "string" ? node.record["name"] : node.nodeId,
      })),
  };
}

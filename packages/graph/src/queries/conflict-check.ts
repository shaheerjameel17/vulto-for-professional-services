import {
  deriveEffectiveRoles,
  isoDatesInclusive,
  parseWorkspaceRoles,
  resolveWorkingDay,
  type ReducedHoursPeriod,
  type WorkingWeek,
} from "@vulto/schema";
import type { SyncDatabase } from "../sync-client/database";
import { localEdges, localNodes, type LocalEdge, type LocalNode } from "./cache-data";

export interface ConflictCheckInput {
  readonly employeeId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly billablePercentage: number;
  readonly excludeAssignmentId?: string;
  readonly nearCapacityWarningThreshold: number;
  readonly callerUserId: string;
}

export interface ConflictAssignment {
  readonly assignmentId: string;
  readonly projectName: string | null;
  readonly billablePercentage: number;
  readonly startDate: string;
  readonly endDate: string;
  readonly callerCanEdit: boolean;
}

export interface ConflictCheckResult {
  readonly currentTotal: number;
  readonly combinedTotal: number;
  readonly wouldConflict: boolean;
  readonly wouldWarn: boolean;
  readonly suggestedFit: number;
  readonly overlapWorkingDays: readonly string[];
  readonly overlappingAssignments: readonly ConflictAssignment[];
}

const byId = (nodes: readonly LocalNode[]) =>
  new Map(nodes.map((node) => [node.nodeId, node]));

const currentEdge = (
  edges: readonly LocalEdge[],
  fromNodeId: string,
  edgeType: string,
) =>
  edges.find(
    (edge) =>
      edge.fromNodeId === fromNodeId &&
      edge.edgeType === edgeType &&
      edge.effectiveTo === null,
  );

function callerRoles(
  nodes: readonly LocalNode[],
  edges: readonly LocalEdge[],
  callerUserId: string,
) {
  const membershipEdge = edges.find(
    (edge) => edge.edgeType === "membership_of" && edge.toNodeId === callerUserId,
  );
  const membership = membershipEdge
    ? nodes.find(
        (node) =>
          node.nodeId === membershipEdge.fromNodeId &&
          node.nodeType === "WorkspaceMembership",
      )
    : undefined;
  if (typeof membership?.record["role"] !== "string") return [];
  try {
    return parseWorkspaceRoles(membership.record["role"]);
  } catch {
    return [];
  }
}

/** VRS-F008's sub-100ms, best-effort local conflict computation (F259). */
export async function evaluateConflict(
  database: SyncDatabase,
  input: ConflictCheckInput,
): Promise<ConflictCheckResult> {
  const nodes = await localNodes(database, [
    "Assignment",
    "Employee",
    "Project",
    "WorkingCalendar",
    "Holiday",
    "WorkingPattern",
    "WorkspaceMembership",
  ]);
  const edges = await localEdges(database, [
    "scoped_to_entity",
    "governed_by_calendar",
    "pattern_for",
    "managed_by",
    "membership_of",
  ]);
  const nodesById = byId(nodes);
  const employee = nodesById.get(input.employeeId);
  const entityEdge = currentEdge(edges, input.employeeId, "scoped_to_entity");
  const calendarEdge = entityEdge
    ? edges.find(
        (edge) =>
          edge.edgeType === "governed_by_calendar" &&
          edge.fromNodeId === entityEdge.toNodeId &&
          nodesById.get(edge.toNodeId)?.lifecycleStatus === "Active",
      )
    : undefined;
  const calendar = calendarEdge ? nodesById.get(calendarEdge.toNodeId) : undefined;
  if (!employee || employee.nodeType !== "Employee" || !calendar) {
    throw new Error("not-found");
  }
  const holidays = nodes.filter(
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
      const node = nodesById.get(edge.fromNodeId);
      return node?.nodeType === "WorkingPattern" ? [node] : [];
    });
  const assignments = nodes.filter(
    (node) =>
      node.nodeType === "Assignment" &&
      node.lifecycleStatus === "Active" &&
      node.nodeId !== input.excludeAssignmentId &&
      node.record["employee_id"] === input.employeeId &&
      String(node.record["start_date"]) <= input.endDate &&
      input.startDate <= String(node.record["end_date"]),
  );
  const roles = deriveEffectiveRoles(callerRoles(nodes, edges, input.callerUserId));
  const managerEdge = currentEdge(edges, input.employeeId, "managed_by");
  const manager = managerEdge ? nodesById.get(managerEdge.toNodeId) : undefined;
  const callerCanEdit =
    roles.includes("owner") || manager?.record["user_id"] === input.callerUserId;
  const overlapWorkingDays: string[] = [];
  const overlappingIds = new Set<string>();
  let currentTotal = 0;
  for (const date of isoDatesInclusive(input.startDate, input.endDate)) {
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
    const day = resolveWorkingDay({
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
      holidays: holidays.map((holiday) => ({
        date: String(holiday.record["date"]),
        appliesToLocations:
          (holiday.record["applies_to_locations"] as string[] | null | undefined) ??
          null,
        isHalfDay: holiday.record["is_half_day"] === true,
      })),
      date,
      location: (employee.record["location"] as string | null | undefined) ?? null,
    });
    if (!day.isWorking) continue;
    const covering = assignments.filter(
      (assignment) =>
        String(assignment.record["start_date"]) <= date &&
        date <= String(assignment.record["end_date"]),
    );
    if (covering.length > 0) overlapWorkingDays.push(date);
    for (const assignment of covering) overlappingIds.add(assignment.nodeId);
    currentTotal = Math.max(
      currentTotal,
      covering.reduce(
        (sum, assignment) =>
          sum + Number(assignment.record["billable_percentage"] ?? 0),
        0,
      ),
    );
  }
  const combinedTotal = currentTotal + input.billablePercentage;
  return {
    currentTotal,
    combinedTotal,
    wouldConflict: combinedTotal > 100,
    wouldWarn:
      combinedTotal <= 100 && combinedTotal > input.nearCapacityWarningThreshold,
    suggestedFit: 100 - currentTotal,
    overlapWorkingDays,
    overlappingAssignments: assignments
      .filter((assignment) => overlappingIds.has(assignment.nodeId))
      .map((assignment) => {
        const project = nodesById.get(String(assignment.record["project_id"]));
        return {
          assignmentId: assignment.nodeId,
          projectName: (project?.record["name"] as string | null | undefined) ?? null,
          billablePercentage: Number(assignment.record["billable_percentage"]),
          startDate: String(assignment.record["start_date"]),
          endDate: String(assignment.record["end_date"]),
          callerCanEdit,
        };
      }),
  };
}

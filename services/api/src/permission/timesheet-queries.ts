import { addIsoDays } from "@vulto/schema";
import { expectedWeek } from "../graph/expected-week.js";
import { weekStartForEmployee } from "../graph/timesheet-week.js";
import {
  getNode,
  getNodes,
  incoming,
  outgoing,
  type GraphTx,
  type StoredNode,
} from "../graph/store.js";
import { hoursOn } from "./working-days-queries.js";
import { authorizeRead, filterReadable, withinRoleScopedReach } from "./interceptor.js";
import { listStaffedFor } from "./pitch-queries.js";
import type { MemberPrincipal } from "./principal.js";

/** `fd` and `hd` always use the specific day's F004 answer. */
export async function resolveTimesheetShortcut(
  tx: GraphTx,
  principal: MemberPrincipal,
  employeeId: string,
  date: string,
  shortcut: "fd" | "hd",
): Promise<number> {
  const hours = await hoursOn(tx, principal, employeeId, date);
  return shortcut === "fd" ? hours : hours / 2;
}

const readable = async (tx: GraphTx, principal: MemberPrincipal, node: StoredNode) => {
  const decision = await authorizeRead(tx, principal, {
    workspaceId: principal.workspaceId,
    nodeType: node.nodeType as
      "Employee" | "TimesheetEntry" | "TimesheetWeekSubmission" | "Assignment",
    nodeId: node.nodeId,
  });
  return decision.access === "read" || decision.access === "full";
};

async function weekRows(
  tx: GraphTx,
  principal: MemberPrincipal,
  employeeId: string,
  weekStart: string,
) {
  const entries = (
    await getNodes(tx, principal.workspaceId, { nodeType: "TimesheetEntry" })
  ).filter(
    (entry) =>
      entry.record["employee_id"] === employeeId &&
      entry.record["week_start_date"] === weekStart,
  );
  const permitted: StoredNode[] = [];
  for (const entry of entries)
    if (await readable(tx, principal, entry)) permitted.push(entry);
  return permitted;
}

async function weekStatus(
  tx: GraphTx,
  principal: MemberPrincipal,
  employeeId: string,
  weekStart: string,
): Promise<"Draft" | "Submitted" | "Not-Started"> {
  const entries = await weekRows(tx, principal, employeeId, weekStart);
  if (entries.length > 0)
    return entries.every((entry) => entry.lifecycleStatus === "Submitted")
      ? "Submitted"
      : "Draft";
  const markers = (
    await getNodes(tx, principal.workspaceId, {
      nodeType: "TimesheetWeekSubmission",
    })
  ).filter(
    (marker) =>
      marker.record["employee_id"] === employeeId &&
      marker.record["week_start_date"] === weekStart,
  );
  for (const marker of markers)
    if (await readable(tx, principal, marker)) return "Submitted";
  return "Not-Started";
}

/** An interceptor-filtered, server-side equivalent of the eventual weekly grid. */
export async function getWeek(
  tx: GraphTx,
  principal: MemberPrincipal,
  employeeId: string,
  requestedDate?: string,
) {
  const employee = await getNode(tx, principal.workspaceId, employeeId);
  if (
    !employee ||
    employee.isSoftDeleted ||
    employee.nodeType !== "Employee" ||
    !(await readable(tx, principal, employee))
  )
    return null;
  const date = requestedDate ?? new Date().toISOString().slice(0, 10);
  const weekStart = await weekStartForEmployee(
    tx,
    principal.workspaceId,
    employeeId,
    date,
  );
  if (weekStart === null) return null;
  const { columns, expectedWeeklyHours } = await expectedWeek(
    tx,
    principal.workspaceId,
    employeeId,
    weekStart,
    async (node) => {
      const decision = await authorizeRead(tx, principal, {
        workspaceId: principal.workspaceId,
        nodeType: node.nodeType as
          "Employee" | "Entity" | "WorkingCalendar" | "Holiday" | "WorkingPattern",
        nodeId: node.nodeId,
      });
      return decision.access === "read" || decision.access === "full";
    },
  );
  const assignments = await incoming(
    tx,
    principal.workspaceId,
    employeeId,
    "assignment_of",
  );
  const rows: { rowContext: string; label: string; entries: StoredNode[] }[] = [];
  const entries = await weekRows(tx, principal, employeeId, weekStart);
  for (const edge of assignments) {
    const assignment = await getNode(tx, principal.workspaceId, edge.fromNodeId);
    if (
      !assignment ||
      assignment.isSoftDeleted ||
      assignment.nodeType !== "Assignment" ||
      assignment.lifecycleStatus !== "Active" ||
      !(await readable(tx, principal, assignment))
    )
      continue;
    const from = String(assignment.record["start_date"] ?? "");
    const to = String(assignment.record["end_date"] ?? "");
    if (from > addIsoDays(weekStart, 6) || to < weekStart) continue;
    const [projectEdge] = await outgoing(
      tx,
      principal.workspaceId,
      assignment.nodeId,
      "assigned_to",
    );
    const project = projectEdge
      ? await getNode(tx, principal.workspaceId, projectEdge.toNodeId)
      : null;
    rows.push({
      rowContext: assignment.nodeId,
      label:
        typeof project?.record["name"] === "string"
          ? project.record["name"]
          : assignment.nodeId,
      entries: entries.filter(
        (entry) => entry.record["assignment_id"] === assignment.nodeId,
      ),
    });
  }
  rows.push({
    rowContext: "non-billable",
    label: "Non-Billable",
    entries: entries.filter((entry) => entry.record["time_category"] === "NonBillable"),
  });
  for (const pitch of await listStaffedFor(tx, principal, employeeId))
    rows.push({
      rowContext: pitch.pitchId,
      label: pitch.name,
      entries: entries.filter((entry) => entry.record["pitch_id"] === pitch.pitchId),
    });
  const status = await weekStatus(tx, principal, employeeId, weekStart);
  return {
    weekStartDate: weekStart,
    columns,
    rows,
    weekStatus: status === "Not-Started" ? "Draft" : status,
    expectedWeeklyHours,
  };
}

/** The compliance answer is filtered by the same Employee and entry grants. */
export async function listSubmissionStatus(
  tx: GraphTx,
  principal: MemberPrincipal,
  workspaceId: string,
  requestedDate: string,
) {
  if (workspaceId !== principal.workspaceId) return [];
  const employees = await filterReadable(
    tx,
    principal,
    await getNodes(tx, workspaceId, {
      nodeType: "Employee",
      lifecycleStatus: "Active",
    }),
  );
  const result: {
    employeeId: string;
    weekStatus: "Draft" | "Submitted" | "Not-Started";
  }[] = [];
  for (const employee of employees) {
    if (
      !(await withinRoleScopedReach(
        tx,
        principal,
        employee.nodeId,
        "TimesheetEntry",
        "record",
      ))
    )
      continue;
    const weekStart = await weekStartForEmployee(
      tx,
      workspaceId,
      employee.nodeId,
      requestedDate,
    );
    if (weekStart === null) continue;
    result.push({
      employeeId: employee.nodeId,
      weekStatus: await weekStatus(tx, principal, employee.nodeId, weekStart),
    });
  }
  return result.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}

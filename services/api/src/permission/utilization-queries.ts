import {
  addIsoDays,
  applyDisclosureControl,
  readKAnonymityThreshold,
  type UtilizationAgencyFilters,
} from "@vulto/schema";
import { weekStartForEmployee } from "../graph/timesheet-week.js";
import { getNode, getNodes, type GraphTx, type StoredNode } from "../graph/store.js";
import { authorizeRead, filterReadable } from "./interceptor.js";
import { listEmployees } from "./employee-queries.js";
import { resolveEmployeeForUser } from "./employee-link.js";
import type { MemberPrincipal, SystemPrincipal } from "./principal.js";
import { effectiveRoles } from "./roles.js";

const today = () => new Date().toISOString().slice(0, 10);
const oneDecimal = (value: number) => Math.round(value * 10) / 10;
const systemPrincipal = (workspaceId: string): SystemPrincipal => ({
  kind: "system",
  name: "utilization-snapshot-compute",
  workspaceId,
});

/** One person's stored pulse, under the ordinary row-scoped read decision. */
export async function getIndividual(
  tx: GraphTx,
  principal: MemberPrincipal,
  employeeId: string,
  requestedDate?: string,
) {
  const weekStart = await weekStartForEmployee(
    tx,
    principal.workspaceId,
    employeeId,
    requestedDate ?? today(),
  );
  if (weekStart === null) return null;
  const snapshot = (
    await getNodes(tx, principal.workspaceId, {
      nodeType: "UtilizationSnapshot",
    })
  ).find(
    (row) =>
      row.record["employee_id"] === employeeId &&
      row.record["week_start_date"] === weekStart,
  );
  if (!snapshot) return null;
  const decision = await authorizeRead(tx, principal, {
    workspaceId: principal.workspaceId,
    nodeType: "UtilizationSnapshot",
    nodeId: snapshot.nodeId,
  });
  return decision.access === "read" || decision.access === "full"
    ? snapshot.record
    : null;
}

interface Totals {
  readonly expected: number;
  readonly billable: number;
  readonly logged: number;
}

const emptyTotals = (): Totals => ({ expected: 0, billable: 0, logged: 0 });
const addSnapshot = (totals: Totals, row: StoredNode | undefined): Totals =>
  row === undefined
    ? totals
    : {
        expected: totals.expected + Number(row.record["expected_hours"] ?? 0),
        billable: totals.billable + Number(row.record["billable_hours"] ?? 0),
        logged: totals.logged + Number(row.record["logged_hours"] ?? 0),
      };

function rates(totals: Totals) {
  return {
    utilization:
      totals.expected === 0 ? 0 : oneDecimal((totals.billable / totals.expected) * 100),
    loggingCompleteness:
      totals.expected === 0 ? 0 : oneDecimal((totals.logged / totals.expected) * 100),
  };
}

/** F281: this entire cohort-and-sum path always uses the same system principal. */
async function agencyFiguresUnderSystemPrincipal(
  tx: GraphTx,
  workspaceId: string,
  requestedDate: string,
  filters: UtilizationAgencyFilters | undefined,
) {
  const system = systemPrincipal(workspaceId);
  const readContext = { systemOperation: "utilization-snapshot.read-cohort" as const };
  const active = await listEmployees(
    tx,
    system,
    { lifecycleStatus: "Active" },
    readContext,
  );
  // G05: these are the two eligibility exclusions, before any figure is read.
  const real = active.filter((row) => row.record["employee_type"] === "Employee");
  const eligible = real.filter((row) => Number(row.record["contracted_hours"]) > 0);
  const selected = eligible.filter(
    (row) =>
      !filters?.departments?.length ||
      (typeof row.record["department"] === "string" &&
        filters.departments.includes(row.record["department"])),
  );
  const readableSnapshots = await filterReadable(
    tx,
    system,
    await getNodes(tx, workspaceId, { nodeType: "UtilizationSnapshot" }),
    readContext,
  );
  const snapshots = readableSnapshots.filter(
    (row): row is StoredNode => !("restricted" in row),
  );
  const byPair = new Map(
    snapshots.map(
      (row) =>
        [`${row.record["employee_id"]}:${row.record["week_start_date"]}`, row] as const,
    ),
  );
  const sum = async (cohort: typeof eligible) => {
    let current = emptyTotals();
    let previous = emptyTotals();
    for (const employee of cohort) {
      const currentWeek = await weekStartForEmployee(
        tx,
        workspaceId,
        employee.employeeId,
        requestedDate,
      );
      const previousWeek = await weekStartForEmployee(
        tx,
        workspaceId,
        employee.employeeId,
        addIsoDays(requestedDate, -7),
      );
      if (currentWeek)
        current = addSnapshot(
          current,
          byPair.get(`${employee.employeeId}:${currentWeek}`),
        );
      if (previousWeek)
        previous = addSnapshot(
          previous,
          byPair.get(`${employee.employeeId}:${previousWeek}`),
        );
    }
    const currentRates = rates(current);
    return {
      aggregateUtilization: currentRates.utilization,
      aggregateLoggingCompleteness: currentRates.loggingCompleteness,
      weekOverWeekDelta: oneDecimal(
        currentRates.utilization - rates(previous).utilization,
      ),
      cohortSize: cohort.length,
    };
  };
  const workspace = await getNode(tx, workspaceId, workspaceId);
  const threshold = readKAnonymityThreshold(workspace?.record["k_anonymity_minimum"]);
  const selectedFigures = await sum(selected);
  const eligibleFigures = await sum(eligible);
  return {
    cohortSize: selected.length,
    controlled: applyDisclosureControl({
      cohortSize: selected.length,
      unfilteredCohortSize: eligible.length,
      threshold,
      computeFiltered: () => selectedFigures,
      computeUnfiltered: () => eligibleFigures,
    }),
  };
}

/** The ranked list is a separate ordinary-principal read, never a system read. */
async function comparisonForCaller(
  tx: GraphTx,
  principal: MemberPrincipal,
  requestedDate: string,
) {
  const roles = await effectiveRoles(tx, principal);
  const all = roles.includes("owner") || roles.includes("hr-admin");
  if (!all && !roles.includes("manager")) return undefined;
  const listed = await listEmployees(tx, principal, { lifecycleStatus: "Active" });
  const rows = await getNodes(tx, principal.workspaceId, {
    nodeType: "UtilizationSnapshot",
  });
  const perEmployee: { employeeId: string; utilizationRate: number }[] = [];
  for (const employee of listed) {
    if (
      employee.record["employee_type"] !== "Employee" ||
      Number(employee.record["contracted_hours"]) <= 0
    )
      continue;
    const week = await weekStartForEmployee(
      tx,
      principal.workspaceId,
      employee.employeeId,
      requestedDate,
    );
    const snapshot = rows.find(
      (row) =>
        row.record["employee_id"] === employee.employeeId &&
        row.record["week_start_date"] === week,
    );
    if (!snapshot) continue;
    const decision = await authorizeRead(tx, principal, {
      workspaceId: principal.workspaceId,
      nodeType: "UtilizationSnapshot",
      nodeId: snapshot.nodeId,
    });
    if (
      (decision.access !== "read" && decision.access !== "full") ||
      (!all && decision.role !== "manager")
    )
      continue;
    perEmployee.push({
      employeeId: employee.employeeId,
      utilizationRate: Number(snapshot.record["utilization_rate"] ?? 0),
    });
  }
  return perEmployee.sort((a, b) => b.utilizationRate - a.utilizationRate);
}

/** Role-independent agency figures; role-scoped ranking and own pulse. */
export async function getAgencyAggregate(
  tx: GraphTx,
  principal: MemberPrincipal,
  workspaceId: string,
  requestedDate?: string,
  filters?: UtilizationAgencyFilters,
) {
  if (workspaceId !== principal.workspaceId) throw new Error("workspace-mismatch");
  const date = requestedDate ?? today();
  const controlled = await agencyFiguresUnderSystemPrincipal(
    tx,
    workspaceId,
    date,
    filters,
  );
  const ownEmployeeId = await resolveEmployeeForUser(tx, workspaceId, principal.userId);
  const own =
    ownEmployeeId === null
      ? null
      : await getIndividual(tx, principal, ownEmployeeId, date);
  const perEmployee = await comparisonForCaller(tx, principal, date);
  const aggregate =
    controlled.controlled.state === "suppressed"
      ? {
          aggregateUtilization: { state: "suppressed" as const },
          aggregateLoggingCompleteness: { state: "suppressed" as const },
          weekOverWeekDelta: { state: "suppressed" as const },
          cohortSize: controlled.cohortSize,
        }
      : { ...controlled.controlled.value, cohortSize: controlled.cohortSize };
  return {
    ...aggregate,
    own,
    ...(perEmployee === undefined ? {} : { perEmployee }),
  };
}

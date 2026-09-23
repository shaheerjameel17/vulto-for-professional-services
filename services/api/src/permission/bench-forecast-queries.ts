import {
  applyDisclosureControl,
  isoDatesInclusive,
  matchesBenchForecastFilters,
  readKAnonymityThreshold,
  type BenchForecastFilterCandidate,
  type BenchForecastFilters,
  type BenchForecastWindow,
  type NodeType,
} from "@vulto/schema";
import type { KeyServices } from "../crypto/keys.js";
import { resolveEntityAssignment } from "../graph/entity-resolution.js";
import {
  countWorkingDays as countWorkingDaysFromGraph,
  resolvedDayOn,
  type WorkingDaysReadGuard,
} from "../graph/working-days.js";
import {
  getNode,
  getNodes,
  outgoing,
  type GraphTx,
  type StoredNode,
} from "../graph/store.js";
import { readProtected } from "../protected/read.js";
import type { Principal } from "./principal.js";
import { authorizeRead, type InterceptorContext } from "./interceptor.js";
import { listEmployees } from "./employee-queries.js";

interface CohortEmployee {
  readonly node: StoredNode;
  readonly candidate: BenchForecastFilterCandidate;
}

export function compensationCostForBenchDay(input: {
  readonly amount: number;
  readonly frequency: string;
  readonly hours: number;
  readonly dayFraction: number;
  readonly workingDaysInYear: number;
}): number {
  if (input.frequency === "Hourly") return input.amount * input.hours;
  if (input.workingDaysInYear <= 0) return 0;
  const annual = input.frequency === "Monthly" ? input.amount * 12 : input.amount;
  return (annual / input.workingDaysInYear) * input.dayFraction;
}

const readGuard =
  (
    tx: GraphTx,
    principal: Principal,
    context: InterceptorContext,
  ): WorkingDaysReadGuard =>
  async (node) => {
    const decision = await authorizeRead(
      tx,
      principal,
      {
        workspaceId: principal.workspaceId,
        nodeType: node.nodeType as NodeType,
        nodeId: node.nodeId,
      },
      context,
    );
    return decision.access === "read" || decision.access === "full";
  };

const assignmentCovers = (assignment: StoredNode, date: string) =>
  assignment.lifecycleStatus === "Active" &&
  String(assignment.record["start_date"]) <= date &&
  date <= String(assignment.record["end_date"]);

async function assignmentsFor(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
): Promise<StoredNode[]> {
  return (
    await getNodes(tx, workspaceId, {
      nodeType: "Assignment",
      lifecycleStatus: "Active",
    })
  ).filter((node) => node.record["employee_id"] === employeeId);
}

async function cohortEmployee(
  tx: GraphTx,
  principal: Principal,
  employee: StoredNode,
  derivedWindow: { readonly fromDate: string; readonly toDate: string },
  now: string,
  context: InterceptorContext,
): Promise<CohortEmployee> {
  const guard = readGuard(tx, principal, context);
  const assignments = await assignmentsFor(tx, principal.workspaceId, employee.nodeId);
  const benchDays: string[] = [];
  for (const date of isoDatesInclusive(derivedWindow.fromDate, derivedWindow.toDate)) {
    const day = await resolvedDayOn(
      tx,
      principal.workspaceId,
      employee.nodeId,
      date,
      guard,
    );
    if (
      day.isWorking &&
      !assignments.some((assignment) => assignmentCovers(assignment, date))
    ) {
      benchDays.push(date);
    }
  }
  const skills = (
    await outgoing(tx, principal.workspaceId, employee.nodeId, "has_skill")
  )
    .filter((edge) => !edge.isSoftDeleted)
    .map((edge) => edge.toNodeId);
  const entity = await resolveEntityAssignment(
    tx,
    principal.workspaceId,
    employee.nodeId,
    now,
  );
  return {
    node: employee,
    candidate: {
      skillIds: skills,
      seniorityLevel:
        (employee.record["seniority_level"] as string | null | undefined) ?? null,
      department: (employee.record["department"] as string | null | undefined) ?? null,
      entityId: entity?.entity.nodeId ?? null,
      benchDays,
    },
  };
}

async function authorizedCohort(
  tx: GraphTx,
  principal: Principal,
  window: BenchForecastWindow,
  filters: BenchForecastFilters | undefined,
  now: string,
  context: InterceptorContext,
  employeeType: "Employee" | "Ghost",
): Promise<CohortEmployee[]> {
  const listed = await listEmployees(
    tx,
    principal,
    { lifecycleStatus: "Active" },
    context,
  );
  const fromDate = filters?.availability
    ? [window.from_date, filters.availability.fromDate].sort()[0]!
    : window.from_date;
  const toDate = filters?.availability
    ? [window.to_date, filters.availability.toDate].sort().at(-1)!
    : window.to_date;
  const cohort: CohortEmployee[] = [];
  for (const summary of listed) {
    if (summary.record["employee_type"] !== employeeType) continue;
    const node = await getNode(tx, principal.workspaceId, summary.employeeId);
    if (node) {
      cohort.push(
        await cohortEmployee(tx, principal, node, { fromDate, toDate }, now, context),
      );
    }
  }
  return cohort;
}

interface UtilizationTotals {
  readonly capacity: number;
  readonly billable: number;
}

async function utilizationTotals(
  tx: GraphTx,
  principal: Principal,
  cohort: readonly CohortEmployee[],
  window: BenchForecastWindow,
  context: InterceptorContext,
): Promise<UtilizationTotals> {
  const guard = readGuard(tx, principal, context);
  let capacity = 0;
  let billable = 0;
  for (const employee of cohort) {
    const assignments = await assignmentsFor(
      tx,
      principal.workspaceId,
      employee.node.nodeId,
    );
    for (const date of isoDatesInclusive(window.from_date, window.to_date)) {
      const day = await resolvedDayOn(
        tx,
        principal.workspaceId,
        employee.node.nodeId,
        date,
        guard,
      );
      if (!day.isWorking) continue;
      capacity += day.dayFraction;
      const percentage = assignments
        .filter((assignment) => assignmentCovers(assignment, date))
        .reduce(
          (sum, assignment) =>
            sum + Number(assignment.record["billable_percentage"] ?? 0),
          0,
        );
      billable += (percentage / 100) * day.dayFraction;
    }
  }
  return { capacity, billable };
}

export async function getBenchForecastAggregate(
  tx: GraphTx,
  principal: Principal,
  input: {
    readonly window: BenchForecastWindow;
    readonly filters?: BenchForecastFilters;
  },
  context: InterceptorContext = {},
  now = new Date().toISOString(),
) {
  const base = await authorizedCohort(
    tx,
    principal,
    input.window,
    input.filters,
    now,
    context,
    "Employee",
  );
  const ghosts = await authorizedCohort(
    tx,
    principal,
    input.window,
    input.filters,
    now,
    context,
    "Ghost",
  );
  const filtered = base.filter((employee) =>
    matchesBenchForecastFilters(employee.candidate, input.filters),
  );
  const filteredGhosts = ghosts.filter((employee) =>
    matchesBenchForecastFilters(employee.candidate, input.filters),
  );
  const workspace = await getNode(tx, principal.workspaceId, principal.workspaceId);
  const threshold = readKAnonymityThreshold(workspace?.record["k_anonymity_minimum"]);
  const [filteredTotals, unfilteredTotals, filteredGhostTotals, ghostTotals] =
    await Promise.all([
      utilizationTotals(tx, principal, filtered, input.window, context),
      utilizationTotals(tx, principal, base, input.window, context),
      utilizationTotals(tx, principal, filteredGhosts, input.window, context),
      utilizationTotals(tx, principal, ghosts, input.window, context),
    ]);
  const filteredValue =
    filteredTotals.capacity === 0
      ? 0
      : filteredTotals.billable / filteredTotals.capacity;
  const unfilteredValue =
    unfilteredTotals.capacity === 0
      ? 0
      : unfilteredTotals.billable / unfilteredTotals.capacity;
  const filteredGhostContribution =
    filteredTotals.capacity === 0
      ? 0
      : filteredGhostTotals.billable / filteredTotals.capacity;
  const unfilteredGhostContribution =
    unfilteredTotals.capacity === 0
      ? 0
      : ghostTotals.billable / unfilteredTotals.capacity;
  const controlled = applyDisclosureControl({
    cohortSize: filtered.length,
    unfilteredCohortSize: base.length,
    threshold,
    computeFiltered: () => filteredValue,
    computeUnfiltered: () => unfilteredValue,
  });
  const controlledGhost = applyDisclosureControl({
    cohortSize: filtered.length,
    unfilteredCohortSize: base.length,
    threshold,
    computeFiltered: () => filteredGhostContribution,
    computeUnfiltered: () => unfilteredGhostContribution,
  });
  return {
    aggregateUtilization:
      controlled.state === "suppressed"
        ? ({ state: "suppressed" } as const)
        : controlled.value,
    ghostContribution:
      controlledGhost.state === "suppressed"
        ? ({ state: "suppressed" } as const)
        : controlledGhost.value,
    cohortSize: filtered.length,
  };
}

export async function getBenchForecastCosts(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  input: {
    readonly employeeIds: readonly string[];
    readonly window: BenchForecastWindow;
  },
  context: InterceptorContext = {},
) {
  const allowed = new Set(
    (await listEmployees(tx, principal, {}, context)).map(
      ({ employeeId }) => employeeId,
    ),
  );
  const ids = [...new Set(input.employeeIds)].filter((id) => allowed.has(id));
  const protectedValues = await readProtected(
    tx,
    services,
    principal,
    { nodeIds: ids, partitions: ["compensation"] },
    context,
  );
  const compensation = new Map(
    protectedValues.flatMap((item) =>
      item.state === "available"
        ? [[item.node_id, item.value as Record<string, unknown>] as const]
        : [],
    ),
  );
  const costs: Record<string, { amount: number; currency: string | null } | null> = {};
  const guard = readGuard(tx, principal, context);
  for (const requestedId of input.employeeIds) {
    const value = compensation.get(requestedId);
    const employee = allowed.has(requestedId)
      ? await getNode(tx, principal.workspaceId, requestedId)
      : null;
    if (!value || !employee) {
      costs[requestedId] = null;
      continue;
    }
    const amount = value["base_compensation_amount"];
    const frequency = value["compensation_frequency"];
    if (typeof amount !== "number" || typeof frequency !== "string") {
      costs[requestedId] = null;
      continue;
    }
    const assignments = await assignmentsFor(tx, principal.workspaceId, requestedId);
    let total = 0;
    const yearlyDenominators = new Map<string, number>();
    for (const date of isoDatesInclusive(
      input.window.from_date,
      input.window.to_date,
    )) {
      const day = await resolvedDayOn(
        tx,
        principal.workspaceId,
        requestedId,
        date,
        guard,
      );
      if (
        !day.isWorking ||
        assignments.some((assignment) => assignmentCovers(assignment, date))
      )
        continue;
      if (frequency === "Hourly") {
        total += compensationCostForBenchDay({
          amount,
          frequency,
          hours: day.hours,
          dayFraction: day.dayFraction,
          workingDaysInYear: 0,
        });
        continue;
      }
      const year = date.slice(0, 4);
      let denominator = yearlyDenominators.get(year);
      if (denominator === undefined) {
        denominator = (
          await countWorkingDaysFromGraph(
            tx,
            principal.workspaceId,
            requestedId,
            `${year}-01-01`,
            `${year}-12-31`,
            guard,
          )
        ).days;
        yearlyDenominators.set(year, denominator);
      }
      if (denominator > 0) {
        total += compensationCostForBenchDay({
          amount,
          frequency,
          hours: day.hours,
          dayFraction: day.dayFraction,
          workingDaysInYear: denominator,
        });
      }
    }
    costs[requestedId] = {
      amount: total,
      currency: (value["compensation_currency"] as string | null | undefined) ?? null,
    };
  }
  return { costs };
}

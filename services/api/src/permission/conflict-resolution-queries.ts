import { capacityTotalsFor } from "../mutations/assignment.js";
import { getNodes, type GraphTx } from "../graph/store.js";
import {
  filterReadable,
  withinRoleScopedReach,
  type InterceptorContext,
} from "./interceptor.js";
import type { MemberPrincipal } from "./principal.js";

export interface OvercommittedEmployee {
  readonly employeeId: string;
  readonly combinedTotal: number;
  readonly overlapWindow: {
    readonly fromDate: string;
    readonly toDate: string;
  };
  readonly hasRecordedOverride: boolean;
}

/** G06: a read-only safety net. Scheduling belongs to VPS-A006. */
export async function sweepOvercommitted(
  tx: GraphTx,
  principal: MemberPrincipal,
  context: InterceptorContext = {},
): Promise<OvercommittedEmployee[]> {
  const employees = await filterReadable(
    tx,
    principal,
    await getNodes(tx, principal.workspaceId, {
      nodeType: "Employee",
      lifecycleStatus: "Active",
    }),
    context,
  );
  const assignments = await getNodes(tx, principal.workspaceId, {
    nodeType: "Assignment",
    lifecycleStatus: "Active",
  });
  const result: OvercommittedEmployee[] = [];
  for (const employee of employees) {
    if (
      !(await withinRoleScopedReach(
        tx,
        principal,
        employee.nodeId,
        "Employee",
        "operational",
        context,
      ))
    )
      continue;
    const owned = assignments.filter(
      (assignment) => assignment.record["employee_id"] === employee.nodeId,
    );
    if (owned.length < 2) continue;
    const fromDate = owned
      .map((assignment) => String(assignment.record["start_date"]))
      .sort()[0]!;
    const toDate = owned
      .map((assignment) => String(assignment.record["end_date"]))
      .sort()
      .at(-1)!;
    const totals = await capacityTotalsFor(
      { tx, principal },
      employee.nodeId,
      fromDate,
      toDate,
    );
    const overDates = [...totals.totalsByDate]
      .filter(([, total]) => total > 100)
      .map(([date]) => date);
    if (overDates.length === 0) continue;
    result.push({
      employeeId: employee.nodeId,
      combinedTotal: Math.max(
        ...overDates.map((date) => totals.totalsByDate.get(date)!),
      ),
      overlapWindow: {
        fromDate: overDates[0]!,
        toDate: overDates.at(-1)!,
      },
      hasRecordedOverride: totals.overlappingAssignments.some(
        (assignment) =>
          typeof assignment.record["capacity_override_reason"] === "string" &&
          String(assignment.record["capacity_override_reason"]).length > 0,
      ),
    });
  }
  return result;
}

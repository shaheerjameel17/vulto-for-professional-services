import { db } from "../db.js";
import { getNode, getNodes, type GraphTx, type StoredNode } from "../graph/store.js";
import { revenueGapAlertEvaluate } from "../mutations/revenue-gap-alert.js";
import { filterReadable } from "./interceptor.js";
import type { MemberPrincipal } from "./principal.js";

/** An ordinary, caller-scoped Tier 0 read; no derived system access leaks here. */
export async function listActiveRevenueGapAlerts(
  tx: GraphTx,
  principal: MemberPrincipal,
  workspaceId: string,
) {
  if (workspaceId !== principal.workspaceId) return [];
  const candidates = await getNodes(tx, workspaceId, {
    nodeType: "RevenueGapAlert",
    lifecycleStatus: "Active",
  });
  const eligible: StoredNode[] = [];
  for (const row of candidates) {
    const employeeId = row.record["employee_id"];
    const employee =
      typeof employeeId === "string"
        ? await getNode(tx, workspaceId, employeeId)
        : null;
    if (
      employee &&
      !employee.isSoftDeleted &&
      employee.nodeType === "Employee" &&
      employee.record["employee_type"] === "Employee"
    )
      eligible.push(row);
  }
  const rows = await filterReadable(tx, principal, eligible);
  return rows
    .filter((row): row is StoredNode => !("restricted" in row))
    .sort(
      (a, b) =>
        Number(b.record["accumulated_cost"]) - Number(a.record["accumulated_cost"]),
    )
    .map((row) => ({ alertId: row.nodeId, record: row.record }));
}

/** Manual authenticated stand-in until VPS-A006's scheduler exists. */
export async function sweepRevenueGapAlerts(workspaceId: string) {
  const employeeIds = await db.transaction(async (tx) =>
    (
      await getNodes(tx, workspaceId, {
        nodeType: "Employee",
        lifecycleStatus: "Active",
      })
    )
      .filter((row) => row.record["employee_type"] === "Employee")
      .map((row) => row.nodeId),
  );
  for (const employeeId of employeeIds)
    await revenueGapAlertEvaluate(workspaceId, employeeId);
  return { evaluatedCount: employeeIds.length };
}

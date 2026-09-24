import { randomUUID } from "node:crypto";
import {
  BENCH_ALERT_THRESHOLD_DAYS,
  revenueGapAlertEvaluateDefinition,
  revenueGapAlertFieldsSchema,
  resolveDailyCost,
  severityFor,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type MutationArgs,
} from "@vulto/schema";
import { audienceMaterializer } from "../audience/materializer.js";
import { db } from "../db.js";
import {
  getNode,
  getNodes,
  insertEdge,
  insertNode,
  updateNodeFields,
} from "../graph/store.js";
import { ensureSystemActor } from "../graph/system-actor.js";
import type { GraphTx } from "../graph/tx.js";
import { computeBenchStatus } from "../permission/bench-forecast-queries.js";
import { authorizeWrite } from "../permission/interceptor.js";
import type { SystemPrincipal } from "../permission/principal.js";
import { MutationRejection, type ServerMutation } from "./types.js";

const principalFor = (workspaceId: string): SystemPrincipal => ({
  kind: "system",
  name: "revenue-gap-alert-evaluate",
  workspaceId,
});

const todayFrom = (now: string) => now.slice(0, 10);

async function evaluateInTransaction(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  now: string,
): Promise<string | null> {
  const employee = await getNode(tx, workspaceId, employeeId);
  // G09 applies before any calculation, including the reactive path.
  if (
    !employee ||
    employee.isSoftDeleted ||
    employee.nodeType !== "Employee" ||
    employee.record["employee_type"] !== "Employee"
  )
    return null;
  const today = todayFrom(now);
  const { benchDays, benchStartDate } = await computeBenchStatus(
    tx,
    workspaceId,
    employeeId,
    today,
    async () => true,
  );
  const active = (
    await getNodes(tx, workspaceId, {
      nodeType: "RevenueGapAlert",
      lifecycleStatus: "Active",
    })
  ).filter((row) => row.record["employee_id"] === employeeId);
  if (active.length > 1) throw new Error("duplicate-active-revenue-gap-alert");
  const alert = active[0];
  const assignments = (
    await getNodes(tx, workspaceId, { nodeType: "Assignment" })
  ).filter(
    (row) =>
      row.record["employee_id"] === employeeId && row.lifecycleStatus === "Active",
  );
  const current = assignments.find(
    (row) =>
      String(row.record["start_date"]) <= today &&
      today <= String(row.record["end_date"]),
  );
  if (benchDays.length === 0) {
    // G07: Pitch time or a nonworking day cannot resolve an alert. Only a
    // currently covering Assignment supplies the real resolution identity.
    if (!alert || !current) return alert?.nodeId ?? null;
    const system = principalFor(workspaceId);
    const decision = await authorizeWrite(
      tx,
      system,
      {
        kind: "node",
        workspaceId,
        nodeType: "RevenueGapAlert",
        nodeId: alert.nodeId,
        partitionKey: "record",
      },
      { operation: "update" },
      { systemOperation: "revenue-gap-alert.write" },
    );
    if (!decision.allowed)
      throw new Error(`revenue-gap-write-denied:${decision.reason}`);
    const actorId = await ensureSystemActor(tx, workspaceId, system.name, now);
    const patch = {
      lifecycle_status: "Resolved",
      resolved_at: now,
      resolved_by: "system",
      resolved_by_assignment_id: current.nodeId,
      ...updateStamp("RevenueGapAlert", { workspaceId, userId: actorId, now }),
    };
    revenueGapAlertFieldsSchema.parse({ ...alert.record, ...patch });
    await updateNodeFields(tx, workspaceId, alert.nodeId, null, patch);
    await audienceMaterializer.onRowsChanged(tx, [alert.nodeId]);
    return alert.nodeId;
  }
  if (benchDays.length < BENCH_ALERT_THRESHOLD_DAYS) return alert?.nodeId ?? null;
  const latestEnded = assignments
    .filter((row) => String(row.record["end_date"]) < today)
    .sort((a, b) =>
      String(b.record["end_date"]).localeCompare(String(a.record["end_date"])),
    )[0];
  const dailyCost = resolveDailyCost(
    (latestEnded?.record as { effective_billing_rate?: number | null } | undefined) ??
      null,
    employee.record as { billing_rate_default?: number | null },
  );
  const severity = severityFor(benchDays.length);
  const fields = {
    bench_start_date: benchStartDate!,
    bench_days: benchDays.length,
    daily_cost: dailyCost,
    accumulated_cost: dailyCost * benchDays.length,
    severity,
  };
  if (
    alert &&
    alert.record["bench_start_date"] === fields.bench_start_date &&
    alert.record["bench_days"] === fields.bench_days &&
    alert.record["daily_cost"] === fields.daily_cost &&
    alert.record["accumulated_cost"] === fields.accumulated_cost &&
    alert.record["severity"] === fields.severity
  )
    return alert.nodeId;
  const system = principalFor(workspaceId);
  const alertId = alert?.nodeId ?? randomUUID();
  const decision = await authorizeWrite(
    tx,
    system,
    {
      kind: "node",
      workspaceId,
      nodeType: "RevenueGapAlert",
      nodeId: alertId,
      partitionKey: "record",
    },
    { operation: alert ? "update" : "create" },
    { systemOperation: "revenue-gap-alert.write" },
  );
  if (!decision.allowed) throw new Error(`revenue-gap-write-denied:${decision.reason}`);
  const actorId = await ensureSystemActor(tx, workspaceId, system.name, now);
  const provenance = { workspaceId, userId: actorId, now };
  if (alert) {
    const rank = { Low: 0, Medium: 1, High: 2 } as const;
    const oldSeverity = alert.record["severity"] as keyof typeof rank;
    const patch = {
      ...fields,
      escalated_at:
        rank[severity] > rank[oldSeverity] ? now : alert.record["escalated_at"],
      ...updateStamp("RevenueGapAlert", provenance),
    };
    revenueGapAlertFieldsSchema.parse({ ...alert.record, ...patch });
    await updateNodeFields(tx, workspaceId, alertId, null, patch);
    await audienceMaterializer.onRowsChanged(tx, [alertId]);
    return alertId;
  }
  const edgeId = randomUUID();
  const edgeDecision = await authorizeWrite(
    tx,
    system,
    {
      kind: "edge",
      workspaceId,
      edgeType: "triggered_by",
      edgeId,
      fromNodeType: "RevenueGapAlert",
      fromNodeId: alertId,
      toNodeType: "Employee",
      toNodeId: employeeId,
    },
    { operation: "create" },
  );
  if (!edgeDecision.allowed)
    throw new Error(`revenue-gap-edge-denied:${edgeDecision.reason}`);
  const row = stampNewNode(
    {
      node_id: alertId,
      node_type: "RevenueGapAlert",
      schema_version: 1,
      lifecycle_status: "Active",
      alert_id: alertId,
      workspace_id: workspaceId,
      employee_id: employeeId,
      ...fields,
      escalated_at: null,
      dismissed_at: null,
      resolved_at: null,
      resolved_by: null,
      resolved_by_assignment_id: null,
    },
    "RevenueGapAlert",
    provenance,
  );
  revenueGapAlertFieldsSchema.parse(row);
  await insertNode(tx, row);
  await insertEdge(
    tx,
    workspaceId,
    stampNewEdge(
      {
        edge_id: edgeId,
        edge_type: "triggered_by",
        from_node_id: alertId,
        to_node_id: employeeId,
        effective_from: now,
        effective_to: null,
      },
      provenance,
    ),
  );
  await audienceMaterializer.onRowsChanged(tx, [alertId, edgeId]);
  return alertId;
}

/** Internal named mutation, never a client upload or direct router entry. */
export async function revenueGapAlertEvaluate(
  workspaceId: string,
  employeeId: string,
  now = new Date().toISOString(),
): Promise<{ alertId: string | null }> {
  const args = revenueGapAlertEvaluateDefinition.input.parse({
    employee_id: employeeId,
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const alertId = await db.transaction(
        (tx) => evaluateInTransaction(tx, workspaceId, args.employee_id, now),
        { isolationLevel: "serializable" },
      );
      return { alertId };
    } catch (error) {
      const code =
        (error as { code?: string; cause?: { code?: string } }).cause?.code ??
        (error as { code?: string }).code;
      if ((code !== "40001" && code !== "23505") || attempt === 4) throw error;
    }
  }
  throw new Error("unreachable");
}

/** A member-authorized acknowledgement; it does not resolve the alert. */
export const revenueGapAlertDismiss: ServerMutation<
  MutationArgs<"revenueGapAlert.dismiss">
> = async (ctx) => {
  const alert = await getNode(ctx.tx, ctx.principal.workspaceId, ctx.args.alert_id);
  if (!alert || alert.isSoftDeleted || alert.nodeType !== "RevenueGapAlert")
    throw new MutationRejection("not-found");
  return {
    checks: [
      {
        target: {
          kind: "node",
          workspaceId: ctx.principal.workspaceId,
          nodeType: "RevenueGapAlert",
          nodeId: alert.nodeId,
        },
        change: { operation: "update" },
      },
    ],
    async validate() {
      if (alert.lifecycleStatus === "Resolved")
        throw new MutationRejection("invalid-transition");
      if (alert.record["dismissed_at"] !== null)
        throw new MutationRejection("no-change");
    },
    async apply() {
      const patch = {
        dismissed_at: ctx.now,
        ...updateStamp("RevenueGapAlert", {
          workspaceId: ctx.principal.workspaceId,
          userId: ctx.principal.userId,
          now: ctx.now,
        }),
      };
      revenueGapAlertFieldsSchema.parse({ ...alert.record, ...patch });
      await updateNodeFields(
        ctx.tx,
        ctx.principal.workspaceId,
        alert.nodeId,
        null,
        patch,
      );
      return { result: { success: true }, changedRowIds: [alert.nodeId] };
    },
  };
};

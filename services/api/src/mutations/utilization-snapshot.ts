import {
  calculateUtilization,
  INTERNAL_CATEGORIES,
  stampNewNode,
  updateStamp,
  utilizationSnapshotComputeDefinition,
  utilizationSnapshotFieldsSchema,
} from "@vulto/schema";
import { deterministicUuid } from "../auth/membership-edge-ids.js";
import { audienceMaterializer } from "../audience/materializer.js";
import { db } from "../db.js";
import { expectedWeek } from "../graph/expected-week.js";
import { getNode, getNodes, insertNode, updateNodeFields } from "../graph/store.js";
import { ensureSystemActor } from "../graph/system-actor.js";
import type { GraphTx } from "../graph/tx.js";
import { authorizeWrite } from "../permission/interceptor.js";
import type { SystemPrincipal } from "../permission/principal.js";

/** A002's registered default, pending the configuration console. */
const BILLABILITY_TARGET = 0.75;

const principalFor = (workspaceId: string): SystemPrincipal => ({
  kind: "system",
  name: "utilization-snapshot-compute",
  workspaceId,
});

/** Deterministic per pair, so concurrent first computations cannot create twins. */
export const utilizationSnapshotId = (
  workspaceId: string,
  employeeId: string,
  weekStartDate: string,
) =>
  deterministicUuid(
    `utilization_snapshot:${workspaceId}:${employeeId}:${weekStartDate}`,
  );

async function computeInTransaction(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  weekStartDate: string,
  now: string,
): Promise<string | null> {
  const employee = await getNode(tx, workspaceId, employeeId);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
    throw new Error("not-found");
  const entries = (
    await getNodes(tx, workspaceId, { nodeType: "TimesheetEntry" })
  ).filter(
    (entry) =>
      entry.record["employee_id"] === employeeId &&
      entry.record["week_start_date"] === weekStartDate,
  );
  // An empty week has no derived row: getIndividual's null is the Empty state.
  if (entries.length === 0) return null;

  let billableHours = 0;
  let nonBillableHours = 0;
  let pitchHours = 0;
  const breakdown: Partial<Record<(typeof INTERNAL_CATEGORIES)[number], number>> = {};
  for (const entry of entries) {
    const hours = Number(entry.record["hours"] ?? 0);
    if (entry.record["time_category"] === "Billable") billableHours += hours;
    else if (entry.record["time_category"] === "Pitch") pitchHours += hours;
    else if (entry.record["time_category"] === "NonBillable") {
      nonBillableHours += hours;
      const category = entry.record["internal_category"];
      if (INTERNAL_CATEGORIES.some((value) => value === category)) {
        const key = category as (typeof INTERNAL_CATEGORIES)[number];
        breakdown[key] = (breakdown[key] ?? 0) + hours;
      }
    }
  }
  // F277: exactly the helper getWeek calls. Its F004 core is also used by
  // Stage 18's internal anomaly evaluator for reactive Tier 0 input reads.
  const { expectedWeeklyHours } = await expectedWeek(
    tx,
    workspaceId,
    employeeId,
    weekStartDate,
    async () => true,
  );
  const calculated = calculateUtilization({
    expectedHours: expectedWeeklyHours,
    billableHours,
    nonBillableHours,
    pitchHours,
  });
  const override = employee.record["billability_target_override"];
  const targetUtilization =
    typeof override === "number" ? override : BILLABILITY_TARGET;
  const existing = (
    await getNodes(tx, workspaceId, { nodeType: "UtilizationSnapshot" })
  ).filter(
    (row) =>
      row.record["employee_id"] === employeeId &&
      row.record["week_start_date"] === weekStartDate,
  );
  if (existing.length > 1) throw new Error("duplicate-utilization-snapshot");
  const snapshotId =
    existing[0]?.nodeId ??
    utilizationSnapshotId(workspaceId, employeeId, weekStartDate);
  const system = principalFor(workspaceId);
  const decision = await authorizeWrite(
    tx,
    system,
    {
      kind: "node",
      workspaceId,
      nodeType: "UtilizationSnapshot",
      nodeId: snapshotId,
    },
    { operation: existing[0] ? "update" : "create" },
    { systemOperation: "utilization-snapshot.compute" },
  );
  if (!decision.allowed) throw new Error(`snapshot-write-denied:${decision.reason}`);
  const actorId = await ensureSystemActor(tx, workspaceId, system.name, now);
  const provenance = { workspaceId, userId: actorId, now };
  const fields = {
    snapshot_id: snapshotId,
    employee_id: employeeId,
    week_start_date: weekStartDate,
    ...calculated,
    non_billable_breakdown: breakdown,
    target_utilization: targetUtilization,
    computed_at: now,
  };
  if (existing[0]) {
    const patch = { ...fields, ...updateStamp("UtilizationSnapshot", provenance) };
    utilizationSnapshotFieldsSchema.parse({ ...existing[0].record, ...patch });
    await updateNodeFields(tx, workspaceId, snapshotId, null, patch);
  } else {
    const row = stampNewNode(
      {
        node_id: snapshotId,
        node_type: "UtilizationSnapshot",
        schema_version: 1,
        lifecycle_status: "Active",
        ...fields,
      },
      "UtilizationSnapshot",
      provenance,
    );
    utilizationSnapshotFieldsSchema.parse(row);
    await insertNode(tx, row);
  }
  await audienceMaterializer.onRowsChanged(tx, [snapshotId]);
  return snapshotId;
}

/** Internal named mutation, never a client router entry or upload mutation. */
export async function utilizationSnapshotCompute(
  workspaceId: string,
  employeeId: string,
  weekStartDate: string,
  now = new Date().toISOString(),
): Promise<{ snapshotId: string | null }> {
  const args = utilizationSnapshotComputeDefinition.input.parse({
    employee_id: employeeId,
    week_start_date: weekStartDate,
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const snapshotId = await db.transaction(
        (tx) =>
          computeInTransaction(
            tx,
            workspaceId,
            args.employee_id,
            args.week_start_date,
            now,
          ),
        { isolationLevel: "serializable" },
      );
      return { snapshotId };
    } catch (error) {
      const code =
        (error as { code?: string; cause?: { code?: string } }).cause?.code ??
        (error as { code?: string }).code;
      if ((code !== "40001" && code !== "23505") || attempt === 4) throw error;
    }
  }
  throw new Error("unreachable");
}

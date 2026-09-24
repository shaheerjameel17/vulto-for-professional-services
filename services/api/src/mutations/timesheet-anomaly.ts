import { randomUUID } from "node:crypto";
import {
  addIsoDays,
  detectHoursExceedExpected,
  detectPostEndDateAssignment,
  detectZeroVarianceWeek,
  isoDatesInclusive,
  stampNewEdge,
  stampNewNode,
  updateStamp,
  type AnomalyEntry,
  type MutationArgs,
} from "@vulto/schema";
import { db } from "../db.js";
import { getKeyServices } from "../crypto/keys.js";
import { ensureSystemActor } from "../graph/system-actor.js";
import {
  getNode,
  getNodes,
  incoming,
  insertEdge,
  insertNode,
  updateNodeFields,
} from "../graph/store.js";
import type { GraphTx } from "../graph/tx.js";
import { resolvedDayOn } from "../graph/working-days.js";
import { authorizeWrite } from "../permission/interceptor.js";
import type { SystemPrincipal } from "../permission/principal.js";
import { readProtected } from "../protected/read.js";
import { writeProtected } from "../protected/write.js";
import { MutationRejection, type ServerMutation } from "./types.js";

export interface AnomalyFlagRecord {
  readonly employee_id: string;
  readonly week_start_date: string;
  readonly flag_reason:
    "PostEndDateAssignment" | "ZeroVarianceWeek" | "HoursExceedExpected";
  readonly detail: string;
  readonly cleared_at: string | null;
  readonly cleared_by: string | null;
  readonly clearance_outcome:
    "Corrected" | "AcceptedAsNormal" | "ApprovedOvertime" | null;
  readonly clearance_note: string | null;
}

const systemPrincipal = (workspaceId: string): SystemPrincipal => ({
  kind: "system",
  name: "timesheet-anomaly-evaluate",
  workspaceId,
});

/** The only content read path for prior Tier 2 flags. */
export async function readFlagRecords(
  tx: GraphTx,
  principal: SystemPrincipal,
  nodeIds: readonly string[],
): Promise<ReadonlyMap<string, AnomalyFlagRecord>> {
  const items = await readProtected(
    tx,
    getKeyServices(),
    principal,
    {
      nodeIds,
      partitions: ["record"],
    },
    { systemOperation: "timesheet-anomaly.read-flags" },
  );
  return new Map(
    items.flatMap((item) =>
      item.state === "available"
        ? [[item.node_id, item.value as AnomalyFlagRecord] as const]
        : [],
    ),
  );
}

async function evaluateInTransaction(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  weekStartDate: string,
  now: string,
): Promise<string[]> {
  const principal = systemPrincipal(workspaceId);
  const entries = (
    await getNodes(tx, workspaceId, { nodeType: "TimesheetEntry" })
  ).filter(
    (node) =>
      node.record["employee_id"] === employeeId &&
      node.record["week_start_date"] === weekStartDate &&
      node.lifecycleStatus === "Submitted",
  );
  const input: AnomalyEntry[] = entries.map((node) => ({
    date: String(node.record["date"]),
    hours: Number(node.record["hours"]),
    time_category: node.record["time_category"] as AnomalyEntry["time_category"],
    assignment_id: (node.record["assignment_id"] as string | null) ?? null,
    pitch_id: (node.record["pitch_id"] as string | null) ?? null,
  }));
  const endDates: Record<string, string> = {};
  for (const assignmentId of new Set(
    input.flatMap((entry) => (entry.assignment_id ? [entry.assignment_id] : [])),
  )) {
    const assignment = await getNode(tx, workspaceId, assignmentId);
    if (
      assignment?.nodeType === "Assignment" &&
      typeof assignment.record["end_date"] === "string"
    )
      endDates[assignmentId] = assignment.record["end_date"];
  }
  let expectedWeeklyHours = 0;
  for (const date of isoDatesInclusive(weekStartDate, addIsoDays(weekStartDate, 6)))
    expectedWeeklyHours += (
      await resolvedDayOn(tx, workspaceId, employeeId, date, async () => true)
    ).hours;
  const triggered = [
    ["PostEndDateAssignment", detectPostEndDateAssignment(input, endDates)],
    ["ZeroVarianceWeek", detectZeroVarianceWeek(input)],
    ["HoursExceedExpected", detectHoursExceedExpected(input, expectedWeeklyHours)],
  ] as const;
  const prior = (
    await Promise.all(
      (await incoming(tx, workspaceId, employeeId, "triggered_by")).map((edge) =>
        getNode(tx, workspaceId, edge.fromNodeId),
      ),
    )
  ).filter(
    (node): node is NonNullable<typeof node> =>
      node !== null && !node.isSoftDeleted && node.nodeType === "TimesheetAnomalyFlag",
  );
  const records = await readFlagRecords(
    tx,
    principal,
    prior.map((flag) => flag.nodeId),
  );
  let actorId: string | null = null;
  const flagIds: string[] = [];
  for (const [reason, isTriggered] of triggered) {
    if (!isTriggered) continue;
    const matching = prior.flatMap((flag) => {
      const record = records.get(flag.nodeId);
      return record?.employee_id === employeeId &&
        record.week_start_date === weekStartDate &&
        record.flag_reason === reason
        ? [{ flag, record }]
        : [];
    });
    if (
      reason === "HoursExceedExpected" &&
      matching.some(({ record }) => record.clearance_outcome === "ApprovedOvertime")
    )
      continue;
    actorId ??= await ensureSystemActor(tx, workspaceId, principal.name, now);
    const provenance = { workspaceId, userId: actorId, now };
    const active = matching.find(({ record }) => record.cleared_at === null);
    const detail = `${reason}: ${employeeId}, week ${weekStartDate}`;
    if (active) {
      const target = {
        kind: "node" as const,
        workspaceId,
        nodeType: "TimesheetAnomalyFlag" as const,
        nodeId: active.flag.nodeId,
        partitionKey: "record",
      };
      const decision = await authorizeWrite(
        tx,
        principal,
        target,
        { operation: "update" },
        { systemOperation: "timesheet-anomaly.create-flag" },
      );
      if (!decision.allowed) throw new Error(`anomaly-write-denied:${decision.reason}`);
      await updateNodeFields(
        tx,
        workspaceId,
        active.flag.nodeId,
        null,
        updateStamp("TimesheetAnomalyFlag", provenance),
      );
      await writeProtected(
        tx,
        getKeyServices(),
        { workspaceId, nodeId: active.flag.nodeId, nodeType: "TimesheetAnomalyFlag" },
        "record",
        { ...active.record, detail },
        actorId,
      );
      flagIds.push(active.flag.nodeId);
      continue;
    }
    const flagId = randomUUID();
    const edgeId = randomUUID();
    const nodeDecision = await authorizeWrite(
      tx,
      principal,
      {
        kind: "node",
        workspaceId,
        nodeType: "TimesheetAnomalyFlag",
        nodeId: flagId,
        partitionKey: "record",
      },
      { operation: "create" },
      { systemOperation: "timesheet-anomaly.create-flag" },
    );
    const edgeDecision = await authorizeWrite(
      tx,
      principal,
      {
        kind: "edge",
        workspaceId,
        edgeType: "triggered_by",
        edgeId,
        fromNodeType: "TimesheetAnomalyFlag",
        fromNodeId: flagId,
        toNodeType: "Employee",
        toNodeId: employeeId,
      },
      { operation: "create" },
    );
    if (!nodeDecision.allowed)
      throw new Error(`anomaly-write-denied:${nodeDecision.reason}`);
    if (!edgeDecision.allowed)
      throw new Error(`anomaly-write-denied:${edgeDecision.reason}`);
    await insertNode(
      tx,
      stampNewNode(
        {
          node_id: flagId,
          node_type: "TimesheetAnomalyFlag",
          schema_version: 1,
          lifecycle_status: "Active",
        },
        "TimesheetAnomalyFlag",
        provenance,
      ),
    );
    await insertEdge(
      tx,
      workspaceId,
      stampNewEdge(
        {
          edge_id: edgeId,
          edge_type: "triggered_by",
          from_node_id: flagId,
          to_node_id: employeeId,
          effective_from: now,
          effective_to: null,
        },
        provenance,
      ),
    );
    const record: AnomalyFlagRecord = {
      employee_id: employeeId,
      week_start_date: weekStartDate,
      flag_reason: reason,
      detail,
      cleared_at: null,
      cleared_by: null,
      clearance_outcome: null,
      clearance_note: null,
    };
    await writeProtected(
      tx,
      getKeyServices(),
      { workspaceId, nodeId: flagId, nodeType: "TimesheetAnomalyFlag" },
      "record",
      { ...record },
      actorId,
    );
    flagIds.push(flagId);
  }
  return flagIds;
}

/** Named, server-owned post-commit mutation. A failure never gates submitWeek. */
export async function timesheetAnomalyEvaluate(
  workspaceId: string,
  employeeId: string,
  weekStartDate: string,
  now = new Date().toISOString(),
): Promise<{ flagIds: string[] }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const flagIds = await db.transaction(
        (tx) => evaluateInTransaction(tx, workspaceId, employeeId, weekStartDate, now),
        { isolationLevel: "serializable" },
      );
      return { flagIds };
    } catch (error) {
      const code =
        (error as { code?: string; cause?: { code?: string } }).cause?.code ??
        (error as { code?: string }).code;
      if (code !== "40001" || attempt === 4) throw error;
    }
  }
  throw new Error("unreachable");
}

/** A member-authorized clearance; ApprovedOvertime suppresses only this flag. */
export const timesheetAnomalyClear: ServerMutation<
  MutationArgs<"timesheetAnomaly.clear">
> = async (ctx) => {
  const flag = await getNode(ctx.tx, ctx.principal.workspaceId, ctx.args.flag_id);
  if (!flag || flag.isSoftDeleted || flag.nodeType !== "TimesheetAnomalyFlag")
    throw new MutationRejection("not-found");
  return {
    checks: [
      {
        target: {
          kind: "node",
          workspaceId: ctx.principal.workspaceId,
          nodeType: "TimesheetAnomalyFlag",
          nodeId: flag.nodeId,
          partitionKey: "record",
        },
        change: { operation: "update" },
      },
    ],
    async validate() {},
    async apply() {
      const [item] = await readProtected(
        ctx.tx,
        getKeyServices(),
        ctx.principal,
        { nodeIds: [flag.nodeId], partitions: ["record"] },
        { now: () => ctx.now },
      );
      if (item?.state !== "available") throw new MutationRejection("not-found");
      const record = item.value as AnomalyFlagRecord;
      if (record.cleared_at !== null) throw new MutationRejection("stale-state");
      await updateNodeFields(
        ctx.tx,
        ctx.principal.workspaceId,
        flag.nodeId,
        null,
        updateStamp("TimesheetAnomalyFlag", {
          workspaceId: ctx.principal.workspaceId,
          userId: ctx.principal.userId,
          now: ctx.now,
        }),
      );
      await writeProtected(
        ctx.tx,
        getKeyServices(),
        {
          workspaceId: ctx.principal.workspaceId,
          nodeId: flag.nodeId,
          nodeType: "TimesheetAnomalyFlag",
        },
        "record",
        {
          ...record,
          cleared_at: ctx.now,
          cleared_by: ctx.principal.userId,
          clearance_outcome: ctx.args.outcome,
          clearance_note: ctx.args.note ?? null,
        },
        ctx.principal.userId,
      );
      return { result: { success: true }, changedRowIds: [flag.nodeId] };
    },
  };
};

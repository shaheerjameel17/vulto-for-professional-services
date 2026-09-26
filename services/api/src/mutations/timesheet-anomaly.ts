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
  computeToilAccrual,
  leaveLedgerEntryFieldsSchema,
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
import { authorizeWrite, authorizeRead } from "../permission/interceptor.js";
import type { SystemPrincipal, MemberPrincipal } from "../permission/principal.js";
import {
  matchingPolicies,
  computeBalance,
  policyLineage,
} from "../permission/leave-queries.js";
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

/** Shared Submitted-entry and VRS-F004 week resolution; evaluator keeps its system read path. */
async function deriveWeekHours(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  weekStartDate: string,
  principal?: MemberPrincipal,
) {
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
  let expectedWeeklyHours = 0;
  let workingDays = 0;
  for (const date of isoDatesInclusive(weekStartDate, addIsoDays(weekStartDate, 6))) {
    const day = await resolvedDayOn(tx, workspaceId, employeeId, date, async (node) => {
      if (!principal) return true;
      const decision = await authorizeRead(tx, principal, {
        workspaceId,
        nodeId: node.nodeId,
        nodeType: node.nodeType as
          "Employee" | "Entity" | "WorkingCalendar" | "Holiday" | "WorkingPattern",
      });
      return decision.access === "read" || decision.access === "full";
    });
    expectedWeeklyHours += day.hours;
    workingDays += day.isWorking ? 1 : 0;
  }
  return {
    input,
    expectedWeeklyHours,
    workingDays,
    loggedHours: input
      .filter((entry) => entry.time_category !== "Pitch")
      .reduce((total, entry) => total + entry.hours, 0),
  };
}

async function evaluateInTransaction(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  weekStartDate: string,
  now: string,
): Promise<string[]> {
  const principal = systemPrincipal(workspaceId);
  const { input, expectedWeeklyHours } = await deriveWeekHours(
    tx,
    workspaceId,
    employeeId,
    weekStartDate,
  );
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

export interface ToilResolution {
  readonly toil_days_accrued: number;
  readonly capped_at?: number;
  readonly reason:
    | "accrued"
    | "capped"
    | "no-overtime"
    | "no-policy"
    | "no-toil-type"
    | "no-working-days"
    | "not-hours-exceed";
}

async function callerFlag(
  tx: GraphTx,
  principal: MemberPrincipal,
  flagId: string,
  now: string,
) {
  const flag = await getNode(tx, principal.workspaceId, flagId);
  if (!flag || flag.isSoftDeleted || flag.nodeType !== "TimesheetAnomalyFlag")
    throw new MutationRejection("not-found");
  const [item] = await readProtected(
    tx,
    getKeyServices(),
    principal,
    { nodeIds: [flagId], partitions: ["record"] },
    { now: () => now },
  );
  if (item?.state !== "available") throw new MutationRejection("not-found");
  return { flag, record: item.value as AnomalyFlagRecord, principal };
}

/** Caller context stays attached to the protected flag; never a system policy read. */
export async function resolveToilAccrual(
  tx: GraphTx,
  context: Awaited<ReturnType<typeof callerFlag>>,
  now: string,
): Promise<{ result: ToilResolution; policy_id?: string; expires_on?: string }> {
  const { record, principal } = context;
  const zero = (reason: ToilResolution["reason"]) => ({
    result: { toil_days_accrued: 0, reason },
  });
  if (record.flag_reason !== "HoursExceedExpected") return zero("not-hours-exceed");
  const employee = await getNode(tx, principal.workspaceId, record.employee_id);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
    throw new MutationRejection("not-found");
  const date = now.slice(0, 10);
  const [latest] = await matchingPolicies(tx, principal, employee, date);
  if (!latest) return zero("no-policy");
  // Stage 27 allows a future-effective version and immediately retires its
  // predecessor. Price this grant with the version in force on clearance day.
  const lineage = await policyLineage(tx, principal, latest);
  if (!lineage) throw new MutationRejection("not-found");
  const policy = lineage
    .filter((version) => version.effective_from <= date)
    .sort(
      (a, b) =>
        b.effective_from.localeCompare(a.effective_from) || b.version - a.version,
    )[0];
  if (!policy) return zero("no-policy");
  if (!policy.leave_types.some((type) => type.leave_type === "TOIL"))
    return zero("no-toil-type");
  const hours = await deriveWeekHours(
    tx,
    principal.workspaceId,
    record.employee_id,
    record.week_start_date,
    principal,
  );
  if (hours.workingDays === 0) return zero("no-working-days");
  const balance = await computeBalance(tx, principal, record.employee_id, "TOIL", date);
  if (!balance) throw new MutationRejection("not-found");
  const accrual = computeToilAccrual({
    logged_hours: hours.loggedHours,
    expected_hours: hours.expectedWeeklyHours,
    standard_daily_hours: hours.expectedWeeklyHours / hours.workingDays,
    accrual_rate: policy.overtime_policy.toil_accrual_rate,
    held_days: balance.remaining,
    max_days: policy.overtime_policy.toil_max_accrued_days,
  });
  return {
    result: {
      toil_days_accrued: accrual.granted_days,
      ...(accrual.capped ? { capped_at: accrual.cap_days } : {}),
      reason: accrual.capped
        ? "capped"
        : accrual.requested_days > 0
          ? "accrued"
          : "no-overtime",
    },
    policy_id: policy.node_id,
    expires_on: addIsoDays(date, policy.overtime_policy.toil_expiry_days),
  };
}

export async function previewOvertime(
  tx: GraphTx,
  principal: MemberPrincipal,
  flagId: string,
  now = new Date().toISOString(),
) {
  return (
    await resolveToilAccrual(tx, await callerFlag(tx, principal, flagId, now), now)
  ).result;
}

/** A member-authorized clearance; ApprovedOvertime suppresses only this flag. */
export const timesheetAnomalyClear: ServerMutation<
  MutationArgs<"timesheetAnomaly.clear">
> = async (ctx) => {
  const context = await callerFlag(ctx.tx, ctx.principal, ctx.args.flag_id, ctx.now);
  const { flag, record } = context;
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
      if (record.cleared_at !== null) throw new MutationRejection("stale-state");
      const resolution =
        ctx.args.outcome === "ApprovedOvertime"
          ? await resolveToilAccrual(ctx.tx, context, ctx.now)
          : {
              result: { toil_days_accrued: 0, reason: "no-overtime" } as ToilResolution,
            };
      if (
        ctx.args.outcome === "ApprovedOvertime" &&
        record.flag_reason === "HoursExceedExpected" &&
        ctx.args.acknowledged_toil_days !== undefined &&
        ctx.args.acknowledged_toil_days !== resolution.result.toil_days_accrued
      )
        throw new MutationRejection("stale-state");
      await updateNodeFields(
        ctx.tx,
        ctx.principal.workspaceId,
        flag.nodeId,
        flag.version,
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
      const changedRowIds = [flag.nodeId];
      if (resolution.result.toil_days_accrued > 0) {
        const principal: SystemPrincipal = {
          kind: "system",
          name: "leave-ledger-write",
          workspaceId: ctx.principal.workspaceId,
        };
        const id = randomUUID();
        const decision = await authorizeWrite(
          ctx.tx,
          principal,
          {
            kind: "node",
            workspaceId: principal.workspaceId,
            nodeType: "LeaveLedgerEntry",
            nodeId: id,
            partitionKey: "record",
          },
          { operation: "create" },
          { systemOperation: "leave-ledger.write", now: () => ctx.now },
        );
        if (!decision.allowed)
          throw new Error(`ledger-write-denied:${decision.reason}`);
        const actor = await ensureSystemActor(
          ctx.tx,
          principal.workspaceId,
          principal.name,
          ctx.now,
        );
        const entry = leaveLedgerEntryFieldsSchema.parse(
          stampNewNode(
            {
              node_id: id,
              node_type: "LeaveLedgerEntry",
              schema_version: 1,
              lifecycle_status: "Active",
              employee_id: record.employee_id,
              entry_kind: "ToilAccrual",
              leave_type: "TOIL",
              days: resolution.result.toil_days_accrued,
              effective_date: ctx.now.slice(0, 10),
              expires_on: resolution.expires_on,
              policy_id: resolution.policy_id,
              source_flag_id: flag.nodeId,
            },
            "LeaveLedgerEntry",
            { workspaceId: principal.workspaceId, userId: actor, now: ctx.now },
          ),
        );
        await insertNode(ctx.tx, entry);
        changedRowIds.push(id);
      }
      return { result: { success: true, ...resolution.result }, changedRowIds };
    },
  };
};

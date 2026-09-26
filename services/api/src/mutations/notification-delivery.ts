import { randomUUID } from "node:crypto";
import {
  NOTIFICATION_RULES,
  notificationFieldsSchema,
  stampNewNode,
  stampNewEdge,
  type NotificationRule,
} from "@vulto/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db.js";
import { graphNodes } from "../graph/schema.js";
import {
  getNode,
  outgoing,
  insertNode,
  insertEdge,
  type GraphTx,
} from "../graph/store.js";
import {
  currentWriteScope,
  runInWriteScope,
  withoutWriteScope,
} from "../graph/write-log.js";
import { ensureSystemActor } from "../graph/system-actor.js";
import { resolveUserForEmployee } from "../permission/employee-link.js";
import { authorizeWrite } from "../permission/interceptor.js";
import { audienceMaterializer } from "../audience/materializer.js";

export interface DeliveryCounts {
  delivered: number;
  skippedNoManager: number;
  skippedNoLinkedUser: number;
}
const counts = (): DeliveryCounts => ({
  delivered: 0,
  skippedNoManager: 0,
  skippedNoLinkedUser: 0,
});

/** Only declared Tier 0 fields are interpolated; no protected read is performed. */
export function renderNotificationMessage(
  rule: NotificationRule,
  subject: Record<string, unknown>,
  source: Record<string, unknown>,
): string {
  const values = new Map(
    rule.messageFields.map(({ from, field }) => [
      `${from}.${field}`,
      (from === "subject" ? subject : source)[field],
    ]),
  );
  return rule.messageTemplate.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    if (!values.has(key)) throw new Error(`Undeclared notification field: ${key}`);
    const value = values.get(key);
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  });
}

export interface NotificationDelivery {
  readonly workspaceId: string;
  readonly subjectEmployeeId: string;
  readonly recipient: NotificationRule["recipient"];
  readonly sourceNodeType: string;
  readonly sourceNodeId: string;
  readonly ruleId: string;
  readonly dedupeKey: string;
  readonly category: NotificationRule["category"];
  readonly message: string;
}

/** Shared insertion path for event rules and the manual timesheet reminder. */
export async function deliverNotification(
  tx: GraphTx,
  delivery: NotificationDelivery,
  now: string,
): Promise<DeliveryCounts> {
  const result = counts();
  const { workspaceId } = delivery;
  const recipientEmployeeId =
    delivery.recipient === "employee-self"
      ? delivery.subjectEmployeeId
      : (
          await outgoing(tx, workspaceId, delivery.subjectEmployeeId, "managed_by", now)
        )[0]?.toNodeId;
  if (!recipientEmployeeId) {
    result.skippedNoManager++;
    return result;
  }
  const recipientUserId = await resolveUserForEmployee(
    tx,
    workspaceId,
    recipientEmployeeId,
  );
  if (!recipientUserId) {
    result.skippedNoLinkedUser++;
    return result;
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([workspaceId, recipientUserId, delivery.dedupeKey])}, 0))`,
  );
  const existing = await tx
    .select({ id: graphNodes.nodeId })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.workspaceId, workspaceId),
        eq(graphNodes.nodeType, "Notification"),
        sql`${graphNodes.record}->>'recipient_user_id' = ${recipientUserId}`,
        sql`${graphNodes.record}->>'dedupe_key' = ${delivery.dedupeKey}`,
      ),
    )
    .limit(1);
  if (existing.length) return result;
  const principal = {
    kind: "system",
    name: "notification-deliver",
    workspaceId,
  } as const;
  const nodeId = randomUUID();
  const edgeId = randomUUID();
  const nodeDecision = await authorizeWrite(
    tx,
    principal,
    {
      kind: "node",
      workspaceId,
      nodeType: "Notification",
      nodeId,
      partitionKey: "record",
    },
    { operation: "create" },
    { systemOperation: "notification.deliver" },
  );
  if (!nodeDecision.allowed)
    throw new Error(`notification-write-denied:${nodeDecision.reason}`);
  const edgeDecision = await authorizeWrite(
    tx,
    principal,
    {
      kind: "edge",
      workspaceId,
      edgeId,
      edgeType: "delivered_to",
      fromNodeType: "Notification",
      fromNodeId: nodeId,
      toNodeType: "User",
      toNodeId: recipientUserId,
    },
    { operation: "create" },
    { systemOperation: "notification.deliver" },
  );
  if (!edgeDecision.allowed)
    throw new Error(`notification-edge-denied:${edgeDecision.reason}`);
  const userId = await ensureSystemActor(tx, workspaceId, principal.name, now);
  const provenance = { workspaceId, userId, now };
  const record = notificationFieldsSchema.parse(
    stampNewNode(
      {
        node_id: nodeId,
        node_type: "Notification",
        workspace_id: workspaceId,
        schema_version: 1,
        lifecycle_status: "Active",
        recipient_user_id: recipientUserId,
        source_node_type: delivery.sourceNodeType,
        source_node_id: delivery.sourceNodeId,
        category: delivery.category,
        message: delivery.message,
        read_at: null,
        dismissed_at: null,
        rule_id: delivery.ruleId,
        dedupe_key: delivery.dedupeKey,
      },
      "Notification",
      provenance,
    ),
  );
  await insertNode(tx, record);
  await insertEdge(
    tx,
    workspaceId,
    stampNewEdge(
      {
        edge_id: edgeId,
        edge_type: "delivered_to",
        from_node_id: nodeId,
        to_node_id: recipientUserId,
        effective_from: now,
        effective_to: null,
      },
      provenance,
    ),
  );
  await audienceMaterializer.onRowsChanged(tx, [nodeId, edgeId]);
  result.delivered++;
  return result;
}

/** Independent post-commit transaction, reading only stored Tier 0/universal rows. */
export async function deliverForRows(
  ids: readonly string[],
  now = new Date().toISOString(),
): Promise<DeliveryCounts> {
  if (!ids.length) return counts();
  return withoutWriteScope(() =>
    db.transaction(async (tx) => {
      const total = counts();
      const rows = await tx
        .select({ nodeId: graphNodes.nodeId, workspaceId: graphNodes.workspaceId })
        .from(graphNodes)
        .where(inArray(graphNodes.nodeId, [...ids]));
      for (const row of rows) {
        const source = await getNode(tx, row.workspaceId, row.nodeId);
        if (!source || source.isSoftDeleted) continue;
        for (const rule of NOTIFICATION_RULES as readonly NotificationRule[]) {
          if (
            rule.sourceNodeType !== source.nodeType ||
            (source.nodeType === "RevenueGapAlert" &&
              source.lifecycleStatus !== "Active")
          )
            continue;
          const employeeId =
            source.nodeType === "RevenueGapAlert"
              ? source.record["employee_id"]
              : (
                  await outgoing(tx, row.workspaceId, row.nodeId, "triggered_by", now)
                )[0]?.toNodeId;
          if (typeof employeeId !== "string") continue;
          const employee = await getNode(tx, row.workspaceId, employeeId);
          if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
            continue;
          const discriminator = rule.discriminatorField
            ? String(source.record[rule.discriminatorField] ?? "")
            : "";
          const result = await deliverNotification(
            tx,
            {
              workspaceId: row.workspaceId,
              subjectEmployeeId: employeeId,
              recipient: rule.recipient,
              sourceNodeType: source.nodeType,
              sourceNodeId: row.nodeId,
              ruleId: rule.ruleId,
              dedupeKey: `${rule.ruleId}:${row.nodeId}:${discriminator}`,
              category: rule.category,
              message: renderNotificationMessage(rule, employee.record, source.record),
            },
            now,
          );
          total.delivered += result.delivered;
          total.skippedNoManager += result.skippedNoManager;
          total.skippedNoLinkedUser += result.skippedNoLinkedUser;
        }
      }
      return total;
    }),
  );
}

/** Outermost successful source scope drains after all source transactions commit. */
export async function withNotificationDelivery<T>(
  fn: () => Promise<T>,
  deliver: (ids: readonly string[]) => Promise<unknown> = deliverForRows,
): Promise<T> {
  if (currentWriteScope()) return fn();
  return runInWriteScope(async () => {
    const result = await fn();
    const ids = [...currentWriteScope()!];
    try {
      await withoutWriteScope(() => deliver(ids));
    } catch (error) {
      console.error(
        "notification-delivery-failed",
        error instanceof Error ? error.name : "unknown-error",
      );
    }
    return result;
  });
}

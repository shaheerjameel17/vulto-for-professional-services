import {
  auditEntrySchema,
  parseAuditLogCursor,
  type AuditLogQueryInput,
} from "@vulto/schema";
import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import type { GraphTx } from "../graph/tx.js";
import {
  authorizeRead,
  decideRead,
  type InterceptorContext,
} from "../permission/interceptor.js";
import type { MemberPrincipal } from "../permission/principal.js";
import { auditJournal } from "./schema.js";

/** Server-only journal review. A denial is returned so its transaction can commit. */
export async function queryAuditLog(
  tx: GraphTx,
  principal: MemberPrincipal,
  input: AuditLogQueryInput,
  context: InterceptorContext = {},
) {
  const target = {
    workspaceId: input.workspace_id,
    nodeType: "AuditEntry",
    nodeId: null,
  } as const;
  const permitted = await decideRead(tx, principal, target, context);
  if (permitted.access !== "full" && permitted.access !== "read") {
    await authorizeRead(tx, principal, target, context, "NodeList");
    return { denied: true } as const;
  }
  const conditions = [eq(auditJournal.workspaceId, input.workspace_id)];
  if (input.start_date !== undefined)
    conditions.push(
      gte(auditJournal.occurredAt, new Date(`${input.start_date}T00:00:00.000Z`)),
    );
  if (input.end_date !== undefined) {
    // Calendar-date filtering only, not a working-day calculation.
    const exclusiveEnd = new Date(`${input.end_date}T00:00:00.000Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    conditions.push(lt(auditJournal.occurredAt, exclusiveEnd));
  }
  if (input.actor_user_id !== undefined)
    conditions.push(eq(auditJournal.actorUserId, input.actor_user_id));
  if (input.event_types !== undefined)
    conditions.push(inArray(auditJournal.eventType, input.event_types));
  if (input.target_node_type !== undefined)
    conditions.push(eq(auditJournal.targetNodeType, input.target_node_type));
  if (input.target_tier !== undefined)
    conditions.push(eq(auditJournal.targetTier, input.target_tier));
  if (input.cursor !== undefined) {
    const cursor = parseAuditLogCursor(input.cursor);
    const instant = new Date(cursor.occurred_at);
    conditions.push(
      or(
        lt(auditJournal.occurredAt, instant),
        and(
          eq(auditJournal.occurredAt, instant),
          lt(auditJournal.auditEntryId, cursor.audit_entry_id),
        ),
      )!,
    );
  }
  const rows = await tx
    .select({ entry: auditJournal.entry })
    .from(auditJournal)
    .where(and(...conditions))
    .orderBy(desc(auditJournal.occurredAt), desc(auditJournal.auditEntryId))
    .limit(input.limit + 1);
  const entries = rows
    .slice(0, input.limit)
    .map((row) => auditEntrySchema.parse(row.entry));
  const last = entries.at(-1);
  const next_cursor =
    rows.length > input.limit && last
      ? Buffer.from(
          JSON.stringify({
            occurred_at: last.occurred_at,
            audit_entry_id: last.audit_entry_id,
          }),
        ).toString("base64url")
      : null;
  // Read first, audit second, release only after this transaction commits.
  const decision = await authorizeRead(tx, principal, target, context, "NodeList");
  if (decision.access !== "full" && decision.access !== "read")
    return { denied: true } as const;
  return { denied: false, page: { entries, next_cursor } } as const;
}

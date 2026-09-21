import type { AuditEntry } from "@vulto/schema";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { organization } from "../auth/schema.js";

/**
 * VPS-F004's server audit journal (FDN-68, A003-T59).
 *
 * Append-only by construction: `journal.ts` exposes an insert and no update
 * or delete, and the only post-append change is the actor pseudonymization in
 * `pseudonymizer.ts`. Each entry commits in the same transaction as the
 * decision it records. The hash chain is FDN-108, later.
 */
export const auditJournal = pgTable(
  "audit_journal",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    auditEntryId: uuid("audit_entry_id").notNull(),
    contentDigest: text("content_digest").notNull(),
    entry: jsonb("entry").$type<AuditEntry>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // F206: who acted. A member has a user id; a support grant a grant id; a
    // system job its closed name. Exactly the one that matches `actor_kind`.
    actorKind: text("actor_kind").notNull().default("member"),
    actorUserId: uuid("actor_user_id"),
    actorGrantId: uuid("actor_grant_id"),
    actorSystemName: text("actor_system_name"),
    eventType: text("event_type").notNull(),
    operation: text("operation").notNull(),
    outcome: text("outcome").notNull(),
    targetKind: text("target_kind").notNull(),
    targetNodeType: text("target_node_type"),
    targetTier: smallint("target_tier"),
    appendedAt: timestamp("appended_at", { withTimezone: true })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.auditEntryId] }),
    index("audit_journal_workspace_occurred_idx").on(
      table.workspaceId,
      table.occurredAt,
      table.auditEntryId,
    ),
    index("audit_journal_workspace_actor_idx").on(
      table.workspaceId,
      table.actorUserId,
      table.occurredAt,
    ),
    index("audit_journal_workspace_event_idx").on(
      table.workspaceId,
      table.eventType,
      table.occurredAt,
    ),
    index("audit_journal_workspace_operation_idx").on(
      table.workspaceId,
      table.operation,
      table.occurredAt,
    ),
    index("audit_journal_workspace_outcome_idx").on(
      table.workspaceId,
      table.outcome,
      table.occurredAt,
    ),
    index("audit_journal_workspace_target_idx").on(
      table.workspaceId,
      table.targetKind,
      table.targetNodeType,
      table.targetTier,
      table.occurredAt,
    ),
    check(
      "audit_journal_event_type_check",
      sql`${table.eventType} in ('PermissionDenied', 'SensitiveAccessGranted', 'AuthorizedOperationFailed', 'PrivilegedProjectionAuthorized', 'CryptographicErasureExecuted')`,
    ),
    index("audit_journal_workspace_actor_kind_idx").on(
      table.workspaceId,
      table.actorKind,
      table.actorGrantId,
      table.actorSystemName,
      table.occurredAt,
    ),
    check(
      "audit_journal_actor_kind_check",
      sql`${table.actorKind} in ('member', 'support', 'system')`,
    ),
    check(
      "audit_journal_actor_identity_check",
      sql`(${table.actorKind} = 'member' and ${table.actorUserId} is not null and ${table.actorGrantId} is null and ${table.actorSystemName} is null)
        or (${table.actorKind} = 'support' and ${table.actorGrantId} is not null and ${table.actorUserId} is null and ${table.actorSystemName} is null)
        or (${table.actorKind} = 'system' and ${table.actorSystemName} is not null and ${table.actorUserId} is null and ${table.actorGrantId} is null)`,
    ),
    check(
      "audit_journal_outcome_check",
      sql`${table.outcome} in ('Granted', 'Denied', 'Failed')`,
    ),
    check(
      "audit_journal_target_kind_check",
      sql`${table.targetKind} in ('NodeTarget', 'EdgeTarget', 'QueryTarget', 'ErasureTarget')`,
    ),
    check(
      "audit_journal_target_tier_check",
      sql`${table.targetTier} is null or ${table.targetTier} between 0 and 3`,
    ),
  ],
);

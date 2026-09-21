import { createHash } from "node:crypto";
import { auditEntrySchema, type AuditEntry } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import type { GraphTx } from "../graph/tx.js";
import { auditJournal } from "./schema.js";

/**
 * The server audit journal (FDN-68, A003-T59).
 *
 * `appendAudit` is the only writer. It runs in the caller's transaction, so an
 * audit entry commits or rolls back together with the decision it records, and
 * a failure to write it fails the operation instead of letting the data
 * through. There is deliberately no update and no delete here; the single
 * post-append change is the actor pseudonymization in `pseudonymizer.ts`.
 */

export class AuditJournalConflictError extends Error {
  constructor() {
    super("The audit entry identifier already has different content");
    this.name = "AuditJournalConflictError";
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalAuditEntryContent(entry: AuditEntry): string {
  return canonicalJson(auditEntrySchema.parse(entry));
}

export function auditContentDigest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("base64url");
}

function indexedTarget(entry: AuditEntry): {
  targetNodeType: string | null;
  targetTier: number | null;
} {
  if (entry.target.kind === "NodeTarget") {
    return {
      targetNodeType: entry.target.node_type,
      targetTier: entry.target.target_tier,
    };
  }
  if (entry.target.kind === "QueryTarget") {
    return {
      targetNodeType: entry.target.requested_node_type,
      targetTier: entry.target.target_tier,
    };
  }
  if (entry.target.kind === "ErasureTarget") {
    return { targetNodeType: null, targetTier: entry.target.tier };
  }
  return { targetNodeType: null, targetTier: entry.target.target_tier };
}

/**
 * Appends one entry inside `tx`. Idempotent on `audit_entry_id`: the same id
 * with the same content is a no-op; the same id with different content throws.
 */
export async function appendAudit(
  tx: GraphTx,
  event: AuditEntry,
): Promise<{ appended: boolean }> {
  const entry = auditEntrySchema.parse(event);
  const contentDigest = auditContentDigest(canonicalAuditEntryContent(entry));
  const target = indexedTarget(entry);
  const inserted = await tx
    .insert(auditJournal)
    .values({
      workspaceId: entry.workspace_id,
      auditEntryId: entry.audit_entry_id,
      contentDigest,
      entry,
      occurredAt: new Date(entry.occurred_at),
      actorKind: entry.actor_kind,
      actorUserId: entry.actor_user_id ?? null,
      actorGrantId: entry.actor_grant_id ?? null,
      actorSystemName: entry.actor_system_name ?? null,
      eventType: entry.event_type,
      operation: entry.operation,
      outcome: entry.outcome,
      targetKind: entry.target.kind,
      targetNodeType: target.targetNodeType,
      targetTier: target.targetTier,
    })
    .onConflictDoNothing()
    .returning({ auditEntryId: auditJournal.auditEntryId });
  if (inserted.length > 0) return { appended: true };

  const [existing] = await tx
    .select({ contentDigest: auditJournal.contentDigest })
    .from(auditJournal)
    .where(
      and(
        eq(auditJournal.workspaceId, entry.workspace_id),
        eq(auditJournal.auditEntryId, entry.audit_entry_id),
      ),
    )
    .limit(1);
  if (!existing || existing.contentDigest !== contentDigest) {
    throw new AuditJournalConflictError();
  }
  return { appended: false };
}

/** Every entry of a workspace's journal, oldest first. A read only. */
export async function listAuditEntries(
  executor: Pick<GraphTx, "select">,
  workspaceId: string,
): Promise<AuditEntry[]> {
  const rows = await executor
    .select({ entry: auditJournal.entry })
    .from(auditJournal)
    .where(eq(auditJournal.workspaceId, workspaceId))
    .orderBy(auditJournal.occurredAt, auditJournal.appendedAt);
  return rows.map((row) => auditEntrySchema.parse(row.entry));
}

import { resolvePermissionDecision } from "@vulto/graph/permission";
import { auditEntrySchema, uuidV4Schema, type AuditEntry } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import {
  AuditJournalDeniedError,
  auditContentDigest,
  canonicalAuditEntryContent,
  requireAuditDeviceContext,
} from "./audit-journal.js";
import { parseDeviceId } from "./device-unlock.js";
import { auditJournal } from "./schema.js";

export interface AuditPseudonymizationRequest {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly currentActorUserId: string;
  readonly opaqueActorToken: string;
}

export function parseAuditPseudonymizationRequest(
  input: unknown,
): AuditPseudonymizationRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Invalid audit pseudonymization request");
  }
  const record = input as Record<string, unknown>;
  const expectedKeys = [
    "currentActorUserId",
    "deviceId",
    "opaqueActorToken",
    "workspaceId",
  ];
  const actualKeys = Object.keys(record).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("Invalid audit pseudonymization request");
  }
  const request = {
    workspaceId: uuidV4Schema.parse(record.workspaceId),
    deviceId: parseDeviceId(record.deviceId),
    currentActorUserId: uuidV4Schema.parse(record.currentActorUserId),
    opaqueActorToken: uuidV4Schema.parse(record.opaqueActorToken),
  };
  if (request.currentActorUserId === request.opaqueActorToken) {
    throw new Error("The opaque actor token must replace the current identifier");
  }
  return request;
}

function withoutActor(entry: AuditEntry): Omit<AuditEntry, "actor_user_id"> {
  const { actor_user_id: _actorUserId, ...unchanged } = entry;
  return unchanged;
}

/**
 * FDN-68's sole retained-journal mutation seam. The update set is closed in
 * this module: canonical AuditEntry content may differ only at actor_user_id;
 * the indexed actor and integrity digest are derived consequences.
 *
 * VPS-F007 orchestration does not exist yet. Its eventual fulfillment path
 * calls this seam after its own approval/hold checks; those checks are not
 * fabricated here.
 */
export class AuditPseudonymizer {
  async execute(
    headers: Headers,
    request: AuditPseudonymizationRequest,
  ): Promise<{ pseudonymizedEntryIds: string[] }> {
    const context = await requireAuditDeviceContext(
      headers,
      request.workspaceId,
      request.deviceId,
    );
    if (
      resolvePermissionDecision(context.session.roles, "AuditEntry", "record")
        .outcome !== "full"
    ) {
      throw new AuditJournalDeniedError();
    }

    return db.transaction(async (transaction) => {
      const rows = await transaction
        .select({ entry: auditJournal.entry })
        .from(auditJournal)
        .where(
          and(
            eq(auditJournal.workspaceId, context.session.workspaceId),
            eq(auditJournal.actorUserId, request.currentActorUserId),
          ),
        );
      const pseudonymizedEntryIds: string[] = [];
      for (const row of rows) {
        const before = auditEntrySchema.parse(row.entry);
        const after = auditEntrySchema.parse({
          ...before,
          actor_user_id: request.opaqueActorToken,
        });
        if (
          JSON.stringify(withoutActor(after)) !== JSON.stringify(withoutActor(before))
        ) {
          throw new Error("Audit pseudonymization attempted to alter immutable fields");
        }
        await transaction
          .update(auditJournal)
          .set({
            actorUserId: request.opaqueActorToken,
            entry: after,
            contentDigest: auditContentDigest(canonicalAuditEntryContent(after)),
          })
          .where(
            and(
              eq(auditJournal.workspaceId, context.session.workspaceId),
              eq(auditJournal.auditEntryId, before.audit_entry_id),
              eq(auditJournal.actorUserId, request.currentActorUserId),
            ),
          );
        pseudonymizedEntryIds.push(before.audit_entry_id);
      }
      return { pseudonymizedEntryIds };
    });
  }
}

export const auditPseudonymizer = new AuditPseudonymizer();

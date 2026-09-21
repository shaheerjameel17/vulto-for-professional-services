import {
  auditEntrySchema,
  isSystemOperationPermitted,
  uuidV4Schema,
} from "@vulto/schema";
import type { AuditEntry } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import type { GraphTx } from "../graph/tx.js";
import type { SystemPrincipal } from "../permission/principal.js";
import { auditContentDigest, canonicalAuditEntryContent } from "./journal.js";
import { auditJournal } from "./schema.js";

export class AuditPseudonymizationDeniedError extends Error {
  constructor() {
    super("Audit pseudonymization is not permitted for this principal");
    this.name = "AuditPseudonymizationDeniedError";
  }
}

export interface AuditPseudonymizationRequest {
  readonly workspaceId: string;
  readonly currentActorUserId: string;
  readonly opaqueActorToken: string;
}

function withoutActor(entry: AuditEntry): Omit<AuditEntry, "actor_user_id"> {
  const { actor_user_id: _actorUserId, ...unchanged } = entry;
  return unchanged;
}

/**
 * FDN-68's sole retained-journal mutation seam (VPS-F004 G06). The update set
 * is closed here: canonical AuditEntry content may differ only at
 * `actor_user_id`; the indexed actor and integrity digest are derived
 * consequences. Only the `erasure` system principal may call it, and that
 * permission is a row in the policy table, not a check written here.
 *
 * VPS-F007 orchestration does not exist yet. Its fulfillment path calls this
 * seam after its own approval and hold checks; those checks are not
 * fabricated here.
 */
export async function pseudonymizeActor(
  tx: GraphTx,
  principal: SystemPrincipal,
  request: AuditPseudonymizationRequest,
): Promise<{ pseudonymizedEntryIds: string[] }> {
  if (
    principal.workspaceId !== request.workspaceId ||
    !isSystemOperationPermitted(principal.name, "audit.pseudonymize-actor")
  ) {
    throw new AuditPseudonymizationDeniedError();
  }
  const currentActorUserId = uuidV4Schema.parse(request.currentActorUserId);
  const opaqueActorToken = uuidV4Schema.parse(request.opaqueActorToken);
  if (currentActorUserId === opaqueActorToken) {
    throw new Error("The opaque actor token must replace the current identifier");
  }

  const rows = await tx
    .select({ entry: auditJournal.entry })
    .from(auditJournal)
    .where(
      and(
        eq(auditJournal.workspaceId, request.workspaceId),
        eq(auditJournal.actorUserId, currentActorUserId),
      ),
    );
  const pseudonymizedEntryIds: string[] = [];
  for (const row of rows) {
    const before = auditEntrySchema.parse(row.entry);
    const after = auditEntrySchema.parse({
      ...before,
      actor_user_id: opaqueActorToken,
    });
    if (JSON.stringify(withoutActor(after)) !== JSON.stringify(withoutActor(before))) {
      throw new Error("Audit pseudonymization attempted to alter immutable fields");
    }
    await tx
      .update(auditJournal)
      .set({
        actorUserId: opaqueActorToken,
        entry: after,
        contentDigest: auditContentDigest(canonicalAuditEntryContent(after)),
      })
      .where(
        and(
          eq(auditJournal.workspaceId, request.workspaceId),
          eq(auditJournal.auditEntryId, before.audit_entry_id),
          eq(auditJournal.actorUserId, currentActorUserId),
        ),
      );
    pseudonymizedEntryIds.push(before.audit_entry_id);
  }
  return { pseudonymizedEntryIds };
}

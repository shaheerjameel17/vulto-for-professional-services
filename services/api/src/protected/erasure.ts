import { isSystemOperationPermitted } from "@vulto/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { KeyServices } from "../crypto/keys.js";
import type { GraphTx } from "../graph/tx.js";
import type { SystemPrincipal } from "../permission/principal.js";
import { protectedDataKeys } from "./schema.js";

export class ErasureDeniedError extends Error {
  constructor() {
    super("Cryptographic erasure is not permitted for this principal");
    this.name = "ErasureDeniedError";
  }
}

/**
 * How an erasure is recorded. `VPS-A003` says `VPS-F004` records that erasure
 * occurred, but the AuditEntry vocabulary has no event for it (F209), so the
 * seam is explicit and its default refuses: no key is destroyed without its
 * entry.
 */
export interface ErasureAudit {
  record(
    tx: GraphTx,
    event: {
      readonly workspaceId: string;
      readonly erasureDomainId: string;
      readonly destroyedKeyIds: readonly string[];
    },
  ): Promise<void>;
}

export class ErasureAuditUndefinedError extends Error {
  constructor() {
    super("An erasure cannot be audited until F209 defines its audit event");
    this.name = "ErasureAuditUndefinedError";
  }
}

export const failClosedErasureAudit: ErasureAudit = {
  async record() {
    throw new ErasureAuditUndefinedError();
  },
};

/**
 * Cryptographic erasure of one Tier 1 erasure domain (A003-T62, VPS-F007): the
 * domain's data keys lose their wrapped bytes and are evicted from the cache,
 * so the ciphertext, the node, its edges and its position remain but the
 * content is permanently unreadable. Only the `erasure` system principal may
 * call it, by a row in the policy table. The audit entry is written first; if it
 * fails, nothing is destroyed. Expiring retained key backups is an operations
 * task (FDN-58).
 */
export async function eraseErasureDomain(
  tx: GraphTx,
  services: KeyServices,
  principal: SystemPrincipal,
  request: { readonly workspaceId: string; readonly erasureDomainId: string },
  audit: ErasureAudit = failClosedErasureAudit,
): Promise<{ destroyedKeyIds: string[] }> {
  if (
    principal.workspaceId !== request.workspaceId ||
    !isSystemOperationPermitted(principal.name, "protected.destroy-key")
  ) {
    throw new ErasureDeniedError();
  }
  const live = await tx
    .select({ keyId: protectedDataKeys.keyId })
    .from(protectedDataKeys)
    .where(
      and(
        eq(protectedDataKeys.workspaceId, request.workspaceId),
        eq(protectedDataKeys.kind, "dek"),
        eq(protectedDataKeys.tier, 1),
        eq(protectedDataKeys.erasureDomainId, request.erasureDomainId),
        isNull(protectedDataKeys.destroyedAt),
      ),
    );
  const destroyedKeyIds = live.map((row) => row.keyId);
  await audit.record(tx, {
    workspaceId: request.workspaceId,
    erasureDomainId: request.erasureDomainId,
    destroyedKeyIds,
  });
  for (const keyId of destroyedKeyIds) {
    await tx
      .update(protectedDataKeys)
      .set({ wrappedKey: null, destroyedAt: new Date() })
      .where(eq(protectedDataKeys.keyId, keyId));
    services.cache.evict(keyId);
  }
  return { destroyedKeyIds };
}

import { randomUUID } from "node:crypto";
import { isSystemOperationPermitted } from "@vulto/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { KeyServices } from "../crypto/keys.js";
import { appendAudit } from "../audit/journal.js";
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
 * Cryptographic erasure of one Tier 1 erasure domain (A003-T62, VPS-F007): the
 * domain's data keys lose their wrapped bytes and are evicted from the cache,
 * so the ciphertext, the node, its edges and its position remain but the
 * content is permanently unreadable. Only the `erasure` system principal may
 * call it, by a row in the policy table. The `CryptographicErasureExecuted`
 * audit entry (F209) is written first, in the same transaction; if it cannot be
 * written, nothing is destroyed. Expiring retained key backups is an operations
 * task (FDN-58).
 */
export async function eraseErasureDomain(
  tx: GraphTx,
  services: KeyServices,
  principal: SystemPrincipal,
  request: {
    readonly workspaceId: string;
    readonly erasureDomainId: string;
    /** The approved ErasureRequest this executes; null until VPS-F007 builds one. */
    readonly erasureRequestId: string | null;
  },
  options: { readonly now?: () => string; readonly newId?: () => string } = {},
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
  await appendAudit(tx, {
    audit_entry_id: (options.newId ?? randomUUID)(),
    schema_version: 1,
    workspace_id: request.workspaceId,
    event_type: "CryptographicErasureExecuted",
    operation: "KeyDestroy",
    outcome: "Granted",
    actor_kind: "system",
    actor_system_name: principal.name,
    actor_role: null,
    actor_roles: [],
    actor_application: "VultoRoster",
    target: {
      kind: "ErasureTarget",
      erasure_domain_id: request.erasureDomainId,
      tier: 1,
      destroyed_key_count: destroyedKeyIds.length,
      erasure_request_id: request.erasureRequestId,
    },
    metadata: {},
    occurred_at: (options.now ?? (() => new Date().toISOString()))(),
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

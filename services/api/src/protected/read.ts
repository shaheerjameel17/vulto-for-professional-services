import { and, eq, inArray } from "drizzle-orm";
import { decryptFragment } from "../crypto/decrypt.js";
import type { FragmentHeader } from "../crypto/envelope.js";
import { loadDataKey, type KeyServices } from "../crypto/keys.js";
import { getNode } from "../graph/store.js";
import type { GraphTx } from "../graph/tx.js";
import { authorizeRead, type InterceptorContext } from "../permission/interceptor.js";
import type { Principal } from "../permission/principal.js";
import { graphProtectedFragments } from "./schema.js";
import type { NodeType } from "@vulto/schema";

/**
 * The audited read path for Tier 1 and Tier 2 content (A003-T59). For each
 * fragment, in order: the interceptor decides; the decision is audited in the
 * caller's transaction (a failure to write the entry throws, so nothing is
 * released); only then is the content decrypted and returned. Plaintext exists
 * only in the memory of this call.
 */
export type ProtectedReadItem =
  | {
      readonly node_id: string;
      readonly partition: string;
      readonly state: "available";
      readonly value: unknown;
    }
  | {
      readonly node_id: string;
      readonly partition: string;
      readonly state: "restricted";
      readonly label: string;
    }
  | { readonly node_id: string; readonly partition: string; readonly state: "erased" };

export interface ProtectedReadRequest {
  readonly nodeIds: readonly string[];
  readonly partitions?: readonly string[] | undefined;
}

export async function readProtected(
  tx: GraphTx,
  services: KeyServices,
  principal: Principal,
  request: ProtectedReadRequest,
  context: InterceptorContext = {},
): Promise<ProtectedReadItem[]> {
  const ids = [...new Set(request.nodeIds)];
  if (ids.length === 0) return [];
  const conditions = [
    eq(graphProtectedFragments.workspaceId, principal.workspaceId),
    eq(graphProtectedFragments.ownerKind, "node"),
    inArray(graphProtectedFragments.ownerId, ids),
  ];
  if (request.partitions !== undefined && request.partitions.length > 0) {
    conditions.push(
      inArray(graphProtectedFragments.schemaPartition, [...request.partitions]),
    );
  }
  const fragments = await tx
    .select()
    .from(graphProtectedFragments)
    .where(and(...conditions))
    .orderBy(graphProtectedFragments.ownerId, graphProtectedFragments.schemaPartition);

  const out: ProtectedReadItem[] = [];
  for (const fragment of fragments) {
    const node = await getNode(tx, principal.workspaceId, fragment.ownerId);
    if (!node || node.isSoftDeleted) continue;

    // 1-2. Decide and audit. A failure to audit throws here.
    const decision = await authorizeRead(
      tx,
      principal,
      {
        workspaceId: principal.workspaceId,
        nodeType: node.nodeType as NodeType,
        nodeId: node.nodeId,
        partitionKey: fragment.schemaPartition,
      },
      context,
    );
    // A denial is absent as though the fragment did not exist; Restricted keeps
    // only what the schema guarantees.
    if (decision.access === "none") continue;
    if (decision.access === "restricted") {
      out.push({
        node_id: fragment.ownerId,
        partition: fragment.schemaPartition,
        state: "restricted",
        label: decision.label,
      });
      continue;
    }

    // 3. Decrypt, unless the key was destroyed.
    const key = await loadDataKey(
      tx,
      services,
      principal.workspaceId,
      fragment.dataKeyId,
    );
    if (key === null) {
      out.push({
        node_id: fragment.ownerId,
        partition: fragment.schemaPartition,
        state: "erased",
      });
      continue;
    }
    const header: FragmentHeader = {
      format: "vulto:protected-fragment:v1",
      workspace_id: fragment.workspaceId,
      owner_kind: "node",
      owner_id: fragment.ownerId,
      owner_type: node.nodeType,
      schema_partition: fragment.schemaPartition,
      tier: fragment.tier as 1 | 2,
      erasure_domain_id: fragment.erasureDomainId,
      data_key_id: fragment.dataKeyId,
    };
    const value = decryptFragment(key, fragment, header);
    out.push({
      node_id: fragment.ownerId,
      partition: fragment.schemaPartition,
      state: "available",
      value,
    });
  }
  return out;
}

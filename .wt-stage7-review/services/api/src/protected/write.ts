import { randomUUID } from "node:crypto";
import { getProtectionPartitions, type JsonValue, type NodeType } from "@vulto/schema";
import { and, eq } from "drizzle-orm";
import { seal } from "../crypto/aes.js";
import { encodeContent, fragmentAad, type FragmentHeader } from "../crypto/envelope.js";
import { ensureDataKey, type KeyServices } from "../crypto/keys.js";
import { getNode } from "../graph/store.js";
import type { GraphTx } from "../graph/tx.js";
import { resolveErasureDomain } from "./erasure-domain.js";
import { graphProtectedFragments } from "./schema.js";

export class ProtectedWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectedWriteError";
  }
}

export interface ProtectedOwner {
  readonly workspaceId: string;
  readonly nodeId: string;
  readonly nodeType: NodeType;
}

/**
 * Writes one protected partition of a node, encrypted (A003-T55). Tier 1 and
 * Tier 2 content is written here and nowhere else, never into
 * `graph_nodes.record`. The value is canonicalized JSON under a data key: the
 * erasure domain's for Tier 1, the workspace's for Tier 2. The caller has
 * already been authorized by the interceptor. A partition that is Tier 0 or
 * Tier 3 is refused: Tier 0 lives in the graph, and Tier 3 never reaches a
 * server. Edge-owned fragments are not written yet (protected edge metadata
 * arrives with the first feature that has some).
 */
export async function writeProtected(
  tx: GraphTx,
  services: KeyServices,
  owner: ProtectedOwner,
  partition: string,
  value: JsonValue,
  actorUserId: string | null = null,
): Promise<{ fragmentId: string; version: number }> {
  const node = await getNode(tx, owner.workspaceId, owner.nodeId);
  if (!node || node.isSoftDeleted || node.nodeType !== owner.nodeType) {
    throw new ProtectedWriteError("The owner node was not found in this workspace");
  }
  const registered = getProtectionPartitions(owner.nodeType).find(
    (p) => p.key === partition,
  );
  if (!registered)
    throw new ProtectedWriteError(`${owner.nodeType} has no partition ${partition}`);
  if (registered.tier !== 1 && registered.tier !== 2) {
    throw new ProtectedWriteError(
      "Only Tier 1 and Tier 2 partitions are stored as protected fragments",
    );
  }
  const tier: 1 | 2 = registered.tier;
  const erasureDomainId = await resolveErasureDomain(tx, {
    workspaceId: owner.workspaceId,
    nodeType: owner.nodeType,
    nodeId: owner.nodeId,
  });
  const dek = await ensureDataKey(tx, services, {
    workspaceId: owner.workspaceId,
    tier,
    erasureDomainId: tier === 1 ? erasureDomainId : null,
  });
  const header: FragmentHeader = {
    format: "vulto:protected-fragment:v1",
    workspace_id: owner.workspaceId,
    owner_kind: "node",
    owner_id: owner.nodeId,
    owner_type: owner.nodeType,
    schema_partition: partition,
    tier,
    erasure_domain_id: erasureDomainId,
    data_key_id: dek.keyId,
  };
  const { nonce, ciphertext } = seal(
    dek.key,
    encodeContent(value),
    fragmentAad(header),
  );

  const [existing] = await tx
    .select({
      fragmentId: graphProtectedFragments.fragmentId,
      version: graphProtectedFragments.version,
    })
    .from(graphProtectedFragments)
    .where(
      and(
        eq(graphProtectedFragments.ownerKind, "node"),
        eq(graphProtectedFragments.ownerId, owner.nodeId),
        eq(graphProtectedFragments.schemaPartition, partition),
      ),
    );
  if (existing) {
    const version = existing.version + 1;
    await tx
      .update(graphProtectedFragments)
      .set({
        tier,
        erasureDomainId,
        dataKeyId: dek.keyId,
        nonce: Buffer.from(nonce),
        ciphertext: Buffer.from(ciphertext),
        header,
        version,
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .where(eq(graphProtectedFragments.fragmentId, existing.fragmentId));
    return { fragmentId: existing.fragmentId, version };
  }
  const fragmentId = randomUUID();
  await tx.insert(graphProtectedFragments).values({
    fragmentId,
    workspaceId: owner.workspaceId,
    ownerKind: "node",
    ownerId: owner.nodeId,
    schemaPartition: partition,
    tier,
    erasureDomainId,
    dataKeyId: dek.keyId,
    nonce: Buffer.from(nonce),
    ciphertext: Buffer.from(ciphertext),
    header,
    version: 1,
    createdBy: actorUserId,
  });
  return { fragmentId, version: 1 };
}

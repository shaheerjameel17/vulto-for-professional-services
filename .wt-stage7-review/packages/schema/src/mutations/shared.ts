import { getNodeRegistration, type NodeType } from "../registry/nodes";
import { getProtectionPartitions } from "../registry/protection";

/**
 * The registry has no field-to-partition map, so a generic mutation on a split
 * or protected type could put protected fields into `graph_nodes.record`. The
 * generic node mutations therefore accept only types whose every partition is
 * Tier 0; the owning feature defines a named mutation for the rest.
 */
export function isTier0Only(nodeType: NodeType): boolean {
  const partitions = getProtectionPartitions(nodeType);
  return partitions.length > 0 && partitions.every((partition) => partition.tier === 0);
}

export interface Provenance {
  readonly workspaceId: string;
  readonly userId: string;
  /** UTC ISO-8601. */
  readonly now: string;
}

/**
 * Provenance is the server's: a client cannot claim who created a record or
 * when. The optimistic client applies the same stamps, so what it shows is
 * what replication later delivers.
 */
export function stampNewNode(
  node: Record<string, unknown>,
  nodeType: NodeType,
  provenance: Provenance,
): Record<string, unknown> {
  const policy = getNodeRegistration(nodeType).universalFields;
  const base: Record<string, unknown> = {
    ...node,
    workspace_id: provenance.workspaceId,
  };
  if (policy === "anonymous-contribution") {
    for (const key of [
      "created_at",
      "created_by",
      "updated_at",
      "updated_by",
      "soft_deleted_at",
      "soft_deleted_by",
    ]) {
      delete base[key];
    }
    return { ...base, is_soft_deleted: false };
  }
  return {
    ...base,
    created_at: provenance.now,
    created_by: provenance.userId,
    updated_at: provenance.now,
    updated_by: provenance.userId,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

export function updateStamp(
  nodeType: string,
  provenance: Provenance,
): Record<string, unknown> {
  return getNodeRegistration(nodeType as NodeType).universalFields === "standard"
    ? { updated_at: provenance.now, updated_by: provenance.userId }
    : {};
}

export function stampNewEdge(
  edge: Record<string, unknown>,
  provenance: Provenance,
): Record<string, unknown> {
  return {
    ...edge,
    metadata: edge["metadata"] ?? {},
    created_at: provenance.now,
    created_by: provenance.userId,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
  };
}

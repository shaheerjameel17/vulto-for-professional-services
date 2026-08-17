import { getNodeRegistration, type NodeType } from "./nodes";
import { type DataTier, type ProtectionPartition } from "./types";

/** Standing Rule 8: provenance follows the most restrictive source tier. */
export const resolveInheritedTier = (sourceTiers: readonly DataTier[]): DataTier => {
  if (sourceTiers.length === 0) {
    throw new Error("Inherited protection requires at least one source tier");
  }

  return Math.max(...sourceTiers) as DataTier;
};

/**
 * Public, type-level partitions are enough to render an A004-T19 placeholder.
 * This returns schema facts only; it never inspects a node instance or grant.
 */
export const getProtectionPartitions = (
  nodeType: NodeType,
): readonly ProtectionPartition[] => {
  const protection = getNodeRegistration(nodeType).protection;

  if (protection.kind === "split") {
    return protection.partitions;
  }

  if (protection.kind === "fixed") {
    return [
      {
        key: "record",
        privacyClass: protection.privacyClass,
        tier: protection.tier,
      },
    ];
  }

  return [];
};

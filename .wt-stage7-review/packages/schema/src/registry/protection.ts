import { getNodeRegistration, type NodeType } from "./nodes";
import {
  PRIVACY_CLASSES,
  type DataTier,
  type PrivacyClass,
  type ProtectionPartition,
} from "./types";

/** A003's total default map. `Inherited` is resolved from provenance, never defaulted. */
export const DEFAULT_PRIVACY_CLASS_TIERS = {
  Standard: 0,
  "Recipient-only": 0,
  "Self only": 0,
  "Finance-restricted": 1,
  "Self and Finance-restricted": 1,
  "HR-restricted": 2,
  "Manager-restricted": 2,
  "Owner and HR Admin only": 2,
  "HR Admin only": 2,
  "Owner only": 2,
  Sensitive: 3,
  "Self-only, absolute": 3,
} as const satisfies Record<Exclude<PrivacyClass, "Inherited">, DataTier>;

export function resolvePrivacyClassDefaultTier(
  privacyClass: unknown,
  inheritedSourceTiers?: readonly DataTier[],
): DataTier {
  if (!PRIVACY_CLASSES.includes(privacyClass as PrivacyClass)) {
    throw new Error(`Unknown Privacy Class: ${String(privacyClass)}`);
  }
  if (privacyClass === "Inherited") {
    return resolveInheritedTier(inheritedSourceTiers ?? []);
  }
  return DEFAULT_PRIVACY_CLASS_TIERS[
    privacyClass as Exclude<PrivacyClass, "Inherited">
  ];
}

/** Standing Rule 8: provenance follows the most restrictive source tier. */
export const resolveInheritedTier = (sourceTiers: readonly DataTier[]): DataTier => {
  if (sourceTiers.length === 0) {
    throw new Error("Inherited protection requires at least one source tier");
  }

  return Math.max(...sourceTiers) as DataTier;
};

/**
 * Resolves the enforced tier for a registered node partition. The explicit
 * A002 registration wins over the class default where A002 records a
 * departure or a field-level split; inherited protection has no safe answer
 * without concrete source tiers and therefore fails closed.
 *
 * Reader identity is intentionally absent. A004/FDN-89 supply one concrete
 * ReaderSet separately; a class default is never converted into readers here.
 */
export function resolveRegisteredProtectionTier(input: {
  readonly nodeType: NodeType;
  readonly schemaPartition: string;
  readonly inheritedSourceTiers?: readonly DataTier[];
}): DataTier {
  const protection = getNodeRegistration(input.nodeType).protection;
  if (protection.kind === "inherited") {
    return resolvePrivacyClassDefaultTier(
      protection.privacyClass,
      input.inheritedSourceTiers,
    );
  }
  if (protection.kind === "fixed") return protection.tier;
  const partition = protection.partitions.find(
    ({ key }) => key === input.schemaPartition,
  );
  if (!partition) {
    throw new Error(
      `Unknown protection partition for ${input.nodeType}: ${input.schemaPartition}`,
    );
  }
  return partition.tier;
}

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

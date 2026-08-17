export const PRIVACY_CLASSES = [
  "Standard",
  "Finance-restricted",
  "HR-restricted",
  "Manager-restricted",
  "Owner and HR Admin only",
  "HR Admin only",
  "Owner only",
  "Sensitive",
  "Self and Finance-restricted",
  "Self only",
  "Self-only, absolute",
  "Recipient-only",
  "Inherited",
] as const;

export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];
export type DataTier = 0 | 1 | 2 | 3;

export type LifecyclePolicy =
  | {
      readonly kind: "fixed";
      readonly statuses: readonly [string, ...string[]];
    }
  | {
      readonly kind: "feature-owned";
    };

export type ProtectionPolicy =
  | {
      readonly kind: "fixed";
      readonly privacyClass: Exclude<PrivacyClass, "Inherited">;
      readonly tier: DataTier;
      readonly tierDepartureReason?: string;
    }
  | {
      readonly kind: "split";
      readonly partitions: readonly [ProtectionPartition, ProtectionPartition];
    }
  | {
      readonly kind: "inherited";
      readonly privacyClass: "Inherited";
      readonly tier: "Inherited";
    };

export interface ProtectionPartition {
  readonly key: string;
  readonly privacyClass: Exclude<PrivacyClass, "Inherited">;
  readonly tier: DataTier;
}

export type UniversalFieldPolicy =
  "standard" | "immutable-audit" | "anonymous-contribution";

export interface NodeRegistrationShape {
  readonly nodeType: string;
  readonly owner: string;
  readonly lifecycle: LifecyclePolicy;
  readonly protection: ProtectionPolicy;
  readonly universalFields: UniversalFieldPolicy;
}

export const fixedLifecycle = (
  ...statuses: readonly [string, ...string[]]
): LifecyclePolicy => ({ kind: "fixed", statuses });

export const featureOwnedLifecycle: LifecyclePolicy = {
  kind: "feature-owned",
};

export const fixedProtection = (
  privacyClass: Exclude<PrivacyClass, "Inherited">,
  tier: DataTier,
  tierDepartureReason?: string,
): ProtectionPolicy => ({
  kind: "fixed",
  privacyClass,
  tier,
  ...(tierDepartureReason === undefined ? {} : { tierDepartureReason }),
});

export const splitProtection = (
  first: ProtectionPartition,
  second: ProtectionPartition,
): ProtectionPolicy => ({ kind: "split", partitions: [first, second] });

export const inheritedProtection: ProtectionPolicy = {
  kind: "inherited",
  privacyClass: "Inherited",
  tier: "Inherited",
};

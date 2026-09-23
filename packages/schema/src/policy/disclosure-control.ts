export const K_ANONYMITY_MINIMUM_DEFAULT = 5;
export const K_ANONYMITY_MINIMUM_SENSITIVE_DEFAULT = 8;
export const K_ANONYMITY_FLOOR = 3;

export type DisclosureControlResult<T> =
  | { readonly state: "suppressed" }
  | { readonly state: "visible"; readonly value: T; readonly unfiltered: boolean };

/** Reads legacy or malformed values conservatively and always enforces the floor. */
export function readKAnonymityThreshold(
  value: unknown,
  fallback = K_ANONYMITY_MINIMUM_DEFAULT,
): number {
  const parsed =
    typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return Math.max(K_ANONYMITY_FLOOR, parsed);
}

/** VPS-A004's reusable suppression and differencing-protection mechanism. */
export function applyDisclosureControl<T>(input: {
  readonly cohortSize: number;
  readonly unfilteredCohortSize: number;
  readonly threshold: number;
  readonly computeFiltered: () => T;
  readonly computeUnfiltered: () => T;
}): DisclosureControlResult<T> {
  const threshold = readKAnonymityThreshold(input.threshold);
  if (input.cohortSize < threshold) return { state: "suppressed" };
  if (
    input.cohortSize < input.unfilteredCohortSize &&
    input.unfilteredCohortSize - input.cohortSize < threshold
  ) {
    return {
      state: "visible",
      value: input.computeUnfiltered(),
      unfiltered: true,
    };
  }
  return {
    state: "visible",
    value: input.computeFiltered(),
    unfiltered: false,
  };
}

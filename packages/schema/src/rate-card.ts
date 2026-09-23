export interface AssignmentRateInput {
  readonly overrideHourly: number | null;
  readonly cardHourlyRate: number | null;
  /** Employee.billing_rate_default is a daily amount. */
  readonly billingRateDefault: number | null;
}

/** VRS-F006 G04: one portable resolution order for every Assignment write. */
export function resolveAssignmentRate(input: AssignmentRateInput): number | null {
  if (input.overrideHourly !== null) return input.overrideHourly;
  if (input.cardHourlyRate !== null) return input.cardHourlyRate;
  return input.billingRateDefault === null ? null : input.billingRateDefault / 8;
}

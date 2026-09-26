/** F336: pure arithmetic, rounded to four decimals, half away from zero.
 * Four decimal places preserve sub-day grants without storing floating-point noise.
 */
export const roundToilDays = (value: number): number =>
  (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 10_000)) / 10_000;

export function computeToilAccrual(input: {
  logged_hours: number;
  expected_hours: number;
  standard_daily_hours: number;
  accrual_rate: number;
  held_days: number;
  max_days: number;
}) {
  const requested_days = roundToilDays(
    input.standard_daily_hours > 0
      ? (Math.max(0, input.logged_hours - input.expected_hours) /
          input.standard_daily_hours) *
          input.accrual_rate
      : 0,
  );
  const granted_days = roundToilDays(
    Math.min(requested_days, Math.max(0, input.max_days - input.held_days)),
  );
  return {
    requested_days,
    granted_days,
    capped: granted_days < requested_days,
    cap_days: input.max_days,
  };
}

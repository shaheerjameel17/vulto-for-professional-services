import { addIsoDays } from "./working-day";
import type { LeavePolicyConfiguration, LeaveType } from "./leave-policy";

export interface LeaveBalanceInput {
  readonly employee: { readonly start_date: string };
  readonly policyVersions: readonly (LeavePolicyConfiguration & {
    readonly version: number;
  })[];
  readonly leave_type: LeaveType;
  readonly as_of_date: string;
  readonly usage: readonly {
    readonly leave_type: LeaveType;
    readonly start_date: string;
    readonly end_date: string;
  }[];
}
export interface LeaveBalanceDependencies {
  readonly countWorkingDays: (from: string, to: string) => number | Promise<number>;
}
export interface LeaveBalance {
  readonly entitledYtd: number;
  readonly carriedOver: number;
  readonly used: number;
  readonly remaining: number;
  readonly expiringSoon: number;
  readonly notes: string[];
}

/** F330: only the policy-year boundary is a UTC calendar year. */
const yearStart = (year: number) => `${String(year).padStart(4, "0")}-01-01`;
const monthStart = (year: number, month: number) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** Pure, dependency-injected engine; no stored balance and no working-day calculation. */
export async function computeLeaveBalance(
  input: LeaveBalanceInput,
  dependencies: LeaveBalanceDependencies,
): Promise<LeaveBalance> {
  const versions = [...input.policyVersions].sort(
    (a, b) => a.effective_from.localeCompare(b.effective_from) || a.version - b.version,
  );
  const typeAt = (date: string) =>
    versions
      .filter((v) => v.effective_from <= date)
      .at(-1)
      ?.leave_types.find((t) => t.leave_type === input.leave_type);
  const empty: LeaveBalance = {
    entitledYtd: 0,
    carriedOver: 0,
    used: 0,
    remaining: 0,
    expiringSoon: 0,
    notes: [],
  };
  if (input.employee.start_date > input.as_of_date) return empty;
  if (typeAt(input.as_of_date)?.accrual_method === "Earned")
    return {
      ...empty,
      notes: ["Earned accrual is not built yet; it is deferred to Stage 28."],
    };
  const firstYear = Number(input.employee.start_date.slice(0, 4));
  const lastYear = Number(input.as_of_date.slice(0, 4));
  let carry = 0;
  let expiryDays = 0;
  let answer = empty;
  const count = (from: string, to: string) =>
    from > to
      ? Promise.resolve(0)
      : Promise.resolve(dependencies.countWorkingDays(from, to));
  for (let year = firstYear; year <= lastYear; year += 1) {
    const start = yearStart(year);
    const end = year === lastYear ? input.as_of_date : `${year}-12-31`;
    const employmentStart = later(start, input.employee.start_date);
    let entitled = 0;
    const grant = typeAt(employmentStart);
    if (grant?.accrual_method === "Immediate" || grant?.accrual_method === "Annual")
      entitled = grant.annual_entitlement_days;
    for (let month = 1; month <= 12; month += 1) {
      const from = monthStart(year, month);
      const to = addIsoDays(
        month === 12 ? yearStart(year + 1) : monthStart(year, month + 1),
        -1,
      );
      if (to > end || to < employmentStart) continue;
      const config = typeAt(to);
      if (config?.accrual_method !== "Monthly") continue;
      let fraction = 1;
      if (employmentStart > from) {
        const whole = await count(from, to);
        fraction = whole > 0 ? (await count(employmentStart, to)) / whole : 0;
      }
      entitled += (config.annual_entitlement_days / 12) * fraction;
    }
    // Calendar offsets describe expiry/window boundaries, never leave quantities.
    const expiry = addIsoDays(start, expiryDays);
    let usedBeforeExpiry = 0;
    let usedAfterExpiry = 0;
    for (const usage of input.usage) {
      if (usage.leave_type !== input.leave_type) continue;
      const from = later(usage.start_date, employmentStart);
      const to = earlier(usage.end_date, end);
      if (from > to) continue;
      usedBeforeExpiry += await count(from, earlier(to, addIsoDays(expiry, -1)));
      usedAfterExpiry += await count(later(from, expiry), to);
    }
    const carryConsumed = Math.min(carry, usedBeforeExpiry);
    const availableCarry = end < expiry ? carry - carryConsumed : 0;
    const used = usedBeforeExpiry + usedAfterExpiry;
    const remaining = entitled + availableCarry - (used - carryConsumed);
    const notes: string[] = [];
    if (remaining < 0)
      notes.push(
        `Usage exceeds available accrual by ${-remaining} working days under ${typeAt(end)?.accrual_method ?? "no applicable method"}.`,
      );
    answer = {
      entitledYtd: entitled,
      carriedOver: availableCarry,
      used,
      remaining,
      expiringSoon:
        availableCarry > 0 && expiry > end && expiry <= addIsoDays(end, 30)
          ? availableCarry
          : 0,
      notes,
    };
    const closing = typeAt(`${year}-12-31`);
    carry = Math.min(Math.max(0, remaining), closing?.carryover_max_days ?? 0);
    expiryDays = closing?.carryover_expiry_days ?? 0;
  }
  return answer;
}

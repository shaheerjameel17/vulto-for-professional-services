import { describe, expect, it } from "vitest";
import { computeLeaveBalance } from "./leave-balance";
import { leavePolicyConfigurationSchema } from "./leave-policy";
import { resolveWorkingDay, isoDatesInclusive } from "./working-day";

const version = (
  method = "Monthly",
  entitlement = 14,
  fields: Record<string, unknown> = {},
) => ({
  ...leavePolicyConfigurationSchema.parse({
    name: "Policy",
    jurisdiction: "PK",
    employment_type_scope: "All",
    leave_types: [
      {
        leave_type: "Annual",
        accrual_method: method,
        annual_entitlement_days: entitlement,
        ...fields,
      },
    ],
  }),
  version: 1,
});
const dependencies = {
  countWorkingDays: (from: string, to: string) =>
    isoDatesInclusive(from, to).reduce(
      (sum, date) =>
        sum +
        resolveWorkingDay({
          date,
          location: null,
          pattern: null,
          holidays: [],
          calendar: {
            standardDailyHours: 8,
            reducedHoursPeriods: [],
            workingWeek: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
              day,
              is_working: day !== 5 && day !== 6,
              hours: day !== 5 && day !== 6 ? 8 : 0,
            })),
          },
        }).dayFraction,
      0,
    ),
};
const input = (
  as_of_date: string,
  policyVersions = [version()],
  start_date = "2026-01-01",
  usage: { leave_type: "Annual"; start_date: string; end_date: string }[] = [],
) => ({
  employee: { start_date },
  policyVersions,
  as_of_date,
  leave_type: "Annual" as const,
  usage,
});
describe("VRS-F018 pure working-day accrual", () => {
  it("grants 7 of 14 monthly days after six complete months, none for a month in progress", async () => {
    expect(
      (await computeLeaveBalance(input("2026-06-30"), dependencies)).entitledYtd,
    ).toBeCloseTo(7);
    expect(
      (await computeLeaveBalance(input("2026-06-15"), dependencies)).entitledYtd,
    ).toBeCloseTo((14 * 5) / 12);
  });
  it("prorates only the partial first month through working days", async () => {
    const result = await computeLeaveBalance(
      input("2026-01-31", [version("Monthly", 12)], "2026-01-15"),
      dependencies,
    );
    expect(result.entitledYtd).toBeCloseTo(11 / 21);
  });
  it("keeps earlier accrual unchanged and applies an update forward", async () => {
    const first = version("Monthly", 12);
    const next = {
      ...version("Monthly", 24),
      version: 2,
      effective_from: "2026-07-01",
    };
    expect(
      (await computeLeaveBalance(input("2026-06-30", [first, next]), dependencies))
        .entitledYtd,
    ).toBe(6);
    expect(
      (await computeLeaveBalance(input("2026-08-31", [first, next]), dependencies))
        .entitledYtd,
    ).toBe(10);
  });
  it("deducts only three working days from five UAE days spanning Friday and Saturday", async () => {
    const result = await computeLeaveBalance(
      input("2026-01-31", [version("Immediate", 14)], "2026-01-01", [
        { leave_type: "Annual", start_date: "2026-01-01", end_date: "2026-01-05" },
      ]),
      dependencies,
    );
    expect(result.used).toBe(3);
    expect(result.remaining).toBe(11);
  });
  it("caps carry-over, forfeits excess, expires on day 91 and reports expiringSoon", async () => {
    const policies = [version("Annual", 14, { carryover_max_days: 5 })];
    expect(
      (await computeLeaveBalance(input("2027-01-01", policies), dependencies))
        .remaining,
    ).toBe(19);
    expect(
      (await computeLeaveBalance(input("2027-03-15", policies), dependencies))
        .expiringSoon,
    ).toBe(5);
    expect(
      (await computeLeaveBalance(input("2027-03-31", policies), dependencies))
        .carriedOver,
    ).toBe(5);
    expect(
      (await computeLeaveBalance(input("2027-04-01", policies), dependencies))
        .remaining,
    ).toBe(14);
  });
  it("consumes carry first, so already-used carry does not expire twice", async () => {
    const policies = [version("Annual", 14, { carryover_max_days: 5 })];
    const usage = [
      {
        leave_type: "Annual" as const,
        start_date: "2027-01-03",
        end_date: "2027-01-04",
      },
    ];
    expect(
      await computeLeaveBalance(
        input("2027-03-15", policies, "2026-01-01", usage),
        dependencies,
      ),
    ).toMatchObject({ used: 2, carriedOver: 3, remaining: 17, expiringSoon: 3 });
    expect(
      (
        await computeLeaveBalance(
          input("2027-04-01", policies, "2026-01-01", usage),
          dependencies,
        )
      ).remaining,
    ).toBe(14);
  });
  it("returns negative remaining with the cause, size and method", async () => {
    const result = await computeLeaveBalance(
      input("2026-01-05", [version("Monthly", 14)], "2026-01-01", [
        { leave_type: "Annual", start_date: "2026-01-01", end_date: "2026-01-05" },
      ]),
      dependencies,
    );
    expect(result.remaining).toBe(-3);
    expect(result.notes[0]).toContain("3 working days under Monthly");
  });
  it("grants Immediate and Annual once per year including a later start", async () => {
    for (const method of ["Immediate", "Annual"]) {
      expect(
        (
          await computeLeaveBalance(
            input("2026-07-10", [version(method)], "2026-07-10"),
            dependencies,
          )
        ).entitledYtd,
      ).toBe(14);
      expect(
        (
          await computeLeaveBalance(
            input("2026-07-09", [version(method)], "2026-07-10"),
            dependencies,
          )
        ).entitledYtd,
      ).toBe(0);
    }
  });
  it("returns a plain zero and explicit note for deferred Earned accrual", async () => {
    const policy = {
      ...leavePolicyConfigurationSchema.parse({
        name: "TOIL",
        jurisdiction: "AE",
        employment_type_scope: "All",
        leave_types: [
          { leave_type: "TOIL", accrual_method: "Earned", annual_entitlement_days: 0 },
        ],
      }),
      version: 1,
    };
    const result = await computeLeaveBalance(
      { ...input("2026-06-30"), policyVersions: [policy], leave_type: "TOIL" },
      dependencies,
    );
    expect(result.entitledYtd).toBe(0);
    expect(result.notes).toEqual([
      "Earned accrual is not built yet; it is deferred to Stage 28.",
    ]);
  });
});

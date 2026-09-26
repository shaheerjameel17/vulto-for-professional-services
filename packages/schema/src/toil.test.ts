import { describe, expect, it } from "vitest";
import { computeToilAccrual, roundToilDays } from "./toil";
import { computeLeaveBalance, type LeaveBalanceInput } from "./leave-balance";
import { leavePolicyConfigurationSchema } from "./leave-policy";
import { leaveLedgerEntryFieldsSchema } from "./leave-ledger";

const base = {
  logged_hours: 48,
  expected_hours: 40,
  standard_daily_hours: 8,
  accrual_rate: 1,
  held_days: 0,
  max_days: 10,
};
describe("VRS-F018 TOIL arithmetic", () => {
  it("grants the spec's one day and one-and-a-half rate", () => {
    expect(computeToilAccrual(base).granted_days).toBe(1);
    expect(computeToilAccrual({ ...base, accrual_rate: 1.5 }).granted_days).toBe(1.5);
  });
  it("uses the employee's day, including a four-day pattern and a shorter daily pattern", () => {
    expect(
      computeToilAccrual({
        ...base,
        logged_hours: 40,
        expected_hours: 32,
        standard_daily_hours: 32 / 4,
      }).granted_days,
    ).toBe(1);
    expect(
      computeToilAccrual({
        ...base,
        logged_hours: 24,
        expected_hours: 20,
        standard_daily_hours: 4,
      }).granted_days,
    ).toBe(1);
  });
  it("caps at held ten, grants only partial headroom, and never grants at or below expected", () => {
    expect(computeToilAccrual({ ...base, held_days: 10 })).toMatchObject({
      granted_days: 0,
      capped: true,
      cap_days: 10,
    });
    expect(computeToilAccrual({ ...base, held_days: 9.75 })).toMatchObject({
      granted_days: 0.25,
      capped: true,
    });
    for (const logged_hours of [40, 32])
      expect(computeToilAccrual({ ...base, logged_hours }).granted_days).toBe(0);
    expect(computeToilAccrual({ ...base, standard_daily_hours: 0 }).granted_days).toBe(
      0,
    );
  });
  it("rounds half away from zero at four places", () => {
    expect(roundToilDays(1.23445)).toBe(1.2345);
    expect(roundToilDays(-1.23445)).toBe(-1.2345);
  });
});
const policy = {
  ...leavePolicyConfigurationSchema.parse({
    name: "TOIL",
    jurisdiction: "PK",
    employment_type_scope: "All",
    leave_types: [
      { leave_type: "TOIL", accrual_method: "Earned", annual_entitlement_days: 0 },
    ],
  }),
  version: 1,
};
const input = (
  date: string,
  ledger: LeaveBalanceInput["ledger"],
  usage: LeaveBalanceInput["usage"] = [],
): LeaveBalanceInput => ({
  employee: { start_date: "2025-01-01" },
  policyVersions: [policy],
  leave_type: "TOIL",
  as_of_date: date,
  ledger,
  usage,
});
const entry = (
  days = 1,
  effective_date = "2026-01-01",
  expires_on: string | null = "2026-04-01",
) => ({ leave_type: "TOIL" as const, days, effective_date, expires_on });
const countWorkingDays = () => 1;
describe("VRS-F018 Earned ledger balance", () => {
  it("uses the ledger's effective window, not the non-Earned employment-start cutoff", async () => {
    const balance = await computeLeaveBalance(
      { ...input("2026-01-15", [entry()]), employee: { start_date: "2026-02-01" } },
      { countWorkingDays },
    );
    expect(balance.remaining).toBe(1);
    const consumed = await computeLeaveBalance(
      {
        ...input(
          "2026-01-15",
          [entry()],
          [{ leave_type: "TOIL", start_date: "2026-01-10", end_date: "2026-01-10" }],
        ),
        employee: { start_date: "2026-02-01" },
      },
      { countWorkingDays },
    );
    expect(consumed.remaining).toBe(0);
    expect(consumed.used).toBe(1);
  });
  it("is live until exclusive expiry, freeing cap headroom", async () => {
    const before = await computeLeaveBalance(input("2026-03-31", [entry(10)]), {
      countWorkingDays,
    });
    const expired = await computeLeaveBalance(input("2026-04-01", [entry(10)]), {
      countWorkingDays,
    });
    expect(before.remaining).toBe(10);
    expect(expired.remaining).toBe(0);
    expect(
      computeToilAccrual({ ...base, held_days: expired.remaining }).granted_days,
    ).toBe(1);
  });
  it("consumes earliest expiry first using entries live at usage start", async () => {
    const balance = await computeLeaveBalance(
      input(
        "2026-04-01",
        [entry(1), entry(2, "2026-01-01", null)],
        [{ leave_type: "TOIL", start_date: "2026-03-01", end_date: "2026-03-01" }],
      ),
      { countWorkingDays },
    );
    expect(balance.used).toBe(1);
    expect(balance.remaining).toBe(2);
  });
  it("separates prior years, current entitlement and soon expiry, ignoring future entries", async () => {
    const balance = await computeLeaveBalance(
      input("2026-01-15", [
        entry(2, "2025-12-01", "2026-02-01"),
        entry(1, "2026-01-01", null),
        entry(99, "2026-02-01", null),
      ]),
      { countWorkingDays },
    );
    expect(balance).toMatchObject({
      carriedOver: 2,
      entitledYtd: 1,
      remaining: 3,
      expiringSoon: 2,
    });
  });
  it("explains uncovered usage with cause and size", async () => {
    const balance = await computeLeaveBalance(
      input(
        "2026-02-01",
        [],
        [{ leave_type: "TOIL", start_date: "2026-01-20", end_date: "2026-01-20" }],
      ),
      { countWorkingDays },
    );
    expect(balance.remaining).toBe(-1);
    expect(balance.notes[0]).toContain(
      "Usage exceeds available Earned accrual by 1 working days",
    );
  });
});
describe("LeaveLedgerEntry strict boundary", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const now = "2026-01-01T00:00:00.000Z";
  const record = {
    node_id: id,
    node_type: "LeaveLedgerEntry",
    workspace_id: id,
    schema_version: 1,
    lifecycle_status: "Active",
    created_at: now,
    created_by: id,
    updated_at: now,
    updated_by: id,
    is_soft_deleted: false,
    soft_deleted_at: null,
    soft_deleted_by: null,
    employee_id: id,
    entry_kind: "ToilAccrual",
    leave_type: "TOIL",
    days: 1,
    effective_date: "2026-01-01",
    expires_on: null,
    policy_id: id,
    source_flag_id: id,
  };
  it("accepts only positive TOIL grants and the exact non-protected field set", () => {
    expect(leaveLedgerEntryFieldsSchema.safeParse(record).success).toBe(true);
    for (const days of [0, -1])
      expect(leaveLedgerEntryFieldsSchema.safeParse({ ...record, days }).success).toBe(
        false,
      );
    for (const field of ["hours", "week", "reason", "note"])
      expect(
        leaveLedgerEntryFieldsSchema.safeParse({ ...record, [field]: "forbidden" })
          .success,
      ).toBe(false);
  });
});

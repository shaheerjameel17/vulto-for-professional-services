import { describe, expect, it } from "vitest";
import {
  leavePolicyFieldsSchema,
  leavePolicyConfigurationSchema,
} from "./leave-policy";

const config = {
  name: "Pakistan",
  jurisdiction: "PK",
  employment_type_scope: "FullTime",
  leave_types: [
    { leave_type: "Annual", accrual_method: "Monthly", annual_entitlement_days: 14 },
  ],
} as const;
describe("LeavePolicy strict configuration", () => {
  it("defaults configuration, validates dates and rejects unknown fields", () => {
    const parsed = leavePolicyConfigurationSchema.parse(config);
    expect(parsed.effective_from).toBe("1900-01-01");
    expect(parsed.leave_types[0]).toMatchObject({
      carryover_max_days: 0,
      carryover_expiry_days: 90,
      minimum_notice_days: 0,
      requires_approval: true,
      is_encashable: false,
    });
    expect(parsed.overtime_policy).toEqual({
      requires_pre_approval: false,
      toil_accrual_rate: 1,
      toil_expiry_days: 90,
      toil_max_accrued_days: 10,
    });
    expect(
      leavePolicyConfigurationSchema.safeParse({ ...config, unknown: true }).success,
    ).toBe(false);
    expect(
      leavePolicyConfigurationSchema.safeParse({
        ...config,
        effective_from: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(leavePolicyFieldsSchema.safeParse(config).success).toBe(false);
  });
  it("requires Earned iff TOIL, unique leave types and ordered blackouts", () => {
    const entry = config.leave_types[0];
    for (const leave_types of [
      [{ ...entry, accrual_method: "Earned" }],
      [{ ...entry, leave_type: "TOIL" }],
      [entry, entry],
      [],
      [{ ...entry, annual_entitlement_days: -1 }],
    ])
      expect(
        leavePolicyConfigurationSchema.safeParse({ ...config, leave_types }).success,
      ).toBe(false);
    expect(
      leavePolicyConfigurationSchema.safeParse({
        ...config,
        leave_types: [{ ...entry, leave_type: "TOIL", accrual_method: "Earned" }],
      }).success,
    ).toBe(true);
    expect(
      leavePolicyConfigurationSchema.safeParse({
        ...config,
        blackout_periods: [
          {
            start_date: "2026-12-02",
            end_date: "2026-12-01",
            reason: "Busy",
            applies_to_leave_types: "All",
          },
        ],
      }).success,
    ).toBe(false);
  });
});

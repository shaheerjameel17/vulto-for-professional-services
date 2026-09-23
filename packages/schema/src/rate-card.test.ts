import { describe, expect, it } from "vitest";
import { resolveAssignmentRate } from "./rate-card";

describe("VRS-F006 rate resolution", () => {
  it("uses override, then card, then the daily default converted to hourly", () => {
    expect(
      resolveAssignmentRate({
        overrideHourly: 140,
        cardHourlyRate: 120,
        billingRateDefault: 800,
      }),
    ).toBe(140);
    expect(
      resolveAssignmentRate({
        overrideHourly: null,
        cardHourlyRate: 120,
        billingRateDefault: 800,
      }),
    ).toBe(120);
    expect(
      resolveAssignmentRate({
        overrideHourly: null,
        cardHourlyRate: null,
        billingRateDefault: 800,
      }),
    ).toBe(100);
    expect(
      resolveAssignmentRate({
        overrideHourly: null,
        cardHourlyRate: null,
        billingRateDefault: null,
      }),
    ).toBeNull();
  });
});

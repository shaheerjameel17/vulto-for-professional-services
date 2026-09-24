import { describe, expect, it } from "vitest";
import { calculateUtilization } from "./utilization-snapshot";

describe("VRS-F011 utilization arithmetic", () => {
  it("divides by expected hours, not the hours logged", () => {
    expect(
      calculateUtilization({
        expectedHours: 40,
        billableHours: 4,
        nonBillableHours: 0,
        pitchHours: 0,
      }),
    ).toMatchObject({ utilization_rate: 10, logging_completeness: 10 });
  });

  it("keeps pitch hours out of utilization and logged share", () => {
    expect(
      calculateUtilization({
        expectedHours: 40,
        billableHours: 20,
        nonBillableHours: 0,
        pitchHours: 15,
      }),
    ).toMatchObject({
      pitch_hours: 15,
      logged_hours: 20,
      utilization_rate: 50,
      billable_share_of_logged: 100,
    });
  });

  it("returns zero for every ratio with zero denominators", () => {
    expect(
      calculateUtilization({
        expectedHours: 0,
        billableHours: 0,
        nonBillableHours: 0,
        pitchHours: 0,
      }),
    ).toMatchObject({
      utilization_rate: 0,
      billable_share_of_logged: 0,
      logging_completeness: 0,
    });
  });
});

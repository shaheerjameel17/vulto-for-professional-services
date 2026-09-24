import { describe, expect, it } from "vitest";
import {
  detectHoursExceedExpected,
  detectPostEndDateAssignment,
  detectZeroVarianceWeek,
  type AnomalyEntry,
} from "./timesheet-anomaly";

const entry = (overrides: Partial<AnomalyEntry> = {}): AnomalyEntry => ({
  date: "2026-09-30",
  hours: 8,
  time_category: "Billable",
  assignment_id: "a",
  pitch_id: null,
  ...overrides,
});

describe("VRS-F010 anomaly detection", () => {
  it("detects billable work after an assignment ends", () => {
    expect(detectPostEndDateAssignment([entry()], { a: "2026-09-29" })).toBe(true);
    expect(detectPostEndDateAssignment([entry()], { a: "2026-09-30" })).toBe(false);
    expect(
      detectPostEndDateAssignment([entry({ time_category: "Pitch" })], {
        a: "2026-09-29",
      }),
    ).toBe(false);
  });

  it("requires two distinct rows with identical cell hours", () => {
    expect(detectZeroVarianceWeek([entry(), entry({ date: "2026-10-01" })])).toBe(
      false,
    );
    expect(detectZeroVarianceWeek([entry(), entry({ assignment_id: "b" })])).toBe(true);
    expect(
      detectZeroVarianceWeek([entry(), entry({ assignment_id: "b", hours: 7 })]),
    ).toBe(false);
  });

  it("excludes any Pitch week from expected-hours detection", () => {
    expect(detectHoursExceedExpected([entry({ hours: 11 })], 8)).toBe(true);
    expect(
      detectHoursExceedExpected(
        [
          entry({ hours: 11 }),
          entry({
            time_category: "Pitch",
            assignment_id: null,
            pitch_id: "p",
            hours: 1,
          }),
        ],
        8,
      ),
    ).toBe(false);
    expect(detectHoursExceedExpected([entry({ hours: 10.4 })], 8)).toBe(false);
    expect(
      detectHoursExceedExpected(
        [entry({ hours: 17 }), entry({ date: "2026-10-01", hours: 17 })],
        32,
      ),
    ).toBe(false);
  });
});

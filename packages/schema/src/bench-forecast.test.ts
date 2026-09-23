import { describe, expect, it } from "vitest";
import {
  applyDisclosureControl,
  readKAnonymityThreshold,
} from "./policy/disclosure-control";
import { matchesBenchForecastFilters } from "./bench-forecast";
import { benchForecastGetInputSchema } from "./bench-forecast";
import { resolveWorkingDay } from "./working-day";

const week = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  day,
  is_working: day <= 5,
  hours: day <= 5 ? 8 : 0,
}));

describe("Stage 13 shared Bench Forecast functions", () => {
  it("resolves Holiday, Pattern, Calendar and ReducedHoursPeriod in one pure function", () => {
    const input = {
      calendar: {
        workingWeek: week,
        standardDailyHours: 8,
        reducedHoursPeriods: [
          {
            name: "Reduced",
            start_date: "2026-03-01",
            end_date: "2026-03-31",
            factor: 0.75,
            is_provisional: false,
            estimated_start_date: null,
          },
        ],
      },
      pattern: { workingWeek: [{ day: 1, is_working: true, hours: 6 }] },
      holidays: [],
      location: null,
    } as const;
    expect(resolveWorkingDay({ ...input, date: "2026-03-02" })).toMatchObject({
      hours: 4.5,
      dayFraction: 0.5625,
    });
    expect(
      resolveWorkingDay({
        ...input,
        holidays: [{ date: "2026-03-02", appliesToLocations: null, isHalfDay: true }],
        date: "2026-03-02",
      }),
    ).toMatchObject({ hours: 3, dayFraction: 0.375 });
  });

  it("matches OR within filter fields and AND across them, including G02 availability", () => {
    const candidate = {
      skillIds: ["skill-a"],
      seniorityLevel: "Senior",
      department: "Engineering",
      entityId: "entity-a",
      benchDays: ["2026-04-07"],
    };
    expect(
      matchesBenchForecastFilters(candidate, {
        skillIds: ["skill-z", "skill-a"],
        seniorityLevels: ["Lead", "Senior"],
        departments: ["Engineering"],
        entityIds: ["entity-a"],
        availability: { fromDate: "2026-04-01", toDate: "2026-04-10" },
      }),
    ).toBe(true);
    expect(
      matchesBenchForecastFilters(candidate, {
        departments: ["Design"],
        skillIds: ["skill-a"],
      }),
    ).toBe(false);
    expect(matchesBenchForecastFilters(candidate, {})).toBe(true);
  });

  it("suppresses a four-person cohort at the default threshold of five", () => {
    expect(
      applyDisclosureControl({
        cohortSize: 4,
        unfilteredCohortSize: 12,
        threshold: 5,
        computeFiltered: () => 0.5,
        computeUnfiltered: () => 0.75,
      }),
    ).toEqual({ state: "suppressed" });
  });

  it("returns the unfiltered aggregate for a twelve-to-eleven difference", () => {
    expect(
      applyDisclosureControl({
        cohortSize: 11,
        unfilteredCohortSize: 12,
        threshold: 5,
        computeFiltered: () => 0.5,
        computeUnfiltered: () => 0.75,
      }),
    ).toEqual({ state: "visible", value: 0.75, unfiltered: true });
  });

  it("enforces the k-anonymity floor on every read", () => {
    expect(readKAnonymityThreshold(1)).toBe(3);
    expect(readKAnonymityThreshold(8)).toBe(8);
    expect(readKAnonymityThreshold(null, 5)).toBe(5);
  });

  it("does not accept client-selected employee ids for the server cohort", () => {
    expect(
      benchForecastGetInputSchema.safeParse({
        workspace_id: "10000000-0000-4000-8000-000000000001",
        window: { from_date: "2026-03-01", to_date: "2026-03-31" },
        employee_ids: ["10000000-0000-4000-8000-000000000002"],
      }).success,
    ).toBe(false);
  });
});

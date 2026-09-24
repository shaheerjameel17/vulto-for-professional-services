import { describe, expect, it } from "vitest";
import { initialWorkingWeekFor } from "./mutations/calendar";
import { resolveWeekStartDate } from "./working-day";

describe("F276 explicit calendar week boundary", () => {
  it("sets each jurisdiction template's boundary independently of worked days", () => {
    for (const jurisdiction of ["PK", "Global", "IN", "SG", "UK", "US"])
      expect(initialWorkingWeekFor(jurisdiction).week_start_day).toBe(1);
    for (const jurisdiction of ["AE", "SA"])
      expect(initialWorkingWeekFor(jurisdiction).week_start_day).toBe(7);
  });

  it("resolves seven-day and split schedules from the fixed anchor, not the work pattern", () => {
    expect(resolveWeekStartDate("2026-09-23", 7)).toBe("2026-09-20");
    expect(resolveWeekStartDate("2026-09-23", 1)).toBe("2026-09-21");
    expect(resolveWeekStartDate("2026-09-20", 7)).toBe("2026-09-20");
    expect(resolveWeekStartDate("2026-09-20", 1)).toBe("2026-09-14");
  });
});

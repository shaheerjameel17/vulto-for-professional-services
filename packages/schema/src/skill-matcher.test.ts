import { describe, expect, it } from "vitest";
import { proficiencyMeets, severityFor } from "./skill-matcher";

describe("VRS-F013 proficiency and severity", () => {
  it("uses one ordered proficiency ladder", () => {
    expect(proficiencyMeets("Expert", "Senior")).toBe(true);
    expect(proficiencyMeets("Senior", "Senior")).toBe(true);
    expect(proficiencyMeets("Intermediate", "Senior")).toBe(false);
    expect(proficiencyMeets("Beginner", "Intermediate")).toBe(false);
  });

  it("applies the project working-day thresholds and lenient missing-date fallback", () => {
    expect(severityFor(null)).toBe("Low");
    expect(severityFor(61)).toBe("Low");
    expect(severityFor(60)).toBe("Medium");
    expect(severityFor(30)).toBe("Medium");
    expect(severityFor(29)).toBe("High");
    expect(severityFor(14)).toBe("High");
    expect(severityFor(13)).toBe("Critical");
  });
});

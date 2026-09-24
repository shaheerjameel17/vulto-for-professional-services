import { describe, expect, it } from "vitest";
import { resolveDailyCost, severityFor } from "./revenue-gap-alert";

describe("VRS-F012 pure alert rules", () => {
  it("prefers the most recently ended Assignment's stored hourly rate", () => {
    expect(
      resolveDailyCost({ effective_billing_rate: 15 }, { billing_rate_default: 400 }),
    ).toBe(120);
    expect(
      resolveDailyCost({ effective_billing_rate: null }, { billing_rate_default: 400 }),
    ).toBe(400);
    expect(resolveDailyCost(null, {})).toBe(0);
  });

  it("escalates at each multiple of the five-working-day threshold", () => {
    expect(severityFor(5)).toBe("Low");
    expect(severityFor(10)).toBe("Medium");
    expect(severityFor(15)).toBe("High");
  });
});

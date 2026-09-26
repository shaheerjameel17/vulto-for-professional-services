import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_RULES,
  validateNotificationRules,
  type NotificationRule,
} from "./notification-rules";

describe("notification disclosure registry", () => {
  const rule = NOTIFICATION_RULES[0];
  const rejects = (change: Partial<NotificationRule>) =>
    expect(() => validateNotificationRules([{ ...rule, ...change }])).toThrow();
  it("registers exactly the two settled rules", () => {
    expect(NOTIFICATION_RULES.map((entry) => entry.ruleId)).toEqual([
      "revenue-gap-alert",
      "timesheet-anomaly-flag",
    ]);
    expect(() => validateNotificationRules(NOTIFICATION_RULES)).not.toThrow();
  });
  it("defers muting: all shipped rules are ActionNeeded", () => {
    // The first Informational rule must decide the preference's home in its owning stage.
    expect(NOTIFICATION_RULES.every((entry) => entry.category === "ActionNeeded")).toBe(
      true,
    );
  });
  it("refuses unknown sources and duplicate ids", () => {
    rejects({ sourceNodeType: "Unknown" });
    expect(() => validateNotificationRules([rule, rule])).toThrow(/Duplicate/);
  });
  it("refuses protected subject and source fields", () => {
    rejects({ messageFields: [{ from: "subject", field: "salary" }] });
    rejects({
      sourceNodeType: "TimesheetAnomalyFlag",
      discriminatorField: undefined,
      messageFields: [{ from: "source", field: "detail" }],
    });
    rejects({
      sourceNodeType: "Employee",
      messageFields: [{ from: "source", field: "full_name" }],
    });
  });
  it("refuses undeclared money references and protected discriminators", () => {
    rejects({ messageTemplate: "{source.daily_cost}" });
    rejects({ sourceNodeType: "TimesheetAnomalyFlag", discriminatorField: "severity" });
  });
});

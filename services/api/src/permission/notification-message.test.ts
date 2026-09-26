import { describe, expect, it } from "vitest";
import { NOTIFICATION_RULES } from "@vulto/schema";
import { renderNotificationMessage } from "../mutations/notification-delivery.js";

describe("notification message disclosure", () => {
  it("renders declared fields only, never monetary or protected sentinel values", () => {
    const subject = {
      full_name: "Safe Person",
      salary: "SENTINEL-tier1",
      notes: "SENTINEL-tier2",
    };
    const source = {
      bench_days: 5,
      daily_cost: "SENTINEL-money",
      accumulated_cost: "SENTINEL-money",
      detail: "SENTINEL-tier2",
      compensation: "SENTINEL-tier1",
    };
    for (const rule of NOTIFICATION_RULES) {
      const message = renderNotificationMessage(rule, subject, source);
      expect(message).toContain("Safe Person");
      expect(message).not.toContain("SENTINEL");
      expect(message).not.toContain("daily_cost");
      expect(message).not.toContain("accumulated_cost");
    }
  });
});

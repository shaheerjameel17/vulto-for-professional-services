import { describe, expect, it } from "vitest";
import { auditLogQueryInputSchema } from "./audit-query";

const randomUUID = () => "c779c044-5500-41d4-a3b8-846b647f4fde";

describe("F324 audit query input", () => {
  it("is strict, defaults to 50, caps at 200 and uses the closed filter vocabulary", () => {
    const base = { workspace_id: randomUUID() };
    expect(auditLogQueryInputSchema.parse(base).limit).toBe(50);
    expect(auditLogQueryInputSchema.parse({ ...base, limit: 200 }).limit).toBe(200);
    for (const extra of [
      { limit: 201 },
      { limit: 0 },
      { target_tier: 4 },
      { event_types: ["MadeUp"] },
      { target_node_type: "MadeUp" },
      { start_date: "2026-02-30" },
      { filters: {} },
    ])
      expect(auditLogQueryInputSchema.safeParse({ ...base, ...extra }).success).toBe(
        false,
      );
  });

  it("validates the opaque cursor rather than accepting arbitrary base64 or JSON", () => {
    const base = { workspace_id: randomUUID() };
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const good = {
      occurred_at: "2026-09-26T00:00:00.000Z",
      audit_entry_id: randomUUID(),
    };
    expect(
      auditLogQueryInputSchema.safeParse({ ...base, cursor: encode(good) }).success,
    ).toBe(true);
    for (const cursor of [
      "!",
      "",
      encode({}),
      encode({ ...good, occurred_at: "invalid" }),
      encode({ ...good, audit_entry_id: "invalid" }),
      encode({ ...good, content: "no" }),
      `${encode(good)}=`,
    ])
      expect(auditLogQueryInputSchema.safeParse({ ...base, cursor }).success).toBe(
        false,
      );
  });
});

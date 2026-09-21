import { describe, expect, it } from "vitest";
import {
  parseWorkspaceRoles,
  serializeWorkspaceRoles,
  workspaceRoleSchema,
} from "./auth.js";

describe("workspace admission roles", () => {
  it("keeps the founder-approved stored role set closed", () => {
    expect(workspaceRoleSchema.options).toEqual([
      "owner",
      "hr-admin",
      "finance-admin",
      "team-member",
    ]);
    expect(() => workspaceRoleSchema.parse("manager")).toThrow();
  });

  it("serializes multiple roles once and parses them back", () => {
    const serialized = serializeWorkspaceRoles([
      "team-member",
      "hr-admin",
      "team-member",
    ]);
    expect(serialized).toBe("hr-admin,team-member");
    expect(parseWorkspaceRoles(serialized)).toEqual(["hr-admin", "team-member"]);
  });

  it("refuses an empty membership role", () => {
    expect(() => serializeWorkspaceRoles([])).toThrow(
      "A workspace membership must carry at least one role",
    );
    expect(() => parseWorkspaceRoles("")).toThrow(
      "A workspace membership must carry at least one role",
    );
  });
});

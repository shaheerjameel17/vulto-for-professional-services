import { describe, expect, it } from "vitest";
import { assertAllowedKey, DEVICE_DATABASE } from "./device-identity";

describe("the device database (kept across sign-out so a revocation cannot be shed)", () => {
  it("may hold exactly the device id and the pending-erase list, in one store", () => {
    expect(DEVICE_DATABASE.name).toBe("vulto:device");
    expect([...DEVICE_DATABASE.stores]).toEqual(["meta"]);
    expect([...DEVICE_DATABASE.keys]).toEqual(["device-id", "erase-pending"]);
  });

  it("refuses to write anything else", () => {
    assertAllowedKey("device-id");
    assertAllowedKey("erase-pending");
    for (const key of ["user", "workspace", "token", "session", "email"]) {
      expect(() => assertAllowedKey(key)).toThrow();
    }
  });
});

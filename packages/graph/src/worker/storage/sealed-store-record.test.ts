import { describe, expect, it } from "vitest";
import { parseSealedPayloadRecord } from "./sealed-store";

const physicalKey = "workspace-1:vulto:protected-manifest:workspace-1";
const valid = {
  storeKey: physicalKey,
  workspaceId: "workspace-1",
  generation: 7,
  digest: "A".repeat(43),
  iv: new Uint8Array(12),
  ciphertext: new Uint8Array(16),
};

describe("sealed payload durable metadata", () => {
  it("accepts the exact CAS record shape", () => {
    expect(parseSealedPayloadRecord(valid, physicalKey, "workspace-1")).toEqual(valid);
  });

  it.each([
    ["foreign physical key", { ...valid, storeKey: `${physicalKey}:other` }],
    ["foreign workspace", { ...valid, workspaceId: "workspace-2" }],
    ["fractional generation", { ...valid, generation: 7.5 }],
    ["negative generation", { ...valid, generation: -1 }],
    ["unsafe generation", { ...valid, generation: Number.MAX_SAFE_INTEGER + 1 }],
    ["noncanonical digest", { ...valid, digest: "A".repeat(44) }],
    ["short IV", { ...valid, iv: new Uint8Array(11) }],
    ["missing GCM tag", { ...valid, ciphertext: new Uint8Array(15) }],
    ["unknown field", { ...valid, extra: true }],
  ])("rejects %s", (_label, candidate) => {
    expect(() =>
      parseSealedPayloadRecord(candidate, physicalKey, "workspace-1"),
    ).toThrow("cannot be opened");
  });
});

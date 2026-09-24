import { describe, expect, it } from "vitest";
import {
  NEAR_CAPACITY_WARNING_THRESHOLD_DEFAULT,
  readNearCapacityThreshold,
} from "./capacity-conflict";

describe("VRS-F008 capacity settings", () => {
  it("reads a configured threshold and otherwise uses the shared 90% default", () => {
    expect(readNearCapacityThreshold(85)).toBe(85);
    expect(readNearCapacityThreshold(undefined)).toBe(
      NEAR_CAPACITY_WARNING_THRESHOLD_DEFAULT,
    );
    expect(readNearCapacityThreshold(Number.NaN)).toBe(
      NEAR_CAPACITY_WARNING_THRESHOLD_DEFAULT,
    );
  });
});

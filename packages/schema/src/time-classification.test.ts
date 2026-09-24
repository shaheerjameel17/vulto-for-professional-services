import { describe, expect, it } from "vitest";
import {
  INTERNAL_CATEGORIES,
  TIME_CATEGORIES,
  timeClassificationFieldsSchema,
  validateTimeClassification,
} from "./time-classification";

const id = "e9e9e9e9-e9e9-4e9e-8e9e-e9e9e9e9e9e9";

describe("VRS-F009 classification contract", () => {
  it("has exactly three categories and five fixed internal categories", () => {
    expect(TIME_CATEGORIES).toEqual(["Billable", "NonBillable", "Pitch"]);
    expect(INTERNAL_CATEGORIES).toEqual([
      "Meeting",
      "Training",
      "Admin",
      "InternalProject",
      "Other",
    ]);
    expect(
      timeClassificationFieldsSchema.parse({
        time_category: "NonBillable",
        internal_category: "InternalProject",
      }),
    ).toEqual({ time_category: "NonBillable", internal_category: "InternalProject" });
  });

  it("requires the category's one dependency and rejects others", () => {
    expect(() => validateTimeClassification({ time_category: "Billable" })).toThrow(
      "assignment_id",
    );
    expect(() => validateTimeClassification({ time_category: "NonBillable" })).toThrow(
      "internal_category",
    );
    expect(() => validateTimeClassification({ time_category: "Pitch" })).toThrow(
      "pitch_id",
    );
    expect(() =>
      validateTimeClassification({ time_category: "Billable", assignment_id: id }),
    ).not.toThrow();
    expect(() =>
      validateTimeClassification({
        time_category: "NonBillable",
        internal_category: "Training",
      }),
    ).not.toThrow();
    expect(() =>
      validateTimeClassification({ time_category: "Pitch", pitch_id: id }),
    ).not.toThrow();
    expect(() =>
      validateTimeClassification({
        time_category: "Billable",
        assignment_id: id,
        pitch_id: id,
      }),
    ).toThrow("cannot include");
    expect(() =>
      validateTimeClassification({
        time_category: "Pitch",
        pitch_id: id,
        internal_category: "Admin",
      }),
    ).toThrow("cannot include");
  });
});

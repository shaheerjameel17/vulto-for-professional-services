import { z } from "zod";
import { uuidV4Schema } from "./records";

export const TIME_CATEGORIES = ["Billable", "NonBillable", "Pitch"] as const;
export const INTERNAL_CATEGORIES = [
  "Meeting",
  "Training",
  "Admin",
  "InternalProject",
  "Other",
] as const;

/** VRS-F010 incorporates these fields into TimesheetEntry. */
export const timeClassificationFieldsSchema = z
  .object({
    time_category: z.enum(TIME_CATEGORIES),
    internal_category: z.enum(INTERNAL_CATEGORIES).nullable(),
  })
  .strict();

interface TimeClassificationInput {
  readonly time_category: (typeof TIME_CATEGORIES)[number];
  readonly internal_category?: (typeof INTERNAL_CATEGORIES)[number] | null;
  readonly assignment_id?: string | null;
  readonly pitch_id?: string | null;
}

/**
 * Pure field-dependency check. VRS-F010 additionally verifies that the named
 * Assignment exists and that the employee is staffed on the named Pitch.
 */
export function validateTimeClassification(input: TimeClassificationInput): void {
  if (!TIME_CATEGORIES.includes(input.time_category)) {
    throw new Error("Invalid time_category");
  }
  if (input.time_category === "Billable") {
    if (!uuidV4Schema.safeParse(input.assignment_id).success)
      throw new Error("Billable time requires a valid assignment_id");
    if (input.internal_category != null || input.pitch_id != null)
      throw new Error("Billable time cannot include internal_category or pitch_id");
    return;
  }
  if (input.time_category === "NonBillable") {
    if (!z.enum(INTERNAL_CATEGORIES).safeParse(input.internal_category).success)
      throw new Error("NonBillable time requires an internal_category");
    if (input.assignment_id != null || input.pitch_id != null)
      throw new Error("NonBillable time cannot include assignment_id or pitch_id");
    return;
  }
  if (!uuidV4Schema.safeParse(input.pitch_id).success)
    throw new Error("Pitch time requires a valid pitch_id");
  if (input.internal_category != null || input.assignment_id != null)
    throw new Error("Pitch time cannot include internal_category or assignment_id");
}

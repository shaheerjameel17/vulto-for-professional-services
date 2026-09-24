import { z } from "zod";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

const proposedAssignmentSchema = z
  .object({
    employee_id: uuidV4Schema,
    project_id: uuidV4Schema,
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    billable_percentage: z.number().min(0).max(100),
    rate_card_id: uuidV4Schema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.start_date <= value.end_date, {
    message: "end_date must be on or after start_date",
  });

export const conflictResolutionOverrideAndProceed = defineMutation({
  name: "conflictResolution.overrideAndProceed",
  input: z
    .object({
      proposed: proposedAssignmentSchema,
      reason: z.string().trim().min(1),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const CONFLICT_RESOLUTION_MUTATIONS = {
  "conflictResolution.overrideAndProceed": conflictResolutionOverrideAndProceed,
} as const;

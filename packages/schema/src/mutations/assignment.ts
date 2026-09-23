import { z } from "zod";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

const isoDate = z.iso.date();
const percentage = z.number().min(0).max(100);

const assignmentDates = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine(
      (value) =>
        !("start_date" in value) ||
        !("end_date" in value) ||
        value.start_date === undefined ||
        value.end_date === undefined ||
        String(value.start_date) <= String(value.end_date),
      { message: "end_date must be on or after start_date" },
    );

export const assignmentCreate = defineMutation({
  name: "assignment.create",
  input: assignmentDates({
    employee_id: uuidV4Schema,
    project_id: uuidV4Schema,
    start_date: isoDate,
    end_date: isoDate,
    billable_percentage: percentage,
    rate_card_id: uuidV4Schema.nullable().optional(),
  }),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

const assignmentUpdateFields = assignmentDates({
  start_date: isoDate.optional(),
  end_date: isoDate.optional(),
  billable_percentage: percentage.optional(),
}).refine((value) => Object.keys(value).length > 0, "A patch must change something");

export const assignmentUpdate = defineMutation({
  name: "assignment.update",
  input: z
    .object({ assignment_id: uuidV4Schema, fields: assignmentUpdateFields })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const assignmentCancel = defineMutation({
  name: "assignment.cancel",
  input: z
    .object({ assignment_id: uuidV4Schema, expected_version: z.int().positive() })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const assignmentSetRateCard = defineMutation({
  name: "assignment.setRateCard",
  input: z.object({ assignment_id: uuidV4Schema, rate_card_id: uuidV4Schema }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const assignmentSetRateOverride = defineMutation({
  name: "assignment.setRateOverride",
  input: z
    .object({
      assignment_id: uuidV4Schema,
      hourly: z.number().nonnegative(),
      reason: z.string().trim().min(1),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const assignmentClearRateOverride = defineMutation({
  name: "assignment.clearRateOverride",
  input: z.object({ assignment_id: uuidV4Schema }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const ASSIGNMENT_MUTATIONS = {
  "assignment.create": assignmentCreate,
  "assignment.update": assignmentUpdate,
  "assignment.cancel": assignmentCancel,
  "assignment.setRateCard": assignmentSetRateCard,
  "assignment.setRateOverride": assignmentSetRateOverride,
  "assignment.clearRateOverride": assignmentClearRateOverride,
} as const;

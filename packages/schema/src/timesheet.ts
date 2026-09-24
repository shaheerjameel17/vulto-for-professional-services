import { z } from "zod";
import { utcTimestampSchema, uuidV4Schema } from "./records";
import { timeClassificationFieldsSchema } from "./time-classification";

const isoDate = z.iso.date();
const nullableText = z.string().nullable();

/** The standard node envelope, kept explicit on each feature-owned record. */
const envelope = {
  node_id: uuidV4Schema,
  workspace_id: uuidV4Schema,
  schema_version: z.int().positive(),
  created_at: utcTimestampSchema,
  created_by: uuidV4Schema,
  updated_at: utcTimestampSchema,
  updated_by: uuidV4Schema,
  is_soft_deleted: z.boolean(),
  soft_deleted_at: utcTimestampSchema.nullable(),
  soft_deleted_by: uuidV4Schema.nullable(),
} as const;

export const timesheetEntryFieldsSchema = z
  .object({
    ...envelope,
    node_type: z.literal("TimesheetEntry"),
    employee_id: uuidV4Schema,
    assignment_id: uuidV4Schema.nullable(),
    pitch_id: uuidV4Schema.nullable(),
    ...timeClassificationFieldsSchema.shape,
    date: isoDate,
    hours: z.number().min(0).max(24),
    week_start_date: isoDate,
    notes: nullableText,
    lifecycle_status: z.enum(["Draft", "Submitted"]),
    submitted_at: utcTimestampSchema.nullable(),
  })
  .strict();

export const timesheetWeekSubmissionFieldsSchema = z
  .object({
    ...envelope,
    node_type: z.literal("TimesheetWeekSubmission"),
    employee_id: uuidV4Schema,
    week_start_date: isoDate,
    submitted_at: utcTimestampSchema,
    lifecycle_status: z.literal("Submitted"),
  })
  .strict();

export const TIMESHEET_ANOMALY_REASONS = [
  "PostEndDateAssignment",
  "ZeroVarianceWeek",
  "HoursExceedExpected",
] as const;
export const TIMESHEET_CLEARANCE_OUTCOMES = [
  "Corrected",
  "AcceptedAsNormal",
  "ApprovedOvertime",
] as const;

export const timesheetAnomalyFlagFieldsSchema = z
  .object({
    ...envelope,
    node_type: z.literal("TimesheetAnomalyFlag"),
    employee_id: uuidV4Schema,
    week_start_date: isoDate,
    flag_reason: z.enum(TIMESHEET_ANOMALY_REASONS),
    detail: z.string(),
    lifecycle_status: z.literal("Active"),
    cleared_at: utcTimestampSchema.nullable(),
    cleared_by: uuidV4Schema.nullable(),
    clearance_outcome: z.enum(TIMESHEET_CLEARANCE_OUTCOMES).nullable(),
    clearance_note: nullableText,
  })
  .strict();

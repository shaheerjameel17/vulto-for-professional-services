import { z } from "zod";
import { INTERNAL_CATEGORIES } from "./time-classification";
import { utcTimestampSchema, uuidV4Schema } from "./records";

const nonnegativeHours = z.number().finite().nonnegative();

/** VRS-F011's Tier 0 derived row, including the universal node envelope. */
export const utilizationSnapshotFieldsSchema = z
  .object({
    node_id: uuidV4Schema,
    snapshot_id: uuidV4Schema,
    workspace_id: uuidV4Schema,
    node_type: z.literal("UtilizationSnapshot"),
    schema_version: z.int().positive(),
    lifecycle_status: z.literal("Active"),
    created_at: utcTimestampSchema,
    created_by: uuidV4Schema,
    updated_at: utcTimestampSchema,
    updated_by: uuidV4Schema,
    is_soft_deleted: z.boolean(),
    soft_deleted_at: utcTimestampSchema.nullable(),
    soft_deleted_by: uuidV4Schema.nullable(),
    employee_id: uuidV4Schema,
    week_start_date: z.iso.date(),
    expected_hours: nonnegativeHours,
    billable_hours: nonnegativeHours,
    non_billable_hours: nonnegativeHours,
    pitch_hours: nonnegativeHours,
    logged_hours: nonnegativeHours,
    utilization_rate: z.number().finite().nonnegative(),
    billable_share_of_logged: z.number().finite().nonnegative(),
    logging_completeness: z.number().finite().nonnegative(),
    non_billable_breakdown: z.partialRecord(
      z.enum(INTERNAL_CATEGORIES),
      nonnegativeHours,
    ),
    target_utilization: z.number().min(0).max(1).nullable(),
    computed_at: utcTimestampSchema,
  })
  .strict();

export interface UtilizationInput {
  readonly expectedHours: number;
  readonly billableHours: number;
  readonly nonBillableHours: number;
  readonly pitchHours: number;
}

/** Pitch is reported separately: it enters neither utilization numerator nor denominator. */
export function calculateUtilization(input: UtilizationInput) {
  const loggedHours = input.billableHours + input.nonBillableHours;
  const oneDecimal = (value: number) => Math.round(value * 10) / 10;
  return {
    expected_hours: input.expectedHours,
    billable_hours: input.billableHours,
    non_billable_hours: input.nonBillableHours,
    pitch_hours: input.pitchHours,
    logged_hours: loggedHours,
    utilization_rate:
      input.expectedHours === 0
        ? 0
        : oneDecimal((input.billableHours / input.expectedHours) * 100),
    billable_share_of_logged:
      loggedHours === 0 ? 0 : oneDecimal((input.billableHours / loggedHours) * 100),
    logging_completeness:
      input.expectedHours === 0
        ? 0
        : oneDecimal((loggedHours / input.expectedHours) * 100),
  };
}

export const utilizationGetIndividualInputSchema = z
  .object({
    employee_id: uuidV4Schema,
    week_start_date: z.iso.date().optional(),
  })
  .strict();

/** A department filter is the dashboard's first cohort selector. */
export const utilizationAgencyFiltersSchema = z
  .object({ departments: z.array(z.string()).optional() })
  .strict();
export type UtilizationAgencyFilters = z.infer<typeof utilizationAgencyFiltersSchema>;

export const utilizationGetAgencyInputSchema = z
  .object({
    workspace_id: uuidV4Schema,
    week_start_date: z.iso.date().optional(),
    filters: utilizationAgencyFiltersSchema.optional(),
  })
  .strict();

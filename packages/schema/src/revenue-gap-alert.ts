import { z } from "zod";
import { utcTimestampSchema, uuidV4Schema } from "./records";

const nonnegativeAmount = z.number().finite().nonnegative();

/** VRS-F012's flat Tier 0 alert, including the universal node envelope. */
export const revenueGapAlertFieldsSchema = z
  .object({
    node_id: uuidV4Schema,
    alert_id: uuidV4Schema,
    workspace_id: uuidV4Schema,
    node_type: z.literal("RevenueGapAlert"),
    schema_version: z.int().positive(),
    lifecycle_status: z.enum(["Active", "Resolved"]),
    created_at: utcTimestampSchema,
    created_by: uuidV4Schema,
    updated_at: utcTimestampSchema,
    updated_by: uuidV4Schema,
    is_soft_deleted: z.boolean(),
    soft_deleted_at: utcTimestampSchema.nullable(),
    soft_deleted_by: uuidV4Schema.nullable(),
    employee_id: uuidV4Schema,
    bench_start_date: z.iso.date(),
    bench_days: z.int().nonnegative(),
    daily_cost: nonnegativeAmount,
    accumulated_cost: nonnegativeAmount,
    severity: z.enum(["Low", "Medium", "High"]),
    escalated_at: utcTimestampSchema.nullable(),
    dismissed_at: utcTimestampSchema.nullable(),
    resolved_at: utcTimestampSchema.nullable(),
    resolved_by: z.union([uuidV4Schema, z.literal("system")]).nullable(),
    resolved_by_assignment_id: uuidV4Schema.nullable(),
  })
  .strict();

/** An Assignment's stored hourly rate outranks the Employee's daily fallback. */
export function resolveDailyCost(
  mostRecentEndedAssignment: { readonly effective_billing_rate?: number | null } | null,
  employee: { readonly billing_rate_default?: number | null },
): number {
  const hourly = mostRecentEndedAssignment?.effective_billing_rate;
  if (typeof hourly === "number" && Number.isFinite(hourly) && hourly >= 0)
    return hourly * 8;
  const daily = employee.billing_rate_default;
  return typeof daily === "number" && Number.isFinite(daily) && daily >= 0 ? daily : 0;
}

export const BENCH_ALERT_THRESHOLD_DAYS = 5;

export function severityFor(
  benchDays: number,
  threshold = BENCH_ALERT_THRESHOLD_DAYS,
): "Low" | "Medium" | "High" {
  if (benchDays >= threshold * 3) return "High";
  if (benchDays >= threshold * 2) return "Medium";
  return "Low";
}

export const revenueGapAlertListInputSchema = z
  .object({ workspace_id: uuidV4Schema })
  .strict();
export const revenueGapAlertSweepInputSchema = revenueGapAlertListInputSchema;
export const revenueGapAlertDismissInputSchema = z
  .object({ alert_id: uuidV4Schema })
  .strict();

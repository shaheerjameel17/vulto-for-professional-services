import { z } from "zod";
import { EMPLOYMENT_TYPES } from "./employee";
import { JURISDICTIONS } from "./mutations/entity";
import { utcTimestampSchema, uuidV4Schema } from "./records";

export const LEAVE_TYPES = [
  "Annual",
  "Sick",
  "Casual",
  "Unpaid",
  "Parental",
  "Bereavement",
  "TOIL",
  "Other",
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const leaveTypeSchema = z.enum(LEAVE_TYPES);
export const leaveTypeConfigurationSchema = z
  .object({
    leave_type: leaveTypeSchema,
    accrual_method: z.enum(["Immediate", "Monthly", "Annual", "Earned"]),
    annual_entitlement_days: z.number().nonnegative(),
    carryover_max_days: z.number().nonnegative().default(0),
    carryover_expiry_days: z.int().nonnegative().default(90),
    minimum_notice_days: z.int().nonnegative().default(0),
    requires_approval: z.boolean().default(true),
    is_encashable: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => (v.leave_type === "TOIL") === (v.accrual_method === "Earned"),
    "Earned if and only if TOIL",
  );

const overtime = z
  .object({
    requires_pre_approval: z.boolean().default(false),
    toil_accrual_rate: z.number().nonnegative().default(1),
    toil_expiry_days: z.int().nonnegative().default(90),
    toil_max_accrued_days: z.number().nonnegative().default(10),
  })
  .strict();
const blackout = z
  .object({
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    reason: z.string().trim().min(1),
    applies_to_leave_types: z.union([z.array(leaveTypeSchema), z.literal("All")]),
  })
  .strict()
  .refine(
    (v) => v.start_date <= v.end_date,
    "Blackout start_date must not exceed end_date",
  );

export const leavePolicyConfigurationSchema = z
  .object({
    name: z.string().trim().min(1),
    jurisdiction: z.enum(JURISDICTIONS),
    employment_type_scope: z.enum([...EMPLOYMENT_TYPES, "All"]),
    leave_types: z
      .array(leaveTypeConfigurationSchema)
      .min(1)
      .refine(
        (v) => new Set(v.map((x) => x.leave_type)).size === v.length,
        "One entry per leave_type",
      ),
    overtime_policy: overtime.prefault({}),
    blackout_periods: z.array(blackout).default([]),
    effective_from: z.iso.date().default("1900-01-01"),
  })
  .strict();
export type LeavePolicyConfiguration = z.infer<typeof leavePolicyConfigurationSchema>;

export const leavePolicyFieldsSchema = leavePolicyConfigurationSchema
  .extend({
    node_id: uuidV4Schema,
    node_type: z.literal("LeavePolicy"),
    workspace_id: uuidV4Schema,
    schema_version: z.int().positive(),
    lifecycle_status: z.string().min(1),
    created_at: utcTimestampSchema,
    created_by: uuidV4Schema,
    updated_at: utcTimestampSchema,
    updated_by: uuidV4Schema,
    is_soft_deleted: z.boolean(),
    soft_deleted_at: utcTimestampSchema.nullable(),
    soft_deleted_by: uuidV4Schema.nullable(),
    version: z.int().positive(),
    supersedes_id: uuidV4Schema.nullable(),
    is_active: z.boolean().default(true),
  })
  .strict();
export type LeavePolicy = z.infer<typeof leavePolicyFieldsSchema>;

export const leavePolicyApplicableInputSchema = z
  .object({ employee_id: uuidV4Schema })
  .strict();
export const leavePolicyConflictsInputSchema = z
  .object({ workspace_id: uuidV4Schema })
  .strict();
export const leaveBalanceInputSchema = z
  .object({
    employee_id: uuidV4Schema,
    leave_type: leaveTypeSchema,
    as_of_date: z.iso.date().optional(),
  })
  .strict();

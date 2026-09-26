import { z } from "zod";
import { utcTimestampSchema, uuidV4Schema } from "./records";

/** F335: immutable Tier 0 accrual, with no protected flag content. */
export const leaveLedgerEntryFieldsSchema = z
  .object({
    node_id: uuidV4Schema,
    node_type: z.literal("LeaveLedgerEntry"),
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
    employee_id: uuidV4Schema,
    entry_kind: z.literal("ToilAccrual"),
    leave_type: z.literal("TOIL"),
    days: z.number().positive(),
    effective_date: z.iso.date(),
    expires_on: z.iso.date().nullable(),
    policy_id: uuidV4Schema,
    source_flag_id: uuidV4Schema,
  })
  .strict();
export type LeaveLedgerEntry = z.infer<typeof leaveLedgerEntryFieldsSchema>;
export const overtimePreviewInputSchema = z.object({ flag_id: uuidV4Schema }).strict();

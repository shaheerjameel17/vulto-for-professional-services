import { z } from "zod";
import { uuidV4Schema } from "./records";

export const PITCH_STATUSES = ["Active", "Won", "Lost", "Converted"] as const;

/** The Tier 0 identifying partition. Commercial fields have a separate owner. */
export const pitchIdentifyingFieldsSchema = z
  .object({
    pitch_id: uuidV4Schema,
    workspace_id: uuidV4Schema,
    name: z.string().min(1).max(200),
    client_id: uuidV4Schema.nullable(),
    projected_start_date: z.iso.date().nullable(),
    lifecycle_status: z.enum(PITCH_STATUSES),
  })
  .strict();

export const pitchListStaffedForInputSchema = z
  .object({ employee_id: uuidV4Schema })
  .strict();

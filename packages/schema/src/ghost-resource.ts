import { z } from "zod";
import { uuidV4Schema } from "./records";

export const GHOST_RESOURCE_STATUSES = ["Active", "Promoted", "Canceled"] as const;
export type GhostResourceStatus = (typeof GHOST_RESOURCE_STATUSES)[number];

export const ghostResourceRecordSchema = z
  .object({
    ghost_employee_id: uuidV4Schema,
    notes: z.string().nullable(),
  })
  .strict();

export const ghostResourceListInputSchema = z
  .object({
    workspace_id: uuidV4Schema,
    status: z.enum(GHOST_RESOURCE_STATUSES).optional(),
  })
  .strict();

export const ghostResourceTransition = (
  from: string,
  to: "Promoted" | "Canceled",
): boolean => from === "Active" && (to === "Promoted" || to === "Canceled");

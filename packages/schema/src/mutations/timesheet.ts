import { z } from "zod";
import { INTERNAL_CATEGORIES } from "../time-classification";
import { TIMESHEET_CLEARANCE_OUTCOMES } from "../timesheet";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

export const timesheetRowContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assignment"), assignment_id: uuidV4Schema }).strict(),
  z.object({ kind: z.literal("non-billable") }).strict(),
  z.object({ kind: z.literal("pitch"), pitch_id: uuidV4Schema }).strict(),
]);

export const timesheetSaveCell = defineMutation({
  name: "timesheet.saveCell",
  input: z
    .object({
      employee_id: uuidV4Schema,
      date: z.iso.date(),
      row_context: timesheetRowContextSchema,
      internal_category: z.enum(INTERNAL_CATEGORIES).nullable().optional(),
      hours: z.number().min(0).max(24),
      notes: z.string().nullable().optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

const weekInput = z
  .object({ employee_id: uuidV4Schema, week_start_date: z.iso.date() })
  .strict();

export const timesheetSubmitWeek = defineMutation({
  name: "timesheet.submitWeek",
  input: weekInput,
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const timesheetUnlockWeek = defineMutation({
  name: "timesheet.unlockWeek",
  input: weekInput,
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const timesheetAnomalyClear = defineMutation({
  name: "timesheetAnomaly.clear",
  input: z
    .object({
      flag_id: uuidV4Schema,
      outcome: z.enum(TIMESHEET_CLEARANCE_OUTCOMES),
      note: z.string().nullable().optional(),
      acknowledged_toil_days: z.number().nonnegative().optional(),
    })
    .strict(),
  tier: 2,
  onlineOnly: true,
  stateTransition: true,
});

export const TIMESHEET_MUTATIONS = {
  "timesheet.saveCell": timesheetSaveCell,
  "timesheet.submitWeek": timesheetSubmitWeek,
  "timesheet.unlockWeek": timesheetUnlockWeek,
  "timesheetAnomaly.clear": timesheetAnomalyClear,
} as const;

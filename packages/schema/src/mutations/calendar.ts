import { z } from "zod";
import { uuidV4Schema } from "../records";
import { defineMutation } from "./define";

export const workingDaySchema = z
  .object({
    day: z.int().min(1).max(7),
    is_working: z.boolean(),
    hours: z.number().nonnegative(),
  })
  .strict();

export const workingWeekSchema = z
  .array(workingDaySchema)
  .length(7)
  .superRefine((week, context) => {
    const days = week.map(({ day }) => day);
    if (
      new Set(days).size !== 7 ||
      ![1, 2, 3, 4, 5, 6, 7].every((d) => days.includes(d))
    ) {
      context.addIssue({
        code: "custom",
        message: "working_week must contain ISO weekdays 1 through 7 exactly once",
      });
    }
  });

export const partialWorkingWeekSchema = z
  .array(workingDaySchema)
  .max(7)
  .superRefine((week, context) => {
    if (new Set(week.map(({ day }) => day)).size !== week.length) {
      context.addIssue({
        code: "custom",
        message: "working_week cannot repeat a weekday",
      });
    }
  });

export const reducedHoursPeriodSchema = z
  .object({
    name: z.string().trim().min(1),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    factor: z.number().positive().max(1),
    is_provisional: z.boolean(),
    estimated_start_date: z.iso.date().nullable(),
  })
  .strict()
  .refine((period) => period.end_date >= period.start_date, {
    message: "end_date must be on or after start_date",
  });

export type WorkingWeek = z.infer<typeof workingWeekSchema>;
export type ReducedHoursPeriod = z.infer<typeof reducedHoursPeriodSchema>;

const week = (
  workingDays: readonly number[],
  hoursByDay: Partial<Record<number, number>> = {},
): WorkingWeek =>
  [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    is_working: workingDays.includes(day),
    hours: workingDays.includes(day) ? (hoursByDay[day] ?? 8) : 0,
  }));

/** F227/F232: one portable jurisdiction table used by server and optimistic writes. */
export function initialWorkingWeekFor(jurisdiction: string): {
  readonly working_week: WorkingWeek;
  readonly standard_daily_hours: number;
} {
  if (jurisdiction === "PK")
    return {
      working_week: week([1, 2, 3, 4, 5, 6], { 6: 4 }),
      standard_daily_hours: 8,
    };
  if (jurisdiction === "AE" || jurisdiction === "SA")
    return { working_week: week([7, 1, 2, 3, 4]), standard_daily_hours: 8 };
  return { working_week: week([1, 2, 3, 4, 5]), standard_daily_hours: 8 };
}

export const calendarUpdate = defineMutation({
  name: "calendar.update",
  input: z
    .object({
      calendar_id: uuidV4Schema,
      working_week: workingWeekSchema,
      daily_hours: z.number().nonnegative(),
      expected_version: z.int().positive(),
      reduced_hours_periods: z.array(reducedHoursPeriodSchema).optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

const holidayFields = z
  .object({
    name: z.string().trim().min(1),
    date: z.iso.date().optional(),
    holiday_type: z.enum(["Public", "Company", "Regional"]),
    is_provisional: z.boolean().default(false),
    estimated_date: z.iso.date().nullable().default(null),
    confirmation_window_days: z.int().nonnegative().default(3),
    applies_to_locations: z.array(z.string().trim().min(1)).nullable().default(null),
    is_half_day: z.boolean().default(false),
  })
  .strict()
  .superRefine((fields, context) => {
    if (
      fields.date === undefined &&
      (!fields.is_provisional || fields.estimated_date === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["date"],
        message: "date is required unless a provisional holiday has an estimated_date",
      });
    }
  });

export const holidayAdd = defineMutation({
  name: "holiday.add",
  input: z.object({ calendar_id: uuidV4Schema, fields: holidayFields }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const holidayConfirm = defineMutation({
  name: "holiday.confirm",
  input: z.object({ holiday_id: uuidV4Schema, actual_date: z.iso.date() }).strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: false,
});

export const holidayCancel = defineMutation({
  name: "holiday.cancel",
  input: z
    .object({ holiday_id: uuidV4Schema, expected_version: z.int().positive() })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const patternSet = defineMutation({
  name: "pattern.set",
  input: z
    .object({
      employee_id: uuidV4Schema,
      working_week: partialWorkingWeekSchema,
      effective_from: z.iso.date(),
      expected_version: z.int().positive().optional(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const patternClear = defineMutation({
  name: "pattern.clear",
  input: z
    .object({
      employee_id: uuidV4Schema,
      effective_from: z.iso.date(),
      expected_version: z.int().positive(),
    })
    .strict(),
  tier: 0,
  onlineOnly: false,
  stateTransition: true,
});

export const CALENDAR_MUTATIONS = {
  "calendar.update": calendarUpdate,
  "holiday.add": holidayAdd,
  "holiday.confirm": holidayConfirm,
  "holiday.cancel": holidayCancel,
  "pattern.set": patternSet,
  "pattern.clear": patternClear,
} as const;

export const calendarGetInputSchema = z
  .object({ entity_id: uuidV4Schema, as_of: z.iso.date().optional() })
  .strict();
export const workingDaysDateInputSchema = z
  .object({ employee_id: uuidV4Schema, date: z.iso.date() })
  .strict();
export const workingDaysRangeInputSchema = z
  .object({ employee_id: uuidV4Schema, from: z.iso.date(), to: z.iso.date() })
  .strict();
export const workingDaysNextInputSchema = z
  .object({
    employee_id: uuidV4Schema,
    from: z.iso.date(),
    n: z.int().positive().optional(),
  })
  .strict();
export const workingDaysAddInputSchema = z
  .object({ employee_id: uuidV4Schema, from: z.iso.date(), n: z.int().nonnegative() })
  .strict();

import type { ReducedHoursPeriod, WorkingWeek } from "./mutations/calendar";

export interface WorkingDayCalendar {
  readonly workingWeek: WorkingWeek;
  readonly standardDailyHours: number;
  readonly reducedHoursPeriods: readonly ReducedHoursPeriod[];
}

export interface WorkingDayPattern {
  readonly workingWeek: readonly WorkingWeek[number][];
}

export interface WorkingDayHoliday {
  readonly date: string;
  readonly appliesToLocations: readonly string[] | null;
  readonly isHalfDay: boolean;
}

export interface ResolveWorkingDayInput {
  readonly calendar: WorkingDayCalendar;
  readonly pattern: WorkingDayPattern | null;
  readonly holidays: readonly WorkingDayHoliday[];
  readonly date: string;
  readonly location: string | null;
}

export interface ResolvedWorkingDay {
  readonly isWorking: boolean;
  readonly hours: number;
  readonly standardDailyHours: number;
  readonly dayFraction: number;
}

const isoWeekday = (date: string): number => {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
};

/** F237: the one portable, pure implementation of VRS-F004's resolution order. */
export function resolveWorkingDay(input: ResolveWorkingDayInput): ResolvedWorkingDay {
  const { calendar, pattern, holidays, date, location } = input;
  const holiday = holidays.find(
    (candidate) =>
      candidate.date === date &&
      (candidate.appliesToLocations === null ||
        (location !== null && candidate.appliesToLocations.includes(location))),
  );
  const standardDailyHours = calendar.standardDailyHours;
  let hours: number;
  if (holiday && !holiday.isHalfDay) {
    hours = 0;
  } else if (holiday) {
    hours = standardDailyHours * 0.5;
  } else {
    const day = isoWeekday(date);
    const selected =
      pattern?.workingWeek.find((entry) => entry.day === day) ??
      calendar.workingWeek.find((entry) => entry.day === day);
    hours = selected?.is_working ? selected.hours : 0;
  }
  if (hours > 0) {
    const period = calendar.reducedHoursPeriods.find(
      (candidate) => candidate.start_date <= date && date <= candidate.end_date,
    );
    if (period) hours *= period.factor;
  }
  return {
    isWorking: hours > 0,
    hours,
    standardDailyHours,
    dayFraction: standardDailyHours > 0 ? hours / standardDailyHours : 0,
  };
}

export function addIsoDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

/** F276: a calendar's explicit week boundary, independent of worked days. */
export function resolveWeekStartDate(date: string, weekStartDay: number): string {
  if (!Number.isInteger(weekStartDay) || weekStartDay < 1 || weekStartDay > 7)
    throw new Error("invalid-week-start-day");
  return addIsoDays(date, -((isoWeekday(date) - weekStartDay + 7) % 7));
}

export function isoDatesInclusive(fromDate: string, toDate: string): string[] {
  if (fromDate > toDate) throw new Error("invalid-args");
  const dates: string[] = [];
  for (let date = fromDate; date <= toDate; date = addIsoDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

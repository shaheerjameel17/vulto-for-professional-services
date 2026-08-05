/*
 * The working-day index — the stand-in for VRS-F004.
 *
 * READ THIS BEFORE EDITING.
 *
 * Nothing in this product computes a working day. VRS-F004 owns that fact, and
 * VRS-F005 reads a materialized index of one row per employee per date holding
 * `is_working` and `hours`. This file plays VRS-F004's part: it is the only
 * place in the prototype that looks at what day of the week a date is, and it
 * exists to produce the index the way that feature's worker would.
 *
 * Everything downstream — the Forecast, bench derivation, cost accumulation —
 * reads the index and never inspects a date. If you find yourself writing
 * `getDay()` anywhere else, that is the bug this arrangement exists to prevent.
 *
 * Two entity calendars, deliberately divergent, so a weekend assumption
 * sneaking in anywhere is visible on screen rather than in six months:
 *
 *   Northgate Ltd · UK   Monday to Friday, 8 hours
 *   Northgate Karachi · PK  Monday to Friday 8 hours, Saturday 4 hours
 *
 * A Saturday is a working half-day in Karachi and not a working day in London.
 * VRS-F004 expresses a half day as reduced hours rather than a separate flag.
 */

export type EntityId = "uk" | "pk";

export type WorkingDay = {
  isWorking: boolean;
  hours: number;
};

/** VRS-F004's `working_week` JSON: keyed by ISO weekday 1–7. */
type WorkingWeek = Record<number, { isWorking: boolean; hours: number }>;

const WORKING_WEEK: Record<EntityId, WorkingWeek> = {
  uk: {
    1: { isWorking: true, hours: 8 },
    2: { isWorking: true, hours: 8 },
    3: { isWorking: true, hours: 8 },
    4: { isWorking: true, hours: 8 },
    5: { isWorking: true, hours: 8 },
    6: { isWorking: false, hours: 0 },
    7: { isWorking: false, hours: 0 },
  },
  pk: {
    1: { isWorking: true, hours: 8 },
    2: { isWorking: true, hours: 8 },
    3: { isWorking: true, hours: 8 },
    4: { isWorking: true, hours: 8 },
    5: { isWorking: true, hours: 8 },
    6: { isWorking: true, hours: 4 },
    7: { isWorking: false, hours: 0 },
  },
};

/** Holidays, per entity. A Sindh holiday does not remove a London working day. */
const HOLIDAYS: Record<EntityId, Record<string, string>> = {
  uk: {
    "2026-08-31": "Summer bank holiday",
    "2026-12-25": "Christmas Day",
  },
  pk: {
    "2026-08-14": "Independence Day",
    "2026-09-15": "Eid al-Adha (provisional)",
  },
};

export const ENTITY_NAMES: Record<EntityId, string> = {
  uk: "Northgate Ltd · UK",
  pk: "Northgate Karachi · PK",
};

/** The day this prototype is anchored to. */
export const TODAY = "2026-08-06";

/** ISO date string arithmetic, deliberately calendar-agnostic. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isoWeekday(iso: string): number {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Materialize the index. VRS-F004 holds a rolling twelve-months-past to
 * twenty-four-months-future window; the prototype holds enough for the
 * 180-day horizon plus the lead-in.
 */
function materialize(entity: EntityId, from: string, dayCount: number) {
  const index = new Map<string, WorkingDay>();
  const week = WORKING_WEEK[entity];
  const holidays = HOLIDAYS[entity];

  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = addDays(from, offset);
    const base = week[isoWeekday(date)] ?? { isWorking: false, hours: 0 };

    // VRS-F004's resolution order, first match winning. A holiday applying to
    // the employee's location resolves to zero hours before the working week
    // is consulted.
    if (holidays[date]) {
      index.set(date, { isWorking: false, hours: 0 });
      continue;
    }

    index.set(date, { ...base });
  }

  return index;
}

const INDEX_FROM = addDays(TODAY, -30);
const INDEX_DAYS = 460;

const INDEX: Record<EntityId, Map<string, WorkingDay>> = {
  uk: materialize("uk", INDEX_FROM, INDEX_DAYS),
  pk: materialize("pk", INDEX_FROM, INDEX_DAYS),
};

const ABSENT: WorkingDay = { isWorking: false, hours: 0 };

/**
 * The consuming interface — VRS-F004's `workingDays.isWorking` and
 * `workingDays.hoursOn`, collapsed into one lookup because the prototype
 * always wants both.
 */
export function workingDay(entity: EntityId, date: string): WorkingDay {
  return INDEX[entity].get(date) ?? ABSENT;
}

export function holidayName(
  entity: EntityId,
  date: string,
): string | undefined {
  return HOLIDAYS[entity][date];
}

/*
 * Working days in a year, per entity.
 *
 * FINDING F27: VRS-F005 requires bench cost be `bench working days × daily
 * cost`, with daily cost "derived from the employee's compensation" — which is
 * an annual figure per VRS-F002. No document states the denominator. VRS-F004
 * gives `standard_daily_hours` for hour-level proration but no annual working
 * day count, and VRS-F062 owns payroll proration but is thirty features later
 * and cannot be depended on by MVP feature five.
 *
 * Counted from the materialized index rather than assumed, so it stays correct
 * for a six-day week: London resolves near 252 and Karachi near 278.
 */
function countAnnualWorkingDays(entity: EntityId): number {
  let days = 0;
  for (let offset = 0; offset < 365; offset += 1) {
    if (INDEX[entity].get(addDays(TODAY, offset))?.isWorking) days += 1;
  }
  return days;
}

const ANNUAL_WORKING_DAYS: Record<EntityId, number> = {
  uk: countAnnualWorkingDays("uk"),
  pk: countAnnualWorkingDays("pk"),
};

export function annualWorkingDays(entity: EntityId): number {
  return ANNUAL_WORKING_DAYS[entity];
}

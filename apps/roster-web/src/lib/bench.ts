import { categoricalTokenForId } from "@vulto/tokens";
import type { TimelineDay, TimelineRow } from "@vulto/ui";
import {
  addDays,
  annualWorkingDays,
  holidayName,
  TODAY,
  workingDay,
} from "../fixtures/calendar";
import {
  ASSIGNMENTS,
  EMPLOYEES,
  PITCH_DAYS,
  PROJECT_BY_ID,
  type Employee,
} from "../fixtures/roster";

/*
 * VRS-F005's bench derivation.
 *
 * Bench time is never stored. It is derived, at render time, as the set of
 * working days per VRS-F004, within the window, for which the employee holds
 * no Active Assignment, less any day on which they logged Pitch-categorized
 * time per VRS-F009.
 *
 * Nothing here inspects a date's weekday. Whether a day is a working day comes
 * from the index in fixtures/calendar.ts, which is the prototype's stand-in for
 * VRS-F004 and the only place that fact is decided.
 */

export type Horizon = 30 | 90 | 180;

/*
 * PROVISIONAL, F2: no document gives a day-column width. A minimum is set per
 * horizon and the region scrolls rather than compressing the window to fit,
 * because at the 1280px design center ninety days would otherwise be about 9px
 * per day — a five-day bar of 45px, and a bench region too narrow to hold its
 * own cost figure at any zoom.
 */
export const DAY_WIDTH: Record<Horizon, number> = {
  30: 32,
  90: 20,
  180: 12,
};

/*
 * PROVISIONAL, F26: no document says where the window sits relative to today.
 * VRS-F005 gives a `T` shortcut to scroll today into view, which implies today
 * can be off-screen, so the window carries a lead-in rather than starting on
 * today.
 */
const LEAD_IN_DAYS = 14;

/*
 * PROVISIONAL, F36: the horizon at which a bench region stops carrying a cost
 * figure.
 *
 * At the 180-day horizon almost nobody has confirmed assignments covering the
 * back half of the window, so almost every row carried a large amber region and
 * the accumulated total ran to a quarter of a million pounds. The number was
 * arithmetically correct and operationally misleading: being unassigned five
 * months out is the normal state of a professional services firm, not a cost
 * already incurred. A screen that is mostly amber has lost what amber is for.
 *
 * A region beginning inside this boundary shows money. Beyond it, the same
 * region shows days and no figure, and the header total says which window it
 * is counting. A region that begins inside the boundary and runs past it counts
 * in full — the alternative is splitting one gap into two, which would say
 * something about the gap that is not true.
 */
export const COST_HORIZON_DAYS = 45;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const money = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export type ForecastRow = TimelineRow & {
  employee: Employee;
  /** Every bench working day in the window. */
  benchWorkingDays: number;
  /** Only those in regions beginning inside the cost horizon, per F36. */
  costedBenchWorkingDays: number;
  benchCost: number;
  nextRolloff?: string;
};

export type Forecast = {
  days: TimelineDay[];
  rows: ForecastRow[];
  todayIndex: number;
  /** PROVISIONAL, F30 — see note on `computeUtilization`. */
  utilization: number;
  ghostContribution: number;
  cohortSize: number;
  /** Counts only regions beginning inside the cost horizon, per F36. */
  totalBenchCost: number;
  benchedCount: number;
  costHorizonDays: number;
};

export function buildForecast(
  horizon: Horizon,
  canSeeCompensation: boolean,
): Forecast {
  const windowStart = addDays(TODAY, -LEAD_IN_DAYS);
  const dates: string[] = [];
  for (let offset = 0; offset < horizon + LEAD_IN_DAYS; offset += 1) {
    dates.push(addDays(windowStart, offset));
  }

  const todayIndex = dates.indexOf(TODAY);
  // F36: a region beginning at or after this index shows days, not money.
  const costHorizonDate = addDays(TODAY, COST_HORIZON_DAYS);

  // Column metadata is entity-independent for shading purposes only where both
  // calendars agree. Where they differ — a Karachi Saturday — the row's own
  // track carries the correct shading, and the header follows the workspace's
  // primary entity.
  const days: TimelineDay[] = dates.map((date, index) => {
    const previous = index > 0 ? dates[index - 1] : undefined;
    const month = Number(date.slice(5, 7)) - 1;
    const isMonthStart =
      previous === undefined || previous.slice(5, 7) !== date.slice(5, 7);
    const day = workingDay("uk", date);
    return {
      date,
      isWorking: day.isWorking,
      headerLabel: horizonLabel(dates, index, horizon),
      monthLabel: isMonthStart ? MONTHS[month] : undefined,
      note: holidayName("uk", date) ?? date,
    };
  });

  const rows: ForecastRow[] = EMPLOYEES.map((employee) => {
    const assignments = ASSIGNMENTS.filter(
      (assignment) =>
        assignment.employeeId === employee.employeeId &&
        assignment.status === "Active",
    );

    const covered = new Set<string>();
    for (const assignment of assignments) {
      for (const date of dates) {
        if (date >= assignment.startDate && date <= assignment.endDate) {
          covered.add(date);
        }
      }
    }

    const pitch = new Set(PITCH_DAYS[employee.employeeId] ?? []);

    // Daily cost. F27: the annual denominator is counted from VRS-F004's index
    // rather than assumed, because no document states one.
    const dailyCost =
      employee.baseCompensationAmount / annualWorkingDays(employee.entityId);

    const bench: ForecastRow["bench"] = [];
    let costedBenchWorkingDays = 0;
    let runStart: number | null = null;
    let runWorkingDays = 0;

    const closeRun = (endExclusive: number) => {
      if (runStart === null) return;
      // A region containing no working days costs nothing and is not amber.
      if (runWorkingDays > 0) {
        const cost = runWorkingDays * dailyCost;
        // F36: does this region begin inside the cost horizon?
        const withinCostHorizon = dates[runStart]! < costHorizonDate;
        const costed = canSeeCompensation && withinCostHorizon;
        if (withinCostHorizon) costedBenchWorkingDays += runWorkingDays;

        bench.push({
          id: `${employee.employeeId}-bench-${runStart}`,
          start: runStart,
          span: endExclusive - runStart,
          workingDays: runWorkingDays,
          // F5/F6: absent, not zero and not a fallback, where the viewer is
          // not authorized for compensation.
          costLabel: costed ? money.format(cost) : undefined,
          title: costed
            ? `${runWorkingDays} working days on the bench · ${money.format(cost)} unrecovered`
            : withinCostHorizon
              ? `${runWorkingDays} working days on the bench`
              : `${runWorkingDays} working days on the bench · begins beyond the ${COST_HORIZON_DAYS}-day cost horizon`,
        });
      }
      runStart = null;
      runWorkingDays = 0;
    };

    dates.forEach((date, index) => {
      const eligible = !covered.has(date) && !pitch.has(date);
      if (!eligible) {
        closeRun(index);
        return;
      }
      if (runStart === null) runStart = index;
      if (workingDay(employee.entityId, date).isWorking) runWorkingDays += 1;
    });
    closeRun(dates.length);

    const bars = assignments
      .map((assignment) => {
        const start = Math.max(0, dates.indexOf(clamp(assignment.startDate, dates)));
        const endIndex = dates.indexOf(clamp(assignment.endDate, dates));
        if (assignment.endDate < dates[0]! || assignment.startDate > dates[dates.length - 1]!) {
          return null;
        }
        const project = PROJECT_BY_ID.get(assignment.projectId);
        const label = project?.name ?? "Assignment";
        const percentage = assignment.billablePercentage;
        return {
          id: assignment.assignmentId,
          label: percentage < 100 ? `${label} · ${percentage}%` : label,
          start,
          span: Math.max(1, endIndex - start + 1),
          colorToken: categoricalTokenForId(assignment.projectId),
          ghost: employee.employeeType === "Ghost",
          title: `${label} · ${project?.clientName ?? ""} · ${percentage}% · ends ${assignment.endDate}`,
        };
      })
      .filter((bar): bar is NonNullable<typeof bar> => bar !== null);

    const benchWorkingDays = bench.reduce(
      (total, region) => total + region.workingDays,
      0,
    );

    return {
      id: employee.employeeId,
      employee,
      costedBenchWorkingDays,
      primaryLabel: employee.fullName,
      secondaryLabel:
        employee.employeeType === "Ghost"
          ? `${employee.jobTitle} · planned`
          : employee.jobTitle,
      referenceLabel: employee.employeeCode,
      ghost: employee.employeeType === "Ghost",
      badge: employee.employeeType === "Ghost" ? "Ghost" : undefined,
      workingDayStates: dates.map((date) => workingDay(employee.entityId, date).isWorking),
      bars,
      bench,
      benchWorkingDays,
      // F36: only the days inside the cost horizon carry money.
      benchCost: costedBenchWorkingDays * dailyCost,
      nextRolloff: assignments
        .map((assignment) => assignment.endDate)
        .filter((date) => date >= TODAY)
        .sort()[0],
    };
  });

  const { utilization, ghostContribution } = computeUtilization(rows, dates);

  const realRows = rows.filter((row) => row.employee.employeeType !== "Ghost");

  return {
    days,
    rows,
    todayIndex,
    utilization,
    ghostContribution,
    cohortSize: realRows.length,
    totalBenchCost: realRows.reduce((total, row) => total + row.benchCost, 0),
    benchedCount: realRows.filter((row) => row.benchWorkingDays > 0).length,
    costHorizonDays: COST_HORIZON_DAYS,
  };
}

function horizonLabel(dates: string[], index: number, horizon: Horizon): string | undefined {
  const date = dates[index]!;
  const day = String(Number(date.slice(8, 10)));
  if (horizon === 30) return day;
  if (horizon === 90 && index % 7 === 0) {
    const end = dates[Math.min(index + 6, dates.length - 1)]!;
    return `${day}–${Number(end.slice(8, 10))}`;
  }
  if (horizon === 180 && index % 14 === 0) {
    return `${day} ${MONTHS[Number(date.slice(5, 7)) - 1]!.slice(0, 3)}`;
  }
  return undefined;
}

function clamp(date: string, dates: string[]): string {
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  if (date < first) return first;
  if (date > last) return last;
  return date;
}

/*
 * PROVISIONAL, F30.
 *
 * VRS-F005 puts aggregate utilization on this screen as a single `display`
 * figure — the largest number on the canvas — and gives no formula. VRS-F011
 * owns utilization computation and is a later feature, so there is nothing to
 * call. This is covered working days weighted by `billable_percentage` over
 * total working days, across the window.
 *
 * The Ghost contribution is reported separately per VRS-F007 G08: a utilization
 * percentage that silently counts people who do not exist would be a worse lie
 * than no percentage at all.
 */
function computeUtilization(rows: ForecastRow[], dates: string[]) {
  let realCovered = 0;
  let realAvailable = 0;
  let ghostCovered = 0;

  for (const row of rows) {
    const entity = row.employee.entityId;
    const isGhost = row.employee.employeeType === "Ghost";

    const weightByDate = new Map<string, number>();
    for (const assignment of ASSIGNMENTS) {
      if (
        assignment.employeeId !== row.employee.employeeId ||
        assignment.status !== "Active"
      ) {
        continue;
      }
      for (const date of dates) {
        if (date >= assignment.startDate && date <= assignment.endDate) {
          weightByDate.set(
            date,
            (weightByDate.get(date) ?? 0) + assignment.billablePercentage / 100,
          );
        }
      }
    }

    for (const date of dates) {
      if (!workingDay(entity, date).isWorking) continue;
      const weight = Math.min(1, weightByDate.get(date) ?? 0);
      if (isGhost) {
        ghostCovered += weight;
      } else {
        realCovered += weight;
        realAvailable += 1;
      }
    }
  }

  if (realAvailable === 0) {
    return { utilization: 0, ghostContribution: 0 };
  }

  return {
    utilization: Math.round((realCovered / realAvailable) * 100),
    ghostContribution: Math.round((ghostCovered / realAvailable) * 100),
  };
}

export function formatMoney(value: number): string {
  return money.format(value);
}

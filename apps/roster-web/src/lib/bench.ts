import { categoricalTokenForId } from "@vulto/tokens";
import type { BenchForecastRow } from "@vulto/graph";
import type { TimelineDay, TimelineRow } from "@vulto/ui";

/** F2/F26/F36 are retained from the prototype; calendar facts now come from the cache. */
export type Horizon = 30 | 90 | 180;
export const DAY_WIDTH: Record<Horizon, number> = { 30: 32, 90: 20, 180: 12 };
export const COST_HORIZON_DAYS = 45;
const LEAD_IN_DAYS = 14;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function forecastWindow(horizon: Horizon, today: string) {
  return {
    from_date: shiftDate(today, -LEAD_IN_DAYS),
    to_date: shiftDate(today, horizon - 1),
  };
}
export function regionKey(employeeId: string, fromDate: string, toDate: string) {
  return `${employeeId}:${fromDate}:${toDate}`;
}
export type BenchCost = { amount: number; currency: string | null };
export function formatMoney(amount: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
export type ForecastRow = TimelineRow & {
  source: BenchForecastRow;
  benchWorkingDays: number;
  costedBenchWorkingDays: number;
  benchCost: number | null;
  benchCurrency: string | null;
  nextRolloff?: string;
};
export type Forecast = {
  days: TimelineDay[];
  rows: ForecastRow[];
  todayIndex: number;
  cohortSize: number;
  benchedCount: number;
  costHorizonDays: number;
};

export function adaptForecast(
  sourceRows: readonly BenchForecastRow[],
  horizon: Horizon,
  today: string,
  costs: ReadonlyMap<string, BenchCost | null>,
): Forecast {
  const window = forecastWindow(horizon, today);
  const dates: string[] = [];
  for (let date = window.from_date; date <= window.to_date; date = shiftDate(date, 1))
    dates.push(date);
  const headerCalendar = sourceRows[0]?.calendarDays;
  const days: TimelineDay[] = dates.map((date, index) => {
    const calendar = headerCalendar?.[index];
    return {
      date,
      isWorking: calendar?.isWorking ?? false,
      headerLabel:
        horizon === 30 ||
        (horizon === 90 && index % 7 === 0) ||
        (horizon === 180 && index % 14 === 0)
          ? String(Number(date.slice(8, 10)))
          : undefined,
      monthLabel:
        index === 0 || dates[index - 1]?.slice(0, 7) !== date.slice(0, 7)
          ? MONTHS[Number(date.slice(5, 7)) - 1]
          : undefined,
      note: calendar?.note ?? date,
    };
  });
  const costHorizonDate = shiftDate(today, COST_HORIZON_DAYS);
  const rows: ForecastRow[] = sourceRows.map((source) => {
    const employee = source.employee;
    const ghost = employee["employee_type"] === "Ghost";
    const text = (key: string) =>
      typeof employee[key] === "string" ? (employee[key] as string) : "";
    const name = text("full_name") || text("job_title") || "Unnamed person";
    const bench = source.benchPeriods.map((period) => {
      const start = dates.indexOf(period.fromDate);
      const end = dates.indexOf(period.toDate);
      const cost = costs.get(
        regionKey(source.employeeId, period.fromDate, period.toDate),
      );
      const insideHorizon = period.fromDate < costHorizonDate;
      const costLabel =
        cost && insideHorizon
          ? formatMoney(cost.amount, cost.currency ?? "GBP")
          : undefined;
      return {
        id: regionKey(source.employeeId, period.fromDate, period.toDate),
        start,
        span: end - start + 1,
        workingDays: period.workingDays,
        costLabel,
        title: costLabel
          ? `${period.workingDays} working days on the bench · ${costLabel} unrecovered`
          : insideHorizon
            ? `${period.workingDays} working days on the bench`
            : `${period.workingDays} working days on the bench · begins beyond the ${COST_HORIZON_DAYS}-day cost horizon`,
      };
    });
    const bars = source.assignments
      .map((assignment) => {
        const start = Math.max(
          0,
          dates.findIndex((date) => date >= assignment.startDate),
        );
        const end = dates.reduce(
          (last, date, index) => (date <= assignment.endDate ? index : last),
          -1,
        );
        const label = assignment.projectName ?? "Assignment";
        return {
          id: assignment.assignmentId,
          label:
            assignment.billablePercentage < 100
              ? `${label} · ${assignment.billablePercentage}%`
              : label,
          start,
          span: Math.max(1, end - start + 1),
          colorToken: categoricalTokenForId(assignment.projectId),
          ghost,
          title: `${label} · ${assignment.clientName ?? ""} · ${assignment.billablePercentage}% · ends ${assignment.endDate}`,
          clientName: assignment.clientName ?? undefined,
          percentage: assignment.billablePercentage,
          endDate: assignment.endDate,
        };
      })
      .filter((bar) => bar.start >= 0);
    const costedRegions = source.benchPeriods.filter(
      (period) => period.fromDate < costHorizonDate,
    );
    const availableCosts = costedRegions
      .map((period) =>
        costs.get(regionKey(source.employeeId, period.fromDate, period.toDate)),
      )
      .filter((cost): cost is BenchCost => cost !== null && cost !== undefined);
    return {
      id: source.employeeId,
      source,
      primaryLabel: name,
      secondaryLabel: ghost ? `${text("job_title")} · planned` : text("job_title"),
      referenceLabel: text("employee_code") || undefined,
      ghost,
      badge: ghost ? "Ghost" : undefined,
      workingDayStates: source.calendarDays.map((day) => day.isWorking),
      bars,
      bench,
      benchWorkingDays: source.benchDayCount,
      costedBenchWorkingDays: costedRegions.reduce(
        (total, period) => total + period.workingDays,
        0,
      ),
      benchCost:
        availableCosts.length === costedRegions.length
          ? availableCosts.reduce((total, cost) => total + cost.amount, 0)
          : null,
      benchCurrency: availableCosts[0]?.currency ?? null,
      nextRolloff: source.assignments
        .map((assignment) => assignment.endDate)
        .filter((date) => date >= today)
        .sort()[0],
    };
  });
  const realRows = rows.filter((row) => !row.ghost);
  return {
    days,
    rows,
    todayIndex: dates.indexOf(today),
    cohortSize: realRows.length,
    benchedCount: realRows.filter((row) => row.benchWorkingDays > 0).length,
    costHorizonDays: COST_HORIZON_DAYS,
  };
}

import {
  resolveWorkingDay,
  type ReducedHoursPeriod,
  type ResolvedWorkingDay,
  type WorkingWeek,
} from "@vulto/schema";
import { resolveEntityAssignment } from "./entity-resolution.js";
import { resolveCalendarForEntity } from "./calendar-resolution.js";
import { getNode, getNodes, incoming, type GraphTx, type StoredNode } from "./store.js";

export type WorkingDaysReadGuard = (node: StoredNode) => Promise<boolean>;

const isoInstant = (date: string) => `${date}T12:00:00.000Z`;
const addDays = (date: string, amount: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

async function patternFor(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  date: string,
  mayRead: WorkingDaysReadGuard,
): Promise<StoredNode | null> {
  const edges = await incoming(tx, workspaceId, employeeId, "pattern_for");
  const candidates: StoredNode[] = [];
  for (const edge of edges) {
    const node = await getNode(tx, workspaceId, edge.fromNodeId);
    if (!node || node.isSoftDeleted || node.nodeType !== "WorkingPattern") continue;
    const from = String(node.record["effective_from"]);
    const to = node.record["effective_to"] as string | null;
    if (from <= date && (to === null || date < to)) candidates.push(node);
  }
  const pattern =
    candidates.sort((a, b) =>
      String(b.record["effective_from"]).localeCompare(
        String(a.record["effective_from"]),
      ),
    )[0] ?? null;
  if (pattern && !(await mayRead(pattern))) throw new Error("not-found");
  return pattern;
}

async function holidaysFor(
  tx: GraphTx,
  workspaceId: string,
  calendarId: string,
  mayRead: WorkingDaysReadGuard,
): Promise<StoredNode[]> {
  const holidays = (
    await getNodes(tx, workspaceId, { nodeType: "Holiday", lifecycleStatus: "Active" })
  ).filter((holiday) => holiday.record["calendar_id"] === calendarId);
  for (const holiday of holidays) {
    if (!(await mayRead(holiday))) throw new Error("not-found");
  }
  return holidays;
}

/** G08: the one implementation of the calendar/holiday/pattern resolution order. */
export async function resolvedDayOn(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  date: string,
  mayRead: WorkingDaysReadGuard,
): Promise<ResolvedWorkingDay> {
  const employee = await getNode(tx, workspaceId, employeeId);
  if (!employee || employee.isSoftDeleted || employee.nodeType !== "Employee")
    throw new Error("not-found");
  if (!(await mayRead(employee))) throw new Error("not-found");
  const assignment = await resolveEntityAssignment(
    tx,
    workspaceId,
    employeeId,
    isoInstant(date),
  );
  if (!assignment) throw new Error("not-found");
  if (!(await mayRead(assignment.entity))) throw new Error("not-found");
  const calendar = await resolveCalendarForEntity(
    tx,
    workspaceId,
    assignment.entity.nodeId,
    date,
  );
  if (!calendar) throw new Error("not-found");
  if (!(await mayRead(calendar))) throw new Error("not-found");
  const location = employee.record["location"] as string | null | undefined;
  const pattern = await patternFor(tx, workspaceId, employeeId, date, mayRead);
  const holidays = await holidaysFor(tx, workspaceId, calendar.nodeId, mayRead);
  return resolveWorkingDay({
    calendar: {
      workingWeek: calendar.record["working_week"] as WorkingWeek,
      standardDailyHours: Number(calendar.record["standard_daily_hours"] ?? 8),
      reducedHoursPeriods:
        (calendar.record["reduced_hours_periods"] as
          ReducedHoursPeriod[] | undefined) ?? [],
    },
    pattern:
      pattern === null
        ? null
        : { workingWeek: pattern.record["working_week"] as WorkingWeek },
    holidays: holidays.map((candidate) => ({
      date: String(candidate.record["date"]),
      appliesToLocations:
        (candidate.record["applies_to_locations"] as string[] | null | undefined) ??
        null,
      isHalfDay: candidate.record["is_half_day"] === true,
    })),
    date,
    location: location ?? null,
  });
}

export async function hoursOn(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  date: string,
  mayRead: WorkingDaysReadGuard,
): Promise<number> {
  return (await resolvedDayOn(tx, workspaceId, employeeId, date, mayRead)).hours;
}

export async function countWorkingDays(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  from: string,
  to: string,
  mayRead: WorkingDaysReadGuard,
) {
  if (from > to) throw new Error("invalid-args");
  let date = from;
  let hours = 0;
  let days = 0;
  while (date <= to) {
    const resolved = await resolvedDayOn(tx, workspaceId, employeeId, date, mayRead);
    hours += resolved.hours;
    days += resolved.dayFraction;
    date = addDays(date, 1);
  }
  return { days, hours };
}

/** F290: Project severity uses an Entity calendar, without personal pattern/location. */
export async function countWorkingDaysForEntity(
  tx: GraphTx,
  workspaceId: string,
  entityId: string,
  from: string,
  to: string,
  mayRead: WorkingDaysReadGuard,
): Promise<{ days: number; hours: number }> {
  if (from > to) throw new Error("invalid-args");
  const entity = await getNode(tx, workspaceId, entityId);
  if (!entity || entity.isSoftDeleted || entity.nodeType !== "Entity")
    throw new Error("not-found");
  if (!(await mayRead(entity))) throw new Error("not-found");
  let date = from;
  let days = 0;
  let hours = 0;
  while (date <= to) {
    const calendar = await resolveCalendarForEntity(tx, workspaceId, entityId, date);
    if (!calendar || !(await mayRead(calendar))) throw new Error("not-found");
    const holidays = await holidaysFor(tx, workspaceId, calendar.nodeId, mayRead);
    const resolved = resolveWorkingDay({
      calendar: {
        workingWeek: calendar.record["working_week"] as WorkingWeek,
        standardDailyHours: Number(calendar.record["standard_daily_hours"] ?? 8),
        reducedHoursPeriods:
          (calendar.record["reduced_hours_periods"] as
            ReducedHoursPeriod[] | undefined) ?? [],
      },
      pattern: null,
      holidays: holidays.map((holiday) => ({
        date: String(holiday.record["date"]),
        appliesToLocations:
          (holiday.record["applies_to_locations"] as string[] | null | undefined) ??
          null,
        isHalfDay: holiday.record["is_half_day"] === true,
      })),
      date,
      location: null,
    });
    days += resolved.dayFraction;
    hours += resolved.hours;
    date = addDays(date, 1);
  }
  return { days, hours };
}

export async function nextWorkingDay(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  from: string,
  n: number,
  mayRead: WorkingDaysReadGuard,
): Promise<string> {
  let date = from;
  let remaining = n;
  for (let scanned = 0; scanned < 36600; scanned += 1) {
    date = addDays(date, 1);
    if (
      (await hoursOn(tx, workspaceId, employeeId, date, mayRead)) > 0 &&
      --remaining === 0
    )
      return date;
  }
  throw new Error("no-working-day");
}

export async function addWorkingDays(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
  from: string,
  n: number,
  mayRead: WorkingDaysReadGuard,
): Promise<string> {
  return n === 0 ? from : nextWorkingDay(tx, workspaceId, employeeId, from, n, mayRead);
}

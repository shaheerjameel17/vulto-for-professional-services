import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../db.js";
import { resolveCalendarForEntity } from "../graph/calendar-resolution.js";
import { countWorkingDays, hoursOn } from "../graph/working-days.js";
import { getNode, getNodes } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { makeWorkspace } from "./test-support.js";

afterAll(closeDatabase);

const T0 = "2026-01-01T00:00:00.000Z";
const WEEK = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
  day,
  is_working: day <= 5,
  hours: day <= 5 ? 8 : 0,
}));
const allowAll = async () => true;

async function world() {
  const fixture = await makeWorkspace({ hr: ["hr-admin"], team: ["team-member"] });
  const principals = {} as Record<string, NonNullable<Awaited<ReturnType<typeof resolveMemberPrincipal>>>>;
  for (const [name, person] of Object.entries(fixture.people)) {
    principals[name] = (await db.transaction((tx) => resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: person.userId,
    })))!;
  }
  const apply = (who: string, name: string, args: unknown, now = T0) =>
    applyMutation(principals[who]!, { mutation_id: randomUUID(), name, args }, { now: () => now });
  const founding = (await db.transaction((tx) => getNodes(tx, fixture.workspaceId, { nodeType: "Entity", lifecycleStatus: "Active" })))[0]!;
  return { ...fixture, principals, apply, founding };
}

async function createEntity(w: Awaited<ReturnType<typeof world>>, jurisdiction: string) {
  const result = await w.apply("owner", "entity.create", {
    name: `${jurisdiction} Entity`,
    jurisdiction,
    default_currency: jurisdiction === "UK" ? "GBP" : jurisdiction === "US" ? "USD" : "PKR",
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  const value = result.result as { entity_id: string; calendar_id: string };
  return { entityId: value.entity_id, calendarId: value.calendar_id };
}

async function createEmployee(w: Awaited<ReturnType<typeof world>>, entityId: string, location?: string) {
  const employeeId = randomUUID();
  const result = await w.apply("hr", "employee.create", {
    employee_id: employeeId,
    entity_id: entityId,
    effective_from: T0,
    fields: {
      employee_code: `E-${employeeId}`,
      full_name: `Employee ${employeeId}`,
      email: `${employeeId}@example.test`,
      job_title: "Consultant",
      employment_type: "FullTime",
      start_date: "2026-01-01",
      ...(location ? { location } : {}),
    },
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  return employeeId;
}

describe("VRS-F004 — Working Calendar and Working Patterns", () => {
  it("creates every Entity with the ruled initial calendar template", async () => {
    const w = await world();
    const foundingCalendar = await db.transaction((tx) => resolveCalendarForEntity(tx, w.workspaceId, w.founding.nodeId));
    expect(foundingCalendar?.record).toMatchObject({ standard_daily_hours: 8 });
    for (const jurisdiction of ["Global", "IN", "SG", "AE"] as const) {
      const { entityId, calendarId } = await createEntity(w, jurisdiction);
      const calendar = await db.transaction((tx) => resolveCalendarForEntity(tx, w.workspaceId, entityId));
      expect(calendar?.nodeId).toBe(calendarId);
      const worked = (calendar!.record["working_week"] as typeof WEEK).filter((day) => day.is_working).map((day) => day.day);
      expect(worked).toEqual(jurisdiction === "AE" ? [1, 2, 3, 4, 7] : [1, 2, 3, 4, 5]);
    }
  });

  it("versions calendars, copies only Active holidays, and freezes historical periods", async () => {
    const w = await world();
    const { entityId, calendarId } = await createEntity(w, "UK");
    const activeHoliday = await w.apply("hr", "holiday.add", { calendar_id: calendarId, fields: { name: "Active", date: "2026-05-01", holiday_type: "Public" } });
    const canceledHoliday = await w.apply("hr", "holiday.add", { calendar_id: calendarId, fields: { name: "Canceled", date: "2026-05-02", holiday_type: "Company" } });
    await w.apply("hr", "holiday.cancel", { holiday_id: (canceledHoliday.result as { holiday_id: string }).holiday_id, expected_version: 1 });
    const periods = [{ name: "Reduced", start_date: "2026-02-01", end_date: "2026-02-28", factor: 0.75, is_provisional: false, estimated_start_date: null }];
    const first = await w.apply("hr", "calendar.update", { calendar_id: calendarId, working_week: WEEK, daily_hours: 8, expected_version: 1, reduced_hours_periods: periods }, "2026-01-10T00:00:00.000Z");
    expect(first.status, JSON.stringify(first)).toBe("applied");
    const firstId = (first.result as { calendar_id: string }).calendar_id;
    const prior = await db.transaction((tx) => getNode(tx, w.workspaceId, calendarId));
    expect(prior).toMatchObject({ lifecycleStatus: "Superseded", version: 2 });
    const copied = (await db.transaction((tx) => getNodes(tx, w.workspaceId, { nodeType: "Holiday", lifecycleStatus: "Active" }))).filter((h) => h.record["calendar_id"] === firstId);
    expect(copied).toHaveLength(1);
    expect(copied[0]?.record["name"]).toBe("Active");
    expect(activeHoliday.status).toBe("applied");
    const second = await w.apply("hr", "calendar.update", { calendar_id: firstId, working_week: WEEK, daily_hours: 8, expected_version: 1 }, "2026-01-20T00:00:00.000Z");
    const secondId = (second.result as { calendar_id: string }).calendar_id;
    expect((await db.transaction((tx) => getNode(tx, w.workspaceId, secondId)))?.record["reduced_hours_periods"]).toEqual(periods);
    expect((await db.transaction((tx) => resolveCalendarForEntity(tx, w.workspaceId, entityId, "2026-01-15")))?.nodeId).toBe(firstId);
    expect((await db.transaction((tx) => resolveCalendarForEntity(tx, w.workspaceId, entityId, "2026-01-05")))?.nodeId).toBe(calendarId);
  });

  it("enforces pattern versions, shared boundaries, and inherited weekdays", async () => {
    const w = await world();
    const { entityId } = await createEntity(w, "UK");
    const employeeId = await createEmployee(w, entityId);
    const first = await w.apply("hr", "pattern.set", { employee_id: employeeId, working_week: [{ day: 3, is_working: false, hours: 0 }], effective_from: "2026-03-01" });
    expect(first.status, JSON.stringify(first)).toBe("applied");
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, employeeId, "2026-03-02", allowAll))).toBe(8);
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, employeeId, "2026-03-04", allowAll))).toBe(0);
    expect((await w.apply("hr", "pattern.set", { employee_id: employeeId, working_week: [], effective_from: "2026-03-01", expected_version: 1 })).status).toBe("applied");
    expect((await w.apply("hr", "pattern.set", { employee_id: employeeId, working_week: [], effective_from: "2026-02-28", expected_version: 1 })).reason).toBe("invalid-args");
    expect((await w.apply("hr", "pattern.clear", { employee_id: employeeId, effective_from: "2026-04-01", expected_version: 999 })).reason).toBe("stale-state");
    expect((await w.apply("hr", "pattern.clear", { employee_id: employeeId, effective_from: "2026-04-01", expected_version: 1 })).status).toBe("applied");
  });

  it("resolves AE, PK, UK pattern, regional holiday and Ramadan cases through one API", async () => {
    const w = await world();
    const ae = await createEntity(w, "AE");
    const pk = await createEntity(w, "PK");
    const uk = await createEntity(w, "UK");
    const aeEmployee = await createEmployee(w, ae.entityId, "Dubai");
    const karachi = await createEmployee(w, pk.entityId, "Karachi");
    const lahore = await createEmployee(w, pk.entityId, "Lahore");
    const ukEmployee = await createEmployee(w, uk.entityId, "London");
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, aeEmployee, "2026-01-09", allowAll))).toBe(0);
    expect(await db.transaction((tx) => countWorkingDays(tx, w.workspaceId, karachi, "2026-01-05", "2026-01-11", allowAll))).toEqual({ days: 5.5, hours: 44 });
    await w.apply("hr", "pattern.set", { employee_id: ukEmployee, working_week: [{ day: 1, is_working: false, hours: 0 }], effective_from: "2026-03-01" });
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, ukEmployee, "2026-02-23", allowAll))).toBe(8);
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, ukEmployee, "2026-03-02", allowAll))).toBe(0);
    await w.apply("hr", "holiday.add", { calendar_id: pk.calendarId, fields: { name: "Sindh Day", date: "2026-03-23", holiday_type: "Regional", applies_to_locations: ["Karachi"] } });
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, karachi, "2026-03-23", allowAll))).toBe(0);
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, lahore, "2026-03-23", allowAll))).toBe(8);
    const reduced = [{ name: "Ramadan", start_date: "2026-02-18", end_date: "2026-03-19", factor: 0.75, is_provisional: false, estimated_start_date: null }];
    const updated = await w.apply("hr", "calendar.update", { calendar_id: ae.calendarId, working_week: (await db.transaction((tx) => getNode(tx, w.workspaceId, ae.calendarId)))!.record["working_week"], daily_hours: 8, expected_version: 1, reduced_hours_periods: reduced }, "2026-01-02T00:00:00.000Z");
    expect(updated.status).toBe("applied");
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, aeEmployee, "2026-02-23", allowAll))).toBe(6);
  });

  it("confirms live provisional holidays, preserves estimates, and applies stale checks first", async () => {
    const w = await world();
    const { entityId, calendarId } = await createEntity(w, "UK");
    const employeeId = await createEmployee(w, entityId);
    expect((await w.apply("hr", "calendar.update", { calendar_id: calendarId, working_week: WEEK, daily_hours: 8, expected_version: 999 })).reason).toBe("stale-state");
    const added = await w.apply("hr", "holiday.add", { calendar_id: calendarId, fields: { name: "Moon Day", holiday_type: "Public", is_provisional: true, estimated_date: "2026-05-04" } });
    const holidayId = (added.result as { holiday_id: string }).holiday_id;
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, employeeId, "2026-05-04", allowAll))).toBe(0);
    const confirmed = await w.apply("hr", "holiday.confirm", { holiday_id: holidayId, actual_date: "2026-05-05" });
    expect(confirmed.status).toBe("applied");
    expect((await db.transaction((tx) => getNode(tx, w.workspaceId, holidayId)))?.record).toMatchObject({ date: "2026-05-05", estimated_date: "2026-05-04", is_provisional: false, confirmed_by: w.people.hr!.userId });
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, employeeId, "2026-05-04", allowAll))).toBe(8);
    expect(await db.transaction((tx) => hoursOn(tx, w.workspaceId, employeeId, "2026-05-05", allowAll))).toBe(0);
    expect((await w.apply("hr", "holiday.cancel", { holiday_id: holidayId, expected_version: 999 })).reason).toBe("stale-state");
    expect((await w.apply("team", "holiday.add", { calendar_id: calendarId, fields: { name: "Denied", date: "2026-06-01", holiday_type: "Company" } })).status).toBe("rejected");
  });
});

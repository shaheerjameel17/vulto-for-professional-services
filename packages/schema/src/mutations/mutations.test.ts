import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isValidEmployeeTransition } from "../employee";
import { defineMutation } from "./define";
import { FEATURE_LIFECYCLE_NODE_TYPES } from "./employee";
import { initialWorkingWeekFor } from "./calendar";
import {
  MUTATIONS,
  getMutationDefinition,
  moveEmployeeEdgeId,
  initialCalendarId,
  initialCalendarEdgeId,
  wouldCreateCycle,
} from "./foundation";

describe("defineMutation", () => {
  it("forces onlineOnly for any protected tier, whatever was declared", () => {
    for (const tier of [1, 2] as const) {
      const definition = defineMutation({
        name: "x.protected",
        input: z.object({}),
        tier,
        onlineOnly: false,
        stateTransition: false,
      });
      expect(definition.onlineOnly).toBe(true);
    }
    expect(
      defineMutation({
        name: "x.open",
        input: z.object({}),
        tier: 0,
        onlineOnly: false,
        stateTransition: false,
      }).onlineOnly,
    ).toBe(false);
  });
});

describe("the foundation mutation set", () => {
  it("registers the foundation, Employee, and Entity mutations; only compensation is protected", () => {
    expect(Object.keys(MUTATIONS).sort()).toEqual([
      "calendar.update",
      "employee.create",
      "employee.linkUser",
      "employee.setCompensation",
      "employee.setEntity",
      "employee.transitionStatus",
      "employee.update",
      "entity.create",
      "entity.deactivate",
      "entity.update",
      "graph.closeEdge",
      "graph.createEdge",
      "graph.createNode",
      "graph.softDeleteNode",
      "graph.transitionLifecycle",
      "graph.updateNodeFields",
      "holiday.add",
      "holiday.cancel",
      "holiday.confirm",
      "org.moveEmployee",
      "pattern.clear",
      "pattern.set",
    ]);
    for (const definition of Object.values(MUTATIONS)) {
      expect(definition.tier).toBe(
        definition.name === "employee.setCompensation" ? 1 : 0,
      );
      // A protected write can never be queued offline.
      expect(definition.onlineOnly).toBe(definition.tier > 0);
    }
  });

  it("marks every lifecycle transition as a state transition", () => {
    const transitions = Object.values(MUTATIONS).filter((d) => d.stateTransition);
    expect(transitions.map((d) => d.name).sort()).toEqual(
      [
        "employee.transitionStatus",
        "entity.deactivate",
        "graph.transitionLifecycle",
        "holiday.cancel",
        "pattern.clear",
        "pattern.set",
        "calendar.update",
      ].sort(),
    );
  });

  it("gives a feature-owned lifecycle its own table, and shuts the generic one out", () => {
    expect(FEATURE_LIFECYCLE_NODE_TYPES.has("Employee")).toBe(true);
    expect(FEATURE_LIFECYCLE_NODE_TYPES.has("Entity")).toBe(true);
    expect(isValidEmployeeTransition("Active", "Inactive")).toBe(true);
    expect(isValidEmployeeTransition("Inactive", "Active")).toBe(true);
    expect(isValidEmployeeTransition("Active", "Converted")).toBe(true);
    expect(isValidEmployeeTransition("Converted", "Active")).toBe(false);
    expect(isValidEmployeeTransition("Inactive", "Converted")).toBe(false);
  });

  it("does not resolve inherited property names as mutations", () => {
    expect(getMutationDefinition("toString")).toBeUndefined();
    expect(getMutationDefinition("graph.createNode")).toBe(
      MUTATIONS["graph.createNode"],
    );
  });
});

describe("move helpers", () => {
  it("derives the same edge id from the same mutation id, and a different one otherwise", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(moveEmployeeEdgeId(id)).toBe(moveEmployeeEdgeId(id));
    expect(moveEmployeeEdgeId(id)).not.toBe(
      moveEmployeeEdgeId("22222222-2222-4222-8222-222222222222"),
    );
    expect(z.uuidv4().safeParse(moveEmployeeEdgeId(id)).success).toBe(true);
  });

  it("derives distinct Entity/calendar/ownership ids and shares jurisdiction templates", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(
      new Set([
        moveEmployeeEdgeId(id),
        initialCalendarId(id),
        initialCalendarEdgeId(id),
      ]).size,
    ).toBe(3);
    expect(
      initialWorkingWeekFor("AE")
        .working_week.filter((day) => day.is_working)
        .map((day) => day.day),
    ).toEqual([1, 2, 3, 4, 7]);
    expect(
      initialWorkingWeekFor("PK").working_week.reduce(
        (total, day) => total + day.hours,
        0,
      ),
    ).toBe(44);
    expect(initialWorkingWeekFor("Global")).toEqual(initialWorkingWeekFor("IN"));
  });

  it("detects a direct and a longer management loop, and allows a clean move", async () => {
    const chain: Record<string, string | null> = { b: "c", c: "d", d: null };
    const managerOf = (id: string) => chain[id] ?? null;
    expect(await wouldCreateCycle(managerOf, "a", "a")).toBe(true);
    expect(await wouldCreateCycle(managerOf, "d", "b")).toBe(true);
    expect(await wouldCreateCycle(managerOf, "a", "b")).toBe(false);
  });
});

describe("working calendar contracts", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const workingWeek = initialWorkingWeekFor("UK").working_week;

  it("requires exactly one row for every ISO weekday", () => {
    const base = {
      calendar_id: id,
      daily_hours: 8,
      expected_version: 1,
    };
    expect(
      MUTATIONS["calendar.update"].input.safeParse({
        ...base,
        working_week: workingWeek,
      }).success,
    ).toBe(true);
    expect(
      MUTATIONS["calendar.update"].input.safeParse({
        ...base,
        working_week: workingWeek.slice(0, 6),
      }).success,
    ).toBe(false);
    expect(
      MUTATIONS["calendar.update"].input.safeParse({
        ...base,
        working_week: [...workingWeek.slice(0, 6), workingWeek[0]],
      }).success,
    ).toBe(false);
  });

  it("keeps holiday add and confirm free of a base-version argument", () => {
    expect(
      MUTATIONS["holiday.add"].input.safeParse({
        calendar_id: id,
        fields: { name: "Day", date: "2026-01-01", holiday_type: "Public" },
        expected_version: 1,
      }).success,
    ).toBe(false);
    expect(
      MUTATIONS["holiday.confirm"].input.safeParse({
        holiday_id: id,
        actual_date: "2026-01-02",
        expected_version: 1,
      }).success,
    ).toBe(false);
  });
});

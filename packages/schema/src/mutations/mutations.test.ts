import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isValidEmployeeTransition } from "../employee";
import { defineMutation } from "./define";
import { FEATURE_LIFECYCLE_NODE_TYPES, FEATURE_OWNED_EDGE_TYPES } from "./employee";
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
  it("registers every named mutation and keeps protected writes online-only", () => {
    expect(Object.keys(MUTATIONS).sort()).toEqual([
      "assignment.cancel",
      "assignment.clearRateOverride",
      "assignment.create",
      "assignment.setRateCard",
      "assignment.setRateOverride",
      "assignment.update",
      "calendar.update",
      "conflictResolution.overrideAndProceed",
      "employee.attachSkill",
      "employee.create",
      "employee.linkUser",
      "employee.setCompensation",
      "employee.setEntity",
      "employee.transitionStatus",
      "employee.update",
      "entity.create",
      "entity.deactivate",
      "entity.update",
      "ghostResource.cancel",
      "ghostResource.create",
      "ghostResource.linkOpenRole",
      "ghostResource.promote",
      "graph.closeEdge",
      "graph.createEdge",
      "graph.createNode",
      "graph.softDeleteNode",
      "graph.transitionLifecycle",
      "graph.updateEdgeMetadata",
      "graph.updateNodeFields",
      "holiday.add",
      "holiday.cancel",
      "holiday.confirm",
      "hrCompliance.sendReminder",
      "notification.dismiss",
      "notification.markAllRead",
      "notification.markRead",
      "org.moveEmployee",
      "pattern.clear",
      "pattern.set",
      "pitch.create",
      "pitch.staffEmployee",
      "pitch.unstaffEmployee",
      "project.attachSkillRequirement",
      "rateCard.create",
      "rateCard.update",
      "revenueGapAlert.dismiss",
      "timesheet.saveCell",
      "timesheet.submitWeek",
      "timesheet.unlockWeek",
      "timesheetAnomaly.clear",
    ]);
    for (const definition of Object.values(MUTATIONS)) {
      expect(definition.tier).toBe(
        definition.name === "timesheetAnomaly.clear"
          ? 2
          : definition.name === "employee.setCompensation" ||
              definition.name === "rateCard.create" ||
              definition.name === "rateCard.update"
            ? 1
            : 0,
      );
      // A protected write can never be queued offline.
      expect(definition.onlineOnly).toBe(
        definition.tier > 0 || definition.name === "ghostResource.promote",
      );
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
        "assignment.cancel",
        "rateCard.update",
        "ghostResource.cancel",
        "ghostResource.promote",
        "timesheet.submitWeek",
        "timesheet.unlockWeek",
        "timesheetAnomaly.clear",
      ].sort(),
    );
  });

  it("keeps rateCard.update versioned and unable to rename or recurrency a card", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const line = { seniority_level: "Senior", hourly_rate: 100 };
    expect(
      MUTATIONS["rateCard.update"].input.safeParse({
        rate_card_id: id,
        expected_version: 1,
        lines: [line],
      }).success,
    ).toBe(true);
    expect(
      MUTATIONS["rateCard.update"].input.safeParse({
        rate_card_id: id,
        expected_version: 1,
        lines: [line],
        currency: "USD",
      }).success,
    ).toBe(false);
    expect(
      MUTATIONS["rateCard.update"].input.safeParse({
        rate_card_id: id,
        lines: [line],
      }).success,
    ).toBe(false);
    expect(MUTATIONS["rateCard.create"].onlineOnly).toBe(true);
    expect(MUTATIONS["rateCard.update"].onlineOnly).toBe(true);
  });

  it("gives a feature-owned lifecycle its own table, and shuts the generic one out", () => {
    expect(FEATURE_LIFECYCLE_NODE_TYPES.has("Employee")).toBe(true);
    expect(FEATURE_LIFECYCLE_NODE_TYPES.has("Entity")).toBe(true);
    expect(FEATURE_OWNED_EDGE_TYPES.has("has_skill")).toBe(true);
    expect(FEATURE_OWNED_EDGE_TYPES.has("requires_skill")).toBe(true);
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
      week_start_day: 1,
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

  it("requires an explicit ISO week start day on calendar updates", () => {
    const base = {
      calendar_id: id,
      working_week: workingWeek,
      daily_hours: 8,
      expected_version: 1,
    };
    expect(MUTATIONS["calendar.update"].input.safeParse(base).success).toBe(false);
    for (const week_start_day of [0, 8, 1.5]) {
      expect(
        MUTATIONS["calendar.update"].input.safeParse({ ...base, week_start_day })
          .success,
      ).toBe(false);
    }
    expect(
      MUTATIONS["calendar.update"].input.safeParse({ ...base, week_start_day: 7 })
        .success,
    ).toBe(true);
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

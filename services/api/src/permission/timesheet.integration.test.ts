import { randomUUID } from "node:crypto";
import {
  calculateUtilization,
  initialWorkingWeekFor,
  stampNewNode,
} from "@vulto/schema";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db, sql } from "../db.js";
import {
  getNode,
  getNodes,
  incoming,
  insertEdge,
  insertNode,
  outgoing,
  updateNodeFields,
} from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import {
  getWeek,
  listSubmissionStatus,
  resolveTimesheetShortcut,
} from "./timesheet-queries.js";
import { timesheetAnomalyEvaluate } from "../mutations/timesheet-anomaly.js";
import { utilizationSnapshotCompute } from "../mutations/utilization-snapshot.js";
import { getAgencyAggregate, getIndividual } from "./utilization-queries.js";
import { resolveCalendarForEntity } from "../graph/calendar-resolution.js";
import { listActiveAnomalies } from "./timesheet-anomaly-queries.js";
import { authorizeRead } from "./interceptor.js";
import { readProtected } from "../protected/read.js";
import { getKeyServices } from "../crypto/keys.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);

async function world() {
  const fixture = await makeWorkspace({
    member: ["team-member"],
    outsider: ["team-member"],
    manager: ["team-member"],
  });
  const principal = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.member!.userId,
    }),
  ))!;
  const owner = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.owner!.userId,
    }),
  ))!;
  const manager = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.manager!.userId,
    }),
  ))!;
  const outsider = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.outsider!.userId,
    }),
  ))!;
  const entity = (
    await db.transaction((tx) =>
      getNodes(tx, fixture.workspaceId, {
        nodeType: "Entity",
        lifecycleStatus: "Active",
      }),
    )
  )[0]!;
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const managerId = randomUUID();
  const assignmentId = randomUUID();
  await db.transaction(async (tx) => {
    for (const [id, userId] of [
      [memberId, fixture.people.member!.userId],
      [outsiderId, fixture.people.outsider!.userId],
      [managerId, fixture.people.manager!.userId],
    ] as const) {
      await insertNode(tx, {
        ...nodeRecord("Employee", fixture.workspaceId, id),
        user_id: userId,
      });
      await insertEdge(
        tx,
        fixture.workspaceId,
        edgeRecord("scoped_to_entity", id, entity.nodeId, "2026-09-24T00:00:00.000Z"),
      );
    }
    await insertNode(tx, {
      ...nodeRecord("Assignment", fixture.workspaceId, assignmentId),
      employee_id: memberId,
      start_date: "2026-09-24",
      end_date: "2026-12-31",
    });
    await insertEdge(
      tx,
      fixture.workspaceId,
      edgeRecord("assignment_of", assignmentId, memberId, "2026-09-24T00:00:00.000Z"),
    );
    await insertEdge(
      tx,
      fixture.workspaceId,
      edgeRecord("managed_by", memberId, managerId, "2026-09-24T00:00:00.000Z"),
    );
  });
  let tick = 0;
  const apply = (who: "member" | "owner" | "manager", name: string, args: unknown) => {
    const now = new Date(
      Date.parse("2026-09-30T12:00:00.000Z") + ++tick * 1000,
    ).toISOString();
    return applyMutation(
      who === "member" ? principal : who === "manager" ? manager : owner,
      {
        mutation_id: randomUUID(),
        name,
        args,
      },
      {
        now: () => now,
        interceptor: { now: () => now },
      },
    );
  };
  return {
    ...fixture,
    entityId: entity.nodeId,
    memberId,
    outsiderId,
    managerId,
    assignmentId,
    principal,
    owner,
    manager,
    outsider,
    apply,
  };
}

describe("VRS-F010 own TimesheetEntry and F275 endpoint writes", () => {
  it("saves a Team Member Billable cell and only staffed Pitch cells", async () => {
    const w = await world();
    const billable = await w.apply("member", "timesheet.saveCell", {
      employee_id: w.memberId,
      date: "2026-09-30",
      row_context: { kind: "assignment", assignment_id: w.assignmentId },
      hours: 8,
    });
    expect(billable.status, JSON.stringify(billable)).toBe("applied");
    const billableId = (billable.result as { entryId: string }).entryId;
    const entry = await db.transaction((tx) => getNode(tx, w.workspaceId, billableId));
    expect(entry?.record).toMatchObject({
      employee_id: w.memberId,
      week_start_date: "2026-09-28",
    });
    const at = { now: () => "2026-10-01T00:00:00.000Z" };
    const ownRead = await db.transaction((tx) =>
      authorizeRead(
        tx,
        w.principal,
        { workspaceId: w.workspaceId, nodeType: "TimesheetEntry", nodeId: billableId },
        at,
      ),
    );
    const unrelatedRead = await db.transaction((tx) =>
      authorizeRead(
        tx,
        w.outsider,
        { workspaceId: w.workspaceId, nodeType: "TimesheetEntry", nodeId: billableId },
        at,
      ),
    );
    expect(ownRead.access).toBe("full");
    expect(unrelatedRead.access).toBe("none");

    const created = await w.apply("owner", "pitch.create", { name: "Proposal" });
    const pitchId = (created.result as { pitchId: string }).pitchId;
    const pitchArgs = {
      employee_id: w.memberId,
      date: "2026-09-30",
      row_context: { kind: "pitch", pitch_id: pitchId },
      hours: 2,
    };
    expect((await w.apply("member", "timesheet.saveCell", pitchArgs)).status).toBe(
      "rejected",
    );
    expect(
      (
        await w.apply("owner", "pitch.staffEmployee", {
          pitch_id: pitchId,
          employee_id: w.memberId,
        })
      ).status,
    ).toBe("applied");
    const staffedSave = await w.apply("member", "timesheet.saveCell", pitchArgs);
    expect(staffedSave.status, JSON.stringify(staffedSave)).toBe("applied");
    expect(
      (
        await w.apply("owner", "pitch.unstaffEmployee", {
          pitch_id: pitchId,
          employee_id: w.memberId,
        })
      ).status,
    ).toBe("applied");
    expect(
      (
        await w.apply("member", "timesheet.saveCell", {
          ...pitchArgs,
          date: "2026-10-01",
        })
      ).status,
    ).toBe("rejected");
  });

  it("refuses a Team Member's claim of another employee and persists empty submission once", async () => {
    const w = await world();
    const denied = await w.apply("member", "timesheet.saveCell", {
      employee_id: w.outsiderId,
      date: "2026-09-30",
      row_context: { kind: "non-billable" },
      internal_category: "Admin",
      hours: 2,
    });
    expect(denied).toMatchObject({ status: "rejected", reason: "role" });
    const submitted = await w.apply("member", "timesheet.submitWeek", {
      employee_id: w.memberId,
      week_start_date: "2026-09-30",
    });
    expect(submitted.status, JSON.stringify(submitted)).toBe("applied");
    expect(
      (
        await db.transaction((tx) =>
          getNodes(tx, w.workspaceId, {
            nodeType: "TimesheetWeekSubmission",
          }),
        )
      ).filter((node) => node.record["employee_id"] === w.memberId),
    ).toHaveLength(1);
    const week = await db.transaction((tx) =>
      getWeek(tx, w.principal, w.memberId, "2026-09-30"),
    );
    expect(week?.weekStatus).toBe("Submitted");
    const statuses = await db.transaction((tx) =>
      listSubmissionStatus(tx, w.owner, w.workspaceId, "2026-09-30"),
    );
    expect(statuses).toEqual(
      expect.arrayContaining([
        { employeeId: w.memberId, weekStatus: "Submitted" },
        { employeeId: w.outsiderId, weekStatus: "Not-Started" },
      ]),
    );
    const unlocked = await w.apply("member", "timesheet.unlockWeek", {
      employee_id: w.memberId,
      week_start_date: "2026-09-30",
    });
    expect(unlocked.status).toBe("applied");
    const marker = (
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, {
          nodeType: "TimesheetWeekSubmission",
          includeSoftDeleted: true,
        }),
      )
    ).find((node) => node.record["employee_id"] === w.memberId);
    expect(marker?.isSoftDeleted).toBe(true);
    const afterUnlock = await db.transaction((tx) =>
      listSubmissionStatus(tx, w.owner, w.workspaceId, "2026-09-30"),
    );
    expect(afterUnlock).toContainEqual({
      employeeId: w.memberId,
      weekStatus: "Not-Started",
    });
  });

  it("does not fail or roll back a committed submission when its reactive evaluation fails", async () => {
    const w = await world();
    const now = "2026-09-30T12:30:00.000Z";
    const result = await applyMutation(
      w.principal,
      {
        mutation_id: randomUUID(),
        name: "timesheet.submitWeek",
        args: { employee_id: w.memberId, week_start_date: "2026-09-30" },
      },
      {
        now: () => now,
        interceptor: { now: () => now },
        afterCommitOverride: async () => {
          throw new Error("injected-evaluation-failure");
        },
      },
    );
    expect(result.status).toBe("applied");
    const marker = (
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, { nodeType: "TimesheetWeekSubmission" }),
      )
    ).find((node) => node.record["employee_id"] === w.memberId);
    expect(marker).toBeDefined();
  });

  it("rejects a 25-hour date before creating another row", async () => {
    const w = await world();
    const first = await w.apply("member", "timesheet.saveCell", {
      employee_id: w.memberId,
      date: "2026-09-30",
      row_context: { kind: "assignment", assignment_id: w.assignmentId },
      hours: 20,
    });
    expect(first.status).toBe("applied");
    const denied = await w.apply("member", "timesheet.saveCell", {
      employee_id: w.memberId,
      date: "2026-09-30",
      row_context: { kind: "non-billable" },
      internal_category: "Admin",
      hours: 5,
    });
    expect(denied).toMatchObject({
      status: "rejected",
      reason: "invalid-args:date=2026-09-30:total=25",
    });
    const entries = (
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, { nodeType: "TimesheetEntry" }),
      )
    ).filter((entry) => entry.record["employee_id"] === w.memberId);
    expect(entries).toHaveLength(1);
  });

  it("rolls back every Draft transition when the second row hits a database constraint", async () => {
    const w = await world();
    const ids: string[] = [];
    for (const date of ["2026-09-30", "2026-10-01"]) {
      const saved = await w.apply("member", "timesheet.saveCell", {
        employee_id: w.memberId,
        date,
        row_context: { kind: "non-billable" },
        internal_category: "Admin",
        hours: 2,
      });
      expect(saved.status).toBe("applied");
      ids.push((saved.result as { entryId: string }).entryId);
    }
    ids.sort();
    const suffix = randomUUID().replaceAll("-", "_");
    const functionName = `timesheet_fail_${suffix}`;
    const triggerName = `timesheet_trigger_${suffix}`;
    await sql.unsafe(
      `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected constraint' USING ERRCODE = '23514'; END $$`,
    );
    await sql.unsafe(
      `CREATE TRIGGER ${triggerName} BEFORE UPDATE ON graph_nodes FOR EACH ROW WHEN (NEW.node_id = '${ids[1]}'::uuid) EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      const failed = await w.apply("member", "timesheet.submitWeek", {
        employee_id: w.memberId,
        week_start_date: "2026-09-30",
      });
      expect(failed).toMatchObject({
        status: "rejected",
        reason: "constraint-violation",
      });
      for (const id of ids) {
        const entry = await db.transaction((tx) => getNode(tx, w.workspaceId, id));
        expect(entry?.lifecycleStatus).toBe("Draft");
      }
    } finally {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON graph_nodes`);
      await sql.unsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }
  });

  it("rolls back a create whose stored subject disagrees with its declared subject", async () => {
    const w = await world();
    const mutationId = randomUUID();
    const now = "2026-09-30T12:30:00.000Z";
    const mismatched = await applyMutation(
      w.principal,
      {
        mutation_id: mutationId,
        name: "timesheet.saveCell",
        args: {
          employee_id: w.memberId,
          date: "2026-09-30",
          row_context: { kind: "non-billable" },
          internal_category: "Admin",
          hours: 1,
        },
      },
      {
        now: () => now,
        interceptor: { now: () => now },
        implementationOverride: async (ctx) => ({
          checks: [
            {
              target: {
                kind: "node",
                workspaceId: w.workspaceId,
                nodeType: "TimesheetEntry",
                nodeId: mutationId,
              },
              change: { operation: "create", declaredSubjectEmployeeId: w.memberId },
            },
          ],
          async validate() {},
          async apply() {
            await insertNode(
              ctx.tx,
              stampNewNode(
                {
                  node_id: mutationId,
                  node_type: "TimesheetEntry",
                  schema_version: 1,
                  lifecycle_status: "Draft",
                  employee_id: w.outsiderId,
                  assignment_id: null,
                  pitch_id: null,
                  time_category: "NonBillable",
                  internal_category: "Admin",
                  date: "2026-09-30",
                  hours: 1,
                  week_start_date: "2026-09-28",
                  notes: null,
                  submitted_at: null,
                },
                "TimesheetEntry",
                { workspaceId: w.workspaceId, userId: w.principal.userId, now },
              ),
            );
            return { result: { entryId: mutationId }, changedRowIds: [mutationId] };
          },
        }),
      },
    );
    expect(mismatched).toMatchObject({
      status: "rejected",
      reason: "subject-mismatch",
    });
    expect(
      await db.transaction((tx) => getNode(tx, w.workspaceId, mutationId)),
    ).toBeNull();
  });

  it("creates a protected review flag under the reserved system actor", async () => {
    const w = await world();
    for (const row_context of [
      { kind: "assignment", assignment_id: w.assignmentId },
      { kind: "non-billable" },
    ]) {
      const saved = await w.apply("member", "timesheet.saveCell", {
        employee_id: w.memberId,
        date: "2026-09-30",
        row_context,
        ...(row_context.kind === "non-billable" ? { internal_category: "Admin" } : {}),
        hours: 8,
      });
      expect(saved.status, JSON.stringify(saved)).toBe("applied");
    }
    const submitted = await w.apply("member", "timesheet.submitWeek", {
      employee_id: w.memberId,
      week_start_date: "2026-09-30",
    });
    expect(submitted.status).toBe("applied");
    expect(
      (
        await db.transaction((tx) =>
          getNodes(tx, w.workspaceId, { nodeType: "TimesheetWeekSubmission" }),
        )
      ).filter((node) => node.record["employee_id"] === w.memberId),
    ).toHaveLength(0);
    const evaluated = await timesheetAnomalyEvaluate(
      w.workspaceId,
      w.memberId,
      "2026-09-28",
      "2026-10-01T00:00:00.000Z",
    );
    expect(evaluated.flagIds).toHaveLength(1);
    const flag = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, evaluated.flagIds[0]!),
    );
    expect(flag?.nodeType).toBe("TimesheetAnomalyFlag");
    const actorId = flag?.record["created_by"] as string;
    const actor = await db.transaction((tx) => getNode(tx, w.workspaceId, actorId));
    expect(actor?.nodeType).toBe("User");
    expect(actorId).not.toBe(w.principal.userId);
    const actorMembershipEdges = await db.transaction((tx) =>
      incoming(tx, w.workspaceId, actorId, "membership_of"),
    );
    expect(actorMembershipEdges).toHaveLength(0);
    const [triggeredBy] = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, flag!.nodeId, "triggered_by"),
    );
    expect(triggeredBy?.toNodeId).toBe(w.memberId);
    expect(triggeredBy?.record["created_by"]).toBe(actorId);
    const actorMemberships = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "WorkspaceMembership" }),
    );
    expect(actorMemberships.some((node) => node.record["user_id"] === actorId)).toBe(
      false,
    );
    const second = await timesheetAnomalyEvaluate(
      w.workspaceId,
      w.memberId,
      "2026-09-28",
      "2026-10-01T00:00:01.000Z",
    );
    expect(second.flagIds).toEqual(evaluated.flagIds);
    const reused = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, second.flagIds[0]!),
    );
    expect(reused?.record["updated_by"]).toBe(actorId);
  });

  it("keeps week boundaries stable for seven-day and split schedules, including a holiday on the anchor", async () => {
    const w = await world();
    const initial = await db.transaction((tx) =>
      resolveCalendarForEntity(tx, w.workspaceId, w.entityId),
    );
    const sevenDays = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      day,
      is_working: true,
      hours: 8,
    }));
    const updated = await w.apply("owner", "calendar.update", {
      calendar_id: initial!.nodeId,
      working_week: sevenDays,
      week_start_day: 7,
      daily_hours: 8,
      expected_version: initial!.version,
    });
    expect(updated.status, JSON.stringify(updated)).toBe("applied");
    const calendarId = (updated.result as { calendar_id: string }).calendar_id;
    const holiday = await w.apply("owner", "holiday.add", {
      calendar_id: calendarId,
      fields: { name: "Anchor holiday", date: "2026-10-04", holiday_type: "Public" },
    });
    expect(holiday.status, JSON.stringify(holiday)).toBe("applied");
    const save = async (date: string) =>
      w.apply("member", "timesheet.saveCell", {
        employee_id: w.memberId,
        date,
        row_context: { kind: "non-billable" },
        internal_category: "Admin",
        hours: 1,
      });
    for (const date of ["2026-10-04", "2026-10-06"]) {
      const result = await save(date);
      expect(result.status, JSON.stringify(result)).toBe("applied");
      const node = await db.transaction((tx) =>
        getNode(tx, w.workspaceId, (result.result as { entryId: string }).entryId),
      );
      expect(node?.record["week_start_date"]).toBe("2026-10-04");
    }
    const split = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      day,
      is_working: [2, 4, 5, 7].includes(day),
      hours: [2, 4, 5, 7].includes(day) ? 8 : 0,
    }));
    const splitUpdate = await w.apply("owner", "pattern.set", {
      employee_id: w.memberId,
      working_week: split,
      effective_from: "2026-10-07",
    });
    expect(splitUpdate.status, JSON.stringify(splitUpdate)).toBe("applied");
    const splitSave = await save("2026-10-08");
    expect(splitSave.status, JSON.stringify(splitSave)).toBe("applied");
    const splitNode = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, (splitSave.result as { entryId: string }).entryId),
    );
    expect(splitNode?.record["week_start_date"]).toBe("2026-10-04");
  });

  it("groups Sunday and Monday calendar employees independently in one workspace", async () => {
    const w = await world();
    const created = await w.apply("owner", "entity.create", {
      name: "Gulf entity",
      jurisdiction: "AE",
      default_currency: "AED",
    });
    expect(created.status, JSON.stringify(created)).toBe("applied");
    const gulfEntityId = (created.result as { entity_id: string }).entity_id;
    const moved = await w.apply("owner", "employee.setEntity", {
      employee_id: w.outsiderId,
      entity_id: gulfEntityId,
      effective_from: "2026-09-30T12:00:00.000Z",
    });
    expect(moved.status, JSON.stringify(moved)).toBe("applied");
    for (const [employeeId, expected] of [
      [w.memberId, "2026-09-28"],
      [w.outsiderId, "2026-09-27"],
    ] as const) {
      const saved = await w.apply("owner", "timesheet.saveCell", {
        employee_id: employeeId,
        date: "2026-10-01",
        row_context: { kind: "non-billable" },
        internal_category: "Admin",
        hours: 1,
      });
      expect(saved.status, JSON.stringify(saved)).toBe("applied");
      const node = await db.transaction((tx) =>
        getNode(tx, w.workspaceId, (saved.result as { entryId: string }).entryId),
      );
      expect(node?.record["week_start_date"]).toBe(expected);
    }
  });

  it("resolves fd and hd from each day's F004 calendar, pattern, and half-day holiday", async () => {
    const w = await world();
    const initial = await db.transaction((tx) =>
      resolveCalendarForEntity(tx, w.workspaceId, w.entityId),
    );
    const pk = await w.apply("owner", "calendar.update", {
      calendar_id: initial!.nodeId,
      working_week: initialWorkingWeekFor("PK").working_week,
      week_start_day: 1,
      daily_hours: 8,
      expected_version: initial!.version,
    });
    expect(pk.status, JSON.stringify(pk)).toBe("applied");
    const saturday = await db.transaction((tx) =>
      resolveTimesheetShortcut(tx, w.principal, w.memberId, "2026-10-03", "fd"),
    );
    expect(saturday).toBe(4); // PK's six-day template, not contracted hours / 5.
    expect(
      await db.transaction((tx) =>
        resolveTimesheetShortcut(tx, w.principal, w.memberId, "2026-10-03", "hd"),
      ),
    ).toBe(2);
    const pattern = await w.apply("owner", "pattern.set", {
      employee_id: w.memberId,
      effective_from: "2026-10-04",
      working_week: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        day,
        is_working: day <= 4,
        hours: day <= 4 ? 10 : 0,
      })),
    });
    expect(pattern.status, JSON.stringify(pattern)).toBe("applied");
    expect(
      await db.transaction((tx) =>
        resolveTimesheetShortcut(tx, w.principal, w.memberId, "2026-10-05", "fd"),
      ),
    ).toBe(10);
    const calendar = await db.transaction((tx) =>
      resolveCalendarForEntity(tx, w.workspaceId, w.entityId),
    );
    const holiday = await w.apply("owner", "holiday.add", {
      calendar_id: calendar!.nodeId,
      fields: {
        name: "Half Day",
        date: "2026-10-05",
        holiday_type: "Company",
        is_half_day: true,
      },
    });
    expect(holiday.status, JSON.stringify(holiday)).toBe("applied");
    expect(
      await db.transaction((tx) =>
        resolveTimesheetShortcut(tx, w.principal, w.memberId, "2026-10-05", "fd"),
      ),
    ).toBe(4);
    expect(
      await db.transaction((tx) =>
        resolveTimesheetShortcut(tx, w.principal, w.memberId, "2026-10-05", "hd"),
      ),
    ).toBe(2);
    const week = await db.transaction((tx) =>
      getWeek(tx, w.principal, w.memberId, "2026-10-05"),
    );
    expect(
      week?.columns.map(({ date, expectedHours }) => [date, expectedHours]),
    ).toEqual([
      ["2026-10-05", 4],
      ["2026-10-06", 10],
      ["2026-10-07", 10],
      ["2026-10-08", 10],
    ]);
    expect(week?.expectedWeeklyHours).toBe(34);
  });

  it("scopes protected flags to a direct-report Manager and suppresses approved overtime on reevaluation", async () => {
    const w = await world();
    for (const date of ["2026-09-28", "2026-09-29", "2026-09-30"]) {
      const saved = await w.apply("member", "timesheet.saveCell", {
        employee_id: w.memberId,
        date,
        row_context: { kind: "non-billable" },
        internal_category: "Admin",
        hours: 20,
      });
      expect(saved.status, JSON.stringify(saved)).toBe("applied");
    }
    expect(
      (
        await w.apply("member", "timesheet.submitWeek", {
          employee_id: w.memberId,
          week_start_date: "2026-09-30",
        })
      ).status,
    ).toBe("applied");
    const reviewTime = { now: () => "2026-10-01T00:00:00.000Z" };
    const ownerFlags = await db.transaction((tx) =>
      listActiveAnomalies(tx, w.owner, w.workspaceId, reviewTime),
    );
    const overtime = ownerFlags.find(
      (flag) => flag.flag_reason === "HoursExceedExpected",
    );
    expect(overtime).toBeDefined();
    const managerFlags = await db.transaction((tx) =>
      listActiveAnomalies(tx, w.manager, w.workspaceId, reviewTime),
    );
    expect(managerFlags.some((flag) => flag.flagId === overtime!.flagId)).toBe(true);
    const memberFlags = await db.transaction((tx) =>
      listActiveAnomalies(tx, w.principal, w.workspaceId, reviewTime),
    );
    expect(memberFlags).toEqual([]);
    const protectedMemberRead = await db.transaction((tx) =>
      readProtected(
        tx,
        getKeyServices(),
        w.principal,
        { nodeIds: [overtime!.flagId], partitions: ["record"] },
        reviewTime,
      ),
    );
    expect(protectedMemberRead).toEqual([]);
    const cleared = await w.apply("manager", "timesheetAnomaly.clear", {
      flag_id: overtime!.flagId,
      outcome: "ApprovedOvertime",
      note: "Reviewed",
    });
    expect(cleared.status, JSON.stringify(cleared)).toBe("applied");
    const again = await timesheetAnomalyEvaluate(
      w.workspaceId,
      w.memberId,
      "2026-09-28",
      "2026-10-01T00:00:00.000Z",
    );
    expect(again.flagIds).not.toContain(overtime!.flagId);
    const active = await db.transaction((tx) =>
      listActiveAnomalies(tx, w.manager, w.workspaceId, reviewTime),
    );
    expect(active.some((flag) => flag.flag_reason === "HoursExceedExpected")).toBe(
      false,
    );
    for (const date of ["2026-09-28", "2026-09-29", "2026-09-30"]) {
      const saved = await w.apply("owner", "timesheet.saveCell", {
        employee_id: w.outsiderId,
        date,
        row_context: { kind: "non-billable" },
        internal_category: "Admin",
        hours: 20,
      });
      expect(saved.status).toBe("applied");
    }
    expect(
      (
        await w.apply("owner", "timesheet.submitWeek", {
          employee_id: w.outsiderId,
          week_start_date: "2026-09-30",
        })
      ).status,
    ).toBe("applied");
    const outsiderFlag = (
      await db.transaction((tx) =>
        listActiveAnomalies(tx, w.owner, w.workspaceId, reviewTime),
      )
    ).find(
      (flag) =>
        flag.employee_id === w.outsiderId && flag.flag_reason === "HoursExceedExpected",
    );
    expect(outsiderFlag).toBeDefined();
    expect(
      (
        await db.transaction((tx) =>
          listActiveAnomalies(tx, w.manager, w.workspaceId, reviewTime),
        )
      ).some((flag) => flag.flagId === outsiderFlag!.flagId),
    ).toBe(false);
    const refusedNonReport = await w.apply("manager", "timesheetAnomaly.clear", {
      flag_id: outsiderFlag!.flagId,
      outcome: "AcceptedAsNormal",
    });
    expect(refusedNonReport).toMatchObject({ status: "rejected", reason: "role" });
  });
});

describe("VRS-F011 reactive utilization snapshot", () => {
  it("recomputes one pair, shares getWeek's denominator, and permits an own-only read", async () => {
    const w = await world();
    const saved = await w.apply("member", "timesheet.saveCell", {
      employee_id: w.memberId,
      date: "2026-09-30",
      row_context: { kind: "assignment", assignment_id: w.assignmentId },
      hours: 4,
    });
    expect(saved.status, JSON.stringify(saved)).toBe("applied");
    const first = (
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, {
          nodeType: "UtilizationSnapshot",
        }),
      )
    ).filter((node) => node.record["employee_id"] === w.memberId);
    expect(first).toHaveLength(1);
    const week = await db.transaction((tx) =>
      getWeek(tx, w.principal, w.memberId, "2026-09-30"),
    );
    expect(first[0]?.record["expected_hours"]).toBe(week?.expectedWeeklyHours);
    const own = await db.transaction((tx) =>
      getIndividual(tx, w.principal, w.memberId, "2026-09-30"),
    );
    const unrelated = await db.transaction((tx) =>
      getIndividual(tx, w.outsider, w.memberId, "2026-09-30"),
    );
    expect(own?.["billable_hours"]).toBe(4);
    expect(unrelated).toBeNull();
    await utilizationSnapshotCompute(w.workspaceId, w.memberId, "2026-09-28");
    const second = (
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, {
          nodeType: "UtilizationSnapshot",
        }),
      )
    ).filter((node) => node.record["employee_id"] === w.memberId);
    expect(second).toHaveLength(1);
    expect(second[0]?.nodeId).toBe(first[0]?.nodeId);
  });

  it("routes Pitch hours outside logged utilization in a real reactive recompute", async () => {
    const w = await world();
    expect(
      (
        await w.apply("member", "timesheet.saveCell", {
          employee_id: w.memberId,
          date: "2026-09-30",
          row_context: { kind: "assignment", assignment_id: w.assignmentId },
          hours: 20,
        })
      ).status,
    ).toBe("applied");
    const created = await w.apply("owner", "pitch.create", { name: "Pulse pitch" });
    const pitchId = (created.result as { pitchId: string }).pitchId;
    expect(
      (
        await w.apply("owner", "pitch.staffEmployee", {
          pitch_id: pitchId,
          employee_id: w.memberId,
        })
      ).status,
    ).toBe("applied");
    expect(
      (
        await w.apply("member", "timesheet.saveCell", {
          employee_id: w.memberId,
          date: "2026-10-01",
          row_context: { kind: "pitch", pitch_id: pitchId },
          hours: 15,
        })
      ).status,
    ).toBe("applied");
    const snapshot = await db.transaction((tx) =>
      getIndividual(tx, w.principal, w.memberId, "2026-09-30"),
    );
    expect(snapshot).toMatchObject({
      billable_hours: 20,
      pitch_hours: 15,
      logged_hours: 20,
    });
    const expected = Number(snapshot?.["expected_hours"]);
    expect(snapshot?.["utilization_rate"]).toBe(
      Math.round((20 / expected) * 1000) / 10,
    );
  });

  it("keeps a saved cell committed if the reactive compute throws after commit", async () => {
    const w = await world();
    const result = await applyMutation(
      w.principal,
      {
        mutation_id: randomUUID(),
        name: "timesheet.saveCell",
        args: {
          employee_id: w.memberId,
          date: "2026-09-30",
          row_context: { kind: "assignment", assignment_id: w.assignmentId },
          hours: 4,
        },
      },
      {
        now: () => "2026-09-30T12:30:00.000Z",
        interceptor: { now: () => "2026-09-30T12:30:00.000Z" },
        afterCommitOverride: async () => {
          await utilizationSnapshotCompute(w.workspaceId, randomUUID(), "2026-09-28");
        },
      },
    );
    expect(result.status).toBe("applied");
    const entries = (
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, {
          nodeType: "TimesheetEntry",
        }),
      )
    ).filter((row) => row.record["employee_id"] === w.memberId);
    expect(entries).toHaveLength(1);
  });

  it("uses one role-independent cohort while keeping comparisons role-scoped", async () => {
    const w = await world();
    const extraOne = randomUUID();
    const extraTwo = randomUUID();
    const ghost = randomUUID();
    const zeroHours = randomUUID();
    const members = [w.memberId, w.outsiderId, w.managerId, extraOne, extraTwo];
    await db.transaction(async (tx) => {
      for (const [index, employeeId] of members.entries()) {
        if (index < 3) {
          await updateNodeFields(tx, w.workspaceId, employeeId, null, {
            employee_type: "Employee",
            contracted_hours: 40,
            department: index === 0 ? "Delivery" : "Other",
          });
        } else {
          await insertNode(tx, {
            ...nodeRecord("Employee", w.workspaceId, employeeId),
            employee_type: "Employee",
            contracted_hours: 40,
            department: "Other",
          });
          await insertEdge(
            tx,
            w.workspaceId,
            edgeRecord("scoped_to_entity", employeeId, w.entityId),
          );
        }
        const billableHours = 4 * (index + 1);
        await insertNode(tx, {
          ...nodeRecord("UtilizationSnapshot", w.workspaceId),
          snapshot_id: randomUUID(),
          employee_id: employeeId,
          week_start_date: "2026-09-28",
          ...calculateUtilization({
            expectedHours: 40,
            billableHours,
            nonBillableHours: 0,
            pitchHours: 0,
          }),
          non_billable_breakdown: {},
          target_utilization: 0.75,
          computed_at: "2026-09-30T12:00:00.000Z",
        });
      }
      for (const [employeeId, employeeType, contractedHours] of [
        [ghost, "Ghost", 40],
        [zeroHours, "Employee", 0],
      ] as const) {
        await insertNode(tx, {
          ...nodeRecord("Employee", w.workspaceId, employeeId),
          employee_type: employeeType,
          contracted_hours: contractedHours,
          department: "Other",
        });
        await insertEdge(
          tx,
          w.workspaceId,
          edgeRecord("scoped_to_entity", employeeId, w.entityId),
        );
        await insertNode(tx, {
          ...nodeRecord("UtilizationSnapshot", w.workspaceId),
          snapshot_id: randomUUID(),
          employee_id: employeeId,
          week_start_date: "2026-09-28",
          ...calculateUtilization({
            expectedHours: 40,
            billableHours: 40,
            nonBillableHours: 0,
            pitchHours: 0,
          }),
          non_billable_breakdown: {},
          target_utilization: 0.75,
          computed_at: "2026-09-30T12:00:00.000Z",
        });
      }
    });
    const read = (principal: typeof w.owner, filters?: { departments: string[] }) =>
      db.transaction((tx) =>
        getAgencyAggregate(tx, principal, w.workspaceId, "2026-09-30", filters),
      );
    const owner = await read(w.owner);
    const manager = await read(w.manager);
    const member = await read(w.principal);
    const agencyFields = (result: typeof owner) => ({
      aggregateUtilization: result.aggregateUtilization,
      aggregateLoggingCompleteness: result.aggregateLoggingCompleteness,
      weekOverWeekDelta: result.weekOverWeekDelta,
      cohortSize: result.cohortSize,
    });
    expect(agencyFields(owner)).toEqual(agencyFields(manager));
    expect(agencyFields(owner)).toEqual(agencyFields(member));
    expect(owner).toMatchObject({
      aggregateUtilization: 30,
      aggregateLoggingCompleteness: 30,
      cohortSize: 5,
    });
    expect(owner.perEmployee).toHaveLength(5);
    expect(manager.perEmployee).toEqual([
      { employeeId: w.memberId, utilizationRate: 10 },
    ]);
    expect(member).not.toHaveProperty("perEmployee");
    expect(member.own).toMatchObject({ employee_id: w.memberId, utilization_rate: 10 });
    const suppressed = await read(w.owner, { departments: ["Delivery"] });
    expect(suppressed.aggregateUtilization).toEqual({ state: "suppressed" });
    expect(suppressed.cohortSize).toBe(1);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../db.js";
import { getNode, getNodes, insertEdge, insertNode } from "../graph/store.js";
import { systemActorId } from "../graph/system-actor.js";
import { SYSTEM_PRINCIPAL_DISPLAY_NAMES } from "@vulto/schema";
import { revenueGapAlertEvaluate } from "../mutations/revenue-gap-alert.js";
import { applyMutation } from "../mutations/pipeline.js";
import { computeBenchStatus } from "./bench-forecast-queries.js";
import {
  listActiveRevenueGapAlerts,
  sweepRevenueGapAlerts,
} from "./revenue-gap-alert-queries.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);
const JAN_1 = "2026-01-01T12:00:00.000Z";

async function world(jurisdiction: "Global" | "AE" = "Global") {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    team: ["team-member"],
    manager: ["team-member"],
  });
  const principals = Object.fromEntries(
    await Promise.all(
      Object.entries(fixture.people).map(async ([name, person]) => [
        name,
        (await db.transaction((tx) =>
          resolveMemberPrincipal(tx, {
            workspaceId: fixture.workspaceId,
            userId: person.userId,
          }),
        ))!,
      ]),
    ),
  ) as Record<
    "owner" | "hr" | "team" | "manager",
    NonNullable<Awaited<ReturnType<typeof resolveMemberPrincipal>>>
  >;
  const apply = (
    name: string,
    args: unknown,
    now = JAN_1,
    who: keyof typeof principals = "owner",
  ) =>
    applyMutation(
      principals[who],
      { mutation_id: randomUUID(), name, args },
      { now: () => now },
    );
  const entityResult = await apply("entity.create", {
    name: "Gap Alert Entity",
    jurisdiction,
    default_currency: "USD",
  });
  expect(entityResult.status, JSON.stringify(entityResult)).toBe("applied");
  const entityId = (entityResult.result as { entity_id: string }).entity_id;
  const projectId = randomUUID();
  await db.transaction((tx) =>
    insertNode(tx, {
      ...nodeRecord("Project", fixture.workspaceId, projectId),
      lifecycle_status: "Active",
      name: "Project Alpha",
    }),
  );
  const addEmployee = async (billingRateDefault: number | null = null) => {
    const id = randomUUID();
    const result = await apply(
      "employee.create",
      {
        employee_id: id,
        entity_id: entityId,
        effective_from: JAN_1,
        fields: {
          employee_code: `E-${id}`,
          full_name: `Employee ${id}`,
          email: `${id}@example.test`,
          job_title: "Consultant",
          employment_type: "FullTime",
          start_date: "2026-01-01",
          department: "Engineering",
          seniority_level: "Senior",
          ...(billingRateDefault === null
            ? {}
            : { billing_rate_default: billingRateDefault }),
        },
      },
      JAN_1,
      "hr",
    );
    expect(result.status, JSON.stringify(result)).toBe("applied");
    return id;
  };
  const alerts = () =>
    db.transaction((tx) =>
      getNodes(tx, fixture.workspaceId, {
        nodeType: "RevenueGapAlert",
      }),
    );
  return { ...fixture, principals, apply, addEmployee, projectId, alerts };
}

describe("VRS-F012 Revenue Gap Alert", () => {
  it("creates Low at five working days, uses the ended Assignment's stored rate, escalates in place and sweeps idempotently", async () => {
    const w = await world();
    const employeeId = await w.addEmployee(500);
    const created = await w.apply(
      "assignment.create",
      {
        employee_id: employeeId,
        project_id: w.projectId,
        start_date: "2026-01-01",
        end_date: "2026-01-02",
        billable_percentage: 100,
      },
      JAN_1,
      "hr",
    );
    expect(created.status, JSON.stringify(created)).toBe("applied");
    const assignmentId = (created.result as { assignment_id: string }).assignment_id;
    expect(
      (
        await w.apply(
          "assignment.setRateOverride",
          {
            assignment_id: assignmentId,
            hourly: 15,
            reason: "Contract rate",
          },
          JAN_1,
          "hr",
        )
      ).status,
    ).toBe("applied");
    const first = await revenueGapAlertEvaluate(
      w.workspaceId,
      employeeId,
      "2026-01-09T12:00:00.000Z",
    );
    const alert = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, first.alertId!),
    );
    expect(alert?.record).toMatchObject({
      lifecycle_status: "Active",
      bench_days: 5,
      severity: "Low",
      bench_start_date: "2026-01-02",
      daily_cost: 120,
      accumulated_cost: 600,
    });
    const second = await revenueGapAlertEvaluate(
      w.workspaceId,
      employeeId,
      "2026-01-16T12:00:00.000Z",
    );
    expect(second.alertId).toBe(first.alertId);
    const medium = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, second.alertId!),
    );
    expect(medium?.record).toMatchObject({
      bench_days: 10,
      severity: "Medium",
      escalated_at: "2026-01-16T12:00:00.000Z",
    });
    await sweepRevenueGapAlerts(w.workspaceId);
    const afterFirstSweep = (await w.alerts())[0]!.record["updated_at"];
    await sweepRevenueGapAlerts(w.workspaceId);
    const rows = await w.alerts();
    expect(rows).toHaveLength(1);
    // The first sweep may recompute for today's date; the identical second
    // sweep must leave the established row untouched.
    expect(rows[0]!.record["updated_at"]).toBe(afterFirstSweep);
  });

  it("resolves through assignment.create's afterCommit with the real new Assignment ID", async () => {
    const w = await world();
    const employeeId = await w.addEmployee();
    const { alertId } = await revenueGapAlertEvaluate(
      w.workspaceId,
      employeeId,
      "2026-01-07T12:00:00.000Z",
    );
    expect(alertId).toBeTruthy();
    const result = await w.apply(
      "assignment.create",
      {
        employee_id: employeeId,
        project_id: w.projectId,
        start_date: "2026-01-07",
        end_date: "2026-01-20",
        billable_percentage: 100,
      },
      "2026-01-07T12:00:00.000Z",
      "hr",
    );
    expect(result.status, JSON.stringify(result)).toBe("applied");
    const assignmentId = (result.result as { assignment_id: string }).assignment_id;
    const resolved = await db.transaction((tx) => getNode(tx, w.workspaceId, alertId!));
    expect(resolved?.record).toMatchObject({
      lifecycle_status: "Resolved",
      resolved_by: "system",
      resolved_by_assignment_id: assignmentId,
      resolved_at: "2026-01-07T12:00:00.000Z",
    });
  });

  it("keeps dismissed alerts Active; Team Member sees workspace alerts but cannot dismiss", async () => {
    const w = await world();
    const employeeId = await w.addEmployee();
    const { alertId } = await revenueGapAlertEvaluate(
      w.workspaceId,
      employeeId,
      "2026-01-07T12:00:00.000Z",
    );
    expect(alertId).toBeTruthy();
    const visible = await db.transaction((tx) =>
      listActiveRevenueGapAlerts(tx, w.principals.team, w.workspaceId),
    );
    expect(visible.map((row) => row.alertId)).toContain(alertId);
    const denied = await w.apply(
      "revenueGapAlert.dismiss",
      { alert_id: alertId },
      "2026-01-07T13:00:00.000Z",
      "team",
    );
    expect(denied.status).toBe("rejected");
    const dismissed = await w.apply(
      "revenueGapAlert.dismiss",
      { alert_id: alertId },
      "2026-01-07T13:00:00.000Z",
      "hr",
    );
    expect(dismissed.status, JSON.stringify(dismissed)).toBe("applied");
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, alertId!)))?.record,
    ).toMatchObject({
      lifecycle_status: "Active",
      dismissed_at: "2026-01-07T13:00:00.000Z",
    });
    await revenueGapAlertEvaluate(
      w.workspaceId,
      employeeId,
      "2026-01-14T12:00:00.000Z",
    );
    const escalated = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, alertId!),
    );
    expect(escalated?.record).toMatchObject({
      lifecycle_status: "Active",
      severity: "Medium",
      escalated_at: "2026-01-14T12:00:00.000Z",
    });
  });

  it("uses zero cost without any rate and excludes the UAE Friday/Saturday weekend", async () => {
    const w = await world("AE");
    const employeeId = await w.addEmployee();
    const status = await db.transaction((tx) =>
      computeBenchStatus(tx, w.workspaceId, employeeId, "2026-01-07", async () => true),
    );
    expect(status.benchDays).toEqual([
      "2026-01-01",
      "2026-01-04",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);
    const fortnight = await db.transaction((tx) =>
      computeBenchStatus(tx, w.workspaceId, employeeId, "2026-01-14", async () => true),
    );
    expect(fortnight.benchDays).toHaveLength(10);
    expect(fortnight.benchDays).not.toContain("2026-01-09");
    expect(fortnight.benchDays).not.toContain("2026-01-10");
    const { alertId } = await revenueGapAlertEvaluate(
      w.workspaceId,
      employeeId,
      "2026-01-07T12:00:00.000Z",
    );
    const alert = await db.transaction((tx) => getNode(tx, w.workspaceId, alertId!));
    expect(alert?.record).toMatchObject({
      bench_days: 5,
      daily_cost: 0,
      accumulated_cost: 0,
    });
  });

  it("never evaluates Ghost Resources, even after a long bench interval", async () => {
    const w = await world();
    const ghostEmployeeId = randomUUID();
    await db.transaction((tx) =>
      insertNode(tx, {
        ...nodeRecord("Employee", w.workspaceId, ghostEmployeeId),
        employee_type: "Ghost",
        start_date: "2026-01-01",
      }),
    );
    expect(
      (
        await revenueGapAlertEvaluate(
          w.workspaceId,
          ghostEmployeeId,
          "2026-02-01T12:00:00.000Z",
        )
      ).alertId,
    ).toBeNull();
    expect(await w.alerts()).toHaveLength(0);
    expect((await sweepRevenueGapAlerts(w.workspaceId)).evaluatedCount).toBe(0);
    expect(await w.alerts()).toHaveLength(0);
  });

  it("writes the derived alert under its system actor after a Manager cancels an Assignment", async () => {
    const w = await world();
    const managerEmployeeId = await w.addEmployee();
    const reportId = await w.addEmployee();
    expect(
      (
        await w.apply("employee.linkUser", {
          employee_id: managerEmployeeId,
          user_id: w.people.manager!.userId,
          expected_version: 1,
        })
      ).status,
    ).toBe("applied");
    await db.transaction((tx) =>
      insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("managed_by", reportId, managerEmployeeId, JAN_1),
      ),
    );
    const created = await w.apply(
      "assignment.create",
      {
        employee_id: reportId,
        project_id: w.projectId,
        start_date: "2026-01-01",
        end_date: "2026-01-09",
        billable_percentage: 100,
      },
      JAN_1,
      "hr",
    );
    expect(created.status, JSON.stringify(created)).toBe("applied");
    const assignmentId = (created.result as { assignment_id: string }).assignment_id;
    const canceled = await w.apply(
      "assignment.cancel",
      {
        assignment_id: assignmentId,
        expected_version: 1,
      },
      "2026-01-09T12:00:00.000Z",
      "manager",
    );
    expect(canceled.status, JSON.stringify(canceled)).toBe("applied");
    const rows = await w.alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.record["employee_id"]).toBe(reportId);
    expect(rows[0]!.record["created_by"]).not.toBe(w.people.manager!.userId);
    expect(rows[0]!.record["created_by"]).toBe(
      systemActorId(w.workspaceId, "revenue-gap-alert-evaluate"),
    );
    expect(SYSTEM_PRINCIPAL_DISPLAY_NAMES["revenue-gap-alert-evaluate"]).toBe(
      "Revenue Gap Alert",
    );
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getKeyServices } from "../crypto/keys.js";
import { closeDatabase, db } from "../db.js";
import { getNode, insertEdge, insertNode } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { writeProtected } from "../protected/write.js";
import {
  compensationCostForBenchDay,
  getBenchForecastAggregate,
  getBenchForecastCosts,
} from "./bench-forecast-queries.js";
import { getProtectedContextualIntelligence } from "./contextual-intelligence-queries.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);

const NOW = "2026-01-01T00:00:00.000Z";

async function world() {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    manager: ["team-member"],
    otherManager: ["team-member"],
    report: ["team-member"],
    team: ["team-member"],
  });
  const principals = {} as Record<
    keyof typeof fixture.people,
    NonNullable<Awaited<ReturnType<typeof resolveMemberPrincipal>>>
  >;
  for (const [name, person] of Object.entries(fixture.people)) {
    principals[name] = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, {
        workspaceId: fixture.workspaceId,
        userId: person.userId,
      }),
    ))!;
  }
  const projectId = randomUUID();
  await db.transaction((tx) =>
    insertNode(tx, {
      ...nodeRecord("Project", fixture.workspaceId, projectId),
      lifecycle_status: "Active",
      name: "Project Alpha",
    }),
  );
  const apply = (who: keyof typeof principals, name: string, args: unknown) =>
    applyMutation(
      principals[who]!,
      { mutation_id: randomUUID(), name, args },
      { now: () => NOW },
    );
  const entityResult = await apply("owner", "entity.create", {
    name: "Forecast Entity",
    jurisdiction: "Global",
    default_currency: "USD",
  });
  expect(entityResult.status, JSON.stringify(entityResult)).toBe("applied");
  const entityId = (entityResult.result as { entity_id: string }).entity_id;
  const entity = await db.transaction((tx) =>
    getNode(tx, fixture.workspaceId, entityId),
  );
  return { ...fixture, principals, entity: entity!, projectId, apply };
}

async function employee(
  w: Awaited<ReturnType<typeof world>>,
  name: keyof typeof w.people | null,
  department = "Engineering",
) {
  const employeeId = randomUUID();
  const result = await w.apply("hr", "employee.create", {
    employee_id: employeeId,
    entity_id: w.entity.nodeId,
    effective_from: "2026-01-01T00:00:00.000Z",
    fields: {
      employee_code: `E-${employeeId}`,
      full_name: `Employee ${employeeId}`,
      email: `${employeeId}@example.test`,
      job_title: "Consultant",
      employment_type: "FullTime",
      start_date: "2026-01-01",
      department,
      seniority_level: "Senior",
      billing_rate_default: 1000,
    },
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  if (name !== null) {
    const linked = await w.apply("owner", "employee.linkUser", {
      employee_id: employeeId,
      user_id: w.people[name]!.userId,
      expected_version: 1,
    });
    expect(linked.status, JSON.stringify(linked)).toBe("applied");
  }
  return employeeId;
}

describe("VRS-F005 — The Bench Forecast", () => {
  it("uses the specified annual, monthly and hourly compensation formulas", () => {
    expect(
      compensationCostForBenchDay({
        amount: 24_000,
        frequency: "Annual",
        hours: 4,
        dayFraction: 0.5,
        workingDaysInYear: 240,
      }),
    ).toBe(50);
    expect(
      compensationCostForBenchDay({
        amount: 1_000,
        frequency: "Monthly",
        hours: 4,
        dayFraction: 0.5,
        workingDaysInYear: 240,
      }),
    ).toBe(25);
    expect(
      compensationCostForBenchDay({
        amount: 50,
        frequency: "Hourly",
        hours: 6,
        dayFraction: 0.75,
        workingDaysInYear: 240,
      }),
    ).toBe(300);
  });

  it("applies Assignment mutations through the interceptor and enforces capacity and version order", async () => {
    const w = await world();
    const employeeId = await employee(w, null);
    const first = await w.apply("hr", "assignment.create", {
      employee_id: employeeId,
      project_id: w.projectId,
      start_date: "2026-03-02",
      end_date: "2026-03-20",
      billable_percentage: 60,
    });
    expect(first.status, JSON.stringify(first)).toBe("applied");
    const assignmentId = (first.result as { assignment_id: string }).assignment_id;
    const stored = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, assignmentId),
    );
    expect(stored?.record).toMatchObject({ effective_billing_rate: 125 });
    const conflict = await w.apply("hr", "assignment.create", {
      employee_id: employeeId,
      project_id: w.projectId,
      start_date: "2026-03-15",
      end_date: "2026-04-01",
      billable_percentage: 50,
    });
    expect(conflict.reason).toBe("capacity-conflict:current=60:attempted=50");
    const updated = await w.apply("hr", "assignment.update", {
      assignment_id: assignmentId,
      fields: {
        start_date: "2026-03-03",
        end_date: "2026-03-21",
        billable_percentage: 65,
      },
    });
    expect(updated.status, JSON.stringify(updated)).toBe("applied");
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, assignmentId)))?.record,
    ).toMatchObject({
      start_date: "2026-03-03",
      end_date: "2026-03-21",
      billable_percentage: 65,
    });
    const denied = await w.apply("team", "assignment.create", {
      employee_id: employeeId,
      project_id: w.projectId,
      start_date: "2026-04-01",
      end_date: "2026-04-02",
      billable_percentage: 10,
    });
    expect(denied.status).toBe("rejected");
    expect(
      (
        await w.apply("hr", "assignment.cancel", {
          assignment_id: assignmentId,
          expected_version: 99,
        })
      ).reason,
    ).toBe("stale-state");
    expect(
      (
        await w.apply("hr", "assignment.cancel", {
          assignment_id: assignmentId,
          expected_version: 2,
        })
      ).status,
    ).toBe("applied");
  });

  it("derives filtered and unfiltered cohorts server-side and applies disclosure control", async () => {
    const w = await world();
    const employees: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      employees.push(await employee(w, null, index === 5 ? "Design" : "Engineering"));
    }
    const skillId = randomUUID();
    await db.transaction(async (tx) => {
      await insertNode(tx, nodeRecord("Skill", w.workspaceId, skillId));
      for (const employeeId of employees.slice(0, 5)) {
        await insertEdge(
          tx,
          w.workspaceId,
          edgeRecord("has_skill", employeeId, skillId),
        );
      }
    });
    await w.apply("hr", "assignment.create", {
      employee_id: employees[0],
      project_id: w.projectId,
      start_date: "2026-10-05",
      end_date: "2026-10-09",
      billable_percentage: 100,
    });
    const visible = await db.transaction((tx) =>
      getBenchForecastAggregate(
        tx,
        w.principals.owner!,
        {
          window: { from_date: "2026-10-05", to_date: "2026-10-09" },
          filters: {
            skillIds: [skillId],
            seniorityLevels: ["Senior"],
            departments: ["Engineering"],
            entityIds: [w.entity.nodeId],
            availability: { fromDate: "2026-10-12", toDate: "2026-10-16" },
          },
        },
        {},
        NOW,
      ),
    );
    // Five of six is below the differencing threshold, so the full cohort's
    // value is returned rather than disclosing the sixth employee by subtraction.
    expect(visible).toEqual({ aggregateUtilization: 1 / 6, cohortSize: 5 });
    const suppressed = await db.transaction((tx) =>
      getBenchForecastAggregate(
        tx,
        w.principals.owner!,
        {
          window: { from_date: "2026-10-05", to_date: "2026-10-09" },
          filters: { departments: ["Design"] },
        },
        {},
        NOW,
      ),
    );
    expect(suppressed).toEqual({
      aggregateUtilization: { state: "suppressed" },
      cohortSize: 1,
    });
    const workspace = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, w.workspaceId),
    );
    expect(workspace?.record).toMatchObject({
      k_anonymity_minimum: 5,
      k_anonymity_minimum_sensitive: 8,
    });
  });

  it("returns compensation-aware cost to an authorized caller and null otherwise across a year boundary", async () => {
    const w = await world();
    const employeeId = await employee(w, null);
    await db.transaction((tx) =>
      writeProtected(
        tx,
        getKeyServices(),
        { workspaceId: w.workspaceId, nodeId: employeeId, nodeType: "Employee" },
        "compensation",
        {
          base_compensation_amount: 36500,
          compensation_frequency: "Annual",
          compensation_currency: "USD",
        },
      ),
    );
    const owner = await db.transaction((tx) =>
      getBenchForecastCosts(tx, getKeyServices(), w.principals.owner!, {
        employeeIds: [employeeId],
        window: { from_date: "2027-12-31", to_date: "2028-01-03" },
      }),
    );
    expect(owner.costs[employeeId]?.amount).toBeCloseTo(36500 / 261 + 36500 / 260);
    const unauthorized = await db.transaction((tx) =>
      getBenchForecastCosts(tx, getKeyServices(), w.principals.team!, {
        employeeIds: [employeeId],
        window: { from_date: "2027-12-31", to_date: "2028-01-03" },
      }),
    );
    expect(unauthorized.costs[employeeId]).toBeNull();
  }, 15_000);

  it("uses the real interceptor for protected Panel fields and never requests wellness", async () => {
    const w = await world();
    const manager = await employee(w, "manager");
    await employee(w, "otherManager");
    const report = await employee(w, "report");
    expect(
      (
        await w.apply("owner", "org.moveEmployee", {
          employee_id: report,
          new_manager_id: manager,
          effective_from: "2026-02-01T00:00:00.000Z",
        })
      ).status,
    ).toBe("applied");
    const burnout = randomUUID();
    const flightRisk = randomUUID();
    await db.transaction(async (tx) => {
      await insertNode(tx, nodeRecord("BurnoutAlert", w.workspaceId, burnout));
      await insertNode(tx, nodeRecord("FlightRiskSignal", w.workspaceId, flightRisk));
      await insertEdge(tx, w.workspaceId, edgeRecord("triggered_by", burnout, report));
      await insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("triggered_by", flightRisk, report),
      );
      await writeProtected(
        tx,
        getKeyServices(),
        { workspaceId: w.workspaceId, nodeId: burnout, nodeType: "BurnoutAlert" },
        "record",
        { severity: "High" },
      );
      await writeProtected(
        tx,
        getKeyServices(),
        {
          workspaceId: w.workspaceId,
          nodeId: flightRisk,
          nodeType: "FlightRiskSignal",
        },
        "record",
        { risk: "High" },
      );
    });
    const managerView = await db.transaction((tx) =>
      getProtectedContextualIntelligence(
        tx,
        getKeyServices(),
        w.principals.manager!,
        report,
      ),
    );
    expect(managerView).toEqual({ burnoutAlert: { severity: "High" } });
    const otherView = await db.transaction((tx) =>
      getProtectedContextualIntelligence(
        tx,
        getKeyServices(),
        w.principals.otherManager!,
        report,
      ),
    );
    expect(otherView).toEqual({});
    const ownerView = await db.transaction((tx) =>
      getProtectedContextualIntelligence(
        tx,
        getKeyServices(),
        w.principals.owner!,
        report,
      ),
    );
    expect(ownerView).toEqual({
      burnoutAlert: { severity: "High" },
      flightRiskSignal: { risk: "High" },
    });
    const hrView = await db.transaction((tx) =>
      getProtectedContextualIntelligence(
        tx,
        getKeyServices(),
        w.principals.hr!,
        report,
      ),
    );
    expect(hrView).toEqual({
      burnoutAlert: { severity: "High" },
      flightRiskSignal: { risk: "High" },
    });
  });
});

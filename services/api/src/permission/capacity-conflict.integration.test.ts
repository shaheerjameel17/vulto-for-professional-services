import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../db.js";
import { graphEdges, graphNodes } from "../graph/schema.js";
import { getNode, getNodes, insertEdge, insertNode, outgoing } from "../graph/store.js";
import { capacityTotalsFor } from "../mutations/assignment.js";
import { applyMutation } from "../mutations/pipeline.js";
import { sweepOvercommitted } from "./conflict-resolution-queries.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);

const NOW = "2026-01-01T00:00:00.000Z";

async function world() {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    manager: ["team-member"],
    outsider: ["team-member"],
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
      name: "Capacity Project",
    }),
  );
  const apply = (
    who: keyof typeof principals,
    name: string,
    args: unknown,
    mutationId = randomUUID(),
  ) =>
    applyMutation(
      principals[who]!,
      { mutation_id: mutationId, name, args },
      { now: () => NOW },
    );
  const entityResult = await apply("owner", "entity.create", {
    name: "Capacity Entity",
    jurisdiction: "Global",
    default_currency: "USD",
  });
  expect(entityResult.status, JSON.stringify(entityResult)).toBe("applied");
  return {
    ...fixture,
    principals,
    projectId,
    entityId: (entityResult.result as { entity_id: string }).entity_id,
    calendarId: (entityResult.result as { calendar_id: string }).calendar_id,
    apply,
  };
}

async function employee(
  w: Awaited<ReturnType<typeof world>>,
  linkedPerson: keyof typeof w.people | null = null,
) {
  const employeeId = randomUUID();
  const result = await w.apply("hr", "employee.create", {
    employee_id: employeeId,
    entity_id: w.entityId,
    effective_from: NOW,
    fields: {
      employee_code: `E-${employeeId}`,
      full_name: `Employee ${employeeId}`,
      email: `${employeeId}@example.test`,
      job_title: "Consultant",
      employment_type: "FullTime",
      start_date: "2026-01-01",
      seniority_level: "Senior",
      billing_rate_default: 100,
    },
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  if (linkedPerson !== null) {
    const linked = await w.apply("owner", "employee.linkUser", {
      employee_id: employeeId,
      user_id: w.people[linkedPerson]!.userId,
      expected_version: 1,
    });
    expect(linked.status, JSON.stringify(linked)).toBe("applied");
  }
  return employeeId;
}

const proposed = (employeeId: string, projectId: string, percentage: number) => ({
  employee_id: employeeId,
  project_id: projectId,
  start_date: "2026-03-03",
  end_date: "2026-03-03",
  billable_percentage: percentage,
});

describe("VRS-F008 — Capacity Conflict Resolution", () => {
  it("filters weekends and holidays out of authoritative capacity validation", async () => {
    const w = await world();
    const weekendEmployee = await employee(w);
    expect(
      (
        await w.apply("hr", "assignment.create", {
          ...proposed(weekendEmployee, w.projectId, 100),
          start_date: "2026-03-02",
          end_date: "2026-03-08",
        })
      ).status,
    ).toBe("applied");
    const weekendOnly = await w.apply("hr", "assignment.create", {
      ...proposed(weekendEmployee, w.projectId, 50),
      start_date: "2026-03-07",
      end_date: "2026-03-08",
    });
    expect(weekendOnly.status, JSON.stringify(weekendOnly)).toBe("applied");

    const holidayEmployee = await employee(w);
    expect(
      (
        await w.apply("hr", "holiday.add", {
          calendar_id: w.calendarId,
          fields: {
            name: "Capacity holiday",
            date: "2026-03-04",
            holiday_type: "Company",
          },
        })
      ).status,
    ).toBe("applied");
    expect(
      (
        await w.apply("hr", "assignment.create", {
          ...proposed(holidayEmployee, w.projectId, 100),
          start_date: "2026-03-04",
          end_date: "2026-03-04",
        })
      ).status,
    ).toBe("applied");
    const holidayOnly = await w.apply("hr", "assignment.create", {
      ...proposed(holidayEmployee, w.projectId, 50),
      start_date: "2026-03-04",
      end_date: "2026-03-04",
    });
    expect(holidayOnly.status, JSON.stringify(holidayOnly)).toBe("applied");
  });

  it("keeps ordinary create and update constrained while a manager can record an override", async () => {
    const w = await world();
    const managerId = await employee(w, "manager");
    const reportId = await employee(w);
    expect(
      (
        await w.apply("owner", "org.moveEmployee", {
          employee_id: reportId,
          new_manager_id: managerId,
          effective_from: NOW,
        })
      ).status,
    ).toBe("applied");
    const base = await w.apply("hr", "assignment.create", {
      ...proposed(reportId, w.projectId, 80),
    });
    expect(base.status).toBe("applied");
    const fitted = await w.apply("hr", "assignment.create", {
      ...proposed(reportId, w.projectId, 20),
    });
    expect(fitted.status).toBe("applied");
    expect(
      (
        await w.apply("hr", "assignment.create", {
          ...proposed(reportId, w.projectId, 1),
        })
      ).reason,
    ).toBe("capacity-conflict:current=100:attempted=1");
    expect(
      (
        await w.apply("hr", "assignment.update", {
          assignment_id: (fitted.result as { assignment_id: string }).assignment_id,
          fields: { billable_percentage: 30 },
        })
      ).reason,
    ).toBe("capacity-conflict:current=80:attempted=30");

    const override = await w.apply("manager", "conflictResolution.overrideAndProceed", {
      proposed: proposed(reportId, w.projectId, 30),
      reason: "Client transition requires a short overlap",
    });
    expect(override.status, JSON.stringify(override)).toBe("applied");
    const assignmentId = (override.result as { assignment_id: string }).assignment_id;
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, assignmentId)))?.record,
    ).toMatchObject({
      employee_id: reportId,
      project_id: w.projectId,
      billable_percentage: 30,
      capacity_override_reason: "Client transition requires a short overlap",
      capacity_override_by: w.people.manager!.userId,
      capacity_override_at: NOW,
    });
    const structuralEdges = await db.transaction(async (tx) => [
      ...(await outgoing(tx, w.workspaceId, assignmentId, "assignment_of")),
      ...(await outgoing(tx, w.workspaceId, assignmentId, "assigned_to")),
    ]);
    expect(
      structuralEdges.map(({ edgeType, toNodeId }) => ({ edgeType, toNodeId })),
    ).toEqual(
      expect.arrayContaining([
        { edgeType: "assignment_of", toNodeId: reportId },
        { edgeType: "assigned_to", toNodeId: w.projectId },
      ]),
    );

    const rejectedId = randomUUID();
    const rejected = await w.apply(
      "outsider",
      "conflictResolution.overrideAndProceed",
      {
        proposed: proposed(reportId, w.projectId, 30),
        reason: "Unauthorized",
      },
      rejectedId,
    );
    expect(rejected).toMatchObject({ status: "rejected", reason: "not-authorized" });
    expect(
      await db.transaction((tx) => getNode(tx, w.workspaceId, rejectedId)),
    ).toBeNull();
  });

  it("refuses an unrelated manager at assignment_of before any write", async () => {
    const w = await world();
    const targetManagerId = await employee(w, "manager");
    const targetId = await employee(w);
    const unrelatedManagerId = await employee(w, "outsider");
    const unrelatedReportId = await employee(w);
    for (const [employeeId, managerId] of [
      [targetId, targetManagerId],
      [unrelatedReportId, unrelatedManagerId],
    ] as const) {
      expect(
        (
          await w.apply("owner", "org.moveEmployee", {
            employee_id: employeeId,
            new_manager_id: managerId,
            effective_from: NOW,
          })
        ).status,
      ).toBe("applied");
    }

    const refusedEdgeId = randomUUID();
    expect(
      await w.apply(
        "outsider",
        "assignment.create",
        proposed(targetId, w.projectId, 1),
        refusedEdgeId,
      ),
    ).toMatchObject({ status: "rejected", reason: "role" });
    expect(
      await db.transaction((tx) => getNode(tx, w.workspaceId, refusedEdgeId)),
    ).toBeNull();
  });

  it("treats Ghosts identically and reports both recorded and unrecorded overcommitment without writes", async () => {
    const w = await world();
    const managerId = await employee(w, "manager");
    const created = await w.apply("hr", "ghostResource.create", {
      role_title: "Planned consultant",
      projected_start_date: "2026-03-01",
      seniority_level: "Senior",
    });
    expect(created.status, JSON.stringify(created)).toBe("applied");
    const ghostEmployeeId = (created.result as { employeeId: string }).employeeId;
    const unrecordedId = await employee(w);
    await db.transaction(async (tx) => {
      await insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("scoped_to_entity", ghostEmployeeId, w.entityId, NOW),
      );
      await insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("managed_by", ghostEmployeeId, managerId, NOW),
      );
      for (const percentage of [60, 60]) {
        await insertNode(tx, {
          ...nodeRecord("Assignment", w.workspaceId),
          lifecycle_status: "Active",
          employee_id: unrecordedId,
          project_id: w.projectId,
          start_date: "2026-03-03",
          end_date: "2026-03-03",
          billable_percentage: percentage,
          capacity_override_reason: null,
          capacity_override_by: null,
          capacity_override_at: null,
        });
      }
    });
    expect(
      (
        await w.apply("hr", "assignment.create", {
          ...proposed(ghostEmployeeId, w.projectId, 80),
        })
      ).status,
    ).toBe("applied");
    const ghostOverride = await w.apply(
      "manager",
      "conflictResolution.overrideAndProceed",
      {
        proposed: proposed(ghostEmployeeId, w.projectId, 30),
        reason: "Approved planned overlap",
      },
    );
    expect(ghostOverride.status, JSON.stringify(ghostOverride)).toBe("applied");

    const beforeNodes = await db
      .select()
      .from(graphNodes)
      .where(eq(graphNodes.workspaceId, w.workspaceId))
      .orderBy(graphNodes.workspaceId, graphNodes.nodeId);
    const beforeEdges = await db
      .select()
      .from(graphEdges)
      .where(eq(graphEdges.workspaceId, w.workspaceId))
      .orderBy(graphEdges.workspaceId, graphEdges.edgeId);
    const result = await db.transaction((tx) =>
      sweepOvercommitted(tx, w.principals.owner!),
    );
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeId: ghostEmployeeId,
          combinedTotal: 110,
          hasRecordedOverride: true,
        }),
        expect.objectContaining({
          employeeId: unrecordedId,
          combinedTotal: 120,
          hasRecordedOverride: false,
        }),
      ]),
    );
    expect(
      await db
        .select()
        .from(graphNodes)
        .where(eq(graphNodes.workspaceId, w.workspaceId))
        .orderBy(graphNodes.workspaceId, graphNodes.nodeId),
    ).toEqual(beforeNodes);
    expect(
      await db
        .select()
        .from(graphEdges)
        .where(eq(graphEdges.workspaceId, w.workspaceId))
        .orderBy(graphEdges.workspaceId, graphEdges.edgeId),
    ).toEqual(beforeEdges);
  });

  it("keeps the independent local and server computations equal on the same fixture", async () => {
    // Keep the test-only client package load out of the API TypeScript graph: its
    // browser runtime intentionally needs DOM libraries that the server does not.
    const graphPackage = "@vulto/" + "graph";
    const { evaluateConflict } = (await import(graphPackage)) as {
      evaluateConflict(
        database: {
          all(
            sql: string,
            params?: readonly (string | number | null)[],
          ): Promise<Record<string, string | number | null>[]>;
          run(sql: string, params?: readonly (string | number | null)[]): Promise<void>;
          exec(sql: string): Promise<void>;
          transaction<T>(work: () => Promise<T>): Promise<T>;
          close(): Promise<void>;
        },
        input: {
          employeeId: string;
          startDate: string;
          endDate: string;
          billablePercentage: number;
          nearCapacityWarningThreshold: number;
          callerUserId: string;
        },
      ): Promise<{
        currentTotal: number;
        overlapWorkingDays: readonly string[];
      }>;
    };
    const w = await world();
    const employeeId = await employee(w);
    expect(
      (
        await w.apply("hr", "holiday.add", {
          calendar_id: w.calendarId,
          fields: {
            name: "Parity holiday",
            date: "2026-03-04",
            holiday_type: "Company",
          },
        })
      ).status,
    ).toBe("applied");
    expect(
      (
        await w.apply("hr", "assignment.create", {
          employee_id: employeeId,
          project_id: w.projectId,
          start_date: "2026-03-02",
          end_date: "2026-03-08",
          billable_percentage: 80,
        })
      ).status,
    ).toBe("applied");
    const [server, nodes, edges] = await db.transaction(async (tx) => [
      await capacityTotalsFor(
        { tx, principal: w.principals.owner! },
        employeeId,
        "2026-03-02",
        "2026-03-08",
      ),
      await getNodes(tx, w.workspaceId),
      await tx
        .select()
        .from(graphEdges)
        .where(eq(graphEdges.workspaceId, w.workspaceId)),
    ]);
    const localDatabase = {
      async all(sql: string, params: readonly (string | number | null)[] = []) {
        if (sql.includes("cache_nodes")) {
          return nodes
            .filter((node) => params.includes(node.nodeType))
            .map((node) => ({
              node_id: node.nodeId,
              node_type: node.nodeType,
              lifecycle_status: node.lifecycleStatus,
              is_soft_deleted: 0,
              record_json: JSON.stringify(node.record),
            }));
        }
        return edges
          .filter((edge) => params.includes(edge.edgeType))
          .map((edge) => ({
            edge_id: edge.edgeId,
            edge_type: edge.edgeType,
            from_node_id: edge.fromNodeId,
            to_node_id: edge.toNodeId,
            effective_from: edge.effectiveFrom?.toISOString() ?? null,
            effective_to: edge.effectiveTo?.toISOString() ?? null,
            is_soft_deleted: edge.isSoftDeleted ? 1 : 0,
          }));
      },
      async run() {},
      async exec() {},
      async transaction<T>(work: () => Promise<T>) {
        return work();
      },
      async close() {},
    };
    const local = await evaluateConflict(localDatabase, {
      employeeId,
      startDate: "2026-03-02",
      endDate: "2026-03-08",
      billablePercentage: 15,
      nearCapacityWarningThreshold: 90,
      callerUserId: w.people.owner!.userId,
    });
    expect(local.currentTotal).toBe(server.currentTotal);
    expect(local.overlapWorkingDays).toEqual(server.overlapWorkingDays);
  });

  it("founds the shared near-capacity threshold at 90", async () => {
    const w = await world();
    const workspace = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, w.workspaceId),
    );
    expect(workspace?.record["near_capacity_warning_threshold"]).toBe(90);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { leavePolicyConfigurationSchema } from "@vulto/schema";
import { closeDatabase, db } from "../db.js";
import { getNode, getNodes, outgoing, insertNode, insertEdge } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { appRouter } from "../router.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { authorizeRead } from "./interceptor.js";
import { makeWorkspace, nodeRecord, edgeRecord } from "./test-support.js";
import { getApplicable, listConflicts, computeBalance } from "./leave-queries.js";

afterAll(closeDatabase);
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-07-01T00:00:00.000Z";
const configuration = (days = 14) =>
  leavePolicyConfigurationSchema.parse({
    name: "Pakistan Full Time",
    jurisdiction: "PK",
    employment_type_scope: "FullTime",
    leave_types: [
      {
        leave_type: "Annual",
        accrual_method: "Monthly",
        annual_entitlement_days: days,
      },
    ],
  });

async function world() {
  const w = await makeWorkspace({
    hr: ["hr-admin"],
    finance: ["finance-admin"],
    manager: ["team-member"],
    member: ["team-member"],
  });
  const principals: Record<
    string,
    NonNullable<Awaited<ReturnType<typeof resolveMemberPrincipal>>>
  > = {};
  for (const [name, person] of Object.entries(w.people))
    principals[name] = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, { workspaceId: w.workspaceId, userId: person.userId }),
    ))!;
  const apply = (
    who: string,
    name: string,
    args: unknown,
    now = T0,
    id = randomUUID(),
  ) =>
    applyMutation(
      principals[who]!,
      { mutation_id: id, name, args },
      { now: () => now },
    );
  const entity = await apply("owner", "entity.create", {
    name: "Pakistan",
    jurisdiction: "PK",
    default_currency: "PKR",
  });
  expect(entity.status, JSON.stringify(entity)).toBe("applied");
  const entityId = (entity.result as { entity_id: string }).entity_id;
  const employeeId = randomUUID();
  expect(
    (
      await apply("hr", "employee.create", {
        employee_id: employeeId,
        entity_id: entityId,
        effective_from: T0,
        fields: {
          employee_code: `E-${employeeId}`,
          full_name: "Policy Employee",
          email: `${employeeId}@example.test`,
          job_title: "Consultant",
          employment_type: "FullTime",
          start_date: "2026-01-01",
        },
      })
    ).status,
  ).toBe("applied");
  await db.transaction(async (tx) => {
    const managerId = randomUUID();
    await insertNode(tx, {
      ...nodeRecord("Employee", w.workspaceId, managerId),
      user_id: w.people.manager!.userId,
    });
    await insertEdge(
      tx,
      w.workspaceId,
      edgeRecord("managed_by", employeeId, managerId),
    );
  });
  const caller = (who: string) =>
    appRouter.createCaller({
      principal: principals[who]!,
      schemaVersion: 1,
      claimedWorkspaceId: w.workspaceId,
      res: { header() {} },
    });
  const create = async (
    who = "hr",
    now = T0,
    config = configuration(),
    id = randomUUID(),
  ) => {
    const result = await apply(who, "leavePolicy.create", config, now, id);
    expect(result.status, JSON.stringify(result)).toBe("applied");
    return (result.result as { policy_id: string }).policy_id;
  };
  return { ...w, principals, apply, create, caller, employeeId, entityId };
}

describe("VRS-F018 policy, lineage and derived balances", () => {
  it("versions atomically with exact prior content preservation and stale/non-latest refusal", async () => {
    const w = await world();
    const id = await w.create();
    const before = (await db.transaction((tx) => getNode(tx, w.workspaceId, id)))!;
    const nextConfig = configuration(28);
    const args = {
      policy_id: id,
      expected_version: before.version,
      leave_types: nextConfig.leave_types,
    };
    const updated = await w.apply("owner", "leavePolicy.update", args, T1);
    expect(updated.status, JSON.stringify(updated)).toBe("applied");
    const nextId = (updated.result as { new_policy_id: string }).new_policy_id;
    await db.transaction(async (tx) => {
      const prior = (await getNode(tx, w.workspaceId, id))!;
      expect(prior.record).toEqual({ ...before.record, is_active: false });
      const next = (await getNode(tx, w.workspaceId, nextId))!;
      expect(next.record).toMatchObject({
        version: 2,
        supersedes_id: id,
        effective_from: "2026-07-01",
        is_active: true,
      });
      expect(
        (await outgoing(tx, w.workspaceId, nextId, "supersedes"))[0]?.toNodeId,
      ).toBe(id);
    });
    expect(await w.apply("hr", "leavePolicy.update", args, T1)).toMatchObject({
      status: "rejected",
      reason: "stale-state",
    });
    expect(
      await w.apply(
        "hr",
        "leavePolicy.update",
        { ...args, expected_version: before.version + 1 },
        T1,
      ),
    ).toMatchObject({ status: "rejected", reason: "stale-state" });
    expect(
      await w.apply(
        "hr",
        "leavePolicy.update",
        {
          ...args,
          policy_id: nextId,
          expected_version: 1,
          effective_from: "2026-06-30",
        },
        T1,
      ),
    ).toMatchObject({ status: "rejected", reason: "invalid-args" });
    expect(
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, { nodeType: "LeavePolicy" }),
      ),
    ).toHaveLength(2);
  });
  it("every role reads while only configuration writers create/update; generic writes remain refused", async () => {
    const w = await world();
    const id = await w.create("owner");
    await w.create("hr");
    for (const name of Object.keys(w.principals)) {
      const decision = await db.transaction((tx) =>
        authorizeRead(tx, w.principals[name]!, {
          workspaceId: w.workspaceId,
          nodeType: "LeavePolicy",
          nodeId: id,
        }),
      );
      expect(decision.access).toBe(name === "owner" || name === "hr" ? "full" : "read");
      if (name !== "owner" && name !== "hr") {
        expect(
          await w.apply(name, "leavePolicy.create", configuration()),
        ).toMatchObject({ status: "rejected", reason: "role" });
        expect(
          await w.apply(name, "leavePolicy.update", {
            policy_id: id,
            expected_version: 1,
            leave_types: configuration().leave_types,
          }),
        ).toMatchObject({ status: "rejected", reason: "role" });
      }
      const before = (await db.transaction((tx) => getNode(tx, w.workspaceId, id)))!;
      const operations = [
        ["graph.createNode", { node: { ...before.record, node_id: randomUUID() } }],
        [
          "graph.updateNodeFields",
          { node_id: id, expected_version: 1, patch: { name: "Changed" } },
        ],
        ["graph.softDeleteNode", { node_id: id }],
        [
          "graph.transitionLifecycle",
          { node_id: id, expected_version: 1, to_status: "Inactive" },
        ],
      ] as const;
      for (const [mutation, args] of operations) {
        const result = await w.apply(name, mutation, args);
        expect(result).toMatchObject({
          status: "rejected",
          reason:
            name === "owner" || name === "hr" ? "requires-feature-mutation" : "role",
        });
        console.log(`STAGE27_REFUSAL ${name} ${mutation} ${result.reason}`);
      }
      expect(
        (await db.transaction((tx) => getNode(tx, w.workspaceId, id)))!.record,
      ).toEqual(before.record);
    }
    expect(
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, { nodeType: "LeavePolicy" }),
      ),
    ).toHaveLength(2);
  });
  it("resolves newest policy and conflicts, gates configuration views, returns null when unmatched", async () => {
    const w = await world();
    const first = await w.create();
    const second = await w.create("hr", T1);
    expect(
      await db.transaction((tx) => getApplicable(tx, w.principals.hr!, w.employeeId)),
    ).toMatchObject({ policy: { node_id: second }, conflicting_policy_ids: [first] });
    expect(
      await w.caller("hr").leavePolicy.listConflicts({ workspace_id: w.workspaceId }),
    ).toEqual([{ employee_id: w.employeeId, policy_ids: [second, first] }]);
    for (const who of ["manager", "member", "finance"])
      await expect(
        w.caller(who).leavePolicy.listConflicts({ workspace_id: w.workspaceId }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const noEntity = randomUUID();
    await db.transaction((tx) =>
      insertNode(tx, {
        ...nodeRecord("Employee", w.workspaceId, noEntity),
        employment_type: "FullTime",
        start_date: "2026-01-01",
      }),
    );
    expect(
      await w.caller("hr").leavePolicy.getApplicable({ employee_id: noEntity }),
    ).toEqual({ policy: null, conflicting_policy_ids: [] });
    const other = await world();
    expect(
      await other
        .caller("hr")
        .leavePolicy.getApplicable({ employee_id: other.employeeId }),
    ).toEqual({ policy: null, conflicting_policy_ids: [] });
    // Same created_at: node_id is the deterministic tie break.
    const third = await w.create("hr", T1);
    const expected = [second, third].sort().reverse();
    expect(
      await db.transaction((tx) => getApplicable(tx, w.principals.hr!, w.employeeId)),
    ).toMatchObject({
      policy: { node_id: expected[0] },
      conflicting_policy_ids: [expected[1], first],
    });
    expect(
      await db.transaction((tx) => listConflicts(tx, w.principals.hr!, randomUUID())),
    ).toBeNull();
  });
  it("missing and unreadable employees have identical router refusals", async () => {
    const w = await world();
    await w.create();
    // Operational Employee is READ_ANY in this workspace. A real Employee
    // in another workspace is unreadable, not an invented same-workspace denial.
    const other = await world();
    for (const employee_id of [other.employeeId, randomUUID()]) {
      await expect(
        w.caller("member").leavePolicy.getApplicable({ employee_id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "not-found" });
      await expect(
        w.caller("member").leaveBalance.compute({
          employee_id,
          leave_type: "Annual",
          as_of_date: "2026-06-30",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "not-found" });
    }
  });
  it("computes through the router with a real entity/calendar and forward-only lineage; measures server p95", async () => {
    const w = await world();
    const id = await w.create();
    expect(
      (
        await w.caller("hr").leaveBalance.compute({
          employee_id: w.employeeId,
          leave_type: "Annual",
          as_of_date: "2026-06-30",
        })
      ).entitledYtd,
    ).toBeCloseTo(7);
    expect(
      (
        await w.apply(
          "hr",
          "leavePolicy.update",
          {
            policy_id: id,
            expected_version: 1,
            leave_types: configuration(28).leave_types,
          },
          T1,
        )
      ).status,
    ).toBe("applied");
    expect(
      (
        await w.caller("hr").leaveBalance.compute({
          employee_id: w.employeeId,
          leave_type: "Annual",
          as_of_date: "2026-06-30",
        })
      ).entitledYtd,
    ).toBeCloseTo(7);
    expect(
      (
        await w.caller("hr").leaveBalance.compute({
          employee_id: w.employeeId,
          leave_type: "Annual",
          as_of_date: "2026-08-31",
        })
      ).entitledYtd,
    ).toBeCloseTo((14 * 6) / 12 + (28 * 2) / 12);
    const applicable: number[] = [];
    const balances: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      let started = performance.now();
      await w.caller("hr").leavePolicy.getApplicable({ employee_id: w.employeeId });
      if (i > 0) applicable.push(performance.now() - started);
      started = performance.now();
      await w.caller("hr").leaveBalance.compute({
        employee_id: w.employeeId,
        leave_type: "Annual",
        as_of_date: "2026-08-31",
      });
      if (i > 0) balances.push(performance.now() - started);
    }
    const p95 = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
    console.log(
      `STAGE27_SERVER_P95 applicable=${p95(applicable).toFixed(3)}ms balance=${p95(balances).toFixed(3)}ms samples=20 fixture=2-employees,1-feature-entity-and-calendar,2-policy-versions,0-usage`,
    );
    // Also exercise the real working-day adapter with a partial first month.
    const partial = randomUUID();
    expect(
      (
        await w.apply("hr", "employee.create", {
          employee_id: partial,
          entity_id: w.entityId,
          effective_from: T0,
          fields: {
            employee_code: `E-${partial}`,
            full_name: "Partial Month",
            email: `${partial}@example.test`,
            job_title: "Consultant",
            employment_type: "FullTime",
            start_date: "2026-01-15",
          },
        })
      ).status,
    ).toBe("applied");
    const result = await db.transaction((tx) =>
      computeBalance(tx, w.principals.hr!, partial, "Annual", "2026-01-31"),
    );
    // PK's actual initial calendar includes half-day Saturdays: 13.5 of 24.5.
    expect(result?.entitledYtd).toBeCloseTo(((14 / 12) * 13.5) / 24.5);
  });
});

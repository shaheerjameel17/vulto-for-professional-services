import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { mutationDerivedId } from "@vulto/schema";
import { closeDatabase, db } from "../db.js";
import {
  getNode,
  getNodes,
  incoming,
  insertEdge,
  insertNode,
  outgoing,
} from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);

const NOW = "2026-06-01T09:30:00.000Z";

async function world() {
  const fixture = await makeWorkspace({ hr: ["hr-admin"] });
  const principals = {} as Record<
    "owner" | "hr",
    NonNullable<Awaited<ReturnType<typeof resolveMemberPrincipal>>>
  >;
  for (const name of ["owner", "hr"] as const) {
    principals[name] = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, {
        workspaceId: fixture.workspaceId,
        userId: fixture.people[name]!.userId,
      }),
    ))!;
  }
  const skillId = randomUUID();
  const projectId = randomUUID();
  await db.transaction(async (tx) => {
    await insertNode(tx, nodeRecord("Skill", fixture.workspaceId, skillId));
    await insertNode(tx, {
      ...nodeRecord("Project", fixture.workspaceId, projectId),
      lifecycle_status: "Active",
      name: "Ghost project",
    });
  });
  const apply = (
    who: keyof typeof principals,
    name: string,
    args: unknown,
    mutationId = randomUUID(),
    now = NOW,
  ) =>
    applyMutation(
      principals[who],
      { mutation_id: mutationId, name, args },
      { now: () => now },
    );
  return { ...fixture, principals, skillId, projectId, apply };
}

async function createGhost(w: Awaited<ReturnType<typeof world>>) {
  const mutationId = randomUUID();
  const result = await w.apply(
    "hr",
    "ghostResource.create",
    {
      role_title: "Senior React Developer",
      projected_start_date: "2026-06-15",
      seniority_level: "Senior",
      target_skill_ids: [w.skillId],
      expected_rate: 1_200,
    },
    mutationId,
  );
  expect(result.status, JSON.stringify(result)).toBe("applied");
  return result.result as { ghostId: string; employeeId: string };
}

const promotion = (overrides: Record<string, unknown> = {}) => ({
  employee_code: "E-GHOST-1",
  full_name: "Amina Khan",
  email: "amina@example.test",
  employment_type: "FullTime",
  start_date: "2026-06-22",
  ...overrides,
});

describe("VRS-F007 — Ghost Resources", () => {
  it("creates the exact two-node record and identical skill edge atomically", async () => {
    const w = await world();
    const ids = await createGhost(w);
    const [ghost, employee, skills] = await db.transaction(async (tx) => [
      await getNode(tx, w.workspaceId, ids.ghostId),
      await getNode(tx, w.workspaceId, ids.employeeId),
      await outgoing(tx, w.workspaceId, ids.employeeId, "has_skill"),
    ]);
    expect(ghost?.record).toMatchObject({
      ghost_employee_id: ids.employeeId,
      notes: null,
    });
    expect(employee?.record).toMatchObject({
      employee_type: "Ghost",
      employee_code: null,
      full_name: null,
      email: null,
      employment_type: null,
      contracted_hours: 40,
      job_title: "Senior React Developer",
      start_date: "2026-06-15",
      seniority_level: "Senior",
      billing_rate_default: 1_200,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      fromNodeId: ids.employeeId,
      toNodeId: w.skillId,
      edgeType: "has_skill",
    });

    const failingMutation = randomUUID();
    const collision = mutationDerivedId(failingMutation, 10);
    await db.transaction(async (tx) => {
      await insertEdge(tx, w.workspaceId, {
        ...edgeRecord("has_skill", ids.employeeId, w.skillId),
        edge_id: collision,
      });
    });
    const failed = await w.apply(
      "hr",
      "ghostResource.create",
      {
        role_title: "Rollback role",
        projected_start_date: "2026-07-01",
        target_skill_ids: [w.skillId],
      },
      failingMutation,
    );
    expect(failed).toMatchObject({
      status: "rejected",
      reason: "constraint-violation",
    });
    expect(
      await db.transaction((tx) => getNode(tx, w.workspaceId, failingMutation)),
    ).toBeNull();
    expect(
      await db.transaction((tx) =>
        getNode(tx, w.workspaceId, mutationDerivedId(failingMutation, 1)),
      ),
    ).toBeNull();
  });

  it("relinks OpenRole with exactly one active edge and cancels version-first", async () => {
    const w = await world();
    const ids = await createGhost(w);
    const roles = [randomUUID(), randomUUID()];
    await db.transaction(async (tx) => {
      for (const id of roles)
        await insertNode(tx, nodeRecord("OpenRole", w.workspaceId, id));
    });
    for (const [index, id] of roles.entries()) {
      expect(
        (
          await w.apply(
            "hr",
            "ghostResource.linkOpenRole",
            {
              ghost_id: ids.ghostId,
              open_role_id: id,
            },
            randomUUID(),
            `2026-06-01T09:30:0${index + 1}.000Z`,
          )
        ).status,
      ).toBe("applied");
    }
    const links = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, ids.ghostId, "placeholder_for"),
    );
    expect(links.filter((edge) => edge.effectiveTo === null)).toHaveLength(1);
    expect(links.find((edge) => edge.effectiveTo === null)?.toNodeId).toBe(roles[1]);
    expect(
      (
        await w.apply("hr", "ghostResource.cancel", {
          ghost_id: ids.ghostId,
          expected_version: 99,
        })
      ).reason,
    ).toBe("stale-state");
    expect(
      (
        await w.apply("hr", "ghostResource.cancel", {
          ghost_id: ids.ghostId,
          expected_version: 1,
        })
      ).status,
    ).toBe("applied");
  });

  it("promotes in place, preserves every Assignment and skill edge, and enforces uniqueness", async () => {
    const w = await world();
    const ids = await createGhost(w);
    const entity = (
      await db.transaction((tx) =>
        getNodes(tx, w.workspaceId, {
          nodeType: "Entity",
          lifecycleStatus: "Active",
        }),
      )
    )[0]!;
    await db.transaction((tx) =>
      insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("scoped_to_entity", ids.employeeId, entity.nodeId, NOW),
      ),
    );
    const assignment = await w.apply("hr", "assignment.create", {
      employee_id: ids.employeeId,
      project_id: w.projectId,
      start_date: "2027-07-01",
      end_date: "2027-07-31",
      billable_percentage: 80,
    });
    expect(assignment.status, JSON.stringify(assignment)).toBe("applied");
    const before = await db.transaction(async (tx) => ({
      skills: await outgoing(tx, w.workspaceId, ids.employeeId, "has_skill"),
      assignments: await incoming(tx, w.workspaceId, ids.employeeId, "assignment_of"),
    }));
    const promoted = await w.apply("hr", "ghostResource.promote", {
      ghost_id: ids.ghostId,
      expected_version: 1,
      details: promotion({ contracted_hours: 32 }),
    });
    expect(promoted.status, JSON.stringify(promoted)).toBe("applied");
    expect(promoted.result).toMatchObject({ status: "promoted" });
    const after = await db.transaction(async (tx) => ({
      ghost: await getNode(tx, w.workspaceId, ids.ghostId),
      employee: await getNode(tx, w.workspaceId, ids.employeeId),
      skills: await outgoing(tx, w.workspaceId, ids.employeeId, "has_skill"),
      assignments: await incoming(tx, w.workspaceId, ids.employeeId, "assignment_of"),
      promoted: await outgoing(tx, w.workspaceId, ids.ghostId, "promoted_to"),
    }));
    expect(after.ghost?.lifecycleStatus).toBe("Promoted");
    expect(after.employee?.record).toMatchObject({
      employee_type: "Employee",
      employee_code: "E-GHOST-1",
      full_name: "Amina Khan",
      email: "amina@example.test",
      employment_type: "FullTime",
      start_date: "2026-06-22",
      contracted_hours: 32,
    });
    expect(after.skills).toEqual(before.skills);
    expect(after.assignments).toEqual(before.assignments);
    expect(after.promoted).toHaveLength(1);

    const other = await createGhost(w);
    expect(
      (
        await w.apply("hr", "ghostResource.promote", {
          ghost_id: other.ghostId,
          expected_version: 1,
          details: promotion({ email: "other@example.test" }),
        })
      ).reason,
    ).toBe("duplicate-code");
  });

  it("allows exactly one concurrent promotion and names the winner and time", async () => {
    const w = await world();
    const ids = await createGhost(w);
    const [a, b] = await Promise.all([
      w.apply("owner", "ghostResource.promote", {
        ghost_id: ids.ghostId,
        expected_version: 1,
        details: promotion({ employee_code: "E-RACE-A", email: "a@example.test" }),
      }),
      w.apply("hr", "ghostResource.promote", {
        ghost_id: ids.ghostId,
        expected_version: 1,
        details: promotion({ employee_code: "E-RACE-B", email: "b@example.test" }),
      }),
    ]);
    const winner = [a, b].find((result) => result.status === "applied");
    const loser = [a, b].find((result) => result.status === "rejected");
    expect(winner).toBeDefined();
    expect(loser?.reason).toContain("already-promoted:actor=");
    expect(loser?.reason).toContain(`:at=${NOW}`);
    expect(
      [w.people.owner!.userId, w.people.hr!.userId].some((id) =>
        loser?.reason?.includes(id),
      ),
    ).toBe(true);
  });

  it("rolls back a failure after both promotion updates and distinguishes stale causes", async () => {
    const w = await world();
    const ids = await createGhost(w);
    const mutationId = randomUUID();
    await db.transaction((tx) =>
      insertEdge(tx, w.workspaceId, {
        ...edgeRecord("has_skill", ids.employeeId, w.skillId),
        edge_id: mutationId,
      }),
    );
    const failed = await w.apply(
      "hr",
      "ghostResource.promote",
      {
        ghost_id: ids.ghostId,
        expected_version: 1,
        details: promotion({ employee_code: "E-ROLLBACK" }),
      },
      mutationId,
    );
    expect(failed).toMatchObject({
      status: "rejected",
      reason: "constraint-violation",
    });
    const [ghost, employee, links] = await db.transaction(async (tx) => [
      await getNode(tx, w.workspaceId, ids.ghostId),
      await getNode(tx, w.workspaceId, ids.employeeId),
      await outgoing(tx, w.workspaceId, ids.ghostId, "promoted_to"),
    ]);
    expect(ghost?.lifecycleStatus).toBe("Active");
    expect(employee?.record).toMatchObject({
      employee_type: "Ghost",
      employee_code: null,
      full_name: null,
    });
    expect(links).toHaveLength(0);

    expect(
      (
        await w.apply("hr", "ghostResource.promote", {
          ghost_id: ids.ghostId,
          expected_version: 99,
          details: promotion({ employee_code: "E-STALE" }),
        })
      ).reason,
    ).toBe("stale-state");
    expect(
      (
        await w.apply("hr", "ghostResource.promote", {
          ghost_id: ids.ghostId,
          expected_version: 1,
          details: { existing_employee_id: randomUUID() },
        })
      ).reason,
    ).toBe("existing-employee-not-yet-supported");
  });
});

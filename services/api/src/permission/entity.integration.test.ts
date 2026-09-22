import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../db.js";
import { resolveForEmployee } from "../graph/entity-resolution.js";
import { getEdge, getNode, getNodes } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { decideRead } from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { isManager } from "./roles.js";
import { makeWorkspace } from "./test-support.js";

afterAll(closeDatabase);

const T0 = "2026-01-01T00:00:00.000Z";
const MARCH = "2026-03-01T00:00:00.000Z";
const FEBRUARY = "2026-02-01T00:00:00.000Z";
const APRIL = "2026-04-01T00:00:00.000Z";

async function world() {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    finance: ["finance-admin"],
    boss: ["team-member"],
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
  const [founding] = await db.transaction((tx) =>
    getNodes(tx, fixture.workspaceId, {
      nodeType: "Entity",
      lifecycleStatus: "Active",
    }),
  );
  expect(founding).toBeDefined();
  const apply = (who: string, name: string, args: unknown) =>
    applyMutation(principals[who]!, { mutation_id: randomUUID(), name, args });
  return { ...fixture, principals, founding: founding!, apply };
}

async function createEntity(
  w: Awaited<ReturnType<typeof world>>,
  jurisdiction: string,
  name: string,
) {
  const result = await w.apply("owner", "entity.create", {
    name,
    jurisdiction,
    default_currency: jurisdiction === "UK" ? "GBP" : "PKR",
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  return (result.result as { entity_id: string }).entity_id;
}

async function createEmployee(w: Awaited<ReturnType<typeof world>>, entityId: string) {
  const employeeId = randomUUID();
  const created = await w.apply("hr", "employee.create", {
    employee_id: employeeId,
    entity_id: entityId,
    effective_from: T0,
    fields: {
      employee_code: `E-${employeeId}`,
      full_name: "Transfer Example",
      email: `${employeeId}@example.test`,
      job_title: "Consultant",
      employment_type: "FullTime",
      start_date: "2026-01-01",
    },
  });
  expect(created.status, JSON.stringify(created)).toBe("applied");
  return {
    employeeId,
    originalEdgeId: (created.result as { edge_id: string }).edge_id,
  };
}

describe("VRS-F003 — Entity mutations and temporal resolution", () => {
  it("creates and updates through the interceptor; refuses read-only roles and invalid input", async () => {
    const w = await world();
    expect(
      (
        await w.apply("owner", "entity.create", {
          name: "Invalid",
          jurisdiction: "UAE",
          default_currency: "USD",
        })
      ).reason,
    ).toBe("invalid-args");
    expect(
      (
        await w.apply("owner", "entity.create", {
          name: "Invalid",
          jurisdiction: "UK",
          default_currency: "ZZZ",
        })
      ).reason,
    ).toBe("invalid-args");
    expect(
      (
        await w.apply("team", "entity.create", {
          name: "Denied",
          jurisdiction: "UK",
          default_currency: "GBP",
        })
      ).status,
    ).toBe("rejected");
    const entityId = await createEntity(w, "UK", "UK Ltd");
    const updated = await w.apply("hr", "entity.update", {
      entity_id: entityId,
      fields: { legal_name: "UK Legal Ltd", registered_address: "London" },
    });
    expect(updated.status).toBe("applied");
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, entityId)))?.record,
    ).toMatchObject({
      name: "UK Ltd",
      legal_name: "UK Legal Ltd",
      registered_address: "London",
      jurisdiction: "UK",
      default_currency: "GBP",
    });
    const denied = await w.apply("finance", "entity.update", {
      entity_id: entityId,
      fields: { name: "Unauthorized" },
    });
    expect(denied.status).toBe("rejected");
  });

  it("gives Owner and HR Admin Full, and Finance Admin, Manager and Team Member Read on an Entity", async () => {
    const w = await world();
    const boss = await createEmployee(w, w.founding.nodeId);
    const report = await createEmployee(w, w.founding.nodeId);
    for (const [name, employee] of [
      ["boss", boss],
      ["report", report],
    ] as const) {
      expect(
        (
          await w.apply("owner", "employee.linkUser", {
            employee_id: employee.employeeId,
            user_id: w.people[name]!.userId,
            expected_version: 1,
          })
        ).status,
      ).toBe("applied");
    }
    expect(
      (
        await w.apply("owner", "org.moveEmployee", {
          employee_id: report.employeeId,
          new_manager_id: boss.employeeId,
          effective_from: FEBRUARY,
        })
      ).status,
    ).toBe("applied");
    expect(await db.transaction((tx) => isManager(tx, w.principals.boss!))).toBe(true);
    for (const [who, expected] of [
      ["owner", "full"],
      ["hr", "full"],
      ["finance", "read"],
      ["boss", "read"],
      ["team", "read"],
    ] as const) {
      const decision = await db.transaction((tx) =>
        decideRead(tx, w.principals[who]!, {
          workspaceId: w.workspaceId,
          nodeType: "Entity",
          nodeId: w.founding.nodeId,
        }),
      );
      expect(decision.access).toBe(expected);
    }
  });

  it("rejects a stale version before the deactivation business rules", async () => {
    const w = await world();
    expect(
      (
        await w.apply("owner", "entity.deactivate", {
          entity_id: w.founding.nodeId,
          expected_version: 999,
        })
      ).reason,
    ).toBe("stale-state");
  });

  it("refuses deactivation of the sole Active Entity even with zero employees", async () => {
    const w = await world();
    expect(
      (
        await w.apply("owner", "entity.deactivate", {
          entity_id: w.founding.nodeId,
          expected_version: 1,
        })
      ).reason,
    ).toBe("last-active-entity");
  });

  it("refuses deactivation while an Active employee remains scoped", async () => {
    const w = await world();
    const ukId = await createEntity(w, "UK", "UK Ltd");
    await createEmployee(w, ukId);
    expect(
      (
        await w.apply("owner", "entity.deactivate", {
          entity_id: ukId,
          expected_version: 1,
        })
      ).reason,
    ).toBe("active-employees:1");
  });

  it("dissolves an eligible Entity and blocks generic lifecycle paths", async () => {
    const w = await world();
    const ukId = await createEntity(w, "UK", "UK Ltd");
    const pakistanId = await createEntity(w, "PK", "Pakistan Ltd");
    const dissolved = await w.apply("owner", "entity.deactivate", {
      entity_id: pakistanId,
      expected_version: 1,
    });
    expect(dissolved.status).toBe("applied");
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, pakistanId)))
        ?.lifecycleStatus,
    ).toBe("Dissolved");
    expect(
      (
        await w.apply("owner", "graph.transitionLifecycle", {
          node_id: ukId,
          to_status: "Dissolved",
          expected_version: 1,
        })
      ).reason,
    ).toBe("requires-feature-mutation");
    expect(
      (
        await w.apply("owner", "graph.updateNodeFields", {
          node_id: ukId,
          expected_version: null,
          patch: { lifecycle_status: "Dissolved" },
        })
      ).reason,
    ).toBe("requires-feature-mutation");
    expect(
      (
        await w.apply("owner", "graph.softDeleteNode", {
          node_id: ukId,
        })
      ).reason,
    ).toBe("requires-feature-mutation");
  });

  it("transfers UK to Pakistan on 1 March and preserves the original edge history", async () => {
    const w = await world();
    const ukId = await createEntity(w, "UK", "UK Ltd");
    const pakistanId = await createEntity(w, "PK", "Pakistan Ltd");
    const { employeeId, originalEdgeId } = await createEmployee(w, ukId);
    const original = await db.transaction((tx) =>
      getEdge(tx, w.workspaceId, originalEdgeId),
    );
    expect(
      (
        await db.transaction((tx) =>
          resolveForEmployee(tx, w.workspaceId, employeeId, FEBRUARY),
        )
      )?.nodeId,
    ).toBe(ukId);
    const denied = await w.apply("team", "employee.setEntity", {
      employee_id: employeeId,
      entity_id: pakistanId,
      effective_from: MARCH,
    });
    expect(denied.status).toBe("rejected");
    const moved = await w.apply("hr", "employee.setEntity", {
      employee_id: employeeId,
      entity_id: pakistanId,
      effective_from: MARCH,
    });
    expect(moved.status, JSON.stringify(moved)).toBe("applied");
    expect(
      (
        await db.transaction((tx) =>
          resolveForEmployee(tx, w.workspaceId, employeeId, FEBRUARY),
        )
      )?.nodeId,
    ).toBe(ukId);
    expect(
      (
        await db.transaction((tx) =>
          resolveForEmployee(tx, w.workspaceId, employeeId, APRIL),
        )
      )?.nodeId,
    ).toBe(pakistanId);
    const closed = await db.transaction((tx) =>
      getEdge(tx, w.workspaceId, originalEdgeId),
    );
    expect(closed?.effectiveFrom).toBe(original?.effectiveFrom);
    expect(closed?.effectiveTo).toBe(MARCH);
    expect(closed?.record["created_by"]).toBe(original?.record["created_by"]);
    expect(closed?.record["created_at"]).toBe(original?.record["created_at"]);
    await w.apply("hr", "entity.update", {
      entity_id: pakistanId,
      fields: { legal_name: "New Pakistan Legal Name" },
    });
    expect(
      await db.transaction((tx) => getEdge(tx, w.workspaceId, originalEdgeId)),
    ).toEqual(closed);
  });
});

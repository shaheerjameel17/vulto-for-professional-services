import { randomUUID } from "node:crypto";
import { __TESTING__, uuidV4Schema } from "@vulto/schema";
import { afterAll, describe, expect, it } from "vitest";
import { getKeyServices } from "../crypto/keys.js";
import { closeDatabase, db } from "../db.js";
import { getNode, getNodes, incoming, insertEdge, insertNode } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { authorizeRead } from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import {
  getRateCardPreview,
  getRateCardUsageCount,
  listRateCards,
  rateCardLineId,
  RateCardAccessDenied,
  readRateCard,
  readRateCardLine,
} from "./rate-card-queries.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);

const T0 = "2026-01-01T00:00:00.000Z";

async function world() {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    finance: ["finance-admin"],
    manager: ["team-member"],
    team: ["team-member"],
  });
  const principals = {} as Record<
    string,
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
  const apply = (
    who: string,
    name: string,
    args: unknown,
    now = T0,
    mutationId = randomUUID(),
  ) =>
    applyMutation(
      principals[who]!,
      { mutation_id: mutationId, name, args },
      { now: () => now },
    );
  const managerEmployee = randomUUID();
  const reportEmployee = randomUUID();
  await db.transaction(async (tx) => {
    await insertNode(tx, {
      ...nodeRecord("Employee", fixture.workspaceId, managerEmployee),
      user_id: fixture.people.manager!.userId,
    });
    await insertNode(tx, nodeRecord("Employee", fixture.workspaceId, reportEmployee));
    await insertEdge(
      tx,
      fixture.workspaceId,
      edgeRecord("managed_by", reportEmployee, managerEmployee),
    );
  });
  return { ...fixture, principals, apply };
}

async function createRateCard(
  w: Awaited<ReturnType<typeof world>>,
  lines: Array<{ seniority_level: string; hourly_rate: number }>,
  name = "Standard",
) {
  const result = await w.apply("finance", "rateCard.create", {
    name,
    currency: "USD",
    lines,
  });
  expect(result.status, JSON.stringify(result)).toBe("applied");
  return (result.result as { rate_card_id: string }).rate_card_id;
}

async function createEmployeeAndProject(w: Awaited<ReturnType<typeof world>>) {
  const entity = (
    await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, {
        nodeType: "Entity",
        lifecycleStatus: "Active",
      }),
    )
  )[0]!;
  const employeeId = randomUUID();
  const created = await w.apply("hr", "employee.create", {
    employee_id: employeeId,
    entity_id: entity.nodeId,
    effective_from: T0,
    fields: {
      employee_code: `E-${employeeId}`,
      full_name: "Senior Consultant",
      email: `${employeeId}@example.test`,
      job_title: "Consultant",
      employment_type: "FullTime",
      start_date: "2026-01-01",
      seniority_level: "Senior",
      billing_rate_default: 800,
    },
  });
  expect(created.status, JSON.stringify(created)).toBe("applied");
  const projectId = randomUUID();
  await db.transaction((tx) =>
    insertNode(tx, {
      ...nodeRecord("Project", w.workspaceId, projectId),
      name: "Project",
    }),
  );
  return { employeeId, projectId };
}

describe("VRS-F006 — Rate Card Engine", () => {
  it("uses deterministic line ids, replaces duplicate seniority, and point-reads previews", async () => {
    const w = await world();
    const cardId = await createRateCard(w, [
      { seniority_level: "Senior", hourly_rate: 100 },
      { seniority_level: "Senior", hourly_rate: 120 },
    ]);
    const lineId = rateCardLineId(cardId, "Senior");
    expect(uuidV4Schema.safeParse(lineId).success).toBe(true);
    expect(lineId).toBe(rateCardLineId(cardId, "Senior"));
    const lineNodes = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "RateCardLine" }),
    );
    expect(lineNodes.map((node) => node.nodeId)).toEqual([lineId]);
    const line = await db.transaction((tx) =>
      readRateCardLine(tx, getKeyServices(), w.principals.finance!, cardId, "Senior"),
    );
    expect(line).toMatchObject({
      rate_card_id: cardId,
      seniority_level: "Senior",
      hourly_rate: 120,
      daily_rate: 960,
      monthly_rate: 21_120,
    });
    await expect(
      db.transaction((tx) =>
        getRateCardPreview(
          tx,
          getKeyServices(),
          w.principals.finance!,
          cardId,
          "Senior",
        ),
      ),
    ).resolves.toEqual({ hourlyRate: 120, dailyRate: 960, monthlyRate: 21_120 });
    await expect(
      db.transaction((tx) =>
        getRateCardPreview(
          tx,
          getKeyServices(),
          w.principals.finance!,
          cardId,
          "Junior",
        ),
      ),
    ).resolves.toBeNull();
  });

  it("resolves rates atomically and maintains one active governed_by edge", async () => {
    const w = await world();
    const firstCard = await createRateCard(w, [
      { seniority_level: "Senior", hourly_rate: 120 },
    ]);
    const secondCard = await createRateCard(
      w,
      [{ seniority_level: "Senior", hourly_rate: 160 }],
      "Premium",
    );
    const fallbackCard = await createRateCard(
      w,
      [{ seniority_level: "Mid", hourly_rate: 90 }],
      "Fallback",
    );
    const { employeeId, projectId } = await createEmployeeAndProject(w);
    const created = await w.apply("owner", "assignment.create", {
      employee_id: employeeId,
      project_id: projectId,
      start_date: "2027-01-01",
      end_date: "2027-01-31",
      billable_percentage: 50,
      rate_card_id: firstCard,
    });
    expect(created.status, JSON.stringify(created)).toBe("applied");
    expect(created.result).toMatchObject({ effective_billing_rate: 120 });
    const assignmentId = (created.result as { assignment_id: string }).assignment_id;
    let assignment = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, assignmentId),
    );
    expect(assignment?.record["effective_billing_rate"]).toBe(120);
    expect(
      (
        await db.transaction((tx) =>
          incoming(tx, w.workspaceId, firstCard, "governed_by"),
        )
      ).filter((edge) => edge.effectiveTo === null),
    ).toHaveLength(1);

    let observedInsideTransaction: number | null = null;
    const overridden = await applyMutation(
      w.principals.owner!,
      {
        mutation_id: randomUUID(),
        name: "assignment.setRateOverride",
        args: { assignment_id: assignmentId, hourly: 140, reason: "Negotiated" },
      },
      {
        now: () => "2026-01-02T00:00:00.000Z",
        audience: {
          async onRowsChanged(tx) {
            observedInsideTransaction = Number(
              (await getNode(tx, w.workspaceId, assignmentId))?.record[
                "effective_billing_rate"
              ],
            );
          },
        },
      },
    );
    expect(overridden.status).toBe("applied");
    expect(observedInsideTransaction).toBe(140);

    const cleared = await w.apply("owner", "assignment.clearRateOverride", {
      assignment_id: assignmentId,
    });
    expect(cleared.result).toMatchObject({ effective_billing_rate: 120 });

    const moved = await w.apply(
      "owner",
      "assignment.setRateCard",
      { assignment_id: assignmentId, rate_card_id: secondCard },
      "2026-01-03T00:00:00.000Z",
    );
    expect(moved.result).toMatchObject({ effective_billing_rate: 160 });
    const fellBack = await w.apply(
      "owner",
      "assignment.setRateCard",
      { assignment_id: assignmentId, rate_card_id: fallbackCard },
      "2026-01-04T00:00:00.000Z",
    );
    expect(fellBack.result).toMatchObject({ effective_billing_rate: 100 });
    const allGoverned = await db.transaction((tx) =>
      Promise.all(
        [firstCard, secondCard, fallbackCard].map((card) =>
          incoming(tx, w.workspaceId, card, "governed_by"),
        ),
      ),
    );
    expect(allGoverned.flat().filter((edge) => edge.effectiveTo === null)).toHaveLength(
      1,
    );
    expect(allGoverned.flat().filter((edge) => edge.effectiveTo !== null)).toHaveLength(
      2,
    );
    await expect(
      db.transaction((tx) =>
        getRateCardUsageCount(tx, w.principals.owner!, fallbackCard),
      ),
    ).resolves.toEqual({ activeAssignments: 1 });

    assignment = await db.transaction((tx) => getNode(tx, w.workspaceId, assignmentId));
    expect(assignment?.record).toMatchObject({
      rate_card_id: fallbackCard,
      effective_billing_rate: 100,
      rate_override_hourly: null,
      rate_override_reason: null,
    });
  });

  it("versions cards, copies identity, checks stale-state first, and never reprices Assignments", async () => {
    const w = await world();
    const cardId = await createRateCard(
      w,
      [{ seniority_level: "Senior", hourly_rate: 100 }],
      "Original",
    );
    const { employeeId, projectId } = await createEmployeeAndProject(w);
    const created = await w.apply("owner", "assignment.create", {
      employee_id: employeeId,
      project_id: projectId,
      start_date: "2027-02-01",
      end_date: "2027-02-28",
      billable_percentage: 50,
      rate_card_id: cardId,
    });
    const assignmentId = (created.result as { assignment_id: string }).assignment_id;
    const before = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, assignmentId),
    );
    const updated = await w.apply("finance", "rateCard.update", {
      rate_card_id: cardId,
      expected_version: 1,
      lines: [{ seniority_level: "Senior", hourly_rate: 180 }],
    });
    expect(updated.status, JSON.stringify(updated)).toBe("applied");
    const nextId = (updated.result as { new_rate_card_id: string }).new_rate_card_id;
    expect(nextId).not.toBe(cardId);
    const [priorRecord, nextRecord, priorNode, after, supersedes] =
      await db.transaction(async (tx) =>
        Promise.all([
          readRateCard(tx, getKeyServices(), w.principals.finance!, cardId),
          readRateCard(tx, getKeyServices(), w.principals.finance!, nextId),
          getNode(tx, w.workspaceId, cardId),
          getNode(tx, w.workspaceId, assignmentId),
          incoming(tx, w.workspaceId, cardId, "supersedes"),
        ]),
      );
    expect(priorRecord).toEqual({
      name: "Original",
      currency: "USD",
      version: 1,
      supersedes_id: null,
      is_active: false,
    });
    expect(nextRecord).toEqual({
      name: "Original",
      currency: "USD",
      version: 2,
      supersedes_id: cardId,
      is_active: true,
    });
    expect(priorNode?.version).toBe(2);
    expect(supersedes).toHaveLength(1);
    expect(supersedes[0]).toMatchObject({ fromNodeId: nextId, toNodeId: cardId });
    expect(after?.record["rate_card_id"]).toBe(cardId);
    expect(after?.record["effective_billing_rate"]).toBe(
      before?.record["effective_billing_rate"],
    );

    const countBefore = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "RateCard" }),
    );
    const stale = await w.apply("finance", "rateCard.update", {
      rate_card_id: cardId,
      expected_version: 1,
      lines: [{ seniority_level: "Senior", hourly_rate: 999 }],
    });
    expect(stale).toMatchObject({ status: "rejected", reason: "stale-state" });
    const countAfter = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "RateCard" }),
    );
    expect(countAfter).toHaveLength(countBefore.length);
  });

  it("uses the Finance-restricted fallback with no matrix override", async () => {
    const w = await world();
    const cardId = await createRateCard(w, [
      { seniority_level: "Senior", hourly_rate: 100 },
    ]);
    const lineId = rateCardLineId(cardId, "Senior");
    expect(__TESTING__.MATRIX_OVERRIDES["RateCard"]).toBeUndefined();
    expect(__TESTING__.MATRIX_OVERRIDES["RateCardLine"]).toBeUndefined();
    for (const role of ["owner", "hr", "finance", "manager", "team"] as const) {
      for (const [nodeType, nodeId] of [
        ["RateCard", cardId],
        ["RateCardLine", lineId],
      ] as const) {
        const decision = await db.transaction((tx) =>
          authorizeRead(tx, w.principals[role]!, {
            workspaceId: w.workspaceId,
            nodeType,
            nodeId,
            partitionKey: "record",
          }),
        );
        expect(decision.access).toBe(
          role === "owner" || role === "hr" || role === "finance" ? "full" : "none",
        );
      }
    }
    await expect(
      db.transaction((tx) =>
        listRateCards(tx, getKeyServices(), w.principals.manager!),
      ),
    ).rejects.toBeInstanceOf(RateCardAccessDenied);
    await expect(
      db.transaction((tx) => listRateCards(tx, getKeyServices(), w.principals.team!)),
    ).rejects.toBeInstanceOf(RateCardAccessDenied);
    for (const role of ["owner", "hr", "finance"] as const) {
      await expect(
        db.transaction((tx) =>
          listRateCards(tx, getKeyServices(), w.principals[role]!),
        ),
      ).resolves.toEqual([
        expect.objectContaining({ rateCardId: cardId, name: "Standard" }),
      ]);
    }
    const denied = await w.apply("manager", "rateCard.create", {
      name: "Denied",
      currency: "USD",
      lines: [],
    });
    expect(denied.status).toBe("rejected");
  });
});

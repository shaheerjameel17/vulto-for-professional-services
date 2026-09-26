import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { leavePolicyConfigurationSchema } from "@vulto/schema";
import { closeDatabase, db } from "../db.js";
import { getNode, getNodes, insertNode, insertEdge } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import {
  previewOvertime,
  timesheetAnomalyEvaluate,
} from "../mutations/timesheet-anomaly.js";
import { appRouter } from "../router.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { authorizeRead, authorizeWrite } from "./interceptor.js";
import { makeWorkspace, nodeRecord, edgeRecord } from "./test-support.js";
import { computeBalance } from "./leave-queries.js";
import { listActiveAnomalies } from "./timesheet-anomaly-queries.js";
import { DatabaseAudienceMaterializer } from "../audience/materializer.js";
import { syncNodeAudience } from "../audience/schema.js";
import { eq } from "drizzle-orm";

afterAll(closeDatabase);
const NOW = "2026-10-05T12:00:00.000Z";
async function world(
  options: { policy?: boolean; toil?: boolean; held?: number } = {},
) {
  const w = await makeWorkspace({
    hr: ["hr-admin"],
    finance: ["finance-admin"],
    manager: ["team-member"],
    otherManager: ["team-member"],
    member: ["team-member"],
    other: ["team-member"],
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
    extra: Parameters<typeof applyMutation>[2] = {},
  ) =>
    applyMutation(
      principals[who]!,
      { mutation_id: randomUUID(), name, args },
      { now: () => NOW, interceptor: { now: () => NOW }, ...extra },
    );
  const entity = await apply(
    "owner",
    "entity.create",
    {
      name: "PK",
      jurisdiction: "PK",
      default_currency: "PKR",
    },
    {
      now: () => "2026-01-01T00:00:00.000Z",
      interceptor: { now: () => "2026-01-01T00:00:00.000Z" },
    },
  );
  expect(entity.status, JSON.stringify(entity)).toBe("applied");
  const entityId = (entity.result as { entity_id: string }).entity_id;
  const calendarId = (entity.result as { calendar_id: string }).calendar_id;
  const calendar = (await db.transaction((tx) =>
    getNode(tx, w.workspaceId, calendarId),
  ))!;
  const calendarChanged = await apply(
    "owner",
    "calendar.update",
    {
      calendar_id: calendarId,
      expected_version: calendar.version,
      working_week: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
        day,
        is_working: day <= 5,
        hours: day <= 5 ? 8 : 0,
      })),
      week_start_day: 1,
      daily_hours: 8,
    },
    {
      now: () => "2026-01-02T00:00:00.000Z",
      interceptor: { now: () => "2026-01-02T00:00:00.000Z" },
    },
  );
  expect(calendarChanged.status, JSON.stringify(calendarChanged)).toBe("applied");
  const ids: Record<string, string> = {};
  await db.transaction(async (tx) => {
    for (const name of ["manager", "otherManager", "member", "other"]) {
      const id = randomUUID();
      ids[name] = id;
      await insertNode(tx, {
        ...nodeRecord("Employee", w.workspaceId, id),
        employee_type: "Employee",
        user_id: w.people[name]!.userId,
        start_date: "2026-01-01",
        employment_type: "FullTime",
        full_name: name,
      });
      await insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("scoped_to_entity", id, entityId, "2026-01-01T00:00:00.000Z"),
      );
    }
    await insertEdge(
      tx,
      w.workspaceId,
      edgeRecord("managed_by", ids.member!, ids.manager!, "2026-01-01T00:00:00.000Z"),
    );
    await insertEdge(
      tx,
      w.workspaceId,
      edgeRecord(
        "managed_by",
        ids.other!,
        ids.otherManager!,
        "2026-01-01T00:00:00.000Z",
      ),
    );
  });
  let policyId: string | undefined;
  if (options.policy !== false) {
    const config = leavePolicyConfigurationSchema.parse({
      name: "TOIL policy",
      jurisdiction: "PK",
      employment_type_scope: "All",
      leave_types: [
        {
          leave_type: options.toil === false ? "Annual" : "TOIL",
          accrual_method: options.toil === false ? "Annual" : "Earned",
          annual_entitlement_days: 0,
        },
      ],
    });
    const created = await apply("hr", "leavePolicy.create", config);
    expect(created.status, JSON.stringify(created)).toBe("applied");
    policyId = (created.result as { policy_id: string }).policy_id;
  }
  for (const date of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]) {
    const saved = await apply("member", "timesheet.saveCell", {
      employee_id: ids.member!,
      date,
      row_context: { kind: "non-billable" },
      internal_category: "Admin",
      hours: 15,
    });
    expect(saved.status, JSON.stringify(saved)).toBe("applied");
  }
  const submitted = await apply("member", "timesheet.submitWeek", {
    employee_id: ids.member!,
    week_start_date: "2026-09-28",
  });
  expect(submitted.status, JSON.stringify(submitted)).toBe("applied");
  await timesheetAnomalyEvaluate(w.workspaceId, ids.member!, "2026-09-28", NOW);
  const flags = await db.transaction((tx) =>
    listActiveAnomalies(tx, principals.manager!, w.workspaceId, { now: () => NOW }),
  );
  const flag = flags.find((f) => f.flag_reason === "HoursExceedExpected")!;
  expect(flag).toBeDefined();
  // The 130% detector does not create a flag at 48/40. A prior flag remains
  // for manager review after a real unlock/correction/resubmission to 48.
  expect(
    (
      await apply("owner", "timesheet.unlockWeek", {
        employee_id: ids.member!,
        week_start_date: "2026-09-28",
      })
    ).status,
  ).toBe("applied");
  for (const date of ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]) {
    expect(
      (
        await apply("member", "timesheet.saveCell", {
          employee_id: ids.member!,
          date,
          row_context: { kind: "non-billable" },
          internal_category: "Admin",
          hours: 12,
        })
      ).status,
    ).toBe("applied");
  }
  expect(
    (
      await apply("member", "timesheet.submitWeek", {
        employee_id: ids.member!,
        week_start_date: "2026-09-28",
      })
    ).status,
  ).toBe("applied");
  if (options.held)
    await db.transaction((tx) =>
      insertNode(tx, {
        ...nodeRecord("LeaveLedgerEntry", w.workspaceId),
        employee_id: ids.member!,
        entry_kind: "ToilAccrual",
        leave_type: "TOIL",
        days: options.held,
        effective_date: "2026-10-01",
        expires_on: "2026-12-30",
        policy_id: policyId!,
        source_flag_id: randomUUID(),
      }),
    );
  const ledger = () =>
    db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "LeaveLedgerEntry" }),
    );
  const preview = () =>
    db.transaction((tx) => previewOvertime(tx, principals.manager!, flag.flagId, NOW));
  const clear = (
    args: Record<string, unknown> = {},
    extra: Parameters<typeof applyMutation>[2] = {},
  ) =>
    apply(
      "manager",
      "timesheetAnomaly.clear",
      { flag_id: flag.flagId, outcome: "ApprovedOvertime", ...args },
      extra,
    );
  return { ...w, principals, ids, policyId, flag, ledger, preview, clear, apply };
}

describe("VRS-F018 real TOIL clearance", () => {
  it("previews, atomically grants one day for 48 of 40, repeats stale, expires and preserves re-flag exemption", async () => {
    const w = await world();
    expect(await w.preview()).toEqual({ toil_days_accrued: 1, reason: "accrued" });
    expect(await w.ledger()).toHaveLength(0);
    expect(await w.clear({ acknowledged_toil_days: 2 })).toMatchObject({
      status: "rejected",
      reason: "stale-state",
    });
    expect(await w.ledger()).toHaveLength(0);
    expect(await w.clear({ acknowledged_toil_days: 1 })).toMatchObject({
      status: "applied",
      result: { success: true, toil_days_accrued: 1, reason: "accrued" },
    });
    const entries = await w.ledger();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.record).toMatchObject({
      days: 1,
      employee_id: w.ids.member,
      policy_id: w.policyId,
      effective_date: "2026-10-05",
      expires_on: "2027-01-03",
      source_flag_id: w.flag.flagId,
    });
    expect(await w.clear()).toMatchObject({
      status: "rejected",
      reason: "stale-state",
    });
    expect(await w.ledger()).toHaveLength(1);
    await timesheetAnomalyEvaluate(w.workspaceId, w.ids.member!, "2026-09-28", NOW);
    const active = await db.transaction((tx) =>
      listActiveAnomalies(tx, w.principals.manager!, w.workspaceId, { now: () => NOW }),
    );
    expect(active.some((f) => f.flag_reason === "HoursExceedExpected")).toBe(false);
    for (const [date, remaining] of [
      ["2026-10-05", 1],
      ["2027-01-03", 0],
    ] as const)
      expect(
        (
          await db.transaction((tx) =>
            computeBalance(tx, w.principals.member!, w.ids.member!, "TOIL", date),
          )
        )?.remaining,
      ).toBe(remaining);
  });
  it("measures preview and TOIL balance p95 over twenty server calls", async () => {
    const w = await world();
    expect((await w.clear()).status).toBe("applied");
    const times: number[] = [],
      balances: number[] = [];
    for (let i = 0; i < 20; i++) {
      let start = performance.now();
      await w.preview();
      times.push(performance.now() - start);
      start = performance.now();
      await db.transaction((tx) =>
        computeBalance(tx, w.principals.member!, w.ids.member!, "TOIL", "2026-10-05"),
      );
      balances.push(performance.now() - start);
    }
    const p95 = (values: number[]) =>
      values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
    console.info(
      `STAGE28_P95 preview_ms=${p95(times)} balance_ms=${p95(balances)} samples=20 employees=4 policies=1 ledger=1 submitted_entries=4`,
    );
  }, 20_000);
  it("scopes reads and sync audience to own, direct report and workspace-wide readers, never permits member writes", async () => {
    const w = await world();
    await w.clear();
    const [entry] = await w.ledger();
    await db.transaction(async (tx) => {
      for (const who of Object.keys(w.principals)) {
        const readable = ["owner", "hr", "finance", "manager", "member"].includes(who);
        const target = {
          workspaceId: w.workspaceId,
          nodeType: "LeaveLedgerEntry" as const,
          nodeId: entry!.nodeId,
        };
        const read = await authorizeRead(tx, w.principals[who]!, target, {
          now: () => NOW,
        });
        expect(read.access, who).toBe(readable ? "read" : "none");
        for (const operation of ["create", "update", "remove"] as const)
          expect(
            await authorizeWrite(
              tx,
              w.principals[who]!,
              { ...target, kind: "node", partitionKey: "record" },
              { operation },
              { now: () => NOW },
            ),
          ).toMatchObject({ allowed: false, reason: "role" });
      }
      await new DatabaseAudienceMaterializer({
        interceptor: { now: () => NOW },
      }).onRowsChanged(tx, [entry!.nodeId]);
      const audience = await tx
        .select()
        .from(syncNodeAudience)
        .where(eq(syncNodeAudience.nodeId, entry!.nodeId));
      expect(audience.map((row) => row.userId).sort()).toEqual(
        ["owner", "hr", "finance", "manager", "member"]
          .map((who) => w.people[who]!.userId)
          .sort(),
      );
      expect(
        (
          await authorizeRead(
            tx,
            w.principals.member!,
            {
              workspaceId: w.workspaceId,
              nodeType: "TimesheetAnomalyFlag",
              nodeId: w.flag.flagId,
            },
            { now: () => NOW },
          )
        ).access,
      ).not.toBe("read");
    });
    for (const who of Object.keys(w.principals))
      for (const [name, args] of [
        ["graph.createNode", { node: { ...entry!.record, node_id: randomUUID() } }],
        [
          "graph.updateNodeFields",
          {
            node_id: entry!.nodeId,
            expected_version: entry!.version,
            patch: { days: 99 },
          },
        ],
        ["graph.softDeleteNode", { node_id: entry!.nodeId }],
        [
          "graph.transitionLifecycle",
          {
            node_id: entry!.nodeId,
            to_status: "Inactive",
            expected_version: entry!.version,
          },
        ],
      ] as const)
        expect(await w.apply(who, name, args)).toMatchObject({
          status: "rejected",
          reason: "role",
        });
    for (const who of Object.keys(w.principals)) {
      let applied = false;
      expect(
        await w.apply(
          who,
          "timesheetAnomaly.clear",
          { flag_id: w.flag.flagId, outcome: "ApprovedOvertime" },
          {
            implementationOverride: async () => ({
              checks: [
                {
                  target: {
                    kind: "node",
                    workspaceId: w.workspaceId,
                    nodeType: "LeaveLedgerEntry",
                    nodeId: entry!.nodeId,
                    partitionKey: "record",
                  },
                  change: { operation: "update" },
                },
              ],
              async validate() {},
              async apply() {
                applied = true;
                return { result: {}, changedRowIds: [] };
              },
            }),
          },
        ),
      ).toMatchObject({ status: "rejected", reason: "role" });
      expect(applied).toBe(false);
    }
    expect((await w.ledger())[0]!.record).toEqual(entry!.record);
    const caller = appRouter.createCaller({
      principal: w.principals.member!,
      schemaVersion: 1,
      claimedWorkspaceId: w.workspaceId,
      res: { header() {} },
    });
    await expect(caller.overtime.preview({ flag_id: w.flag.flagId })).rejects.toThrow(
      "not-found",
    );
    await expect(caller.overtime.preview({ flag_id: randomUUID() })).rejects.toThrow(
      "not-found",
    );
  });
  it("caps ten held days at zero while approving and exempting", async () => {
    const w = await world({ held: 10 });
    expect(await w.preview()).toEqual({
      toil_days_accrued: 0,
      capped_at: 10,
      reason: "capped",
    });
    expect(await w.clear()).toMatchObject({
      status: "applied",
      result: { toil_days_accrued: 0, reason: "capped" },
    });
    expect(await w.ledger()).toHaveLength(1);
    await timesheetAnomalyEvaluate(w.workspaceId, w.ids.member!, "2026-09-28", NOW);
    expect(
      (
        await db.transaction((tx) =>
          listActiveAnomalies(tx, w.principals.manager!, w.workspaceId, {
            now: () => NOW,
          }),
        )
      ).some((f) => f.flag_reason === "HoursExceedExpected"),
    ).toBe(false);
  });
  it("prices clearance with the policy version effective that day, not a future version", async () => {
    const w = await world();
    const old = (await db.transaction((tx) =>
      getNode(tx, w.workspaceId, w.policyId!),
    ))!;
    const updated = await w.apply("hr", "leavePolicy.update", {
      policy_id: w.policyId!,
      expected_version: old.version,
      effective_from: "2026-11-01",
      leave_types: old.record["leave_types"],
      overtime_policy: {
        requires_pre_approval: false,
        toil_accrual_rate: 7,
        toil_expiry_days: 1,
        toil_max_accrued_days: 10,
      },
    });
    expect(updated.status, JSON.stringify(updated)).toBe("applied");
    expect(await w.preview()).toEqual({ toil_days_accrued: 1, reason: "accrued" });
    expect(await w.clear()).toMatchObject({
      status: "applied",
      result: { toil_days_accrued: 1 },
    });
    expect((await w.ledger())[0]!.record).toMatchObject({
      policy_id: w.policyId,
      days: 1,
      expires_on: "2027-01-03",
    });
  });
  it("serializes two concurrent clearances to one entry and one stale refusal", async () => {
    const w = await world();
    const results = await Promise.all([w.clear(), w.clear()]);
    expect(results.filter((result) => result.status === "applied")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: "stale-state" }),
    ]);
    expect(await w.ledger()).toHaveLength(1);
  });
  it.each([
    { policy: false, reason: "no-policy" },
    { toil: false, reason: "no-toil-type" },
  ])("approves and exempts zero accrual for $reason", async (options) => {
    const w = await world(options);
    expect(await w.clear()).toMatchObject({
      status: "applied",
      result: { toil_days_accrued: 0, reason: options.reason },
    });
    expect(await w.ledger()).toHaveLength(0);
    await timesheetAnomalyEvaluate(w.workspaceId, w.ids.member!, "2026-09-28", NOW);
    expect(
      (
        await db.transaction((tx) =>
          listActiveAnomalies(tx, w.principals.manager!, w.workspaceId, {
            now: () => NOW,
          }),
        )
      ).some((f) => f.flag_reason === "HoursExceedExpected"),
    ).toBe(false);
  });
  it("rolls back both cleared flag and ledger after a forced post-write failure", async () => {
    const w = await world();
    const before = await db.transaction((tx) =>
      getNode(tx, w.workspaceId, w.flag.flagId),
    );
    await expect(
      w.clear(
        {},
        {
          audience: {
            async onRowsChanged(tx, rows) {
              expect(rows).toHaveLength(2);
              expect(
                await getNodes(tx, w.workspaceId, { nodeType: "LeaveLedgerEntry" }),
              ).toHaveLength(1);
              throw new Error("forced-after-flag-and-ledger");
            },
          },
        },
      ),
    ).rejects.toThrow("forced-after-flag-and-ledger");
    expect(await w.ledger()).toHaveLength(0);
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, w.flag.flagId)))?.record,
    ).toEqual(before?.record);
    expect(await w.clear()).toMatchObject({
      status: "applied",
      result: { toil_days_accrued: 1 },
    });
  });
});

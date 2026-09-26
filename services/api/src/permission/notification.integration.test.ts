import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, db } from "../db.js";
import {
  getNode,
  getNodes,
  getEdge,
  insertNode,
  insertEdge,
  updateNodeFields,
} from "../graph/store.js";
import { syncNodeAudience } from "../audience/schema.js";
import { audienceMaterializer } from "../audience/materializer.js";
import { applyMutation, type PipelineDependencies } from "../mutations/pipeline.js";
import {
  withNotificationDelivery,
  deliverForRows,
} from "../mutations/notification-delivery.js";
import { decideRead } from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";
import { appRouter } from "../router.js";
import type { MemberPrincipal } from "./principal.js";

afterAll(closeDatabase);
const JAN = "2026-01-01T12:00:00.000Z";
async function world() {
  const w = await makeWorkspace({
    hr: ["hr-admin"],
    member: ["team-member"],
    manager: ["team-member"],
    otherManager: ["team-member"],
    finance: ["finance-admin"],
  });
  const principals: Record<string, MemberPrincipal> = {};
  for (const [name, person] of Object.entries(w.people))
    principals[name] = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, { workspaceId: w.workspaceId, userId: person.userId }),
    ))!;
  const ids: Record<string, string> = {};
  const entityResult = await applyMutation(
    principals.owner!,
    {
      mutation_id: randomUUID(),
      name: "entity.create",
      args: {
        name: "Notification entity",
        jurisdiction: "Global",
        default_currency: "USD",
      },
    },
    { now: () => JAN },
  );
  expect(entityResult.status, JSON.stringify(entityResult)).toBe("applied");
  const entityId = (entityResult.result as { entity_id: string }).entity_id;
  const projectId = randomUUID();
  await db.transaction(async (tx) => {
    await insertNode(tx, {
      ...nodeRecord("Project", w.workspaceId, projectId),
      name: "Notification project",
    });
    for (const [name, person] of Object.entries(w.people)) {
      const id = randomUUID();
      ids[name] = id;
      await insertNode(tx, {
        ...nodeRecord("Employee", w.workspaceId, id),
        employee_type: "Employee",
        full_name: `Person ${name}`,
        user_id: person.userId,
        job_title: "Consultant",
        employment_type: "FullTime",
        start_date: "2026-01-01",
      });
      await insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("scoped_to_entity", id, entityId, JAN),
      );
    }
    await insertEdge(
      tx,
      w.workspaceId,
      edgeRecord("managed_by", ids.member!, ids.manager!, JAN),
    );
    await insertEdge(
      tx,
      w.workspaceId,
      edgeRecord("managed_by", ids.finance!, ids.otherManager!, JAN),
    );
  });
  const apply = (
    who: string,
    name: string,
    args: unknown,
    now = JAN,
    dependencies: PipelineDependencies = {},
  ) =>
    applyMutation(
      principals[who]!,
      { mutation_id: randomUUID(), name, args },
      { now: () => now, interceptor: { now: () => now }, ...dependencies },
    );
  const notifications = () =>
    db.transaction((tx) => getNodes(tx, w.workspaceId, { nodeType: "Notification" }));
  return { ...w, ids, principals, projectId, apply, notifications };
}

async function privacy(
  w: Awaited<ReturnType<typeof world>>,
  nodeId: string,
  recipient: string,
) {
  await db.transaction(async (tx) => {
    for (const [name, principal] of Object.entries(w.principals)) {
      const decision = await decideRead(tx, principal, {
        workspaceId: w.workspaceId,
        nodeId,
        nodeType: "Notification",
        partitionKey: "record",
      });
      expect(decision.access, name).toBe(name === recipient ? "full" : "none");
      const audience = await tx
        .select()
        .from(syncNodeAudience)
        .where(
          and(
            eq(syncNodeAudience.workspaceId, w.workspaceId),
            eq(syncNodeAudience.nodeId, nodeId),
            eq(syncNodeAudience.userId, principal.userId),
          ),
        );
      expect(audience, name).toHaveLength(name === recipient ? 1 : 0);
    }
  });
}

describe("VPS-F003 notification delivery and recipient mutations", () => {
  it("delivers once per severity through real assignment changes, and concurrently deduplicates", async () => {
    const w = await world();
    const created = await w.apply("hr", "assignment.create", {
      employee_id: w.ids.member,
      project_id: w.projectId,
      start_date: "2026-01-01",
      end_date: "2026-01-02",
      billable_percentage: 100,
    });
    expect(created.status, JSON.stringify(created)).toBe("applied");
    const assignmentId = (created.result as { assignment_id: string }).assignment_id;
    for (const [day, startDate, expected] of [
      ["09", "2026-01-02", 1],
      ["16", "2026-01-01", 2],
      ["23", "2026-01-02", 3],
    ] as const) {
      const result = await w.apply(
        "hr",
        "assignment.update",
        { assignment_id: assignmentId, fields: { start_date: startDate } },
        `2026-01-${day}T12:00:00.000Z`,
      );
      expect(result.status, JSON.stringify(result)).toBe("applied");
      expect(await w.notifications()).toHaveLength(expected);
    }
    const rows = await w.notifications();
    expect(
      rows.map((row) => String(row.record["dedupe_key"]).split(":").at(-1)).sort(),
    ).toEqual(["High", "Low", "Medium"]);
    for (const row of rows) {
      expect(row.record["message"]).toContain("Person member");
      await privacy(w, row.nodeId, "manager");
    }
    // A repeated logged write exercises dedupe without handing the engine an id.
    const alertId = String(rows[0]!.record["source_node_id"]);
    await Promise.all(
      [1, 2].map(() =>
        withNotificationDelivery(() =>
          db.transaction((tx) =>
            updateNodeFields(tx, w.workspaceId, alertId, null, { bench_days: 15 }),
          ),
        ),
      ),
    );
    expect(await w.notifications()).toHaveLength(3);
    const freshId = randomUUID();
    await db.transaction(async (tx) => {
      const source = (await getNode(tx, w.workspaceId, alertId))!;
      await insertNode(tx, { ...source.record, node_id: freshId, alert_id: freshId });
    });
    await Promise.all(
      [1, 2].map(() =>
        withNotificationDelivery(() =>
          db.transaction((tx) =>
            updateNodeFields(tx, w.workspaceId, freshId, null, { bench_days: 15 }),
          ),
        ),
      ),
    );
    expect(
      (await w.notifications()).filter(
        (row) => row.record["source_node_id"] === freshId,
      ),
    ).toHaveLength(1);
  });

  it("delivers a timesheet anomaly through submitWeek without exposing protected flag details", async () => {
    const w = await world();
    for (const day of [5, 6, 7, 8, 9]) {
      const saved = await w.apply(
        "member",
        "timesheet.saveCell",
        {
          employee_id: w.ids.member,
          date: `2026-01-0${day}`,
          row_context: { kind: "non-billable" },
          internal_category: "Admin",
          hours: 12,
        },
        "2026-01-12T12:00:00.000Z",
      );
      expect(saved.status, JSON.stringify(saved)).toBe("applied");
    }
    const submitted = await w.apply(
      "member",
      "timesheet.submitWeek",
      { employee_id: w.ids.member, week_start_date: "2026-01-05" },
      "2026-01-12T12:00:00.000Z",
    );
    expect(submitted.status, JSON.stringify(submitted)).toBe("applied");
    const rows = (await w.notifications()).filter(
      (row) => row.record["rule_id"] === "timesheet-anomaly-flag",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.record["message"]).toBe("Person member's timesheet needs review.");
      await privacy(w, row.nodeId, "manager");
    }
  });

  it("covers the standalone revenueGapAlert.sweep through the actual tRPC caller", async () => {
    const w = await world();
    const caller = appRouter.createCaller({
      principal: w.principals.owner!,
      schemaVersion: 1,
      claimedWorkspaceId: w.workspaceId,
      res: { header() {} },
    });
    await caller.revenueGapAlert.sweep({ workspace_id: w.workspaceId });
    const rows = (await w.notifications()).filter(
      (row) =>
        row.record["source_node_id"] &&
        row.record["recipient_user_id"] === w.people.manager!.userId,
    );
    expect(rows).toHaveLength(1);
    await privacy(w, rows[0]!.nodeId, "manager");
  });

  it("isolates an injected delivery failure from the committed source", async () => {
    const w = await world();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await w.apply(
      "owner",
      "graph.createNode",
      {
        node: {
          node_id: randomUUID(),
          node_type: "Client",
          schema_version: 1,
          lifecycle_status: "Active",
          name: "Committed",
        },
      },
      JAN,
      {
        notificationDeliveryOverride: async () => {
          throw new Error("injected");
        },
      },
    );
    expect(result.status, JSON.stringify(result)).toBe("applied");
    expect(
      (
        await db.transaction((tx) =>
          getNodes(tx, w.workspaceId, { nodeType: "Client" }),
        )
      ).some((row) => row.record["name"] === "Committed"),
    ).toBe(true);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("keeps read-state own-only and idempotent, and closes every generic write path", async () => {
    const w = await world();
    const seed = async (who: string) => {
      const nodeId = randomUUID();
      const edge = edgeRecord("delivered_to", nodeId, w.people[who]!.userId, JAN);
      await db.transaction(async (tx) => {
        await insertNode(tx, {
          ...nodeRecord("Notification", w.workspaceId, nodeId),
          recipient_user_id: w.people[who]!.userId,
          source_node_type: "Employee",
          source_node_id: w.ids.member,
          rule_id: "fixture",
          dedupe_key: nodeId,
          category: "ActionNeeded",
          message: "Fixture",
          read_at: null,
          dismissed_at: null,
        });
        await insertEdge(tx, w.workspaceId, edge);
        await audienceMaterializer.onRowsChanged(tx, [nodeId, edge.edge_id]);
      });
      return { nodeId, edge };
    };
    const own = await seed("manager"),
      foreign = await seed("member"),
      unread = await seed("manager");
    const before = await db.transaction((tx) => getNode(tx, w.workspaceId, own.nodeId));
    const createId = randomUUID();
    const newEdge = edgeRecord("delivered_to", own.nodeId, w.people.owner!.userId, JAN);
    for (const [name, args] of [
      ["graph.createNode", { node: { ...before!.record, node_id: createId } }],
      ["graph.createEdge", { edge: newEdge }],
      [
        "graph.closeEdge",
        { edge_id: own.edge.edge_id, effective_to: "2026-02-01T00:00:00.000Z" },
      ],
      [
        "graph.updateEdgeMetadata",
        { edge_id: own.edge.edge_id, metadata: { redirected: true } },
      ],
    ] as const) {
      const result = await w.apply("manager", name, args);
      expect(result.status).toBe("rejected");
      expect(["role", "requires-feature-mutation"]).toContain(result.reason);
      console.info(`Notification generic refusal ${name}: ${result.reason}`);
    }
    expect(
      await db.transaction((tx) => getNode(tx, w.workspaceId, createId)),
    ).toBeNull();
    expect(
      await db.transaction((tx) => getEdge(tx, w.workspaceId, newEdge.edge_id)),
    ).toBeNull();
    expect(
      (await db.transaction((tx) => getEdge(tx, w.workspaceId, own.edge.edge_id)))
        ?.record,
    ).toEqual(own.edge);
    for (const [name, args] of [
      [
        "graph.updateNodeFields",
        { node_id: own.nodeId, expected_version: null, patch: { message: "Changed" } },
      ],
      ["graph.softDeleteNode", { node_id: own.nodeId }],
      [
        "graph.transitionLifecycle",
        {
          node_id: own.nodeId,
          expected_version: before!.version,
          to_status: "Inactive",
        },
      ],
    ] as const)
      expect(await w.apply("manager", name, args)).toMatchObject({
        status: "rejected",
        reason: "requires-feature-mutation",
      });
    expect(
      await db.transaction((tx) => getNode(tx, w.workspaceId, own.nodeId)),
    ).toEqual(before);
    for (const name of ["notification.markRead", "notification.dismiss"]) {
      const foreignResult = await w.apply("manager", name, {
        notification_id: foreign.nodeId,
      });
      const missing = await w.apply("manager", name, { notification_id: randomUUID() });
      expect(foreignResult).toMatchObject({
        status: "rejected",
        reason: missing.reason,
      });
      expect(
        await w.apply("manager", name, {
          notification_id: own.nodeId,
          message: "Illegal",
        }),
      ).toMatchObject({ status: "rejected" });
      expect(
        (await w.apply("manager", name, { notification_id: own.nodeId })).status,
      ).toBe("applied");
      const first = await db.transaction((tx) =>
        getNode(tx, w.workspaceId, own.nodeId),
      );
      expect(
        (await w.apply("manager", name, { notification_id: own.nodeId })).status,
      ).toBe("applied");
      expect(
        await db.transaction((tx) => getNode(tx, w.workspaceId, own.nodeId)),
      ).toEqual(first);
      expect(first!.record["message"]).toBe("Fixture");
    }
    expect((await w.apply("manager", "notification.markAllRead", {})).status).toBe(
      "applied",
    );
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, unread.nodeId)))!.record[
        "read_at"
      ],
    ).not.toBeNull();
    expect(
      (await db.transaction((tx) => getNode(tx, w.workspaceId, foreign.nodeId)))!
        .record["read_at"],
    ).toBeNull();
    await db.transaction(async (tx) => {
      const conflict = await insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("delivered_to", unread.nodeId, w.people.owner!.userId, JAN),
      );
      await audienceMaterializer.onRowsChanged(tx, [unread.nodeId, conflict.edgeId]);
    });
    await privacy(w, unread.nodeId, "nobody");
    await privacy(w, foreign.nodeId, "member");
    expect(
      (
        await db.transaction((tx) =>
          decideRead(tx, w.principals.manager!, {
            workspaceId: w.workspaceId,
            nodeId: unread.nodeId,
            nodeType: "Notification",
          }),
        )
      ).access,
    ).toBe("none");
    await db.transaction(async (tx) => {
      await updateNodeFields(tx, w.workspaceId, own.nodeId, null, {
        recipient_user_id: w.people.owner!.userId,
      });
      await audienceMaterializer.onRowsChanged(tx, [own.nodeId]);
    });
    await privacy(w, own.nodeId, "nobody");
    expect(
      (
        await db.transaction((tx) =>
          decideRead(tx, w.principals.manager!, {
            workspaceId: w.workspaceId,
            nodeId: own.nodeId,
            nodeType: "Notification",
          }),
        )
      ).access,
    ).toBe("none");
  });

  it("derives reminder send permission from policy and delivers once per UTC day to the employee only", async () => {
    const w = await world();
    const args = { week_start_date: "2026-01-05", employee_ids: [w.ids.member] };
    for (const who of ["manager", "finance", "member"]) {
      expect(
        await w.apply(who, "hrCompliance.sendReminder", {
          ...args,
          employee_ids: [w.ids[who]],
        }),
      ).toMatchObject({ status: "rejected", reason: "role" });
    }
    for (const who of ["hr", "owner"])
      expect((await w.apply(who, "hrCompliance.sendReminder", args)).status).toBe(
        "applied",
      );
    const rows = await w.notifications();
    expect(rows).toHaveLength(1);
    await privacy(w, rows[0]!.nodeId, "member");
    expect(rows[0]!.record["message"]).toBe(
      "Please submit your timesheet for the week starting 2026-01-05.",
    );
    expect(
      (
        await w.apply(
          "hr",
          "hrCompliance.sendReminder",
          args,
          "2026-01-02T00:00:00.000Z",
        )
      ).status,
    ).toBe("applied");
    expect(
      (
        await w.apply("hr", "hrCompliance.sendReminder", {
          ...args,
          week_start_date: "2026-01-06",
        })
      ).status,
    ).toBe("applied");
    expect(await w.notifications()).toHaveLength(2);
    expect(
      (
        await w.apply(
          "member",
          "timesheet.submitWeek",
          { employee_id: w.ids.member, week_start_date: "2026-01-05" },
          "2026-01-12T12:00:00.000Z",
        )
      ).status,
    ).toBe("applied");
    const submitted = await w.apply("hr", "hrCompliance.sendReminder", args);
    const absent = await w.apply("hr", "hrCompliance.sendReminder", {
      ...args,
      employee_ids: [randomUUID()],
    });
    expect(submitted).toMatchObject({ status: "rejected", reason: absent.reason });
  });

  it("counts missing-manager and unlinked-manager skips without fallback", async () => {
    const w = await world();
    await db.transaction((tx) =>
      updateNodeFields(tx, w.workspaceId, w.ids.manager!, null, { user_id: null }),
    );
    let observed: Awaited<ReturnType<typeof deliverForRows>> | undefined;
    await withNotificationDelivery(
      () =>
        db.transaction(async (tx) => {
          for (const employeeId of [w.ids.member!, w.ids.otherManager!]) {
            const id = randomUUID();
            await insertNode(tx, {
              ...nodeRecord("RevenueGapAlert", w.workspaceId, id),
              alert_id: id,
              employee_id: employeeId,
              bench_start_date: "2026-01-03",
              bench_days: 5,
              severity: "Low",
              daily_cost: 10,
              accumulated_cost: 50,
              escalated_at: null,
              dismissed_at: null,
              resolved_at: null,
              resolved_by: null,
              resolved_by_assignment_id: null,
            });
          }
        }),
      async (ids) => {
        observed = await deliverForRows(ids);
      },
    );
    expect(observed).toEqual({
      delivered: 0,
      skippedNoManager: 1,
      skippedNoLinkedUser: 1,
    });
    expect(await w.notifications()).toEqual([]);
  });
});

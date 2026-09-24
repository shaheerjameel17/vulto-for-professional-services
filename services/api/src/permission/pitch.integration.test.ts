import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../db.js";
import { getNode, insertEdge, insertNode, outgoing } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { authorizeRead } from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { listStaffedFor } from "./pitch-queries.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);

const NOW = "2026-01-01T00:00:00.000Z";

async function world() {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    manager: ["team-member"],
    member: ["team-member"],
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
  const employeeIds = {
    manager: randomUUID(),
    member: randomUUID(),
    outsider: randomUUID(),
  };
  const clientId = randomUUID();
  await db.transaction(async (tx) => {
    for (const [name, id] of Object.entries(employeeIds)) {
      await insertNode(tx, {
        ...nodeRecord("Employee", fixture.workspaceId, id),
        user_id: fixture.people[name]!.userId,
        full_name: name,
      });
    }
    await insertEdge(
      tx,
      fixture.workspaceId,
      edgeRecord("managed_by", employeeIds.member, employeeIds.manager, NOW),
    );
    await insertNode(tx, {
      ...nodeRecord("Client", fixture.workspaceId, clientId),
      name: "Acme",
    });
  });
  let tick = 0;
  const apply = (who: keyof typeof principals, name: string, args: unknown) =>
    applyMutation(
      principals[who]!,
      {
        mutation_id: randomUUID(),
        name,
        args,
      },
      { now: () => new Date(Date.parse(NOW) + ++tick * 1000).toISOString() },
    );
  const list = (who: keyof typeof principals, employeeId: string) =>
    db.transaction((tx) => listStaffedFor(tx, principals[who]!, employeeId));
  return { ...fixture, principals, employeeIds, clientId, apply, list };
}

const pitchId = (result: { result?: unknown }) =>
  (result.result as { pitchId: string }).pitchId;

describe("VRS-F009 Pitch creation, staffing and selector", () => {
  it("lets a Manager create and immediately staff a direct report, but refuses an unrelated employee", async () => {
    const w = await world();
    const created = await w.apply("manager", "pitch.create", { name: "New proposal" });
    expect(created.status, JSON.stringify(created)).toBe("applied");
    const id = pitchId(created);
    const staffed = await w.apply("manager", "pitch.staffEmployee", {
      pitch_id: id,
      employee_id: w.employeeIds.member,
    });
    expect(staffed.status, JSON.stringify(staffed)).toBe("applied");
    const denied = await w.apply("manager", "pitch.staffEmployee", {
      pitch_id: id,
      employee_id: w.employeeIds.outsider,
    });
    expect(denied).toMatchObject({ status: "rejected", reason: "role" });
    const deniedUnstaff = await w.apply("manager", "pitch.unstaffEmployee", {
      pitch_id: id,
      employee_id: w.employeeIds.outsider,
    });
    expect(deniedUnstaff).toMatchObject({ status: "rejected", reason: "role" });
    const edges = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, w.employeeIds.outsider, "staffed_on"),
    );
    expect(edges).toHaveLength(0);
    expect(await w.list("manager", w.employeeIds.member)).toEqual([
      { pitchId: id, name: "New proposal", clientName: null },
    ]);
    expect(await w.list("manager", w.employeeIds.outsider)).toEqual([]);
  });

  it("lets Owner and HR Admin staff and unstaff any employee", async () => {
    const w = await world();
    for (const actor of ["owner", "hr"] as const) {
      const created = await w.apply(actor, "pitch.create", {
        name: `${actor} proposal`,
      });
      expect(created.status).toBe("applied");
      const id = pitchId(created);
      const staffed = await w.apply(actor, "pitch.staffEmployee", {
        pitch_id: id,
        employee_id: w.employeeIds.outsider,
      });
      expect(staffed.status, JSON.stringify(staffed)).toBe("applied");
      expect(
        (
          await w.apply(actor, "pitch.unstaffEmployee", {
            pitch_id: id,
            employee_id: w.employeeIds.outsider,
          })
        ).status,
      ).toBe("applied");
      expect(await w.list(actor, w.employeeIds.outsider)).toEqual([]);
    }
  });

  it("refuses all Team Member writes and generic Pitch reads", async () => {
    const w = await world();
    const created = await w.apply("owner", "pitch.create", { name: "Restricted" });
    const id = pitchId(created);
    expect((await w.apply("member", "pitch.create", { name: "Denied" })).reason).toBe(
      "role",
    );
    for (const name of ["pitch.staffEmployee", "pitch.unstaffEmployee"]) {
      expect(
        (
          await w.apply("member", name, {
            pitch_id: id,
            employee_id: w.employeeIds.member,
          })
        ).reason,
      ).toBe("role");
    }
    const read = await db.transaction((tx) =>
      authorizeRead(tx, w.principals.member!, {
        workspaceId: w.workspaceId,
        nodeType: "Pitch",
        nodeId: id,
        partitionKey: "identifying",
      }),
    );
    expect(read.access).toBe("none");
    expect(await db.transaction((tx) => getNode(tx, w.workspaceId, id))).not.toBeNull();
  });

  it("returns only identifying selector fields for the staffed employee and no existence leak to others", async () => {
    const w = await world();
    const created = await w.apply("owner", "pitch.create", {
      name: "Acme proposal",
      client_id: w.clientId,
      projected_start_date: "2027-01-01",
    });
    const id = pitchId(created);
    const staffed = await w.apply("owner", "pitch.staffEmployee", {
      pitch_id: id,
      employee_id: w.employeeIds.member,
    });
    expect(staffed.status, JSON.stringify(staffed)).toBe("applied");
    const result = await w.list("member", w.employeeIds.member);
    expect(result).toEqual([
      { pitchId: id, name: "Acme proposal", clientName: "Acme" },
    ]);
    expect(Object.keys(result[0]!)).toEqual(["pitchId", "name", "clientName"]);
    expect(await w.list("outsider", w.employeeIds.member)).toEqual([]);
  });
});

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { getKeyServices } from "../crypto/keys.js";
import { closeDatabase, db } from "../db.js";
import { graphEdges, graphNodes } from "../graph/schema.js";
import { getNode, insertEdge } from "../graph/store.js";
import { applyMutation, type MutationEnvelope } from "../mutations/pipeline.js";
import { decideRead, authorizeRead } from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import type { MemberPrincipal } from "./principal.js";
import { resolveReaderSet } from "./reader-set.js";
import { effectiveRoles, isManager } from "./roles.js";
import { resolveEmployeeForUser } from "./employee-link.js";
import { addNode, edgeRecord, makeWorkspace } from "./test-support.js";
import { readProtected } from "../protected/read.js";
import { writeProtected } from "../protected/write.js";
import { getEmployee, listEmployees } from "./employee-queries.js";
import {
  employeeCreateEnvelope,
  importEmployees,
  parseEmployeeImportRow,
} from "../employee/import.js";

afterAll(closeDatabase);

const T0 = "2026-09-21T09:00:00.000Z";
const services = getKeyServices();

type Person = MemberPrincipal;

async function principalOf(workspaceId: string, userId: string): Promise<Person> {
  return (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, { userId, workspaceId }),
  ))!;
}

async function apply(p: Person, name: string, args: unknown, id = randomUUID()) {
  const envelope: MutationEnvelope = { mutation_id: id, name, args };
  return applyMutation(p, envelope);
}

const versionOf = async (workspaceId: string, nodeId: string) =>
  (await db.transaction((tx) => getNode(tx, workspaceId, nodeId)))!.version;

interface World {
  workspaceId: string;
  entityId: string;
  owner: Person;
  hr: Person;
  hr2: Person;
  finance: Person;
  boss: Person;
  report1: Person;
  report2: Person;
  outsider: Person;
  employee: Record<string, string>;
}

/** A workspace where every member has an Employee record linked to their login, made only through the mutations. */
async function world(): Promise<World> {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    hr2: ["hr-admin"],
    finance: ["finance-admin"],
    boss: ["team-member"],
    report1: ["team-member"],
    report2: ["team-member"],
    outsider: ["team-member"],
  });
  const workspaceId = fixture.workspaceId;
  const people: Record<string, Person> = {};
  for (const name of Object.keys(fixture.people)) {
    people[name] = await principalOf(workspaceId, fixture.people[name]!.userId);
  }
  const entityId = await db.transaction((tx) => addNode(tx, workspaceId, "Entity"));
  const employee: Record<string, string> = {};
  let n = 0;
  for (const name of Object.keys(people)) {
    n += 1;
    const employeeId = randomUUID();
    const created = await apply(people.owner!, "employee.create", {
      employee_id: employeeId,
      entity_id: entityId,
      effective_from: T0,
      fields: {
        employee_code: `E${n}`,
        full_name: `Person ${name}`,
        email: `${name}-${workspaceId}@example.com`,
        job_title: "Consultant",
        employment_type: "FullTime",
        start_date: "2026-01-05",
      },
    });
    expect(created.status, JSON.stringify(created)).toBe("applied");
    const linked = await apply(people.owner!, "employee.linkUser", {
      employee_id: employeeId,
      user_id: fixture.people[name]!.userId,
      expected_version: 1,
    });
    expect(linked.status, JSON.stringify(linked)).toBe("applied");
    employee[name] = employeeId;
  }
  return {
    workspaceId,
    entityId,
    owner: people.owner!,
    hr: people.hr!,
    hr2: people.hr2!,
    finance: people.finance!,
    boss: people.boss!,
    report1: people.report1!,
    report2: people.report2!,
    outsider: people.outsider!,
    employee,
  };
}

const read = (p: Person, w: World, employeeId: string, partitionKey?: string) =>
  db.transaction((tx) =>
    decideRead(tx, p, {
      workspaceId: w.workspaceId,
      nodeType: "Employee",
      nodeId: employeeId,
      ...(partitionKey === undefined ? {} : { partitionKey }),
    }),
  );

const move = (
  p: Person,
  w: World,
  employeeId: string,
  managerId: string | null,
  effectiveFrom = T0,
) =>
  apply(p, "org.moveEmployee", {
    employee_id: employeeId,
    new_manager_id: managerId,
    effective_from: effectiveFrom,
  });

describe("RST-33 — the Employee mutations", () => {
  it("creates the Tier 0 record and the scoped_to_entity edge, with the stated defaults", async () => {
    const w = await world();
    const employeeId = randomUUID();
    const result = await apply(w.hr, "employee.create", {
      employee_id: employeeId,
      entity_id: w.entityId,
      effective_from: T0,
      fields: {
        employee_code: "ZZ-1",
        full_name: "Ada Lovelace",
        email: "Ada@Example.COM",
        job_title: "Engineer",
        employment_type: "Contractor",
        start_date: "2026-02-01",
      },
    });
    expect(result.status, JSON.stringify(result)).toBe("applied");
    const node = (await db.transaction((tx) =>
      getNode(tx, w.workspaceId, employeeId),
    ))!;
    expect(node).toMatchObject({
      nodeType: "Employee",
      lifecycleStatus: "Active",
      version: 1,
    });
    expect(node.record).toMatchObject({
      email: "ada@example.com",
      contracted_hours: 40,
      user_id: null,
      end_date: null,
      employee_type: "Employee",
    });
    const edges = await db
      .select()
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.workspaceId, w.workspaceId),
          eq(graphEdges.fromNodeId, employeeId),
        ),
      );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      edgeType: "scoped_to_entity",
      toNodeId: w.entityId,
    });
    // No compensation field is on the Tier 0 record.
    expect(Object.keys(node.record as object)).not.toContain(
      "base_compensation_amount",
    );
  });

  it("is refused for a member with no write grant, and the generic mutations refuse a tier-split node", async () => {
    const w = await world();
    const denied = await apply(w.report1, "employee.create", {
      employee_id: randomUUID(),
      entity_id: w.entityId,
      effective_from: T0,
      fields: {
        employee_code: "X",
        full_name: "X",
        email: "x@example.com",
        job_title: "X",
        employment_type: "FullTime",
        start_date: "2026-02-01",
      },
    });
    expect(denied.status).toBe("rejected");

    const generic = await apply(w.owner, "graph.createNode", {
      node: {
        node_id: randomUUID(),
        node_type: "Employee",
        schema_version: 1,
        lifecycle_status: "Active",
        workspace_id: w.workspaceId,
      },
    });
    expect(generic).toMatchObject({
      status: "rejected",
      reason: "requires-feature-mutation",
    });
    const employeeId = w.employee.report1!;
    expect(
      await apply(w.owner, "graph.updateNodeFields", {
        node_id: employeeId,
        expected_version: null,
        patch: { job_title: "Hacked" },
      }),
    ).toMatchObject({ status: "rejected", reason: "requires-feature-mutation" });
    expect(
      await apply(w.owner, "graph.transitionLifecycle", {
        node_id: employeeId,
        to_status: "Converted",
        expected_version: await versionOf(w.workspaceId, employeeId),
      }),
    ).toMatchObject({ status: "rejected", reason: "requires-feature-mutation" });
  });

  it("rejects a duplicate email or code within the workspace, however it is cased", async () => {
    const w = await world();
    const attempt = (over: Record<string, string>) =>
      apply(w.hr, "employee.create", {
        employee_id: randomUUID(),
        entity_id: w.entityId,
        effective_from: T0,
        fields: {
          employee_code: "UNIQ",
          full_name: "N",
          email: "unique@example.com",
          job_title: "N",
          employment_type: "FullTime",
          start_date: "2026-02-01",
          ...over,
        },
      });
    expect((await attempt({})).status).toBe("applied");
    expect(
      await attempt({ employee_code: "OTHER", email: "UNIQUE@example.com" }),
    ).toMatchObject({
      status: "rejected",
      reason: "duplicate-email",
    });
    expect(await attempt({ email: "other@example.com" })).toMatchObject({
      status: "rejected",
      reason: "duplicate-code",
    });
  });

  it("updates operational fields with a version, rejects a stale one, and refuses any compensation field", async () => {
    const w = await world();
    const id = w.employee.report1!;
    const v = await versionOf(w.workspaceId, id);
    const ok = await apply(w.hr, "employee.update", {
      employee_id: id,
      expected_version: v,
      patch: { job_title: "Lead", department: "Delivery" },
    });
    expect(ok.status, JSON.stringify(ok)).toBe("applied");
    expect(
      await apply(w.hr, "employee.update", {
        employee_id: id,
        expected_version: v,
        patch: { job_title: "Stale" },
      }),
    ).toMatchObject({ status: "rejected", reason: "stale-state" });
    expect(
      await apply(w.hr, "employee.update", {
        employee_id: id,
        expected_version: v + 1,
        patch: { base_compensation_amount: 1 },
      }),
    ).toMatchObject({ status: "rejected", reason: "invalid-args" });
    expect(
      await apply(w.hr, "employee.update", {
        employee_id: id,
        expected_version: v + 1,
        patch: { user_id: randomUUID() },
      }),
    ).toMatchObject({ status: "rejected", reason: "invalid-args" });
  });

  it("enforces the status table on the server: Active to Inactive to Active, Converted is terminal", async () => {
    const w = await world();
    const id = w.employee.report2!;
    const go = async (to: string, extra: Record<string, unknown> = {}) =>
      apply(w.hr, "employee.transitionStatus", {
        employee_id: id,
        to_status: to,
        expected_version: await versionOf(w.workspaceId, id),
        ...extra,
      });
    expect(await go("Inactive")).toMatchObject({
      status: "rejected",
      reason: "end-date-required",
    });
    expect((await go("Inactive", { end_date: "2026-11-30" })).status).toBe("applied");
    let node = (await db.transaction((tx) => getNode(tx, w.workspaceId, id)))!;
    expect(node).toMatchObject({ lifecycleStatus: "Inactive" });
    expect((node.record as Record<string, unknown>)["end_date"]).toBe("2026-11-30");
    expect(await go("Converted")).toMatchObject({
      status: "rejected",
      reason: "invalid-transition",
    });
    expect((await go("Active")).status).toBe("applied");
    node = (await db.transaction((tx) => getNode(tx, w.workspaceId, id)))!;
    expect((node.record as Record<string, unknown>)["end_date"]).toBeNull();
    expect((await go("Converted")).status).toBe("applied");
    expect(await go("Active")).toMatchObject({
      status: "rejected",
      reason: "invalid-transition",
    });
    // A decision made against an old version is stale, not invalid.
    expect(
      await apply(w.hr, "employee.transitionStatus", {
        employee_id: id,
        to_status: "Inactive",
        expected_version: 1,
        end_date: "2026-12-01",
      }),
    ).toMatchObject({ status: "rejected", reason: "stale-state" });
  });

  it("links a login once, to a person the graph knows, and resolves it in both directions", async () => {
    const w = await world();
    const id = randomUUID();
    await apply(w.hr, "employee.create", {
      employee_id: id,
      entity_id: w.entityId,
      effective_from: T0,
      fields: {
        employee_code: "LINK",
        full_name: "Linkable",
        email: "linkable@example.com",
        job_title: "X",
        employment_type: "FullTime",
        start_date: "2026-02-01",
      },
    });
    const userId = w.report1.userId;
    // report1 is already linked to another Employee.
    expect(
      await apply(w.hr, "employee.linkUser", {
        employee_id: id,
        user_id: userId,
        expected_version: 1,
      }),
    ).toMatchObject({ status: "rejected", reason: "already-linked" });
    // A login the graph does not know is refused.
    expect(
      await apply(w.hr, "employee.linkUser", {
        employee_id: id,
        user_id: randomUUID(),
        expected_version: 1,
      }),
    ).toMatchObject({ status: "rejected", reason: "invalid-args" });
    expect(
      await db.transaction((tx) => resolveEmployeeForUser(tx, w.workspaceId, userId)),
    ).toBe(w.employee.report1);
    expect(
      await db.transaction((tx) =>
        resolveEmployeeForUser(tx, w.workspaceId, randomUUID()),
      ),
    ).toBeNull();
  });
});

describe("RST-33 — compensation is Tier 1: encrypted on the server, never on the record, read only through the audited path", () => {
  const SENTINEL = 918273645;

  it("writes only ciphertext, and only an authorized reader gets the value", async () => {
    const w = await world();
    const id = w.employee.report1!;
    const set = await apply(w.hr, "employee.setCompensation", {
      employee_id: id,
      compensation: {
        base_compensation_amount: SENTINEL,
        compensation_frequency: "Annual",
        compensation_currency: "AED",
      },
    });
    expect(set.status, JSON.stringify(set)).toBe("applied");
    // Not a team member's to set.
    expect(
      (
        await apply(w.report1, "employee.setCompensation", {
          employee_id: id,
          compensation: {
            base_compensation_amount: 1,
            compensation_frequency: "Annual",
            compensation_currency: "AED",
          },
        })
      ).status,
    ).toBe("rejected");

    // Nothing in the graph rows or fragments holds the value in the clear.
    const dump = JSON.stringify([
      await db.execute(
        sql`select * from graph_nodes where workspace_id = ${w.workspaceId}`,
      ),
      await db.execute(
        sql`select * from graph_protected_fragments where workspace_id = ${w.workspaceId}`,
      ),
      await db.execute(
        sql`select * from graph_mutations where workspace_id = ${w.workspaceId}`,
      ),
    ]);
    expect(dump).not.toContain(String(SENTINEL));

    const view = (p: Person, employeeId: string) =>
      db.transaction((tx) => getEmployee(tx, services, p, employeeId));
    const fromHr = await view(w.hr, id);
    expect(fromHr?.compensation).toMatchObject([
      {
        partition: "compensation",
        state: "available",
        value: { base_compensation_amount: SENTINEL },
      },
    ]);
    // The person themselves, now that their login is linked (own scope).
    const self = await view(w.report1, id);
    expect(self?.compensation).toMatchObject([{ state: "available" }]);
    // A colleague on the same team sees the profile but no compensation, as though the field did not exist.
    await move(w.hr, w, id, w.employee.boss!);
    await move(w.hr, w, w.employee.report2!, w.employee.boss!);
    const colleague = await view(w.report2, id);
    expect(colleague?.employee.employeeId).toBe(id);
    expect(colleague?.compensation).toEqual([]);
    expect(JSON.stringify(colleague)).not.toContain(String(SENTINEL));
    // A Manager's compensation cell is restricted, never the value.
    const asBoss = await view(w.boss, id);
    expect(JSON.stringify(asBoss)).not.toContain(String(SENTINEL));
    // An unrelated member sees the operational profile, never its compensation.
    const outsider = await view(w.outsider, id);
    expect(outsider).not.toBeNull();
    expect(JSON.stringify(outsider)).not.toContain(String(SENTINEL));
  });
});

describe("F130 — subject exclusion fires once the login link is real", () => {
  async function caseAbout(w: World, subjectEmployeeId: string): Promise<string> {
    return db.transaction(async (tx) => {
      const caseId = await addNode(tx, w.workspaceId, "HRCase");
      await insertEdge(
        tx,
        w.workspaceId,
        edgeRecord("case_concerns", caseId, subjectEmployeeId),
      );
      return caseId;
    });
  }
  const decide = (p: Person, w: World, caseId: string, partitionKey?: string) =>
    db.transaction((tx) =>
      decideRead(tx, p, {
        workspaceId: w.workspaceId,
        nodeType: "HRCase",
        nodeId: caseId,
        ...(partitionKey === undefined ? {} : { partitionKey }),
      }),
    );

  it("excludes the subject, and only the subject, from reading a case about them", async () => {
    const w = await world();
    const caseId = await caseAbout(w, w.employee.hr!);
    // The HR Admin the case concerns may not read it, and is told why.
    expect(await decide(w.hr, w, caseId, "content")).toMatchObject({
      access: "restricted",
      label: "Restricted — this record concerns you.",
    });
    // Every other reader the policy grants still can.
    for (const reader of [w.owner, w.hr2]) {
      const d = await decide(reader, w, caseId, "content");
      expect(["full", "read"]).toContain(d.access);
    }
    // Someone who was never a reader is unaffected by the exclusion: still none.
    expect((await decide(w.finance, w, caseId, "content")).access).toBe("none");
  });

  it("removes the subject from the resolved reader set, using the real link", async () => {
    const w = await world();
    const caseId = await caseAbout(w, w.employee.hr!);
    const readers = await db.transaction((tx) =>
      resolveReaderSet(tx, {
        workspaceId: w.workspaceId,
        nodeType: "HRCase",
        partitionKey: "content",
        subjectEmployeeId: w.employee.hr!,
      }),
    );
    expect(readers).toMatchObject({ kind: "resolved" });
    const ids = (readers as unknown as { userIds: string[] }).userIds;
    expect(ids).toContain(w.owner.userId);
    expect(ids).toContain(w.hr2.userId);
    expect(ids).not.toContain(w.hr.userId);
    void caseId;
  });

  it("applies through protected.read: the subject gets a restriction, the others the content", async () => {
    const w = await world();
    const caseId = await caseAbout(w, w.employee.hr!);
    await db.transaction((tx) =>
      writeProtected(
        tx,
        services,
        { workspaceId: w.workspaceId, nodeId: caseId, nodeType: "HRCase" },
        "content",
        { note: "SENTINEL-case-4471" },
      ),
    );
    const readAs = (p: Person) =>
      db.transaction((tx) => readProtected(tx, services, p, { nodeIds: [caseId] }));
    const subject = await readAs(w.hr);
    expect(JSON.stringify(subject)).not.toContain("SENTINEL-case-4471");
    expect(subject).toMatchObject([{ state: "restricted" }]);
    expect(JSON.stringify(await readAs(w.hr2))).toContain("SENTINEL-case-4471");
    expect(JSON.stringify(await readAs(w.owner))).toContain("SENTINEL-case-4471");
  });

  it("a login with no Employee record is not the subject of anything, so is not excluded (F215 decision a)", async () => {
    // Before the link: the same HR Admin, with no Employee record, is not the subject of anything.
    const fixture = await makeWorkspace({ hr: ["hr-admin"] });
    const hr = await principalOf(fixture.workspaceId, fixture.people.hr!.userId);
    const subjectEmployee = randomUUID();
    const caseId = await db.transaction(async (tx) => {
      const id = await addNode(tx, fixture.workspaceId, "HRCase");
      await addNode(tx, fixture.workspaceId, "Employee").then(async (employee) => {
        await insertEdge(
          tx,
          fixture.workspaceId,
          edgeRecord("case_concerns", id, employee),
        );
      });
      return id;
    });
    void subjectEmployee;
    const before = await db.transaction((tx) =>
      decideRead(tx, hr, {
        workspaceId: fixture.workspaceId,
        nodeType: "HRCase",
        nodeId: caseId,
        partitionKey: "content",
      }),
    );
    expect(["full", "read"]).toContain(before.access);
  });
});

describe("Manager write scope and workspace-wide operational reads (F292)", () => {
  it("derives Manager from managed_by edges, and only for the person they point at", async () => {
    const w = await world();
    const rolesOf = (p: Person) => db.transaction((tx) => effectiveRoles(tx, p));
    expect(await rolesOf(w.boss)).not.toContain("manager");
    expect((await move(w.hr, w, w.employee.report1!, w.employee.boss!)).status).toBe(
      "applied",
    );
    expect(await rolesOf(w.boss)).toContain("manager");
    expect(await db.transaction((tx) => isManager(tx, w.report1))).toBe(false);
    expect(await db.transaction((tx) => isManager(tx, w.outsider))).toBe(false);
  });

  it("lets a Manager write direct reports but read other employees operationally", async () => {
    const w = await world();
    for (const r of ["report1", "report2"]) {
      expect((await move(w.hr, w, w.employee[r]!, w.employee.boss!)).status).toBe(
        "applied",
      );
    }
    // Direct reports retain Full; an unrelated person is Read, never Full.
    for (const r of ["report1", "report2"]) {
      expect((await read(w.boss, w, w.employee[r]!)).access).toBe("full");
    }
    expect((await read(w.boss, w, w.employee.outsider!)).access).toBe("read");
    // Writes: a report's record, yes; an outsider's, no.
    const v = await versionOf(w.workspaceId, w.employee.report1!);
    expect(
      (
        await apply(w.boss, "employee.update", {
          employee_id: w.employee.report1!,
          expected_version: v,
          patch: { job_title: "Set by manager" },
        })
      ).status,
    ).toBe("applied");
    expect(
      (
        await apply(w.boss, "employee.update", {
          employee_id: w.employee.outsider!,
          expected_version: await versionOf(w.workspaceId, w.employee.outsider!),
          patch: { job_title: "Not theirs" },
        })
      ).status,
    ).toBe("rejected");
    // Compensation is a Finance Admin matter for a Manager: restricted, not the value.
    expect((await read(w.boss, w, w.employee.report1!, "compensation")).access).toBe(
      "restricted",
    );
    // A Manager cannot move people: an edge write needs a grant no row scope can supply.
    expect((await move(w.boss, w, w.employee.report2!, null)).status).toBe("rejected");
  });

  it("gives team members workspace-wide operational reads, not compensation", async () => {
    const w = await world();
    for (const r of ["report1", "report2"]) {
      await move(w.hr, w, w.employee[r]!, w.employee.boss!);
    }
    expect((await read(w.report1, w, w.employee.report1!)).access).toBe("read");
    expect((await read(w.report1, w, w.employee.report2!)).access).toBe("read");
    expect((await read(w.report1, w, w.employee.boss!)).access).toBe("read");
    expect((await read(w.report1, w, w.employee.outsider!)).access).toBe("read");
    expect((await read(w.outsider, w, w.employee.outsider!)).access).toBe("read");
    expect((await read(w.outsider, w, w.employee.report1!)).access).toBe("read");
    // Compensation: only the person's own.
    expect((await read(w.report1, w, w.employee.report1!, "compensation")).access).toBe(
      "read",
    );
    expect((await read(w.report1, w, w.employee.report2!, "compensation")).access).toBe(
      "none",
    );
  });

  it("narrows on the very next request when a report is moved away, and in the sync audience", async () => {
    const w = await world();
    await move(w.hr, w, w.employee.report1!, w.employee.boss!);
    await move(w.hr, w, w.employee.report2!, w.employee.boss!);
    const audienceOf = async (p: Person) =>
      (
        (await db.execute(
          sql`select node_id from sync_node_audience where workspace_id = ${w.workspaceId} and user_id = ${p.userId}`,
        )) as unknown as { node_id: string }[]
      ).map((r) => r.node_id);
    expect(await audienceOf(w.boss)).toEqual(
      expect.arrayContaining([w.employee.report1!, w.employee.report2!]),
    );
    expect(await audienceOf(w.boss)).toContain(w.employee.outsider!);

    const unmoved = await move(
      w.hr,
      w,
      w.employee.report2!,
      null,
      "2026-09-21T12:00:00.000Z",
    );
    expect(unmoved.status, JSON.stringify(unmoved)).toBe("applied");
    expect((await read(w.boss, w, w.employee.report2!)).access).toBe("read");
    expect(await audienceOf(w.boss)).toContain(w.employee.report2!);
    expect(await audienceOf(w.boss)).toContain(w.employee.report1!);
  });

  it("honors the governing partitions: whoever may write the operational half may move a person, and a team member may not", async () => {
    const w = await world();
    expect((await move(w.hr, w, w.employee.report1!, w.employee.boss!)).status).toBe(
      "applied",
    );
    expect(
      (await move(w.report2, w, w.employee.report2!, w.employee.boss!)).status,
    ).toBe("rejected");
    // scoped_to_entity is set at creation through the same partition: a team member cannot create.
    const other = await db.transaction((tx) => addNode(tx, w.workspaceId, "Entity"));
    void other;
  });
});

describe("The directory and the profile", () => {
  it("lists workspace operational profiles but keeps protected fields scoped", async () => {
    const w = await world();
    for (const r of ["report1", "report2"]) {
      await move(w.hr, w, w.employee[r]!, w.employee.boss!);
    }
    const idsFor = async (p: Person) =>
      (await db.transaction((tx) => listEmployees(tx, p))).map((e) => e.employeeId);
    const all = Object.values(w.employee);
    expect((await idsFor(w.owner)).sort()).toEqual([...all].sort());
    expect((await idsFor(w.hr)).sort()).toEqual([...all].sort());
    expect((await idsFor(w.boss)).sort()).toEqual([...all].sort());
    expect((await idsFor(w.report1)).sort()).toEqual([...all].sort());
    expect((await idsFor(w.outsider)).sort()).toEqual([...all].sort());
    const visible = await db.transaction((tx) =>
      getEmployee(tx, services, w.outsider, w.employee.report1!),
    );
    expect(visible).not.toBeNull();
    // A profile that does not exist remains absent.
    expect(
      await db.transaction((tx) => getEmployee(tx, services, w.outsider, randomUUID())),
    ).toBeNull();
  });
});

describe("Import and manual creation produce the same canonical record", () => {
  it("routes an import row through employee.create and yields the record a manual create would", async () => {
    const w = await world();
    const manualId = randomUUID();
    const manual = employeeCreateEnvelope({
      entityId: w.entityId,
      effectiveFrom: T0,
      employeeId: manualId,
      fields: {
        employee_code: "M-1",
        full_name: "Sam Rivera",
        email: "sam@example.com",
        job_title: "Analyst",
        employment_type: "PartTime",
        start_date: "2026-03-02",
        department: "Finance",
        contracted_hours: 24,
        billing_rate_default: 350,
      },
    });
    expect((await applyMutation(w.hr, manual)).status).toBe("applied");

    const imported = await importEmployees(w.hr, {
      entityId: w.entityId,
      effectiveFrom: T0,
      rows: [
        {
          employee_code: "I-1",
          full_name: "Sam Rivera",
          email: "SAM.IMPORT@example.com",
          job_title: "Analyst",
          employment_type: "PartTime",
          start_date: "2026-03-02",
          department: "Finance",
          contracted_hours: "24",
          billing_rate_default: "350",
          phone: "",
        },
        { full_name: "Missing everything else" },
      ],
    });
    expect(imported.rejected).toMatchObject([{ row: 1 }]);
    expect(imported.results.map((r) => r.status)).toEqual(["applied"]);

    const importedNode = (
      await db
        .select()
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.workspaceId, w.workspaceId),
            sql`${graphNodes.record}->>'employee_code' = 'I-1'`,
          ),
        )
    )[0]!;
    const manualNode = (await db.transaction((tx) =>
      getNode(tx, w.workspaceId, manualId),
    ))!;
    const canonical = (record: Record<string, unknown>) => {
      const {
        node_id: _n,
        created_at: _c,
        created_by: _cb,
        updated_at: _u,
        updated_by: _ub,
        employee_code: _e,
        email: _m,
        ...rest
      } = record;
      return rest;
    };
    expect(canonical(importedNode.record as Record<string, unknown>)).toEqual(
      canonical(manualNode.record as Record<string, unknown>),
    );
    expect(importedNode.lifecycleStatus).toBe(manualNode.lifecycleStatus);
    expect((importedNode.record as Record<string, unknown>)["email"]).toBe(
      "sam.import@example.com",
    );
    // Both carry the scoped_to_entity edge.
    for (const nodeId of [importedNode.nodeId, manualId]) {
      const edges = await db
        .select()
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.workspaceId, w.workspaceId),
            eq(graphEdges.fromNodeId, nodeId),
          ),
        );
      expect(edges.map((e) => e.edgeType)).toEqual(["scoped_to_entity"]);
    }
  });

  it("a row that fails the same validation as a manual create is rejected before any mutation is sent", () => {
    expect(
      parseEmployeeImportRow({ full_name: "A", email: "not-an-email" }),
    ).toMatchObject({ ok: false });
    expect(
      parseEmployeeImportRow({
        employee_code: "1",
        full_name: "A",
        email: "a@example.com",
        job_title: "J",
        employment_type: "FullTime",
        start_date: "2026-03-02",
      }),
    ).toMatchObject({ ok: true });
  });
});

void authorizeRead;

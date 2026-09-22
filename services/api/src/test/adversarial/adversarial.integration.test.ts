import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVICE_HEADER, WORKSPACE_HEADER } from "@vulto/schema";
import { eq, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { appendAudit, listAuditEntries } from "../../audit/journal.js";
import { device, member, session, user } from "../../auth/schema.js";
import { admitWorkspaceMember } from "../../auth/workspace-session.js";
import { getKeyServices } from "../../crypto/keys.js";
import { closeDatabase, db } from "../../db.js";
import { graphMutations, graphNodes } from "../../graph/schema.js";
import { resolveMemberPrincipal } from "../../permission/member-principal.js";
import { addNode, makeWorkspace } from "../../permission/test-support.js";
import { readProtected } from "../../protected/read.js";
import { writeProtected } from "../../protected/write.js";
import { buildServer } from "../../server.js";

/**
 * FDN-54 — the adversarial suite. Each test plays a hostile or careless client
 * against the real server and Postgres and asserts the server, not the client,
 * decides. The listed attacks:
 *
 *   1. a forged `mutation_id` replay
 *   2. a principal supplied in client input
 *   3. client-supplied shape parameters
 *   4. a Tier 1 value requested by a demoted member mid-session
 *   5. a stale transition after reconnect
 *   6. an audit-append failure
 *   7. decryption attempted from a non-allowed module (arch-check)
 */

const ORIGIN = "http://localhost:3100";
const PASSWORD = "Correct horse battery staple adversarial!";
const app = await buildServer();

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await closeDatabase();
});

const upstream = vi.fn(
  async () =>
    new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json", "electric-handle": "stub" },
    }),
);
beforeAll(() => {
  vi.stubGlobal("fetch", upstream);
});

function cookieOf(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

type Role = "owner" | "hr-admin" | "finance-admin" | "team-member";

/** A signed-in person who holds `roles` in `workspaceId` (a fresh workspace when omitted). */
async function person(roles: Role[], workspaceId?: string) {
  await db.execute(sql`delete from rate_limit`);
  const email = `${randomUUID()}@example.com`;
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name: "Adversary", email, password: PASSWORD },
  });
  const signIn = await app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD },
  });
  expect(signIn.statusCode).toBe(200);
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
  const fixture = workspaceId ? null : await makeWorkspace();
  const id = workspaceId ?? fixture!.workspaceId;
  const membershipId = randomUUID();
  await admitWorkspaceMember({
    workspaceId: id,
    membershipId,
    userId: account!.id,
    roles,
    actorUserId: fixture?.people.owner?.userId ?? account!.id,
  });
  await db
    .update(session)
    .set({ activeOrganizationId: id })
    .where(eq(session.userId, account!.id));
  return {
    cookie: cookieOf(signIn),
    userId: account!.id,
    workspaceId: id,
    membershipId,
    fixture,
  };
}

const trpc = (
  cookie: string,
  procedure: string,
  body: unknown,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: "POST",
    url: `/trpc/${procedure}`,
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie,
      "x-vulto-schema-version": "1",
      ...extra,
    },
    payload: JSON.stringify(body),
  });

const genericNode = (workspaceId: string, nodeId: string = randomUUID()) => ({
  node_id: nodeId,
  node_type: "Project",
  schema_version: 1,
  lifecycle_status: "Active",
  workspace_id: workspaceId,
});

const createGenericNode = (
  workspaceId: string,
  mutationId: string = randomUUID(),
  nodeId?: string,
) => ({
  mutation_id: mutationId,
  name: "graph.createNode",
  args: { node: genericNode(workspaceId, nodeId) },
});

const results = (response: LightMyRequestResponse) =>
  (JSON.parse(response.body).result?.data ?? []) as {
    status: string;
    reason?: string;
  }[];

describe("1 — a forged mutation_id replay", () => {
  it("the same id with different args is refused and applies nothing", async () => {
    const owner = await person(["owner"]);
    const first = createGenericNode(owner.workspaceId);
    expect(
      results(
        await trpc(owner.cookie, "graph.applyMutations", { mutations: [first] }),
      )[0]?.status,
    ).toBe("applied");

    const forged = { ...first, args: { node: genericNode(owner.workspaceId) } };
    const replay = results(
      await trpc(owner.cookie, "graph.applyMutations", { mutations: [forged] }),
    )[0];
    expect(replay).toMatchObject({
      status: "rejected",
      reason: "mutation-id-conflict",
    });
    const rows = await db
      .select()
      .from(graphNodes)
      .where(eq(graphNodes.workspaceId, owner.workspaceId));
    expect(rows.filter((r) => r.nodeType === "Project")).toHaveLength(1);
  });

  it("another workspace cannot replay, or learn the outcome of, a mutation id it did not make", async () => {
    const a = await person(["owner"]);
    const b = await person(["owner"]);
    const original = createGenericNode(a.workspaceId);
    await trpc(a.cookie, "graph.applyMutations", { mutations: [original] });

    const stolen = createGenericNode(b.workspaceId, original.mutation_id);
    const attempt = results(
      await trpc(b.cookie, "graph.applyMutations", { mutations: [stolen] }),
    )[0];
    expect(attempt).toMatchObject({
      status: "rejected",
      reason: "mutation-id-conflict",
    });
    expect(JSON.stringify(attempt)).not.toContain(a.workspaceId);
    const stolenRows = await db
      .select()
      .from(graphMutations)
      .where(eq(graphMutations.mutationId, original.mutation_id));
    expect(stolenRows).toHaveLength(1);
    expect(stolenRows[0]?.workspaceId).toBe(a.workspaceId);
  });

  it("the same id with the same args is a duplicate, applied once", async () => {
    const owner = await person(["owner"]);
    const one = createGenericNode(owner.workspaceId);
    await trpc(owner.cookie, "graph.applyMutations", { mutations: [one] });
    const again = results(
      await trpc(owner.cookie, "graph.applyMutations", { mutations: [one] }),
    )[0];
    expect(again?.status).toBe("duplicate");
    const rows = await db
      .select()
      .from(graphNodes)
      .where(eq(graphNodes.nodeId, one.args.node.node_id));
    expect(rows).toHaveLength(1);
  });
});

describe("2 — a principal supplied in client input is ignored", () => {
  it("extra identity fields on the request and on a mutation change nothing about who acted", async () => {
    const teamMember = await person(["team-member"]);
    const impostor = await person(["owner"], teamMember.workspaceId);
    const mutation = {
      ...createGenericNode(teamMember.workspaceId),
      principal: { userId: impostor.userId, roles: ["owner"] },
      actor_user_id: impostor.userId,
      roles: ["owner"],
    };
    const response = await trpc(teamMember.cookie, "graph.applyMutations", {
      mutations: [mutation],
      principal: {
        userId: impostor.userId,
        workspaceId: teamMember.workspaceId,
        roles: ["owner"],
      },
      workspaceId: randomUUID(),
    });
    // Either the extra keys are refused outright or they are ignored; in no case are they believed.
    if (response.statusCode === 200) {
      const [row] = await db
        .select()
        .from(graphMutations)
        .where(eq(graphMutations.mutationId, mutation.mutation_id));
      expect(row?.actorUserId).toBe(teamMember.userId);
    } else {
      expect(response.statusCode).toBe(400);
      const rows = await db
        .select()
        .from(graphMutations)
        .where(eq(graphMutations.mutationId, mutation.mutation_id));
      expect(rows).toEqual([]);
    }
  });

  it("a member cannot raise their own roles by naming them in a protected read", async () => {
    const owner = await person(["owner"]);
    const employeeId = await db.transaction(async (tx) => {
      const id = await addNode(tx, owner.workspaceId, "Employee");
      await writeProtected(
        tx,
        getKeyServices(),
        { workspaceId: owner.workspaceId, nodeId: id, nodeType: "Employee" },
        "compensation",
        { salary: "SENTINEL-forged-roles-3301" },
      );
      return id;
    });
    const teamMember = await person(["team-member"], owner.workspaceId);
    const response = await trpc(teamMember.cookie, "protected.read", {
      node_ids: [employeeId],
      roles: ["owner", "hr-admin"],
      principal: { roles: ["owner"] },
    });
    expect(response.body).not.toContain("SENTINEL-forged-roles-3301");
  });
});

describe("3 — client-supplied shape parameters", () => {
  const shape = (
    cookie: string,
    workspaceId: string,
    deviceId: string,
    query: string,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: "GET",
      url: `/v1/shape/nodes?offset=-1${query}`,
      headers: {
        origin: ORIGIN,
        cookie,
        [WORKSPACE_HEADER]: workspaceId,
        [DEVICE_HEADER]: deviceId,
        ...headers,
      },
    });

  async function withDevice() {
    const p = await person(["team-member"]);
    const deviceId = `adv${randomUUID().replaceAll("-", "")}`;
    await db
      .insert(device)
      .values({ id: deviceId, userId: p.userId, deviceName: "d", platform: "web" });
    return { ...p, deviceId };
  }

  it("refuses every way of naming a table, a where clause, columns or params, and never reaches Electric", async () => {
    const p = await withDevice();
    upstream.mockClear();
    for (const query of [
      "&table=member",
      "&TABLE=member",
      "&where=true",
      "&Where=true",
      "&where=1%3D1",
      "&columns=record",
      "&params[1]=x",
      "&params%5B2%5D=x",
      "&params=x",
      "&subset__where=true",
      "&subset__params=%7B%7D",
      "&replica=full",
      "&secret=x",
      "&log=changes_only",
      "&handle=h&table=x",
      "&offset=-1&where=x",
    ]) {
      const response = await shape(p.cookie, p.workspaceId, p.deviceId, query);
      expect(response.statusCode, query).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("builds the upstream request itself: the client's workspace claim cannot widen it", async () => {
    const p = await withDevice();
    upstream.mockClear();
    const other = await makeWorkspace();
    const wrong = await shape(p.cookie, other.workspaceId, p.deviceId, "");
    expect(wrong.statusCode).toBe(401);
    expect(JSON.parse(wrong.body)).toEqual({ code: "access-revoked", erase: true });
    expect(upstream).not.toHaveBeenCalled();

    const right = await shape(
      p.cookie,
      p.workspaceId,
      p.deviceId,
      "&handle=h1&live=true",
    );
    expect(right.statusCode).toBe(200);
    const url = new URL(String((upstream.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("table")).toBe("graph_nodes");
    expect(url.searchParams.get("params[1]")).toBe(p.workspaceId);
    expect(url.searchParams.get("params[2]")).toBe(p.userId);
    expect(url.searchParams.get("where")).toContain("sync_node_audience");
  });
});

describe("4 — a Tier 1 value requested by a member demoted mid-session", () => {
  it("is given while the role allows it and withheld, with an audit denial, on the very next request", async () => {
    const owner = await person(["owner"]);
    const SECRET = "SENTINEL-demoted-mid-session-5512";
    const employeeId = await db.transaction(async (tx) => {
      const id = await addNode(tx, owner.workspaceId, "Employee");
      await writeProtected(
        tx,
        getKeyServices(),
        { workspaceId: owner.workspaceId, nodeId: id, nodeType: "Employee" },
        "compensation",
        { salary: SECRET },
      );
      return id;
    });
    const hr = await person(["hr-admin"], owner.workspaceId);

    const before = await trpc(hr.cookie, "protected.read", { node_ids: [employeeId] });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.body).toContain(SECRET);

    // The same session, the same cookie: only the central role row changes.
    await db
      .update(member)
      .set({ role: "team-member" })
      .where(eq(member.id, hr.membershipId));
    const denialsBefore = (await listAuditEntries(db, owner.workspaceId)).filter(
      (e) => e.event_type === "PermissionDenied",
    ).length;

    const after = await trpc(hr.cookie, "protected.read", { node_ids: [employeeId] });
    expect(after.body).not.toContain(SECRET);
    const denialsAfter = (await listAuditEntries(db, owner.workspaceId)).filter(
      (e) => e.event_type === "PermissionDenied",
    ).length;
    expect(denialsAfter).toBeGreaterThan(denialsBefore);
  });
});

describe("5 — a stale transition after reconnect", () => {
  it("a queued transition decided against an old version is rejected as stale-state and changes nothing", async () => {
    const owner = await person(["owner"]);
    const nodeId = await db.transaction((tx) =>
      addNode(tx, owner.workspaceId, "Employee"),
    );

    const transition = (to: string, version: number) => ({
      mutation_id: randomUUID(),
      name: "employee.transitionStatus",
      args: {
        employee_id: nodeId,
        to_status: to,
        expected_version: version,
        ...(to === "Inactive" ? { end_date: "2026-10-31" } : {}),
      },
    });
    // Another device moved the node on while this one was offline.
    expect(
      results(
        await trpc(owner.cookie, "graph.applyMutations", {
          mutations: [transition("Inactive", 1)],
        }),
      )[0]?.status,
    ).toBe("applied");
    // This device reconnects and uploads what it decided against version 1.
    const stale = results(
      await trpc(owner.cookie, "graph.applyMutations", {
        mutations: [transition("Converted", 1)],
      }),
    )[0];
    expect(stale).toMatchObject({ status: "rejected", reason: "stale-state" });
    const [row] = await db
      .select()
      .from(graphNodes)
      .where(eq(graphNodes.nodeId, nodeId));
    expect(row?.lifecycleStatus).toBe("Inactive");
  });
});

describe("6 — an audit-append failure withholds the data", () => {
  it("returns nothing when the audit entry for a protected read cannot be written", async () => {
    const fixture = await makeWorkspace();
    const owner = (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, {
        userId: fixture.people.owner!.userId,
        workspaceId: fixture.workspaceId,
      }),
    ))!;
    const employeeId = await db.transaction(async (tx) => {
      const id = await addNode(tx, fixture.workspaceId, "Employee");
      await writeProtected(
        tx,
        getKeyServices(),
        { workspaceId: fixture.workspaceId, nodeId: id, nodeType: "Employee" },
        "compensation",
        { salary: "SENTINEL-audit-failure-8804" },
      );
      return id;
    });
    const id = randomUUID();
    // An entry with this id and different content exists, so the read's own append conflicts.
    await db.transaction((tx) =>
      appendAudit(tx, {
        audit_entry_id: id,
        schema_version: 1,
        workspace_id: fixture.workspaceId,
        event_type: "PermissionDenied",
        operation: "NodeList",
        outcome: "Denied",
        actor_kind: "member",
        actor_user_id: randomUUID(),
        actor_membership_id: randomUUID(),
        actor_role: null,
        actor_roles: ["team-member"],
        actor_application: "VultoRoster",
        target: {
          kind: "QueryTarget",
          query_kind: "node-list",
          requested_node_type: "Employee",
          target_tier: 1,
        },
        metadata: { denial_class: "InsufficientPermission" },
        occurred_at: "2026-09-21T09:00:00.000Z",
      }),
    );
    let returned: unknown;
    await expect(
      (async () => {
        returned = await db.transaction((tx) =>
          readProtected(
            tx,
            getKeyServices(),
            owner,
            { nodeIds: [employeeId] },
            { newId: () => id },
          ),
        );
      })(),
    ).rejects.toThrow();
    expect(returned).toBeUndefined();
  });
});

describe("7 — decryption attempted from a non-allowed module", () => {
  const SCRIPT = fileURLToPath(
    new URL("../../../../../scripts/arch-check.mjs", import.meta.url),
  );
  const temps: string[] = [];
  afterEach(() => {
    for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function archCheck(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), "vulto-adv-"));
    temps.push(root);
    for (const [path, text] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    }
    return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });
  }

  it("fails the build when a route, a job or a test helper imports the decryption module", () => {
    // Specifiers are assembled at runtime so this file does not match the rule itself.
    const decrypt = ["../crypto", "decrypt.js"].join("/");
    const stub = {
      "services/api/src/crypto/decrypt.ts": "export const decryptFragment = () => 1;\n",
    };
    for (const rogue of [
      "routes/rogue.ts",
      "jobs/exporter.ts",
      "test/helper.ts",
      "sync/shape-proxy.ts",
    ]) {
      const result = archCheck({
        ...stub,
        [`services/api/src/${rogue}`]: `import { decryptFragment } from "${decrypt}";\nvoid decryptFragment;\n`,
      });
      expect(result.status, rogue).toBe(1);
    }
  });
});

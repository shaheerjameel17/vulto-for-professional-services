import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { syncNodeAudience } from "../audience/schema.js";
import {
  admitWorkspaceMember,
  revokeWorkspaceAdmission,
} from "../auth/workspace-session.js";
import { device, deviceWorkspaceRevocation, user } from "../auth/schema.js";
import { closeDatabase, db } from "../db.js";
import { makeWorkspace } from "../permission/test-support.js";
import { buildServer } from "../server.js";
import { buildUpstreamUrl, DEVICE_HEADER, WORKSPACE_HEADER } from "./shape-proxy.js";

const ORIGIN = "http://localhost:3100";
const PASSWORD = "Correct horse battery staple 60!";
const app = await buildServer();

const LIVE = process.env["ELECTRIC_LIVE_TESTS"] === "1";

// Unless the run is against real Electric, the upstream is a stand-in that always answers 200.
beforeAll(() => {
  if (LIVE) return;
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", "electric-handle": "stub" },
      }),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await closeDatabase();
});

function cookieHeader(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

/** A signed-in HR Admin of a fresh workspace, with a registered device. */
async function signedInMember() {
  await db.execute(sql`delete from rate_limit`);
  const email = `${randomUUID()}@example.com`;
  await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name: "Avery Stone", email, password: PASSWORD },
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
  const fixture = await makeWorkspace();
  const membershipId = randomUUID();
  await admitWorkspaceMember({
    workspaceId: fixture.workspaceId,
    membershipId,
    userId: account!.id,
    roles: ["hr-admin"],
    actorUserId: fixture.people.owner!.userId,
  });
  const deviceId = `device-${randomUUID()}`.replaceAll("-", "").slice(0, 32);
  await db.insert(device).values({
    id: deviceId,
    userId: account!.id,
    deviceName: "Test device",
    platform: "web",
  });
  return {
    cookie: cookieHeader(signIn),
    userId: account!.id,
    workspaceId: fixture.workspaceId,
    membershipId,
    deviceId,
    ownerUserId: fixture.people.owner!.userId,
  };
}

type Person = Awaited<ReturnType<typeof signedInMember>>;

const shape = (
  person: Person,
  template: string,
  query = "",
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: "GET",
    url: `/v1/shape/${template}?offset=-1${query}`,
    headers: {
      origin: ORIGIN,
      cookie: person.cookie,
      [WORKSPACE_HEADER]: person.workspaceId,
      [DEVICE_HEADER]: person.deviceId,
      ...headers,
    },
  });

describe("A003-T72 — the proxy decides every shape parameter", () => {
  const config = { electricUrl: "http://electric.test", electricSecret: "s3cret" };

  it("builds the two fixed templates from the verified identity and adds the secret server-side", () => {
    const workspaceId = randomUUID();
    const userId = randomUUID();
    const nodes = buildUpstreamUrl(
      "nodes",
      workspaceId,
      userId,
      { offset: "-1", handle: "h" },
      config,
    );
    expect(nodes.searchParams.get("table")).toBe("graph_nodes");
    expect(nodes.searchParams.get("where")).toBe(
      "workspace_id = $1 AND node_id IN (SELECT node_id FROM sync_node_audience WHERE workspace_id = $1 AND user_id = $2)",
    );
    expect(nodes.searchParams.get("params[1]")).toBe(workspaceId);
    expect(nodes.searchParams.get("params[2]")).toBe(userId);
    expect(nodes.searchParams.get("secret")).toBe("s3cret");
    expect(nodes.searchParams.get("offset")).toBe("-1");
    const edges = buildUpstreamUrl("edges", workspaceId, userId, {}, config);
    expect(edges.searchParams.get("table")).toBe("graph_edges");
    expect(edges.searchParams.get("where")).toContain("sync_edge_audience");
  });

  it("refuses a client-supplied table, where, columns or params, and any parameter that is not protocol", async () => {
    const person = await signedInMember();
    for (const query of [
      "&table=member",
      "&where=true",
      "&columns=record",
      "&params[1]=x",
      "&params=x",
      "&replica=full",
      "&subset__where=true",
      "&log=changes_only",
      "&secret=x",
    ]) {
      const response = await shape(person, "nodes", query);
      expect(response.statusCode, query).toBe(400);
      expect(JSON.parse(response.body).code).toBe("invalid-shape-parameter");
    }
  });

  it("accepts the client's default log=full and forwards it", async () => {
    const person = await signedInMember();
    expect((await shape(person, "nodes", "&log=full")).statusCode).toBe(200);
  });

  it("serves only the nodes and edges templates", async () => {
    const person = await signedInMember();
    for (const template of ["members", "graph_nodes", "audit_journal"]) {
      expect((await shape(person, template)).statusCode, template).toBe(404);
    }
  });

  it("requires a session", async () => {
    const person = await signedInMember();
    const anonymous = await app.inject({
      method: "GET",
      url: "/v1/shape/nodes?offset=-1",
    });
    expect(anonymous.statusCode).toBe(401);
    expect(JSON.parse(anonymous.body)).toEqual({ code: "unauthenticated" });
    expect((await shape(person, "nodes")).statusCode).toBe(200);
  });
});

describe("A003-T67 — a revoked device or a removed member is told to erase", () => {
  it("returns access-revoked with erase for a removed member", async () => {
    const person = await signedInMember();
    expect((await shape(person, "nodes")).statusCode).toBe(200);
    await revokeWorkspaceAdmission(person.membershipId, person.ownerUserId);
    const response = await shape(person, "nodes");
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ code: "access-revoked", erase: true });
  });

  it("gives byte-identical bodies for every way of not being an active member", async () => {
    const person = await signedInMember();
    const stranger = await makeWorkspace();
    const suspended = await signedInMember();
    await db
      .update(user)
      .set({ status: "suspended" })
      .where(eq(user.id, suspended.userId));
    const removed = await signedInMember();
    await revokeWorkspaceAdmission(removed.membershipId, removed.ownerUserId);
    const cases: [string, LightMyRequestResponse][] = [
      [
        "never a member",
        await shape(person, "nodes", "", { [WORKSPACE_HEADER]: stranger.workspaceId }),
      ],
      [
        "nonexistent workspace",
        await shape(person, "nodes", "", { [WORKSPACE_HEADER]: randomUUID() }),
      ],
      [
        "malformed workspace id",
        await shape(person, "nodes", "", { [WORKSPACE_HEADER]: "not-a-uuid" }),
      ],
      [
        "missing workspace id",
        await shape(person, "nodes", "", { [WORKSPACE_HEADER]: "" }),
      ],
      ["suspended member", await shape(suspended, "nodes")],
      ["removed member", await shape(removed, "nodes")],
    ];
    for (const [label, response] of cases) {
      expect(response.statusCode, label).toBe(401);
      expect(response.body, label).toBe(cases[0]![1].body);
      expect(response.headers["content-type"], label).toBe(
        cases[0]![1].headers["content-type"],
      );
    }
    expect(JSON.parse(cases[0]![1].body)).toEqual({
      code: "access-revoked",
      erase: true,
    });
    // The workspace header is a lookup key, not authorization: a real workspace is still refused.
    expect((await shape(person, "nodes")).statusCode).toBe(200);
  });

  it("returns the same reply for a revoked, unregistered or malformed device", async () => {
    const person = await signedInMember();
    const before = await shape(person, "nodes", "", { [DEVICE_HEADER]: "x" });
    const unregistered = await shape(person, "nodes", "", {
      [DEVICE_HEADER]: `unregistered${randomUUID().replaceAll("-", "")}`,
    });
    await db
      .update(device)
      .set({ isRevoked: true })
      .where(eq(device.id, person.deviceId));
    const revoked = await shape(person, "nodes");
    const revokedEdges = await shape(person, "edges");
    for (const response of [before, unregistered, revoked, revokedEdges]) {
      expect(response.statusCode).toBe(401);
      expect(response.body).toBe(revoked.body);
    }
    expect(JSON.parse(revoked.body)).toEqual({ code: "access-revoked", erase: true });
  });

  it("returns the same reply for a device revoked for this workspace only, and leaves other workspaces served", async () => {
    const person = await signedInMember();
    const other = await makeWorkspace();
    await admitWorkspaceMember({
      workspaceId: other.workspaceId,
      membershipId: randomUUID(),
      userId: person.userId,
      roles: ["hr-admin"],
      actorUserId: other.people.owner!.userId,
    });
    await db.insert(deviceWorkspaceRevocation).values({
      workspaceId: person.workspaceId,
      deviceId: person.deviceId,
      revokedBy: person.ownerUserId,
      reason: "explicit",
    });
    const revoked = await shape(person, "nodes");
    expect(revoked.statusCode).toBe(401);
    expect(revoked.body).toBe(JSON.stringify({ code: "access-revoked", erase: true }));
    expect(
      (await shape(person, "nodes", "", { [WORKSPACE_HEADER]: other.workspaceId }))
        .statusCode,
    ).toBe(200);
  });
});

/**
 * Electric replicates one database (`vulto`, the one the local stack and CI
 * migrate), so these run only when the suite is pointed at it:
 * `ELECTRIC_LIVE_TESTS=1 DATABASE_URL=postgres://vulto:vulto@localhost:5432/vulto pnpm --filter @vulto/api test`
 * with Electric running (`pnpm stack:up`). CI runs them in the `sync-browser` job.
 */
const databaseName = (
  (await db.execute(sql`select current_database() as name`)) as unknown as {
    name: string;
  }[]
)[0]?.name;

describe.skipIf(databaseName !== "vulto" || process.env["ELECTRIC_LIVE_TESTS"] !== "1")(
  "the proxy against real Electric",
  () => {
    it("streams exactly the person's audience rows, and none they may not hold", async () => {
      const person = await signedInMember();
      const audience = (
        await db
          .select({ id: syncNodeAudience.nodeId })
          .from(syncNodeAudience)
          .where(eq(syncNodeAudience.userId, person.userId))
      ).map((r) => r.id);
      expect(audience.length).toBeGreaterThan(0);

      const response = await shape(person, "nodes");
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["electric-handle"]).toBeDefined();
      const rows = (
        JSON.parse(response.body) as {
          value?: { node_id: string; workspace_id: string };
        }[]
      ).filter((m) => m.value);
      expect(rows.map((r) => r.value!.node_id).sort()).toEqual([...audience].sort());
      expect(rows.every((r) => r.value!.workspace_id === person.workspaceId)).toBe(
        true,
      );
    });

    it("streams edges through the same audience", async () => {
      const person = await signedInMember();
      const response = await shape(person, "edges");
      expect(response.statusCode, response.body).toBe(200);
      for (const message of JSON.parse(response.body) as {
        value?: { workspace_id: string };
      }[]) {
        if (message.value) expect(message.value.workspace_id).toBe(person.workspaceId);
      }
    });
  },
);

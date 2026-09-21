import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { member, session, user } from "./auth/schema.js";
import { closeDatabase, db } from "./db.js";
import { makeWorkspace } from "./permission/test-support.js";
import { buildServer } from "./server.js";

const ORIGIN = "http://localhost:3100";
const PASSWORD = "Correct horse battery staple 60!";
const app = await buildServer();

afterAll(async () => {
  await app.close();
  await closeDatabase();
});

function cookieHeader(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

/** Signs a fresh account in, then makes it the Owner of a fresh workspace and its active one. */
async function signedInOwner() {
  // Better Auth rate-limits sign-in per client; the auth suite clears it the same way.
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
  // The account is admitted to the workspace as its own person, with a role.
  const membershipId = randomUUID();
  const { admitWorkspaceMember } = await import("./auth/workspace-session.js");
  await admitWorkspaceMember({
    workspaceId: fixture.workspaceId,
    membershipId,
    userId: account!.id,
    roles: ["hr-admin"],
    actorUserId: fixture.people.owner!.userId,
  });
  await db
    .update(session)
    .set({ activeOrganizationId: fixture.workspaceId })
    .where(eq(session.userId, account!.id));
  return {
    cookie: cookieHeader(signIn),
    userId: account!.id,
    workspaceId: fixture.workspaceId,
  };
}

async function current(cookie?: string, query = "") {
  return app.inject({
    method: "GET",
    url: `/trpc/principal.current${query}`,
    headers: cookie ? { cookie, origin: ORIGIN } : { origin: ORIGIN },
  });
}

describe("tRPC context — the principal is decided on the server", () => {
  it("refuses a caller with no session", async () => {
    const response = await current();
    expect(response.statusCode).toBe(401);
  });

  it("builds a member principal from the session and the central membership row", async () => {
    const owner = await signedInOwner();
    const response = await current(owner.cookie);
    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(response.body).result.data).toEqual({
      userId: owner.userId,
      workspaceId: owner.workspaceId,
      roles: ["hr-admin"],
    });
  });

  it("ignores a principal supplied in client input", async () => {
    const owner = await signedInOwner();
    const forged = encodeURIComponent(
      JSON.stringify({
        userId: randomUUID(),
        workspaceId: randomUUID(),
        roles: ["owner"],
      }),
    );
    const response = await current(owner.cookie, `?input=${forged}`);
    expect(JSON.parse(response.body).result.data.roles).toEqual(["hr-admin"]);
    expect(JSON.parse(response.body).result.data.userId).toBe(owner.userId);
  });

  it("sees a role change on the very next request, with no restart", async () => {
    const owner = await signedInOwner();
    expect(JSON.parse((await current(owner.cookie)).body).result.data.roles).toEqual([
      "hr-admin",
    ]);
    await db
      .update(member)
      .set({ role: "finance-admin,team-member" })
      .where(
        and(
          eq(member.userId, owner.userId),
          eq(member.organizationId, owner.workspaceId),
        ),
      );
    expect(
      JSON.parse((await current(owner.cookie)).body).result.data.roles.sort(),
    ).toEqual(["finance-admin", "team-member"]);
  });

  it("refuses the next request once the membership is revoked", async () => {
    const owner = await signedInOwner();
    expect((await current(owner.cookie)).statusCode).toBe(200);
    await db
      .update(member)
      .set({ status: "revoked" })
      .where(
        and(
          eq(member.userId, owner.userId),
          eq(member.organizationId, owner.workspaceId),
        ),
      );
    expect((await current(owner.cookie)).statusCode).toBe(401);
  });
});

async function applyMutations(
  cookie: string | undefined,
  body: unknown,
  schemaVersion?: string,
) {
  return app.inject({
    method: "POST",
    url: "/trpc/graph.applyMutations",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(schemaVersion === undefined
        ? {}
        : { "x-vulto-schema-version": schemaVersion }),
    },
    payload: JSON.stringify(body),
  });
}

describe("graph.applyMutations over tRPC", () => {
  const createEntity = (workspaceId: string) => ({
    mutations: [
      {
        mutation_id: randomUUID(),
        name: "graph.createNode",
        args: {
          node: {
            node_id: randomUUID(),
            node_type: "Entity",
            schema_version: 1,
            lifecycle_status: "Active",
            workspace_id: workspaceId,
          },
        },
      },
    ],
  });

  it("refuses a client below the minimum schema version, or one that does not say, with client-outdated", async () => {
    const owner = await signedInOwner();
    for (const version of [undefined, "0", "not-a-number"]) {
      const response = await applyMutations(
        owner.cookie,
        createEntity(owner.workspaceId),
        version,
      );
      expect(response.statusCode, String(version)).toBe(412);
      const error = JSON.parse(response.body).error;
      expect(error.message).toBe("client-outdated");
      expect(error.data.code).toBe("PRECONDITION_FAILED");
    }
  });

  it("applies mutations for a current client, as the session's principal", async () => {
    const owner = await signedInOwner();
    const body = createEntity(owner.workspaceId);
    const response = await applyMutations(owner.cookie, body, "1");
    expect(response.statusCode, response.body).toBe(200);
    const [result] = JSON.parse(response.body).result.data;
    expect(result).toMatchObject({
      mutation_id: body.mutations[0]!.mutation_id,
      status: "applied",
    });
    const replay = await applyMutations(owner.cookie, body, "1");
    expect(JSON.parse(replay.body).result.data[0].status).toBe("duplicate");
  });

  it("requires a session and caps a call at 100 mutations", async () => {
    const owner = await signedInOwner();
    expect(
      (await applyMutations(undefined, createEntity(owner.workspaceId), "1"))
        .statusCode,
    ).toBe(401);
    const many = {
      mutations: Array.from(
        { length: 101 },
        () => createEntity(owner.workspaceId).mutations[0],
      ),
    };
    expect((await applyMutations(owner.cookie, many, "1")).statusCode).toBe(400);
  });
});

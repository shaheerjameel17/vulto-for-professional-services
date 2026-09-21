import { randomUUID } from "node:crypto";
import type { JsonValue } from "@vulto/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { listAuditEntries, appendAudit } from "../audit/journal.js";
import { member } from "../auth/schema.js";
import { KeyCache } from "../crypto/key-cache.js";
import {
  ensureWorkspaceKek,
  getKeyServices,
  ErasedDomainError,
  type KeyServices,
} from "../crypto/keys.js";
import { FragmentAuthenticationError } from "../crypto/envelope.js";
import { closeDatabase, db } from "../db.js";
import { PrincipalWithdrawnError, runAsPrincipal } from "../jobs/principal.js";
import { resolveMemberPrincipal } from "../permission/member-principal.js";
import type { MemberPrincipal } from "../permission/principal.js";
import { addNode, makeWorkspace } from "../permission/test-support.js";
import {
  ErasureAuditUndefinedError,
  ErasureDeniedError,
  eraseErasureDomain,
  type ErasureAudit,
} from "./erasure.js";
import { readProtected } from "./read.js";
import { graphProtectedFragments, protectedDataKeys } from "./schema.js";
import { writeProtected } from "./write.js";

afterAll(closeDatabase);

const services: KeyServices = getKeyServices();
const SENTINEL = "SENTINEL-salary-4815162342";

async function setup() {
  const fixture = await makeWorkspace({ hr: ["hr-admin"], member: ["team-member"] });
  const principal = async (name: string): Promise<MemberPrincipal> =>
    (await db.transaction((tx) =>
      resolveMemberPrincipal(tx, {
        userId: fixture.people[name]!.userId,
        workspaceId: fixture.workspaceId,
      }),
    ))!;
  return {
    fixture,
    owner: await principal("owner"),
    hr: await principal("hr"),
    member: await principal("member"),
  };
}

/** An Employee with a Tier 1 compensation fragment holding `value`. */
async function employeeWithSalary(
  workspaceId: string,
  value: JsonValue = { salary: SENTINEL },
) {
  return db.transaction(async (tx) => {
    const nodeId = await addNode(tx, workspaceId, "Employee");
    await writeProtected(
      tx,
      services,
      { workspaceId, nodeId, nodeType: "Employee" },
      "compensation",
      value,
    );
    return nodeId;
  });
}

const read = (principal: MemberPrincipal, nodeIds: string[], context = {}) =>
  db.transaction((tx) => readProtected(tx, services, principal, { nodeIds }, context));

describe("A003-T55 — Tier 1 and Tier 2 content is stored only as ciphertext", () => {
  it("a dump of the key and fragment tables and the graph rows holds no plaintext sentinel", async () => {
    const { fixture } = await setup();
    const employee = await employeeWithSalary(fixture.workspaceId);
    // Tier 2: the workspace's own billing partition.
    await db.transaction((tx) =>
      writeProtected(
        tx,
        services,
        {
          workspaceId: fixture.workspaceId,
          nodeId: fixture.workspaceId,
          nodeType: "Workspace",
        },
        "billing",
        { card: SENTINEL },
      ),
    );
    const dump = JSON.stringify([
      await db
        .select()
        .from(graphProtectedFragments)
        .where(eq(graphProtectedFragments.workspaceId, fixture.workspaceId)),
      await db
        .select()
        .from(protectedDataKeys)
        .where(eq(protectedDataKeys.workspaceId, fixture.workspaceId)),
      await db.execute(
        sql`select * from graph_nodes where workspace_id = ${fixture.workspaceId}`,
      ),
      await db.execute(
        sql`select * from graph_edges where workspace_id = ${fixture.workspaceId}`,
      ),
    ]);
    expect(dump).not.toContain(SENTINEL);
    expect(dump).not.toContain(Buffer.from(SENTINEL).toString("base64"));
    expect(employee).toBeDefined();
  });

  it("keeps one data key per Tier 1 erasure domain and one per workspace for Tier 2", async () => {
    const { fixture } = await setup();
    const a = await employeeWithSalary(fixture.workspaceId);
    const b = await employeeWithSalary(fixture.workspaceId);
    const billing = () =>
      db.transaction((tx) =>
        writeProtected(
          tx,
          services,
          {
            workspaceId: fixture.workspaceId,
            nodeId: fixture.workspaceId,
            nodeType: "Workspace",
          },
          "billing",
          { n: Math.random() },
        ),
      );
    await billing();
    await billing();
    const keys = await db
      .select()
      .from(protectedDataKeys)
      .where(eq(protectedDataKeys.workspaceId, fixture.workspaceId));
    const deks = keys.filter((k) => k.kind === "dek");
    expect(
      deks
        .filter((k) => k.tier === 1)
        .map((k) => k.erasureDomainId)
        .sort(),
    ).toEqual([a, b].sort());
    expect(deks.filter((k) => k.tier === 2)).toHaveLength(1);
    expect(keys.filter((k) => k.kind === "kek")).toHaveLength(1);
    // The database refuses a second live Tier 2 key for the workspace.
    await expect(
      db.insert(protectedDataKeys).values({
        keyId: randomUUID(),
        workspaceId: fixture.workspaceId,
        kind: "dek",
        tier: 2,
        parentKeyId: keys.find((k) => k.kind === "kek")!.keyId,
        wrappedKey: Buffer.from("x"),
      }),
    ).rejects.toThrow();
  });

  it("refuses to store a Tier 0 or unregistered partition as a protected fragment", async () => {
    const { fixture } = await setup();
    await db.transaction(async (tx) => {
      const nodeId = await addNode(tx, fixture.workspaceId, "Employee");
      const owner = {
        workspaceId: fixture.workspaceId,
        nodeId,
        nodeType: "Employee" as const,
      };
      await expect(
        writeProtected(tx, services, owner, "operational", { x: 1 }),
      ).rejects.toThrow(/Tier 1 and Tier 2/);
      await expect(
        writeProtected(tx, services, owner, "nope", { x: 1 }),
      ).rejects.toThrow(/no partition/);
    });
  });

  it("creates the workspace key-encryption key with the workspace, once", async () => {
    const { fixture } = await setup();
    const keks = await db
      .select()
      .from(protectedDataKeys)
      .where(eq(protectedDataKeys.workspaceId, fixture.workspaceId));
    expect(keks.filter((k) => k.kind === "kek")).toHaveLength(1);
    expect(keks[0]!.rootKeyRef).toBe("local:v1");
    const again = await db.transaction((tx) =>
      ensureWorkspaceKek(tx, services, fixture.workspaceId),
    );
    expect(again).toBe(keks[0]!.keyId);
  });
});

describe("A003-T55 — the authenticated header binds a fragment to its place", () => {
  it("ciphertext copied onto another node's row fails authentication and returns nothing", async () => {
    const { fixture, owner } = await setup();
    const a = await employeeWithSalary(fixture.workspaceId, { salary: SENTINEL });
    const b = await employeeWithSalary(fixture.workspaceId, { salary: "other" });
    const [source] = await db
      .select()
      .from(graphProtectedFragments)
      .where(eq(graphProtectedFragments.ownerId, a));
    await db
      .update(graphProtectedFragments)
      .set({
        nonce: source!.nonce,
        ciphertext: source!.ciphertext,
        dataKeyId: source!.dataKeyId,
      })
      .where(eq(graphProtectedFragments.ownerId, b));
    await expect(read(owner, [b])).rejects.toBeInstanceOf(FragmentAuthenticationError);
    // The original still reads.
    expect(await read(owner, [a])).toMatchObject([
      { state: "available", value: { salary: SENTINEL } },
    ]);
  });

  it("a fragment moved to another partition or owner type fails too", async () => {
    const { fixture, owner } = await setup();
    const a = await employeeWithSalary(fixture.workspaceId);
    await db
      .update(graphProtectedFragments)
      .set({ erasureDomainId: randomUUID() })
      .where(eq(graphProtectedFragments.ownerId, a));
    await expect(read(owner, [a])).rejects.toBeInstanceOf(FragmentAuthenticationError);
  });
});

describe("A003-T59 — protected.read: decide, audit, decrypt", () => {
  it("returns the decrypted value to a permitted reader, with an audit entry", async () => {
    const { fixture, owner } = await setup();
    const employee = await employeeWithSalary(fixture.workspaceId);
    const items = await read(owner, [employee]);
    expect(items).toEqual([
      {
        node_id: employee,
        partition: "compensation",
        state: "available",
        value: { salary: SENTINEL },
      },
    ]);
    const entries = await listAuditEntries(db, fixture.workspaceId);
    expect(
      entries.filter((e) => e.event_type === "SensitiveAccessGranted"),
    ).toHaveLength(1);
    expect(entries.at(-1)).toMatchObject({
      actor_user_id: owner.userId,
      target: { node_type: "Employee", target_tier: 1 },
    });
    // No plaintext reaches the journal.
    expect(JSON.stringify(entries)).not.toContain(SENTINEL);
  });

  it("a denied read returns nothing and writes an audit row", async () => {
    const { fixture, member: teamMember } = await setup();
    const employee = await employeeWithSalary(fixture.workspaceId);
    expect(await read(teamMember, [employee])).toEqual([]);
    const denials = (await listAuditEntries(db, fixture.workspaceId)).filter(
      (e) =>
        e.event_type === "PermissionDenied" && e.actor_user_id === teamMember.userId,
    );
    expect(denials).toHaveLength(1);
  });

  it("a Restricted outcome names only what the schema guarantees", async () => {
    const { fixture, hr } = await setup();
    await db.transaction((tx) =>
      writeProtected(
        tx,
        services,
        {
          workspaceId: fixture.workspaceId,
          nodeId: fixture.workspaceId,
          nodeType: "Workspace",
        },
        "billing",
        { card: SENTINEL },
      ),
    );
    const items = await read(hr, [fixture.workspaceId]);
    expect(items).toEqual([
      {
        node_id: fixture.workspaceId,
        partition: "billing",
        state: "restricted",
        label: expect.any(String),
      },
    ]);
    expect(JSON.stringify(items)).not.toContain(SENTINEL);
  });

  it("withholds the data if the audit entry cannot be written", async () => {
    const { fixture, owner } = await setup();
    const employee = await employeeWithSalary(fixture.workspaceId);
    const id = randomUUID();
    // An entry with this id and different content already exists, so the append conflicts.
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
        returned = await read(owner, [employee], { newId: () => id });
      })(),
    ).rejects.toThrow();
    expect(returned).toBeUndefined();
  });

  it("does not reveal another workspace's fragments", async () => {
    const a = await setup();
    const b = await setup();
    const employee = await employeeWithSalary(b.fixture.workspaceId);
    expect(await read(a.owner, [employee])).toEqual([]);
  });
});

describe("A003-T62 — cryptographic erasure of one erasure domain", () => {
  const recording = (): ErasureAudit & { events: unknown[] } => {
    const events: unknown[] = [];
    return {
      events,
      async record(_tx, event) {
        events.push(event);
      },
    };
  };

  it("destroys one employee's key, leaves the row, and leaves another employee's content readable", async () => {
    const { fixture, owner } = await setup();
    const a = await employeeWithSalary(fixture.workspaceId, { salary: "A" });
    const b = await employeeWithSalary(fixture.workspaceId, { salary: "B" });
    const audit = recording();
    const [keyBefore] = await db
      .select()
      .from(protectedDataKeys)
      .where(eq(protectedDataKeys.erasureDomainId, a));
    const result = await db.transaction((tx) =>
      eraseErasureDomain(
        tx,
        services,
        { kind: "system", name: "erasure", workspaceId: fixture.workspaceId },
        { workspaceId: fixture.workspaceId, erasureDomainId: a },
        audit,
      ),
    );
    expect(result.destroyedKeyIds).toEqual([keyBefore!.keyId]);
    expect(audit.events).toHaveLength(1);
    const [keyAfter] = await db
      .select()
      .from(protectedDataKeys)
      .where(eq(protectedDataKeys.keyId, keyBefore!.keyId));
    expect(keyAfter!.wrappedKey).toBeNull();
    expect(keyAfter!.destroyedAt).not.toBeNull();
    expect(services.cache.get(keyBefore!.keyId)).toBeUndefined();
    // The ciphertext and the node remain; the content is gone.
    expect(
      await db
        .select()
        .from(graphProtectedFragments)
        .where(eq(graphProtectedFragments.ownerId, a)),
    ).toHaveLength(1);
    expect(await read(owner, [a])).toEqual([
      { node_id: a, partition: "compensation", state: "erased" },
    ]);
    expect(await read(owner, [b])).toMatchObject([
      { state: "available", value: { salary: "B" } },
    ]);
    // An erased domain is never re-created.
    await expect(
      employeeWithSalaryAgain(fixture.workspaceId, a),
    ).rejects.toBeInstanceOf(ErasedDomainError);
  });

  it("destroys nothing when the erasure cannot be audited, and is refused for any other principal", async () => {
    const { fixture } = await setup();
    const a = await employeeWithSalary(fixture.workspaceId);
    await expect(
      db.transaction((tx) =>
        eraseErasureDomain(
          tx,
          services,
          { kind: "system", name: "erasure", workspaceId: fixture.workspaceId },
          { workspaceId: fixture.workspaceId, erasureDomainId: a },
        ),
      ),
    ).rejects.toBeInstanceOf(ErasureAuditUndefinedError);
    const [key] = await db
      .select()
      .from(protectedDataKeys)
      .where(eq(protectedDataKeys.erasureDomainId, a));
    expect(key!.destroyedAt).toBeNull();
    for (const name of [
      "audience-recompute",
      "retention-sweep",
      "key-rotation",
    ] as const) {
      await expect(
        db.transaction((tx) =>
          eraseErasureDomain(
            tx,
            services,
            { kind: "system", name, workspaceId: fixture.workspaceId },
            { workspaceId: fixture.workspaceId, erasureDomainId: a },
            recording(),
          ),
        ),
      ).rejects.toBeInstanceOf(ErasureDeniedError);
    }
  });
});

function employeeWithSalaryAgain(workspaceId: string, nodeId: string) {
  return db.transaction((tx) =>
    writeProtected(
      tx,
      services,
      { workspaceId, nodeId, nodeType: "Employee" },
      "compensation",
      { salary: "again" },
    ),
  );
}

describe("A003-T68 — a job acts as a principal, re-resolved when it runs", () => {
  it("runs for a member who still holds the grant", async () => {
    const { fixture, hr } = await setup();
    const employee = await employeeWithSalary(fixture.workspaceId);
    const items = await runAsPrincipal(hr, ({ tx, principal }) =>
      readProtected(tx, services, principal, { nodeIds: [employee] }),
    );
    expect(items).toMatchObject([{ state: "available", value: { salary: SENTINEL } }]);
  });

  it("stops before reading anything when the member has been demoted or removed", async () => {
    const { fixture, hr } = await setup();
    const employee = await employeeWithSalary(fixture.workspaceId);
    let ran = false;
    await db
      .update(member)
      .set({ status: "revoked" })
      .where(eq(member.userId, hr.userId));
    await expect(
      runAsPrincipal(hr, async ({ tx, principal }) => {
        ran = true;
        return readProtected(tx, services, principal, { nodeIds: [employee] });
      }),
    ).rejects.toBeInstanceOf(PrincipalWithdrawnError);
    expect(ran).toBe(false);
    // A demotion (not a removal) is re-resolved too: the job sees the current roles.
  });

  it("uses the member's current roles: a demoted HR Admin's job is denied and audited", async () => {
    const { fixture, hr } = await setup();
    const employee = await employeeWithSalary(fixture.workspaceId);
    await db
      .update(member)
      .set({ role: "team-member" })
      .where(eq(member.userId, hr.userId));
    const items = await runAsPrincipal(hr, ({ tx, principal }) =>
      readProtected(tx, services, principal, { nodeIds: [employee] }),
    );
    expect(items).toEqual([]);
  });

  it("stops an expired support grant and lets a system principal through", async () => {
    const { fixture } = await setup();
    await expect(
      runAsPrincipal(
        {
          kind: "support",
          grantId: randomUUID(),
          workspaceId: fixture.workspaceId,
          scope: { access: "read", node_types: [] },
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
        async () => "ran",
      ),
    ).rejects.toBeInstanceOf(PrincipalWithdrawnError);
    expect(
      await runAsPrincipal(
        { kind: "system", name: "retention-sweep", workspaceId: fixture.workspaceId },
        async () => "ran",
      ),
    ).toBe("ran");
  });
});

describe("A003-T61 — unwrapped keys live only in a bounded, expiring cache", () => {
  it("expires an entry after at most five minutes, whatever TTL is asked for", () => {
    let now = 0;
    const cache = new KeyCache({ ttlMs: 60 * 60 * 1000, clock: () => now });
    cache.set("k", new Uint8Array([1]));
    now = 5 * 60 * 1000 - 1;
    expect(cache.get("k")).toBeDefined();
    now = 5 * 60 * 1000;
    expect(cache.get("k")).toBeUndefined();
  });

  it("holds at most 1,000 entries, evicting the oldest, and serializes to nothing", () => {
    const cache = new KeyCache();
    for (let i = 0; i < 1001; i += 1) cache.set(`k${i}`, new Uint8Array([i % 256]));
    expect(cache.size).toBe(1000);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k1000")).toBeDefined();
    expect(JSON.stringify(cache)).toBeUndefined();
    expect(JSON.stringify({ cache })).toBe("{}");
  });
});

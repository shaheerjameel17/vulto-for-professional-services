import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { isDeviceRevokedInWorkspace } from "./device-revocation-store.js";

/**
 * F210 — the workspace-scoped device revoke survives the removal of
 * `device_unlock_secret`. This builds a scratch database at the schema before
 * migration 0019, records revocations in the old table exactly as the retired
 * code did, applies 0019, and checks the revocations are still in force through
 * the new table and the same check both the session path and the shape proxy use.
 */

const migrationsFolder = path.resolve(import.meta.dirname, "../../drizzle");
const adminUrl = (process.env["DATABASE_URL"] ?? "").replace(/\/[^/]*$/, "/postgres");
const scratchName = `vulto_f210_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let scratch: ReturnType<typeof postgres> | undefined;

afterAll(async () => {
  await scratch?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
  await admin.end();
});

/** The migration folder truncated to everything before 0019. */
function foldersBefore0019(): string {
  const target = mkdtempSync(path.join(tmpdir(), "vulto-mig-"));
  mkdirSync(path.join(target, "meta"));
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { entries: { idx: number; tag: string }[] };
  const kept = journal.entries.filter((entry) => entry.idx < 19);
  writeFileSync(
    path.join(target, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: kept }),
  );
  for (const entry of kept) {
    cpSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      path.join(target, `${entry.tag}.sql`),
    );
  }
  return target;
}

describe("F210 — a device revoked before the migration is still revoked after it", () => {
  it("copies every revocation into device_workspace_revocation, keeps unrevoked devices unrevoked, then drops the old table", async () => {
    await admin.unsafe(`CREATE DATABASE ${scratchName}`);
    const url = adminUrl.replace(/\/postgres$/, `/${scratchName}`);
    scratch = postgres(url, { max: 1, onnotice: () => {} });
    const db = drizzle(scratch);

    // The schema as it was before this stage.
    await migrate(db, { migrationsFolder: foldersBefore0019() });
    expect(
      await scratch`select to_regclass('public.device_unlock_secret') as t`,
    ).toEqual([{ t: "device_unlock_secret" }]);

    const owner = randomUUID();
    const member = randomUUID();
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const explicit = "explicit".padEnd(20, "x");
    const stale = "stale".padEnd(20, "x");
    const removed = "removed".padEnd(20, "x");
    const live = "live".padEnd(20, "x");
    const noTrail = "notrail".padEnd(20, "x");

    for (const id of [owner, member]) {
      await scratch`insert into "user" (id, name, email) values (${id}, 'x', ${`${id}@example.com`})`;
    }
    for (const [id, slug] of [
      [workspaceA, "a"],
      [workspaceB, "b"],
    ] as const) {
      await scratch`insert into organization (id, name, slug, created_at) values (${id}, ${slug}, ${`${slug}-${id}`}, now())`;
    }
    for (const id of [explicit, stale, removed, live, noTrail]) {
      await scratch`insert into device (id, user_id, device_name, platform) values (${id}, ${member}, 'd', 'web')`;
    }

    const secret = (workspace: string, device: string, revoked: boolean) =>
      scratch!`insert into device_unlock_secret (workspace_id, user_id, device_id, server_half, revoked_at)
        values (${workspace}, ${member}, ${device}, 'half', ${revoked ? new Date().toISOString() : null})`;
    // Revoked in A three ways, plus one with no trail; a live one; and one revoked only in B.
    await secret(workspaceA, explicit, true);
    await secret(workspaceA, stale, true);
    await secret(workspaceA, removed, true);
    await secret(workspaceA, noTrail, true);
    await secret(workspaceA, live, false);
    await secret(workspaceB, explicit, false);
    await secret(workspaceB, live, true);

    const event = (
      device: string,
      workspace: string,
      type: string,
      actor: string | null,
    ) =>
      scratch!`insert into device_trust_event (device_id, user_id, workspace_id, event_type, actor_user_id)
        values (${device}, ${member}, ${workspace}, ${type}, ${actor})`;
    await event(explicit, workspaceA, "revoked-explicit", owner);
    await event(stale, workspaceA, "stale-flagged", owner);
    await event(removed, workspaceA, "revoked-membership", null);

    // The migration under test.
    await migrate(db, { migrationsFolder });

    expect(
      await scratch`select to_regclass('public.device_unlock_secret') as t`,
    ).toEqual([{ t: null }]);
    for (const table of [
      "sync_delta",
      "sync_device_ack",
      "sync_ticket",
      "sync_workspace_cursor",
      "workspace_projection_grant",
    ]) {
      expect(
        await scratch.unsafe(`select to_regclass('public.${table}') as t`),
      ).toEqual([{ t: null }]);
    }

    // Every revoked pair is still revoked, through the check the session path
    // and the shape proxy both use...
    for (const [workspace, device] of [
      [workspaceA, explicit],
      [workspaceA, stale],
      [workspaceA, removed],
      [workspaceA, noTrail],
      [workspaceB, live],
    ] as const) {
      expect(
        await isDeviceRevokedInWorkspace(db, workspace, device),
        `${device} in ${workspace}`,
      ).toBe(true);
    }
    // ...and nothing that was not revoked became revoked.
    for (const [workspace, device] of [
      [workspaceA, live],
      [workspaceB, explicit],
      [workspaceB, stale],
    ] as const) {
      expect(
        await isDeviceRevokedInWorkspace(db, workspace, device),
        `${device} in ${workspace}`,
      ).toBe(false);
    }

    // The actor and the reason came across from the trust log where it had them.
    const rows =
      await scratch`select device_id, reason, revoked_by from device_workspace_revocation where workspace_id = ${workspaceA} order by device_id`;
    const by = Object.fromEntries(rows.map((r) => [r["device_id"] as string, r]));
    expect(by[explicit]).toMatchObject({ reason: "explicit", revoked_by: owner });
    expect(by[stale]).toMatchObject({ reason: "stale", revoked_by: owner });
    expect(by[removed]).toMatchObject({
      reason: "membership-revoked",
      revoked_by: null,
    });
    expect(by[noTrail]).toMatchObject({ reason: "unknown", revoked_by: null });
    expect(rows).toHaveLength(4);
  });
});

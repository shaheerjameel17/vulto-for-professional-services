import { describe, expect, it } from "vitest";
import { SqliteCache } from "./cache";
import { openTestDatabase } from "./test-database";
import {
  missingOutboxMigrations,
  OutboxVersionError,
  prepareCacheSchema,
} from "./database";
import { OUTBOX_MIGRATIONS, OUTBOX_SCHEMA_VERSION } from "./schema";
import { CACHE_SCHEMA_VERSION, CACHE_TABLES } from "./schema";

describe("the cache database over wa-sqlite", () => {
  it("creates exactly the cache tables and holds nothing of Tier 1 or Tier 2", async () => {
    const db = await openTestDatabase();
    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((t) => t["name"])).toEqual([...CACHE_TABLES].sort());
    // session_hint holds identifiers only.
    const columns = await db.all("PRAGMA table_info(session_hint)");
    expect(columns.map((c) => c["name"])).toEqual([
      "singleton",
      "user_id",
      "workspace_id",
    ]);
    await db.close();
  });

  it("commits a transaction whole and rolls a failing one back whole", async () => {
    const db = await openTestDatabase();
    const cache = new SqliteCache(db);
    await db.transaction(async () => {
      await cache.putNode({
        nodeId: "n1",
        nodeType: "Entity",
        lifecycleStatus: "Active",
        isSoftDeleted: false,
        version: 1,
        record: {},
      });
    });
    await expect(
      db.transaction(async () => {
        await cache.putNode({
          nodeId: "n2",
          nodeType: "Entity",
          lifecycleStatus: "Active",
          isSoftDeleted: false,
          version: 1,
          record: {},
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await cache.getNode("n1")).toBeDefined();
    expect(await cache.getNode("n2")).toBeUndefined();
    await db.close();
  });
});

describe("the cache schema version", () => {
  it("stamps a fresh database and keeps a current one untouched", async () => {
    const db = await openTestDatabase();
    expect((await db.all("PRAGMA user_version"))[0]?.["user_version"]).toBe(
      CACHE_SCHEMA_VERSION,
    );
    await db.run(
      "INSERT INTO cache_nodes (node_id, node_type, lifecycle_status, version, record_json) VALUES ('n','Entity','Active',1,'{}')",
    );
    expect(await prepareCacheSchema(db)).toBe(false);
    expect((await db.all("SELECT node_id FROM cache_nodes")).length).toBe(1);
  });

  it("drops and rebuilds only the replicated tables at another version, and for one from before versioning", async () => {
    const db = await openTestDatabase();
    await db.run(
      "INSERT INTO cache_nodes (node_id, node_type, lifecycle_status, version, record_json) VALUES ('n','Entity','Active',1,'{}')",
    );
    await db.run("PRAGMA user_version = 1");
    expect(await prepareCacheSchema(db)).toBe(true);
    expect(await db.all("SELECT node_id FROM cache_nodes")).toEqual([]);
    expect((await db.all("PRAGMA user_version"))[0]?.["user_version"]).toBe(
      CACHE_SCHEMA_VERSION,
    );

    await db.run(
      "INSERT INTO cache_nodes (node_id, node_type, lifecycle_status, version, record_json) VALUES ('m','Entity','Active',1,'{}')",
    );
    await db.run("PRAGMA user_version = 0");
    expect(await prepareCacheSchema(db)).toBe(true);
    expect(await db.all("SELECT node_id FROM cache_nodes")).toEqual([]);
  });
});

describe("the outbox is versioned apart from the cache", () => {
  const queue = (db: Awaited<ReturnType<typeof openTestDatabase>>, id: string) =>
    db.run(
      "INSERT INTO outbox (mutation_id, name, args_json, undo_json, status, created_at) VALUES (?, 'graph.createNode', '{}', '[]', 'pending', '2026-09-21T00:00:00Z')",
      [id],
    );

  it("a cache version change keeps every queued mutation, and drops only the replicated tables", async () => {
    const db = await openTestDatabase();
    for (const id of ["m1", "m2", "m3"]) await queue(db, id);
    await db.run(
      "INSERT INTO sync_cursor (template, handle, \"offset\") VALUES ('nodes', 'h', '1_0')",
    );
    await db.run("PRAGMA user_version = 1");
    expect(await prepareCacheSchema(db)).toBe(true);
    expect(
      (await db.all("SELECT mutation_id FROM outbox ORDER BY seq")).map(
        (r) => r["mutation_id"],
      ),
    ).toEqual(["m1", "m2", "m3"]);
    expect(await db.all("SELECT * FROM sync_cursor")).toEqual([]);
  });

  it("every outbox version below the current one has a migration (fails the build the moment one is missing)", () => {
    expect(missingOutboxMigrations()).toEqual([]);
    // The check itself: a bump to 3 with only a 1 -> 2 migration is caught.
    expect(missingOutboxMigrations(3, { 1: () => undefined })).toEqual([2]);
    expect(missingOutboxMigrations(2, {})).toEqual([1]);
  });

  it("an outbox at an older version is migrated, keeping its rows", async () => {
    const db = await openTestDatabase();
    await queue(db, "m1");
    const migrated: string[] = [];
    await prepareCacheSchema(
      db,
      {
        [OUTBOX_SCHEMA_VERSION]: async (exec) => {
          migrated.push("to-next");
          await exec("ALTER TABLE outbox ADD COLUMN note TEXT");
        },
      },
      OUTBOX_SCHEMA_VERSION + 1,
    );
    expect(migrated).toEqual(["to-next"]);
    expect((await db.all("SELECT mutation_id FROM outbox")).length).toBe(1);
    expect(
      (await db.all("SELECT value FROM schema_meta WHERE key = 'outbox_version'"))[0]?.[
        "value"
      ],
    ).toBe(OUTBOX_SCHEMA_VERSION + 1);
  });

  it("an outbox with no migration, or from a newer build, stops the client and is never wiped", async () => {
    const db = await openTestDatabase();
    await queue(db, "m1");
    await expect(
      prepareCacheSchema(db, {}, OUTBOX_SCHEMA_VERSION + 1),
    ).rejects.toBeInstanceOf(OutboxVersionError);
    await db.run("UPDATE schema_meta SET value = 99 WHERE key = 'outbox_version'");
    await expect(prepareCacheSchema(db)).rejects.toBeInstanceOf(OutboxVersionError);
    expect((await db.all("SELECT mutation_id FROM outbox")).length).toBe(1);
  });

  it("the real migration table covers the real version", () => {
    expect(Object.keys(OUTBOX_MIGRATIONS).length).toBe(OUTBOX_SCHEMA_VERSION - 1);
  });
});

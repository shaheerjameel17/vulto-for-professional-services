import { describe, expect, it } from "vitest";
import { SqliteCache } from "./cache";
import { openTestDatabase } from "./test-database";
import { prepareCacheSchema } from "./database";
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

  it("drops and rebuilds a database at another version, and one from before versioning", async () => {
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

import { describe, expect, it } from "vitest";
import { SqliteCache } from "./cache";
import { openTestDatabase } from "./test-database";
import { CACHE_TABLES } from "./schema";

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

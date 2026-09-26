import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteCache } from "../sync-client/cache";
import { openTestDatabase } from "../sync-client/test-database";
import {
  notificationListForUser,
  notificationUnreadActionCount,
} from "./notifications";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("local notification reads", () => {
  it("groups, orders, counts action items only and excludes dismissed rows offline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 12));
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const ids: string[] = [];
    for (let i = 0; i < 16; i++) {
      const id = randomUUID();
      ids.push(id);
      const created =
        i === 14
          ? new Date(2026, 8, 25, 9).toISOString()
          : new Date(2026, 8, 26, 10, 0, i).toISOString();
      await cache.putNode({
        nodeId: id,
        nodeType: "Notification",
        version: 1,
        lifecycleStatus: "Active",
        isSoftDeleted: false,
        record: {
          node_id: id,
          created_at: created,
          category: i < 3 || i === 15 ? "ActionNeeded" : "Informational",
          read_at: i === 14 ? created : null,
          dismissed_at: i === 15 ? created : null,
        },
      });
    }
    expect(await notificationUnreadActionCount(database)).toBe(3);
    const groups = await notificationListForUser(database);
    expect(groups.needsYou.map((row) => row.nodeId)).toEqual(ids.slice(0, 3).reverse());
    expect(groups.today.map((row) => row.nodeId)).toEqual(ids.slice(3, 14).reverse());
    expect(groups.earlier.map((row) => row.nodeId)).toEqual([ids[14]]);
    expect(notificationListForUser.length).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    await database.close();
  });
  it("returns empty groups and zero for an empty cache", async () => {
    const database = await openTestDatabase();
    expect(await notificationListForUser(database)).toEqual({
      needsYou: [],
      today: [],
      earlier: [],
    });
    expect(await notificationUnreadActionCount(database)).toBe(0);
    await database.close();
  });
});

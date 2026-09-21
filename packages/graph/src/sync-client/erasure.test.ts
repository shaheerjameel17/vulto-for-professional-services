import { describe, expect, it } from "vitest";
import {
  completePendingErase,
  eraseAllCaches,
  EraseIncompleteError,
  eraseDatabases,
  isCacheDatabaseName,
  type EraseEnvironment,
} from "./erasure";

function environment(existing: string[], failing: Set<string> = new Set()) {
  const pending: string[][] = [];
  let stored: string[] = [];
  const deleted: string[] = [];
  const env: EraseEnvironment = {
    listDatabases: async () => [...existing],
    deleteDatabase: async (name) => {
      if (failing.has(name)) throw new Error("blocked");
      deleted.push(name);
    },
    readPending: async () => [...stored],
    writePending: async (names) => {
      stored = [...names];
      pending.push([...names]);
    },
  };
  return { env, deleted, pending, stored: () => stored, failing };
}

describe("erasing the device's caches", () => {
  it("recognizes cache databases and not the device-identity database", () => {
    expect(isCacheDatabaseName("vulto:ws:user")).toBe(true);
    expect(isCacheDatabaseName("vulto:device")).toBe(false);
    expect(isCacheDatabaseName("other")).toBe(false);
  });

  it("sign-out deletes every workspace's cache, and only caches", async () => {
    const e = environment(["vulto:a:u", "vulto:b:u", "vulto:device", "unrelated"]);
    await eraseAllCaches(e.env, "vulto:c:u");
    expect(e.deleted.sort()).toEqual(["vulto:a:u", "vulto:b:u", "vulto:c:u"]);
    expect(e.stored()).toEqual([]);
  });

  it("falls back to the current database where the browser cannot list them", async () => {
    const e = environment([]);
    e.env.listDatabases = async () => null;
    await eraseAllCaches(e.env, "vulto:c:u");
    expect(e.deleted).toEqual(["vulto:c:u"]);
  });

  it("records the intent before deleting, and keeps a failed delete for the next start", async () => {
    const e = environment([], new Set(["vulto:b:u"]));
    await expect(
      eraseDatabases(e.env, ["vulto:a:u", "vulto:b:u"]),
    ).rejects.toBeInstanceOf(EraseIncompleteError);
    expect(e.pending[0]).toEqual(["vulto:a:u", "vulto:b:u"]);
    expect(e.stored()).toEqual(["vulto:b:u"]);

    // Next start: the delete is retried before anything else, and clears once it works.
    e.failing.clear();
    await completePendingErase(e.env);
    expect(e.deleted).toContain("vulto:b:u");
    expect(e.stored()).toEqual([]);
  });

  it("a start with nothing pending does nothing", async () => {
    const e = environment([]);
    await completePendingErase(e.env);
    expect(e.pending).toEqual([]);
  });

  it("a start that still cannot delete fails, so nothing is opened", async () => {
    const e = environment([], new Set(["vulto:b:u"]));
    await expect(eraseDatabases(e.env, ["vulto:b:u"])).rejects.toBeInstanceOf(
      EraseIncompleteError,
    );
    await expect(completePendingErase(e.env)).rejects.toBeInstanceOf(
      EraseIncompleteError,
    );
  });
});

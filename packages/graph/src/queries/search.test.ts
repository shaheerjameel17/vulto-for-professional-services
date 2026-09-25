import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ghostEmployeeOperationalRecord,
  validateSearchableNodeTypes,
  type SearchableNodeType,
} from "@vulto/schema";
import { SqliteCache } from "../sync-client/cache";
import { openTestDatabase } from "../sync-client/test-database";
import { searchQuery } from "./search";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
});
afterEach(() => vi.restoreAllMocks());

const node = (
  nodeId: string,
  nodeType: string,
  record: Record<string, unknown>,
  lifecycleStatus = "Active",
  isSoftDeleted = false,
) => ({ nodeId, nodeType, record, lifecycleStatus, isSoftDeleted, version: 1 });

const labels = async (
  database: Awaited<ReturnType<typeof openTestDatabase>>,
  text: string,
) => (await searchQuery(database, { text })).entityMatches.map((match) => match.label);

describe("search registration", () => {
  const entry = (nodeType: string, field = "name"): SearchableNodeType => ({
    nodeType,
    labelFields: [field],
    indexedFields: [field],
  });

  it("refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names", () => {
    expect(() => validateSearchableNodeTypes([entry("Contract")])).toThrow(/Tier 0/);
    expect(() =>
      validateSearchableNodeTypes([entry("Employee", "base_compensation_amount")]),
    ).toThrow(/Tier 0/);
    expect(() => validateSearchableNodeTypes([entry("AuditEntry")])).toThrow(
      /AuditEntry/,
    );
    expect(() => validateSearchableNodeTypes([entry("NotRegistered")])).toThrow(
      /Unregistered/,
    );
    expect(() => validateSearchableNodeTypes([entry("Skill", "bad-field")])).toThrow(
      /Unsafe/,
    );
    expect(() =>
      validateSearchableNodeTypes([
        {
          nodeType: "Employee",
          labelFields: ["full_name"],
          indexedFields: ["full_name", "salary"],
        },
      ]),
    ).toThrow(/Tier 0/);
  });
});

describe("local search index and query", () => {
  it("maintains insert, rename, soft-delete, reactivation, hard-delete and reset synchronously", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    await cache.putNode(node("e1", "Employee", { full_name: "Mina Clark" }));
    expect(await labels(database, "mina")).toEqual(["Mina Clark"]);
    await cache.putNode(node("e1", "Employee", { full_name: "Nina Clark" }));
    expect(await labels(database, "mina")).toEqual([]);
    expect(await labels(database, "nina")).toEqual(["Nina Clark"]);
    await cache.putNode(
      node("e1", "Employee", { full_name: "Nina Clark" }, "Active", true),
    );
    expect(await labels(database, "nina")).toEqual([]);
    await cache.putNode(node("e1", "Employee", { full_name: "Nina Clark" }));
    expect(await labels(database, "nina")).toEqual(["Nina Clark"]);
    await cache.deleteNode("e1");
    expect(await labels(database, "nina")).toEqual([]);
    await cache.putNode(node("e2", "Employee", { full_name: "Nina Clark" }));
    await cache.resetTemplate("nodes");
    expect(await labels(database, "nina")).toEqual([]);
    expect(await database.all("SELECT * FROM cache_search")).toEqual([]);
    await database.close();
  });

  it("never indexes unregistered fields and never leaks them to search_text", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    await cache.putNode(
      node("e1", "Employee", {
        full_name: "Aisha Khan",
        email: "secret@example.com",
        phone: "555-4231",
      }),
    );
    expect(await labels(database, "secret")).toEqual([]);
    expect(await labels(database, "4231")).toEqual([]);
    expect(await database.all("SELECT search_text FROM cache_search")).toEqual([
      { search_text: "aisha khan" },
    ]);
    await database.close();
  });

  it("ignores unresolved labels and indexes/relabels a real Ghost by role title", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    await cache.putNode(node("none", "Employee", {}));
    await cache.putNode(node("empty", "Employee", { full_name: "", job_title: "" }));
    await cache.putNode(node("number", "Employee", { full_name: 42, job_title: true }));
    expect(await database.all("SELECT node_id FROM cache_search")).toEqual([]);
    const ghost = ghostEmployeeOperationalRecord({
      job_title: "Principal Engineer",
      start_date: "2026-09-25",
    });
    await cache.putNode(node("ghost", "Employee", ghost));
    expect(await database.all("SELECT node_id, label FROM cache_search")).toEqual([
      { node_id: "ghost", label: "Principal Engineer" },
    ]);
    expect(
      (await searchQuery(database, { text: "principal" })).entityMatches,
    ).toMatchObject([
      {
        nodeId: "ghost",
        label: "Principal Engineer",
        isGhost: true,
        secondaryLabel: null,
      },
    ]);
    await cache.putNode(
      node("ghost", "Employee", { ...ghost, full_name: "Amina Shah" }),
    );
    expect(
      await database.all("SELECT label FROM cache_search WHERE node_id = 'ghost'"),
    ).toEqual([{ label: "Amina Shah" }]);
    await cache.putNode(
      node("ghost", "Employee", { full_name: null, job_title: null }),
    );
    expect(await database.all("SELECT node_id FROM cache_search")).toEqual([]);
    await cache.putNode(node("none", "Employee", { full_name: "Added Later" }));
    expect(await labels(database, "added")).toEqual(["Added Later"]);
    await database.close();
  });

  it("escapes LIKE wildcards and matches non-ASCII text using SQLite normalization", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    for (const [id, name] of [
      ["one", "Rate 100%"],
      ["two", "Rate 1000"],
      ["three", "A_B"],
      ["four", "ACB"],
      ["five", "عائشہ"],
    ]) {
      await cache.putNode(node(id!, "Employee", { full_name: name }));
    }
    expect(await labels(database, "%")).toEqual(["Rate 100%"]);
    expect(await labels(database, "_")).toEqual(["A_B"]);
    expect(await labels(database, "عائشہ")).toEqual(["عائشہ"]);
    await database.close();
  });

  it("ranks label-prefix, word-prefix, substring, Active, and binary ties with a per-type limit", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    for (const [id, name, status] of [
      ["z", "Anna", "Active"],
      ["a", "Anna", "Active"],
      ["i", "Annette", "Inactive"],
      ["w", "Mary Ann", "Active"],
      ["s", "Joanne", "Active"],
    ]) {
      await cache.putNode(node(id!, "Employee", { full_name: name }, status));
    }
    const matches = (await searchQuery(database, { text: "ann", limit: 4 }))
      .entityMatches;
    expect(matches.map((match) => match.nodeId)).toEqual(["a", "z", "i", "w"]);
    await database.close();
  });

  it("computes skillMatched before the limit and returns commands alongside entities", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    await cache.putNode(
      node("s", "Skill", { name: "Create employee skills", category: "HR" }),
    );
    await cache.putNode(
      node("e", "Employee", { full_name: "Create employee example" }),
    );
    const result = await searchQuery(database, { text: "create emp", limit: 0 });
    expect(result.commandMatches[0]?.commandId).toBe("create-employee");
    expect(result.entityMatches).toEqual([]);
    expect(result.skillMatched).toBe(true);
    expect(result).not.toHaveProperty("skillMatches");
    expect(await searchQuery(database, { text: "" })).toEqual({
      commandMatches: [],
      entityMatches: [],
      skillMatched: false,
    });
    expect(await searchQuery(database, { text: "no-such-result" })).toEqual({
      commandMatches: [],
      entityMatches: [],
      skillMatched: false,
    });
    await database.close();
  });

  it("shares Assignment coverage and earliest rolloff with Skill Matrix", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const today = new Date().toISOString().slice(0, 10);
    for (const id of ["assigned", "canceled", "none"]) {
      await cache.putNode(node(id, "Employee", { full_name: `Person ${id}` }));
    }
    await cache.putNode(
      node("a1", "Assignment", {
        employee_id: "assigned",
        start_date: today,
        end_date: today,
      }),
    );
    await cache.putNode(
      node(
        "a2",
        "Assignment",
        {
          employee_id: "canceled",
          start_date: today,
          end_date: today,
        },
        "Canceled",
      ),
    );
    const matches = (await searchQuery(database, { text: "person" })).entityMatches;
    expect(matches).toMatchObject([
      { nodeId: "assigned", availabilityStatus: "Assigned", nextRolloffDate: today },
      { nodeId: "canceled", availabilityStatus: "Available", nextRolloffDate: null },
      { nodeId: "none", availabilityStatus: "Available", nextRolloffDate: null },
    ]);
    await database.close();
  });

  it("shows the Client's name for a Project's belongs_to edge", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    await cache.putNode(node("p", "Project", { name: "Orion Launch" }));
    await cache.putNode(node("c", "Client", { name: "Acme" }));
    await cache.putEdge({
      edgeId: "edge",
      edgeType: "belongs_to",
      fromNodeId: "p",
      toNodeId: "c",
      effectiveFrom: null,
      effectiveTo: null,
      isSoftDeleted: false,
      version: 1,
      record: {},
    });
    expect(
      (await searchQuery(database, { text: "orion" })).entityMatches,
    ).toMatchObject([{ nodeType: "Project", secondaryLabel: "Acme" }]);
    await database.close();
  });

  it("returns grouped matches at 150 employees and 50 projects without a network call", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    for (let i = 0; i < 150; i++) {
      await cache.putNode(node(`e${i}`, "Employee", { full_name: `Person ${i}` }));
    }
    for (let i = 0; i < 50; i++) {
      await cache.putNode(node(`p${i}`, "Project", { name: `Per project ${i}` }));
    }
    await searchQuery(database, { text: "per" });
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const result = await searchQuery(database, { text: "per" });
      samples.push(performance.now() - start);
      expect(result.entityMatches.map((match) => match.nodeType)).toEqual([
        ...Array<string>(8).fill("Employee"),
        ...Array<string>(8).fill("Project"),
      ]);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
    console.info(
      `Stage 23 search p95 (150 employees + 50 projects, 3-char "per", 30 runs): ${p95.toFixed(2)}ms`,
    );
    expect(p95).toBeLessThan(100);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await database.close();
  });
});

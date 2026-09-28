import { describe, expect, it } from "vitest";
import { SqliteCache } from "../sync-client/cache";
import { openTestDatabase } from "../sync-client/test-database";
import {
  parseGraphQuery,
  employeeGetQuery,
  employeeListForDirectoryQuery,
} from "../query";
import { getEmployeeForProfile, listEmployeesForDirectory } from "./employee-directory";

const person = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const manager = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const entity = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const skill = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
describe("Employee device queries", () => {
  it("reads a 150-person offline directory within the 200 ms budget", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    for (let index = 0; index < 150; index++) {
      await cache.putNode({
        nodeId: crypto.randomUUID(),
        nodeType: "Employee",
        lifecycleStatus: "Active",
        isSoftDeleted: false,
        version: 1,
        record: {
          employee_type: "Employee",
          full_name: `Person ${index}`,
          job_title: "Engineer",
        },
      });
    }
    const durations: number[] = [];
    for (let sample = 0; sample < 20; sample++) {
      const start = performance.now();
      expect(await listEmployeesForDirectory(database)).toHaveLength(150);
      durations.push(performance.now() - start);
    }
    const p95 = [...durations].sort((a, b) => a - b)[18]!;
    console.info(
      `UI-2 local SQLite directory p95 at 150 employees: ${p95.toFixed(2)}ms (20 samples)`,
    );
    expect(p95).toBeLessThan(200);
    await database.close();
  });
  it("is strict, UUID-v4-shaped and has no server filter input", () => {
    expect(parseGraphQuery(employeeListForDirectoryQuery())).toEqual(
      employeeListForDirectoryQuery(),
    );
    expect(parseGraphQuery(employeeGetQuery(person))).toEqual(employeeGetQuery(person));
    expect(() =>
      parseGraphQuery({ ...employeeListForDirectoryQuery(), args: {} }),
    ).toThrow();
    expect(() =>
      parseGraphQuery({
        ...employeeGetQuery(person),
        args: { employee_id: person, role: "owner" },
      }),
    ).toThrow();
    expect(() => parseGraphQuery(employeeGetQuery("fixture-id"))).toThrow();
  });
  it("reads operational rows, versions, actual entity and manager edges without compensation; inactive skills remain", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    for (const [id, type, name] of [
      [person, "Employee", "Ada"],
      [manager, "Employee", "Grace"],
      [entity, "Entity", "Real Entity"],
      [skill, "Skill", "TypeScript"],
    ]) {
      await cache.putNode({
        nodeId: id!,
        nodeType: type!,
        lifecycleStatus: id === person ? "Inactive" : "Active",
        isSoftDeleted: false,
        version: 7,
        record: {
          full_name: name,
          name,
          employee_type: "Employee",
          base_compensation_amount: 987654,
        },
      });
    }
    for (const [type, target] of [
      ["managed_by", manager],
      ["scoped_to_entity", entity],
      ["has_skill", skill],
    ]) {
      await cache.putEdge({
        edgeId: crypto.randomUUID(),
        edgeType: type!,
        fromNodeId: person,
        toNodeId: target!,
        effectiveFrom: null,
        effectiveTo: null,
        isSoftDeleted: false,
        version: 1,
        record: { metadata: { proficiency_level: "Senior", verified: true } },
      });
    }
    const rows = await listEmployeesForDirectory(database);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.employeeId === person)).toMatchObject({
      version: 7,
      lifecycleStatus: "Inactive",
      entityName: "Real Entity",
      managerName: "Grace",
    });
    expect(JSON.stringify(rows)).not.toContain("987654");
    expect(await getEmployeeForProfile(database, person)).toMatchObject({
      skills: [{ name: "TypeScript", proficiency: "Senior", verified: true }],
      certifications: [],
      documents: [],
      activity: [],
    });
    expect(await getEmployeeForProfile(database, crypto.randomUUID())).toBeNull();
    await database.close();
  });
});

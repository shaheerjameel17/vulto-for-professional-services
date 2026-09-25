import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteCache } from "../sync-client/cache";
import { openTestDatabase } from "../sync-client/test-database";
import { getSkillHolders, getSkillMatrix } from "./skill-matrix";

const id = (group: number, value: number) =>
  `${group}0000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

afterEach(() => vi.restoreAllMocks());

describe("the local Skill Matrix queries", () => {
  it("computes twelve holders and three Senior-or-above from cache while offline", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const skillId = id(1, 100);
    await putNode(cache, skillId, "Skill", "Active", {
      name: "React",
      category: "Frontend",
    });
    for (let number = 1; number <= 12; number++) {
      const employeeId = id(1, number);
      await putNode(cache, employeeId, "Employee", "Active", {
        full_name: `Person ${number}`,
        employee_type: "Employee",
      });
      await putHolding(
        cache,
        id(2, number),
        employeeId,
        skillId,
        number <= 3 ? "Senior" : "Intermediate",
        number <= 2,
      );
    }
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("offline"));
    const all = await getSkillMatrix(database);
    expect(all.skills).toEqual([
      {
        skillId,
        name: "React",
        category: "Frontend",
        coverage: 12,
        depth: 3,
        isDeprecated: false,
      },
    ]);
    expect(all.cells).toHaveLength(12);
    expect(all.cells.every((cell) => cell.certified === false)).toBe(true);
    const filtered = await getSkillMatrix(database, {
      category: "Frontend",
      minProficiency: "Senior",
      verifiedOnly: true,
    });
    expect(filtered.cells).toHaveLength(2);
    expect(filtered.skills[0]).toMatchObject({ coverage: 2, depth: 2 });
    expect(fetch).not.toHaveBeenCalled();
    await database.close();
  });

  it("retains deprecated columns and counts Ghost Employee holdings", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const skillId = id(1, 200);
    const ghostId = id(1, 201);
    await putNode(cache, skillId, "Skill", "Deprecated", {
      name: "Legacy stack",
      category: "Legacy",
    });
    await putNode(cache, ghostId, "Employee", "Active", {
      full_name: null,
      job_title: "Planned consultant",
      employee_type: "Ghost",
    });
    await putHolding(cache, id(2, 201), ghostId, skillId, "Expert", false);
    const matrix = await getSkillMatrix(database);
    expect(matrix.employees).toEqual([
      { employeeId: ghostId, isGhost: true, name: "Planned consultant" },
    ]);
    expect(matrix.skills).toMatchObject([
      { isDeprecated: true, coverage: 1, depth: 1 },
    ]);
    expect(matrix.cells).toMatchObject([
      { employeeId: ghostId, skillId, proficiencyLevel: "Expert", certified: false },
    ]);
    await database.close();
  });

  it("ranks holders by the shared proficiency order and uses today's Assignment coverage", async () => {
    const database = await openTestDatabase();
    const cache = new SqliteCache(database);
    const skillId = id(1, 300);
    const assignedId = id(1, 301);
    const availableId = id(1, 302);
    await putNode(cache, skillId, "Skill", "Active", {
      name: "TypeScript",
      category: "Engineering",
    });
    for (const employeeId of [assignedId, availableId]) {
      await putNode(cache, employeeId, "Employee", "Active", {
        full_name: employeeId,
        employee_type: "Employee",
      });
    }
    await putHolding(cache, id(2, 301), assignedId, skillId, "Intermediate", true);
    await putHolding(cache, id(2, 302), availableId, skillId, "Expert", false);
    await putNode(cache, id(1, 303), "Assignment", "Active", {
      employee_id: assignedId,
      start_date: "2026-03-02",
      end_date: "2026-03-03",
    });
    await putNode(cache, id(1, 304), "Assignment", "Canceled", {
      employee_id: availableId,
      start_date: "2026-03-02",
      end_date: "2026-03-03",
    });
    const result = await getSkillHolders(database, skillId, "2026-03-02T12:00:00.000Z");
    expect(result.holders).toMatchObject([
      {
        employeeId: availableId,
        proficiencyLevel: "Expert",
        availabilityStatus: "Available",
        certified: false,
      },
      {
        employeeId: assignedId,
        proficiencyLevel: "Intermediate",
        availabilityStatus: "Assigned",
        certified: false,
      },
    ]);
    await database.close();
  });
});

async function putNode(
  cache: SqliteCache,
  nodeId: string,
  nodeType: string,
  lifecycleStatus: string,
  fields: Record<string, unknown>,
) {
  await cache.putNode({
    nodeId,
    nodeType,
    lifecycleStatus,
    isSoftDeleted: false,
    version: 1,
    record: {
      node_id: nodeId,
      node_type: nodeType,
      lifecycle_status: lifecycleStatus,
      ...fields,
    },
  });
}

async function putHolding(
  cache: SqliteCache,
  edgeId: string,
  employeeId: string,
  skillId: string,
  proficiencyLevel: string,
  verified: boolean,
) {
  await cache.putEdge({
    edgeId,
    edgeType: "has_skill",
    fromNodeId: employeeId,
    toNodeId: skillId,
    effectiveFrom: null,
    effectiveTo: null,
    isSoftDeleted: false,
    version: 1,
    record: {
      edge_id: edgeId,
      edge_type: "has_skill",
      from_node_id: employeeId,
      to_node_id: skillId,
      metadata: { proficiency_level: proficiencyLevel, verified },
    },
  });
}

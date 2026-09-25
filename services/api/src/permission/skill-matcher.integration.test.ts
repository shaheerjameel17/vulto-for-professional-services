import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closeDatabase, db } from "../db.js";
import { resolveProjectCalendarEntity } from "../graph/entity-resolution.js";
import { countWorkingDaysForEntity } from "../graph/working-days.js";
import { getNodes, insertEdge, insertNode, outgoing } from "../graph/store.js";
import { applyMutation } from "../mutations/pipeline.js";
import { skillGapEvaluate } from "../mutations/skill-matcher.js";
import { authorizeWrite, decideRead } from "./interceptor.js";
import { resolveMemberPrincipal } from "./member-principal.js";
import { getMatchResults, adHocSearch } from "./skill-matcher-queries.js";
import { edgeRecord, makeWorkspace, nodeRecord } from "./test-support.js";

afterAll(closeDatabase);
const NOW = "2026-01-05T12:00:00.000Z";

async function world() {
  const fixture = await makeWorkspace({
    hr: ["hr-admin"],
    team: ["team-member"],
    manager: ["team-member"],
  });
  const owner = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.owner!.userId,
    }),
  ))!;
  const hr = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.hr!.userId,
    }),
  ))!;
  const team = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.team!.userId,
    }),
  ))!;
  const manager = (await db.transaction((tx) =>
    resolveMemberPrincipal(tx, {
      workspaceId: fixture.workspaceId,
      userId: fixture.people.manager!.userId,
    }),
  ))!;
  const apply = (who: typeof owner, name: string, args: unknown) =>
    applyMutation(who, { mutation_id: randomUUID(), name, args }, { now: () => NOW });
  const entityResult = await apply(owner, "entity.create", {
    name: "Matcher Entity",
    jurisdiction: "Global",
    default_currency: "USD",
  });
  expect(entityResult.status, JSON.stringify(entityResult)).toBe("applied");
  const entityId = (entityResult.result as { entity_id: string }).entity_id;
  const projectId = randomUUID();
  await db.transaction((tx) =>
    insertNode(tx, {
      ...nodeRecord("Project", fixture.workspaceId, projectId),
      lifecycle_status: "Active",
      name: "Project Match",
      start_date: "2026-02-02",
    }),
  );
  const skillId = randomUUID();
  const skill = await apply(owner, "graph.createNode", {
    node: {
      node_id: skillId,
      node_type: "Skill",
      schema_version: 1,
      lifecycle_status: "Active",
      skill_id: skillId,
      name: "TypeScript",
      category: "Engineering",
    },
  });
  expect(skill.status, JSON.stringify(skill)).toBe("applied");
  const addEmployee = async (userId?: string) => {
    const id = randomUUID();
    const result = await apply(hr, "employee.create", {
      employee_id: id,
      entity_id: entityId,
      effective_from: NOW,
      fields: {
        employee_code: `E-${id}`,
        full_name: `Person ${id}`,
        email: `${id}@example.test`,
        job_title: "Engineer",
        employment_type: "FullTime",
        start_date: "2026-01-05",
      },
    });
    expect(result.status, JSON.stringify(result)).toBe("applied");
    if (userId) {
      const linked = await apply(owner, "employee.linkUser", {
        employee_id: id,
        user_id: userId,
        expected_version: 1,
      });
      expect(linked.status, JSON.stringify(linked)).toBe("applied");
    }
    return id;
  };
  return {
    ...fixture,
    owner,
    hr,
    team,
    manager,
    apply,
    entityId,
    projectId,
    skillId,
    addEmployee,
  };
}

describe("VRS-F013 Skill-to-Project Matcher", () => {
  it("writes and reactively resolves a gap, updates skill identity in place, and keeps ad-hoc read-only", async () => {
    const w = await world();
    const source = await db.transaction((tx) =>
      resolveProjectCalendarEntity(tx, w.workspaceId, w.projectId, NOW),
    );
    expect(source).toBeNull();
    const counted = await db.transaction((tx) =>
      countWorkingDaysForEntity(
        tx,
        w.workspaceId,
        w.entityId,
        "2026-01-06",
        "2026-02-02",
        async () => true,
      ),
    );
    expect(counted.days).toBe(20);
    const requirement = await w.apply(w.owner, "project.attachSkillRequirement", {
      project_id: w.projectId,
      skill_id: w.skillId,
      proficiency_level_required: "Senior",
    });
    expect(requirement.status, JSON.stringify(requirement)).toBe("applied");
    const gaps = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, {
        nodeType: "SkillGap",
        lifecycleStatus: "Active",
      }),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.record).toMatchObject({
      project_id: w.projectId,
      skill_id: w.skillId,
      proficiency_level_required: "Senior",
      severity: "Low",
    });
    const employeeId = await w.addEmployee();
    const first = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: employeeId,
      skill_id: w.skillId,
      proficiency_level: "Intermediate",
    });
    expect(first.status, JSON.stringify(first)).toBe("applied");
    const second = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: employeeId,
      skill_id: w.skillId,
      proficiency_level: "Senior",
    });
    expect(second.status, JSON.stringify(second)).toBe("applied");
    expect((second.result as { edge_id: string }).edge_id).toBe(
      (first.result as { edge_id: string }).edge_id,
    );
    const edges = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, employeeId, "has_skill"),
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.record["metadata"]).toMatchObject({
      proficiency_level: "Senior",
      verified: true,
    });
    const resolved = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, {
        nodeType: "SkillGap",
        lifecycleStatus: "Resolved",
      }),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.record["resolved_by"]).toBe("system");
    const result = await db.transaction((tx) =>
      getMatchResults(tx, w.owner, w.projectId),
    );
    expect(result?.perRequirement[0]?.matches[0]?.employeeId).toBe(employeeId);
    const before = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "SkillGap" }),
    );
    const beforeRequirements = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, w.projectId, "requires_skill"),
    );
    const beforeHoldings = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, employeeId, "has_skill"),
    );
    const adHoc = await db.transaction((tx) => adHocSearch(tx, w.owner, "type"));
    expect(adHoc.results[0]?.matches[0]?.employeeId).toBe(employeeId);
    const after = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "SkillGap" }),
    );
    expect(after).toHaveLength(before.length);
    expect(
      await db.transaction((tx) =>
        outgoing(tx, w.workspaceId, w.projectId, "requires_skill"),
      ),
    ).toEqual(beforeRequirements);
    expect(
      await db.transaction((tx) =>
        outgoing(tx, w.workspaceId, employeeId, "has_skill"),
      ),
    ).toEqual(beforeHoldings);
  });
  it("refuses generic writes to feature-owned edges while named paths remain live", async () => {
    const w = await world();
    const employeeId = await w.addEmployee();
    for (const [edgeType, fromNodeId] of [
      ["has_skill", employeeId],
      ["requires_skill", w.projectId],
    ] as const) {
      const denied = await w.apply(w.owner, "graph.createEdge", {
        edge: {
          edge_id: randomUUID(),
          edge_type: edgeType,
          from_node_id: fromNodeId,
          to_node_id: w.skillId,
          effective_from: NOW,
          effective_to: null,
          metadata: { proficiency_level: "Expert", verified: true },
        },
      });
      expect(denied).toMatchObject({
        status: "rejected",
        reason: "requires-feature-mutation",
      });
    }
    const holding = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: employeeId,
      skill_id: w.skillId,
      proficiency_level: "Senior",
    });
    const requirement = await w.apply(w.owner, "project.attachSkillRequirement", {
      project_id: w.projectId,
      skill_id: w.skillId,
      proficiency_level_required: "Senior",
    });
    for (const result of [holding, requirement]) {
      expect(result.status, JSON.stringify(result)).toBe("applied");
      const denied = await w.apply(w.owner, "graph.updateEdgeMetadata", {
        edge_id: (result.result as { edge_id: string }).edge_id,
        metadata: { proficiency_level: "Expert" },
      });
      expect(denied).toMatchObject({
        status: "rejected",
        reason: "requires-feature-mutation",
      });
    }
  });

  it("reads qualifying candidates workspace-wide without widening node or edge writes", async () => {
    const w = await world();
    const managerId = await w.addEmployee(w.people.manager!.userId);
    const reportId = await w.addEmployee();
    const candidateId = await w.addEmployee();
    await db.transaction((tx) =>
      insertEdge(tx, w.workspaceId, edgeRecord("managed_by", reportId, managerId, NOW)),
    );
    const held = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: candidateId,
      skill_id: w.skillId,
      proficiency_level: "Expert",
    });
    expect(held.status, JSON.stringify(held)).toBe("applied");
    const requirement = await w.apply(w.owner, "project.attachSkillRequirement", {
      project_id: w.projectId,
      skill_id: w.skillId,
      proficiency_level_required: "Senior",
    });
    expect(requirement.status, JSON.stringify(requirement)).toBe("applied");
    for (const principal of [w.manager, w.team]) {
      const cards = await db.transaction((tx) =>
        getMatchResults(tx, principal, w.projectId),
      );
      expect(
        cards?.perRequirement[0]?.matches.map((match) => match.employeeId),
      ).toContain(candidateId);
      const read = await db.transaction((tx) =>
        decideRead(tx, principal, {
          workspaceId: w.workspaceId,
          nodeType: "Employee",
          nodeId: candidateId,
          partitionKey: "operational",
        }),
      );
      expect(["read", "full"]).toContain(read.access);
      const write = await db.transaction((tx) =>
        authorizeWrite(
          tx,
          principal,
          {
            kind: "node",
            workspaceId: w.workspaceId,
            nodeType: "Employee",
            nodeId: candidateId,
            partitionKey: "operational",
          },
          { operation: "update" },
        ),
      );
      expect(write.allowed).toBe(false);
      const edgeWrite = await db.transaction((tx) =>
        authorizeWrite(
          tx,
          principal,
          {
            kind: "edge",
            workspaceId: w.workspaceId,
            edgeType: "has_skill",
            edgeId: randomUUID(),
            fromNodeType: "Employee",
            fromNodeId: candidateId,
            toNodeType: "Skill",
            toNodeId: w.skillId,
          },
          { operation: "create" },
        ),
      );
      expect(edgeWrite.allowed).toBe(false);
    }
    const gaps = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, {
        nodeType: "SkillGap",
        lifecycleStatus: "Active",
      }),
    );
    expect(gaps).toHaveLength(0);
    expect(
      await skillGapEvaluate(w.workspaceId, w.projectId, w.skillId, NOW),
    ).toBeNull();
  });

  it("derives verification server-side for self and independent HR writes", async () => {
    const w = await world();
    const ownId = await w.addEmployee(w.people.hr!.userId);
    const otherId = await w.addEmployee();
    const self = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: ownId,
      skill_id: w.skillId,
      proficiency_level: "Beginner",
    });
    const other = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: otherId,
      skill_id: w.skillId,
      proficiency_level: "Beginner",
    });
    expect(self.status, JSON.stringify(self)).toBe("applied");
    expect(other.status, JSON.stringify(other)).toBe("applied");
    const ownEdges = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, ownId, "has_skill"),
    );
    const otherEdges = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, otherId, "has_skill"),
    );
    expect(ownEdges[0]?.record["metadata"]).toMatchObject({
      verified: false,
      verified_by: null,
      verified_at: null,
    });
    expect(otherEdges[0]?.record["metadata"]).toMatchObject({
      verified: true,
      verified_by: w.hr.userId,
      verified_at: NOW,
    });
    const forged = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: ownId,
      skill_id: w.skillId,
      proficiency_level: "Senior",
      verified: true,
    });
    expect(forged).toMatchObject({ status: "rejected", reason: "invalid-args" });
  });

  it("ranks real people before Ghosts at equal availability and excludes late assignments", async () => {
    const w = await world();
    const available = await w.addEmployee();
    const soon = await w.addEmployee();
    const late = await w.addEmployee();
    for (const id of [available, soon, late]) {
      const attached = await w.apply(w.hr, "employee.attachSkill", {
        employee_id: id,
        skill_id: w.skillId,
        proficiency_level: "Senior",
      });
      expect(attached.status, JSON.stringify(attached)).toBe("applied");
    }
    for (const [employeeId, endDate] of [
      [soon, "2026-01-20"],
      [late, "2026-03-01"],
    ] as const) {
      const assignment = await w.apply(w.hr, "assignment.create", {
        employee_id: employeeId,
        project_id: w.projectId,
        start_date: "2026-01-05",
        end_date: endDate,
        billable_percentage: 100,
      });
      expect(assignment.status, JSON.stringify(assignment)).toBe("applied");
    }
    const ghost = await w.apply(w.hr, "ghostResource.create", {
      role_title: "Planned TypeScript consultant",
      projected_start_date: "2026-01-21",
      seniority_level: "Senior",
      target_skill_ids: [w.skillId],
    });
    expect(ghost.status, JSON.stringify(ghost)).toBe("applied");
    const ghostId = (ghost.result as { employeeId: string }).employeeId;
    const ghostHolding = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: ghostId,
      skill_id: w.skillId,
      proficiency_level: "Senior",
    });
    expect(ghostHolding.status, JSON.stringify(ghostHolding)).toBe("applied");
    const requirement = await w.apply(w.owner, "project.attachSkillRequirement", {
      project_id: w.projectId,
      skill_id: w.skillId,
      proficiency_level_required: "Senior",
    });
    expect(requirement.status, JSON.stringify(requirement)).toBe("applied");
    const secondSkillId = randomUUID();
    const secondSkill = await w.apply(w.owner, "graph.createNode", {
      node: {
        node_id: secondSkillId,
        node_type: "Skill",
        schema_version: 1,
        lifecycle_status: "Active",
        skill_id: secondSkillId,
        name: "Architecture",
        category: "Engineering",
      },
    });
    expect(secondSkill.status, JSON.stringify(secondSkill)).toBe("applied");
    const secondHolding = await w.apply(w.hr, "employee.attachSkill", {
      employee_id: available,
      skill_id: secondSkillId,
      proficiency_level: "Expert",
    });
    expect(secondHolding.status, JSON.stringify(secondHolding)).toBe("applied");
    const secondRequirement = await w.apply(w.owner, "project.attachSkillRequirement", {
      project_id: w.projectId,
      skill_id: secondSkillId,
      proficiency_level_required: "Expert",
    });
    expect(secondRequirement.status, JSON.stringify(secondRequirement)).toBe("applied");
    const results = await db.transaction((tx) =>
      getMatchResults(tx, w.owner, w.projectId, 30, NOW),
    );
    expect(results?.perRequirement).toHaveLength(2);
    const matches = results?.perRequirement.find(
      (row) => row.skillId === w.skillId,
    )?.matches;
    expect(matches?.map((match) => match.employeeId)).toEqual([
      available,
      soon,
      ghostId,
    ]);
    expect(matches?.map((match) => match.availabilityDate)).toEqual([
      null,
      "2026-01-21",
      "2026-01-21",
    ]);
    expect(matches?.map((match) => match.isGhost)).toEqual([false, false, true]);
    expect(
      results?.perRequirement
        .find((row) => row.skillId === secondSkillId)
        ?.matches.map((match) => match.employeeId),
    ).toEqual([available]);
    const nearOnly = await db.transaction((tx) =>
      getMatchResults(tx, w.owner, w.projectId, 10, NOW),
    );
    expect(
      nearOnly?.perRequirement
        .find((row) => row.skillId === w.skillId)
        ?.matches.map((match) => match.employeeId),
    ).toEqual([available]);
  });

  it("lets a Manager attach a requirement while only the system evaluator writes the gap", async () => {
    const w = await world();
    const managerId = await w.addEmployee(w.people.manager!.userId);
    const reportId = await w.addEmployee();
    await db.transaction((tx) =>
      insertEdge(tx, w.workspaceId, edgeRecord("managed_by", reportId, managerId, NOW)),
    );
    const directGapWrite = await db.transaction((tx) =>
      authorizeWrite(
        tx,
        w.manager,
        {
          kind: "node",
          workspaceId: w.workspaceId,
          nodeType: "SkillGap",
          nodeId: randomUUID(),
          partitionKey: "record",
        },
        { operation: "create" },
      ),
    );
    expect(directGapWrite.allowed).toBe(false);
    const requirement = await w.apply(w.manager, "project.attachSkillRequirement", {
      project_id: w.projectId,
      skill_id: w.skillId,
      proficiency_level_required: "Senior",
    });
    expect(requirement.status, JSON.stringify(requirement)).toBe("applied");
    const gaps = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, {
        nodeType: "SkillGap",
        lifecycleStatus: "Active",
      }),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.record).toMatchObject({
      project_id: w.projectId,
      skill_id: w.skillId,
      severity: "Low",
    });
  });

  it("uses the earliest-staffed Assignment's Entity calendar for gap severity", async () => {
    const w = await world();
    const staffedId = await w.addEmployee();
    const assignment = await w.apply(w.hr, "assignment.create", {
      employee_id: staffedId,
      project_id: w.projectId,
      start_date: "2026-01-05",
      end_date: "2026-01-30",
      billable_percentage: 100,
    });
    expect(assignment.status, JSON.stringify(assignment)).toBe("applied");
    const source = await db.transaction((tx) =>
      resolveProjectCalendarEntity(tx, w.workspaceId, w.projectId, NOW),
    );
    expect(source?.nodeId).toBe(w.entityId);
    const counted = await db.transaction((tx) =>
      countWorkingDaysForEntity(
        tx,
        w.workspaceId,
        source!.nodeId,
        "2026-01-06",
        "2026-02-02",
        async () => true,
      ),
    );
    expect(counted.days).toBe(20);
    const requirement = await w.apply(w.owner, "project.attachSkillRequirement", {
      project_id: w.projectId,
      skill_id: w.skillId,
      proficiency_level_required: "Senior",
    });
    expect(requirement.status, JSON.stringify(requirement)).toBe("applied");
    const gaps = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, {
        nodeType: "SkillGap",
        lifecycleStatus: "Active",
      }),
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.record["severity"]).toBe("High");
  });

  it("authorizes a Pitch requirement through its declared identifying partition", async () => {
    const w = await world();
    const pitchId = randomUUID();
    await db.transaction((tx) =>
      insertNode(tx, {
        ...nodeRecord("Pitch", w.workspaceId, pitchId),
        name: "Potential engagement",
      }),
    );
    const edgeId = randomUUID();
    const decision = await db.transaction((tx) =>
      authorizeWrite(
        tx,
        w.owner,
        {
          kind: "edge",
          workspaceId: w.workspaceId,
          edgeType: "requires_skill",
          edgeId,
          fromNodeType: "Pitch",
          fromNodeId: pitchId,
          toNodeType: "Skill",
          toNodeId: w.skillId,
        },
        { operation: "create" },
      ),
    );
    expect(decision.allowed).toBe(true);
    const edge = await db.transaction((tx) =>
      insertEdge(tx, w.workspaceId, {
        ...edgeRecord("requires_skill", pitchId, w.skillId, NOW),
        edge_id: edgeId,
        metadata: { proficiency_level_required: "Senior" },
      }),
    );
    expect(edge.record["metadata"]).toMatchObject({
      proficiency_level_required: "Senior",
    });
  });

  it("keeps an unmatched ad-hoc search read-only", async () => {
    const w = await world();
    const beforeEdges = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, w.projectId, "requires_skill"),
    );
    const result = await db.transaction((tx) =>
      adHocSearch(tx, w.team, "typescript", 30, NOW),
    );
    expect(result.results[0]?.matches).toEqual([]);
    const afterEdges = await db.transaction((tx) =>
      outgoing(tx, w.workspaceId, w.projectId, "requires_skill"),
    );
    const gaps = await db.transaction((tx) =>
      getNodes(tx, w.workspaceId, { nodeType: "SkillGap" }),
    );
    expect(afterEdges).toEqual(beforeEdges);
    expect(gaps).toHaveLength(0);
  });
});

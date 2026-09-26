import {
  computeLeaveBalance,
  leavePolicyFieldsSchema,
  resolvePolicyCell,
  type LeaveType,
} from "@vulto/schema";
import { getNode, getNodes, type GraphTx, type StoredNode } from "../graph/store.js";
import { resolveForEmployee } from "../graph/entity-resolution.js";
import { countWorkingDays } from "../graph/working-days.js";
import { filterReadable, authorizeRead } from "./interceptor.js";
import { effectiveRoles } from "./roles.js";
import type { MemberPrincipal } from "./principal.js";

async function employeeFor(tx: GraphTx, principal: MemberPrincipal, id: string) {
  const node = await getNode(tx, principal.workspaceId, id);
  if (!node || node.isSoftDeleted || node.nodeType !== "Employee") return null;
  const rows = await filterReadable(tx, principal, [node]);
  return rows.find((row): row is StoredNode => !("restricted" in row)) ?? null;
}

async function matchingPolicies(
  tx: GraphTx,
  principal: MemberPrincipal,
  employee: StoredNode,
  date: string,
) {
  const entity = await resolveForEmployee(
    tx,
    principal.workspaceId,
    employee.nodeId,
    `${date}T12:00:00.000Z`,
  );
  if (!entity || entity.isSoftDeleted) return [];
  const decision = await authorizeRead(tx, principal, {
    workspaceId: principal.workspaceId,
    nodeType: "Entity",
    nodeId: entity.nodeId,
  });
  if (decision.access !== "read" && decision.access !== "full") return [];
  const policies = await filterReadable(
    tx,
    principal,
    await getNodes(tx, principal.workspaceId, { nodeType: "LeavePolicy" }),
  );
  return policies
    .filter((row): row is StoredNode => !("restricted" in row))
    .map((row) => leavePolicyFieldsSchema.parse(row.record))
    .filter(
      (policy) =>
        policy.is_active &&
        policy.jurisdiction === entity.record["jurisdiction"] &&
        (policy.employment_type_scope === "All" ||
          policy.employment_type_scope === employee.record["employment_type"]),
    )
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.node_id.localeCompare(a.node_id),
    );
}

export async function getApplicable(
  tx: GraphTx,
  principal: MemberPrincipal,
  employeeId: string,
  date = new Date().toISOString().slice(0, 10),
) {
  const employee = await employeeFor(tx, principal, employeeId);
  if (!employee) return null;
  const policies = await matchingPolicies(tx, principal, employee, date);
  return {
    policy: policies[0] ?? null,
    conflicting_policy_ids: policies.slice(1).map((p) => p.node_id),
  };
}

export async function listConflicts(
  tx: GraphTx,
  principal: MemberPrincipal,
  workspaceId: string,
  date = new Date().toISOString().slice(0, 10),
) {
  if (workspaceId !== principal.workspaceId) return null;
  const roles = await effectiveRoles(tx, principal);
  if (
    !roles.some((role) => {
      const cell = resolvePolicyCell(role, "LeavePolicy", "record");
      return cell.outcome === "full" && cell.scope === "any";
    })
  )
    return null;
  const employees = await filterReadable(
    tx,
    principal,
    await getNodes(tx, workspaceId, { nodeType: "Employee" }),
  );
  const conflicts: { employee_id: string; policy_ids: string[] }[] = [];
  for (const employee of employees) {
    if ("restricted" in employee) continue;
    const matches = await matchingPolicies(tx, principal, employee, date);
    if (matches.length > 1)
      conflicts.push({
        employee_id: employee.nodeId,
        policy_ids: matches.map((p) => p.node_id),
      });
  }
  return conflicts.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
}

/** F332: usage is deliberately empty until VRS-F019 defines approved LeaveRequest records. */
export async function computeBalance(
  tx: GraphTx,
  principal: MemberPrincipal,
  employeeId: string,
  leaveType: LeaveType,
  date = new Date().toISOString().slice(0, 10),
) {
  const employee = await employeeFor(tx, principal, employeeId);
  if (!employee) return null;
  const [policy] = await matchingPolicies(tx, principal, employee, date);
  if (!policy) return null;
  const lineage = [policy];
  const seen = new Set([policy.node_id]);
  let priorId = policy.supersedes_id;
  while (priorId !== null) {
    if (seen.has(priorId)) throw new Error("invalid-policy-lineage");
    seen.add(priorId);
    const node = await getNode(tx, principal.workspaceId, priorId);
    if (!node || node.isSoftDeleted || node.nodeType !== "LeavePolicy")
      throw new Error("invalid-policy-lineage");
    const [readable] = await filterReadable(tx, principal, [node]);
    if (!readable || "restricted" in readable) return null;
    const prior = leavePolicyFieldsSchema.parse(readable.record);
    lineage.push(prior);
    priorId = prior.supersedes_id;
  }
  const start = employee.record["start_date"];
  if (typeof start !== "string") return null;
  return computeLeaveBalance(
    {
      employee: { start_date: start },
      policyVersions: lineage,
      leave_type: leaveType,
      as_of_date: date,
      usage: [],
    },
    {
      countWorkingDays: async (from, to) =>
        (
          await countWorkingDays(
            tx,
            principal.workspaceId,
            employeeId,
            from,
            to,
            async (node) => {
              const decision = await authorizeRead(tx, principal, {
                workspaceId: principal.workspaceId,
                nodeType: node.nodeType as
                  | "Employee"
                  | "Entity"
                  | "WorkingCalendar"
                  | "Holiday"
                  | "WorkingPattern",
                nodeId: node.nodeId,
              });
              return decision.access === "read" || decision.access === "full";
            },
          )
        ).days,
    },
  );
}

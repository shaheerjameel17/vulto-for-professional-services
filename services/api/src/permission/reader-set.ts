import {
  getSubjectExclusion,
  POLICY_ROLES,
  resolvePolicyCell,
  type NodeType,
  type PolicyRole,
} from "@vulto/schema";
import { and, eq, sql } from "drizzle-orm";
import { member, organization, user } from "../auth/schema.js";
import { outgoing, type GraphTx } from "../graph/store.js";
import { resolveEmployeeForUser, resolveUserForEmployee } from "./employee-link.js";

/**
 * FDN-89 (partial) — one concrete, canonically ordered set of people who may
 * read a protected partition of a record, resolved from the effective grant,
 * the row's identity and its registered subject exclusion (A004-T16).
 *
 * "Refused or deferred rather than guessed at" (VPS-A004): wherever the answer
 * needs the User-to-Employee link, which does not exist yet (RST-33), the
 * result is `unresolvable`, never a guess. Two situations need it:
 *  - a role's grant is row-scoped ("own", "direct reports", participant...):
 *    who those people are depends on which Employee the row belongs to;
 *  - the node type registers a subject exclusion: every candidate reader must
 *    be checked against the subject, which needs each reader's Employee.
 */
export type ReaderSetResolution =
  | { readonly kind: "resolved"; readonly userIds: readonly string[] }
  | { readonly kind: "unresolvable" };

const UNRESOLVABLE: ReaderSetResolution = { kind: "unresolvable" };

export interface ReaderSetDependencies {
  readonly resolveEmployeeForUser: typeof resolveEmployeeForUser;
}

const defaults: ReaderSetDependencies = { resolveEmployeeForUser };

async function activeMembersWithRole(
  tx: GraphTx,
  workspaceId: string,
  role: PolicyRole,
): Promise<string[]> {
  const rows = await tx
    .select({ userId: member.userId })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.status, "active"),
        eq(member.projectionState, "confirmed"),
        eq(user.status, "active"),
        eq(organization.status, "active"),
        sql`${member.role} ~ ${`(^|,)${role}($|,)`}`,
      ),
    );
  return rows.map((row) => row.userId);
}

/** The Employee a record concerns, by following its subject path; `null` if none is recorded. */
export async function resolveSubjectEmployee(
  tx: GraphTx,
  workspaceId: string,
  nodeType: NodeType,
  nodeId: string,
): Promise<string | null> {
  const exclusion = getSubjectExclusion(nodeType);
  if (exclusion === undefined) return null;
  let current = nodeId;
  for (const edgeType of exclusion.subjectPath) {
    const [edge] = await outgoing(tx, workspaceId, current, edgeType);
    if (!edge) return null;
    current = edge.toNodeId;
  }
  return current;
}

export async function resolveReaderSet(
  tx: GraphTx,
  input: {
    readonly workspaceId: string;
    readonly nodeType: NodeType;
    readonly partitionKey: string;
    /** The Employee the record concerns, where the type registers an exclusion. */
    readonly subjectEmployeeId: string | null;
  },
  deps: ReaderSetDependencies = defaults,
): Promise<ReaderSetResolution> {
  const readers = new Set<string>();
  for (const role of POLICY_ROLES) {
    const cell = resolvePolicyCell(role, input.nodeType, input.partitionKey);
    if (cell.outcome !== "full" && cell.outcome !== "read") continue;
    // A grant that depends on the row, or on a derived Manager, needs the link.
    // `own` is decided from it: the only reader such a grant adds is the person
    // the record concerns, if they hold the role and have a login. Every other
    // row-dependent scope, and a derived Manager, is still unresolvable.
    if (role === "manager") return UNRESOLVABLE;
    if (cell.scope === "own" && input.subjectEmployeeId !== null) {
      const owner = await resolveUserForEmployee(
        tx,
        input.workspaceId,
        input.subjectEmployeeId,
      );
      const holders = await activeMembersWithRole(tx, input.workspaceId, role);
      if (owner !== null && holders.includes(owner)) readers.add(owner);
      continue;
    }
    if (cell.scope !== "any") return UNRESOLVABLE;
    for (const userId of await activeMembersWithRole(tx, input.workspaceId, role)) {
      readers.add(userId);
    }
  }

  if (getSubjectExclusion(input.nodeType) !== undefined) {
    // Without the subject, or without a way to tell who each reader is, the
    // exclusion cannot be applied — and applying none would be the F130 gap.
    if (input.subjectEmployeeId === null) return UNRESOLVABLE;
    for (const userId of [...readers]) {
      const employeeId = await deps.resolveEmployeeForUser(
        tx,
        input.workspaceId,
        userId,
      );
      if (employeeId === null) return UNRESOLVABLE;
      if (employeeId === input.subjectEmployeeId) readers.delete(userId);
    }
  }
  return { kind: "resolved", userIds: [...readers].sort() };
}

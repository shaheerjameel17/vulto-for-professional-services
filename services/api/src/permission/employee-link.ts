import { findNodeByRecordField, getNode, type GraphTx } from "../graph/store.js";

/**
 * The one place the User-to-Employee identity link is read.
 *
 * "Own record", direct-report Manager scope, participant and recipient grants,
 * and subject exclusion all need to know which Employee node a User is. The
 * link is the Employee's `user_id` (VRS-F002), set only by `employee.linkUser`,
 * which allows one Employee per person per workspace. `null` means the person
 * has no Employee record, and every caller treats `null` as "cannot tell" and
 * resolves to the conservative outcome rather than guessing.
 */
export async function resolveEmployeeForUser(
  tx: GraphTx,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const employee = await findNodeByRecordField(
    tx,
    workspaceId,
    "Employee",
    "user_id",
    userId,
  );
  return employee?.nodeId ?? null;
}

/**
 * The reverse: which login an Employee is, or `null` when the person has none
 * (employment and system access are separate facts).
 */
export async function resolveUserForEmployee(
  tx: GraphTx,
  workspaceId: string,
  employeeId: string,
): Promise<string | null> {
  const employee = await getNode(tx, workspaceId, employeeId);
  const userId = (employee?.record as Record<string, unknown> | undefined)?.["user_id"];
  return typeof userId === "string" ? userId : null;
}

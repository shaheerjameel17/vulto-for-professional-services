import type { GraphTx } from "../graph/store.js";

/**
 * The one place the User-to-Employee identity link is read.
 *
 * "Own record", direct-report Manager scope, participant and recipient grants,
 * and subject exclusion all need to know which Employee node a User is. That
 * link does not exist yet: `VRS-F002` / RST-33 (the canonical Employee
 * profile) creates it. Until then this returns `null`, and every caller
 * treats `null` as "cannot tell" and resolves to the conservative outcome
 * rather than guessing at a link.
 */
export async function resolveEmployeeForUser(
  _tx: GraphTx,
  _workspaceId: string,
  _userId: string,
): Promise<string | null> {
  return null;
}

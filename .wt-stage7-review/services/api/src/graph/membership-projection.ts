import type { GraphTx, StoredNode } from "./store.js";
import { grantMembershipProjectionAuthority, insertUserNode } from "./store.js";

/**
 * The membership projection — the only caller allowed to write a `User` row
 * (F204). A person is stored once per workspace they belong to, under their
 * Better Auth account id. `pnpm arch:check` fails the build if any other file
 * references `grantMembershipProjectionAuthority`.
 */
export function writeMembershipUser(
  tx: GraphTx,
  workspaceId: string,
  record: unknown,
): Promise<StoredNode> {
  return insertUserNode(tx, workspaceId, record, grantMembershipProjectionAuthority());
}

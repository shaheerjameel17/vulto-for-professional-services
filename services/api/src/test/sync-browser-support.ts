/**
 * What the Stage 6 browser suite (packages/graph/sync-browser-tests) needs from
 * the API's own modules, gathered in one place: the suite seeds the database
 * through the real pipeline and inspects it, and `packages/graph` deliberately
 * has no dependency on Drizzle.
 */
export { eq, sql } from "drizzle-orm";
export { audienceMaterializer } from "../audience/materializer.js";
export { user, member, session, device } from "../auth/schema.js";
export {
  admitWorkspaceMember,
  confirmWorkspaceAdmission,
  createPendingWorkspaceAdmission,
  revokeWorkspaceAdmission,
} from "../auth/workspace-session.js";
export { db } from "../db.js";
export { graphMutations } from "../graph/schema.js";
export { applyMutation } from "../mutations/pipeline.js";
export { resolveMemberPrincipal } from "../permission/member-principal.js";
export { addNode, makeWorkspace } from "../permission/test-support.js";
export { getKeyServices } from "../crypto/keys.js";
export { writeProtected } from "../protected/write.js";

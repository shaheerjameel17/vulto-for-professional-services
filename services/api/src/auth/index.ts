export { auth } from "./config.js";
export {
  UnauthorizedWorkspaceSessionError,
  confirmWorkspaceAdmission,
  confirmWorkspaceRevocationProjection,
  createPendingWorkspaceAdmission,
  requireCurrentWorkspaceSession,
  revokeWorkspaceAdmission,
  suspendUserAndRevokeSessions,
  type CurrentWorkspaceSession,
  type PendingWorkspaceAdmission,
} from "./workspace-session.js";

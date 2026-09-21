export { auth } from "./config.js";
export {
  UnauthorizedWorkspaceSessionError,
  confirmWorkspaceAdmission,
  createPendingWorkspaceAdmission,
  requireCurrentWorkspaceSession,
  revokeWorkspaceAdmission,
  suspendUserAndRevokeSessions,
  type CurrentWorkspaceSession,
  type PendingWorkspaceAdmission,
} from "./workspace-session.js";
export {
  WorkspaceProjectionDeniedError,
  changeWorkspaceRole,
  createWorkspace,
  membershipInEdgeId,
  membershipOfEdgeId,
  revokeMembershipForActor,
  roleChangeDirection,
  type CreatedWorkspace,
  type RoleChangeDirection,
} from "./workspace-projection.js";

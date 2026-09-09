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
export {
  WorkspaceProjectionDeniedError,
  consumeWorkspaceProjectionGrant,
  createWorkspaceWithPendingOwner,
  confirmWorkspaceProjection,
  membershipInEdgeId,
  membershipOfEdgeId,
  mintWorkspaceProjectionGrant,
  PROJECTION_GRANT_PREFIX,
  PROJECTION_GRANT_TTL_SECONDS,
  type ConsumedProjectionGrant,
  type WorkspaceProjectionGrant,
} from "./workspace-projection.js";

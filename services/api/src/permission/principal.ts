import {
  type NodeType,
  type SystemPrincipalName,
  type WorkspaceRole,
} from "@vulto/schema";

/**
 * The parties the interceptor evaluates (VPS-A004 "Role definitions" and
 * "Principals that are not members"). One discriminated union; a principal is
 * built on the server from a verified session or a server-side grant and is
 * never taken from client input.
 */

/** A person, resolved from the central Better Auth membership row on every request. */
export interface MemberPrincipal {
  readonly kind: "member";
  readonly userId: string;
  readonly workspaceId: string;
  readonly membershipId: string;
  /** The stored roles. Manager is derived from `managed_by` edges, never stored. */
  readonly roles: readonly WorkspaceRole[];
}

/**
 * What an Owner-approved access request grants (VPS-A008): a mode and the node
 * types ("areas") it covers. A support principal is evaluated against the same
 * policy table as a member, capped at this scope and never above Owner (F206).
 */
export interface SupportScope {
  readonly access: "read" | "read-write";
  readonly node_types: readonly NodeType[];
}

/** An Owner-approved, time-boxed staff grant (VPS-A008). Nothing issues one yet (FDN-106). */
export interface SupportPrincipal {
  readonly kind: "support";
  readonly grantId: string;
  readonly workspaceId: string;
  readonly scope: SupportScope;
  readonly expiresAt: string;
}

/** A named identity for a system job, whose operations the policy table lists. */
export interface SystemPrincipal {
  readonly kind: "system";
  readonly name: SystemPrincipalName;
  readonly workspaceId: string;
}

export type Principal = MemberPrincipal | SupportPrincipal | SystemPrincipal;

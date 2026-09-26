import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { auth } from "./auth/config.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
} from "./auth/workspace-session.js";
import {
  MIN_CLIENT_SCHEMA_VERSION,
  SCHEMA_VERSION_HEADER,
  WORKSPACE_HEADER,
} from "@vulto/schema";
import type { MemberPrincipal } from "./permission/principal.js";
import { withNotificationDelivery } from "./mutations/notification-delivery.js";

/**
 * The tRPC context: who is calling, decided on the server.
 *
 * The principal is resolved from the Better Auth session cookie and the
 * session's own active workspace, then checked against the central membership
 * row on every request — never cached, so a role change lands on the very next
 * call (A004-T06, F127). Nothing the client sends in a procedure's input can
 * name or alter it.
 */
export interface Context {
  readonly principal: MemberPrincipal | null;
  /** The client's schema version from `x-vulto-schema-version`, or `null` if absent or malformed. */
  readonly schemaVersion: number | null;
  /** The workspace the client says it is acting in (`x-vulto-workspace-id`), lowercased, or `null` if absent. */
  readonly claimedWorkspaceId: string | null;
  /** The reply, so a procedure can set headers. */
  readonly res: { header(name: string, value: string): unknown };
}

function toHeaders(raw: CreateFastifyContextOptions["req"]["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

export async function createContext({
  req,
  res,
}: CreateFastifyContextOptions): Promise<Context> {
  const headers = toHeaders(req.headers);
  const rawVersion = headers.get(SCHEMA_VERSION_HEADER);
  const schemaVersion =
    rawVersion !== null && /^\d+$/.test(rawVersion) ? Number(rawVersion) : null;
  const claimed = headers.get(WORKSPACE_HEADER);
  const claimedWorkspaceId = claimed === null ? null : claimed.trim().toLowerCase();
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  const workspaceId = current?.session.activeOrganizationId;
  if (!current || !workspaceId)
    return { principal: null, schemaVersion, claimedWorkspaceId, res };
  try {
    const admission = await requireCurrentWorkspaceSession(headers, workspaceId);
    return {
      schemaVersion,
      claimedWorkspaceId,
      res,
      principal: {
        kind: "member",
        userId: admission.userId,
        workspaceId: admission.workspaceId,
        membershipId: admission.membershipId,
        roles: admission.roles,
      },
    };
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError)
      return { principal: null, schemaVersion, claimedWorkspaceId, res };
    throw error;
  }
}

export const t = initTRPC.context<Context>().create();

const deliveryProcedure = t.procedure.use(async ({ next }) =>
  withNotificationDelivery(async () => {
    const result = await next();
    // tRPC returns errors as results: do not drain a failed procedure's scope.
    if (!result.ok) throw result.error;
    return result;
  }),
);

export const publicProcedure = deliveryProcedure;

/** A procedure that requires a member principal built by `createContext`. */
export const protectedProcedure = deliveryProcedure.use(({ ctx, next }) => {
  if (ctx.principal === null) throw new TRPCError({ code: "UNAUTHORIZED" });
  // A client that names a workspace must mean the session's. Nothing is applied,
  // read or audited for a request acting in a workspace its session is not in.
  if (
    ctx.claimedWorkspaceId !== null &&
    ctx.claimedWorkspaceId !== ctx.principal.workspaceId.toLowerCase()
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: "workspace-mismatch" });
  }
  return next({ ctx: { principal: ctx.principal } });
});

/**
 * A client below the server's minimum schema version must reload before its
 * queued mutations are accepted (A003-T71). A request that does not state its
 * version cannot be told from a stale one, so it is refused the same way.
 */
export const currentClientProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.schemaVersion === null || ctx.schemaVersion < MIN_CLIENT_SCHEMA_VERSION) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "client-outdated" });
  }
  return next();
});

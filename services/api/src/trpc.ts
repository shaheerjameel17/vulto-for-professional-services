import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { auth } from "./auth/config.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
} from "./auth/workspace-session.js";
import { MIN_CLIENT_SCHEMA_VERSION, SCHEMA_VERSION_HEADER } from "@vulto/schema";
import type { MemberPrincipal } from "./permission/principal.js";

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
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  const workspaceId = current?.session.activeOrganizationId;
  if (!current || !workspaceId) return { principal: null, schemaVersion, res };
  try {
    const admission = await requireCurrentWorkspaceSession(headers, workspaceId);
    return {
      schemaVersion,
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
      return { principal: null, schemaVersion, res };
    throw error;
  }
}

export const t = initTRPC.context<Context>().create();

export const publicProcedure = t.procedure;

/** A procedure that requires a member principal built by `createContext`. */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.principal === null) throw new TRPCError({ code: "UNAUTHORIZED" });
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

import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { auth } from "./auth/config.js";
import {
  requireCurrentWorkspaceSession,
  UnauthorizedWorkspaceSessionError,
} from "./auth/workspace-session.js";
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
}: CreateFastifyContextOptions): Promise<Context> {
  const headers = toHeaders(req.headers);
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  const workspaceId = current?.session.activeOrganizationId;
  if (!current || !workspaceId) return { principal: null };
  try {
    const admission = await requireCurrentWorkspaceSession(headers, workspaceId);
    return {
      principal: {
        kind: "member",
        userId: admission.userId,
        workspaceId: admission.workspaceId,
        membershipId: admission.membershipId,
        roles: admission.roles,
      },
    };
  } catch (error) {
    if (error instanceof UnauthorizedWorkspaceSessionError) return { principal: null };
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

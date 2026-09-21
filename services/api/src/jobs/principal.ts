import type { GraphTx } from "../graph/tx.js";
import { resolveMemberPrincipal } from "../permission/member-principal.js";
import type { Principal } from "../permission/principal.js";
import { db } from "../db.js";

/**
 * A job acts as a principal the interceptor evaluates (A003-T68): the
 * triggering person's grant, re-resolved when the job executes, or a named
 * system principal. If the grant was withdrawn meanwhile the job stops before
 * it reads anything. There is no jobs service yet (FDN-57); this is its
 * wrapper. A job's protected reads go through `readProtected`, which audits
 * exactly as a person's would.
 */
export class PrincipalWithdrawnError extends Error {
  constructor() {
    super("The principal this job acts as no longer holds its grant");
    this.name = "PrincipalWithdrawnError";
  }
}

export async function runAsPrincipal<T>(
  principal: Principal,
  work: (context: {
    readonly tx: GraphTx;
    readonly principal: Principal;
  }) => Promise<T>,
  options: { readonly now?: () => string } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    let current: Principal = principal;
    if (principal.kind === "member") {
      const fresh = await resolveMemberPrincipal(tx, {
        userId: principal.userId,
        workspaceId: principal.workspaceId,
      });
      if (fresh === null) throw new PrincipalWithdrawnError();
      current = fresh;
    } else if (principal.kind === "support") {
      const now = (options.now ?? (() => new Date().toISOString()))();
      if (Date.parse(principal.expiresAt) <= Date.parse(now))
        throw new PrincipalWithdrawnError();
    }
    return work({ tx, principal: current });
  });
}

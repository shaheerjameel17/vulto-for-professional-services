import { initTRPC } from "@trpc/server";
import { sql } from "./db.js";

const t = initTRPC.create();

/**
 * The tRPC root router.
 *
 * One procedure, deliberately. FDN-47 owns structure, tooling, bootstrap and
 * runtime — not features. `system.status` exists to prove one thing: that the
 * chain roster-web -> tRPC -> Fastify -> Drizzle -> Postgres is connected end
 * to end. It is the "minimal end-to-end application path" in FDN-47's done
 * criteria and it is the whole of it.
 *
 * It reads no workspace data and touches no graph node. See the note in
 * apps/roster-web/src/app/diagnostics/page.tsx for why that matters.
 */
export const appRouter = t.router({
  system: t.router({
    status: t.procedure.query(async () => {
      const startedAt = Date.now();
      try {
        const [row] = await sql<{ now: Date }[]>`SELECT now() AS now`;
        return {
          api: "ok" as const,
          database: "ok" as const,
          databaseTime: row?.now?.toISOString() ?? null,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        /*
         * A database that is not up is the expected state before `pnpm
         * stack:up`, so this reports rather than throws. The distinction the
         * diagnostics page needs is "the API is reachable and Postgres is not"
         * versus "nothing is reachable", and an exception here would collapse
         * the two.
         */
        /*
         * postgres-js connects lazily and its connection failures often carry
         * an empty `message` with the useful part in `code`. Reporting only
         * the message renders as "unreachable —", which tells nobody anything.
         */
        const detail =
          error && typeof error === "object"
            ? [
                (error as { code?: string }).code,
                (error as { message?: string }).message,
              ]
                .filter((part) => part && String(part).length > 0)
                .join(" ") || "no detail reported"
            : String(error);

        return {
          api: "ok" as const,
          database: "unreachable" as const,
          databaseTime: null,
          latencyMs: Date.now() - startedAt,
          detail,
        };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;

import { initTRPC } from "@trpc/server";
import { sql } from "./db.js";

const t = initTRPC.create();

/**
 * Render a timestamp the driver returned, whatever shape it chose.
 *
 * The driver's type parsing is not stable across runtimes: under plain node
 * `SELECT now()` came back a `Date`, and under tsx the same query on the same
 * database came back the string `2026-08-12 17:56:00.458496+00` — which is not
 * valid ISO 8601 either, since the offset is `+00` rather than `+00:00`.
 *
 * **This function cannot throw**, and that property is the whole point. A
 * display concern must never be able to report a healthy database as broken.
 * `new Date("...").toISOString()` throws a RangeError on an unparseable value
 * rather than returning null, so the invalid case is checked rather than
 * caught by an optional chain.
 */
function toIsoOrRaw(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string") return null;

  /*
   * Postgres renders the offset as `+00`; ISO 8601 wants `+00:00`. One
   * character, and without it Date parses to Invalid.
   */
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");

  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * The tRPC root router.
 *
 * One procedure, deliberately. FDN-47 owns structure, tooling, bootstrap and
 * runtime — not features. `system.status` exists to prove one thing: that the
 * chain roster-web -> tRPC -> Fastify -> Drizzle -> Postgres is connected end
 * to end. It is the "minimal end-to-end application path" in FDN-47's done
 * criteria and it is the whole of it.
 *
 * It reads no workspace data and touches no graph node: `SELECT now()` runs
 * against a database with no permission context, and that is only acceptable
 * because there is nothing here for a permission layer to protect. It must not
 * be cited as a precedent for unauthenticated data paths — `VPS-A004`'s
 * interceptor is the only place access is decided, and every route that reads
 * workspace data goes through it.
 */
export const appRouter = t.router({
  system: t.router({
    status: t.procedure.query(async () => {
      const startedAt = Date.now();

      let row: { now: unknown } | undefined;
      try {
        /*
         * Only the query is inside this try. Everything after it is outside,
         * deliberately — see the catch.
         *
         * `now` is typed `unknown` rather than `Date` because the driver's
         * type parsing is not stable across runtimes: under plain node this
         * came back a Date, and under tsx the same query on the same database
         * came back the string "2026-08-12 17:56:00.458496+00". Trusting the
         * driver to hand back a Date is a dependency on how the process was
         * started, which is not a thing to depend on.
         */
        [row] = await sql<{ now: unknown }[]>`SELECT now() AS now`;
      } catch (error) {
        /*
         * ONLY a failure to reach the database reaches this branch, because
         * only the query is inside the try. That narrowness is the point.
         *
         * An earlier version wrapped the whole procedure, and a bug in the
         * code below it — a wrong assumption about the driver's return type —
         * was reported to the user as `database: unreachable` while Postgres
         * was up and answering in 52ms. The diagnostics page said the database
         * was down. The database was fine; the caller was broken.
         *
         * That is the same failure VPS-A001's A001-T07 exists to prevent one
         * layer down: a single value standing for several distinct states, so
         * the interface cannot tell them apart. Reporting "not reachable" for
         * "reachable, and I mishandled the answer" sends someone to restart a
         * database that was never the problem.
         *
         * A database that is not up is the expected state before `pnpm
         * stack:up`, so this reports rather than throws.
         *
         * postgres-js connects lazily and its connection failures often carry
         * an empty `message` with the useful part in `code`, which renders as
         * "unreachable —" and tells nobody anything.
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

      /*
       * Reached only when the query succeeded. Normalizing `now` cannot report
       * the database as unreachable, whatever it turns out to be.
       */
      const databaseTime = toIsoOrRaw(row?.now);

      return {
        api: "ok" as const,
        database: "ok" as const,
        databaseTime,
        latencyMs: Date.now() - startedAt,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;

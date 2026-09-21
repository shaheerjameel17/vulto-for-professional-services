import type { Sql } from "postgres";

/**
 * Clears the browser-test database's accumulated rate-limit state.
 *
 * Better Auth limits sign-up to 3 per 60 seconds, which is deliberate and
 * proven under F115 — it is never relaxed to make tests pass. But every spec
 * file in this directory signs up real accounts against the real API, and
 * Playwright runs them in one invocation, so their sign-ups share one window:
 * the fourth one across the whole run fails inside `signUp`, looking like a
 * product defect rather than the test-infrastructure limit it is.
 *
 * The pretest step already truncates this table once before the run. Calling
 * this from each spec file's `beforeAll` applies the same reset per file, so
 * one file's sign-ups cannot exhaust the window for the next. Recorded as
 * F122.
 */
export async function resetRateLimits(sql: Sql): Promise<void> {
  await sql`TRUNCATE TABLE "rate_limit" RESTART IDENTITY`;
}

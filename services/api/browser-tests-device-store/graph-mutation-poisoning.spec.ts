import {
  expect,
  test,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

/**
 * F138 — the permanent, named regression proof for the most severe defect
 * this project has recorded: a correctly-authorized mutation destroying a
 * workspace.
 *
 * `VPS-A004`'s Gate 1 answers exactly one question — may this caller write
 * this node type and this partition. Nothing between the gate and the
 * canonical Loro document asks whether the resulting graph is COHERENT. So a
 * batch can pass the permission gate and then be refused by
 * `materialization.ts` a moment later, at which point its deltas are already
 * merged into the canonical document, because a CRDT merge is not undoable.
 *
 * Everything here is real, to the same standard every prior stage in this
 * project holds itself to: real Chromium, real Postgres, real `SealedStore`
 * behind a real online unlock, real Loro WASM, real SQLite-WASM, and the real
 * production `mutate` protocol message. Nothing is stubbed. In particular the
 * `mutate` path under test IS the application-callable surface — there is no
 * test seam between this proof and production.
 *
 * The four properties under proof, all of which must hold for EVERY poison
 * vector below:
 *
 *   1. An authorized-but-incoherent batch is REFUSED, cleanly, as a returned
 *      outcome — never a throw that takes the Worker down with it.
 *   2. The canonical document is untouched: the refused batch's node is not
 *      queryable afterwards.
 *   3. The runtime still works: a subsequent legitimate mutation applies.
 *   4. The workspace still OPENS on a genuinely new Worker, with its
 *      pre-poison content intact.
 *
 * Property 4 is the one that makes this severe rather than untidy. Before the
 * fix, a poisoned document that reaches disk makes every later `initialize()`
 * re-materialize and throw — the workspace stops opening, permanently, on
 * every device that syncs it.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple mutation poisoning 138!";

/**
 * Large enough that a full re-materialization is slow relative to FDN-50
 * stage 2's 250ms flush debounce, so the window in which a pending flush can
 * carry a freshly-merged poison out to disk is genuinely open rather than
 * theoretically open. Materialization cost is bounded by workspace size by
 * design — this is the documented tradeoff, not a trick.
 */
const BULK_EMPLOYEE_COUNT = 150;

/**
 * Every call into the Worker is raced against this. A Worker that has been
 * terminated by a fatal protocol error leaves `BrowserLocalGraphClient` with
 * `#disposed === false` and `#initialized === true`, so the next call sails
 * past both guards and `postMessage`s into a dead thread — a promise that
 * never settles. Without this race that shows up as an uninformative
 * whole-test timeout; with it, the exact step that hung is named.
 */
const STEP_TIMEOUT_MS = 20_000;

interface MutationOutcomeShape {
  status?: string;
  reason?: string;
  mergedDeltaCount?: number;
  thrown?: string;
}

interface PoisoningDiagnosticsApi {
  initialize(): Promise<void>;
  query(graphQuery: unknown): Promise<{
    kind: string;
    node?: { nodeId: string; nodeType: string; fragments: unknown[] } | null;
    nodes?: { nodeId: string }[];
  }>;
  mutate(base64Snapshots: readonly string[]): Promise<MutationOutcomeShape>;
  poisoning: {
    employeeId: string;
    buildBulk(workspaceId: string, count: number): string;
    buildClean(workspaceId: string): string;
    buildForeignWorkspacePoison(): string;
    buildConflictingNodeTypePoison(workspaceId: string): string;
    buildMalformedRecordPoison(workspaceId: string): string;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: PoisoningDiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-f138-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Mutation Poisoning Browser");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account ready" })).toBeVisible();
  const [user] = await sql<
    { id: string }[]
  >`select "id" from "user" where "email" = ${email}`;
  const cookies = await page.context().cookies(apiOrigin);
  return { email, userId: user.id, cookies };
}

async function createOwnerWorkspace(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Mutation Poisoning Co', ${`poisoning-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

/** Opens the harness on a genuinely fresh Worker and completes the online unlock. */
async function openWorkspace(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * `initialize()`, reported rather than thrown. Property 4 turns on being able
 * to say "the workspace refused to open, and here is exactly why" instead of
 * failing with an opaque page error.
 */
async function tryInitialize(page: Page): Promise<{ opened: boolean; error?: string }> {
  return page.evaluate(async () => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      await api.initialize();
      return { opened: true };
    } catch (error: unknown) {
      return {
        opened: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

type PoisonName =
  | "foreignWorkspace"
  | "conflictingNodeType"
  | "malformedRecord";

interface StepOutcome {
  /** Present when the Worker never answered — the client hung rather than refusing. */
  timedOut?: true;
  /** Present when the call rejected rather than returning an outcome. */
  thrown?: string;
  value?: unknown;
}

interface PoisonRunResult {
  seeded: StepOutcome;
  bulk: StepOutcome;
  poison: StepOutcome;
  queryAfterPoison: StepOutcome;
  poisonNodeVisible?: boolean;
  followUp: StepOutcome;
}

/**
 * Drives one poison vector against a live workspace, entirely inside the
 * page, and reports what happened at each step rather than throwing — so a
 * pre-fix run produces a diagnosis instead of a stack trace.
 *
 * The ordering is the whole point. The bulk batch schedules a debounced
 * flush; the poison is sent immediately afterwards, WITHOUT waiting, so its
 * merge lands inside that still-open window. If the poison merges into the
 * canonical document at all, the pending flush is what carries it to disk.
 */
async function runPoison(
  page: Page,
  workspaceId: string,
  poison: PoisonName,
  bulkCount: number,
  stepTimeoutMs: number,
): Promise<PoisonRunResult> {
  return page.evaluate(
    async ({ id, which, count, stepTimeout }) => {
      const api = window.__vultoGraphPersistenceDiagnostics;
      if (!api) throw new Error("diagnostics API missing");

      /** Races one Worker call against the step timeout, reporting rather than hanging. */
      async function step(run: () => Promise<unknown>): Promise<StepOutcome> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<StepOutcome>((resolve) => {
          timer = setTimeout(() => resolve({ timedOut: true }), stepTimeout);
        });
        try {
          return await Promise.race([
            run().then(
              (value): StepOutcome => ({ value }),
              (error: unknown): StepOutcome => ({
                thrown: error instanceof Error ? error.message : String(error),
              }),
            ),
            timeout,
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      }

      const result: PoisonRunResult = {
        seeded: await step(() => api.mutate([api.poisoning.buildClean(id)])),
        bulk: { value: "not-run" },
        poison: { value: "not-run" },
        queryAfterPoison: { value: "not-run" },
        followUp: { value: "not-run" },
      };

      // Let the seed's own flush settle, so the only open flush window is the
      // bulk batch's.
      await new Promise((resolve) => setTimeout(resolve, 600));

      result.bulk = await step(() => api.mutate([api.poisoning.buildBulk(id, count)]));

      const poisonBytes =
        which === "foreignWorkspace"
          ? api.poisoning.buildForeignWorkspacePoison()
          : which === "conflictingNodeType"
            ? api.poisoning.buildConflictingNodeTypePoison(id)
            : api.poisoning.buildMalformedRecordPoison(id);

      result.poison = await step(() => api.mutate([poisonBytes]));

      // Give any pending debounced flush the chance to fire and carry
      // whatever is now in the document out to disk.
      await new Promise((resolve) => setTimeout(resolve, 900));

      result.queryAfterPoison = await step(() =>
        api.query({
          kind: "node-get",
          nodeId: api.poisoning.employeeId,
          nodeType: "Employee",
          includeSoftDeleted: false,
        }),
      );
      if (result.queryAfterPoison.value !== undefined) {
        // The poison rewrites the SAME employee the clean seed created. Its
        // marker job_title is what distinguishes "the poison landed" from
        // "the clean seed is still there".
        const seen = result.queryAfterPoison.value as {
          node?: { fragments: { partitionKey: string; record: Record<string, unknown> }[] } | null;
        };
        const operational = (seen.node?.fragments ?? []).find(
          (f) => f.partitionKey === "operational",
        );
        result.poisonNodeVisible =
          operational?.record.job_title === "Planted by another workspace";
      }

      result.followUp = await step(() => api.mutate([api.poisoning.buildClean(id)]));

      return result;
    },
    { id: workspaceId, which: poison, count: bulkCount, stepTimeout: stepTimeoutMs },
  );
}

// Deliberately NOT serial. Each vector builds its own workspace and browser
// context, and the shared account is created once in beforeAll — so a failure
// in one vector must not skip the other two. All three poisons need to report,
// because "which vectors are closed" is the question this proof answers.

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    // F122: reset the rate-limit window before this file's own sign-ups.
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("F138 — an authorized-but-incoherent mutation must never poison the graph", () => {
  for (const poison of [
    "foreignWorkspace",
    "conflictingNodeType",
    "malformedRecord",
  ] as const) {
    test(`${poison}: refused cleanly, document untouched, workspace still opens`, async ({
      browser,
    }) => {
      test.setTimeout(180_000);
      const sql = postgres(databaseUrl, { max: 1 });
      let context: BrowserContext | undefined;
      try {
        if (!sharedAccount) throw new Error("shared account was not created");
        context = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await context.newPage();
        await context.addCookies(sharedAccount.cookies);
        const workspaceId = await createOwnerWorkspace(sql, sharedAccount.userId);

        await openWorkspace(page, workspaceId);
        const firstOpen = await tryInitialize(page);
        expect(firstOpen.opened, "a fresh workspace must initialize").toBe(true);

        const run = await runPoison(
          page,
          workspaceId,
          poison,
          BULK_EMPLOYEE_COUNT,
          STEP_TIMEOUT_MS,
        );
        const status = (step: StepOutcome): string | undefined =>
          (step.value as MutationOutcomeShape | undefined)?.status;
        /**
         * A throw out of `mutate` is caught by the harness and REPORTED as
         * the step's value, so it can be told apart from a rejection of the
         * evaluate itself. Both are failures; only this one names the error.
         */
        const reportedThrow = (step: StepOutcome): string | undefined =>
          (step.value as MutationOutcomeShape | undefined)?.thrown;

        // Every assertion below carries the relevant step's full JSON in its
        // own failure message, so a red run is self-diagnosing without this
        // file logging on every green one.

        // Property 1 — the poison is refused as a RETURNED outcome. Not
        // applied, not thrown, and not a hang: a throw becomes a fatal
        // `runtime-failure` that terminates the Worker, which is a
        // denial-of-service on the whole graph rather than a refusal of one
        // batch.
        expect(
          status(run.seeded),
          `the clean seed must apply: ${JSON.stringify(run.seeded)}`,
        ).toBe("applied");
        expect(
          status(run.bulk),
          `the bulk batch must apply: ${JSON.stringify(run.bulk)}`,
        ).toBe("applied");
        expect(
          run.poison.timedOut,
          `the poison must be answered, not hang: ${JSON.stringify(run.poison)}`,
        ).toBeUndefined();
        expect(
          run.poison.thrown ?? reportedThrow(run.poison),
          `the poison must not throw out of mutate: ${JSON.stringify(run.poison)}`,
        ).toBeUndefined();
        expect(
          status(run.poison),
          `the poison must be refused, not applied: ${JSON.stringify(run.poison)}`,
        ).not.toBe("applied");

        // Property 2 — the canonical document never took the poison.
        expect(
          run.queryAfterPoison.timedOut,
          `querying after a refused batch must not hang: ${JSON.stringify(run.queryAfterPoison)}`,
        ).toBeUndefined();
        expect(
          run.queryAfterPoison.thrown,
          `querying after a refused batch must still work: ${JSON.stringify(run.queryAfterPoison)}`,
        ).toBeUndefined();
        expect(run.poisonNodeVisible, "the refused batch must not be visible").toBe(
          false,
        );

        // Property 3 — the runtime is not wedged by the refusal.
        expect(
          run.followUp.timedOut,
          `a later legitimate mutation must not hang: ${JSON.stringify(run.followUp)}`,
        ).toBeUndefined();
        expect(
          run.followUp.thrown ?? reportedThrow(run.followUp),
          `a later legitimate mutation must not throw: ${JSON.stringify(run.followUp)}`,
        ).toBeUndefined();
        expect(
          status(run.followUp),
          `a later legitimate mutation must apply: ${JSON.stringify(run.followUp)}`,
        ).toBe("applied");

        // Property 4 — the workspace still opens on a genuinely new Worker.
        // This is the severe one: a poisoned document that reached disk makes
        // every later initialize() re-materialize and throw, permanently.
        await openWorkspace(page, workspaceId);
        const reopen = await tryInitialize(page);
        expect(
          reopen.opened,
          `the workspace must still open after a refused batch: ${reopen.error}`,
        ).toBe(true);

        // ...and its legitimate pre-poison content survived.
        const employees = await page.evaluate(async () => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.query({ kind: "node-list", nodeType: "Employee", limit: 200 });
        });
        expect(employees.nodes?.length ?? 0).toBeGreaterThan(BULK_EMPLOYEE_COUNT - 1);
      } finally {
        await context?.close();
        await sql.end();
      }
    });
  }
});

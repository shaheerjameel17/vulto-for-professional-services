import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Cookie,
  type Page,
} from "@playwright/test";
import { GRAPH_DOCUMENT_SCHEMA_GENERATION } from "@vulto/schema";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";

/**
 * FDN-50 stage 3: the DOCUMENT-level schema-version gate (Decision 3),
 * layered on stage 1's SealedStore integration and stage 2's debounced
 * write-through. Proves the gate against the real production Worker
 * (packages/graph/src/worker/entry.ts, driven through its real protocol),
 * the real FDN-84 sealed store, and a real online unlock — reusing exactly
 * the same account/workspace/unlock machinery as graph-persistence.spec.ts
 * and graph-persistence-debounce.spec.ts rather than inventing a second way
 * to get there. Runs against the same playwright.device-store.config.ts
 * webServer, database, and origins.
 *
 * The gate's decision table itself is proved without WASM in
 * packages/graph/src/worker/document-schema-gate.test.ts, through the
 * DocumentMetaReadable/DocumentMetaWritable structural interfaces that exist
 * for that purpose. What can only be proved here is the part that involves
 * real bytes: that the generation actually lands in the persisted snapshot,
 * that a planted newer document is refused on a genuinely new Worker with
 * its own protocol code, and that the refusal leaves nothing behind it.
 *
 * FLUSH_DEBOUNCE_MS in runtime.ts is 250ms; every wait below is comfortably
 * past that (400ms), so no test races the debounce timer.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple graph generation 50!";
const PAST_DEBOUNCE_WAIT_MS = 400;

/**
 * A generation this build cannot possibly have written. Derived from the
 * constant rather than hardcoded, so legitimately incrementing the
 * generation does not turn this suite red.
 */
const NEWER_THAN_THIS_BUILD = GRAPH_DOCUMENT_SCHEMA_GENERATION + 1;

/** Every sealed-store code the refusal must NOT be confused with. */
const SEALED_STORE_CODES = [
  "sealed-store-denied",
  "sealed-store-locked",
  "sealed-store-cannot-open",
];

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: {
      getStatus(): Promise<{ locked: boolean }>;
      initialize(): Promise<void>;
      lock(): Promise<void>;
      buildSnapshot(mapKey: string, value: string): string;
      applyDeltaBatch(
        base64Snapshots: readonly string[],
      ): Promise<{ mergedDeltaCount: number }>;
      openPayload(storeKey: string): Promise<string | null>;
      readSnapshotValue(base64Snapshot: string, mapKey: string): string | null;
      storeKeyFor(workspaceId: string): string;
      sealPayload(storeKey: string, base64Snapshot: string): Promise<void>;
      buildGenerationStampedSnapshot(generation: number): string;
      readSnapshotGeneration(base64Snapshot: string): number | null;
      buildRecordSnapshot(mapKey: string, record: Record<string, unknown>): string;
      readSnapshotRecord(
        base64Snapshot: string,
        mapKey: string,
      ): Record<string, unknown> | null;
      dispose(): Promise<void>;
    };
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn50-generation-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Graph Generation Browser");
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

async function createWorkspaceMembership(
  sql: ReturnType<typeof postgres>,
  userId: string,
): Promise<string> {
  const workspaceId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await sql`insert into "organization" ("id", "name", "slug", "created_at", "status")
    values (${workspaceId}, 'Graph Generation Browser Co', ${`graph-generation-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function unlockAndWait(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Reads the sealed-store payload record's generation counter directly out of
 * IndexedDB, bypassing SealedStore's own API. `put()` increments it in the
 * same transaction that writes the record (sealed-store.ts), so this is a
 * direct count of how many times a durable write actually committed —
 * independent of anything the runtime or this test claims about itself.
 * Same helper as graph-persistence-debounce.spec.ts.
 */
async function readGraphSnapshotPutCount(
  page: Page,
  workspaceId: string,
): Promise<number | null> {
  return page.evaluate((wsId) => {
    return new Promise<number | null>((resolve, reject) => {
      const request = indexedDB.open("vulto-sealed-store", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction("payload", "readonly");
        const compositeKey = `${wsId}:graph-snapshot:${wsId}`;
        const getRequest = tx.objectStore("payload").get(compositeKey);
        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => {
          const record = getRequest.result as { generation: number } | undefined;
          database.close();
          resolve(record ? record.generation : null);
        };
      };
    });
  }, workspaceId);
}

async function initialize(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    await api.initialize();
  });
}

/**
 * Attempts initialize() and reports the outcome as data rather than letting
 * it throw. The Worker's error code lives on GraphWorkerProtocolError.code
 * as a field; reading it INSIDE the page matters, because an Error crossing
 * the Playwright boundary keeps only its message. Asserting on the code is
 * the whole point — the refusal must be distinguishable by inspection, not
 * by matching prose.
 */
async function attemptInitialize(
  page: Page,
): Promise<{ ok: boolean; code: string | null; message: string }> {
  return page.evaluate(async () => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      await api.initialize();
      return { ok: true, code: null, message: "" };
    } catch (error: unknown) {
      return {
        ok: false,
        code: (error as { code?: string | null }).code ?? null,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

async function openPayload(page: Page, storeKey: string): Promise<string | null> {
  return page.evaluate(async (key) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    return api.openPayload(key);
  }, storeKey);
}

async function readGeneration(page: Page, base64: string): Promise<number | null> {
  return page.evaluate((snapshot) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    return api.readSnapshotGeneration(snapshot);
  }, base64);
}

test.describe.configure({ mode: "serial" });

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    // F122: every spec file in this directory signs up real accounts against
    // the real API, and Playwright runs them in one invocation, so their
    // sign-ups share Better Auth's 3-per-60s window. Omitting this reset
    // makes the fourth sign-up across the whole run fail inside signUp().
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

/** Loads the diagnostics page against a brand-new workspace and unlocks it. Does NOT initialize. */
async function openUnlockedWorkspace(
  browser: Browser,
  sql: ReturnType<typeof postgres>,
): Promise<{
  context: BrowserContext;
  page: Page;
  workspaceId: string;
  storeKey: string;
}> {
  if (!sharedAccount) throw new Error("shared account was not created");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await context.addCookies(sharedAccount.cookies);
  const workspaceId = await createWorkspaceMembership(sql, sharedAccount.userId);

  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await unlockAndWait(page);

  const storeKey = await page.evaluate((id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    return api.storeKeyFor(id);
  }, workspaceId);

  return { context, page, workspaceId, storeKey };
}

test.describe("FDN-50 stage 3 document schema generation gate", () => {
  test("a fresh workspace initializes cleanly and records the current generation on its first persist", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      const opened = await openUnlockedWorkspace(browser, sql);
      context = opened.context;
      const { page, workspaceId, storeKey } = opened;

      // The bootstrap case: no persisted snapshot, so initialize() never
      // reaches the gate at all. It has no recorded generation by
      // definition, and must open cleanly.
      await initialize(page);
      expect(await openPayload(page, storeKey)).toBeNull();
      expect(await readGraphSnapshotPutCount(page, workspaceId)).toBeNull();

      // The FIRST persist is what stamps the generation — a workspace that
      // never mutates writes nothing at all.
      const batch = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        return api.applyDeltaBatch([api.buildSnapshot("bootstrap", "stamped")]);
      });
      expect(batch.mergedDeltaCount).toBe(1);

      await page.waitForTimeout(PAST_DEBOUNCE_WAIT_MS);

      const persisted = await openPayload(page, storeKey);
      expect(persisted).not.toBeNull();

      // Verified in the persisted BYTES, not merely inferred from
      // initialize() having succeeded: the generation is decoded back out of
      // the sealed snapshot that actually landed on disk.
      expect(await readGeneration(page, persisted!)).toBe(
        GRAPH_DOCUMENT_SCHEMA_GENERATION,
      );

      // And the mutation itself is in the same snapshot — stamping did not
      // displace the document's real content.
      const value = await page.evaluate(
        ({ base64, mapKey }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.readSnapshotValue(base64, mapKey);
        },
        { base64: persisted!, mapKey: "bootstrap" },
      );
      expect(value).toBe("stamped");

      // Exactly one durable write: stamping is folded into the existing
      // flush rather than adding a second one.
      expect(await readGraphSnapshotPutCount(page, workspaceId)).toBe(0);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("a document persisted at the current generation reopens normally on a genuinely new Worker", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      const opened = await openUnlockedWorkspace(browser, sql);
      context = opened.context;
      const { page, storeKey } = opened;

      await initialize(page);
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.applyDeltaBatch([api.buildSnapshot("before-reopen", "present")]);
      });
      await page.waitForTimeout(PAST_DEBOUNCE_WAIT_MS);

      const beforeReopen = await openPayload(page, storeKey);
      expect(beforeReopen).not.toBeNull();
      expect(await readGeneration(page, beforeReopen!)).toBe(
        GRAPH_DOCUMENT_SCHEMA_GENERATION,
      );

      // A real page reload unmounts the React component, which disposes the
      // client and terminates the real Worker. What comes back is a
      // genuinely new Worker instance with a freshly locked SealedStore.
      await page.reload();
      await unlockAndWait(page);

      // The gate runs here, on a document that DOES carry a recorded
      // generation, and stands aside because it is inside the range.
      const outcome = await attemptInitialize(page);
      expect(outcome.code).toBeNull();
      expect(outcome.ok).toBe(true);

      // Still readable and still usable afterward: merge a second mutation
      // on top of the reopened document and confirm both survive.
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.applyDeltaBatch([api.buildSnapshot("after-reopen", "merged")]);
      });
      await page.waitForTimeout(PAST_DEBOUNCE_WAIT_MS);

      const afterReopen = await openPayload(page, storeKey);
      expect(afterReopen).not.toBeNull();
      expect(await readGeneration(page, afterReopen!)).toBe(
        GRAPH_DOCUMENT_SCHEMA_GENERATION,
      );
      for (const [mapKey, expected] of [
        ["before-reopen", "present"],
        ["after-reopen", "merged"],
      ]) {
        const readBack = await page.evaluate(
          ({ base64, key }) => {
            const api = window.__vultoGraphPersistenceDiagnostics;
            if (!api) throw new Error("diagnostics API missing");
            return api.readSnapshotValue(base64, key);
          },
          { base64: afterReopen!, key: mapKey },
        );
        expect(readBack).toBe(expected);
      }
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("a document written by a newer client is refused on reopen, fails closed, and cannot be overwritten", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      const opened = await openUnlockedWorkspace(browser, sql);
      context = opened.context;
      const { page, workspaceId, storeKey } = opened;

      // Plant a document this build could never have written. Built as a
      // scratch LoroDoc stamped at a higher generation (the same
      // scratch-document technique the diagnostics harness already uses for
      // mutations) and sealed through the real, already-existing
      // sealPayload entrypoint. No production API was added to make this
      // constructable: by design this build never writes a generation above
      // its own, so the only honest way to produce one is to plant it.
      await page.evaluate(
        async ({ key, generation }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          await api.sealPayload(key, api.buildGenerationStampedSnapshot(generation));
        },
        { key: storeKey, generation: NEWER_THAN_THIS_BUILD },
      );

      const planted = await openPayload(page, storeKey);
      expect(planted).not.toBeNull();
      expect(await readGeneration(page, planted!)).toBe(NEWER_THAN_THIS_BUILD);
      const putCountAfterPlanting = await readGraphSnapshotPutCount(page, workspaceId);
      expect(putCountAfterPlanting).toBe(0);

      // Reopen on a genuinely new Worker. The store unlocks, the bytes
      // decrypt and authenticate, the document imports — and only then does
      // the gate refuse it.
      await page.reload();
      await unlockAndWait(page);

      const refusal = await attemptInitialize(page);
      expect(refusal.ok).toBe(false);
      // Asserted on the protocol code, not on message prose.
      expect(refusal.code).toBe("document-schema-generation-unsupported");
      // And explicitly NOT any sealed-store code: a caller that cannot tell
      // these apart would try to re-unlock, re-key, or re-sync, none of
      // which can help.
      expect(SEALED_STORE_CODES).not.toContain(refusal.code);
      expect(refusal.code).not.toBe("runtime-failure");

      // Fail-closed, part 1: nothing is materialized or queryable. The
      // runtime left #workspaceId null and tore down its index and
      // document, and the fatal error terminated the Worker — so no
      // mutation can be applied against this workspace at all.
      const mutationAttempt = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        try {
          await api.applyDeltaBatch([api.buildSnapshot("must-not-apply", "never")]);
          return "succeeded";
        } catch (error: unknown) {
          return error instanceof Error ? error.message : String(error);
        }
      });
      expect(mutationAttempt).not.toBe("succeeded");

      // Fail-closed, part 2 — the one that protects real data. A subsequent
      // persist must not overwrite the newer document with this build's
      // snapshot. Read back on yet another new Worker, because the refusal
      // above terminated the previous one.
      await page.reload();
      await unlockAndWait(page);

      const afterRefusal = await openPayload(page, storeKey);
      expect(afterRefusal).not.toBeNull();
      // The newer generation is exactly as planted: not lowered, not erased.
      expect(await readGeneration(page, afterRefusal!)).toBe(NEWER_THAN_THIS_BUILD);
      // And no durable write happened at all since the planting — proved by
      // the sealed store's own put() counter, not by the bytes looking
      // similar.
      expect(await readGraphSnapshotPutCount(page, workspaceId)).toBe(
        putCountAfterPlanting,
      );

      // The refusal is stable, not a one-time condition: reopening again
      // refuses again, with the same code.
      const secondRefusal = await attemptInitialize(page);
      expect(secondRefusal.ok).toBe(false);
      expect(secondRefusal.code).toBe("document-schema-generation-unsupported");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("record-level tolerance is unaffected when the document generation is compatible", async ({
    browser,
  }) => {
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;

    try {
      const opened = await openUnlockedWorkspace(browser, sql);
      context = opened.context;
      const { page, storeKey } = opened;

      await initialize(page);

      // A record carrying a property this build does not recognize, which
      // is purely additive — exactly what A002-T07 requires an older client
      // to tolerate rather than fail on (F102's work, unchanged by this
      // stage). The DOCUMENT generation stays compatible throughout.
      await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        await api.applyDeltaBatch([
          api.buildRecordSnapshot("tolerated-record", {
            node_type: "Employee",
            schema_version: 1,
            lifecycle_status: "Active",
            vulto_future_additive_property: "written by a later schema version",
          }),
        ]);
      });
      await page.waitForTimeout(PAST_DEBOUNCE_WAIT_MS);

      await page.reload();
      await unlockAndWait(page);

      // The gate stands aside: an unrecognized property on a record is not
      // a document-level incompatibility, and conflating the two is exactly
      // what this test exists to rule out.
      const outcome = await attemptInitialize(page);
      expect(outcome.code).toBeNull();
      expect(outcome.ok).toBe(true);

      const persisted = await openPayload(page, storeKey);
      expect(persisted).not.toBeNull();
      expect(await readGeneration(page, persisted!)).toBe(
        GRAPH_DOCUMENT_SCHEMA_GENERATION,
      );

      const record = await page.evaluate(
        ({ base64, mapKey }) => {
          const api = window.__vultoGraphPersistenceDiagnostics;
          if (!api) throw new Error("diagnostics API missing");
          return api.readSnapshotRecord(base64, mapKey);
        },
        { base64: persisted!, mapKey: "tolerated-record" },
      );
      expect(record).not.toBeNull();
      // Tolerated AND preserved: dropping the unknown property would lose a
      // newer client's data on the next write-back.
      expect(record!.vulto_future_additive_property).toBe(
        "written by a later schema version",
      );
      expect(record!.node_type).toBe("Employee");
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});

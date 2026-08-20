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
 * FDN-87 — the erase mechanism `VPS-F001` G04 requires, which FDN-84 promised
 * in its own done criteria and was closed without.
 *
 * G04: *"Revocation wipes the store entirely within 60 seconds of signal
 * receipt."* Before this, `SealedStore` had no delete, clear or
 * `deleteDatabase` path at all — `dispose()` locked and closed the handle,
 * and the ciphertext stayed in IndexedDB forever. Nothing in the repository
 * could erase a local store.
 *
 * **This proves the MECHANISM, and deliberately not a policy.** Nothing in
 * production calls `eraseLocalStore`. Per FDN-84's own ownership boundary,
 * FDN-63 owns revocation orchestration — which signal fires this, and when —
 * and that boundary is load-bearing rather than bureaucratic: the
 * role-refresh checkpoint is non-enumerating, so its `401` means revoked OR
 * suspended OR merely session-expired, and `VPS-F001` is explicit that
 * *"Nothing is wiped on expiry — only on explicit revocation or
 * offboarding."* Wiring this to the denial path would destroy the local store
 * of every user whose session simply timed out.
 *
 * So this file is honest about what it is: a mechanism, proven to work,
 * reachable through its real protocol message, with no production caller yet.
 * That is recorded rather than left for a future reader to discover, because
 * an unwired mechanism mistaken for active enforcement is the F130/F133/F143
 * pattern this project keeps catching.
 *
 * Real stack: real Chromium, real IndexedDB, real `SealedStore` behind a real
 * online unlock, real Postgres, real Loro and SQLite WASM. Per F122,
 * `resetRateLimits` runs in `beforeAll`.
 */

const apiOrigin = "https://localhost:3111";
const webOrigin = "https://localhost:3110";
const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";
const password = "Correct horse battery staple sealed store erase 87!";

/** The id `buildClean` writes. */
const SEED_EMPLOYEE = "77777777-7777-4777-8777-777777777777";

interface MutationOutcomeShape {
  status?: string;
  thrown?: string;
}

interface EraseDiagnosticsApi {
  getStatus(): Promise<{ locked: boolean }>;
  initialize(): Promise<void>;
  unlock(): Promise<{ unlocked: boolean; error?: string }>;
  eraseLocalStore(workspaceId: string): Promise<void>;
  refreshRole(): Promise<string[]>;
  query(graphQuery: unknown): Promise<{ node?: unknown }>;
  mutate(base64Snapshots: readonly string[]): Promise<MutationOutcomeShape>;
  storeKeyFor(workspaceId: string): string;
  openPayload(storeKey: string): Promise<string | null>;
  poisoning: {
    employeeId: string;
    buildClean(workspaceId: string): string;
  };
}

declare global {
  interface Window {
    __vultoGraphPersistenceDiagnostics?: EraseDiagnosticsApi;
  }
}

async function signUp(
  page: Page,
  sql: ReturnType<typeof postgres>,
): Promise<{ email: string; userId: string; cookies: Cookie[] }> {
  const email = `browser-fdn87-${crypto.randomUUID()}@example.com`;
  await page.goto(`${webOrigin}/sign-up`);
  await page.getByLabel("Name").fill("Sealed Store Erase Browser");
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
    values (${workspaceId}, 'Erase Co', ${`fdn87-${workspaceId}`}, now(), 'active')`;
  await sql`insert into "member" ("id", "organization_id", "user_id", "role", "created_at", "status", "projection_state")
    values (${membershipId}, ${workspaceId}, ${userId}, 'owner', now(), 'active', 'confirmed')`;
  return workspaceId;
}

async function openWorkspace(page: Page, workspaceId: string): Promise<void> {
  await page.goto(
    `${webOrigin}/graph-persistence-diagnostics?workspaceId=${workspaceId}`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("graph-persistence-unlocked")).toBeVisible({
    timeout: 20_000,
  });
}

async function tryInitialize(
  page: Page,
): Promise<{ opened: boolean; error?: string }> {
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

/** Seeds one employee and waits out its debounce window, so the bytes are on disk. */
async function seedDurably(page: Page, workspaceId: string): Promise<string | undefined> {
  return page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    const outcome = await api.mutate([api.poisoning.buildClean(id)]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    return outcome.status;
  }, workspaceId);
}

/**
 * Reads the workspace's sealed graph snapshot straight out of the store,
 * through the real `open-payload` message. This is what "no readable remnant"
 * has to be measured against — a query returning nothing could equally mean
 * the index was rebuilt empty, while this asks the store directly.
 */
async function snapshotOnDisk(
  page: Page,
  workspaceId: string,
): Promise<{ present?: boolean; thrown?: string }> {
  return page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      const payload = await api.openPayload(api.storeKeyFor(id));
      return { present: payload !== null };
    } catch (error: unknown) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
  }, workspaceId);
}

async function employeeVisible(
  page: Page,
  nodeId: string,
): Promise<{ present?: boolean; thrown?: string }> {
  return page.evaluate(async (id) => {
    const api = window.__vultoGraphPersistenceDiagnostics;
    if (!api) throw new Error("diagnostics API missing");
    try {
      const result = (await api.query({
        kind: "node-get",
        nodeId: id,
        nodeType: "Employee",
        includeSoftDeleted: false,
      })) as { node?: unknown };
      return { present: result.node !== null && result.node !== undefined };
    } catch (error: unknown) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
  }, nodeId);
}

let sharedAccount: { email: string; userId: string; cookies: Cookie[] } | undefined;

test.beforeAll(async ({ browser }) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await resetRateLimits(sql);
    sharedAccount = await signUp(page, sql);
  } finally {
    await context.close();
    await sql.end();
  }
});

test.describe("FDN-87 — the sealed store can erase itself", () => {
  test("erases a workspace's persisted payloads, leaving no readable remnant", async ({
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
      expect((await tryInitialize(page)).opened).toBe(true);
      expect(await seedDurably(page, workspaceId)).toBe("applied");

      // The precondition. Without this the erase below could "pass" against
      // a store that never held anything.
      const before = await snapshotOnDisk(page, workspaceId);
      console.log(`FDN-87 snapshot before erase: ${JSON.stringify(before)}`);
      expect(
        before.present,
        `the workspace must have durable bytes before the erase means anything: ${JSON.stringify(before)}`,
      ).toBe(true);

      await page.evaluate(
        async (id) => window.__vultoGraphPersistenceDiagnostics!.eraseLocalStore(id),
        workspaceId,
      );

      // Read the store directly on a genuinely new Worker, so nothing can be
      // answered from the erased Worker's own memory.
      await openWorkspace(page, workspaceId);
      const after = await snapshotOnDisk(page, workspaceId);
      console.log(`FDN-87 snapshot after erase: ${JSON.stringify(after)}`);
      expect(
        after.present,
        `G04 — no readable remnant may survive the erase: ${JSON.stringify(after)}`,
      ).toBe(false);

      // And the workspace opens clean rather than refusing: an erased store
      // is an empty one, not a corrupt one.
      const reopened = await tryInitialize(page);
      expect(
        reopened.opened,
        `an erased workspace must still open, empty: ${reopened.error}`,
      ).toBe(true);
      const employee = await employeeVisible(page, SEED_EMPLOYEE);
      expect(
        employee.present,
        `and must hold none of the erased content: ${JSON.stringify(employee)}`,
      ).toBe(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * The counterweight. An erase that took out more than it was asked to would
   * pass every assertion above — this device may hold several workspaces, and
   * a revocation from one says nothing about the others.
   */
  test("erases only the workspace it was given", async ({ browser }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      if (!sharedAccount) throw new Error("shared account was not created");
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await context.addCookies(sharedAccount.cookies);
      const doomed = await createOwnerWorkspace(sql, sharedAccount.userId);
      const bystander = await createOwnerWorkspace(sql, sharedAccount.userId);

      // Two workspaces, both with durable content, in the same browser
      // profile and therefore the same IndexedDB database.
      for (const workspaceId of [doomed, bystander]) {
        await openWorkspace(page, workspaceId);
        expect((await tryInitialize(page)).opened).toBe(true);
        expect(await seedDurably(page, workspaceId)).toBe("applied");
      }

      await openWorkspace(page, doomed);
      await page.evaluate(
        async (id) => window.__vultoGraphPersistenceDiagnostics!.eraseLocalStore(id),
        doomed,
      );

      await openWorkspace(page, bystander);
      const survivor = await snapshotOnDisk(page, bystander);
      console.log(`FDN-87 bystander after erase: ${JSON.stringify(survivor)}`);
      expect(
        survivor.present,
        `erasing one workspace must not touch another on the same device: ${JSON.stringify(survivor)}`,
      ).toBe(true);

      expect((await tryInitialize(page)).opened).toBe(true);
      const employee = await employeeVisible(page, SEED_EMPLOYEE);
      expect(
        employee.present,
        `and the bystander's content must be intact: ${JSON.stringify(employee)}`,
      ).toBe(true);
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  /**
   * The property that decides whether this mechanism is usable at all.
   *
   * A device that has lost authority can never unlock again — that is exactly
   * what F106's cold-restart checkpoint is for. An erase that required an
   * unlocked store would therefore be unreachable in the only situation it
   * exists for. Erasing destroys ciphertext rather than reading it, so it
   * needs no key, and this proves that holds through the real message rather
   * than by reading the implementation.
   */
  test("erases while the store is locked, because a revoked device can never unlock", async ({
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
      expect((await tryInitialize(page)).opened).toBe(true);
      expect(await seedDurably(page, workspaceId)).toBe("applied");

      // A real revocation, which locks the store through the real path.
      await sql`update "member" set "status" = 'revoked'
        where "organization_id" = ${workspaceId} and "user_id" = ${sharedAccount.userId}`;
      const locked = await page.evaluate(async () => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        try {
          await api.refreshRole();
        } catch {
          /* the denial */
        }
        return (await api.getStatus()).locked;
      });
      expect(locked, "the revocation must have locked the store").toBe(true);

      // The erase must work anyway.
      const erased = await page.evaluate(async (id) => {
        const api = window.__vultoGraphPersistenceDiagnostics;
        if (!api) throw new Error("diagnostics API missing");
        try {
          await api.eraseLocalStore(id);
          return { ok: true };
        } catch (error: unknown) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }, workspaceId);
      console.log(`FDN-87 erase while locked: ${JSON.stringify(erased)}`);
      expect(
        erased.ok,
        `erasing must not require an unlocked store: ${JSON.stringify(erased)}`,
      ).toBe(true);

      // Restore the membership only so the store can be opened to VERIFY the
      // erase. The erase itself happened while revoked and locked.
      await sql`update "member" set "status" = 'active'
        where "organization_id" = ${workspaceId} and "user_id" = ${sharedAccount.userId}`;
      await openWorkspace(page, workspaceId);
      const after = await snapshotOnDisk(page, workspaceId);
      console.log(`FDN-87 snapshot after locked erase: ${JSON.stringify(after)}`);
      expect(
        after.present,
        `the erase performed while locked must actually have removed the bytes: ${JSON.stringify(after)}`,
      ).toBe(false);
    } finally {
      await context?.close();
      await sql.end();
    }
  });
});

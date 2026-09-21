import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { resetRateLimits } from "./rate-limit-reset";
import {
  API_ORIGIN,
  bringDeviceIntoWorkspace,
  createWorkspace,
  signUpViaForm,
  WEB_ORIGIN,
} from "./fixtures";

/**
 * FDN-55 Stage 3 — the accessibility smoke gate (`VPS-A007` gate 8, ruling 9a).
 *
 * A minimal axe-core pass over the routes that exist and ship today —
 * `sign-in`, `sign-up`, and `/devices` (the FDN-63 screen). The point is that
 * the gate is **live and required**, not a placeholder: a serious a11y
 * regression on a real route fails a real check.
 *
 * ## The baseline
 *
 * These routes were built before this gate existed and carry known
 * violations. Rather than scope the test around them — which would hide the
 * debt — the structural ones are listed per surface in `BASELINE`, and
 * `color-contrast` (a palette-wide `VPS-D001` decision, and intermittent) is
 * accepted debt everywhere via `KNOWN_DEBT_RULES`. The gate then asserts, per
 * surface:
 *
 *   1. no violation fires that is **not** baselined  (a real regression)
 *   2. every baselined violation **still** fires  (so a fix forces the line to
 *      be deleted, and the baseline can only shrink)
 *
 * The baselined items are tracked in the FDN-55 comment and roll into the
 * exhaustive `packages/ui` accessibility-coverage issue (ruling 9b, filed once
 * this harness lands).
 *
 * Exhaustive component-level coverage across `packages/ui`'s ~30 components is
 * that separate, larger issue — not this smoke pass.
 *
 * `VPS-A007` gate 8 lists focus visibility, target size at the product
 * geometry, contrast against both themes, and keyboard operability. axe covers
 * contrast, names/roles, and structure; the WCAG 2 AA + best-practice tag set
 * is the floor. Color contrast is checked in both themes.
 */

const databaseUrl =
  process.env.FDN84_BROWSER_DATABASE_URL ??
  "postgres://vulto:vulto@localhost:5432/vulto_fdn84_browser";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

/**
 * `color-contrast` fires against the design-token secondary-text and muted
 * pairs on every surface, and intermittently (it depends on which transient
 * cells — relative timestamps, badges — are on screen when axe samples). It is
 * one coherent `VPS-D001` palette decision, not a per-route defect, so it is
 * accepted debt everywhere and reported but not gated. Everything else is
 * structural and deterministic.
 */
const KNOWN_DEBT_RULES: readonly string[] = ["color-contrast"];

/**
 * Known pre-existing STRUCTURAL violations, by surface. Sorted rule ids. A fix
 * deletes the id (or the whole line); nothing is added here without a tracking
 * note in the FDN-55 thread.
 *
 *   link-in-text-block  — the "sign in" / "sign up" link inside a sentence has
 *                         no non-color affordance (packages/ui or the auth
 *                         pages).
 *   empty-table-header  — the /devices actions column header is "" (Table in
 *                         packages/ui needs a visually-hidden label).
 *   page-has-heading-one — PageHeader renders the title below <h1>; no route
 *                         emits a level-one heading.
 */
const BASELINE: Record<string, readonly string[]> = {
  "/sign-in": [],
  "/sign-up": ["link-in-text-block"],
  "/devices": ["empty-table-header", "page-has-heading-one"],
  // With the Radix dialog open the page tree behind it is inert, so the table
  // and heading violations drop out and the modal subtree itself is clean.
  "/devices (revoke modal)": [],
};

async function violationIds(page: Page, theme: "light" | "dark"): Promise<string[]> {
  await page.emulateMedia({ colorScheme: theme });
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return violations.map((v) => v.id);
}

/**
 * Union the violations across both themes, then diff against the baseline:
 * anything new fails the gate; anything baselined-but-gone fails it too, so the
 * baseline is forced to stay honest.
 */
async function assertAgainstBaseline(page: Page, surface: string): Promise<void> {
  const seen = new Set<string>();
  for (const theme of ["light", "dark"] as const) {
    for (const id of await violationIds(page, theme)) seen.add(id);
  }
  for (const id of KNOWN_DEBT_RULES) seen.delete(id);
  const baseline = BASELINE[surface] ?? [];
  const unexpected = [...seen].filter((id) => !baseline.includes(id)).sort();
  const fixed = baseline.filter((id) => !seen.has(id));

  expect(
    unexpected,
    `${surface}: new axe violation(s) not in the baseline — a regression: ${unexpected.join(", ")}`,
  ).toEqual([]);
  expect(
    fixed,
    `${surface}: baselined violation(s) no longer fire — delete them from BASELINE: ${fixed.join(", ")}`,
  ).toEqual([]);
}

test.beforeAll(async () => {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await resetRateLimits(sql);
  } finally {
    await sql.end();
  }
});

test.describe("VPS-A007 gate 8 — accessibility smoke", () => {
  for (const route of ["/sign-in", "/sign-up"]) {
    test(`${route} is within the a11y baseline in both themes`, async ({ browser }) => {
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        const page = await context.newPage();
        await page.goto(`${WEB_ORIGIN}${route}`);
        await page.getByRole("heading").first().waitFor();
        await assertAgainstBaseline(page, route);
      } finally {
        await context.close();
      }
    });
  }

  test("/devices is within the a11y baseline for a signed-in Owner", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sql = postgres(databaseUrl, { max: 1 });
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const { userId } = await signUpViaForm(page, sql, "A11y Owner");
      const workspaceId = await createWorkspace(sql, userId, "owner");
      await bringDeviceIntoWorkspace(page, workspaceId);

      await page.goto(`${WEB_ORIGIN}/devices?workspaceId=${workspaceId}`);
      await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
      await expect(page.getByTestId("devices-table")).toBeVisible({ timeout: 20_000 });

      await assertAgainstBaseline(page, "/devices");

      // The Revoke modal is a distinct surface — a dialog with its own focus
      // contract. Open it and scan it too.
      await page.getByRole("button", { name: "Revoke", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await assertAgainstBaseline(page, "/devices (revoke modal)");
    } finally {
      await context?.close();
      await sql.end();
    }
  });

  test("the API origin is reachable (harness sanity)", async ({ request }) => {
    const response = await request.get(`${API_ORIGIN}/health`, {
      ignoreHTTPSErrors: true,
    });
    expect(response.ok()).toBe(true);
  });
});

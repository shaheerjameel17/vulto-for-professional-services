import { expect, test } from "@playwright/test";
import postgres from "postgres";
import {
  createWorkspaceMembership,
  databaseUrl,
  signUp,
  unlockAndWaitForReady,
  webOrigin,
} from "./browser-test-helpers";

test("a real Worker materializes and queries a 150-employee graph", async ({
  page,
  context,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const account = await signUp(page, sql);
    await context.addCookies(account.cookies);
    const workspaceId = await createWorkspaceMembership(sql, account.userId);

    await page.goto(`${webOrigin}/worker-diagnostics?workspaceId=${workspaceId}`);
    await expect(page.getByTestId("locked-shell")).toBeVisible();
    await unlockAndWaitForReady(page);
  } finally {
    await sql.end();
  }

  const result = await page.evaluate(async () => {
    const diagnostics = window.__vultoWorkerDiagnostics;
    if (!diagnostics) throw new Error("Worker diagnostics API is unavailable");
    return diagnostics.runMaterializationProof();
  });

  expect(result.generation).toBe(1);
  expect(result.nodeCount).toBe(150);
  expect(result.twoHopCount).toBe(2);
  expect(result.historicalHandoffTarget).toBe("00000000-0000-4001-8000-000000000003");
  expect(result.subscriptionObservedCommit).toBe(true);
  expect(result.indexedPlan).toBe(true);
  expect(result.deterministicRebuild).toBe(true);
  expect(result.failedBatchPreservedGeneration).toBe(true);
  expect(result.durationMs).toBeGreaterThan(0);
});

import { expect, test } from "@playwright/test";

test("a real Worker materializes and queries a 150-employee graph", async ({
  page,
}) => {
  await page.goto("/worker-diagnostics");
  await expect(page.getByTestId("worker-status")).toHaveText("ready", {
    timeout: 30_000,
  });

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

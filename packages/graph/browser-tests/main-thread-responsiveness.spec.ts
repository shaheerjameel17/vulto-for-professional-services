import { expect, test } from "@playwright/test";
import { LoroDoc } from "loro-crdt";

function buildBacklog(
  firstPeer: number,
  documentCount: number,
  operationsPerDocument: number,
): string[] {
  return Array.from({ length: documentCount }, (_, documentIndex) => {
    const document = new LoroDoc();
    document.setPeerId(String(firstPeer + documentIndex));
    const backlog = document.getList<number>("fdn77-backlog");
    for (let operation = 0; operation < operationsPerDocument; operation += 1) {
      backlog.push(operation);
    }
    const snapshot = document.export({ mode: "snapshot" });
    document.free();
    return Buffer.from(snapshot).toString("base64");
  });
}

test("a multi-day delta backlog leaves the browser main thread responsive", async ({
  page,
}) => {
  await page.goto("/worker-diagnostics");
  await expect(page.getByTestId("worker-status")).toHaveText("ready", {
    timeout: 30_000,
  });

  let result:
    | {
        batch: {
          workerDurationMs: number;
          mergedDeltaCount: number;
          materializationGeneration: number;
          availability: { state: string };
        };
        animationFrames: number;
        maxFrameGapMs: number;
      }
    | undefined;
  let peer = 1;

  for (const operationsPerDocument of [15_000, 30_000, 60_000]) {
    const backlog = buildBacklog(peer, 6, operationsPerDocument);
    peer += backlog.length;
    result = await page.evaluate(async (deltas) => {
      const diagnostics = window.__vultoWorkerDiagnostics;
      if (!diagnostics) throw new Error("Worker diagnostics API is unavailable");
      return diagnostics.runBacklog(deltas);
    }, backlog);
    if (result.batch.workerDurationMs >= 500) break;
  }

  expect(result).toBeDefined();
  expect(result!.batch.workerDurationMs).toBeGreaterThanOrEqual(500);
  expect(result!.batch.availability).toEqual({ state: "ready" });
  expect(result!.batch.mergedDeltaCount).toBe(6);
  expect(result!.batch.materializationGeneration).toBe(0);
  expect(result!.animationFrames).toBeGreaterThan(10);
  expect(result!.maxFrameGapMs).toBeLessThan(100);
});

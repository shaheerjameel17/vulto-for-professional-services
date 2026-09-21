import { expect, test } from "@playwright/test";
import { LoroDoc } from "loro-crdt";
import postgres from "postgres";
import {
  createWorkspaceMembership,
  databaseUrl,
  signUp,
  unlockAndWaitForReady,
  webOrigin,
} from "./browser-test-helpers";

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
  // FDN-50 stage 5 wired materialization into the live path, so this field
  // finally reports something. It was 0 for every batch until then — the
  // Worker merged deltas and materialized nothing — and a merged batch now
  // advances the generation, including the one materialization that
  // initialize() itself performs. The assertion is that the batch WAS
  // materialized, not which number it landed on: the count depends on how
  // many backlog sizes the loop above needed to exceed its 500ms floor.
  expect(result!.batch.materializationGeneration).toBeGreaterThan(0);
  expect(result!.animationFrames).toBeGreaterThan(10);
  expect(result!.maxFrameGapMs).toBeLessThan(100);
});

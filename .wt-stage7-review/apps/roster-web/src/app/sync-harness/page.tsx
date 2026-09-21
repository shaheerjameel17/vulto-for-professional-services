import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SyncHarnessClient } from "./sync-harness-client";

/**
 * Browser-only Stage 6 acceptance harness.
 *
 * Not a product route. It creates the sync client for the workspace and user
 * named in the query string and exposes it on `window.__vultoSync` so Playwright
 * can drive it against the real stack. Production and ordinary development both
 * return 404 unless the test command opts in with VULTO_SYNC_HARNESS=1, and the
 * optimized build compiles its client to nothing.
 */
export default function SyncHarnessPage() {
  if (process.env.VULTO_SYNC_HARNESS !== "1") notFound();
  return (
    <main>
      <h1>Sync client harness</h1>
      <Suspense>
        <SyncHarnessClient />
      </Suspense>
    </main>
  );
}

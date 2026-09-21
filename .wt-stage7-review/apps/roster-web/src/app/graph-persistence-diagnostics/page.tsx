import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GraphPersistenceDiagnosticsClient } from "./graph-persistence-diagnostics-client";

/**
 * Browser-only FDN-50 stage 1 acceptance harness.
 *
 * Not a product route: it exists so Playwright can prove the real production
 * Worker (packages/graph/src/worker/entry.ts, driven through its real
 * protocol) persists a Loro document behind the already-unlocked FDN-84
 * sealed store and reopens it on a genuinely new Worker instance. Reuses the
 * same opt-in gate as the FDN-84 device-store harness rather than inventing
 * a second one — this route is diagnostics-only in exactly the same sense.
 * Returns 404 unless the test command opts in explicitly.
 */
export default function GraphPersistenceDiagnosticsPage() {
  if (process.env.VULTO_DEVICE_STORE_DIAGNOSTICS !== "1") notFound();

  return (
    <Suspense>
      <GraphPersistenceDiagnosticsClient />
    </Suspense>
  );
}

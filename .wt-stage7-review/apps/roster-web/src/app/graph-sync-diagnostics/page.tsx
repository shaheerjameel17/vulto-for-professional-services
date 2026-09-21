import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GraphSyncDiagnosticsClient } from "./graph-sync-diagnostics-client";

/**
 * FDN-51 Stage 4a browser proof harness. Not a product route — it exists so
 * Playwright can drive the real `LocalGraphClient.startSync` against the real
 * `services/sync-engine` relay and real Postgres. Same opt-in gate as the
 * other diagnostics routes; 404 unless the test command sets it.
 */
export default function GraphSyncDiagnosticsPage() {
  if (process.env.VULTO_DEVICE_STORE_DIAGNOSTICS !== "1") notFound();
  return (
    <Suspense>
      <GraphSyncDiagnosticsClient />
    </Suspense>
  );
}

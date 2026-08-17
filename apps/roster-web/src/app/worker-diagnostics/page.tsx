import { notFound } from "next/navigation";
import { WorkerDiagnosticsClient } from "./worker-diagnostics-client";

/**
 * Browser-only FDN-77 acceptance harness.
 *
 * This is not a product route and reads no workspace data. It exists only so
 * Playwright can prove that a real module Worker performs Loro and SQLite-WASM
 * work without blocking animation on the main thread. Production and ordinary
 * development both return 404 unless the test command opts in explicitly.
 */
export default function WorkerDiagnosticsPage() {
  if (process.env.VULTO_WORKER_DIAGNOSTICS !== "1") notFound();

  return (
    <main>
      <h1>Local graph Worker diagnostics</h1>
      <WorkerDiagnosticsClient />
    </main>
  );
}

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DeviceStoreDiagnosticsClient } from "./device-store-diagnostics-client";

/**
 * Browser-only FDN-84 acceptance harness.
 *
 * Not a product route: it exists so Playwright can prove the locked shell
 * renders on a fresh Worker instance and that unlock/lock/status round-trip
 * through the real sealed-store Worker. Returns 404 unless the test command
 * opts in explicitly.
 */
export default function DeviceStoreDiagnosticsPage() {
  if (process.env.VULTO_DEVICE_STORE_DIAGNOSTICS !== "1") notFound();

  return (
    <Suspense>
      <DeviceStoreDiagnosticsClient />
    </Suspense>
  );
}

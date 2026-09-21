import { Suspense } from "react";
import { DevicesClient } from "./devices-client";

/**
 * `VPS-F001`'s Devices screen, as a standalone session-gated route.
 *
 * Not a diagnostics page: this is real product surface and carries no
 * environment gate. It lives outside the application shell only because the
 * shell is still the fixture prototype (F190); when the real shell exists,
 * this moves into it as `VPS-F001` specifies, with no change to the client.
 */
export default function DevicesPage() {
  return (
    // `max-w-content` is the VPS-D004 content width from `packages/tokens`.
    // Tailwind's own container scale is reset to `initial` by the theme, so a
    // `max-w-5xl` here silently resolves to nothing — the tokens really are
    // the only source of values.
    <main className="mx-auto w-full max-w-content px-4 py-8">
      <Suspense fallback={null}>
        <DevicesClient />
      </Suspense>
    </main>
  );
}

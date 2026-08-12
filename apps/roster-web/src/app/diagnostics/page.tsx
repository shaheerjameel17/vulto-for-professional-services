import type { AppRouter } from "@vulto/api/router";

/**
 * The minimal end-to-end path, and nothing more.
 *
 * This route exists to prove one thing: roster-web reaches the tRPC API, which
 * reaches Postgres. It is FDN-47's "minimal end-to-end application path" and it
 * is the whole of it.
 *
 * ## It is not a product surface
 *
 * Not in the sidebar, not in the command palette, and not linked from anywhere.
 *
 * The folder is deliberately NOT `_diagnostics`: the App Router treats an
 * underscore prefix as a private folder and excludes it from routing entirely,
 * so the route 404s in development too — which defeats the point. What keeps
 * this off a user's path is its absence from navigation and the production
 * rewrite in next.config.ts, not a naming convention. VPS-D004's rules about unbuilt destinations and empty states
 * govern places a user can navigate to; this is not one of them, so none of them
 * apply here and this route is not evidence about how any of them should look.
 *
 * ## It reads no workspace data and touches no graph node
 *
 * Stated explicitly because of what is absent. Authentication is FDN-60's and
 * does not exist yet, so this route reaches a database with no permission
 * context — and **that must not be cited later as evidence that unauthenticated
 * data paths are acceptable.** They are not. VPS-A004's interceptor is the only
 * place access is decided, and every route that reads workspace data goes
 * through it.
 *
 * What makes this route bounded rather than a precedent is that there is nothing
 * for a permission layer to protect: `system.status` runs `SELECT now()`. It
 * reads no node, no edge, no workspace-scoped row, and no user data of any kind.
 * The first route that reads any of those needs FDN-60 and VPS-A004 first.
 *
 * ## It is unreachable in production, which is not the same as absent
 *
 * `next.config.ts` rewrites this path to a 404 unless `VULTO_DIAGNOSTICS` is
 * set, and `pnpm dev` is the only thing that sets it. A production build
 * therefore serves a 404 here.
 *
 * **The handler still ships in the bundle.** `next build` compiles this route
 * and the rewrite makes it unroutable; it does not remove the code. That is a
 * weaker guarantee than deleting it would be, and it is stated rather than
 * glossed because the route queries a database with no permission context.
 * The durable answer is that this route is deleted once FDN-60 provides
 * authentication and a real health surface can replace it.
 */

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3101";

type Status = Awaited<ReturnType<AppRouter["system"]["status"]>>;

async function fetchStatus(): Promise<
  { ok: true; data: Status } | { ok: false; error: string }
> {
  try {
    const response = await fetch(`${API_URL}/trpc/system.status`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return { ok: false, error: `API responded ${response.status}` };
    }
    const body = (await response.json()) as { result: { data: Status } };
    return { ok: true, data: body.result.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function DiagnosticsPage() {
  const result = await fetchStatus();

  return (
    <main style={{ font: "13px ui-sans-serif", padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>Diagnostics</h1>
      <p style={{ maxWidth: "60ch", opacity: 0.7 }}>
        Development scaffolding, not a product surface. Proves roster-web &rarr; tRPC
        &rarr; Fastify &rarr; Drizzle &rarr; Postgres. Reads no workspace data and
        touches no graph node.
      </p>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 8 }}>
        <dt>Web</dt>
        <dd>ok — this page rendered</dd>

        <dt>API</dt>
        <dd>{result.ok ? "ok" : `unreachable — ${result.error}`}</dd>

        <dt>Postgres</dt>
        <dd>
          {result.ok
            ? result.data.database === "ok"
              ? `ok — server time ${result.data.databaseTime}`
              : `unreachable — ${"detail" in result.data ? result.data.detail : ""}`
            : "unknown — the API did not answer"}
        </dd>

        {result.ok ? (
          <>
            <dt>Round trip</dt>
            <dd>{result.data.latencyMs} ms</dd>
          </>
        ) : null}
      </dl>

      <p style={{ maxWidth: "60ch", opacity: 0.7 }}>
        If Postgres is unreachable, run <code>pnpm stack:up</code>.
      </p>
    </main>
  );
}

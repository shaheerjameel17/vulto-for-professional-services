# Stage 6 — Sync: audience, shape proxy, device cache, outbox, offline

**Status:** COMPLETE, with one CI step waiting on the founder (item 9 below)
**Branch:** stage-6-sync @ HEAD (the commit that adds this report)
**Linear issues:** FDN-100 (server half), FDN-99 (client engine), FDN-101 (host, browser suite, CI)
**Date:** 2026-09-21

## 1. Summary
A device now keeps a permission-filtered copy of the graph and works from it. The server writes, for every member, exactly which Tier 0 rows they may hold (the sync audience, written only by the materializer and only from the interceptor's own decision). Electric streams those rows to the device through an authenticated proxy that decides every part of the request itself. On the device, a worker keeps the rows in a local SQLite database, answers queries from it with no network, queues changes made offline and uploads them once, in order, when the connection returns, and erases everything the moment access is revoked. No Tier 1 or Tier 2 value ever reaches the device: those live in worker memory only, and a browser test scans every IndexedDB database for planted values and finds none. Two things were found by running against real Electric and are recorded as F211: audience removals arrive as `move-out` events rather than deletes, and the pinned client sends three parameters the proxy did not list.

## 2. Done-criteria checklist
Browser suite `packages/graph/sync-browser-tests/sync.spec.ts` (ten tests, all passing against the real stack: Postgres, Electric 1.8.1, the API, and Next):

- [x] First sign-in replicates and a query returns the member's rows — `first sign-in replicates the member's rows and the query returns them`.
- [x] Cold offline boot — `cold offline boot: with the API unreachable, a reload still answers queries and reports Offline`.
- [x] Three offline mutations, each applied exactly once, asserted on `graph_mutations` — `three offline mutations replay on reconnect, each applied exactly once`.
- [x] Two tabs share one connection and one cache — `two tabs: a mutation in one appears in the other without a reload`.
- [x] A queued state transition rejected as `stale-state` is reverted and needs attention — `a queued state transition the server rejects as stale is reverted locally and needs attention`.
- [x] Removing the member's role removes the forbidden rows on next connection — `removing the member's role removes the rows they may no longer read from the cache`.
- [x] Device revocation removes the IndexedDB database — `revoking the device erases that workspace's local database`; also for a removed member, `revoking the person's access erases that workspace's local database`.
- [x] No protected data on the device (Tier 1 and Tier 2 sentinels, every IndexedDB database, both web-storage areas, cookies, CacheStorage and every cache table, with a positive control that plants a value and finds it) — `no Tier 1 or Tier 2 value reaches any browser storage`.
- [x] Added beyond the brief: the dedicated-worker fallback replicates and answers queries — `without SharedWorker the dedicated-worker fallback replicates and answers queries`.

Server tests, all passing:

- [x] Audience conformance (A003-T57), every role over a workspace with a node of every registered type — `audience.integration.test.ts::holds for every role over a workspace with a node of every registered type`, `::fails when the audience is wrong...` (proves the suite would catch a policy error), `::puts an edge in the audience only when both endpoints are...`.
- [x] Publication allowlist — `::publishes exactly the four tables`, `::gives the vulto_electric role SELECT on those four and nothing else, and no write anywhere`.
- [x] The proxy rejects `table`, `where`, `columns`, `params` and any non-protocol parameter — `shape-proxy.integration.test.ts::refuses a client-supplied table, where, columns or params, and any parameter that is not protocol`; only two templates exist — `::serves only the nodes and edges templates`.
- [x] The proxy returns `access-revoked` for a removed member, a revoked device and a workspace-scoped revoke, and the reply is byte-identical for every way of not being an active member (never a member, nonexistent workspace, malformed id, suspended, removed) — `::returns access-revoked with erase for a removed member`, `::gives byte-identical bodies for every way of not being an active member`, `::returns the same reply for a revoked, unregistered or malformed device`, `::returns the same reply for a device revoked for this workspace only...`.
- [x] The proxy against real Electric streams exactly the audience rows — `::streams exactly the person's audience rows, and none they may not hold`, `::streams edges through the same audience` (run with `ELECTRIC_LIVE_TESTS=1` against `vulto`).

VPS-A003's acceptance criteria:

| Acceptance criterion | Test |
|---|---|
| Laptop starts offline; boots from the cache, `Offline`, no prompt | `cold offline boot: ...` (the reload happens with the API unreachable; the client opens the cache from the identifiers in `session_hint`, no token) |
| Offline create appears at once, `PendingChanges`, committed once on reconnect | `three offline mutations replay on reconnect, each applied exactly once`; unit: `engine.test.ts::queues offline as PendingChanges, retries with 1 s doubling to 60 s, and uploads each exactly once on reconnect` |
| Offline rejection is refused `stale-state`, the second person sees the current state and the reason | `a queued state transition the server rejects as stale is reverted locally and needs attention` (the row is `Active` again locally, and the attention list carries `stale-state`) |
| Fully synced device holds no Tier 1 or Tier 2 value and no record the member may not read | `no Tier 1 or Tier 2 value reaches any browser storage` for the first half; the second half is the audience itself, proved by the conformance suite and observed on the device by `removing the member's role...` |
| Revocation erases the device | `revoking the device erases that workspace's local database`; unit: `engine.test.ts::wipes the local database before anything else runs, and stops applying rows` |

## 3. Spec clauses implemented
| Spec ID | Where implemented | Test proving it |
|---|---|---|
| A003-T52 (Electric reads Postgres with a limited role, manual publishing) | migration `0018_electric_role_and_publication.sql`, `docker-compose.yml`, `scripts/set-electric-password.mjs` | `audience.integration.test.ts` role and publication tests; live proxy tests |
| A003-T56 (no Tier 1 or 2 on a device) | `protected-store.ts` (memory only), shapes carry Tier 0 only | `engine.test.ts::keeps a protected value out of every cache table...`; browser scan test |
| A003-T57 (audience equals the interceptor's permitted set) | `audience/materializer.ts` | the four conformance tests above |
| A003-T58 (publication allowlist) | migration 0018 | `::publishes exactly the four tables` |
| A003-T63 (offline writes queue; online-only refused) | `engine.ts::mutate`, `outbox.ts` | `engine.test.ts::refuses an online-only mutation immediately while offline`; browser offline-mutations test |
| A003-T64 (rejection reverts and surfaces) | `engine.ts` drain, `outbox.ts` | `engine.test.ts::reverts a rejected mutation locally, keeps it with its reason, and shows NeedsAttention`; browser stale-state test |
| A003-T65 (SyncStatus) | `status.ts` | `engine.test.ts::is Offline with nothing queued...`; every browser test reads it |
| A003-T66 (one connection and one cache per device) | `sync-worker.ts` (SharedWorker), `host.ts` (Web Locks fallback, `BroadcastChannel`) | `two tabs: ...`; `without SharedWorker ...` |
| A003-T67 (narrowing and revocation remove rows; revoked device erases) | `engine.ts::#handleRevoked`, `cache.ts` move-out, proxy | `wipes the local database before anything else runs...`; browser role, membership and device tests |
| A003-T71 (`x-vulto-schema-version` on every request) | `api.ts::apiHeaders` | `engine.test.ts::is sent on every API request the client makes` |
| A003-T72 (the proxy decides every shape parameter) | `sync/shape-proxy.ts` | the four proxy tests above |
| A001 "Local graph query layer", A001-T07 availability | `query.ts`, `engine.ts::query` | `engine.test.ts::lists with paging, and walks edges as of a date, including a recursive walk that survives a cycle`, `::reports mid-sync until both shapes have caught up, then ready` |
| F203 (CI Postgres with logical replication) | `.docker/ci-postgres/Dockerfile`, `ci-image.yml`, `slow-lane.yml` | see item 9 in section 10 |
| F210 (recorded ruling for Stage 7) | `docs/Foundations_Findings.md` | none; a Stage 7 obligation |
| F211 (found in this stage) | `cache.ts`, `shape-source.ts`, `shape-proxy.ts` | `engine.test.ts::a move-out removes rows whose only tag left...`; browser role test |

## 4. Files changed
64 files, 12,308 insertions, 29 deletions against `main` (excluding the generated Drizzle snapshot and the lockfile in the list below):
```
 .docker/ci-postgres/Dockerfile                     |    9 +
 .github/workflows/ci-image-ref.env                 |    8 +
 .github/workflows/ci-image.yml                     |   43 +
 .github/workflows/slow-lane.yml                    |   77 +-
 apps/roster-web/next.config.ts                     |    1 +
 apps/roster-web/src/app/sync-harness/*             |   81 +
 apps/roster-web/tsconfig.json                      |    8 +-
 docker-compose.yml                                 |    5 +-
 docs/Foundations_Findings.md                       |   29 +
 docs/Vulto_Specs/VPS-A001 (pin table)              |    2 +-
 packages/graph/playwright.sync.config.ts           |   83 +
 packages/graph/sync-browser-tests/{helpers,sync.spec}.ts | 671 +
 packages/graph/src/sync-client/* (20 files)        | ~3,000 +
 packages/schema/src/policy/principal-policy.ts     |    6 +-
 scripts/artifact-check.mjs                         |    4 +-
 services/api/drizzle/0017_striped_chameleon.sql    |   16 +
 services/api/drizzle/0018_electric_role_and_publication.sql | 25 +
 services/api/scripts/set-electric-password.mjs     |   33 +
 services/api/src/audience/* (3 files)              |  891 +
 services/api/src/sync/shape-proxy(.integration.test).ts | 599 +
 services/api/src/test/{browser-setup-sync,sync-browser-support}.ts | 71 +
 (plus small hooks in auth/, mutations/pipeline.ts, server.ts, db.ts, turbo.json, package.json)
```

## 5. Database changes
- Migration `0017_striped_chameleon.sql`: `sync_node_audience (workspace_id, user_id, node_id)` and `sync_edge_audience (workspace_id, user_id, edge_id)`, primary keys as briefed, identifiers only.
- Migration `0018_electric_role_and_publication.sql`: role `vulto_electric` (`LOGIN`, `REPLICATION`, no password in the migration), `SELECT` on exactly `graph_nodes`, `graph_edges` and the two audience tables, `REPLICA IDENTITY FULL` on those four, and publication `electric_publication_default` containing exactly them. `scripts/set-electric-password.mjs`, run by `db:migrate`, sets the password from `ELECTRIC_DB_PASSWORD`.
- A fresh database migrated from empty records 19 migrations (0000–0018).
- The device cache (client side) has `cache_nodes`, `cache_edges`, `cache_tags`, `sync_cursor`, `outbox` and `session_hint`; `cache_tags` is the one table beyond the brief (F211).

## 6. Tests and gates
- `pnpm install --frozen-lockfile` — exit 0.
- `pnpm stack:up` — Postgres, Redis and Electric healthy.
- Fresh-database migration (`drizzle-kit migrate` on a new database) — exit 0, 19 migrations recorded.
- `pnpm verify` — exit 0; `@vulto/graph`: `Test Files  26 passed (26)`, `Tests  313 passed (313)`.
- `pnpm verify:full` — exit 0; `@vulto/api`: `Test Files  12 passed (12)`, `Tests  218 passed | 2 skipped (220)` (the two skipped are the live-Electric proxy tests, which need `ELECTRIC_LIVE_TESTS=1`).
- Live-Electric proxy tests — `ELECTRIC_LIVE_TESTS=1 DATABASE_URL=postgres://vulto:vulto@localhost:5432/vulto pnpm --filter @vulto/api exec vitest run src/sync`: `Tests  11 passed (11)`.
- `pnpm arch:check` — exit 0.
- `pnpm --filter roster-web build` then `node scripts/artifact-check.mjs` — `72 production chunks clean · 5 diagnostics routes, all excluded`, with `__vultoSync` now among the guarded symbols (the check now treats `*-harness` routes like `*-diagnostics`).
- `pnpm test:sync-browser` (which is `playwright test --config packages/graph/playwright.sync.config.ts` after starting local TLS material) — `10 passed (34.9s)`.

## 7. Micro-decisions
- **Workspace header on the proxy (ruled).** The proxy reads `x-vulto-workspace-id` as a lookup key only, validates it as a UUID and checks it against the session user's membership on every request. Every non-active case returns the identical `access-revoked` reply with `erase: true`, and all three checks (membership, device, workspace-scoped revoke) always run so nothing branches on whether a workspace exists.
- **Device registration precedes the first shape request.** The proxy refuses an unregistered device as revoked, so the client registers before it starts replication (found by the first browser run). Offline, registration fails fast and replication starts from the cache anyway.
- **F211:** move-out events over row tags are applied in the cache; the proxy also forwards `expired_handle`, `cache-buster` and `log=full` (only that value).
- **The tRPC procedures act in the session's active workspace** (existing Stage 3 behavior), while the proxy takes the workspace from the header. The browser tests set the session's active workspace directly, as `trpc.integration.test.ts` does. The sync client cannot yet be used for two workspaces at once against the mutation path; that needs a decision when workspace switching is built.
- **Status precedence:** `NeedsAttention` > `PendingChanges` > `Offline` > `Syncing` > `Synced`. Queued changes show as pending even while offline, because that is what the person can act on.
- **Availability mapping:** queries are `mid-sync` until both shapes have caught up, then `ready`; `protectedRead` is `requires-connection`, `permission-absence` or `ready`. `protectedRead` always tries the request rather than trusting a remembered offline state.
- **wa-sqlite** (`1.0.0`, async build) allows one call at a time, so the engine serializes every database use with one mutex. Inside the cache the file is named `cache.db`; the IndexedDB database carries the `vulto:<workspaceId>:<userId>` identity.
- **`@electric-sql/client` 1.5.28**, exact, recorded in the `VPS-A001` pin table.
- **`x-vulto-schema-version`:** no tRPC client exists in `apps/` yet, so the requirement is met by the sync client's `apiHeaders`, which every request it makes carries, including `/devices/register`; a test asserts it.
- **Live-Electric server tests are opt-in** (`ELECTRIC_LIVE_TESTS=1`, database `vulto`), because Electric replicates one database. CI runs them in the new `sync-browser` job.
- **Browser test network cut:** a TCP proxy in front of the API is closed and reopened, which drops the long-lived replication request the way a real outage does. `--ignore-certificate-errors` is passed to Chromium because Playwright's `ignoreHTTPSErrors` does not reach shared workers.
- **`services/api/src/test/sync-browser-support.ts`** re-exports what the browser suite needs from the API, so `packages/graph` gains no dependency on Drizzle.
- **Harness route `/sync-harness`** exists only under `VULTO_SYNC_HARNESS=1` and is excluded from the production build like the diagnostics routes.

## 8. Findings raised
- **F210** (closed by founder ruling before this stage's client work): the workspace-scoped device revoke must survive Stage 7. Stage 7 must create `device_workspace_revocation`, backfill it, repoint every check and prove a pre-migration revoke survives, before dropping `device_unlock_secret`. The shape proxy reads `device_unlock_secret` until then.
- **F211:** Electric signals audience removals as `move-out` events over row tags, and the proxy's parameter list was too short for the pinned client. Implementation stands; a specification correction to `VPS-A003` T72 and "Reads" is proposed in the findings file for the founder to apply.

## 9. Deviations from this brief
- The browser suite has ten tests, not eight: one for the dedicated-worker fallback (which the brief requires to work but does not list as a test) and one that separates device revocation from member removal.
- The `electric` service is not an ordinary `services:` entry in the slow lane. Electric connects as `vulto_electric`, which the migration creates and the password script arms, so it cannot start before them. The `sync-browser` job runs on the host: Postgres as a service, then migrate, then `docker run` Electric on the same pinned digest, then the suite in the CI image. The behavior the brief asks for (the same pinned digest, the `vulto_electric` role, the suite in the slow lane) is met; the shape is different.
- The CI Postgres image was split into its own pull request (#4) at the founder's direction.

## 10. Known limitations and risks
- **CI Postgres image is not published yet (needs the founder).** PR #4 (`https://github.com/shaheerjameel17/vulto-for-professional-services/pull/4`) is open. Until it merges and `ci-image.yml` publishes `ghcr.io/shaheerjameel17/vulto-for-professional-services/ci-postgres`, `ci-image-ref.env` on this branch points at the plain pinned `postgres:17-alpine` digest, which lacks the replication flags, so the new `sync-browser` job cannot pass on GitHub yet. After the merge: read the digest from the ci-image workflow run's `postgres` job, set `CI_POSTGRES_IMAGE` to `ghcr.io/shaheerjameel17/vulto-for-professional-services/ci-postgres@sha256:<digest>` in `.github/workflows/ci-image-ref.env`, and run the slow lane. I will do the repin as soon as the digest exists.
- **The `sync-browser` CI job has never run on GitHub.** Everything in it was written against the same commands that pass locally, but the `docker run` steps, the CI image's ability to run Chromium with the shared-worker flag, and the host-network wiring are unverified until the repin lands.
- **Tag format.** Move-out handling relies on the observed `<pos>/<hash>` tag format of Electric 1.8.1 (F211). Two tests fail loudly if an upgrade changes it.
- **Proxy still reads `device_unlock_secret`** until Stage 7 (F210).
- **Active workspace.** The proxy honors the workspace header, but mutations and protected reads use the session's active workspace; a person with two workspaces open at once is not supported until workspace switching is designed.
- **No real sign-in UI drives the client yet.** The harness route and the tests set the session directly; the product pages do not create a client until a feature needs one.
- **Live revocation latency.** A revoked device learns at its next request; the long-poll is up to about 20 seconds, so the device-revocation browser test takes about 21 seconds.
- **The cache database has no schema-version guard.** Adding `cache_tags` needed none because no device holds an older cache, but the next change to the cache tables needs a version check.
- The two Tier 1 and Tier 2 store checks scan the browser; no test inspects the server's Electric shape log storage, which holds Tier 0 rows only by construction (the shapes' tables never contain a protected value).

## 11. Readiness for the next stage
Yes for Stage 7 once the CI image repin lands (the retirement of the archived code and the CI hardening both depend on a green slow lane). Stage 7 must carry the F210 amendment: `device_workspace_revocation` before `device_unlock_secret` is dropped.

# Stage 23 — Local-First Search

**Status:** COMPLETE
**Branch:** `codex/stage-23-local-first-search` @ `0833c6f` (implementation; report commit follows)
**Linear issues:** RST-51
**Date:** 2026-09-25

## 1. Summary

The device now has a Tier 0-only, trigger-maintained search index and a local search query for Employee, Skill, Project and Client. The query shares Skill Matrix's Assignment-based availability rule and returns static command matches without a server call. All four standard gates passed; the full browser suite matched clean `main`'s nine pre-existing failures exactly, while the role-removal test passed its index, name and protected-value sentinel assertions. The remaining browser-suite repair is F305/FDN-126, outside this stage.

## 2. Done-criteria checklist

- [x] `cache_search` exists in the replicated schema and tables at cache version 3 — `database.test.ts::rebuilds a version-2 cache including the search table and triggers`.
- [x] Registry proves Tier 0 fields and refuses `AuditEntry` — `search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names`.
- [x] Insert, rename, soft-delete, reactivation, hard-delete and reset update the index on the next query through `SqliteCache` — `search.test.ts::maintains insert, rename, soft-delete, reactivation, hard-delete and reset synchronously`.
- [x] `%`, `_` and non-ASCII names match literally with SQLite `lower()` on both sides and explicit `ESCAPE` — `search.test.ts::escapes LIKE wildcards and matches non-ASCII text using SQLite normalization`.
- [x] A local three-character query at 150 Employees plus 50 Projects returns grouped results without network access — `search.test.ts::returns grouped matches at 150 employees and 50 projects without a network call`; `per`, 30 samples, p95 **0.90 ms** in the final `pnpm verify` run; 100 ms regression ceiling.
- [x] Ranking is label-prefix, word-prefix, substring, Active first, deterministic ties, per-type limit — `search.test.ts::ranks label-prefix, word-prefix, substring, Active, and binary ties with a per-type limit`.
- [x] `skillMatched` is pre-limit; result has no `skillMatches` and no local ad-hoc wrapper — `search.test.ts::computes skillMatched before the limit and returns commands alongside entities`.
- [x] Real Ghost uses `employee_type === "Ghost"` and its role title — `search.test.ts::ignores unresolved labels and indexes/relabels a real Ghost by role title`.
- [x] Availability and next rolloff share one Assignment helper with `getSkillHolders` — `search.test.ts::shares Assignment coverage and earliest rolloff with Skill Matrix`; unchanged `skill-matrix.test.ts` passed in the graph suite.
- [x] Commands have symbolic targets, no role check, executor or `apps/` import — `search-commands.ts`; `search.test.ts::computes skillMatched before the limit and returns commands alongside entities`.
- [x] Registry fingerprint pin rejects an unversioned registry change — `database.test.ts::pins the searchable registry to cache schema version 3`; a temporary additional Client field made this test fail, then reverting it made the test pass (1 passed/10 skipped).
- [x] Full browser run is identical to clean `main` by failing test name and message; all other tests, including role-removal's set-equality, fixture-name and Tier 1/2 sentinel assertions, pass — Section 6 baseline/comparison (18 passed, same 9 failed on each).
- [x] Missing, empty and non-text labels never abort `putNode`; a real Ghost resolves `job_title` — `search.test.ts::ignores unresolved labels and indexes/relabels a real Ghost by role title`.
- [x] Scope holds: no `apps/` file, new mutation/policy/router/principal or dependency; sole API diff is `addNode`'s defaulted `fields` parameter — `git diff --name-only main...HEAD`, `pnpm arch:check`, `pnpm verify`.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| VPS-F002 G01 | `packages/graph/src/sync-client/schema.ts` | `search.test.ts::maintains insert, rename, soft-delete, reactivation, hard-delete and reset synchronously` |
| VPS-F002 G02/G08 | `packages/schema/src/search.ts` | `search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names` |
| VPS-F002 G03/G04 | `packages/graph/src/queries/search.ts` | `search.test.ts::returns grouped matches at 150 employees and 50 projects without a network call`; `::computes skillMatched before the limit and returns commands alongside entities` |
| VPS-F002 G05 | `packages/schema/src/search.ts`, `packages/graph/src/sync-client/schema.ts` | `database.test.ts::pins the searchable registry to cache schema version 3` |
| VPS-F002 G06 | `packages/graph/src/queries/skill-matrix.ts`, `search.ts` | `search.test.ts::shares Assignment coverage and earliest rolloff with Skill Matrix` |

## 4. Files changed

`git diff --stat main...HEAD`:

```text
 .../stage-reports/STAGE-23_Browser_Gate_Finding.md |   5 +
 ...TAGE-23_Existing_Entity_Browser_Gate_Finding.md |   7 +
 .../STAGE-23_Ghost_Label_Guard_Finding.md          |   7 +
 docs/stage-reports/STAGE-23_Local-First_Search.md  | 126 +++++++++
 .../STAGE-23_Search_Browser_Fixture_Finding.md     |   7 +
 .../STAGE-23_Test_Reexport_Arch_Gate_Finding.md    |   5 +
 packages/graph/src/queries/index.ts                |   2 +
 packages/graph/src/queries/search-commands.ts      |  73 +++++
 packages/graph/src/queries/search.test.ts          | 293 +++++++++++++++++++++
 packages/graph/src/queries/search.ts               | 148 +++++++++++
 packages/graph/src/queries/skill-matrix.ts         |  50 +++-
 packages/graph/src/sync-client/database.test.ts    |  51 ++++
 packages/graph/src/sync-client/schema.ts           |  55 +++-
 packages/graph/sync-browser-tests/helpers.ts       |   7 +-
 packages/graph/sync-browser-tests/sync.spec.ts     |  68 ++++-
 packages/schema/src/employee.ts                    |   2 +-
 packages/schema/src/index.ts                       |   1 +
 packages/schema/src/search.ts                      |  84 ++++++
 services/api/src/permission/test-support.ts        |   3 +-
 19 files changed, 981 insertions(+), 13 deletions(-)
```

## 5. Database changes

No server migration. Device cache version 2 → 3 adds `cache_search` (`node_id` primary key, `node_type`, `label`, `lifecycle_status`, `search_text`), an index on `node_type`, and insert/update/delete triggers on `cache_nodes`. Trigger SQL is generated from `SEARCHABLE_NODE_TYPES` alone; the registry validates every field name against `/^[a-z_]+$/` and proves Tier 0 fields using the protection registry and Employee's operational schema. No application code writes `cache_search`; `putNode`, `deleteNode` and `resetTemplate` drive its triggers. Whole-database erasure includes the index automatically.

## 6. Tests and gates

All five gates ran on this branch after Do item 8(d). The fifth gate's expected result is the F305 clean-main baseline, **not** an absolute suite pass.

| Command | Exit | Final result |
|---|---:|---|
| `CI=1 pnpm install --frozen-lockfile` | 0 | Lockfile up to date; already up to date. |
| `pnpm stack:up` | 0 | Postgres, Redis and Electric healthy. |
| `pnpm verify` | 0 | Format and architecture passed; lint 6/6 tasks; conformance 6 passed/2 todo; typechecks 6/6 tasks; schema tests 111 passed/2 todo; graph tests 97 passed. Search p95 0.90 ms. |
| `pnpm verify:full` | 0 | Includes `pnpm verify`, Postgres preflight and API tests: 25 files passed, 319 tests passed, 2 skipped. No browser tests. |
| `pnpm test:sync-browser` | 1 (baseline-matched) | 27 tests: 18 passed, the same 9 failed by name/message as clean main; no branch-only failure. |

Baseline checkout: detached, clean worktree of `main` at `33fc9d6` in `/private/tmp/vulto-stage23-main-baseline`; `CI=1 pnpm install --frozen-lockfile` and `pnpm --filter @vulto/api db:migrate` both exited 0. The branch reran `pnpm --filter @vulto/api db:migrate` (exit 0). Both full browser runs used the same local Postgres/Electric stack, sourced the same `.env`, and used this exact command (the baseline sourced the branch's absolute `.env` path):

```sh
set -a; source .env; set +a
SYNC_BROWSER_DATABASE_URL="$DATABASE_URL" ELECTRIC_URL="$ELECTRIC_URL" ELECTRIC_SECRET="$ELECTRIC_SECRET" pnpm test:sync-browser
```

The following table records every failing test and its observed message from both runs. For JSON errors, the table includes the complete run-specific `Error` value; each also showed `Expected: "applied"` and `Received: "rejected"` at `seedEntities`. The two assertion failures show their exact expected/received values.

| Failing test (`sync.spec.ts`) | Clean main message | Stage 23 branch message |
|---|---|---|
| first sign-in replicates the member's rows and the query returns them | `Error: {"mutation_id":"0b667c07-41e0-42b4-b13d-e34bac1410c0","status":"rejected","reason":"requires-feature-mutation"}` | `Error: {"mutation_id":"3627738d-2ede-403a-9834-ca3aa650374d","status":"rejected","reason":"requires-feature-mutation"}` |
| cold offline boot: with the API unreachable, a reload still answers queries and reports Offline | `Error: {"mutation_id":"89926019-d595-470c-8853-0a9c5d9b1b4e","status":"rejected","reason":"requires-feature-mutation"}` | `Error: {"mutation_id":"e610187f-afb1-4a14-9ae5-7b0ee25e8bf3","status":"rejected","reason":"requires-feature-mutation"}` |
| three offline mutations replay on reconnect, each applied exactly once | `expect(outcomes.every((o) => o.accepted)).toBe(true)`: `Expected: true`, `Received: false` | `expect(outcomes.every((o) => o.accepted)).toBe(true)`: `Expected: true`, `Received: false` |
| two tabs: a mutation in one appears in the other without a reload | `untilSynced`: `Expected: 0`, `Received: 1`, timeout 30000ms | `untilSynced`: `Expected: 0`, `Received: 1`, timeout 30000ms |
| a queued state transition the server rejects as stale is reverted locally and needs attention | `Error: {"mutation_id":"4056a244-31d7-44b6-b427-e5f17504280f","status":"rejected","reason":"requires-feature-mutation"}` | `Error: {"mutation_id":"640044a3-8954-41fe-bc9d-c5d2d692905c","status":"rejected","reason":"requires-feature-mutation"}` |
| no Tier 1 or Tier 2 value reaches any browser storage | `Error: {"mutation_id":"4f86016c-e3ad-4c7c-bae4-698527261507","status":"rejected","reason":"requires-feature-mutation"}` | `Error: {"mutation_id":"3f6a1205-cc5a-446b-aaf0-a153011994ec","status":"rejected","reason":"requires-feature-mutation"}` |
| without SharedWorker the dedicated-worker fallback replicates and answers queries | `Error: {"mutation_id":"a68b1e90-a0ee-450a-aa0c-b032793be790","status":"rejected","reason":"requires-feature-mutation"}` | `Error: {"mutation_id":"d93d0462-b958-4c9f-b458-6ddc9d96c3fc","status":"rejected","reason":"requires-feature-mutation"}` |
| revoking the device erases that workspace's local database | `Error: {"mutation_id":"c9c1b6cb-e35b-4885-8d2b-d994ebd86a95","status":"rejected","reason":"requires-feature-mutation"}` | `Error: {"mutation_id":"61d515bd-0917-4a73-9d6f-95c0f99530a7","status":"rejected","reason":"requires-feature-mutation"}` |
| sign-out erases every workspace's cache on the origin, including one held open by another tab | `Error: {"mutation_id":"78f4bd73-27e5-4960-bcfd-ed6121c34a43","status":"rejected","reason":"requires-feature-mutation"}` | `Error: {"mutation_id":"a6b6eab4-8491-425a-a274-947bb0f7c3ba","status":"rejected","reason":"requires-feature-mutation"}` |

Both runs ended `9 failed`, `18 passed`; the role-removal test passed on the branch with `cache_search` set equality before and after role change, named Employee search text, and the new absence check for unique Tier 1/2 sentinels in `JSON.stringify(dump())` (which includes `cache_search`). The separate A003-T56 test remains baseline-red and was not weakened. The temporary registry-pin perturbation exited 1 as expected (`1 failed`, `10 skipped`), then the restored registry test exited 0 (`1 passed`, `10 skipped`).

## 7. Micro-decisions

- Per-type result limit 8 was set by the brief; no independent product choice was made.
- The benchmark uses 30 samples and the brief's loose 100 ms regression ceiling. The measured p95 above is from the final uncached `pnpm verify` run.
- The sentinel assertion serializes the same `dump()` used by the existing test, so it covers every browser cache table without a second scan path.

## 8. Findings raised

- F301–F304 were ruled before completion and are incorporated here.
- F305 remains open, with repair deferred to FDN-126. Clean `main` and this branch exhibit the identical nine browser failures; Stage 23 did not repair or suppress them.

## 9. Deviations from this brief

None. The full browser suite exits 1, which is explicitly permitted only under F305's identical-baseline rule; both runs and all failures are recorded above.

## 10. Known limitations and risks

The pre-existing browser suite remains red, including its original whole-browser Tier 1/2 storage test. Stage 23's passing role-removal test supplies the F305-required real-browser protected-value sentinel coverage for the new `cache_search` table, not a substitute for FDN-126's full suite repair. Only the local data layer is built; palette UI and server-side protected search remain deferred by the brief.

## 11. Readiness for the next stage

Yes, subject to founder review of this stage and the separate FDN-126 browser-suite repair. Do not begin Stage 24 before approval.

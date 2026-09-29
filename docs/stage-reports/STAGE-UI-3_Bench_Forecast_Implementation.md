# UI-3 — Bench Forecast on real data: implementation report

**Status:** BLOCKED — required real-browser alert fixture cannot be seeded through the permitted pipeline  
**Branch:** `codex/ui-3-bench-forecast`  
**Issue:** RST-57 in Vulto Issues (Engineering), Notion

## Consolidated trace of the corrected brief

The earlier `STAGE-UI-3_Bench_Forecast.md` remains the unedited historical pre-build report. I re-traced F366–F369 and the corrected Do items against the repository before product changes. The corrected routes exist: the local query files and `device-query` dispatcher; `protectedMutate`; the server's protected contextual procedure; the cost endpoint and its schema; the existing mutation definitions; the real-stack browser harness, contrast guard, and visual-capture precedent. The following newly observed documentation inconsistencies do not require a product-code workaround:

1. F369 and corrected Do item 5 say `VRS-F005`'s Manager visibility language was already corrected, but the checked-in spec still says “direct reports” in both its Components and System states sections. Corrected Do item 9 and the user explicitly forbid editing that reviewer-owned spec. The product will follow F292/F369's workspace-wide read policy; the reviewer must make the missing spec correction.
2. `docs/findings/F366.md` is committed as non-text/binary and its final ruling paragraph is corrupted. The preceding six enumerated gaps are readable, and the corrected brief explicitly states the intended implementation, so this does not change the implementation contract. The reviewer should restore the finding's text.
3. F367 describes a pre-existing per-employee 45-day suppression rule in `getBenchForecastCosts`; the function has no such check. The corrected per-region contract therefore needs an explicit start-date guard, without changing the protected-read or per-day costing math.
4. `Home` still calls the fixture `buildForecast` in `lib/bench.ts`, while the UI-3 done criterion requires no fixture imports in that file. The smallest safe split is a retained `prototype-bench.ts` used only by Home, plus a real-data `bench.ts` adapter for the Forecast. Fixture files and Home's prototype behavior stay intact.
5. `ghostResource.create` creates the Ghost Employee and GhostResource but no `scoped_to_entity` edge; the local Forecast needs the edge to resolve a calendar. The browser fixture will create that edge through the existing `graph.createEdge` pipeline after Ghost creation, rather than inventing an Entity fallback in the query.
6. F367 returns the currency with each region cost, but no currency-conversion contract exists for a workspace-wide total across several Entities. The header will present separate per-currency totals, never add unlike currencies into one number. Per-region figures remain unchanged.

These are recorded together, before implementation, as requested. No client-side Manager filter or replacement permission decision will be introduced.

## 1. Summary

F366–F369's product corrections were implemented in part: the local Forecast query now returns complete calendar and presentation facts, the three device queries are registered, the screen and Panel consume the real graph client, and the protected cost endpoint prices regions rather than whole employee windows. F370's corrected test-only `addEdge` fixture is in place and passes the architecture check. F371's three caller-side guards are also in place, but the stage is **not complete**: the same real-browser fixture still exposes dates before an Entity edge/calendar existed despite the employees' earlier start dates, and the annual-cost denominator has an unguarded full-year read. Both are detailed together in section 8. This report supersedes neither the historical pre-build trace nor reviewer-owned rulings.

## 2. Done-criteria checklist

- [x] Three strict local device queries registered, with contextual intelligence local-only.
- [x] Local bench query returns per-date state, excludes Pitch, spans non-working dates, exposes Ghost/Assignment versions and names.
- [x] Region cost contract and on-demand non-cached protected/aggregate fetches wired.
- [x] F370 browser fixture seeds its alert edge through `addEdge`; `node scripts/arch-check.mjs` passes.
- [x] F371's three caller-side employee-start-date guards added without changing G08's shared primitives.
- [ ] All Forecast interactions and real-stack behavior verified — protected calls fail for a freshly created calendar and the historical lead-in.
- [ ] Full browser test, axe and final screenshots — not reachable until the calendar contradiction is ruled.
- [ ] Standard four gates and green branch CI — not claimed.

## 3. Spec clauses implemented

Partial VRS-F005 G02/G03/G04/G08 and F366–F369 device-query, cost, local/remote contextual split, and protected Ghost-promotion paths. No new permission logic was placed on the client. F369's stale spec prose was not edited because the corrected Do item 9 and user explicitly reserve that file to the reviewer.

## 4. Files changed

Pending local diff: `packages/graph/src/{query.ts,index.ts,sync-client/query.ts,queries/bench-forecast.ts,queries/bench-forecast.test.ts,query.test.ts}`, `packages/schema/src/bench-forecast.ts`, `services/api/src/{router.ts,permission/bench-forecast-queries.ts,permission/bench-forecast.integration.test.ts}`, `packages/ui/src/Timeline.tsx`, `apps/roster-web/src/{app/(shell)/page.tsx,app/(shell)/home/page.tsx,components/ForecastPanel.tsx,lib/bench.ts,lib/forecast-server.ts,lib/prototype-bench.ts}`, and the new `packages/graph/sync-browser-tests/bench-forecast.spec.ts`. No file under `docs/findings/`, the ledger, or VRS-F005 was changed. The unrelated untracked `Claude outputs/` and `scripts/dev-seed.mts` were left untouched.

## 5. Database changes

None. No migration or cache-schema change.

## 6. Tests and gates

| Check | Result |
|---|---|
| `pnpm stack:up` | Passed after the permitted Docker-socket escalation. |
| `pnpm conformance && pnpm arch:check && pnpm typecheck && pnpm test:fast` | Passed after the implementation changes at that point. |
| `pnpm --filter @vulto/api exec vitest run src/permission/bench-forecast.integration.test.ts` | 7/7 passed against Postgres after local-network escalation. |
| `pnpm --filter @vulto/api db:migrate` | Passed. |
| `pnpm test:sync-browser --grep 'real Bench Forecast'` | Failed during seed: `graph.createEdge` for BurnoutAlert `triggered_by` returned `{status:"rejected",reason:"role"}`. The earlier attempt failed on a test-only invalid OpenRole lifecycle; corrected from `Active` to the registered `Open` before rerunning. |
| `node scripts/arch-check.mjs` after corrected F370 `addEdge` | Passed: `graph/store — import boundary holds`. |
| `pnpm typecheck` and targeted Prettier check after corrected F370 | Passed (6/6 packages; all four changed files formatted). |
| `pnpm test:sync-browser --grep 'real Bench Forecast'` after corrected F370 | Seed succeeded; local timeline displayed the real employee, assignment and Ghost. Failed at the first protected-cost assertion because no AED figure appeared. The Playwright trace shows both `benchForecast.getAggregate` and `benchForecast.getCost` returning HTTP 500. The aggregate response is `Error: not-found` at `resolvedDayOn` (`services/api/src/graph/working-days.ts:79`), called by `benchDaysForWindow` in `bench-forecast-queries.ts`. The request window began 2026-09-15, 14 days before the just-created calendar on 2026-09-29. |
| `pnpm --filter @vulto/api exec vitest run src/permission/bench-forecast.integration.test.ts` after F371 | 7/7 passed. These existing cases do not cover a calendar created after the employee's start date. |
| `pnpm test:sync-browser --grep 'real Bench Forecast'` after F371 | Still failed at the AED assertion. Both protected endpoints returned HTTP 500; the aggregate response again has `Error: not-found` at `resolvedDayOn`, now called from `benchDaysForWindow` after the new start-date clamp. |
| `pnpm verify` | Initially failed formatting of new code and an unrelated pre-existing untracked `Claude outputs/stage19_resume_after_f279_281.md`; new code was subsequently formatted. Full gate not re-run after the browser blocker. |
| `pnpm install --frozen-lockfile`, `pnpm verify:full`, full `pnpm test:sync-browser`, fast-lane and slow-lane CI | Not run/claimed while blocked. |

## 7. Micro-decisions

The six numbered, consolidated trace notes above apply. The actual Ghost fixture additionally uses an `OpenRole` in its registered `Open` lifecycle, not `Active`. A protected BurnoutAlert node can be seeded through the existing API test support (`addNode` plus `writeProtected`), but creating its relationship through the ordinary mutation is **not** a valid micro-decision: the interceptor rejects it before storage. No raw SQL, deep import, policy expansion, or client-side visibility workaround was added to bypass that gate.

## 8. Finding requiring a ruling

The corrected Do item 7 requires a BurnoutAlert visible to the correct Manager in a real-stack browser spec, seeded through API pipeline helpers, with no server-file change. The test can create the Tier 2 node using existing test support, but it cannot attach the registered `triggered_by` edge through `graph.createEdge`: the exact second browser run refused it with `reason:"role"` at `bench-forecast.spec.ts`'s seed step. `services/api/src/permission/interceptor.ts::edgeRoleDecision` requires a declared governing partition for split endpoints. `triggered_by` in `packages/schema/src/registry/edges.ts` has no `Employee:operational` governing partition, so the generic edge mutation cannot pass Gate 1 even for Owner; changing that policy would be a product permission decision, not a fixture fix. The existing API integration test seeds this edge with `insertEdge` directly from the store. The sync-browser support barrel has no equivalent edge helper; adding one via `permission/test-support.ts` and its re-export in `test/sync-browser-support.ts` would change server test-support files outside the corrected UI-3 scope. Please rule whether that narrowly test-only edge fixture is authorized, or name the intended production pipeline path. No browser assertion, screenshot, or gate is claimed until the fixture can be seeded without widening production permissions.

**29 September resume after F370:** F370 rules that this is a test-fixture edge and prescribes a direct `export { insertEdge } from "../graph/store.js";` in `services/api/src/test/sync-browser-support.ts`. I applied that exact export plus the prescribed `edgeRecord` export temporarily and ran `node scripts/arch-check.mjs`. It exited 1 with two A003-T52 failures against the new `test/sync-browser-support.ts:17` line: `graph/store may be imported only from the graph, permission, mutations, protected, audience and jobs folders`, and `the graph is written only by the mutation pipeline`. The exports were then removed, returning the product tree to its prior state. `scripts/arch-check.mjs` explicitly scans re-exports in every `services/api/src` folder, and its import and write-path allowlists do not exempt `src/test`. Thus F370's exact two-line remedy and the mandatory clean `pnpm verify` gate cannot both be satisfied. The narrowest apparent fix is to re-export `insertEdge` from the already-allowed `permission/test-support.ts`, then re-export it alongside `edgeRecord` from the browser barrel, but that is **not** the direct two-line route F370 orders and needs an explicit ruling. No gate, policy, or production write path was changed to work around the failure.

**29 September resume after F370's corrected addendum — new blocker:** The reviewer corrected the mechanism to `addEdge` in `permission/test-support.ts`, re-exported by name from the browser barrel. I implemented it exactly, and `node scripts/arch-check.mjs` passes. The focused browser test now seeds and renders the local Forecast, then the first on-demand protected cost and aggregate calls both return HTTP 500. The aggregate response names `Error: not-found` at `working-days.ts:79`, the `resolveCalendarForEntity(..., date)` null branch. Its input starts on 2026-09-15 because `forecastWindow` intentionally includes VRS-F005's 14-day historical lead-in; `entity.create` creates the initial `WorkingCalendar` with `created_at = ctx.now` on 2026-09-29, and `resolveCalendarForEntity` refuses to return a calendar for an `asOf` date before that timestamp. The same problem affects a real customer who opens the Forecast within the first 14 days of workspace/Entity creation, not just this fixture. Even changing the employees' `scoped_to_entity` effective date cannot create a valid pre-existing calendar through `entity.create`; shifting only the browser clock or narrowing the server window would conceal the defect or make the local and aggregate windows disagree. A product rule is needed for pre-creation historical days: either explicitly exclude them from both the local and server answers or assign an initial-calendar interpretation to them. Neither choice is settled by F366–F370 or VRS-F005, and it changes calendar/aggregate semantics, so I stopped before altering product code or weakening the browser test. The Playwright trace and `error-context.md` from this run are local under `packages/graph/test-results/`.

**29 September resume after F371 — two residual contradictions in one finding:** I implemented F371 literally: `benchDaysForWindow` clamps to `Employee.start_date` and returns no dates when that exceeds the window; `utilizationTotals` and `getBenchForecastCosts` skip pre-start dates; the three G08 primitives remain untouched. The focused API integration suite passes 7/7. The real browser still returns 500 from both protected calls, with the aggregate's trace again showing `not-found` at `resolvedDayOn` via `benchDaysForWindow`. Its ten employees deliberately have `start_date = today - 60 days` (realistic existing staff being entered into a new workspace), while `employee.create` and `entity.create` create their `scoped_to_entity` edges and initial calendars at `ctx.now`. The 14-day lead-in is **after** employee start but **before** both effective resources. Thus employee-start clamping cannot solve the fresh-workspace fixture that F371 expressly says it covers; a workspace of any age also has this shape when an existing employee is moved to a newly created Entity. Separately, annual or monthly cost calls `countWorkingDaysFromGraph(employeeId, year-01-01, year-12-31)` inside its denominator, which iterates `resolvedDayOn` from January 1 even after the three outer F371 date guards. That read crosses dates before a new hire, edge or calendar and may throw independently; simply skipping pre-start region dates cannot make the denominator safe. Resolving either case changes temporal/calendar or denominator semantics beyond F371's authorized three guards. I did not backdate production provenance, alter the fixture to hide existing-staff migration, swallow `not-found` (which also signals permission denial), or modify shared G08 primitives. Please rule both the effective-edge/calendar boundary and full-year denominator together.

## 9. Deviations from the brief

The fixture route is now available under F370's corrected addendum. Implementation stopped at the required real-browser proof because fresh-workspace historical calendar resolution makes the protected server calls fail. Product-code edits already made are **partial and unaccepted**, not a completed stage. The required `assignment.update` call was added to the Panel, but the browser has not reached it or the other mutation assertions.

## 10. Known limitations and risks

The new browser spec seeds successfully but is red at the first cost assertion because both protected server calls fail on the historical lead-in. The partially implemented screen still needs complete role/offline/action/scroll coverage, screenshots, performance measurement, and a full gate run. F364's unrelated timing assertion and threshold remain untouched. Multiple-currency totals are displayed separately rather than incorrectly summed.

## 11. Readiness for review

Not ready for acceptance. F370's fixture ruling and F371's three caller guards are implemented, but the existing-staff/new-Entity lead-in and full-year cost denominator still need one consolidated ruling. After that, finish the browser assertions and screenshots, run every gate, push the final branch, and collect both workflow run IDs. Do not start UI-4.

# UI-3 — Bench Forecast on real data

**Status:** BLOCKED — consolidated pre-build trace; no product code written
**Branch:** `codex/ui-3-bench-forecast` from `main` at `621ba96c2b47a08ded902bd856b04a5f1eadfc80`
**Notion issue:** RST-57 (Legacy Linear ID; Vulto Issues (Engineering))
**Date:** 2026-09-29

## 1. Summary

The UI-3 brief assumes the three existing local queries can be wired unchanged. Tracing their returned data, the server endpoints, the sync audience, mutation definitions, and the current screen found the contradictions below. Several require a server/policy decision or a change to query files the brief expressly freezes, so implementation has stopped before product code. The pending reviewer docs commit `621ba96` was pushed and verified on `origin/main` before this branch was created.

## 2. Done-criteria checklist

- [ ] Register three device queries — blocked by the protected contextual-query contract in section 8.
- [ ] Render the real forecast with unchanged local queries, filters, calendar shading, and Panel scroll — blocked by the missing row facts and audience scope in section 8.
- [ ] Render separately fetched cost and aggregate without leaking protected data — blocked by the cost endpoint's per-employee, not per-region, result in section 8.
- [ ] Wire assignment create/update/cancel, Ghost promotion, conflict override, and optional alert dismiss through the real mutations — create/update/override/dismiss are registered, but cancel and promotion lack required input data; `client.mutate` refuses promotion.
- [ ] Remove the role toggle and rely on a Manager-scoped audience — the audience does **not** narrow the Manager's Employee/Assignment/GhostResource rows to direct reports.
- [ ] Use the guarded contrast baseline, pass real-stack browser tests, and commit screenshots — not started while the data and permission contracts are unsettled.
- [ ] Keep Home's fixtures, pass four gates, and obtain green CI — no product code or gates run on this blocked pre-build branch.

## 3. Spec clauses implemented

None. `VRS-F005` G02, G03, G04, G05, G06, G08 and its Manager cohort, Panel, cost, and offline contracts were traced, not implemented.

## 4. Files changed

This report only. No file under `apps/`, `packages/`, or `services/` was changed. The pre-existing untracked `Claude outputs/` and `scripts/dev-seed.mts` were left untouched.

## 5. Database changes

None.

## 6. Tests and gates

Not run: `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, `pnpm verify:full`, and `pnpm test:sync-browser`. A green gate on a report-only branch would not resolve the contract contradictions. Existing local unit tests were inspected: `bench-forecast.test.ts` has one offline/filter scenario, `contextual-intelligence.test.ts` tests only `getLocalContextualIntelligence`, and `conflict-check.test.ts` has one calendar/threshold scenario. F364's separate UI-1 `queryP95 < 30ms` assertion was not changed.

## 7. Micro-decisions

None; no product implementation decision was made. Two narrow trace corrections do not need a product ruling: `Timeline.tsx` and `useShortcuts.ts` are in `packages/ui/src/`, not the app; and the `assignment.create`/`assignment.update`/`assignment.cancel`, `ghostResource.promote`, and `conflictResolution.overrideAndProceed` names are generic `graph.applyMutations` definitions rather than dedicated routers in `services/api/src/router.ts`. The already-built `revenueGapAlert.dismiss` does have a dedicated router procedure. This does not authorize changing `packages/ui` or those mutation contracts.

## 8. Findings raised

These are **one consolidated pre-build report**, pending reviewer numbering/ruling; reviewer-owned specs, ledger, and `docs/findings/` were not edited.

| ID | Contradiction and direct evidence | Why the brief's in-scope route fails / ruling needed |
|---|---|---|
| UI3-A — blocking | `VRS-F005` says a Manager's rows and aggregates are direct reports. In `packages/schema/src/policy/policy-table.ts`, `Employee:operational` gives Manager `readScope: "any"` (lines 376–383), `Assignment` gives `FULL_ANY()` (450–455), and `GhostResource` gives `FULL_ANY()` (265–270). `services/api/src/audience/materializer.ts` lines 260–279 writes every readable Tier 0 node to the Manager's audience using `decideRead`. `getBenchForecast` iterates every cached Active Employee (bench-forecast.ts lines 128–130); the server aggregate builds its cohort via `listEmployees`, which uses `filterReadable` (employee-queries.ts lines 43–58). | The screen cannot meet its direct-report scope by trusting the current audience, and a client-side Manager filter is explicitly forbidden by Do item 5. A policy/audience/server-scope correction is outside UI-3's stated no-server/schema/permission boundary. |
| UI3-B — blocking | `BenchForecastRow` contains only `employee`, assignment bars, `benchPeriods`, and `benchDayCount` (bench-forecast.ts lines 29–35). `getBenchForecast` resolves WorkingCalendar/Holiday/WorkingPattern internally (lines 127–187) but returns none of the per-date working states or holiday notes (lines 243–253). `TimelineRow` requires `workingDayStates: boolean[]` and `TimelineDay` carries header `isWorking`/`note` (`packages/ui/src/Timeline.tsx`); current `lib/bench.ts` derives them from fixture calendar data. Covered days are absent from `benchPeriods`, so their working state cannot be reconstructed from the return. | Do item 2 says those calendar facts are already present on each returned row, prohibits a separate calendar read, and freezes the three query files. At least one of those instructions must change to preserve the existing per-person shading and holiday treatment. |
| UI3-C — blocking | `getBenchForecast` computes uncovered days solely from Assignment coverage (bench-forecast.ts lines 159–190) and reads no TimesheetEntry/Pitch. The server's `benchDaysForWindow` explicitly excludes Pitch-categorized TimesheetEntry dates (bench-forecast-queries.ts lines 90–121). VRS-F005 G02 and its acceptance criterion now require that exclusion because VRS-F009/F010 exist. | F365's claim that the local query is already correct and must stay byte-unchanged is false for this live feature. Wiring it as-is would paint known Pitch work amber and disagree with the server aggregate/cost. |
| UI3-D — blocking | `benchForecast.getCost` returns one `{ amount, currency } | null` **per employee** for the whole supplied window (`bench-forecast-queries.ts` lines 375–481). It does not return a per-day or per-bench-period breakdown. The UI and VRS-F005 require a figure in each qualifying amber region, with the F36 rule hiding costs for regions beginning beyond the 45-day cost horizon; `lib/bench.ts` currently computes each region separately. | A single batch for the visible cohort and window cannot allocate the server's total exactly across several regions, changing year, daily hours, or beyond-horizon spans. Client-side allocation would reimplement protected cost math, while one request per region violates Do item 4. The response/contract or presentation rule needs a ruling. |
| UI3-E — blocking | `runCacheQuery(database, query)` is local-only (`sync-client/query.ts` lines 111–125); the engine calls it under `#exclusive` and subscriptions await that result (`engine.ts` lines 316–344). `getContextualIntelligence` awaits `Promise.all([getLocalContextualIntelligence, getProtected])` (`contextual-intelligence.ts` lines 57–66). `engine.protectedRead`/the worker API take known **node IDs**; the alert IDs are not in Tier 0 cache. The existing server `contextualIntelligence.getProtected` discovers alert IDs by incoming `triggered_by` edges and then audited `readProtected` (`services/api/src/permission/contextual-intelligence-queries.ts`). | Passing `engine.protectedRead(employeeId)` cannot supply BurnoutAlert/FlightRiskSignal, and injecting the server procedure into `device-query` makes the supposedly local subscription wait for a network call, breaking Tier 0 offline behavior. Splitting local `getLocalContextualIntelligence` from a typed `getProtected` fetch is plausible, but contradicts Do item 1's exact unchanged-function dispatch and requires a ruling. The existing local unit test tests the split local helper, not the combined function. |
| UI3-F — blocking | `ghostResource.promote` is `onlineOnly: true` (`packages/schema/src/mutations/ghostResource.ts` lines 60–70), while `SyncEngine.mutate` hard-refuses every `onlineOnly` definition with `requires-protected-mutation` (`engine.ts` lines 352–358). It must use `protectedMutate` if that guard remains. Further, promotion requires `ghost_id` and `expected_version`, but `BenchForecastRow` exposes only the Ghost Employee's ID and record (bench-forecast.ts lines 29–35); the corresponding GhostResource stores `ghost_employee_id` and has its own ID/version (`services/api/src/mutations/ghost-resource.ts` lines 169–182, 309–336). | The brief explicitly requires `client.mutate` and no `node-list`/`node-get` screen read, while the unchanged forecast query does not return the GhostResource identity/version needed for either client write method. |
| UI3-G — blocking | `assignment.cancel` requires `expected_version` (`packages/schema/src/mutations/assignment.ts` lines 54–62). `BenchAssignmentBar` exposes assignment ID/project/date/percentage, not version (bench-forecast.ts lines 14–23). The brief forbids a screen `node-get` and freezes the query file. | Create and update can use the returned fields; cancel cannot construct valid arguments through the prescribed query surface. The row shape or allowed read path needs a ruling. |
| UI3-H — non-blocking trace correction | The done criterion says `fixtures/roster.ts`, `fixtures/profiles.ts`, **and** `fixtures/calendar.ts` are still imported by Home. Grep shows `apps/roster-web/src/app/(shell)/home/page.tsx` directly imports roster and profiles, but not calendar; calendar is imported by the fixture-era `lib/bench.ts`, `lib/profile.ts`, and TimesheetScreen. | Preserve all three fixture files and Home's actual imports, and report the factual direct-import result rather than adding a meaningless Home import. |
| UI3-I — blocking | `groupBench` in the existing local query groups only **consecutive working dates** (bench-forecast.ts lines 43–62). A weekend or holiday breaks a single uncovered assignment gap into separate `benchPeriods`. The current `lib/bench.ts` keeps non-working dates inside one visual gap and counts only its working days (lines 174–225), matching VRS-F005's region-between-bars treatment. | Adapting unchanged `benchPeriods` to Timeline rows changes the amber region boundaries and F36's per-region cost rule. The local query or the presentation contract needs correction; this is not merely an output-shape adapter. |
| UI3-J — blocking | `BenchForecastRow.employee` is the Employee record, while Entity identity is resolved only to a private `entityId` inside `getBenchForecast` and not returned; `BenchAssignmentBar` returns `clientId` but not the Client's name (bench-forecast.ts lines 14–35, 127–148, 220–253). The existing Panel's Entity label and VRS-F005's bar tooltip client label currently come from fixture maps. | The unchanged query result lacks these presentation facts. A screen-level `node-list`/`node-get` read is forbidden by the done criterion, and restoring fixture maps is also forbidden; the query shape or allowed local read must be ruled. |

Additional paths traced without a contradiction: the strict `benchForecastWindowSchema`/`benchForecastFiltersSchema` are exported from `@vulto/schema`; `ConflictCheckInput` includes caller user ID and near-capacity threshold; `useShortcuts` supports J/K/Enter/1/2/3/F/T/Escape through its existing `keys`/`onEscape`; the server `benchForecast.getAggregate`, `benchForecast.getCost`, and `contextualIntelligence.getProtected` procedures exist; `assignment.create/update/cancel`, `conflictResolution.overrideAndProceed`, and `revenueGapAlert.dismiss` are registered; UI-1/UI-2 browser tests provide the exact guarded axe baseline, real sign-in/workspace/admission helpers, full-page JPEG capture and size check. The role toggle and fixture imports still exist on the forecast page/Panel, as the brief anticipates. The real Ghost is an Employee with `employee_type: "Ghost"` plus a GhostResource pointing to it, confirmed in the actual server mutation. No `WellnessTriggerEvent` read path is present in the local or protected contextual query.

## 9. Deviations from this brief

The branch stopped after the required consolidated pre-build trace and before product code, tests, screenshots, or CI because UI3-A through UI3-G and UI3-I/J cannot be satisfied together under the current brief's boundaries. No workaround was attempted.

## 10. Known limitations and risks

The untouched prototype remains fixture-driven. In particular, making the broad Manager cache look like a direct-report view through a screen-only filter would violate the named permission boundary and would still leave the aggregate's cohort broad. F364 remains an independently tracked UI-1 timing flake; this stage did not touch its assertion.

## 11. Readiness for the next stage

No. UI-3 needs a reviewer ruling reconciling the permission cohort, the missing local query data and Pitch exclusion, the region-level cost contract, the protected contextual split, and the mutation input/guard conflicts before implementation can resume. Do not start UI-4.

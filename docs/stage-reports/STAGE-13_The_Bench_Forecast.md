# Stage 13 — The Bench Forecast (`VRS-F005`)

**Status:** COMPLETE, awaiting review.
**Branch:** `codex/stage-13-bench-forecast`
**Linear:** RST-41
**Date:** 23 September 2026

## 1. Summary

The Bench Forecast foundation is now server authoritative and usable without UI work. Assignment writes use the named mutation pipeline and enforce the 100% capacity limit on the server. The device derives staffing bars, bench periods, filters, and the Tier 0 Contextual Intelligence fields directly from its permission-filtered cache. Compensation cost, protected contextual signals, and disclosure-controlled aggregate utilization are separate permission-gated server calls. One portable working-day resolver and one portable filter matcher serve both sides of the boundary.

F236–F242 are incorporated exactly as ruled. No application file changed, no Ghost write path or rate-card lookup was added, and the deferred Pitch exclusion introduced no TimesheetEntry, Pitch, or `logged_against` path.

## 2. Done-criteria checklist

- [x] `assignment.create`, `assignment.update`, and `assignment.cancel` are registered named mutations with checks, validation, application, audience materialization, idempotency, and permission interception.
- [x] Capacity validation sums genuinely overlapping Active assignments by date and returns `capacity-conflict:current=60:attempted=50` for the tested 60% plus 50% collision.
- [x] `assignment.cancel` checks `expected_version` first on the server and device; a mismatch returns `stale-state` without changing lifecycle state.
- [x] `resolveWorkingDay` is one pure function in `packages/schema`. Existing server `workingDays.*` and the local forecast query both call it; no second resolution-order implementation remains.
- [x] The local forecast query reads the SQLite cache directly and returns assignment bars, bench periods, and fractional day counts while a mocked network is unavailable.
- [x] `benchForecast.getCost` reads compensation through the audited protected path, implements Annual, Monthly, and Hourly formulas, handles each calendar year separately, and returns `null` when compensation is not authorized.
- [x] `benchForecast.getAggregate` is an authenticated server endpoint. It derives the caller's filtered and unfiltered authorized cohorts itself, applies disclosure control, and accepts no employee-ID cohort.
- [x] `matchesBenchForecastFilters` is one shared implementation. The local and server tests exercise the same five-field AND/OR and availability semantics.
- [x] Disclosure control independently proves four-at-five suppression and twelve-to-eleven differencing protection.
- [x] Founding Workspace records carry thresholds 5 and 8; every threshold read enforces the floor of 3.
- [x] Contextual Intelligence resolves skills, matching open roles, and references locally with the network cut. BurnoutAlert and FlightRiskSignal use the real server interceptor and audited protected read.
- [x] A manager sees a direct report's BurnoutAlert; another manager sees nothing. FlightRiskSignal appears only for the Owner in the tested role set.
- [x] Project, Client, GhostResource, OpenRole, and Assignment have explicit workspace staffing permission rows, with Manager and Team Member read proofs for every type.
- [x] Optimistic Assignment handlers are real. Create performs no capacity check, and its before-images cleanly undo a server refusal.
- [x] All required gates pass. This server-only stage requires no browser suite.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| VRS-F005 G01, G07; VPS-A003 A003-T53/T54 | Deterministic Assignment node and edges; create/update/cancel handlers; overlap capacity guard; captured billing rate; serializable writes | Mutation integration test and optimistic mutator tests |
| VRS-F005 G02–G03; F237 | One pure `resolveWorkingDay`; live Assignment-only bench derivation against calendar, pattern, holidays, and reduced hours | Schema resolver test, existing server working-day suite, offline local forecast test |
| VRS-F005 G06; F238/F241 | Server-only aggregate endpoint, Workspace thresholds, reusable suppression and differencing function | tRPC authentication test, cohort integration test, two independent disclosure tests |
| VRS-F005 G08; F242 | Shared `BenchForecastFilters` schema and `matchesBenchForecastFilters`; server-owned authorized cohorts | Five-field local and server filter tests; schema rejection of client employee IDs |
| VRS-F005 cost contract; F236 | Separate protected compensation call with Annual, Monthly, Hourly, and calendar-year-aware cost | Formula examples, cross-year integration test, unauthorized-null assertion |
| VRS-F005 G04; F236 | Local Tier 0 contextual query plus server Tier 2 protected query | Network-cut local test and real Manager/Owner interceptor integration test |
| VPS-A004 staffing matrix | Explicit Assignment, Project, Client, GhostResource, and OpenRole rows | Five generated Manager and Team Member policy tests; updated audience integration proof |
| F239 | Bench days use Assignment coverage only | Scope grep and local derivation test |
| F240 | Version-first cancel on both sides | Server stale-state assertion and optimistic stale-state assertion |

## 4. Files changed

- `packages/schema/src/mutations/assignment.ts`: three Assignment contracts and validators.
- `packages/schema/src/working-day.ts`: portable working-day resolution and ISO date iteration.
- `packages/schema/src/bench-forecast.ts`: window, filter, endpoint schemas, and the shared filter matcher.
- `packages/schema/src/policy/disclosure-control.ts` and `policy-table.ts`: reusable k-anonymity rules and the five staffing permission rows.
- `services/api/src/mutations/assignment.ts` and `pipeline.ts`: server mutation handlers, deterministic graph writes, capacity validation, and serializable registration.
- `services/api/src/graph/working-days.ts`: existing reads now delegate their final calculation to the portable resolver.
- `services/api/src/permission/bench-forecast-queries.ts`: authorized server cohorts, disclosure-controlled aggregate, and protected compensation cost.
- `services/api/src/permission/contextual-intelligence-queries.ts` and `interceptor.ts`: protected Panel signals and BurnoutAlert's registered subject traversal.
- `packages/graph/src/queries/`: cache readers, the local forecast query, and the local Contextual Intelligence query.
- `packages/graph/src/mutators/foundation.ts`: create, update, and versioned cancel optimistic effects.
- `services/api/src/router.ts`: the separate aggregate, cost, and protected contextual endpoints.
- Schema, graph, tRPC, audience, and PostgreSQL integration tests provide the acceptance evidence.

## 5. Database changes

No migration. Assignment, Project, Client, Skill, alert, and relationship data use the existing `graph_nodes`, `graph_edges`, protected-fragment, audit, and audience tables. Workspace founding now stores `k_anonymity_minimum: 5` and `k_anonymity_minimum_sensitive: 8` in the existing Workspace record. No materialized working-day index, aggregate cache, disclosure audit record, or device-side protected value was added.

## 6. Tests and gates

- `pnpm install --frozen-lockfile` — passed; the permitted retry confirmed the lockfile and installation are current after the sandbox could not resolve npm.
- `pnpm stack:up` — passed; PostgreSQL, Redis, and Electric reported healthy.
- `pnpm verify` — passed: formatting, lint, conformance, architecture checks, typecheck, and fast tests.
- `pnpm verify:full` — passed: 18 API files, 259 passed and 2 skipped; 74 graph tests passed; 89 schema tests passed with 2 preexisting TODOs.
- `VRS-F005 — The Bench Forecast` integration suite — 5 grouped PostgreSQL tests passed: compensation formulas, Assignment mutation and capacity behavior, server cohort/disclosure control, cost authorization and year boundary, and real protected Panel interception.
- Local forecast query — passed with `fetch` forced to reject, proving no network call and correct bars/bench periods under the shared five-field filter.
- Local Contextual Intelligence query — passed with `fetch` forced to reject, proving skills, open roles, and references are cache-resident.
- Optimistic Assignment suite — passed: deterministic node/edge effects, no client capacity logic, refusal undo, and version-first cancel.
- Aggregate tRPC test — passed: unauthenticated access is rejected and authenticated execution occurs on the server.
- The first full-suite run found the audience test's pre-Stage-13 Project expectation. Its expected Team Member holder was added; the focused 11-test audience suite and the complete second run both passed.

## 7. Micro-decisions

- Capacity validation runs in a serializable transaction and checks each covered ISO date. Updating an Assignment excludes that Assignment from the current total before applying its proposed percentage.
- Assignment IDs are the mutation IDs. `assignment_of` and `assigned_to` IDs use `mutationDerivedId` with stable indexes on both server and device.
- The local query derives availability over the union of the displayed window and the requested availability range, then limits returned bars and bench periods to the displayed window.
- The aggregate derives both cohorts from `listEmployees` under the caller's principal, then runs the same filter matcher the device imports. The API schema has no employee-ID field.
- Differencing protection can substitute the unfiltered aggregate internally; the public endpoint still returns the contract's `{ aggregateUtilization, cohortSize }` shape.
- Compensation cost counts the employee's resolved working days separately for each year. Hourly compensation uses the resolved scheduled hours for the specific date.
- Protected contextual results omit unauthorized fields structurally. No null marker or cached placeholder is emitted.
- The audience expectation for Project now includes Team Member because Stage 13 deliberately changed Project from the Standard person-scoped fallback to workspace-wide read access.

## 8. Findings raised

Stage 13 stopped four times after briefing on F239–F242. F239 deferred the unbuilt Pitch-day dependency, F240 restored version-first Assignment cancellation, F241 moved disclosure-controlled aggregate utilization to the server, and F242 defined one shared filter contract. Each is closed in `docs/Foundations_Findings.md`, `VRS-F005`, and the corrected Stage 13 brief. No further finding arose after F242 was applied; F243 was not needed.

## 9. Deviations from this brief

None from the final corrected Stage 13 brief. The implementation deliberately omits UI, Ghost creation or promotion, rate-card resolution, the working-day index, differencing audit entries, and Pitch-day exclusion because the corrected brief assigns each outside this stage.

## 10. Known limitations and risks

- The client query evaluates each visible employee and date live from SQLite. It is correct and offline-capable; the UI stage must still measure the 90-day and 180-day render budgets with realistic workspace sizes and virtualization.
- Aggregate and cost calculations favor a clear reference implementation over batching every graph read. They are permission correct and covered end to end, but production-scale query profiling remains necessary when the UI becomes a caller.
- Cost and protected Panel content are unavailable offline by design. Their future UI caller must render the standard connectivity-required state without blocking the local timeline.
- Ghost rows remain absent until `VRS-F007`; rate-card resolution remains deferred to `VRS-F006`; Pitch-day exclusion remains deferred to `VRS-F009`/`VRS-F010`.
- The differencing-attempt audit trail remains deferred under F238. The suppression and substitution behavior itself is implemented now.

## 11. Readiness for the next stage

Stage 13 is ready for direct code review on `codex/stage-13-bench-forecast`. RST-41 should move to Done only after approval and merge. The branch is intentionally unmerged, and no subsequent stage has started.

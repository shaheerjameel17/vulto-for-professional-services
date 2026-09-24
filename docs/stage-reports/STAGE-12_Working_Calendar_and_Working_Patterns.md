# Stage 12 — Working Calendar and Working Patterns (`VRS-F004`)

**Status:** COMPLETE, awaiting review.  
**Branch:** `codex/stage-12-working-calendar` (local; not pushed).  
**Linear:** RST-40  
**Date:** 23 September 2026

## 1. Summary

Working calendars, holidays, reduced-hours periods, and employee working patterns now have named server-authoritative mutations and matching optimistic device handlers. Every Entity receives an Active calendar atomically at creation. The new `calendar.get` and five-function `workingDays.*` read API resolve the correct calendar version, regional and half-day holidays, inherited pattern weekdays, and reduced-hours factors directly from the graph. F225–F235 were ruled in the owning specifications and Stage 12 brief before completion.

## 2. Done-criteria checklist

- [x] `calendar.update` creates a new Active calendar, marks the prior version Superseded, links the versions, copies only Active holidays, and preserves historical calendar, holiday, and reduced-hours state.
- [x] The founding Entity and every later `entity.create` receive an Active WorkingCalendar in the same transaction. Global, IN, and SG use Monday–Friday at eight hours; AE uses Sunday–Thursday; PK uses 44 hours across 5.5 days.
- [x] The server and optimistic `entity.create` paths share the jurisdiction template and deterministic calendar and ownership-edge IDs. The optimistic before-images undo all three rows together.
- [x] `pattern.set` and `pattern.clear` preserve history at one shared effective-date boundary. Same-day replacement succeeds, backdating fails, and an omitted weekday inherits from the Entity calendar at read time.
- [x] `pattern_for` declares Employee's `operational` governing partition. The real PostgreSQL integration test calls the interceptor, applies `pattern.set`, and then reads the persisted edge back from `graph_edges`.
- [x] Regional holiday scoping is tested with Karachi and Lahore employees. Full and half-day holidays resolve separately.
- [x] `calendar.update`, `holiday.cancel`, superseding `pattern.set`, and `pattern.clear` enforce their base versions. Stale checks win over the later lifecycle or overlap refusal. `holiday.add` and `holiday.confirm` reject an extra version argument at schema validation.
- [x] `holiday.confirm` moves the effective date, preserves the estimate, stamps the confirmer and time, updates the next live read, and makes no audit-journal call. Confirmation and cancellation refuse holidays frozen on a Superseded calendar.
- [x] Omitted `reduced_hours_periods` carry forward; a provided array replaces them. Historical calendar reads keep their own frozen array. The UAE Ramadan case returns six hours from an eight-hour day at factor 0.75.
- [x] `workingDays.count`, `isWorking`, `hoursOn`, `next`, and `addWorkingDays` are exposed through permission-guarded server routes. One graph implementation owns the resolution order.
- [x] All six new mutation names have real optimistic handlers. Tests apply and undo calendar, holiday, and pattern writes, including stale refusals.
- [x] No `apps/` file changed. No holiday importer, materialized index, cache table, or precomputed working-day row was added.
- [x] All four required gates pass; this server-only stage requires no browser suite.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| VRS-F004 G01, F230, F234 | Versioned `calendar.update`, `supersedes` chain, Active-Holiday copy-forward, reduced-hours carry or replacement | PostgreSQL versioning and historical-read test; optimistic calendar test |
| VRS-F004 G02, F227, F232, F233 | Shared portable jurisdiction template plus atomic founding and Entity-create calendar writes | Founding and Entity integration tests; deterministic optimistic parity test |
| VRS-F004 G03–G04, F228–F229 | Partial patterns inherit at read time; set/clear close at the shared boundary with version-first validation | Real pattern edge, inheritance, same-day, stale, backdated, and clear tests |
| VRS-F004 G05 | Holiday location scope and half-day resolution | Karachi/Lahore and half-day integration assertions |
| VRS-F004 G07–G08, F226, F231 | Live graph calculation through the five-function API, with no index | AE, PK, UK, regional holiday, confirmation, and Ramadan integration assertions; diff review |
| F225 | Confirmation fields are the record; no unsupported AuditEntry category | Confirmation integration test and audit-call grep |
| F235 / VPS-A002 / VPS-A004 | `pattern_for` is governed by Employee's operational partition | Registry validator and real interceptor-backed `pattern.set` test |
| VPS-A003 A003-T53/T54 | Shared registration, server handlers, optimistic handlers, deterministic IDs, and base-version refusals | Schema, graph, typecheck, and PostgreSQL suites |

## 4. Files changed

- `packages/schema/src/mutations/{calendar,foundation,index}.ts`: six contracts, read inputs, jurisdiction templates, and deterministic IDs.
- `packages/schema/src/registry/edges.ts`: F235's reviewed `pattern_for` governing partition.
- `packages/schema/src/policy/policy-table.ts`: explicit workspace-configuration rows for WorkingCalendar, Holiday, and WorkingPattern.
- `services/api/src/mutations/{calendar,entity,pipeline}.ts`: six checks/validate/apply handlers, calendar creation, and pipeline registration.
- `services/api/src/graph/{calendar-resolution,working-days,founding}.ts`: historical calendar resolution, the single working-day calculation, and atomic founding calendar creation.
- `services/api/src/permission/working-days-queries.ts` and `services/api/src/router.ts`: permission-aware public read routes.
- `packages/graph/src/mutators/{cache,memory-cache,foundation}.ts` and `packages/graph/src/sync-client/cache.ts`: reverse-edge cache lookup and seven matching optimistic effects, counting the extended `entity.create` handler.
- Schema, graph, auth, store, and calendar integration tests: direct Stage 12 proofs and founding-record count updates.
- `docs/Vulto_Specs/VRS-F004_Working_Calendar_and_Working_Patterns.md`: the F232 acceptance wording now names the ruled Sunday-to-Thursday AE calendar.

## 5. Database changes

No migration. WorkingCalendar, Holiday, WorkingPattern, and their relationships use the existing `graph_nodes` and `graph_edges` tables. Entity creation and workspace founding now write a calendar and ownership edge in their existing transactions. No audit event, index table, cache table, or precomputed working-day row was added.

## 6. Tests and gates

- `CI=1 pnpm install --frozen-lockfile` — passed. The first sandboxed attempt could not resolve npm; the permitted network retry confirmed the lockfile and install are current.
- `pnpm stack:up` — passed; PostgreSQL, Electric, and Redis reported healthy.
- `pnpm verify` — passed: formatting, lint, conformance, architecture checks, typecheck, and fast tests.
- `pnpm verify:full` — passed: 17 API files, 253 passed and 2 skipped; 70 graph tests passed; 78 schema tests passed with 2 preexisting TODOs.
- Focused Stage 12 PostgreSQL suite — 5 grouped acceptance tests passed. These exercise every named server mutation, the five read operations' underlying implementation, real permission interception, calendar history, all ruled jurisdiction examples, and live confirmation behavior.
- Registry/conformance proof — 24 registry tests and the 8-test conformance gate pass; 2 conformance TODOs are preexisting.

## 7. Micro-decisions

- Calendar history uses the immutable creation timestamp of each version because `calendar.update` has no separate effective-date argument. `calendar.get(asOf)` walks the new-to-prior `supersedes` chain until it reaches the version created by that date.
- Copied Holiday IDs and the extra edges of a calendar update are deterministic derivatives of the mutation ID. Server and optimistic effects therefore agree before replication.
- `workingDays.count` expresses fractional days as resolved hours divided by that date's calendar `standard_daily_hours`; this produces the specified Pakistan result of 44 hours and 5.5 days.
- The permission wrapper authorizes the resolved Employee, Entity, WorkingCalendar, WorkingPattern, and Holiday nodes through the existing interceptor. The graph calculator receives a read guard and cannot silently release a derived answer from an unreadable row.
- `pattern.set` and `pattern.clear` store omitted weekdays as omitted. The shared read implementation performs inheritance, which preserves the distinction between “inherit” and “zero hours.”
- Client handlers perform only locally answerable validation. Server lifecycle and permission refusals continue through the existing outbox rejection and undo path.

## 8. Findings raised

Stage 12 stopped four times on eleven findings. F225 and F226 were found while briefing; F227–F231 and F232–F234 were found while tracing the corrected contracts; F235 was found by the first real PostgreSQL `pattern.set` test. All are closed by founder rulings in `docs/Foundations_Findings.md`, the owning specifications, and the corrected Stage 12 brief. No further finding arose after F235 was applied.

## 9. Deviations from this brief

None from the final corrected Stage 12 brief. F225 removes the unsupported audit entry, F226 defers the materialized index, F231 defers the PayRun/LeaveRequest/Contract exemptions to their consuming stages, and the brief explicitly defers all UI and `holiday.importForJurisdiction`.

## 10. Known limitations and risks

- The unindexed implementation intentionally favors correctness over the future Bench Forecast render budget. The `VRS-F005` stage owns the server-authoritative index design and performance proof.
- Historical calendar selection is date-granular because the public `asOf` argument is a date. Multiple updates on one UTC date resolve to the last version in force by the end of that date.
- No seeded public-holiday content exists. Owners and HR Admins can manage holidays through the named API; curated jurisdiction imports wait for a consuming need.
- The PayRun, approved LeaveRequest, and signed Contract recalculation exemptions remain binding forward rules for their own future stages. This stage proves only the live-view default.

## 11. Readiness for the next stage

Stage 12 is ready for direct code review. RST-40 should move to Done only after approval and merge. The local Stage 12 branch is intentionally unpushed and unmerged; the next stage has not started.

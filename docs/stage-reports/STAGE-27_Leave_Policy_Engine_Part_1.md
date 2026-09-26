# Stage 27 — Leave Policy Engine, Part 1

**Status:** COMPLETE
**Branch:** codex/stage-27-leave-policy-engine @ 9a30d7c962605a05b09c2b2a58a6dd4fbf93c0f9 (implementation)
**Linear issues:** RST-55
**Date:** 2026-09-26

## 1. Summary

Leave policies now have strict validation, controlled versioning and server-side resolution. Every role can read them; only the interceptor's configuration writers can create/update them. A pure engine computes Immediate, Monthly and Annual accrual, working-day usage, partial first months, capped carry-over and expiry. The server passes empty usage until VRS-F019; Earned explicitly returns zero with a deferral note. All four local gates passed, with CI evidence below.

## 2. Done-criteria checklist

- [x] Strict LeavePolicy schema, effective dates, Earned iff TOIL, unique types, permission override and shared lifecycle guard — schema tests; `policy-table.test.ts::LeavePolicy carries exactly WorkingCalendar's literal configuration matrix`; integration role test.
- [x] Atomic lineage versioning, exact prior record equality except `is_active`, stale/non-latest refusal and interceptor authorization — integration lineage test.
- [x] Matching, newest-created/node-id ties, conflicts, null policy for no match/entity, unreadable/missing equivalence and table-derived conflict gate — integration resolution and router-refusal tests.
- [x] Pure working-day engine and all listed acceptance criteria — nine `leave-balance.test.ts` tests; source guard and failing negative control.
- [x] Balance router runs with real Employee/Entity/calendar/lineage, empty usage and measured server p95 — integration end-to-end/timing test.
- [x] No UI/client code, S05 additions, new registry type/principal/cache, schema-version/interceptor/dependency change — diff check; baseline S05 identifiers noted below.
- [x] Local verify/verify:full and both branch CI lanes green — all four local gates and both implementation runs passed; final report-only head is checked independently before handoff.

## 3. Spec clauses implemented

| Clause | Implementation | Test evidence |
| --- | --- | --- |
| G01/S01/S04; F329/F334 | Schema `leave-policy.ts`, mutation definitions | Defaults, strictness, Earned/TOIL uniqueness, blackout ordering |
| G02; F329 | API `mutations/leave-policy.ts`; pipeline registration/serializable update | Exact prior content preservation, lineage edge, stale/non-latest refusal |
| G03; F328 | Policy override, `permission/leave-queries.ts`, router | Literal policy cells, all-role reads, matching/conflicts, derived configuration gate |
| G04/G05/S03; F330/F331 | Pure `leave-balance.ts` | Six months = 7; forward-only change; working-day proration/usage; carry cap/expiry/consumption; expiringSoon; negative note; Immediate/Annual |
| F332/F333/F334 | Empty server usage, server timing, Earned deferral | Historical router balances, measured p95, zero-with-note |

### Input and output schemas

`leavePolicyFieldsSchema` is the strict universal envelope plus configuration, positive policy version, nullable supersedes UUID and is_active. Configuration uses existing jurisdiction/employment enums, nonnegative entitlements/caps, nonnegative integer notice/expiry, valid ISO dates, unique leave types, Earned iff TOIL, ordered blackouts and the brief's defaults. Version-1 effective date defaults to `1900-01-01`.

- `leavePolicy.create`: configuration → `{ policy_id }`, Tier 0/online-only.
- `leavePolicy.update`: `{ policy_id, expected_version, leave_types, overtime_policy?, blackout_periods?, effective_from? }` → `{ new_policy_id }`, Tier 0/online-only/state transition. Omitted configuration is preserved; effective date defaults to the pipeline's UTC date and cannot be earlier.
- `leavePolicy.getApplicable`: `{ employee_id }` → `{ policy: LeavePolicy | null, conflicting_policy_ids: string[] }`; conflicts exclude the winner. Unreadable/missing Employee is `NOT_FOUND`/`not-found`; a readable Employee with no match/entity returns the null policy contract.
- `leavePolicy.listConflicts`: `{ workspace_id }` → `{ employee_id, policy_ids }[]`; all matches when more than one. No Full-any LeavePolicy cell or workspace mismatch is `FORBIDDEN`.
- `leaveBalance.compute`: `{ employee_id, leave_type, as_of_date? }` → `{ entitledYtd, carriedOver, used, remaining, expiringSoon, notes }`. Date defaults to today; unreadable/missing Employee or no policy is `NOT_FOUND`/`not-found`.
- Pure engine: `{ employee: { start_date }, policyVersions, leave_type, as_of_date, usage: { leave_type, start_date, end_date }[] }` and injected inclusive working-day counter → promise of the balance object. Counter may return number/promise; server adapter extracts `days` from F004's `{ days, hours }`.

## 4. Files changed

`git diff --stat main...HEAD` for the completed stage, including this report:

```text
 .../STAGE-27_Leave_Policy_Engine_Part_1.md         | 187 ++++++++++
 packages/schema/src/index.ts                       |   2 +
 packages/schema/src/leave-balance.test.ts          | 197 +++++++++++
 packages/schema/src/leave-balance.ts               | 133 +++++++
 packages/schema/src/leave-policy.test.ts           |  75 ++++
 packages/schema/src/leave-policy.ts                | 108 ++++++
 packages/schema/src/mutations/employee.ts          |   1 +
 packages/schema/src/mutations/foundation.ts        |   2 +
 packages/schema/src/mutations/leave-policy.ts      |  36 ++
 packages/schema/src/mutations/mutations.test.ts    |   8 +-
 packages/schema/src/policy/policy-table.test.ts    |  31 +-
 packages/schema/src/policy/policy-table.ts         |   7 +
 services/api/src/mutations/leave-policy.ts         | 144 ++++++++
 services/api/src/mutations/pipeline.ts             |   4 +
 .../api/src/permission/leave-balance-guard.test.ts |  14 +
 .../permission/leave-policy.integration.test.ts    | 381 +++++++++++++++++++++
 services/api/src/permission/leave-queries.ts       | 172 ++++++++++
 services/api/src/router.ts                         |  48 +++
 18 files changed, 1534 insertions(+), 16 deletions(-)
```

API mutation diff: new `leave-policy.ts` and additive registration/isolation in `pipeline.ts` only. No existing source feature mutation, application/client package, registered node/edge, interceptor, dependency, workflow or governing document changed.

## 5. Database changes

None. Existing LeavePolicy records and supersedes edges; existing row locking, optimistic versions and serializable pipeline retry. No balance storage.

## 6. Tests and gates

All four exact commands ran sequentially, exit 0. The first approval attempt was not executed because of the usage limit; the complete subsequent sequence succeeded. The unrelated untracked `Claude outputs/` folder was temporarily moved to task-specific `mktemp` storage during formatting and restored with an EXIT trap; no user file or gate changed.

`pnpm install --frozen-lockfile`, exit 0:

```text
Scope: all 7 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 748ms using pnpm v9.15.9
```

`pnpm stack:up`, exit 0: Docker's Postgres, Electric and Redis Running/Healthy; no test count applies.

`pnpm verify`, exit 0: format/lint/conformance/architecture/typecheck/fast suites passed. Final component summaries:

```text
Conformance: Test Files  1 passed (1)
             Tests  6 passed | 2 todo (8)
Lint/typecheck: Tasks:    6 successful, 6 total
Schema: Test Files  21 passed (21)
        Tests  130 passed | 2 todo (132)
Graph:  Test Files  16 passed (16)
        Tests  102 passed (102)
 Tasks:    10 successful, 10 total
Cached:    7 cached, 10 total
  Time:    2.074s
```

UI/roster-web retain their existing `--passWithNoTests` result; tokens have no suite. Two conformance todos are unchanged baseline.

`pnpm verify:full`, exit 0: repeated fast gate and DB preflight passed, then real-Postgres API suite:

```text
 Test Files  32 passed (32)
      Tests  343 passed | 2 skipped (345)
   Start at  23:41:04
   Duration  84.06s (transform 532ms, setup 0ms, import 11.90s, tests 70.35s, environment 1ms)
```

Two API skips are unchanged baseline; no stage test is skipped.

Additional evidence:

- `node scripts/arch-check.mjs`: exit 0 on all nine exact-import scratch paths and again after implementation; graph/store boundary holds.
- `pnpm --filter @vulto/schema exec vitest run src/leave-balance.test.ts src/leave-policy.test.ts src/mutations/mutations.test.ts src/policy/policy-table.test.ts`: exit 0, 4 files/53 tests passed.
- `pnpm --filter @vulto/api exec vitest run src/permission/leave-policy.integration.test.ts src/permission/leave-balance-guard.test.ts --reporter=verbose --disableConsoleIntercept`: final exit 0, 2 files/6 tests passed. The first run caught two builder fixture mistakes (assuming a within-workspace Employee was unreadable and assuming a five-day Pakistan calendar); corrected to existing grants/calendar without product workarounds.
- Negative control: temporarily add `void 86400000;` to the engine; `pnpm --filter @vulto/api exec vitest run src/permission/leave-balance-guard.test.ts --reporter=verbose` exits 1, 1 file/1 test failed on the forbidden arithmetic regex. Remove the perturbation; same command exits 0, 1 file/1 test passed. Perturbation is not committed.
- `git diff --check`: exit 0. No `owner`/`hr-admin` role literals in the new mutation/query module or new router entries.

Observed generic create/update/delete/transition refusal: Owner/HR Admin = `requires-feature-mutation`; Finance Admin, derived Manager and Team Member = `role` (interceptor runs before validation). All leave existing policy/node count unchanged. Non-writers' named create/update = `role`; stale/non-latest update = `stale-state`; an update date before today = `invalid-args`.

### Measured server p95

```text
STAGE27_SERVER_P95 applicable=4.388ms balance=5.259ms samples=20 fixture=2-employees,1-feature-entity-and-calendar,2-policy-versions,0-usage
```

20 sequential in-process tRPC measurements after one warm-up, nearest-rank p95. Fixture: two Employees (one derived manager), the default founding Entity/calendar plus one feature-created PK Entity/calendar, two lineage versions/one active, no usage. Balance at `2026-08-31`, start `2026-01-01`, monthly entitlement 14→28 on July 1; complete months require no proration. These server figures meet 20/200 ms for this small fixture, not offline/device or production-scale guarantees. Separately a third Employee starting January 15 exercises real F004 proration: 13.5/24.5 working days with half-day Saturdays.

The implementation's slow-lane run independently printed `STAGE27_SERVER_P95 applicable=8.454ms balance=10.636ms` on the same fixture (20 measured samples). Its sync-browser job passed the full suite, `27 passed (2.8m)`.

### CI

Implementation SHA `9a30d7c962605a05b09c2b2a58a6dd4fbf93c0f9`:

- fast-lane [36263533839](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36263533839): **success**; resolve-image and verify both executed and succeeded.
- slow-lane [36263533837](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36263533837): **success**; resolve-image, api-integration, production-build, auth-browser and sync-browser all executed and succeeded. Only main-only publish-artifacts was skipped, as the brief permits.

The report-only follow-up's final head runs are independently checked and quoted in RST-55 and the final handoff (writing their newly assigned IDs into another commit would itself create another head). No main merge/push performed.

## 7. Micro-decisions

All seven Do items were traced before product implementation. Exact-import scratch files at all nine intended new TypeScript paths passed `node scripts/arch-check.mjs` (exit 0). The scratch imports are replaced by the implementation, not committed as separate scaffolding.

Contradictions and minimal in-scope resolutions:

- The existing Standard-default permission test uses LeavePolicy, explicitly asserting the behavior F328 replaces. Preserve the default-class test with another Standard, matrix-absent registration; add a LeavePolicy literal-cell test rather than weaken scope coverage.
- The existing mutation inventory test assumes every Tier 0 mutation other than ghost promotion is offline-capable. Add the two explicitly online-only LeavePolicy definitions to the expected inventory and exceptions. `defineMutation` preserves an explicit Tier 0 `onlineOnly: true`.
- The working-day counter is asynchronous and returns `{ days, hours }`. The injected dependency therefore supports promises; the pure engine awaits it and uses only `days` through the server adapter.
- The brief forbids calendar-day arithmetic in the balance module while explicitly specifying UTC calendar-year/month boundaries and date-based expiry/30-day windows. Reuse `working-day.ts::addIsoDays` solely for date boundaries; all entitlement proration and deductions use the injected working-day counter. No independent date arithmetic or weekend rule is implemented in the engine.
- Rate-card schemas live in `mutations/rateCard.ts` and its query record interfaces, not a strict universal fields schema in `rate-card.ts`. Use the established strict feature-envelope pattern (`notificationFieldsSchema`) and the rate-card mutation-definition layout.
- The brief requires prior policy record equality except `is_active`; the rate-card precedent also updates provenance through `updateStamp`. Preserve the prior LeavePolicy JSON record except `is_active`, with the store's independent optimistic-lock version increment; new nodes and edges retain normal provenance stamps.

Precedent: RateCard supersedes writes new → prior, leaves `supersedes` outside `FEATURE_OWNED_EDGE_TYPES`, and has no optimistic rateCard create/update implementation. No client code is required or changed. The pipeline authorizes write checks before feature validation: non-writers' generic operations can refuse at authorization (`role`), while authorized generic operations hit `requires-feature-mutation`.

Trace paths: `mutations/rateCard.ts`, `mutations/define.ts`, `mutations/foundation.ts`, `mutations/employee.ts`, `policy/policy-table.ts`, registry nodes/edges/protection, API mutations/rate-card.ts and pipeline.ts, graph/store.ts, graph/entity-resolution.ts, graph/calendar-resolution.ts, graph/working-days.ts, permission/rate-card-queries.ts, timesheet-queries.ts, working-days-queries.ts, employee-queries.ts, interceptor.ts, roles.ts, notification-reminder.ts, member-principal.ts, test-support.ts, calendar.integration.test.ts, rate-card.integration.test.ts, audit-log.integration.test.ts, router.ts, trpc.ts; client foundation mutators; package scripts, fast-lane and slow-lane workflows. Existing fixtures create actual admitted principals, named employees through employee.create, Entity/calendar through entity.create, and derived managers through managed_by, not fabricated role assignments.

- Optional update configuration is preserved when omitted; supplied fields are validated. Policy-lineage version and independent optimistic-lock version follow the rate-card precedent.
- Employee operational is READ_ANY inside a workspace: use a real cross-workspace Employee for the unreadable fixture. PK's real initial calendar includes half-day Saturdays; test its 13.5/24.5 proration, not an invented weekend.
- The brief's S05 grep is not empty on main; distinguish pre-existing identifiers from additions rather than delete prior behavior. No S05 file was changed.
- Put the source-reading guard under API's existing Node-typed test environment; schema engine acceptance tests remain in their required path, with no Node dependency added.

## 8. Findings raised

None requiring a ruling. The full trace/resolution list is in section 7; F327–F334 were not reopened, and no ledger, findings file, reviewer document, build prompt or VRS-F018 spec was edited.

## 9. Deviations from this brief

None beyond the explicit minimal in-scope trace resolutions in section 7. No client/UI, overtime approval/Earned accrual, new node/edge/principal/cache, interceptor or dependency was built.

## 10. Known limitations and risks

- Server usage is **always empty** until VRS-F019 defines approved LeaveRequest data. Tests inject usage into the pure engine; live `used` does not yet represent approved leave.
- Earned/TOIL is configuration-only with a zero/note. Stage 28 still needs the founder's TOIL source decision.
- Performance figures are small-fixture server timings without network latency, not offline or production-scale claims. The real partial-month path calls the existing working-day service; no performance cache was added.
- `clearance_outcome` already exists at `packages/schema/src/timesheet.ts:72` and in `services/api/src/mutations/timesheet-anomaly.ts`; `git show origin/main:packages/schema/src/timesheet.ts` confirms baseline. Those files are untouched; no `overtime.approve` registration added.
- `expected_version` uses the store lock version, not policy-lineage `version`, as in RateCard. Prior JSON provenance stays intact to meet the brief's exact old-record invariant.

## 11. Readiness for the next stage

No further stage started. Ready for review; all four local gates and both implementation CI lanes are green. Final report-only head is independently rechecked before handoff. Stage 28 needs approval and a TOIL accrual-source ruling; VRS-F019 supplies real usage and the later local adapter.

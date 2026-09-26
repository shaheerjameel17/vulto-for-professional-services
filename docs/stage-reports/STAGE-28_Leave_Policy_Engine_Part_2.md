# Stage 28 — Leave Policy Engine, Part 2

**Status:** COMPLETE
**Branch:** codex/stage-28-toil-ledger @ 72c9b54 (implementation and tests)
**Linear issues:** RST-115
**Date:** 2026-09-27

## 1. Summary

Approved overtime now accrues into an immutable, server-written Tier 0 ledger that employees can read without seeing the protected flag. Preview and clearance share the same calculation, and clearance writes the flag and grant atomically. The Earned engine applies per-entry expiry and consumes the earliest-expiring entitlement first. All four local gates and both implementation CI lanes pass. Main was fast-forwarded to `44234af8a3bda8817b927df7b7f19548636027cc`, verified by `git ls-remote origin refs/heads/main`, and both main CI lanes succeeded.

## 2. Done-criteria checklist

- [x] Ledger registration, strict schema, generic refusal, employee subject scope and read-only member access — `registry.test.ts`, `toil.test.ts::accepts only positive TOIL grants and the exact non-protected field set`, `policy-table.test.ts::LeaveLedgerEntry's literal matrix is read-only and subject scoped for members`, `toil.integration.test.ts::scopes reads and sync audience to own, direct report and workspace-wide readers, never permits member writes`.
- [x] Narrow system writer inside the clearance transaction, with no member write path — `timesheet-anomaly.ts` authorizes `leave-ledger.write`; the access test exercises all member roles, generic mutations, direct authorization and an injected named-mutation pipeline check that must refuse before apply.
- [x] Pure TOIL computation, four-place half-away rounding and real failing source-guard negative control — `toil.test.ts::VRS-F018 TOIL arithmetic` and section 6.
- [x] One shared server-derived week-hours helper, moved from the evaluator — `deriveWeekHours` in `timesheet-anomaly.ts`, used by evaluator and accrual; acceptance test uses real submitted entries.
- [x] Atomic grant/clearance, acknowledgment refusal, repeat stale-state, unchanged re-flag exemption and read-only preview — `toil.integration.test.ts::previews, atomically grants one day for 48 of 40, repeats stale, expires and preserves re-flag exemption`, `::rolls back both cleared flag and ledger after a forced post-write failure`, and `::serializes two concurrent clearances to one entry and one stale refusal`.
- [x] Earned expiry/usage semantics and caller-filtered ledger input; non-Earned behavior unchanged — `toil.test.ts::VRS-F018 Earned ledger balance`, existing `leave-balance.test.ts`, `leave-queries.ts::computeBalance`.
- [x] No UI/client query/client mutator, LeaveRequest, adjustment/reversal, edge type, cache table or dependency change; cache schema version unchanged — file diff below and registry-driven replication trace in section 7.
- [x] Four gates and both branch CI workflows green — section 6 records exact commands, outputs, run IDs and job conclusions.

## 3. Spec clauses implemented

| Clause | Implementation | Evidence |
| --- | --- | --- |
| G04, F338 | `leave-balance.ts`, `leave-queries.ts` | Earned unit tests; clearance balance is 1 and becomes 0 on expiry |
| G05, F337 | shared `deriveWeekHours`, existing VRS-F004 resolver | 48/40 integration fixture, personalized-day arithmetic tests, guard negative control |
| G06, F336 | `toil.ts`, `timesheet-anomaly.ts`, `router.ts::overtime.preview` | Preview equals grant, stale acknowledgment writes nothing |
| G07, G08 | existing exemption plus new capped accrual | Capped, no-policy and no-TOIL-type clearances remain exempt |
| G09, F339 | feature guard, read-only policy row, interceptor subject, system operation | Member refusal and exact sync-audience set; forced rollback and concurrent-clearance tests |
| G10, F335 | `leave-ledger.ts` | Strict schema rejects hours, week, reason and note |

Ledger schema: the standard universal envelope plus UUID `employee_id`, literal `entry_kind: ToilAccrual`, literal `leave_type: TOIL`, positive numeric `days`, ISO `effective_date`, nullable ISO `expires_on`, UUID `policy_id` and UUID `source_flag_id`; strict, no other fields. Preview takes only `{ flag_id: UUID }` and returns `{ toil_days_accrued, capped_at?, reason }`. Clearance adds optional non-negative `acknowledged_toil_days` and returns `{ success, toil_days_accrued, capped_at?, reason }`.

## 4. Files changed

`git diff --stat main...HEAD` at initial implementation commit `d3d84de`:

```text
 .../STAGE-28_Leave_Policy_Engine_Part_2.md         |  73 +++
 packages/schema/src/index.ts                       |   2 +
 packages/schema/src/leave-balance.test.ts          |   7 +-
 packages/schema/src/leave-balance.ts               |  68 ++-
 packages/schema/src/leave-ledger.ts                |  30 ++
 packages/schema/src/mutations/employee.ts          |   1 +
 packages/schema/src/mutations/timesheet.ts         |   1 +
 packages/schema/src/policy/policy-table.test.ts    |  15 +
 packages/schema/src/policy/policy-table.ts         |   7 +
 packages/schema/src/policy/principal-policy.ts     |   5 +
 packages/schema/src/registry.test.ts               |   4 +-
 packages/schema/src/registry/nodes.ts              |   6 +
 packages/schema/src/registry/validate.ts           |   4 +-
 packages/schema/src/toil.test.ts                   | 182 +++++++
 packages/schema/src/toil.ts                        |  31 ++
 services/api/src/mutations/pipeline.ts             |   3 +-
 services/api/src/mutations/timesheet-anomaly.ts    | 254 +++++++++-
 services/api/src/permission/interceptor.ts         |   6 +-
 .../api/src/permission/leave-balance-guard.test.ts |  16 +-
 services/api/src/permission/leave-queries.ts       |  43 +-
 .../src/permission/timesheet.integration.test.ts   |   2 +-
 .../api/src/permission/toil.integration.test.ts    | 530 +++++++++++++++++++++
 services/api/src/router.ts                         |   9 +
 23 files changed, 1242 insertions(+), 57 deletions(-)
```

Test-only CI follow-up, `git diff --stat d3d84de...72c9b54`:

```text
 .../STAGE-28_Leave_Policy_Engine_Part_2.md         | 118 ++++++++++++++++++---
 .../api/src/permission/toil.integration.test.ts    |   6 +-
 2 files changed, 106 insertions(+), 18 deletions(-)
```

The completion follow-up changes only this report.

## 5. Database changes

None: no migration, table, column, index, constraint or publication change. Ledger records use the existing graph tables.

## 6. Tests and gates

All four commands exited 0 on the final implementation. The unrelated, untracked `Claude outputs/` folder was temporarily moved outside the formatter scan and restored unchanged by an EXIT trap; no gate was edited.

`pnpm install --frozen-lockfile` — exit 0:

```text
Scope: all 7 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 675ms using pnpm v9.15.9
```

`pnpm stack:up` — exit 0: Postgres, Electric and Redis all healthy.

`pnpm verify` — exit 0:

```text
All matched files use Prettier code style!
Test Files  1 passed (1)
     Tests  6 passed | 2 todo (8)
Test Files  22 passed (22)
     Tests  140 passed | 2 todo (142)
Test Files  16 passed (16)
     Tests  102 passed (102)
Tasks:    10 successful, 10 total
```

Lint, architecture and typecheck all passed. UI, tokens and roster-web retain their existing no-test-file exits.

`pnpm verify:full` — exit 0 (re-runs verify, then real-Postgres preflight/API suite):

```text
Test Files  33 passed (33)
     Tests  352 passed | 2 skipped (354)
  Start at  00:53:18
  Duration  91.51s (transform 516ms, setup 0ms, import 12.12s, tests 77.47s, environment 1ms)
```

Negative control: temporarily added actual `export const negativeControl = new Date();` to `toil.ts`. `pnpm --filter @vulto/api exec vitest run src/permission/leave-balance-guard.test.ts` exited 1, `1 failed` file / `1 failed` test, on the forbidden-source assertion. Removed it; the restored guard passed in `pnpm --filter @vulto/api exec vitest run src/permission/toil.integration.test.ts src/permission/leave-balance-guard.test.ts --silent=false --disableConsoleIntercept` (exit 0, two files/seven tests passed at that checkpoint) and in the final full suite. No perturbation is committed.

Latest targeted timing run: `pnpm --filter @vulto/api exec vitest run src/permission/toil.integration.test.ts --disableConsoleIntercept`, exit 0, one file/nine tests passed. Server p95: preview **86.136709 ms**, TOIL balance **9.540083 ms**; 20 calls each, four Employees, one policy version, one live ledger entry, four Submitted TimesheetEntry rows, and one retained overtime flag. These are real Postgres/local-key-provider measurements, not device or production load claims.

Main at `44234af`: [fast-lane 36265578839](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36265578839) **success**; [slow-lane 36265578951](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36265578951) **success**, all six jobs including publish-artifacts.

Initial implementation `d3d84de`: [fast-lane 36267159988](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36267159988) **success**; [slow-lane 36267160100](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36267160100) **failure**. The sole failure was the new acceptance test's embedded timing loop: `Error: Test timed out in 5000ms.` All other 350 API tests passed (two existing skips); sync-browser, auth-browser and production-build succeeded. The fix splits the 20-call measurement into its own test with a 20-second budget; functional assertions, default timeouts, suite/gate configuration and product code are unchanged. The corrected head passed both lanes. Final report-only head CI evidence will be recorded in RST-115 and the completion response, because embedding that head's own run IDs would create another commit.

Implementation/tests `72c9b54`: [fast-lane 36267722472](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36267722472) **success** (`resolve-image`, `verify`); [slow-lane 36267722469](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36267722469) **success** (`resolve-image`, `api-integration`, `production-build`, `auth-browser`, `sync-browser`). All branch-eligible jobs executed; only main-only `publish-artifacts` was skipped, as configured. Conclusions were read with `gh run view`, not inferred from this report.

## 7. Micro-decisions

Consolidated pre-build discrepancies and minimal resolutions:

- Do item 7 says the four-day, 32-hour pattern with 40 logged yields “1 day, not 1.” The formula indeed yields 1; test that result and add a genuinely shorter daily pattern to distinguish personalized days from a fixed eight-hour divisor.
- `matchingPolicies` requires a caller principal, while `resolveToilAccrual(tx, flag, now)` does not name one separately. Carry the authenticated caller in the internal flag context; retain the required three-argument shared resolver and reuse caller-filtered policy/balance queries.
- Existing clearance authorizes its write before reading protected content; an unreadable existing flag is `role`, whereas a missing one is `not-found`. Read the protected record as the caller during plan construction, before the write checks, to satisfy item 4's identical refusal. Update the old integration assertion deliberately; the interceptor remains the authority.
- Existing clearance uses default transaction isolation and updates the flag with no expected version. Serialize clearance through the pipeline's existing serializable/retry mechanism to protect both repeat-clearance and cap headroom across concurrent clearances. No new retry mechanism.
- The existing `UtilizationSnapshot` matrix has member full cells; mirror its constructors, not its grants: the ledger's explicitly ruled grants are read-only for all five roles.
- A002's prose registry does not yet name the ledger. Stage 28 expressly orders its code registration, and the actual conformance gate validates the code registry rather than parsing that document. Leave reviewer-owned specifications untouched and flag the documentation follow-up for review.
- `matchingPolicies` returns the latest active version, including a future-effective one, while the existing balance engine resolves the date through its lineage. Extract and reuse that caller-filtered lineage traversal for TOIL pricing too, selecting the version effective on the clearance date. This preserves Stage 27's resolution/balance behavior and prevents freezing a future rate into today's ledger entry; a future-version integration test proves it.
- Private helper name `deriveWeekHours`; the internal preparation object carries the public result alongside its frozen policy id and expiry for the writer. Only the public result is returned by preview/clearance.
- Four decimal places retain 0.0001-day precision and suppress binary noise while avoiding an arbitrary whole/half-day grant quantum; half-away rounding is explicitly tested for both signs.
- The source guard stays in the API permission test folder, which already has Node filesystem types; the pure schema modules gain no I/O imports. The new API integration path's exact import skeleton passed `node scripts/arch-check.mjs` before fixture logic was added.
- The timing test has a local 20-second test budget for its 20 sequential preview and 20 balance calls plus setup; it is separate from functional acceptance tests. No suite/gate timeout or retry changed. This fixes the CI-only five-second combined-test timeout, not a product assertion.
- Existing Stage 27 non-Earned test bodies remain unchanged; the input fixture gains empty `ledger`, and the one deferred-Earned note assertion deliberately becomes zero entitlement with no note for an empty ledger.

Trace: `evaluateInTransaction` reads Submitted entries, maps detector input and sums seven `resolvedDayOn` results. Move those reads into a shared helper; count `isWorking` days, not fractional leave deductions. ApprovedOvertime on other reasons currently clears the flag normally; only HoursExceedExpected gets the re-flag exemption. Preserve that behavior.

Trace: pipeline authorizes declared checks, applies the plan, verifies declared create subjects, calls audience materialization with `changedRowIds`, and writes an argument digest/result, not plaintext arguments. Mutation tier does not constrain extra system-authorized rows. The ledger writer must authorize its own target and return its id for audience recomputation. Sensitive flag authorization/read/write auditing remains in the existing paths; the Tier 0 ledger grant is not a SensitiveAccessGranted event.

Trace: audience eligibility derives from registry protection partitions; materialization calls `decideRead`. No node-type allowlist or cache schema change is needed. Generic server and optimistic client node guards share `FEATURE_LIFECYCLE_NODE_TYPES`; member write authorization precedes server feature guards, so ledger generic writes can be refused as `role`. Registry count fixtures are 110 total and 82 feature-owned before this addition.

## 8. Findings raised

No new F-number or unresolved blocker. Closed F335–F339 were implemented, not reopened. All discrepancies above have minimal in-scope resolutions; governing documents remain untouched.

Fixture tracing during the first integration run exposed the detector's existing 130% threshold: 48/40 does not generate a flag. The acceptance fixture creates a flagged 60-hour submission, then uses the real unlock, correction and resubmission paths to retain that flag at 48 hours before preview/clearance. The detector is unchanged. The fixture explicitly sets a five-day/eight-hour calendar because the initial Pakistan calendar is six-day; production code makes no weekend assumption.

## 9. Deviations from this brief

No product-scope deviation. The 130% detector/48-hour fixture discrepancy was discovered during integration testing rather than the initial trace; its minimal fixture-only resolution is recorded in section 8. Governing documents were not edited.

## 10. Known limitations and risks

Usage remains empty on the server until VRS-F019; the pure engine accepts it and tests earliest-expiry consumption. No adjustment/reversal, pre-approval, UI or offline surface is built. Preview performs existing audited protected reads but writes no graph row. ApprovedOvertime on a non-HoursExceedExpected flag still clears it normally, accrues zero and does not gain the HoursExceedExpected-only exemption. The master prose registry follow-up belongs to the reviewer, not this branch.

## 11. Readiness for the next stage

Ready for reviewer evaluation, not approval to begin another stage. Implementation, local gates and implementation CI are complete. No next stage is started; wait for the founder/reviewer.

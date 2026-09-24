# Stage 18 — Timesheet Speed-Run

**Status:** BLOCKED
**Branch:** `codex/stage-18-timesheet-speed-run` @ `2cd5b03`
**Linear issues:** RST-46
**Date:** 2026-09-24

## 1. Summary

The F267 Pitch edge declaration and F268/F269 subject-resolution correction are committed. F269 was ruled by the reviewer and its authoritative documentation merged from `main`. Implementation stopped again on F270: a Team Member's post-submit anomaly evaluation has no authorized principal that can create a Tier 2 TimesheetAnomalyFlag through the named-mutation pipeline. The reviewer must rule that writer authority before the dependent mutation and tests can be built; no app code or protected documentation was directly edited.

## 2. Done-criteria checklist

- [ ] `logged_against` declares `Pitch: "identifying"` — the declaration is committed in `packages/schema/src/registry/edges.ts`; the required real-interceptor Pitch save test awaits the blocked mutation path.
- [ ] The F268/F269 row-scope branches are proven against the real interceptor — code committed in `2cd5b03`, but the required anomaly creation and direct-report test await F270.
- [ ] `saveCell` rejects a 25-hour date total before storage and the optimistic mutator surfaces `GraphValidationError` — not started.
- [ ] `submitWeek` transitions all Draft entries atomically with an injected-failure rollback proof — not started.
- [ ] `getWeek` and shortcuts use `resolveWorkingDay` across six-day, four-day and half-day cases — not started.
- [ ] A Sunday-to-Thursday workspace keys its week from Sunday — not started.
- [ ] `HoursExceedExpected` uses resolved expected hours rather than `contracted_hours` — not started.
- [ ] A Pitch-containing week does not trigger `HoursExceedExpected` — not started.
- [ ] `ApprovedOvertime` clearance prevents re-flagging and calls no `VRS-F018` mutation — not started.
- [ ] Anomaly evaluation failure does not fail or roll back submission — not started.
- [ ] `listActive` uses `filterReadable` and scopes a Manager to direct reports — not started; depends on F270.
- [ ] The flagged employee cannot read their own TimesheetAnomalyFlag — not started; depends on F270.
- [x] `hrCompliance.sendReminder` is absent from the code diff — direct inspection of `git diff main...HEAD`.
- [x] No `overtime.approve` or other `VRS-F018` call appears in the code diff — same evidence.
- [x] No file under `apps/` appears in the diff — same evidence.
- [ ] `pnpm verify` passes with real handlers for every new mutation and query — handlers not built; gates intentionally not run while blocked.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| VRS-F010 Edges / F267 | `packages/schema/src/registry/edges.ts` | Not yet: real-interceptor Pitch save test depends on the unbuilt mutation |
| F268/F269 row-scope resolution | `services/api/src/permission/interceptor.ts` | Not yet: real flag-creation test depends on F270 |

## 4. Files changed

```text
 docs/stage-reports/STAGE-18_Timesheet_Speed-Run.md | 83 ++++++++++++++++++++++
 packages/schema/src/registry/edges.ts              |  1 +
 services/api/src/permission/interceptor.ts         | 19 +++--
 3 files changed, 97 insertions(+), 6 deletions(-)
```

## 5. Database changes

None.

## 6. Tests and gates

The four required gates were not run: `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, and `pnpm verify:full`. Stage 18 cannot be COMPLETE until F270 is ruled and implementation resumes. Narrow checks on the committed F267/F268/F269 changes passed: `git diff --check` exited 0, and `pnpm exec prettier --check` on the two code files exited 0.

## 7. Micro-decisions

None.

## 8. Findings raised

### F269 — F268's direct-field row scope cannot resolve a Tier 2 TimesheetAnomalyFlag

**Status: closed on `main` at `26f3b83`.** The reviewer ruled that TimesheetEntry uses its Tier 0 direct `employee_id` field and TimesheetAnomalyFlag uses its already-registered `triggered_by` edge, extending the existing BurnoutAlert branch. The correction is implemented in `services/api/src/permission/interceptor.ts`; the reviewer-authoritative ruling and spec/brief updates were merged, not edited on this branch.

### F270 — post-submit anomaly evaluation has no authorized writer for Tier 2 flags

**Status: open; reviewer ruling required.** The Stage 18 brief requires `timesheetAnomaly.evaluate` to run immediately after every successful `timesheet.submitWeek`, as a separate named-mutation transaction, and create or update a Tier 2 TimesheetAnomalyFlag plus `triggered_by` edge. A Team Member is explicitly allowed to submit their own TimesheetEntry (`packages/schema/src/policy/policy-table.ts`: `TimesheetEntry` `Full (own only)`) but has `NONE` for TimesheetAnomalyFlag. `services/api/src/mutations/pipeline.ts` accepts only `MemberPrincipal` and passes that principal to every named mutation's `authorizeWrite` checks. If the post-submit evaluator uses the submitter, the interceptor refuses flag creation with `role`; bypassing that check would violate the server-authoritative write gate.

The existing system-principal path does not supply the missing authority either: `services/api/src/permission/interceptor.ts` gives system principals no node grant, and `packages/schema/src/policy/principal-policy.ts` lists only audit pseudonymization, key destruction and audience recompute as system operations. There is no anomaly-evaluation operation or named principal, and the pipeline cannot accept one as written. The brief specifies neither a permitted system write nor a delegation mechanism. A reviewer ruling is needed for how this reactive, server-generated protected flag is authorized and audited without granting a Team Member access to flags or bypassing the interceptor. The builder will not invent or impersonate an HR Admin principal, add an unreviewed system grant, or silently write the flag outside the named-mutation path.

Evidence: `packages/schema/src/policy/policy-table.ts` (`TimesheetEntry` and `TimesheetAnomalyFlag` cells), `services/api/src/mutations/pipeline.ts` (`MemberPrincipal` input and write checks), `services/api/src/permission/interceptor.ts` (system principals have no node grant), and `packages/schema/src/policy/principal-policy.ts` (closed system operation list). The F268/F269 interceptor change is independent and preserved; the untested Timesheet schema draft was removed before this stop.

## 9. Deviations from this brief

None implemented. The incomplete stage is blocked by F270 rather than worked around.

## 10. Known limitations and risks

The F267 registry declaration and F268/F269 interceptor change are committed but have not yet reached real mutation tests. No TimesheetEntry or TimesheetAnomalyFlag creation path exists on this branch.

## 11. Readiness for the next stage

No. Stage 18 must resume after the reviewer rules F270; Stage 19 is not started.

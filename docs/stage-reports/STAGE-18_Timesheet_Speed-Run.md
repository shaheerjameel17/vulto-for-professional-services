# Stage 18 — Timesheet Speed-Run

**Status:** BLOCKED
**Branch:** `codex/stage-18-timesheet-speed-run` @ `3837102` (F270 ruling merged; report amendment follows)
**Linear issues:** RST-46
**Date:** 2026-09-24

## 1. Summary

The F267 Pitch edge declaration and F268/F269 subject-resolution correction are committed. F270's founder ruling was merged from `main` at `6f4b80a`, resolving the anomaly writer's authority. Before implementing it, tracing G09/G09b exposed F271: the evaluator must inspect existing Tier 2 flag fields to avoid duplicate flags and honor ApprovedOvertime clearance, but the newly authorized system principal has only a write operation and no audited protected-read grant. Implementation stopped for a reviewer ruling; no app code or protected documentation was directly edited.

## 2. Done-criteria checklist

- [ ] `logged_against` declares `Pitch: "identifying"` — the declaration is committed in `packages/schema/src/registry/edges.ts`; the required real-interceptor Pitch save test awaits the blocked mutation path.
- [ ] The F268/F269 row-scope branches are proven against the real interceptor — code committed in `2cd5b03`, but the required anomaly creation and direct-report test await F271.
- [ ] `saveCell` rejects a 25-hour date total before storage and the optimistic mutator surfaces `GraphValidationError` — not started.
- [ ] `submitWeek` transitions all Draft entries atomically with an injected-failure rollback proof — not started.
- [ ] `getWeek` and shortcuts use `resolveWorkingDay` across six-day, four-day and half-day cases — not started.
- [ ] A Sunday-to-Thursday workspace keys its week from Sunday — not started.
- [ ] `HoursExceedExpected` uses resolved expected hours rather than `contracted_hours` — not started.
- [ ] A Pitch-containing week does not trigger `HoursExceedExpected` — not started.
- [ ] `ApprovedOvertime` clearance prevents re-flagging and calls no `VRS-F018` mutation — not started.
- [ ] Anomaly evaluation failure does not fail or roll back submission — not started.
- [ ] `listActive` uses `filterReadable` and scopes a Manager to direct reports — not started; depends on the blocked anomaly path.
- [ ] The flagged employee cannot read their own TimesheetAnomalyFlag — not started; depends on the blocked anomaly path.
- [x] `hrCompliance.sendReminder` is absent from the code diff — direct inspection of `git diff main...HEAD`.
- [x] No `overtime.approve` or other `VRS-F018` call appears in the code diff — same evidence.
- [x] No file under `apps/` appears in the diff — same evidence.
- [ ] `pnpm verify` passes with real handlers for every new mutation and query — handlers not built; gates intentionally not run while blocked.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| VRS-F010 Edges / F267 | `packages/schema/src/registry/edges.ts` | Not yet: real-interceptor Pitch save test depends on the unbuilt mutation |
| F268/F269 row-scope resolution | `services/api/src/permission/interceptor.ts` | Not yet: real flag-creation test depends on F271 |

## 4. Files changed

Relative to current `main`: `packages/schema/src/registry/edges.ts` (F267), `services/api/src/permission/interceptor.ts` (F268/F269), and this report. The F270 ruling documents were merged from `main`, not edited here.

## 5. Database changes

None.

## 6. Tests and gates

The four required gates were not run: `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, and `pnpm verify:full`. Stage 18 cannot be COMPLETE until F271 is ruled and implementation resumes. Narrow checks on the committed F267/F268/F269 changes passed in the previous stop: `git diff --check` exited 0, and `pnpm exec prettier --check` on the two code files exited 0.

## 7. Micro-decisions

None.

## 8. Findings raised

### F269 — F268's direct-field row scope cannot resolve a Tier 2 TimesheetAnomalyFlag

**Status: closed on `main` at `26f3b83`.** The reviewer ruled that TimesheetEntry uses its Tier 0 direct `employee_id` field and TimesheetAnomalyFlag uses its already-registered `triggered_by` edge, extending the existing BurnoutAlert branch. The correction is implemented in `services/api/src/permission/interceptor.ts`; the reviewer-authoritative ruling and spec/brief updates were merged, not edited on this branch.

### F270 — post-submit anomaly evaluation has no authorized writer for Tier 2 flags

**Status: closed on `main` at `6f4b80a`.** The Stage 18 brief requires `timesheetAnomaly.evaluate` to run immediately after every successful `timesheet.submitWeek`, as a separate named-mutation transaction, and create or update a Tier 2 TimesheetAnomalyFlag plus `triggered_by` edge. A Team Member is explicitly allowed to submit their own TimesheetEntry (`packages/schema/src/policy/policy-table.ts`: `TimesheetEntry` `Full (own only)`) but has `NONE` for TimesheetAnomalyFlag. `services/api/src/mutations/pipeline.ts` accepts only `MemberPrincipal` and passes that principal to every named mutation's `authorizeWrite` checks. If the post-submit evaluator uses the submitter, the interceptor refuses flag creation with `role`; bypassing that check would violate the server-authoritative write gate.

At the time F270 was raised, the existing system-principal path did not supply the missing authority either: `services/api/src/permission/interceptor.ts` gave system principals no node grant, and `packages/schema/src/policy/principal-policy.ts` listed only audit pseudonymization, key destruction and audience recompute as system operations. There was no anomaly-evaluation operation or named principal, and the pipeline could not accept one as written. The brief specified neither a permitted system write nor a delegation mechanism. The builder did not invent or impersonate an HR Admin principal, add an unreviewed system grant, or silently write the flag outside the named-mutation path.

The founder ruled a distinct `authorizeWrite` Gate 1 path for a new `timesheet-anomaly-evaluate` system principal, limited to `timesheet-anomaly.create-flag`. This ruling is authoritative in `docs/Foundations_Findings.md` and the revised Stage 18 brief, both merged from `main`; it has not yet been implemented because F271 surfaced while tracing the dependent evaluator. The F268/F269 interceptor change is independent and preserved; the untested Timesheet schema draft was removed before the prior stop.

### F271 — anomaly evaluation has no authorized read of prior Tier 2 flags

**Status: open; reviewer ruling required.** `VRS-F010` G09 requires at most one Active uncleared flag per employee, week and reason, with a repeat trigger updating `detail`. G09b and the Stage 18 done criteria require an `ApprovedOvertime`-cleared HoursExceedExpected flag never to reappear on later evaluation. Both behaviors require inspecting prior flags' `employee_id`, `week_start_date`, `flag_reason`, `cleared_at`, and `clearance_outcome` before a create/update decision. `TimesheetAnomalyFlag` is Tier 2 (`packages/schema/src/registry/nodes.ts`); `services/api/src/graph/store.ts` stores its feature fields in encrypted `graph_protected_fragments`, not the plain `graph_nodes.record`. Its `triggered_by` edge identifies the Employee but reveals none of the week, reason, or clearance data.

The only established decrypt path is `services/api/src/protected/read.ts`'s audited `readProtected`: it calls `authorizeRead` before decrypting. `services/api/src/permission/interceptor.ts` gives system principals no policy roles for reads, so `readProtected` releases no flag content to F270's new `timesheet-anomaly-evaluate` principal. That principal's one operation, `timesheet-anomaly.create-flag`, is explicitly write-only. The submitting Team Member has `NONE` on TimesheetAnomalyFlag in `packages/schema/src/policy/policy-table.ts`; using that member to read the prior flags fails too. Direct decryption or a fabricated HR Admin principal would bypass the audited permission boundary. A deterministic flag ID or edge lookup cannot distinguish a cleared ApprovedOvertime flag from an uncleared one because clearance fields remain encrypted. The reviewer must rule a narrow, audited protected-read authority or another spec-compatible mechanism before the evaluator can satisfy G09/G09b. No read grant or workaround has been invented on this branch.

## 9. Deviations from this brief

None implemented. The incomplete stage is blocked by F271 rather than worked around.

## 10. Known limitations and risks

The F267 registry declaration and F268/F269 interceptor change are committed but have not yet reached real mutation tests. No TimesheetEntry or TimesheetAnomalyFlag creation path exists on this branch.

## 11. Readiness for the next stage

No. Stage 18 must resume after the reviewer rules F271; Stage 19 is not started.

# Stage 18 — Timesheet Speed-Run

**Status:** BLOCKED
**Branch:** `codex/stage-18-timesheet-speed-run` @ `77839f5`
**Linear issues:** RST-46
**Date:** 2026-09-24

## 1. Summary

The pre-ruled F267 Pitch edge declaration is committed. Implementation stopped on F269: the pre-ruled F268 interceptor instruction cannot resolve the employee for a Tier 2 TimesheetAnomalyFlag from the ordinary graph node record, because the canonical store deliberately removes all protected feature fields from that record. The reviewer must rule on a permitted subject-resolution path before the anomaly mutations or their permission tests can be built. No app code or protected documentation was changed.

## 2. Done-criteria checklist

- [ ] `logged_against` declares `Pitch: "identifying"` — the declaration is committed in `packages/schema/src/registry/edges.ts`; the required real-interceptor Pitch save test awaits the blocked mutation path.
- [ ] The F268 row-scope behavior is proven against the real interceptor — blocked by F269 for TimesheetAnomalyFlag; no incomplete branch was retained.
- [ ] `saveCell` rejects a 25-hour date total before storage and the optimistic mutator surfaces `GraphValidationError` — not started.
- [ ] `submitWeek` transitions all Draft entries atomically with an injected-failure rollback proof — not started.
- [ ] `getWeek` and shortcuts use `resolveWorkingDay` across six-day, four-day and half-day cases — not started.
- [ ] A Sunday-to-Thursday workspace keys its week from Sunday — not started.
- [ ] `HoursExceedExpected` uses resolved expected hours rather than `contracted_hours` — not started.
- [ ] A Pitch-containing week does not trigger `HoursExceedExpected` — not started.
- [ ] `ApprovedOvertime` clearance prevents re-flagging and calls no `VRS-F018` mutation — not started.
- [ ] Anomaly evaluation failure does not fail or roll back submission — not started.
- [ ] `listActive` uses `filterReadable` and scopes a Manager to direct reports — not started; depends on F269.
- [ ] The flagged employee cannot read their own TimesheetAnomalyFlag — not started; depends on F269.
- [x] `hrCompliance.sendReminder` is absent from the code diff — `git diff main...HEAD` touches only `packages/schema/src/registry/edges.ts`.
- [x] No `overtime.approve` or other `VRS-F018` call appears in the code diff — same evidence.
- [x] No file under `apps/` appears in the diff — same evidence.
- [ ] `pnpm verify` passes with real handlers for every new mutation and query — handlers not built; gates intentionally not run while blocked.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| VRS-F010 Edges / F267 | `packages/schema/src/registry/edges.ts` | Not yet: real-interceptor Pitch save test depends on the unbuilt mutation |

## 4. Files changed

```text
 packages/schema/src/registry/edges.ts | 1 +
 1 file changed, 1 insertion(+)
```

This is the verbatim `git diff --stat main...HEAD` output at the stop point, before this report is committed.

## 5. Database changes

None.

## 6. Tests and gates

The four required gates were not run: `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, and `pnpm verify:full`. Stage 18 cannot be COMPLETE until F269 is ruled and implementation resumes. Narrow checks on the one committed line passed: `git diff --check` exited 0, and `pnpm exec prettier --check packages/schema/src/registry/edges.ts` exited 0 with “All matched files use Prettier code style!”

## 7. Micro-decisions

None.

## 8. Findings raised

### F269 — F268's direct-field row scope cannot resolve a Tier 2 TimesheetAnomalyFlag

**Status: open; reviewer ruling required.** F268 directs `rowScopeSatisfied` to call `getNode` for both `TimesheetEntry` and `TimesheetAnomalyFlag` and read `node.record.employee_id`, with a missing or non-string value failing closed. That works for Tier 0 `TimesheetEntry`. It cannot work for `TimesheetAnomalyFlag`: `packages/schema/src/registry/nodes.ts` registers that node as fixed Tier 2 (`Manager-restricted`), while `services/api/src/graph/store.ts`'s `writeNode` persists only `pickUniversal(full)` whenever `keepsContent(nodeType)` is false. For a fixed Tier 2 node, `keepsContent` is false, so `employee_id` is never in `graph_nodes.record` or the `StoredNode.record` returned by `getNode`. The F268 branch would always return false for a genuine anomaly flag, refusing the required Manager direct-report read and clearance.

This is a protection boundary, not merely a missing field in a test fixture. Copying `employee_id` into `graph_nodes.record` to make the branch pass would place Tier 2 content in a table published to device sync, contrary to VPS-A003. The registry already has a `triggered_by` edge from TimesheetAnomalyFlag to Employee, but F268 explicitly ruled on the direct field rather than an edge path. The reviewer needs to determine and document a subject-resolution mechanism compatible with Tier 2 storage and the existing policy; the builder will not choose one or revise the closed F268 ruling.

Evidence: `packages/schema/src/registry/nodes.ts` (TimesheetAnomalyFlag fixed Tier 2), `services/api/src/graph/store.ts` (`keepsContent`, `pickUniversal`, `writeNode`, `getNode`), `services/api/src/permission/interceptor.ts` (`rowScopeSatisfied`), and the F268 text in `docs/Foundations_Findings.md`. I removed the incomplete F268 branch after confirming this path and stopped before dependent implementation.

## 9. Deviations from this brief

None implemented. The incomplete stage is blocked by F269 rather than worked around.

## 10. Known limitations and risks

The F267 registry declaration is committed but has not yet reached a real `saveCell` interceptor test. No TimesheetEntry or TimesheetAnomalyFlag creation path exists on this branch.

## 11. Readiness for the next stage

No. Stage 18 must resume after the reviewer rules F269; Stage 19 is not started.

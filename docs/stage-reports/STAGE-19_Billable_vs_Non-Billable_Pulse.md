# Stage 19 — Billable vs Non-Billable Pulse

**Status:** In Review — implementation complete, awaiting founder review
**Branch:** `codex/stage-19-billable-non-billable-pulse`
**Linear issue:** RST-47
**Date:** 2026-09-25

## Summary

Stage 19's server-side utilization snapshot and two read endpoints are implemented. F279–F281 were ruled and merged into the branch before implementation. This report retains the original finding record below, followed by the completion evidence. No file under `apps/` changed. The unrelated untracked `Claude outputs/` directory was left untouched.

## Findings raised

### F279 — UtilizationSnapshot's row-scoped grants cannot resolve their subject

**Ruled and implemented.** The F278 policy row gives a Team Member `Read (own only)` and a Manager `Full (direct reports)`. `resolveStoredSubjectEmployeeId` now reads `UtilizationSnapshot.employee_id` through the existing stored-field branch, identical to TimesheetEntry and TimesheetWeekSubmission. The real interceptor integration test proves the Team Member reads their own snapshot and an unrelated Team Member receives `null`.

### F280 — Reactive snapshot computation has no authorized writer

**Ruled and implemented.** The internal named `utilizationSnapshot.compute` mutation runs in its own transaction as `utilization-snapshot-compute`, calls `authorizeWrite` with `utilization-snapshot.compute`, and uses the reserved system User identity for provenance. It has no client router entry. A Team Member's saved cell produces the snapshot despite their read-only snapshot policy grant.

### F281 — Permission-filtered employee listing cannot yield a Team Member's agency-wide aggregate

**Ruled and implemented.** `getAgencyAggregate` reads Employee and UtilizationSnapshot under the same `utilization-snapshot-compute` system principal's `utilization-snapshot.read-cohort` operation for every caller. It excludes Ghost Resources and zero-contracted-hours employees before computing figures, then passes filtered and unfiltered results through `applyDisclosureControl`. Its `perEmployee` ranking is a separate ordinary-principal path with an independent role gate. The real interceptor test proves Owner, Manager, and Team Member receive byte-identical aggregate fields while Manager sees only a direct report and Team Member gets no `perEmployee` field.

## Completion checks

- `calculateUtilization` divides billable hours by **expected hours**, never logged hours; it separately calculates logging completeness. `logged_hours` includes only Billable and NonBillable. Pitch is accumulated into `pitch_hours` and never enters either side of the utilization ratio. Unit proofs cover 4/40 = 10.0, 20 billable + 15 pitch / 40 = 50.0, and all zero-denominator guards. A reactive end-to-end test also saves Billable and Pitch cells and checks the resulting stored snapshot.
- `expectedWeek` is the shared `hoursOn`/`isoDatesInclusive` loop used by both `getWeek` and snapshot computation. The integration test compares the stored `expected_hours` directly to `getWeek.expectedWeeklyHours` for the same employee and week.
- The `UtilizationSnapshot` policy row exactly composes F278's cells: Owner/HR Admin Full Any, Finance Admin Read Any, Manager Full direct reports, Team Member Read own only. The latter is deliberately not Employee:operational's own-plus-team scope. `resolveStoredSubjectEmployeeId` uses the same stored `employee_id` branch as TimesheetEntry/TimesheetWeekSubmission.
- `SYSTEM_OPERATION_TARGETS` is the sole node-target table for system-principal `decideRead` and `authorizeWrite`; its existing anomaly edge check remains separate. The compute transaction constructs `utilization-snapshot-compute` explicitly and uses its reserved actor for provenance. A real interceptor test covers allowed and denied node targets.
- Snapshot computation reads TimesheetEntry directly by employee/week, updates an existing pair in place, and otherwise uses a deterministic ID plus serializable retry for concurrent first writes. The integration test recomputes a pair and finds exactly one unchanged node ID. Weeks with no entries produce no snapshot.
- The agency aggregate and `perEmployee` are distinct functions under distinct principals. The cohort excludes Ghost Resources and zero-contracted-hours employees before the optional department selector and before any figure is computed; `applyDisclosureControl` handles suppression/differencing. Comparison rows are individually authorized and ranked only for Owner/HR Admin or Manager direct reports. Team Member receives an agency aggregate and own snapshot but no `perEmployee` key.
- `saveCell`, `submitWeek`, and `unlockWeek` recompute after commit. The injected-failure test calls a throwing compute from `saveCell`'s after-commit seam and proves the entry remains committed. `utilizationSnapshot.compute` has no router procedure; only the two read procedures were added.
- `billability_target_override` is used when present, otherwise compute uses `0.75` directly. `services/api/src/graph/founding.ts` is untouched and no Workspace `billability_target` key was added. No specification, build-prompt, or findings-ledger file was edited by this stage.

## Gates

- `CI=true pnpm install --frozen-lockfile` — passed; lockfile up to date.
- `pnpm stack:up` — passed; Postgres, Redis, and Electric healthy.
- `pnpm verify` — passed: format, lint, conformance, architecture, typecheck, and fast tests.
- `pnpm verify:full` — passed: preflight and API integration suite, **23 files passed, 301 tests passed, 2 skipped**.

The unrelated untracked `Claude outputs/` directory contains a pre-existing unformatted Markdown file. It was temporarily moved outside the repository during the two formatting gates and restored immediately afterward, unchanged; the first unsheltered `pnpm verify` attempt failed solely on that unrelated file before any later checks ran. The successful gates above were run on the complete tracked repository plus the Stage 19 changes. No file under `apps/` appears in the branch diff. RST-47 is ready for In Review; stop at this stage boundary.

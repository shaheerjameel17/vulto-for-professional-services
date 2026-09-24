# Stage 19 — Billable vs Non-Billable Pulse

**Status:** BLOCKED — awaiting reviewer rulings before implementation
**Branch:** `codex/stage-19-billable-non-billable-pulse` at `22699d5`
**Linear issue:** RST-47
**Date:** 2026-09-25

## Summary

I read the Stage 19 brief and corrected VRS-F011 specification and traced their proposed paths through the existing interceptor, mutation pipeline, and employee queries. No implementation was written and none of the four gates was run: the three findings below make the required access and computation paths impossible as currently briefed. This report is the only document changed on the branch. The unrelated untracked `Claude outputs/` directory was left untouched.

## Findings raised

### F279 — UtilizationSnapshot's row-scoped grants cannot resolve their subject

**Open; reviewer ruling requested.** The F278 policy row deliberately gives a Team Member `Read (own only)` and a Manager `Full (direct reports)`. Both cells require the interceptor's `rowScopeSatisfied` to identify the snapshot's Employee. `services/api/src/permission/interceptor.ts`'s `resolveStoredSubjectEmployeeId` currently recognizes Employee, BurnoutAlert/TimesheetAnomalyFlag, and TimesheetEntry/TimesheetWeekSubmission only; every other node type, including UtilizationSnapshot, returns `null`. Thus the required `getIndividual` read for a Team Member and the Manager's direct-report comparison are denied regardless of the new policy-table row. The Stage 19 brief calls this “the same subject-resolution shape” as TimesheetEntry but does not instruct that UtilizationSnapshot be added to the resolver. Proposed correction: extend that existing stored direct-`employee_id` branch to UtilizationSnapshot, with real interceptor tests for own, direct-report, and unrelated rows. This is a direct F268/F273 precedent, not a request for a new permission mechanism.

### F280 — Reactive snapshot computation has no authorized writer

**Open; reviewer/founder ruling requested.** The brief requires `utilizationSnapshot.compute` to run after `timesheet.saveCell` by an ordinary Team Member and create or update a UtilizationSnapshot. F278 intentionally grants that Team Member `Read (own only)`, not Full, so a compute transaction under the submitting `MemberPrincipal` fails `authorizeWrite` Gate 1. `services/api/src/mutations/pipeline.ts` accepts only `MemberPrincipal`, while the existing separate reactive evaluator (`timesheetAnomalyEvaluate`) uses a dedicated system principal, explicit closed-table operation, `authorizeWrite`, and a reserved provenance identity. No `utilization-snapshot` system principal or operation exists in `packages/schema/src/policy/principal-policy.ts`; `authorizeWrite`'s system branch currently permits only `TimesheetAnomalyFlag`/`triggered_by` for `timesheet-anomaly.create-flag`. Running under Owner/HR Admin by impersonation, bypassing Gate 1, or writing outside a named mutation would contradict VPS-A003/A004. The brief specifies neither a system write grant nor a different authorized delegation. Proposed direction for review: follow F270/F272's narrowly scoped system-principal pattern for this derived write, including a real reserved User provenance identity; explicitly settle how the named `utilizationSnapshot.compute` definition reaches that internal transaction without exposing a client route.

### F281 — Permission-filtered employee listing cannot yield a Team Member's agency-wide aggregate

**Open; reviewer ruling requested.** Stage 19 item 5 requires the cohort to come from `listEmployees(tx, principal, ...)`; item 6 and VRS-F011 require a Team Member to receive an **agency** aggregate but no colleague-by-colleague ranking. `listEmployees` in `services/api/src/permission/employee-queries.ts` calls `filterReadable` under the caller's principal. `Employee:operational` grants a Team Member only `Read (own + team)`, so this list omits employees on other teams. Aggregating its snapshots would produce a team-only percentage labeled as agency-wide, and could suppress it below `k_anonymity_minimum` even when the agency cohort is large. Reading every row directly as the Team Member would bypass the interceptor; a role check controlling only the `perEmployee` response field does not resolve the aggregate's data source. The brief also names an `employeeType` filter argument that `listEmployees` does not currently accept (bench-forecast-queries.ts instead filters `employee_type` after calling it), but that mechanical mismatch is secondary. Proposed correction: specify an interceptor-governed aggregate-read context or other reviewed server-side path that can use the whole agency cohort while releasing only `applyDisclosureControl`'s result to a Team Member; preserve caller-scoped row reads for the individual bar and Manager's direct-report ranking.

## Implementation and gates

- No source code or specification/brief/findings-ledger files changed.
- No gate was run; all four (`pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, `pnpm verify:full`) remain pending the rulings and implementation.
- No file under `apps/` changed.
- Stage 19 has not reached its Done criteria. RST-47 should remain blocked pending the reviewer's corrections; no Stage 20 work begins.

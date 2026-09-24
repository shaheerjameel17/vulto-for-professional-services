# Stage 20 — Revenue Gap Alert

**Status:** In Review — implementation complete, awaiting founder review
**Branch:** `codex/stage-20-revenue-gap-alert`
**Linear issue:** RST-48
**Date:** 2026-09-25

## Summary

Implemented `VRS-F012`'s server-side alert schema, bench-derived evaluator, reactive Assignment triggers, authenticated manual sweep, caller-scoped list and dismiss API. No `apps/` file changed; no Inbox surface or scheduler was added. F282–F284 were already ruled before this stage; no new build-time finding arose. No specification, build-prompt, or findings-ledger file was edited.

## Completion checks

- F283: `cohortEmployee` and exported `computeBenchStatus` call the same `benchDaysForWindow` loop. That loop checks `resolvedDayOn`, covering Active Assignments, and Pitch-classified `TimesheetEntry` dates read as trusted Tier 0 inputs. The real Pitch integration test saves cells on every working day and observes zero bench days and no alert.
- `RevenueGapAlert` uses its existing Standard/Tier 0 registration and a new policy row identical to `GhostResource`: Owner/HR Admin and Manager Full Any, Finance Admin and Team Member Read Any. The field schema includes the universal envelope and every F012 alert field. Generic graph create/update/delete/transition cannot bypass the feature-owned lifecycle.
- `resolveDailyCost` uses the most recently ended Assignment's stored `effective_billing_rate × 8` ahead of `Employee.billing_rate_default`, otherwise zero. It never reads compensation or performs a rate-card lookup. The integration test stores an hourly rate of 15 with a competing employee default of 500 and observes daily cost 120; a no-history/no-default test observes zero cost.
- `revenueGapAlert.evaluate` is internal-only, validates a real Employee before any computation, and constructs `revenue-gap-alert-evaluate` as its own system principal. `SYSTEM_OPERATION_TARGETS` gained exactly one node-target entry, `revenue-gap-alert.write → RevenueGapAlert:record`; the existing system edge Gate 1 also permits this principal's `triggered_by` edge to Employee. The reserved system User ID, not the triggering member, is stamped as creator/updater. A Manager's real `assignment.cancel` hook produces an alert under that system actor.
- Each serializable evaluation queries the existing Active alert by employee before allocating a new node ID. Unchanged values cause no update. A create writes exactly one `triggered_by` edge; later calculations update the same node. The Low-at-5 to Medium-at-10 integration test checks node identity and `escalated_at`. The manual sweep re-evaluates active non-Ghost Employees, is callable through an authenticated router procedure, and a repeated unchanged sweep preserves `updated_at`. No cron or scheduling library was added.
- Resolution is permitted only when a currently covering Active Assignment supplies its real ID. The `assignment.create` reactive test observes `Resolved`, `resolved_at`, `resolved_by: "system"`, and `resolved_by_assignment_id` equal to the new Assignment's ID. Dismissal changes only `dismissed_at`; it leaves `Active` intact and the next threshold still escalates. A resolved alert refuses dismissal.
- `listActive` runs `filterReadable` under the ordinary caller, excludes Ghost-linked rows, and sorts by accumulated cost descending. A Team Member can list another employee's alert workspace-wide but cannot dismiss it. The evaluator, sweep, and read path all exclude Ghost Resources. The UAE test uses the actual AE calendar and proves Friday/Saturday are absent across a fortnight.
- `assignmentCreate` (including its shared override creation plan), date-changing `assignmentUpdate`, and `assignmentCancel` evaluate after commit through the pipeline's non-gating hook. The ordinary dismiss mutation has matching server and optimistic handlers plus a direct router procedure that uses the named-mutation pipeline. `evaluate` has no client router entry; `sweep` is the manual authenticated procedure pending `VPS-A006`.

## Gates

- `CI=1 pnpm install --frozen-lockfile` — passed; lockfile unchanged.
- `pnpm stack:up` — passed; Postgres, Redis, and Electric healthy.
- `pnpm verify` — passed: format, lint, conformance, architecture, typecheck, and fast tests.
- `pnpm verify:full` — passed: preflight and API integration suite, **24 files passed, 308 tests passed, 2 skipped**.

The unrelated untracked `Claude outputs/` directory contains an unformatted Markdown file. It was temporarily moved outside the repository for the two formatting gates and restored immediately afterward, unchanged. The first unsheltered `pnpm verify` attempt stopped only on that file before other checks ran. The successful gates used all tracked repository files and the Stage 20 changes. No file under `apps/` appears in the diff.

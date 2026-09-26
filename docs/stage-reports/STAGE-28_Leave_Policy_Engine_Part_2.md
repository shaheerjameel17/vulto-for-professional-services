# Stage 28 — Leave Policy Engine, Part 2

**Status:** IN PROGRESS
**Branch:** codex/stage-28-toil-ledger @ 44234af
**Linear issues:** RST-115
**Date:** 2026-09-27

## 1. Summary

Pre-build trace recorded before product edits. Main was fast-forwarded to 44234af and verified with ls-remote. Main fast-lane: 36265578839 (success); slow-lane: 36265578951 (publishing still running when inspected).

## 2. Done-criteria checklist

- [ ] Ledger registration, strict schema, subject scope and read-only member access.
- [ ] Narrow system writer inside the clearance transaction.
- [ ] Pure TOIL computation and source-guard negative control.
- [ ] Shared server-derived week-hours helper.
- [ ] Atomic clearance, acknowledgement, repeat refusal and read-only preview.
- [ ] Earned engine and caller-filtered ledger input.
- [ ] Scope boundaries preserved.
- [ ] Four gates and both branch CI workflows green.

## 3. Spec clauses implemented

Not implemented yet.

## 4. Files changed

This pre-build report only.

## 5. Database changes

None planned: graph records use the existing graph tables.

## 6. Tests and gates

Not run on Stage 28 yet.

## 7. Micro-decisions

Consolidated pre-build discrepancies and minimal resolutions:

- Do item 7 says the four-day, 32-hour pattern with 40 logged yields “1 day, not 1.” The formula indeed yields 1; test that result and add a genuinely shorter daily pattern to distinguish personalized days from a fixed eight-hour divisor.
- `matchingPolicies` requires a caller principal, while `resolveToilAccrual(tx, flag, now)` does not name one separately. Carry the authenticated caller in the internal flag context; retain the required three-argument shared resolver and reuse caller-filtered policy/balance queries.
- Existing clearance authorizes its write before reading protected content; an unreadable existing flag is `role`, whereas a missing one is `not-found`. Read the protected record as the caller during plan construction, before the write checks, to satisfy item 4's identical refusal. Update the old integration assertion deliberately; the interceptor remains the authority.
- Existing clearance uses default transaction isolation and updates the flag with no expected version. Serialize clearance through the pipeline's existing serializable/retry mechanism to protect both repeat-clearance and cap headroom across concurrent clearances. No new retry mechanism.
- The existing `UtilizationSnapshot` matrix has member full cells; mirror its constructors, not its grants: the ledger's explicitly ruled grants are read-only for all five roles.
- A002's prose registry does not yet name the ledger. Stage 28 expressly orders its code registration, and the actual conformance gate validates the code registry rather than parsing that document. Leave reviewer-owned specifications untouched and flag the documentation follow-up for review.
- `matchingPolicies` returns the latest active version, including a future-effective one, while the existing balance engine resolves the date through its lineage. Extract and reuse that caller-filtered lineage traversal for TOIL pricing too, selecting the version effective on the clearance date. This preserves Stage 27's resolution/balance behavior and prevents freezing a future rate into today's ledger entry; a future-version integration test proves it.

Trace: `evaluateInTransaction` reads Submitted entries, maps detector input and sums seven `resolvedDayOn` results. Move those reads into a shared helper; count `isWorking` days, not fractional leave deductions. ApprovedOvertime on other reasons currently clears the flag normally; only HoursExceedExpected gets the re-flag exemption. Preserve that behavior.

Trace: pipeline authorizes declared checks, applies the plan, verifies declared create subjects, calls audience materialization with `changedRowIds`, and writes an argument digest/result, not plaintext arguments. Mutation tier does not constrain extra system-authorized rows. The ledger writer must authorize its own target and return its id for audience recomputation. Sensitive flag authorization/read/write auditing remains in the existing paths; the Tier 0 ledger grant is not a SensitiveAccessGranted event.

Trace: audience eligibility derives from registry protection partitions; materialization calls `decideRead`. No node-type allowlist or cache schema change is needed. Generic server and optimistic client node guards share `FEATURE_LIFECYCLE_NODE_TYPES`; member write authorization precedes server feature guards, so ledger generic writes can be refused as `role`. Registry count fixtures are 110 total and 82 feature-owned before this addition.

## 8. Findings raised

None blocking at this point. All discrepancies above have minimal in-scope resolutions; governing documents remain untouched.

Fixture tracing during the first integration run exposed the detector's existing 130% threshold: 48/40 does not generate a flag. The acceptance fixture creates a flagged 60-hour submission, then uses the real unlock, correction and resubmission paths to retain that flag at 48 hours before preview/clearance. The detector is unchanged. The fixture explicitly sets a five-day/eight-hour calendar because the initial Pakistan calendar is six-day; production code makes no weekend assumption.

## 9. Deviations from this brief

None implemented.

## 10. Known limitations and risks

Performance, atomicity and audience assertions remain unverified pending implementation.

## 11. Readiness for the next stage

No. Stage 28 is in progress.

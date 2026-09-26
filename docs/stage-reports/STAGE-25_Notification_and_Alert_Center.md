# Stage 25 — Notification and Alert Center

**Status:** BLOCKED
**Branch:** codex/stage-25-notification-center (rebased onto 9402b4e)
**Linear issues:** RST-52
**Date:** 2026-09-26

## 1. Summary

The original two pre-code contradictions were ruled as F313 and F314, and this branch was rebased onto 9402b4e. Continued tracing found that Do item 5's named compliance role gate does not exist in the named query or router. The existing integration test deliberately permits a Team Member's own submission-status row. No product code was written; a reminder-authorization ruling is required before implementation.

## 2. Done-criteria checklist

- [ ] Recipient-only reads and removal of the obsolete scope — implementation stopped; the repository-wide removal criterion also conflicts with protected historical documentation.
- [ ] Generic creation refused on server and client — not implemented.
- [ ] Recipient-only audience proven — not implemented.
- [ ] Registry validation and safe messages proven — not implemented.
- [ ] Exactly two manager rules registered — not implemented.
- [ ] Severity and concurrent delivery idempotency — not implemented.
- [ ] Missing manager/link skips without fallback — not implemented.
- [ ] Failure-isolated delivery with only pipeline.ts changed under mutations — blocked by the engine-location/gate conflict.
- [ ] Own-only idempotent read-state mutations — not implemented.
- [ ] Compliance reminders reuse the existing gate — blocked: the named role gate does not exist.
- [ ] Local grouping and unread-action count — not implemented.
- [x] No email, push, muting, apps, cache schema or policy changes — no product changes made.
- [ ] verify, verify:full and both CI workflows green — not claimed; stopped during tracing.

## 3. Spec clauses implemented

None. No product implementation began.

## 4. Files changed

Only this blocked stage report. No product files changed.

## 5. Database changes

None.

## 6. Tests and gates

The four stage gates were not run: stopped before implementation, rather than working around the architecture gate. No Stage 25 branch CI result is claimed.

Diagnostic: in an isolated scratch tree, run the existing gate unchanged:

```text
node /Users/shaheerjameel/Development/vulto-for-professional-services/scripts/arch-check.mjs
exit code: 1
✗ A003-T52 — graph/store may be imported only from the graph, permission,
  mutations, protected, audience and jobs folders of services/api/src. Found:
  services/api/src/notifications/delivery.ts:1  import { getNode, insertNode } from "../graph/store.js";
✗ A003-T52 — the graph is written only by the mutation pipeline. Found:
  services/api/src/notifications/delivery.ts:1  import { getNode, insertNode } from "../graph/store.js";
  services/api/src/notifications/delivery.ts:3  export const traceWrites = insertNode;
```

The scratch file contains only an import and exported references, not a product implementation. The repository's gate and allowlists were not edited. `package.json` registers `arch:check` in `pnpm verify`.

Remote verification after `git push origin main`:

```text
git ls-remote origin refs/heads/main
c8b2adf821ee52532349a08f0409465cafa0fb48 refs/heads/main
```

## 7. Micro-decisions

None.

## 8. Findings raised

Current finding, unnumbered pending reviewer assignment (the ledger and per-finding files are reviewer-owned):

**Do item 5 names a compliance role gate absent from the code.** `services/api/src/router.ts:353` registers `hrCompliance.listSubmissionStatus` as an ordinary `protectedProcedure` with input validation and a call to `listSubmissionStatus`, with no role-specific middleware or check. `services/api/src/permission/timesheet-queries.ts:184` checks workspace equality, filters Active Employees through `filterReadable`, then uses `withinRoleScopedReach` for TimesheetEntry to select rows. It does not reject a role for lacking the compliance view. The existing `services/api/src/permission/timesheet.integration.test.ts` case `limits submission status to a Team Member's own row even when a teammate is readable` explicitly asserts that a Team Member receives their own `Not-Started` row. Do item 5 requires reusing an existing role gate rather than restating one; item 8h requires rejection for a role without the compliance view. Implementing a new role allowlist, equating row visibility with send permission, or choosing which roles lack the view would decide authorization not settled by the brief. Reviewer ruling needed on the exact reusable permission contract, without changing the compliance view's existing read contract.

### Historical evidence — closed by F313 and F314

The following were reported at original commit 8a8c9e8 before the rebase; they are history, not reopened findings:

1. **Do item 3 conflicts with A003-T52's executable gate.** It requires a new `services/api/src/notifications/` engine to load and insert graph rows. `scripts/arch-check.mjs`'s `STORE_IMPORTERS` excludes that folder; its write check allows store writes only under `services/api/src/mutations/` (apart from graph internals and tests). The named precedent, `services/api/src/mutations/revenue-gap-alert.ts`, imports the store and calls `insertNode`/`insertEdge` inside the permitted mutations folder. Moving the engine there would conflict with the stage boundary permitting only `pipeline.ts` under mutations; altering the gate or using an indirect write wrapper is not authorized. The reviewer must reconcile the engine home/write boundary with the brief and gate.
2. **The repository-wide obsolete-scope check cannot pass within the allowed documentation scope.** The Done criterion says `recipient-only-unresolvable` must no longer exist anywhere and the report checklist requires `git grep` to return nothing. It occurs in the build prompt and `docs/findings/F307.md`, both forbidden to edit. This does not dispute F307's ruled runtime scope correction; the reviewer must clarify whether the check is limited to runtime code or correct the historical-document requirement.

## 9. Deviations from this brief

Implementation and gates halted on the two pre-code contradictions above, as required. No workaround applied.

## 10. Known limitations and risks

Deliveries skipped: not measured; delivery fixtures were not built or run. Exact rules registered in this diff: none (the intended two remain `revenue-gap-alert` and `timesheet-anomaly-flag`). Files changed under `services/api/src/mutations/`: none. The remaining Do items have not been fully traced; further issues are not ruled out.

## 11. Readiness for the next stage

No. Resume Stage 25 only after a reviewer ruling reconciles these instructions; do not start another stage.

# Stage 25 — Notification and Alert Center

**Status:** BLOCKED
**Branch:** codex/stage-25-notification-center (rebased onto d698e70)
**Linear issues:** RST-52
**Date:** 2026-09-26

## 1. Summary

The previous pre-code contradictions were ruled as F313–F318, and this branch was rebased onto d698e70. Tracing the server's generic guards found that authorization runs before the guards and returns role before Notification creation or delivered_to mutation can reach requires-feature-mutation. The generic edge target also omits the endpoint IDs needed by the recipient scope, correcting the earlier static prediction that this path could permit re-addressing. No product code was written; a refusal-order ruling is required before implementation.

## 2. Done-criteria checklist

- [ ] Recipient-only reads and removal of the obsolete scope — implementation stopped; the repository-wide removal criterion also conflicts with protected historical documentation.
- [ ] Generic creation refused on server and client — not implemented.
- [ ] Recipient-only audience proven — not implemented.
- [ ] Registry validation and safe messages proven — not implemented.
- [ ] Exactly two manager rules registered — not implemented.
- [ ] Severity and concurrent delivery idempotency — not implemented.
- [ ] Missing manager/link skips without fallback — not implemented.
- [ ] Failure-isolated delivery without changing source mutation files — not implemented; F316 settles the prior signal gap.
- [ ] Own-only idempotent read-state mutations — not implemented.
- [ ] Compliance reminders derive authority from the policy table — not implemented; F315 settles the prior gap.
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

**The prescribed server requires-feature-mutation assertions conflict with authorization-before-validation.** `services/api/src/mutations/pipeline.ts:275–292` calls authorizeWrite for all plan checks and returns its denial immediately; only afterward does it call plan.validate (:298). The existing generic node and edge feature guards live inside validate, not plan construction (`mutations/foundation.ts:120,251,282,320`). For graph.createNode on a new Notification, the prescribed recipient scope must fail closed because no stored node/recipient edge exists, so authorizeWrite returns role before the Notification feature guard could run. For all three delivered_to generic edge mutations, `foundation.ts::edgeTarget` (:90–106) returns fromNodeType and toNodeType but omits fromNodeId and toNodeId even though it loads both nodes. `interceptor.ts::edgeRoleDecision` (:873–899) creates no row context when a nodeId is absent; scoped Notification Full therefore resolves to none and returns role, again before the guard. Do item 8g requires requires-feature-mutation on both server and client, so merely adding the prescribed shared set entries cannot meet the server assertion. Moving checks before authorization, changing the generic target shape or accepting role instead are not prescribed; they alter refusal ordering or the existing source/generic mutation files beyond additive registrations. Reviewer ruling needed on the intended guard location/result and allowed edits. No product code or gate changed.

**Correction to the F317 historical static trace:** the earlier report analyzed edgeRoleDecision with endpoint IDs present but had not checked the generic edgeTarget caller. Because the actual caller omits IDs, the predicted Owner/HR Admin generic re-addressing path is currently denied by role. The engine-only reservation and fail-closed recipient decision remain ruled; this correction concerns the actual generic path and its refusal reason, not a request to reopen those decisions.

### Historical evidence — closed by F318

The following missing client-guard finding was reported at f6a894f and is settled by the explicit new optimistic guards; it is not reopened:

**F317 names a client guard that does not exist.** The corrected Do item 1 says the optimistic mutators read the same FEATURE_OWNED_EDGE_TYPES set and that adding delivered_to makes all three generic edge mutations refuse it. `packages/graph/src/mutators/foundation.ts` imports FEATURE_LIFECYCLE_NODE_TYPES, but does not import FEATURE_OWNED_EDGE_TYPES. Its `createEdge` (:246) parses arguments, loads the two nodes, and writes the stamped edge; `closeEdge` (:292) loads the edge and calls closeAt; `updateEdgeMetadata` (:299) loads the edge and its nodes, then writes metadata. None checks feature ownership. `rg -n FEATURE_OWNED_EDGE_TYPES packages/graph/src` returns no matches. The server implementations in `services/api/src/mutations/foundation.ts` do check the set, but shared input parsing does not (the three definitions in packages/schema/src/mutations/foundation.ts validate generic JSON/UUID arguments only). Thus the brief's set-only change cannot satisfy its client requires-feature-mutation assertions. This does not reopen the recipient-edge protection decision: it reports an absent implementation mechanism the ruling assumed. Reviewer must authorize adding the client guards and specify whether their shared-set behavior also covers the pre-existing has_skill/requires_skill entries. No product code or gate was changed.

### Historical evidence — closed by F317

The following recipient-edge integrity finding was reported at 0f8044f and is settled by F317's reservation and fail-closed scope ruling; it is not reopened:

**The recipient-defining edge has no feature-owned mutation guard.** Do item 1 changes Recipient-only cells to Full with recipient scope and says adding Notification to FEATURE_LIFECYCLE_NODE_TYPES keeps writes closed. That set blocks generic node writes, not generic edge writes. `packages/schema/src/mutations/employee.ts::FEATURE_OWNED_EDGE_TYPES` contains only has_skill and requires_skill. `services/api/src/mutations/foundation.ts::createEdgeMutation`, `closeEdgeMutation` and `updateEdgeMetadataMutation` consult that edge set, not the node set. `delivered_to` is also absent from `interceptor.ts::RESERVED_PROJECTION_EDGE_TYPES` (only membership_of/membership_in). `edgeRoleDecision` checks Full on both endpoints; the new recipient grant supplies Full on the caller's own Notification, and User is Standard Tier 0 with Full-any for Owner/HR Admin. The projection reservation on User applies to node writes, not delivered_to edge writes, and edge writes do not run the node write-authority gate. Thus an Owner/HR Admin recipient could add an outgoing delivered_to edge to another User through graph.createEdge. The registered pair permits it; no uniqueness constraint covers delivered_to (graph/schema.ts:131 limits single-active uniqueness to managed_by/scoped_to_entity). `outgoing` orders by effective_from nulls first then edge_id, so a caller-supplied earlier/null effective_from can become the first edge used by the prescribed recipient resolver; matching-any-edge would also widen recipients. This is a static trace of the effect of the instructed new grant, not a claimed live exploit test of implemented Stage 25 code. The required guard is not prescribed: the brief tells the builder to change neither edge registration nor any permission mechanism beyond the scope change. Reviewer must rule how delivered_to is reserved to delivery (including generic create/close/metadata paths) and how conflicting edges fail closed, rather than leaving the builder to invent a security boundary.

Entry-point trace requested by F316: `applyMutations` loops over `applyMutation` (pipeline.ts:428), so the prescribed applyMutation wrapper covers each batch item. `employee/import.ts:99` calls applyMutations, so it also has that path. Current standalone evaluator invocations outside that path are the revenueGapAlert sweep (covered by the prescribed tRPC wrapper) and direct exported engine calls used in integration tests. No current production jobs entry was found; F316 explicitly requires a future jobs caller to open the scope itself. The new wrappers have not been implemented or tested.

### Historical evidence — closed by F316

The following signal finding was reported at 10ad231 and is settled by the scoped store-write-log ruling; it is not reopened:

**Do item 3's pipeline-only hook cannot observe the real watched writes.** `pipeline.ts`'s `applied.changedRowIds` comes from the source plan's `apply()` before `afterCommit()`. `timesheet.ts:290` awaits `timesheetAnomalyEvaluate` after commit but discards its `{ flagIds }` result; its apply path returns only TimesheetEntry/TimesheetWeekSubmission IDs (`timesheet.ts:311–350`). `timesheet-anomaly.ts:275–291` creates flags in a separate `db.transaction`, not through `applyMutation`. Running the prescribed `deliverForRows(applied.changedRowIds)` afterward therefore loads entries/markers, not the newly-created TimesheetAnomalyFlag nodes. Likewise, `revenue-gap-alert.ts:231–248` creates/escalates alerts in its own transaction, invoked by Assignment afterCommit callbacks (`assignment.ts:402,652,699`) without adding alert IDs to their source apply result. The `revenueGapAlert.sweep` router (`router.ts:435`) calls `sweepRevenueGapAlerts` directly; that calls the standalone evaluator (`revenue-gap-alert-queries.ts:56`) and never enters applyMutation. The brief forbids changing these source mutation files, prescribes only the changedRowIds hook, and defers reconciliation to FDN-57 (F308). Directly calling deliverForRows in tests with fabricated or manually obtained alert IDs would not prove production event delivery. Reviewer ruling needed on the exact generic signal/seam that exposes standalone engine writes without violating G03. No source code or gate was changed.

### Historical evidence — closed by F315

The following missing-gate finding was reported at 8b63851 and is settled by the policy-cell-derived authorization ruling; it is not reopened:

**Do item 5 names a compliance role gate absent from the code.** `services/api/src/router.ts:353` registers `hrCompliance.listSubmissionStatus` as an ordinary `protectedProcedure` with input validation and a call to `listSubmissionStatus`, with no role-specific middleware or check. `services/api/src/permission/timesheet-queries.ts:184` checks workspace equality, filters Active Employees through `filterReadable`, then uses `withinRoleScopedReach` for TimesheetEntry to select rows. It does not reject a role for lacking the compliance view. The existing `services/api/src/permission/timesheet.integration.test.ts` case `limits submission status to a Team Member's own row even when a teammate is readable` explicitly asserts that a Team Member receives their own `Not-Started` row. Do item 5 requires reusing an existing role gate rather than restating one; item 8h requires rejection for a role without the compliance view. Implementing a new role allowlist, equating row visibility with send permission, or choosing which roles lack the view would decide authorization not settled by the brief. Reviewer ruling needed on the exact reusable permission contract, without changing the compliance view's existing read contract.

### Historical evidence — closed by F313 and F314

The following were reported at original commit 8a8c9e8 before the rebase; they are history, not reopened findings:

1. **Do item 3 conflicts with A003-T52's executable gate.** It requires a new `services/api/src/notifications/` engine to load and insert graph rows. `scripts/arch-check.mjs`'s `STORE_IMPORTERS` excludes that folder; its write check allows store writes only under `services/api/src/mutations/` (apart from graph internals and tests). The named precedent, `services/api/src/mutations/revenue-gap-alert.ts`, imports the store and calls `insertNode`/`insertEdge` inside the permitted mutations folder. Moving the engine there would conflict with the stage boundary permitting only `pipeline.ts` under mutations; altering the gate or using an indirect write wrapper is not authorized. The reviewer must reconcile the engine home/write boundary with the brief and gate.
2. **The repository-wide obsolete-scope check cannot pass within the allowed documentation scope.** The Done criterion says `recipient-only-unresolvable` must no longer exist anywhere and the report checklist requires `git grep` to return nothing. It occurs in the build prompt and `docs/findings/F307.md`, both forbidden to edit. This does not dispute F307's ruled runtime scope correction; the reviewer must clarify whether the check is limited to runtime code or correct the historical-document requirement.

## 9. Deviations from this brief

Implementation and gates halted on the current pre-code server refusal-order contradiction, as required. No workaround applied.

## 10. Known limitations and risks

Deliveries skipped: not measured; delivery fixtures were not built or run. Exact rules registered in this diff: none (the intended two remain `revenue-gap-alert` and `timesheet-anomaly-flag`). Files changed under `services/api/src/mutations/`: none. The remaining Do items have not been fully traced; further issues are not ruled out.

## 11. Readiness for the next stage

No. Resume Stage 25 only after a reviewer ruling settles server refusal ordering and permitted edits; do not start another stage.

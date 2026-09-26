# Stage 25 — Notification and Alert Center

**Status:** BLOCKED
**Branch:** codex/stage-25-notification-center (rebased onto fbc7ba7; preserves partial d6a100f)
**Linear issues:** RST-52
**Date:** 2026-09-26

## 1. Summary

The Notification data layer, recipient read state, compliance reminders and local Inbox queries are built; F313–F320 remain closed. Real-path tests prove delivery through timesheet submission, assignment date changes and the tRPC sweep, and prove that disabling the write log breaks all three. The skip fixture measures one missing-manager skip and one unlinked-manager skip, with no fallback. Final verification and CI evidence are recorded below. The literal requirement that every branch CI job execute conflicts with the existing main-only publish-artifacts job; no workflow or gate was changed around it.

## 2. Done-criteria checklist

- [x] Recipient-only reads and removal of the obsolete scope — notification.integration.test.ts::delivery/privacy assertions; product-only git grep has no matches.
- [x] Generic node/edge paths closed; fail-closed recipient scope — notification.integration.test.ts::keeps read-state own-only and idempotent, and closes every generic write path; graph/mutators/notification.test.ts::refuses every generic node and edge path and aligns has_skill.
- [x] Recipient-only audience — the real materializer and decideRead are asserted for the manager, employee, another manager, HR Admin, Finance Admin and Owner; conflicting edge/field states remove all recipients.
- [x] Registry validation and safe messages — notification-rules.test.ts and notification-message.test.ts; the daily_cost template negative control fails at module registration.
- [x] Exactly two manager rules registered — revenue-gap-alert and timesheet-anomaly-flag.
- [x] Severity and concurrent idempotency — real assignment changes produce Low, Medium and High once each; repeated and concurrent logged writes dedupe, including concurrent creation of a fresh key.
- [x] Missing manager/link skips — notification.integration.test.ts::counts missing-manager and unlinked-manager skips without fallback, measured counts 1 and 1.
- [x] Failure isolation / unchanged source mutation files — injected failing delivery preserves the committed source; changed mutation files are enumerated in section 4.
- [x] Real watched creation paths and standalone sweep — three real-path integration tests; all three fail with the write log temporarily disabled, then pass when restored.
- [x] Own-only read state — recipient-only markRead/dismiss/markAllRead; idempotent fresh mutation ids; foreign/missing identical; extra field arguments and generic delete/create/re-address paths rejected.
- [x] Reminders — policy-table Full-any cell, HR/Owner accepted, Manager/Finance/Team Member denied even for self, Submitted rejected like absent, employee-only audience, one per calendar-owned week per UTC day.
- [x] Local queries — notifications.test.ts::groups, orders, counts action items only and excludes dismissed rows offline; three unread action items plus eleven unread informational items count 3; empty groups; one database parameter and no network.
- [x] No email, push, muting, apps or cache schema changes; only the five prescribed Recipient-only cells changed.
- [x] All four local gates pass: install, stack:up, verify and verify:full.
- [ ] Both CI workflows green with every job executing — publish-artifacts cannot execute on this branch under its existing condition; reviewer ruling required on the literal criterion.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| F003-G01, G04 | schema/notification.ts; policy-table.ts; API permission/interceptor.ts | notification.integration.test.ts::real-path delivery/privacy and read-state cases |
| F003-G02, G07, G08 | schema/notification-rules.ts; API mutations/notification-delivery.ts | notification-rules.test.ts; notification-message.test.ts; manager-only audience assertions |
| F003-G03 | API graph/write-log.ts, store.ts; mutations/pipeline.ts; trpc.ts | three real-path tests, write-log negative control and injected-failure test |
| F003-G05 | schema/notification-rules.ts | notification-rules.test.ts::defers muting: all shipped rules are ActionNeeded |
| F003-G06 | graph/queries/notifications.ts | notifications.test.ts::groups, orders, counts action items only and excludes dismissed rows offline |
| F309, F315 | schema/mutations/notification.ts; API mutations/notification-reminder.ts | notification.integration.test.ts::derives reminder send permission from policy and delivers once per UTC day to the employee only |
| F317–F319 | schema/mutations/employee.ts; graph/mutators/foundation.ts; interceptor.ts | server and client generic-boundary tests, field/edge conflicts |
| F320 | graph/queries/notifications.ts | notifications.test.ts; function arity 1, no user id or filter |

## 4. Files changed

Copied `git diff --stat main...HEAD` at implementation commit eb697a5 (the later evidence-only report commit does not change product files):

```text
.../Vulto_Specs/VPS-A004_Graph_Permission_Layer.md |   2 +-
 docs/Vulto_Specs/VRS-F010_Timesheet_Speed-Run.md   |   2 +-
 .../STAGE-25_Notification_and_Alert_Center.md      | 202 ++++++++
 packages/graph/src/mutators/foundation.ts          |  79 +++
 packages/graph/src/mutators/notification.test.ts   | 161 ++++++
 packages/graph/src/queries/index.ts                |   1 +
 packages/graph/src/queries/notifications.test.ts   |  63 +++
 packages/graph/src/queries/notifications.ts        |  41 ++
 packages/schema/src/index.ts                       |   2 +
 packages/schema/src/mutations/employee.ts          |   2 +
 packages/schema/src/mutations/foundation.ts        |   2 +
 packages/schema/src/mutations/index.ts             |   1 +
 packages/schema/src/mutations/mutations.test.ts    |   4 +
 packages/schema/src/mutations/notification.ts      |  37 ++
 packages/schema/src/notification-rules.test.ts     |  45 ++
 packages/schema/src/notification-rules.ts          |  85 ++++
 packages/schema/src/notification.ts                |  30 ++
 packages/schema/src/policy/policy-table.test.ts    |   6 +-
 packages/schema/src/policy/policy-table.ts         |  19 +-
 packages/schema/src/policy/principal-policy.ts     |   8 +
 packages/schema/src/search.ts                      |  23 +-
 services/api/src/graph/store.ts                    |  20 +-
 services/api/src/graph/write-log.test.ts           |  33 ++
 services/api/src/graph/write-log.ts                |  18 +
 .../api/src/mutations/notification-delivery.ts     | 279 +++++++++++
 .../api/src/mutations/notification-reminder.ts     |  87 ++++
 services/api/src/mutations/notification.ts         | 102 ++++
 services/api/src/mutations/pipeline.ts             |  24 +
 services/api/src/permission/interceptor.ts         |  15 +
 .../src/permission/notification-message.test.ts    |  27 +
 .../permission/notification.integration.test.ts    | 548 +++++++++++++++++++++
 services/api/src/trpc.ts                           |  14 +-
 32 files changed, 1954 insertions(+), 28 deletions(-)
```

Files under services/api/src/mutations/: pipeline.ts (wrapper, dependency seam and additive registration); new notification-delivery.ts, notification.ts and notification-reminder.ts. No existing source feature's mutation file changed. Search tests, skill-matrix.test.ts, the audience materializer, cache schema/version, workflows, gates, dependencies and apps/ are unchanged.

## 5. Database changes

None.

## 6. Tests and gates

The exact four-gate sequence passed on the final implementation, including calendar-owned reminder week identity and conflicting-state audience assertions. Exit codes are 0 for all four commands. The following are copied final lines (unit suite counts are also copied):

```text
pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 636ms using pnpm v9.15.9

pnpm stack:up
Container vulto-redis-1 Healthy
Container vulto-electric-1 Healthy
Container vulto-postgres-1 Healthy

pnpm verify
@vulto/schema:test:  Test Files  18 passed (18)
@vulto/schema:test:       Tests  116 passed | 2 todo (118)
@vulto/graph:test:  Test Files  16 passed (16)
@vulto/graph:test:       Tests  102 passed (102)
 Tasks:    10 successful, 10 total
```

After the equivalent single-notification lookup was simplified to query only its addressed row through decideRead, verify and verify:full were run again, both exit 0. The full gate is `pnpm verify:full`, not a selected test or browser suite. Copied final output:

```text
pnpm verify:full
 Test Files  28 passed (28)
      Tests  329 passed | 2 skipped (331)
   Start at  19:33:49
   Duration  78.55s
```

Observed-reason diagnostic (not a gate): pnpm --filter @vulto/api exec vitest run src/permission/notification.integration.test.ts -t 'keeps read-state' --reporter=verbose --disableConsoleIntercept — exit 0, 1 passed, 6 unselected. Its direct output:

```text
Notification generic refusal graph.createNode: role
Notification generic refusal graph.createEdge: role
Notification generic refusal graph.closeEdge: role
Notification generic refusal graph.updateEdgeMetadata: role
```

Environment diagnostics: the first sandboxed integration run failed with connect EPERM on localhost; rerunning with authorized local database access passed. The first verify attempt failed only on untracked Claude outputs/stage19_resume_after_f279_281.md formatting; the untracked folder was temporarily moved outside the checkout, untouched, and restored automatically after every gate run. No tracked gate, allowlist, test configuration or dependency was weakened. A new policy assertion mistakenly expected sourceText in resolvePolicyCell's return; it was corrected to the actual public result, while the existing literal-matrix fidelity test stays unchanged. The explicit named-mutation list gained only the four new names. The reminder uses the existing Tier 0 offline declaration, with no optimistic Notification creation.

Negative controls, temporary and fully reverted:

- Disabling recordWrite's Set insertion: pnpm --filter @vulto/api exec vitest run src/permission/notification.integration.test.ts -t 'real assignment|through submitWeek|standalone revenueGapAlert' — exit 1, 3 failed, 4 unselected. The assignment and sweep cases found 0 notifications instead of 1; the timesheet case found 0 instead of >0. All seven recordWrite calls remain in the final store diff.
- Changing the shipped revenue template to {source.daily_cost}: pnpm --filter @vulto/schema exec vitest run src/notification-rules.test.ts — exit 1, module registration fails with "Undeclared notification template field: source.daily_cost". Restored template: same command exit 0, 5 passed.

CI at implementation commit eb697a50af26a4748db32e82b7dc504b1fcdfbd5:

- fast-lane [36249193805](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36249193805): success; resolve-image and verify executed successfully.
- slow-lane [36249193785](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36249193785): success; resolve-image, api-integration, production-build, auth-browser and sync-browser executed successfully. publish-artifacts was skipped by its existing main-only condition.

The optional local sync-browser command was not run; its full CI job passed. The subsequent report-only head's run ids and conclusions are recorded in RST-52 and the handoff, separately from these implementation-commit results. The skipped publisher is not described as executed or silently exempted.

The report-only d72f25b rerun exposed test-clock drift: fast-lane 36249461782 succeeded, while slow-lane 36249461764 failed only in notification.integration.test.ts::covers the standalone revenueGapAlert.sweep through the actual tRPC caller: `Error: Test timed out in 5000ms.` (328 passed, 1 failed, 2 existing skips). All other jobs, including sync-browser, succeeded; publication was skipped. The January fixture called the real sweep with today's default date, expanding the calendar-owned employment scan as wall-clock time advanced. The new test now fakes Date only at January 23, restores it in finally, and still calls the real tRPC sweep with identical assertions and the unchanged 5-second timeout. Its complete seven-test file passed in 5.41 seconds (4.46 seconds total test execution). No product code, gate or retry changed for this correction. Final-head CI conclusions are recorded in RST-52 and the handoff.

Observed server generic refusals in the real test: graph.createNode(Notification), graph.createEdge(delivered_to), graph.closeEdge(delivered_to) and graph.updateEdgeMetadata(delivered_to) each return role. The recipient's generic updateNodeFields, softDeleteNode and transitionLifecycle each return exactly requires-feature-mutation with the row unchanged. All client generic paths and has_skill checks return exactly requires-feature-mutation. No pre-existing client acceptance assertion needed changing.

The following gate evidence is historical (F313), not a current failure:

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

- Templates use qualified {subject.full_name}/{source.bench_days} placeholders, validated against declared fields only.
- The device query returns local node envelopes with their Tier 0 record; equal created_at values tie-break by node id. Grouping uses local calendar-day components, not working-day arithmetic.
- Reminder dedupe/message uses the existing graph/timesheet-week.ts::weekStartForEmployee answer, the same calendar-owned identity the compliance query and submitWeek use. Two request dates in the same employee week cannot create two keys.
- Reminders create no optimistic Notification; sender-role checks use the policy table, and eligibility/delivery remain server-authoritative when the request arrives.
- Read-state mutations alter only read_at/dismissed_at, preserving the first non-null timestamps on sequential replay; no lifecycle transition or user-facing Notification producer was added.
- No filter, user-id argument, authorization-order change or edgeTarget change was introduced.

## 8. Findings raised

Current finding, unnumbered pending reviewer assignment (the ledger and per-finding files are reviewer-owned):

**The literal every-job branch CI criterion conflicts with the existing main-only publication job.** Stage 25's Done criteria and Gates require both workflows at the branch head to be green "with every job executing". .github/workflows/slow-lane.yml:312–319 defines publish-artifacts with `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`; a push to codex/stage-25-notification-center cannot execute it. The workflow's own header explicitly names this one conditional job. The stage forbids workflow/gate changes, and it does not authorize merging to main. All permitted product implementation was completed and tested rather than stopping at this static conflict; actual branch job conclusions are recorded above when available. Requested ruling: exempt only the existing main-only publisher from the branch criterion, while requiring resolve-image, verify, api-integration, production-build, auth-browser and sync-browser to execute successfully, or specify a separately authorized publication proof. No workaround, merge, disabled job or workflow edit was made. No other unresolved contradiction was established in the completed build.

### Historical evidence — closed by F320

The following filter finding was reported with partial implementation at d6a100f; F320 removes the parameter, and it is not reopened:

**Do item 7 names an undefined optional filter contract.** `docs/Claude_Code_Build_Prompt.md:372` requires `notificationListForUser(database, filter?)`, but defines only the unfiltered grouping and ordering, not the argument's type, permitted fields/values, or effect on the three groups. The complete `VPS-F003_Notification_and_Alert_Center.md` mentions filtering only in its API signature at :182 (`notification.listForUser(userId, filter?) -> Notification[]`); G04 at :202 prohibits returning another user's rows, but does not define a filter. `rg -n 'notificationListForUser|notificationList.*Filter|NotificationFilter|notification\.listForUser' packages services apps` returns no matches. Thus there is no existing contract to reuse. Choosing category, read-state, source-type, text, group selection, or ignoring the argument would invent externally visible behavior. Requested ruling: either define the filter type and semantics (including whether the unread count stays independent), or explicitly defer/remove the optional filter for this stage. No notifications.ts/query tests were written around the gap. All other previously ruled findings remain closed; no additional contradiction was established in this build segment.

### Historical evidence — closed by F319

The following authorization-order finding was reported at 33804c3 and is settled by the current Do item 8(g); it is not reopened:

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

The literal every-job CI criterion cannot be fulfilled on a branch because publish-artifacts is main-only (section 8). It is not silently waived. No workflow, source mutation, gate or reviewer-owned document was changed around the conflict. F320's corrected no-filter signature is implemented exactly.

## 10. Known limitations and risks

Measured skip fixture: 2 total, exactly 1 missing manager and 1 unlinked manager; delivered 0 and no fallback. Exact event rules: revenue-gap-alert (RevenueGapAlert, ActionNeeded, employee-manager, severity discriminator; Active only) and timesheet-anomaly-flag (TimesheetAnomalyFlag, ActionNeeded, employee-manager, no discriminator). timesheet-reminder is a manual producer, not an event rule. Email, push, muting, Inbox UI and scheduler/reconciliation remain deferred by the brief; a crash after source commit and before delivery drain is not repaired here. The API's two optional existing skipped tests are not newly skipped by this diff.

## 11. Readiness for the next stage

No. The implementation is ready for review once the reviewer rules the main-only publication exception and the final verification evidence is green. Preserve this branch and the historical evidence; no further stage is started.

# Stage 18 — Timesheet Speed-Run

**Status:** BLOCKED
**Branch:** `codex/stage-18-timesheet-speed-run` @ `3cda786` (F270–F273 infrastructure committed; report amendment follows)
**Linear issues:** RST-46
**Date:** 2026-09-24

## 1. Summary

The F267 Pitch edge declaration and F268/F269 subject-resolution correction are committed. F270–F273 are ruled and merged from `main`; the F273 marker registration, F270/F271 system grants, F272 reserved-identity helper, and timesheet schemas are committed at `3cda786`. Before building the feature mutations, tracing the first Team Member `saveCell` and zero-entry marker create exposed F274: their row-scoped `Full (own)` authorization reads the subject from a stored row, but the pipeline authorizes before either new row exists. Implementation stopped for a reviewer ruling; no app code or protected documentation was directly edited.

## 2. Done-criteria checklist

- [ ] `logged_against` declares `Pitch: "identifying"` — the declaration is committed in `packages/schema/src/registry/edges.ts`; the required real-interceptor Pitch save test awaits the blocked mutation path.
- [ ] The F268/F269 row-scope branches are proven against the real interceptor — code committed in `2cd5b03`, extended for the week marker in `3cda786`, but creation tests await F274.
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
| F268/F269 row-scope resolution | `services/api/src/permission/interceptor.ts` | Not yet: real flag-creation test depends on the unbuilt mutation |
| F270/F271 system authority | `packages/schema/src/policy/principal-policy.ts`, `services/api/src/permission/interceptor.ts` | Schema/API typecheck only; end-to-end flag tests await the mutation |
| F272 reserved identity | `services/api/src/graph/system-actor.ts` | API typecheck only; first system write awaits the mutation |
| F273 marker registration | `packages/schema/src/registry/nodes.ts`, `packages/schema/src/policy/policy-table.ts`, `packages/schema/src/timesheet.ts` | Registry suite 24/24; schema suite 95 passed, 2 todo |

## 4. Files changed

Relative to current `main`: F267's edge registry; F268/F269 and F270/F271's interceptor; F270/F272's policy tables; F272's reserved identity helper; F273's node registry, policy row, schemas, registry-count checks; and this report. The F270–F273 ruling documents were merged from `main`, not edited here.

## 5. Database changes

None.

## 6. Tests and gates

The four required gates were not run: `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, and `pnpm verify:full`. Stage 18 cannot be COMPLETE until F274 is ruled and implementation resumes. Narrow checks on `3cda786` passed: schema tests 95 passed/2 todo (including registry 24/24), schema and API typechecks, and `git diff --check`. Mutation and query handlers have not been built; the four full gates would therefore not be meaningful yet.

## 7. Micro-decisions

None.

## 8. Findings raised

### F269 — F268's direct-field row scope cannot resolve a Tier 2 TimesheetAnomalyFlag

**Status: closed on `main` at `26f3b83`.** The reviewer ruled that TimesheetEntry uses its Tier 0 direct `employee_id` field and TimesheetAnomalyFlag uses its already-registered `triggered_by` edge, extending the existing BurnoutAlert branch. The correction is implemented in `services/api/src/permission/interceptor.ts`; the reviewer-authoritative ruling and spec/brief updates were merged, not edited on this branch.

### F270 — post-submit anomaly evaluation has no authorized writer for Tier 2 flags

**Status: closed on `main` at `6f4b80a`.** The Stage 18 brief requires `timesheetAnomaly.evaluate` to run immediately after every successful `timesheet.submitWeek`, as a separate named-mutation transaction, and create or update a Tier 2 TimesheetAnomalyFlag plus `triggered_by` edge. A Team Member is explicitly allowed to submit their own TimesheetEntry (`packages/schema/src/policy/policy-table.ts`: `TimesheetEntry` `Full (own only)`) but has `NONE` for TimesheetAnomalyFlag. `services/api/src/mutations/pipeline.ts` accepts only `MemberPrincipal` and passes that principal to every named mutation's `authorizeWrite` checks. If the post-submit evaluator uses the submitter, the interceptor refuses flag creation with `role`; bypassing that check would violate the server-authoritative write gate.

At the time F270 was raised, the existing system-principal path did not supply the missing authority either: `services/api/src/permission/interceptor.ts` gave system principals no node grant, and `packages/schema/src/policy/principal-policy.ts` listed only audit pseudonymization, key destruction and audience recompute as system operations. There was no anomaly-evaluation operation or named principal, and the pipeline could not accept one as written. The brief specified neither a permitted system write nor a delegation mechanism. The builder did not invent or impersonate an HR Admin principal, add an unreviewed system grant, or silently write the flag outside the named-mutation path.

The founder ruled a distinct `authorizeWrite` Gate 1 path for a new `timesheet-anomaly-evaluate` system principal, limited to `timesheet-anomaly.create-flag`. This ruling is authoritative in `docs/Foundations_Findings.md` and the revised Stage 18 brief, both merged from `main`; the policy and interceptor path are now committed at `3cda786`, while the evaluator itself awaits F274.

### F271 — anomaly evaluation has no authorized read of prior Tier 2 flags

**Status: closed on `main` at `50dca6a`.** `VRS-F010` G09 requires at most one Active uncleared flag per employee, week and reason, with a repeat trigger updating `detail`. G09b and the Stage 18 done criteria require an `ApprovedOvertime`-cleared HoursExceedExpected flag never to reappear on later evaluation. Both behaviors require inspecting prior flags' `employee_id`, `week_start_date`, `flag_reason`, `cleared_at`, and `clearance_outcome` before a create/update decision. `TimesheetAnomalyFlag` is Tier 2 (`packages/schema/src/registry/nodes.ts`); `services/api/src/graph/store.ts` stores its feature fields in encrypted `graph_protected_fragments`, not the plain `graph_nodes.record`. Its `triggered_by` edge identifies the Employee but reveals none of the week, reason, or clearance data.

The only established decrypt path is `services/api/src/protected/read.ts`'s audited `readProtected`: it calls `authorizeRead` before decrypting. At the time F271 was raised, `services/api/src/permission/interceptor.ts` gave system principals no policy roles for reads, so `readProtected` released no flag content to F270's new `timesheet-anomaly-evaluate` principal. The submitting Team Member has `NONE` on TimesheetAnomalyFlag in `packages/schema/src/policy/policy-table.ts`; using that member to read prior flags fails too. The reviewer ruled a second closed-table operation, `timesheet-anomaly.read-flags`, and the read-side counterpart in `decideRead`. This policy/interceptor path is committed at `3cda786`; the evaluator must use `readProtected` under that same system principal once built.

### F272 — system-authored graph records require a User UUID for provenance

**Status: closed on `main` at `e4c796a`.** F270 requires `timesheetAnomaly.evaluate` to create or update a Tier 2 TimesheetAnomalyFlag and its `triggered_by` edge under `{ kind: "system", name: "timesheet-anomaly-evaluate", workspaceId }`, not the submitting Team Member's principal. Yet `VPS-A002`'s universal node and edge conventions make `created_by` and `updated_by` (node), and `created_by` (edge), required `user_id UUID` fields, with exceptions explicitly closed to only AuditEntry and the two anonymous contribution types. `packages/schema/src/records.ts` enforces UUID v4 in the standard shapes; `stampNewNode`/`stampNewEdge` take a `Provenance.userId`; `services/api/src/permission/principal.ts`'s `SystemPrincipal` has only `name` and `workspaceId`, no User UUID. `graph_mutations.actor_user_id` and `writeProtected`'s actor parameter can be null, so neither resolves the universal graph-record requirement.

The founder ruled one lazily provisioned, deterministic, reserved `User` identity per system principal and workspace, with no membership or Employee link, plus a closed human display-name table. Its UUID self-attributes its own universal fields and supplies the flag/edge provenance; the label for this principal is “Automatic Review.” This was merged from `main`, not edited on this branch. The helper and table are committed at `3cda786`; integration proof awaits the first system write.

### F273 — empty-week submission has no persisted state for later reads

**Status: closed on `main` at `f0e2624`.** The Stage 18 brief's Do item 5 explicitly says `timesheet.submitWeek` must not error on zero Draft entries because an empty week can still be submitted. Its own API contract requires `timesheet.getWeek` to return `weekStatus: Draft | Submitted`; `hrCompliance.listSubmissionStatus` must distinguish Draft, Submitted, and Not-Started for each employee/week. The only specified persisted submission fields were `TimesheetEntry.lifecycle_status` and `submitted_at`, both per-entry. On a zero-entry week, the single-transaction transition changed no rows, so a subsequent query saw exactly the same graph state as before submission. `graph_mutations`'s `args_sha256` is a hash, not queryable employee/week fields; a client-supplied `mutation_id` is not a deterministic week key.

The reviewer ruled a registered Tier 0 `TimesheetWeekSubmission` marker on `PolicyAcknowledgment`'s precedent, only for zero-entry submissions, soft-deleted on unlock. The registry, schema, policy row, and row-scope extension are committed at `3cda786`; mutation and query paths await F274.

### F274 — row-scoped own grant cannot authorize the creation of its own row

**Status: open; reviewer ruling required.** `TimesheetEntry` gives a Team Member `Full (own)` and F273 gives `TimesheetWeekSubmission` the identical cell. `services/api/src/mutations/pipeline.ts` calls `authorizeWrite` on every planned check before `apply()` inserts anything. In `services/api/src/permission/interceptor.ts`, `authorizeWrite` Gate 1 passes the new target's `nodeId` into `bestCell`/`rowScopeSatisfied`; for both node types the F268/F273 branch reads `employee_id` by `getNode(tx, workspaceId, nodeId)`. On a create, no row exists yet, so `getNode` returns null and row scope returns false. Passing `nodeId: null` also fails at `rowScopeSatisfied`'s entry guard. Therefore a Team Member cannot save their first cell or submit an empty week under their own grant, even though both operations are explicitly required and their policy rows are deliberately own-scoped. Owner/HR Admin's unscoped Full masks this in privileged tests but does not fix the normal path.

`WriteChange.subjectEmployeeId` currently reaches only Gate 3's reader-set check; Gate 1 does not use it. A reviewer must rule how a creation check securely conveys the proposed row's `employee_id` to the interceptor without trusting an arbitrary claimed subject or moving authorization after insertion. The F268 direct-field resolution still correctly governs reads and updates of stored rows; this is the new-row half of the same mechanism. No feature-local permission check, privileged-principal substitution, or authorize-after-write workaround was added.

## 9. Deviations from this brief

None implemented beyond the ruled F270–F273 infrastructure. The incomplete stage is blocked by F274 rather than worked around.

## 10. Known limitations and risks

The F267 registry declaration, F268/F269 interceptor change, and F270–F273 infrastructure are committed but have not yet reached real mutation tests. No TimesheetEntry or TimesheetAnomalyFlag creation path exists on this branch.

## 11. Readiness for the next stage

No. Stage 18 must resume after the reviewer rules F274; Stage 19 is not started.

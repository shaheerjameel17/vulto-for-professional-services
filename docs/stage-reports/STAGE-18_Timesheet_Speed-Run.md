# Stage 18 — Timesheet Speed-Run

**Status:** COMPLETE — awaiting founder review
**Branch:** `codex/stage-18-timesheet-speed-run` (merged `main` through F276 at `36f3b80`)
**Linear issues:** RST-46
**Date:** 2026-09-24

## 1. Summary

The F276 ruling is merged and Stage 18's server-side feature is implemented. `WorkingCalendar.week_start_day` fixes the week boundary independently of worked-day, pattern and holiday state. Cells, empty and nonempty submissions, unlocks, weekly and compliance reads, day shortcuts, and the protected anomaly-review flow now run through named server paths. The prior pauses, F267–F276, were all ruled before this completion; this resume raised no new finding. No file under `apps/` or protected specification/brief/finding documentation was edited on this branch.

Sections 2–11 below preserve the report as it stood at the F276 pause, including its then-open finding and unchecked criteria. The completion addendum at the end is the authoritative final status.

## 2. Done-criteria checklist

- [ ] `logged_against` declares `Pitch: "identifying"` and `readSufficientEndpoints: { Assignment: true }`; interceptor-level Assignment and Pitch endpoint tests pass, but the required `saveCell` end-to-end test awaits F276's week-key ruling and mutation implementation.
- [ ] The F268/F269 row-scope branches are proven against the real interceptor — code committed in `2cd5b03`, extended for the week marker in `3cda786` and the F274 create case in this resume, but creation tests await the mutation path.
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
| F274 create-time subject mechanism | `services/api/src/permission/interceptor.ts`, `services/api/src/mutations/pipeline.ts` | API typecheck only; plan-builder declarations and deliberate-mismatch rollback test are not yet built |
| F275 endpoint authority | `packages/schema/src/registry/edges.ts`, `packages/schema/src/registry/participant-grants.ts`, `services/api/src/permission/interceptor.ts` | `pitch.integration.test.ts`: ordinary Team Member Assignment edge write succeeds; Pitch edge write denied, allowed after staffing, denied after unstaffing, allowed after restaffing; generic Pitch read remains denied |

## 4. Files changed

Relative to current `main`: F267/F275 edge registry; F275 participant-grant registry and focused integration test; F268/F269, F270/F271, partial F274 and F275 interceptor work; F274 pipeline re-check; F270/F272 policy tables; F272 reserved identity helper; F273 node registry, policy row, schemas and registry-count checks; and this report. F270–F275 ruling documents were merged from `main`, not edited here.

## 5. Database changes

None.

## 6. Tests and gates

The four required gates were not run: `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, and `pnpm verify:full`. Stage 18 cannot be COMPLETE until F276 is ruled and implementation resumes. Narrow checks on `3cda786` passed: schema tests 95 passed/2 todo (including registry 24/24), schema and API typechecks, and `git diff --check`. This resume passed schema and API typechecks, `git diff --check`, and the real-PostgreSQL `pitch.integration.test.ts` (5/5). Mutation and query handlers have not been built; the four full gates would therefore not be meaningful yet.

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

**Status: closed on `main` at `eddbb96`; mechanism partially implemented.** `TimesheetEntry` gives a Team Member `Full (own)` and F273 gives `TimesheetWeekSubmission` the identical cell. `services/api/src/mutations/pipeline.ts` calls `authorizeWrite` on every planned check before `apply()` inserts anything. In `services/api/src/permission/interceptor.ts`, `authorizeWrite` Gate 1 passes the new target's `nodeId` into `bestCell`/`rowScopeSatisfied`; for both node types the F268/F273 branch reads `employee_id` by `getNode(tx, workspaceId, nodeId)`. On a create, no row exists yet, so `getNode` returns null and row scope returns false. Passing `nodeId: null` also fails at `rowScopeSatisfied`'s entry guard. Therefore a Team Member cannot save their first cell or submit an empty week under their own grant, even though both operations are explicitly required and their policy rows are deliberately own-scoped. Owner/HR Admin's unscoped Full masks this in privileged tests but does not fix the normal path.

The founder ruled a new `WriteChange.declaredSubjectEmployeeId`, set from parsed mutation args, used only for the create-time Gate 1 row scope on TimesheetEntry and TimesheetWeekSubmission. The pipeline independently re-reads each declared create's stored subject after `apply()` and rejects a mismatch with `subject-mismatch` inside the transaction. The shared stored-row resolver, create-time branch and pipeline re-check are implemented and typechecked. The `saveCell`/empty-week plan-builders that supply the declaration and the deliberate-mismatch rollback test remain unbuilt because F275 stops the required edge-write path.

### F275 — `logged_against` endpoint authority denies ordinary Team Member cells

**Status: closed on `main` at `93c8cf1`; implemented and tested.** The Stage 18 brief requires an ordinary Team Member to save their own Billable and Pitch cells. Both write a `logged_against` edge, from the newly created or updated TimesheetEntry to Assignment or Pitch. F274 resolves the TimesheetEntry endpoint's `Full (own)` check at create time, but `services/api/src/permission/interceptor.ts`'s `edgeRoleDecision` requires `Full` on *both* endpoints unless an endpoint is registered as `readSufficientEndpoints`. The `logged_against` registration in `packages/schema/src/registry/edges.ts` had no such declaration. `packages/schema/src/policy/policy-table.ts` gives Team Member only `READ_ANY()` on Assignment and `NONE_ANY()` on `Pitch:identifying`; the Pitch pair is explicitly governed by that partition (F267). Thus Billable was refused at Assignment, and Pitch at Pitch. NonBillable writes no edge and does not exercise this gap. Owner/HR Admin tests would mask it.

The reviewer ruled `readSufficientEndpoints: { Assignment: true }` on `logged_against`, matching F262's `assigned_to` precedent, plus a closed `PARTICIPANT_GRANTS` registry for Pitch's staffed-Employee relationship. `participantGrantSatisfied` is wired only into `edgeRoleDecision`, as an independent active-edge path; no generic Pitch read or Team Member role cell changed. The focused real-interceptor test proves Assignment read-sufficiency, Pitch denial before staffing, grant while staffed, denial after `pitch.unstaffEmployee`, and grant after restaffing.

### F276 — week-start key is not derivable for every permitted working-week shape

**Status: open; reviewer ruling required.** `VRS-F010` G05 and the Stage 18 brief require every `TimesheetEntry.week_start_date` to be the employee's “first working day of the week,” including Sunday-to-Thursday workspaces. `timesheet.saveCell(employeeId, date, rowContext, hours, category?)` supplies a date but no week key, so the server must derive the key before storing the entry; `submitWeek`, `getWeek`, compliance, and the empty-week marker subsequently group by it. `VRS-F004`'s seven-row `working_week` and `packages/schema/src/mutations/calendar.ts`'s `workingWeekSchema` accept any seven booleans, including seven working days or multiple separated working blocks. Neither that schema nor the corrected Stage 18 brief nor `VRS-F010` defines which day begins a week in those cases. The code has no `week_start_day` or equivalent field/helper. A seven-working-day pattern has no rest break from which to identify a first day. A split pattern (for example Sunday, Monday, Wednesday and Friday) has multiple “first working day after a rest day” candidates. Moreover, `resolveWorkingDay` includes holidays: if Sunday is a holiday in a Sunday-to-Thursday workspace, the text does not say whether that week's key shifts to Monday or remains Sunday. Shifting a key per holiday would change which entries `submitWeek` locks and which marker a later query finds.

A deterministic rest-gap rule with a tie/fallback, a configured week anchor, or an invariant restricting supported schedules are materially different domain choices; none is prescribed. The builder did not choose a hidden Monday default or a longest-gap heuristic. The reviewer should define a stable week-boundary rule and its behavior under patterns/holidays (and when schedule configuration changes), then correct the owning spec and brief. The incomplete `timesheet` mutation-schema draft was removed; no mutation handler was registered or left as a stub.

## 9. Deviations from this brief

No unruled change was implemented. F274's ruled mechanism remains partial; F275 is implemented; the incomplete stage is blocked by F276 rather than worked around.

## 10. Known limitations and risks

The F267 registry declaration, F268/F269 interceptor change, F270–F273 infrastructure, and partial F274 mechanism have not yet reached real mutation tests. F275's endpoint authority has a real interceptor/database test, but no TimesheetEntry or TimesheetAnomalyFlag creation path exists on this branch. F276 prevents a trustworthy week key for the required mutation path.

## 11. Readiness for the next stage

No. Stage 18 must resume after the reviewer rules F276; Stage 19 is not started.

## Completion addendum — 24 September 2026 (supersedes sections 2–11 above)

**Finding status.** F276 was ruled and merged from `main` at `36f3b80`, then implemented. F267–F276 are all closed; no new build-time finding was raised on this resume. The earlier F276 text is retained as the historical evidence of the pause, not an open request.

### Final done-criteria checklist

- [x] `logged_against` has F267's `Pitch: "identifying"` and F275's `readSufficientEndpoints: { Assignment: true }`. An ordinary Team Member's Billable save works; Pitch saves follow live staffing, unstaffing and restaffing.
- [x] F268/F269/F274 row scope: own TimesheetEntry read/write succeeds; an unrelated Team Member cannot read it; create checks declare the parsed `employee_id`; a deliberately mismatched stored subject rejects `subject-mismatch` and rolls back.
- [x] A 25-hour date is rejected before storage, naming the date and total. The optimistic mutator raises `GraphValidationError`.
- [x] `submitWeek` moves all Draft rows in one transaction. A PostgreSQL constraint injected on the second row leaves both Draft, proving rollback.
- [x] `getWeek` and `fd`/`hd` use F004's `resolveWorkingDay` path. Six-day PK Saturday, compressed four-day pattern and workspace half-day are tested; no `contracted_hours / weekday-count` arithmetic is used.
- [x] F276's week anchor is carried by `initialWorkingWeekFor`, `calendarUpdate.apply()` and optimistic `entity.create`. Seven-day work, a split `WorkingPattern`, a holiday on the anchor, and Sunday- and Monday-start entities in one workspace are tested against PostgreSQL. The pure `resolveWeekStartDate` reads only date and `weekStartDay`; saved entry keys are not recomputed on later reads or edits.
- [x] The three anomaly detectors are pure and tested independently. `HoursExceedExpected` takes F004-derived expected weekly hours as a parameter (default threshold 1.3); 34 logged against 32 expected is not flagged, and any Pitch entry excludes the week.
- [x] `timesheetAnomaly.evaluate` runs after the submission transaction commits, under the closed system read/write grants. Prior Tier 2 flags are read through audited `readProtected`; new flags and `triggered_by` edges are written in one transaction with the reserved, reusable “Automatic Review” User UUID as provenance. That User has no `membership_of` edge and is not the submitter.
- [x] A cleared `ApprovedOvertime` flag is not re-raised on a real second evaluation. `timesheetAnomaly.clear` does not call F018 or compute TOIL. An injected post-commit evaluation failure does not fail or roll back the submission.
- [x] `timesheetAnomaly.listActive` uses `filterReadable`: a Manager sees/clears direct-report flags, cannot see/clear a non-report's flag, and the flagged Team Member gets neither list nor protected content.
- [x] A zero-entry week creates exactly one `TimesheetWeekSubmission` marker, reads Submitted, and returns to Not-Started after unlock soft-deletes it. A nonempty week creates no marker.
- [x] `hrCompliance.sendReminder`, `overtime.approve` and files under `apps/` are absent from this branch's code diff.
- [x] Real handlers and router entries exist for the new mutations and queries; none is a stub or no-op. Four gates passed.

### Final implementation and tests

The F276 calendar shape and pure week resolver live in `packages/schema`; the server resolves the employee's Entity and calendar version at the entry's own date in `services/api/src/graph/timesheet-week.ts`. The feature mutations and protected anomaly evaluation live in `services/api/src/mutations`; weekly, compliance, shortcut and scoped anomaly reads live in `services/api/src/permission`. The optimistic `saveCell`/`submitWeek`/`unlockWeek` paths are in `packages/graph`. The existing F267–F275 registry, policy, interceptor, pipeline and system-actor changes remain intact from prior commits.

`timesheet.integration.test.ts` has 11 real-PostgreSQL tests spanning F274/F275/F276, atomicity, zero-entry markers, protected visibility, provenance and G09b suppression. Schema has 101 passing tests (2 pre-existing todo), graph 82 passing tests, and the full API suite has 296 passing tests (2 skipped). The registry conformance gate remains green.

| Required gate | Final result |
|---|---|
| `CI=true pnpm install --frozen-lockfile` | Passed; current lockfile, dependencies up to date |
| `pnpm stack:up` | Passed; PostgreSQL, Redis and Electric healthy |
| `pnpm verify` | Passed, including lint, conformance, architecture, typecheck and fast tests |
| `pnpm verify:full` | Passed on the final tree, including database preflight and 296 API integration tests |

The first sandboxed install could not resolve npm and the first sandboxed stack call could not reach Docker; the same gates passed with the required access. `git diff --check` passed. No database migration was required: F273's marker and the new calendar field are graph record/schema changes under existing storage. One accepted F276 limitation remains: a mid-week calendar-anchor edit or Entity re-scope can split entries across two stored week keys; no cross-feature guard was added to F004.

### Final micro-decisions and readiness

`timesheet.resolveShortcut` is a thin server read over F004's existing `hoursOn`, so `fd`/`hd` cannot fork day arithmetic. Timesheet writes and week transitions use serializable transactions to protect one-cell and one-empty-marker behavior under races. Internal pipeline test seams prove the independent F274 post-write recheck and G10 post-commit failure behavior; normal routes never supply them. These are implementation choices within the corrected brief, not new policy rulings.

Stage 18 is ready for founder review. RST-46 moves to **In Review**; no Stage 19 work starts here.

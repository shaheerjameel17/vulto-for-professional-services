# Stage 16 — Capacity Conflict Resolution (`VRS-F008`)

- **Status:** COMPLETE, awaiting review.
- **Branch:** `codex/stage-16-capacity-conflict-resolution`
- **Linear:** RST-44
- **Date:** 24 September 2026

## 1. Summary

Capacity conflicts now have one authoritative, working-day-aware server calculation and a matching advisory calculation over the device cache. Ordinary Assignment creation and update still reject work above 100%; the new `conflictResolution.overrideAndProceed` mutation is the sole deliberate bypass, restricted to the employee's actual manager or a workspace Owner and recording who overrode the limit, when, and why on the Assignment itself.

The local query reports conflicts, warnings, suggested fit, overlap days, and editable assignments without a network call. The server also exposes a read-only overcommitment sweep for future job scheduling. F255–F262 are incorporated as ruled, including local role resolution from the replicated membership graph and endpoint-aware edge authorization that lets a genuine direct manager create the mandatory Assignment edges without widening Project or unrelated Employee write access. No application file changed.

## 2. Done-criteria checklist

- [x] `near_capacity_warning_threshold` defaults to 90 on every newly founded Workspace and is read through the shared `readNearCapacityThreshold` helper.
- [x] Server capacity aggregation calls `resolvedDayOn` and excludes non-working dates. Weekend-only and holiday-only overlap tests prove the behavioral difference from calendar-day summation.
- [x] `Assignment.manager` resolves to `full`, matching `VPS-A004`; no other Assignment policy cell changed.
- [x] Local `conflictCheck.evaluate` reads only the SQLite cache, uses the shared pure `resolveWorkingDay`, and returns mutually exclusive conflict and warning states around the 90% and 100% boundaries.
- [x] Local and server implementations produce the same working-day list and total from equivalent facts, while remaining independent implementations for their respective runtimes.
- [x] The local query completes with the network cut and performs no server call.
- [x] Caller roles are derived from the caller's replicated `WorkspaceMembership` through `membership_of` and `parseWorkspaceRoles`; no role field was added to `InitPayload`, `GraphClientOptions`, or `MutatorContext`.
- [x] `overrideAndProceed` checks the Manager/Owner gate server-side before any write and reuses `buildAssignmentCreatePlan`, the same complete node-and-edge construction path as `assignment.create`.
- [x] Ordinary `assignment.create` and `assignment.update` still reject a combined allocation above 100%, while an authorized override with the same capacity succeeds.
- [x] A successful override writes `capacity_override_reason`, `capacity_override_by`, and `capacity_override_at` together on the Assignment.
- [x] The optimistic override handler checks the locally resolved Owner/direct-manager facts before writing, performs no local capacity enforcement, works with the network cut for both authorized roles, and supplies undo data for a later server refusal.
- [x] A genuine direct manager completes the Assignment node, `assignment_of`, and `assigned_to` writes through the real interceptor. An unrelated genuine manager is refused with `reason: "role"` before validation or apply.
- [x] Edge writes can supply endpoint node IDs for row-scoped decisions. Only `assigned_to` declares `readSufficientEndpoints: { Project: true }`; every other edge retains the prior Full requirement unless its own registration later opts in.
- [x] `sweepOvercommitted` reuses server `capacityTotalsFor`, returns overridden and unrecorded overcommitment, and leaves every graph row unchanged.
- [x] Ghost Employees use the same conflict evaluation and override paths as ordinary Employees.
- [x] No `appendAudit` call, UI code, schedule stub, or pass-through adjust mutation was added.
- [x] All four required gates pass. This server-only stage requires no browser suite.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| VRS-F008 G01–G03; F256/F259 | Working-day-aware authoritative totals plus an independent local-cache evaluator sharing only `resolveWorkingDay` | PostgreSQL and local-cache tests compare dates and totals; weekend, holiday, warning, and conflict boundaries are asserted |
| VRS-F008 G04 | `overrideAndProceed` is the only mutation path that may exceed 100% | Integration test rejects ordinary create/update and accepts the authorized override for the same employee and window |
| VRS-F008 G05 | Identical handling for Ghost Employees | Integration and local-query tests exercise conflict and override behavior against a Ghost employee ID |
| VRS-F008 G06; F258 | Complete read-only overcommitment sweep, with scheduling deferred to the future `VPS-A006` queue | Test finds both recorded and unrecorded overcommitment, compares graph state before and after, and observes no write |
| F255 | Manager has the specification's Full Assignment access | Dedicated policy-table assertion records `manager: full`; the remaining Assignment cells are unchanged |
| F257 | Override provenance stays on the Tier 0 Assignment | Direct node read asserts all three override fields; the mutation module has no audit call |
| F260/F261 | Offline Owner and Manager gates derive caller facts from replicated graph records | Optimistic tests cover Owner, direct manager, unrelated caller, network cut, and undo after server refusal |
| F262 | Row-scoped edge endpoint decisions and one registered read-sufficient Project endpoint | Registry unit coverage plus real-interceptor tests prove direct-manager success and unrelated-manager refusal |
| VRS-F008 NFRs | Local evaluation and optimistic override remain usable offline; server validation remains authoritative | Network-cut tests prove both local paths, while rollback coverage proves a server rejection reverses the optimistic write |

## 4. Files changed

- `packages/schema/src/capacity-conflict.ts` adds the portable threshold reader; its test fixes the default and explicit-value behavior.
- `packages/schema/src/mutations/conflict-resolution.ts` defines the override mutation contract and registers it through the shared mutation registry.
- `packages/schema/src/policy/policy-table.ts` changes only `Assignment.manager` to full; its test records the corrected matrix outcome.
- `packages/schema/src/registry/edges.ts` adds the opt-in `readSufficientEndpoints` registration field and declares Project read sufficient only for `assigned_to`; registry tests enforce that exclusivity.
- `services/api/src/graph/founding.ts` writes the 90% default on the Workspace.
- `services/api/src/mutations/assignment.ts` provides the shared working-day-aware `capacityTotalsFor`, keeps ordinary validation authoritative, reuses one Assignment creation plan, and supplies endpoint node IDs for its mandatory edges.
- `services/api/src/mutations/conflict-resolution.ts` implements the authoritative Manager/Owner gate and delegates the actual write to the shared Assignment plan.
- `services/api/src/permission/conflict-resolution-queries.ts` implements the read-only overcommitment sweep; the router exposes the new mutation and query.
- `services/api/src/permission/interceptor.ts` builds endpoint row contexts when an edge write supplies node IDs and honors a registration's explicit read-sufficient endpoint declaration.
- `packages/graph/src/queries/conflict-check.ts` implements the independent local evaluator over `localNodes` and `localEdges`.
- `packages/graph/src/mutators/foundation.ts` resolves caller roles through the local membership edge and implements the optimistic override with its local authorization gate and undo record.
- Schema, graph, interceptor, mutation, and PostgreSQL integration tests provide the acceptance evidence. Older Rate Card and Ghost Resource fixtures now provide temporally valid calendar/entity prerequisites required by the corrected capacity validator.
- The reviewer-authoritative documents carry F255–F262's closed rulings. `pnpm-lock.yaml` and the API package manifest record the API test dependency needed by the new local/server parity fixture.

## 5. Database changes

No migration. The threshold uses the existing schemaless Workspace graph record, and override provenance uses the Assignment fields registered and written since Stage 13. The stage adds no table, protected fragment, index, device shape, or materialized aggregate.

## 6. Tests and gates

- `pnpm install --frozen-lockfile` — passed; the lockfile was accepted without modification.
- `pnpm stack:up` — passed; PostgreSQL, Redis, and Electric reported healthy.
- `pnpm verify` — passed: formatting, lint, conformance, architecture checks, typecheck, and all fast suites.
- `pnpm verify:full` — passed: 21 API test files, 278 tests passed and 2 skipped. The fast suites included 92 schema tests passed with 2 todos and 80 graph tests passed.
- Focused Rate Card and Ghost Resource regression run — 2 files and 9 tests passed against PostgreSQL after those pre-Stage-16 fixtures were given valid calendar/entity prerequisites.
- The Stage 16 PostgreSQL suite covers weekend and holiday filtering, local/server parity, the Manager/Owner gate, ordinary-write refusal, deliberate override, Ghost parity, provenance fields, sweep results, and sweep read-only behavior.
- Interceptor integration coverage uses real membership, Employee, reporting-line, and Project records to prove direct-manager edge success and unrelated-manager refusal.
- Graph tests exercise threshold boundaries, the network cut, local membership and manager resolution, optimistic success, local rejection before write, and undo after an authoritative server refusal.

## 7. Micro-decisions

- `capacityTotalsFor` computes one map of working-date totals and one overlapping-Assignment set. Validation and the sweep consume that same authoritative result instead of maintaining separate server sums.
- The local evaluator assembles calendar, holiday, pattern, entity, assignment, project, membership, and reporting facts from its own cache snapshot. It imports no API code; `resolveWorkingDay` is the only shared calculation primitive.
- The optimistic handler treats its authorization check as an attempt gate. It deliberately omits capacity enforcement because the local cache may lag another device, while the server always recomputes capacity and authorization before commit.
- `WriteTarget` endpoint IDs are optional. Existing edge-write call sites that omit them preserve the previous unscoped decision exactly.
- `readSufficientEndpoints` is registration-level and opt-in. A Manager's read access to a Project permits only the `assigned_to` attachment; it does not grant Project field writes or relax another edge.
- Assignment edge checks use the already resolved Employee and Project node IDs. They perform no second lookup and give row-scoped Employee policy the same facts the read interceptor already uses.
- The Rate Card fixtures moved Assignment windows after the founding calendar's effective date. The Ghost promotion fixture adds the same `scoped_to_entity` prerequisite used by Stage 16's Ghost acceptance case. Production behavior remains strict when working-day facts are absent.

## 8. Findings raised

Stage 16 incorporated eight same-day rulings. F255 corrected the Manager Assignment policy cell. F256 made the existing capacity constraint working-day-aware. F257 removed an unsupported audit event. F258 deferred only the unavailable job scheduler while keeping the sweep complete and callable. F259 moved conflict evaluation and override optimism to the device boundary required by the NFRs. F260 identified the missing caller facts, and F261 replaced the proposed role plumbing with graph-derived WorkspaceMembership roles. F262 added narrowly scoped endpoint-aware edge authorization after the first real Manager integration test exposed the mandatory-edge refusal. No further finding arose after F262; F263 was not needed.

## 9. Deviations from this brief

None from the final corrected Stage 16 brief. The implementation does not add `conflictResolution.adjustNew`, `adjustExisting`, or `endExisting`; create a job queue or periodic trigger; append an audit entry; introduce a second working-day definition; add caller roles to graph-client initialization; widen Project write access; or modify UI code.

## 10. Known limitations and risks

- The overcommitment sweep is callable and complete but has no four-hourly trigger until `VPS-A006` supplies the repository's first job queue and scheduler.
- Local conflict results and optimistic authorization are advisory snapshots. Another device can change assignments, reporting lines, or membership before the server receives the write; the ordinary rejection and undo path handles that race.
- Employees, including Ghost-linked Employees, need an active entity assignment and resolvable WorkingCalendar for authoritative capacity validation. Missing graph prerequisites are refused rather than approximated with calendar-day arithmetic.
- This stage exposes server and graph capabilities only. The resolution panel, capacity strip, warnings, and overcommitment list remain for a later UI-wiring stage.

## 11. Readiness for the next stage

Stage 16 is ready for direct code review on `codex/stage-16-capacity-conflict-resolution`. RST-44 should move to Done only after approval and merge. The branch is intentionally unmerged, and no subsequent stage has started.

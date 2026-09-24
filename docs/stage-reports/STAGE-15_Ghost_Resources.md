# Stage 15 — Ghost Resources (`VRS-F007`)

- **Status:** COMPLETE, awaiting review.
- **Branch:** `codex/stage-15-ghost-resources`
- **Linear:** RST-43
- **Date:** 24 September 2026

## 1. Summary

Ghost Resources now have a server-authoritative lifecycle from creation through cancellation or promotion. Creation atomically writes the GhostResource and its identity-light Employee record, including skill and optional OpenRole edges. Promotion is an online-only, serializable transaction that fills the same Employee node in place, preserves its existing graph relationships, and records the permanent `promoted_to` edge.

Ghost Employee rows now use the existing local Bench Forecast derivation. The server aggregate keeps real utilization unchanged and reports Ghost contribution separately over the real cohort's capacity denominator, with both figures under the same disclosure controls. F248–F254 are incorporated as ruled, including the operational governing partition required to authorize `promoted_to`. No application file changed.

## 2. Done-criteria checklist

- [x] `ghostResource.create` writes one GhostResource and one Employee atomically. An injected edge collision proves that a partial failure commits neither node.
- [x] The Ghost Employee record has `employee_type: "Ghost"`, null identity fields, `contracted_hours: 40`, and the caller's role, date, seniority, and expected rate.
- [x] Target skills use ordinary `has_skill` edges from the Employee node. Optional OpenRole linkage and later relinking use `placeholder_for`, closing the prior active edge first.
- [x] `ghostResource.cancel` and `ghostResource.promote` check `expected_version` before lifecycle rules. Cancel remains a single-row, non-serializable mutation.
- [x] Promotion runs under serializable isolation, changes the GhostResource to `Promoted`, changes the linked Employee to `employee_type: "Employee"`, writes its required identity fields, and creates one `promoted_to` edge.
- [x] `promoted_to` declares Employee's `operational` governing partition, so the real interceptor authorizes the Tier 0 Employee write and edge.
- [x] Promotion reuses Employee's uniqueness check and rejects duplicate employee code or email. The deferred `existingEmployeeId` path returns `existing-employee-not-yet-supported`.
- [x] Two concurrent promotions produce exactly one winner. The loser names the winning actor and time; an unrelated stale version returns ordinary `stale-state`.
- [x] A failure after the promotion node updates rolls back both nodes and the edge. Existing Assignment and skill edge rows are identical before and after a successful promotion.
- [x] Promotion is `onlineOnly` and has no optimistic mutator. Create writes the complete two-node pair optimistically; cancel and OpenRole relinking have ordinary optimistic handlers.
- [x] Local Bench Forecast rows include Ghost Employees through the existing row path. Real aggregate utilization stays real-only, while `ghostContribution` uses Ghost billable capacity over the real cohort's capacity.
- [x] Disclosure suppression applies to aggregate utilization and Ghost contribution together.
- [x] GhostResource permission outcomes are Owner/HR Admin/Manager full and Team Member read. OpenRole permissions remain unchanged.
- [x] No Ghost mutation calls `appendAudit`; the node and edge provenance fields supply the ruled who-and-when record.
- [x] All four required gates pass. This server-only stage requires no browser suite.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| VRS-F007 G01, G05; F253 | Atomic GhostResource/Employee creation through the Ghost-specific Employee constructor, plus ordinary skill edges | PostgreSQL test reads the exact two records and `has_skill` edge; injected failure leaves neither node |
| VRS-F007 G02; F248 | Optional OpenRole link and close-then-open relinking | Integration test links twice and finds one active `placeholder_for` edge |
| VRS-F007 G03, G06, G07; F249/F250/F254 | Version-first, serializable, in-place promotion with uniqueness checks and an operationally governed `promoted_to` edge | Real-interceptor integration tests cover success, concurrent one-winner behavior, stale causes, rollback, and the deferred path |
| F252 | Ordinary Tier 0 write provenance without an audit event | No `appendAudit` call exists in the Ghost mutation module; node and edge timestamps and actors are written by the shared stamps |
| VRS-F007 G04 | Ghost rows pass through the existing local Bench Forecast computation | Local cache test asserts the same assignment and bench-period shape for real and Ghost rows |
| VRS-F007 G08 | Separate Ghost contribution over real capacity with shared disclosure control | Mixed-cohort test keeps real utilization at `0.2` while Ghost contribution becomes `0.1`; boundary test suppresses both |
| VRS-F007 read and permission contracts; F251 | Interceptor-gated Ghost list and the ruled GhostResource Manager permission extension | Dedicated policy test plus real permission interceptor exercised by the PostgreSQL suite |
| VRS-F007 NFR | Offline creation/cancel/relink and server-confirmed promotion | Optimistic mutator tests verify the exact create records, undo data, and absent promotion handler |

## 4. Files changed

- `packages/schema/src/employee.ts` adds the strict Ghost-only Employee input and complete operational-record constructor without changing real Employee creation.
- `packages/schema/src/ghost-resource.ts` defines the Ghost record, statuses, list input, and lifecycle transition.
- `packages/schema/src/mutations/ghostResource.ts` defines create, cancel, relink, and online-only promote; the shared mutation registry exports them.
- `packages/schema/src/registry/edges.ts` declares Employee's `operational` governing partition for `promoted_to`, matching the corrected `VPS-A002` table.
- `services/api/src/mutations/ghost-resource.ts` implements the four server writes, including atomic creation, version-first transitions, relinking, uniqueness checks, in-place promotion, and permanent edge creation.
- `services/api/src/mutations/pipeline.ts` registers all four writes and applies serializable isolation only to promotion.
- `services/api/src/permission/ghost-resource-queries.ts` provides the permission-filtered list; `services/api/src/router.ts` exposes the mutation and read contracts.
- `packages/graph/src/mutators/foundation.ts` adds safe optimistic create, cancel, and relink handlers while leaving promotion server-only.
- `packages/graph/src/queries/bench-forecast.ts` removes the former Ghost exclusion from the existing Employee row loop.
- `services/api/src/permission/bench-forecast-queries.ts` adds the separate Ghost cohort totals and `ghostContribution` response field without changing the real cohort.
- `packages/schema/src/policy/policy-table.ts` changes only `GhostResource.manager` from read to full; its dedicated test records all ruled role outcomes.
- Schema, graph, router, local-cache, and PostgreSQL integration tests supply the acceptance evidence. The reviewer-authoritative documents carry F248–F254's closed rulings.

## 5. Database changes

No migration. GhostResource, Employee, Skill, OpenRole, and their registered edges use the existing graph node and edge tables. The stage adds no table, protected fragment, index, device shape, or materialized aggregate.

## 6. Tests and gates

- `pnpm install --frozen-lockfile` — passed with the lockfile unchanged; 489 workspace packages were restored.
- `pnpm stack:up` — passed; PostgreSQL, Redis, and Electric reported healthy.
- `pnpm verify` — passed: formatting, lint, conformance, architecture checks, typecheck, and the fast schema and graph suites.
- `pnpm verify:full` — passed: 20 API test files, 270 tests passed and 2 skipped.
- Focused Ghost Resource and Bench Forecast PostgreSQL run — 2 files and 11 tests passed against the real permission interceptor after the F254 partition declaration.
- Ghost Resource integration coverage proves exact atomic creation, injected rollback, skill traversal, OpenRole relinking, version-first cancel, in-place promotion, uniqueness, a genuine concurrent promotion race, actor/time rejection, unrelated stale-state behavior, and promotion rollback.
- Local graph coverage proves full optimistic creation and undo, no optimistic completion for promotion, and a Ghost row using the existing Bench Forecast derivation.
- Aggregate coverage proves real utilization is unchanged by Ghost presence, Ghost contribution uses the real denominator, and suppression covers both figures.

## 7. Micro-decisions

- Mutation-derived IDs make the GhostResource, Employee, skill edges, optional OpenRole edge, and promotion edge stable across idempotent retries while preserving the specification's random UUID requirement.
- Duplicate target skill IDs are normalized before permission checks and writes, so one request cannot create duplicate `has_skill` edges.
- Promotion checks the Ghost version before the deferred-path, transition, Employee, and uniqueness validations. A promoted current row produces the actor/time rejection; every other mismatch remains `stale-state`.
- The serializable retry loop re-runs the losing promotion against fresh state. This turns a database race into the specified one-winner result without a second concurrency mechanism.
- The Employee update targets the existing `ghost_employee_id` node. Omitting `contracted_hours` keeps its existing value, while all Assignment, skill, and historical edge rows remain untouched.
- `promoted_to` uses Employee's operational partition because promotion changes only Tier 0 Employee identity fields. No compensation partition is read or written.
- Real and Ghost aggregate totals share the same date, working-day, filter, and disclosure paths. Ghost billable capacity is divided by real available capacity so the result answers the specified incremental-utilization question.

## 8. Findings raised

Stage 15 incorporated seven same-day rulings. F248 deferred the unavailable OpenRole creation dependency while preserving its edge API. F249 deferred the undefined existing-Employee merge. F250 added version-first transitions and serializable promotion. F251 corrected GhostResource Manager access without changing OpenRole. F252 removed an unsupported audit event. F253 supplied the Ghost-only Employee constructor and complete promotion identity. F254 added the missing governing partition that the real interceptor requires for `promoted_to`. No further finding arose after F254; F255 was not needed.

## 9. Deviations from this brief

None from the final corrected Stage 15 brief. The implementation does not create OpenRole records, merge into a second Employee node, append an audit event, add an optimistic promotion, change OpenRole permissions, change the real Employee constructor, or modify UI code.

## 10. Known limitations and risks

- OpenRole linkage is implemented but has no live creator until `VRS-F028` supplies OpenRole workflows.
- Promotion into an already existing Employee remains explicitly unavailable until a future specification defines how to reconcile the Ghost's Employee identity and all existing edges.
- Promotion requires connectivity and server confirmation by design. Offline callers retain a pending operation rather than a locally promoted record.
- The stage exposes server and graph data only. The existing fixture UI remains untouched until a later UI-wiring stage consumes these APIs.

## 11. Readiness for the next stage

Stage 15 is ready for direct code review on `codex/stage-15-ghost-resources`. RST-43 should move to Done only after approval and merge. The branch is intentionally unmerged, and no subsequent stage has started.

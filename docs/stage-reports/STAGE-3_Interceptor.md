# Stage 3 — The server-side permission interceptor and audit journal

**Status:** BLOCKED
**Branch:** stage-3-interceptor @ 67ad2c1
**Linear issues:** FDN-98, FDN-89 (partial), FDN-68 (server half)
**Date:** 2026-09-21

## 1. Summary
The permission rules now run on the server: one interceptor decides every read, write and graph walk, reads the person's role fresh on every request, and writes an audit entry in the same transaction for every denial and every Tier 1, 2 or 3 grant. The policy table moved into the shared schema package, the old device copy still compiles through thin re-exports, and the full permission matrix passes against the server. Membership changes (a new member, a role change, a removal) now reach the graph in the same transaction as the Better Auth change. One slice is not finished: nothing in the specifications says how an audit entry names a support or system principal, or what those principals may do, so I raised finding F206, and they are refused rather than guessed.

## 2. Done-criteria checklist
- [x] The moved unit tests pass unchanged; the retired worker still compiles — evidence: `pnpm --filter @vulto/schema exec vitest run src/policy` 24 passed (the 22 moved tests plus 2 new); `pnpm --filter @vulto/graph typecheck` exit 0; graph suite 280 passed (302 before, minus the 22 moved). Only the moved files' import lines changed, since a package cannot import itself by name.
- [x] The ported matrix suite passes against the server interceptor with a case count at least the old suite's — evidence: `services/api/src/permission/interceptor.integration.test.ts::every role x node type x partition cell decides exactly as the policy table resolves it` (590 cells, equal to `countMatrixCoverage()` and the committed baseline), `::covers every role against every Privacy Class in the default mapping`, `::spot checks from VPS-A004's own table`. Old suite: 22 unit tests over the same 590-cell sweep. New: 590 cells decided by `decideRead`, plus the class and spot-check tests.
- [x] A role change takes effect on the very next request, with no cache and no restart — evidence: `interceptor.integration.test.ts::re-reads the central membership row every time, with no cache`; over HTTP `services/api/src/trpc.integration.test.ts::sees a role change on the very next request, with no restart` and `::refuses the next request once the membership is revoked`.
- [x] Every denial and every protected grant produces exactly one audit row, in the same transaction — evidence: `interceptor.integration.test.ts::a denial writes exactly one PermissionDenied entry and it commits with the transaction`, `::a Tier 1 grant writes one SensitiveAccessGranted entry; a Tier 0 grant writes none`, `::a Restricted outcome is a denial and is audited`, `::the audit row rolls back with the transaction that decided it`, `::a decision that cannot be audited releases nothing`. Mutation check: disabling the denial audit fails 5 of these 29 tests.
- [x] `AuditEntry` cannot be written through any generic path — evidence: `interceptor.integration.test.ts::refuses an AuditEntry write on every generic path (F198) and audits the attempt`; `store.integration.test.ts::refuses AuditEntry on every generic write path (F198)`; `audit.integration.test.ts::has no update and no delete path`; `arch-check.test.ts::fails when anything but the audit module imports the journal table (F198)`.
- [ ] Support and system principals are evaluated and audited — not done; see F206. Their types and the closed system-principal name list exist. Evaluated: they resolve to no node grant (`interceptor.integration.test.ts::are evaluated as having no node grant, and cannot yet be audited`). Audited: asking the interceptor to audit one throws. The one system operation with code, `erasure` pseudonymizing an audit actor, is a policy row and is tested (`audit.integration.test.ts::is refused for any other system principal and for another workspace`).
- [x] The report restates F130 as open — see section 10.
- [x] Membership changes reach the graph in the same transaction (amendment of 21 September) — evidence: `services/api/src/graph/membership-changes.integration.test.ts` (admission, one User row per workspace, rollback both ways); `auth.integration.test.ts` role change NARROW and WIDEN and revoke-member now assert the graph copy.

## 3. Spec clauses implemented
| Spec ID | Where implemented | Test proving it |
|---|---|---|
| A004-T01, T02, T20 | `services/api/src/permission/interceptor.ts` (`decideRead`, `authorizeRead`, `authorizeWrite`, `authorizeTraversal`, `filterReadable`) | `interceptor.integration.test.ts` (whole file) |
| A004-T04 (every denial audited) | `interceptor.ts::audit`, `audit/journal.ts::appendAudit` | `::a denial writes exactly one PermissionDenied entry...` |
| A004-T05 (role union) | `permission/roles.ts::effectiveRoles` | `::spot checks from VPS-A004's own table`, `::is derived from an active incoming managed_by edge...` |
| A004-T06 (immediate effect) | `permission/member-principal.ts`, `trpc.ts::createContext` | `::re-reads the central membership row every time`, `trpc.integration.test.ts` |
| A004-T07 (matrix coverage) | `packages/schema/src/policy/matrix-coverage.ts`; server sweep | `::every role x node type x partition cell decides exactly as the policy table resolves it` |
| A004-T08 (fallback to class default) | `packages/schema/src/policy/policy-table.ts` (moved), `resolvePolicyCell` | `packages/schema/src/policy/policy-scope.test.ts` |
| A004-T11 (write authority) | `permission/write-authority.ts` | `::gate 2: write authority narrows a write the role allows...`, `::gate 2 keeps Employee permanently Roster's` |
| A004-T16 (subject exclusion) | `permission/reader-set.ts`, `packages/schema/src/policy/subject-exclusion.ts` | `::excludes the subject of an HRCase from its readers...` |
| A004-T17 (empty reader set) | `interceptor.ts::authorizeWrite` gate 3 | `::gate 3: a protected write whose readers are all concrete is granted...` |
| A004-T18, T19 (None vs Restricted) | `interceptor.ts::decideRead`, `placeholder` | `::a Restricted outcome is a denial and is audited`, `::filterReadable drops what is absent...` |
| A004-T21 (policy table in `packages/schema`) | `packages/schema/src/policy/` | `pnpm --filter @vulto/schema exec vitest run src/policy` |
| A004-T22 (principals) | `permission/principal.ts`, `packages/schema/src/policy/principal-policy.ts` | partial; F206 |
| A003-T59 (audit before release, fail closed) | `audit/journal.ts`, `interceptor.ts` | `::a decision that cannot be audited releases nothing` |
| A003-T68 (job principals; type only) | `permission/principal.ts` | — |
| F198 (AuditEntry reserved) | `graph/store.ts::refuseAuditEntry`, `interceptor.ts`, arch-check | see checklist |
| Graph traversal rules 1-4 | `interceptor.ts::authorizeTraversal` | `::stops at a node the role cannot read...`, `::returns readable neighbors and follows them` |

## 4. Files changed
```
 docs/Foundations_Findings.md                       |   19 +
 .../graph/src/worker/permission/effective-roles.ts |   27 +-
 .../graph/src/worker/permission/matrix-coverage.ts |   71 +-
 .../graph/src/worker/permission/policy-table.ts    |  771 +-----
 packages/schema/src/audit.test.ts                  |  101 +
 packages/schema/src/audit.ts                       |  254 ++
 packages/schema/src/index.ts                       |   30 +
 packages/schema/src/policy/effective-roles.ts      |   25 +
 packages/schema/src/policy/index.ts                |   26 +
 .../src/policy}/matrix-coverage.test.ts            |    0
 packages/schema/src/policy/matrix-coverage.ts      |   66 +
 packages/schema/src/policy/policy-scope.test.ts    |   30 +
 .../src/policy}/policy-table.test.ts               |    3 +-
 packages/schema/src/policy/policy-table.ts         |  819 +++++++
 packages/schema/src/policy/principal-policy.ts     |   40 +
 packages/schema/src/policy/subject-exclusion.ts    |   25 +
 scripts/arch-check.mjs                             |   40 +-
 services/api/drizzle.config.ts                     |    2 +-
 services/api/drizzle/0012_wonderful_morg.sql       |   28 +
 services/api/drizzle/meta/0012_snapshot.json       | 2498 ++++++++++++++++++++
 services/api/drizzle/meta/_journal.json            |    7 +
 services/api/src/audit/audit.integration.test.ts   |  167 ++
 services/api/src/audit/journal.ts                  |  123 +
 services/api/src/audit/pseudonymizer.ts            |   95 +
 services/api/src/audit/schema.ts                   |   96 +
 services/api/src/auth/auth.integration.test.ts     |   52 +-
 services/api/src/auth/workspace-projection.ts      |   73 +-
 services/api/src/auth/workspace-session.ts         |   60 +
 services/api/src/db.ts                             |    5 +-
 services/api/src/graph/arch-check.test.ts          |   18 +
 .../graph/membership-changes.integration.test.ts   |  106 +
 services/api/src/graph/membership-changes.ts       |  172 ++
 services/api/src/graph/store.integration.test.ts   |   12 +-
 services/api/src/graph/store.ts                    |   18 +-
 services/api/src/graph/tx.ts                       |    4 +
 services/api/src/permission/employee-link.ts       |   19 +
 .../src/permission/interceptor.integration.test.ts |  936 ++++++++
 services/api/src/permission/interceptor.ts         |  711 ++++++
 services/api/src/permission/member-principal.ts    |   47 +
 services/api/src/permission/principal.ts           |   49 +
 services/api/src/permission/reader-set.ts          |  116 +
 services/api/src/permission/roles.ts               |   57 +
 services/api/src/permission/test-support.ts        |  123 +
 services/api/src/permission/write-authority.ts     |   82 +
 services/api/src/router.ts                         |   18 +-
 services/api/src/server.ts                         |    3 +-
 services/api/src/trpc.integration.test.ts          |  141 ++
 services/api/src/trpc.ts                           |   67 +
 48 files changed, 7349 insertions(+), 903 deletions(-)
```

## 5. Database changes
Migration `services/api/drizzle/0012_wonderful_morg.sql`: creates `audit_journal` (`workspace_id` references `organization` with cascade, `audit_entry_id`, `content_digest`, `entry jsonb`, `occurred_at`, `actor_user_id`, `event_type`, `operation`, `outcome`, `target_kind`, `target_node_type`, `target_tier`, `appended_at`), primary key `(workspace_id, audit_entry_id)`, six indexes, and check constraints on event type, outcome, target kind and target tier. Its content is the two migrations from `fdn-68-audit-wip` (`0010_nosy_zzzax`, `0011_wild_next_avengers`) combined: the second only widened one check constraint, and the generated SQL matches the WIP's final state. No other tables changed.

## 6. Tests and gates
- `pnpm install --frozen-lockfile` — exit 0
- `pnpm stack:up` — exit 0
- `DATABASE_URL=postgres://vulto:vulto@localhost:5432/vulto_stage3_fresh pnpm --filter @vulto/api db:migrate` (fresh database) — exit 0
- `pnpm verify` — exit 0; `Tasks: 6 successful, 6 total`; `@vulto/schema` 7 files, 61 passed, 2 todo; `@vulto/graph` 23 files, 280 passed
- `pnpm verify:full` — exit 0; `@vulto/api`: `Test Files  7 passed (7)`, `Tests  132 passed (132)` (88 at the start of the stage)
- `pnpm arch:check` — exit 0

## 7. Micro-decisions
- Only the import lines of the moved policy files changed. `resolvePolicyCell` was added to `policy-table.ts` beside `resolvePermission` (which is untouched), with a test that collapsing it reproduces `resolvePermission` for every cell.
- The two WIP migrations became one migration (see section 5).
- The device-local historical audit query and pagination cursor from the WIP journal were not carried over: they existed for a local retention window that no longer exists. The server query for the Audit Log screen is a later feature.
- Audit granularity: one entry per denied or protected-grant row, so a list of N rows produces up to N entries, following A004-T04's "node ID". A hidden row is audited once per call.
- `decide*` functions have no side effects and are for the sync audience materializer (Stage 6); `authorize*` decide and audit. Stage 6 must decide whether the materializer's evaluations are audited.
- A `Restricted` neighbor is returned as a placeholder but not walked through, since Restricted is not Read.
- The edge-type leg of traversal rule 1 is not enforced, as on the device: no document gives an edge type a class.
- A node with inherited protection is labeled Tier 3 in audit entries (most protected), and is never granted.
- Gate 3 applies to Tier 1 and Tier 3 partitions (A004-T17) and to any type registering a subject exclusion.
- Gate 2 reads `OWNERSHIP_REGISTRY` and applies to node writes only. Where an owner is not one of the four activatable applications (Client, owned by Vulto Sales), no restriction applies; `VPS-A002`'s ownership table and `VPS-F008`'s policy table disagree about Client, and F008 says not applicable.
- `Workspace`, `WorkspaceMembership`, `User` and the two membership edge types are refused on the generic write path (`reserved-projection`), ported from the device interceptor.
- `revokeWorkspaceAdmission` now takes the acting user as a second argument, so the graph copy records who removed the member.
- `GraphTx` moved to `graph/tx.ts` so the audit module does not import the store.
- On removal, both membership edges are closed at the removal instant (at least one millisecond after they opened); the User row stays as history. A role change is a no-op if the node already holds the role.

## 8. Findings raised
- F206 — support and system principals have no audit shape and no policy rows. **Open.**

## 9. Deviations from this brief
- Support and system principals are not evaluated and audited as done criteria require; F206.
- Invitation acceptance (amendment of 21 September): no invitation flow exists yet (FDN-86), so there is no existing flow to wire. `admitWorkspaceMember` and `projectMemberAdmission` are built and tested, and the existing tests that seeded members by raw insert now use it. The role-change and removal flows are wired.
- "Aggregate disclosure control stays as currently implemented; port it if it lives in the moved code": it does not live there; no k-anonymity code exists in the repository, so there was nothing to port.
- `AuditEntry` no longer round-trips through `insertNode` (F198, Stage 3 item 7). The Stage 2 round-trip test excludes it and a test asserts the refusal.

## 10. Known limitations and risks
- **F130 remains open.** An Owner or HR Admin can still read an HR case filed about themselves in the current product, because subject exclusion needs the User-to-Employee link that `VRS-F002` / RST-33 builds. On the server, a case write is refused as `reader-set-unresolvable` rather than guessed at (`::gate 3: a protected write is refused as reader-set-unresolvable while the Employee link is absent`), and reading the row's Tier 0 half is decided by the ceiling only.
- Manager scope, "own record" and every other row-scoped grant resolve to nothing until the link exists. `resolveEmployeeForUser` in `permission/employee-link.ts` returns `null` and names RST-33. Manager derivation is implemented and tested with an injected link.
- F127 (which channel delivers a live role change) is answered by the server reading the central row on every request.
- The hash chain over the journal is FDN-108, later.
- The interceptor's tRPC context resolves the session's own active workspace. Nothing else in the API calls the interceptor yet; the mutation pipeline (Stage 4) and `protected.read` (Stage 5) are its first consumers.
- `principal.current` is a small read-only query added so the role-change criterion can be shown over HTTP.

## 11. Readiness for the next stage
Yes for Stage 4, which needs the interceptor, `appendAudit` and the store. F206 needs a founder decision before Stage 5 (the `erasure` and `key-rotation` system principals) and Stage 6 (`audience-recompute`).

# Stage 2 — The canonical PostgreSQL graph store

**Status:** BLOCKED
**Branch:** stage-2-graph-store @ 31378dc
**Linear issues:** FDN-94
**Date:** 2026-09-21

## 1. Summary
The Postgres graph store is built and tested, and workspace creation now writes its five founding records in the same transaction as the membership row. Every gate passes. One thing is not finished: two registered node types, the anonymous pulse and wellness contributions, cannot be stored because they deliberately have no creation time and the brief's table requires one. I raised that as finding F205 with a recommendation and made the store refuse those two types instead of inventing a timestamp. Stage 3 does not depend on those two types, but the brief says a blocking finding stops the stage, so it needs your ruling.

## 2. Done-criteria checklist
- [x] The migration applies cleanly on an empty database and on the current development database — evidence: `db:migrate` exit 0 on `vulto_stage2_fresh` (11 migrations recorded), on `vulto_fdn60_test` and on `vulto`.
- [x] All tests above pass — evidence: `services/api/src/graph/store.integration.test.ts` (22), `services/api/src/graph/arch-check.test.ts` (5), full API suite 87 passed. Exception: the brief's "every node type in `NODE_REGISTRY` round-trips" holds for all but two types; see F205.
- [ ] Every node type round-trips — `PulseAggregateContribution` and `WellnessAggregateContribution` are refused pending F205; `store.integration.test.ts::refuses the two anonymity-protected node types until F205 is decided` pins that behavior.
- [x] `pnpm arch:check` enforces the import rule — evidence: `arch-check.test.ts::fails when a file outside the allowed folders imports the store`, `::catches a dynamic import and a top-level file too`, `::passes for every allowed folder`, `::passes on the real repository`.
- [x] `workspace.create` is atomic across Better Auth and graph rows — evidence: `store.integration.test.ts::rolls back the graph rows when the Better Auth insert fails`, `::rolls back the Better Auth rows when a graph write fails`; the HTTP route is covered by `auth.integration.test.ts` (the `/workspace/create` test now asserts the three nodes and two edges).

## 3. Spec clauses implemented
| Spec ID | Where implemented | Test proving it |
|---|---|---|
| A003-T51 (Postgres is the source of truth) | `services/api/src/graph/schema.ts`, migration `0010_tricky_millenium_guard.sql` | `store.integration.test.ts::round-trips every registered node type` |
| A003-T52 (only `services/api` writes the graph) | `scripts/arch-check.mjs` store import rule | `arch-check.test.ts::fails when a file outside the allowed folders imports the store` |
| A003-T69 (`managed_by` is a validated temporal edge; database half) | migration: partial unique index and exclusion constraint | `store.integration.test.ts::rejects two open managed_by edges from one employee at the database`; `::rejects overlapping closed scoped_to_entity intervals and allows adjacent ones` |
| A002-T05 / T08 (edge triple registered; `effective_from`/`effective_to` are indexed columns) | `store.ts::insertEdge`; `graph_edges` columns and indexes | `store.integration.test.ts::throws GraphValidationError for an unregistered edge triple` |
| A002-T06 (universal conventions, Workspace and User exceptions) | `store.ts`, `schema.ts` check `graph_nodes_workspace_self_check` | `store.integration.test.ts::gives a Workspace node its own id as workspace_id and refuses any other` |
| F204 (one `User` row per workspace) | `schema.ts` composite key and partial unique index; `graph/membership-projection.ts`; arch-check authority rule | `::stores one person as two User rows...`, `::rejects an edge from one workspace to a node in another`, `::rejects a non-User node whose node_id exists in another workspace`, `::refuses a User write from any caller but the membership projection`, `arch-check.test.ts::fails when anything but the membership projection names the User authority` |
| A003-T54 (version, stale-state; store half) | `store.ts::updateNodeFields`, `StaleVersionError` | `store.integration.test.ts::rejects a stale expectedVersion and leaves the version unchanged` |
| A002-T10 (fail closed on protected tiers) | `store.ts::keepsContent` | `store.integration.test.ts::stores only universal fields for a type with no Tier 0 partition`; `::stores no edge metadata when an endpoint has a protected partition` |

## 4. Files changed
```
 docs/Foundations_Findings.md                       |   24 +
 docs/stage-reports/STAGE-2_Graph_Store.md          |   43 +
 scripts/arch-check.mjs                             |  207 +-
 services/api/drizzle.config.ts                     |    2 +-
 .../api/drizzle/0010_tricky_millenium_guard.sql    |   51 +
 services/api/drizzle/meta/0010_snapshot.json       | 2195 ++++++++++++++++++++
 services/api/drizzle/meta/_journal.json            |    7 +
 services/api/src/auth/auth.integration.test.ts     |   18 +
 services/api/src/auth/membership-edge-ids.ts       |   22 +
 services/api/src/auth/workspace-projection.ts      |   27 +-
 services/api/src/auth/workspace-session.ts         |   15 +
 services/api/src/db.ts                             |   11 +-
 services/api/src/graph/arch-check.test.ts          |   97 +
 services/api/src/graph/founding.ts                 |   88 +
 services/api/src/graph/membership-projection.ts    |   16 +
 services/api/src/graph/schema.ts                   |  131 ++
 services/api/src/graph/store.integration.test.ts   |  668 ++++++
 services/api/src/graph/store.ts                    |  686 ++++++
 18 files changed, 4226 insertions(+), 82 deletions(-)
```

## 5. Database changes
Migration `services/api/drizzle/0010_tricky_millenium_guard.sql` (generated, then hand-appended with the extension and the exclusion constraint):
- `CREATE EXTENSION IF NOT EXISTS btree_gist` (hand-appended)
- `graph_nodes`: `node_id`, `workspace_id`, `node_type`, `lifecycle_status`, `schema_version`, `version` (default 1), `is_soft_deleted`, created/updated/soft-deleted columns, `record jsonb`. Primary key `(workspace_id, node_id)`. Checks: `record->>'node_id' = node_id::text`; `record->>'lifecycle_status' = lifecycle_status`; `node_type <> 'Workspace' or workspace_id = node_id`. Index `(workspace_id, node_type, lifecycle_status) where not is_soft_deleted`. Partial unique index on `(node_id) where node_type <> 'User'`.
- `graph_edges`: as specified, with foreign keys `(workspace_id, from_node_id)` and `(workspace_id, to_node_id)` to `graph_nodes(workspace_id, node_id)`; check on `record->>'edge_id'`; two lookup indexes; partial unique index `(edge_type, from_node_id)` for open `managed_by` and `scoped_to_entity` edges; exclusion constraint `graph_edges_single_active_overlap_excl` (hand-appended).
- No foreign key to Better Auth tables. `created_at` is `not null` as briefed (see F205).
- `drizzle.config.ts` schema is now an array of the auth and graph schema files.

## 6. Tests and gates
Run on `stage-2-graph-store` after the last change:
- `pnpm install --frozen-lockfile` — exit 0
- `pnpm stack:up` — exit 0
- `DATABASE_URL=postgres://vulto:vulto@localhost:5432/vulto_stage2_fresh pnpm --filter @vulto/api db:migrate` (freshly created database) — exit 0, `migrations applied successfully!`, 11 rows in `drizzle.__drizzle_migrations`
- `pnpm verify` — exit 0; `Tasks: 6 successful, 6 total`
- `pnpm verify:full` — exit 0; `@vulto/api`: `Test Files  3 passed (3)`, `Tests  87 passed (87)` (baseline 1 file / 60 tests)
- `pnpm arch:check` — exit 0

## 7. Micro-decisions
- Every store function that touches one workspace's rows takes `workspaceId` as its second argument, including `updateNodeFields`, `softDeleteNode`, `closeEdge`, `outgoing`, `incoming`, `traverse` and `insertEdge`, to follow the brief's rule that there is no workspace-less lookup.
- `softDeleteNode` and `closeEdge` take an `actor` of `{ userId, at }` so the store never reads the clock.
- `outgoing`, `incoming` and `traverse` take an optional `at`. With no `at` they apply no temporal filter and return the whole non-deleted history. `traverse` never revisits a node on one path and allows depth 1 to 64.
- A `User` write is gated by a private `WeakSet` of issued authorities, with the mint named only in `graph/store.ts` and `graph/membership-projection.ts`, enforced by a second arch-check rule.
- The deterministic edge-ID helpers moved to `auth/membership-edge-ids.ts` and are re-exported from `workspace-projection.ts`, to avoid an import cycle.
- Graph rows are written before the member insert inside the transaction so a Better Auth failure is a true rollback of graph rows.
- `writeFoundingRecords` has its own `canonicalRoles` (sorted, de-duplicated, comma-joined) rather than importing the retired worker's.
- A type with no Tier 0 partition stores only universal fields, and an edge with a protected endpoint stores empty metadata (fail closed until Stage 5).
- The unique-index and exclusion tests accept either Postgres error code (`23505` or `23P01`) because both constraints forbid two open `managed_by` edges.
- `arch-check.test.ts` builds the User-authority identifier at runtime so that the rule does not flag its own fixture.

## 8. Findings raised
- F204 — `User` has no workspace. **Closed** by the founder-delegated decision; Findings file updated.
- F205 — anonymous contribution nodes have no `created_at`, but `graph_nodes.created_at` is `not null`. **Open.**

## 9. Deviations from this brief
- The two anonymity-protected node types are not stored and their round-trip is not tested, per F205.

## 10. Known limitations and risks
- Only the founding records are written to Postgres. Later membership role changes and revocations still update Better Auth and the device projection only, so the graph `WorkspaceMembership` node's `role` and `lifecycle_status` go stale until a later stage writes transitions through the mutation pipeline.
- The store trusts the caller to supply only Tier 0 fields for a split node type; the registry has no field-to-partition map. Stage 5's write path is where that split is enforced.
- The `record` column stores the record as given (for Tier 0 types), so a Tier 0 type registered with protected fields in future depends on Stage 5.
- The dual write in `workspace.create` (Postgres graph plus the device projection grant) is marked `// F199: removed in Stage 7 (FDN-103)`.
- Test data is not cleaned up between runs; each test uses fresh random workspaces.

## 11. Readiness for the next stage
Almost. Stage 3 builds on the store and does not touch the two anonymity-protected types, but F205 is open. A one-line ruling on F205 lets me apply the migration change and close it.

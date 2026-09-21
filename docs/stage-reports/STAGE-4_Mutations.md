# Stage 4 — The named-mutation pipeline

**Status:** COMPLETE
**Branch:** stage-4-mutations @ 245ee2d
**Linear issues:** FDN-95
**Date:** 2026-09-21

## 1. Summary
Every write to the graph now goes through one pipeline: a client-generated mutation ID makes retries safe, the permission gates run before anything is written, and a state change decided against an old version is rejected rather than merged. The seven foundation mutations are defined once in the shared schema package, with an optimistic version for the device and an authoritative one on the server, and a new architecture check fails the build if anything else writes the graph. The reporting-line move is now authorized too: the registry declares that an org-chart edge belongs to an Employee's operational half (finding F208, closed), and all six tests that waited on it pass.

## 2. Done-criteria checklist
- [x] Replaying a mutation applies it once and returns `duplicate` — evidence: `services/api/src/mutations/pipeline.integration.test.ts::applies a replayed mutation once and returns the stored outcome as a duplicate`, `::applies exactly once when the same mutation arrives twice at the same instant`.
- [x] Same id with different args → `mutation-id-conflict` — evidence: `::refuses the same id with different arguments, and never reveals another workspace's outcome`.
- [x] An approve/reject race on one node via `graph.transitionLifecycle` gives exactly one `applied` and one `stale-state` — evidence: `::an approve/reject race ends with exactly one applied and one stale-state` (two concurrent calls).
- [x] Every successful update increments `version`; a stale expected version changes nothing — evidence: `::increments version on every successful update and rejects a stale expected_version without a change`.
- [x] `org.moveEmployee` rejects A→B→A and a longer cycle and keeps history half-open and non-overlapping — evidence: `pipeline.integration.test.ts::org.moveEmployee (A003-T69)` (`rejects a direct loop A->B->A and a longer loop`, `closes the prior edge and opens the new one at the same instant, half-open and never overlapping`, `takes the effective date from the caller...`, `settles two moves that would each become the other's manager`).
- [x] A mutation denied by the interceptor writes an audit row and no graph change — evidence: `::a denied mutation writes an audit row and a rejection, and changes nothing in the graph`.
- [x] An ordered batch stops at the first rejection with the specified statuses — evidence: `::stops at the first rejection and returns the rest as blocked, in order`.
- [x] `client-outdated` is returned below the minimum version — evidence: `services/api/src/trpc.integration.test.ts::refuses a client below the minimum schema version, or one that does not say, with client-outdated`.
- [x] A Tier 1 mutation definition is `onlineOnly` even if declared otherwise — evidence: `packages/schema/src/mutations/mutations.test.ts::forces onlineOnly for any protected tier, whatever was declared`.
- [x] Generic mutations are Tier 0 only (amendment of 21 September) — evidence: `::refuses a split or protected node type with requires-feature-mutation, on create and update`; client side `packages/graph/src/mutators/foundation.test.ts::createNode refuses a split, protected or unregistered type, and a duplicate id`.
- [x] No path writes `graph_nodes` or `graph_edges` except the pipeline and the Stage 2 `workspace.create` code; `pnpm arch:check` enforces it — evidence: `services/api/src/graph/arch-check.test.ts::fails when anything but the pipeline writes the graph (A003-T52)`, `::passes on the real repository`.
- [x] Client halves for each foundation mutation, tested against an in-memory cache — evidence: `packages/graph/src/mutators/foundation.test.ts` (9 tests, including `::moveEmployee closes and opens at one instant, rejects loops, and reverts`).

## 3. Spec clauses implemented
| Spec ID | Where implemented | Test proving it |
|---|---|---|
| A003-T53 (named mutations, `mutation_id`, at most once) | `packages/schema/src/mutations/`, `services/api/src/mutations/pipeline.ts`, `graph/schema.ts::graphMutations` | `pipeline.integration.test.ts` idempotency describe |
| A003-T54 (state transitions carry the base version) | `mutations/foundation.ts::transitionLifecycle` | `::an approve/reject race...` |
| A003-T63 (Tier 1/2 mutations are online-only) | `packages/schema/src/mutations/define.ts` | `mutations.test.ts::forces onlineOnly...` |
| A003-T64 (rejections revert optimistically) | `packages/graph/src/mutators/cache.ts::applyUndo` | `foundation.test.ts` (each mutator reverts) |
| A003-T69 (`org.moveEmployee`) | `mutations/foundation.ts::moveEmployee`, serializable in `pipeline.ts`; `registry/edges.ts` governing partition | `pipeline.integration.test.ts::org.moveEmployee (A003-T69)` |
| A003-T71 (schema version at upload) | `trpc.ts::currentClientProcedure`, `MIN_CLIENT_SCHEMA_VERSION` | `trpc.integration.test.ts` |
| A003-T52 (only the pipeline writes) | `scripts/arch-check.mjs` rule 4 | `arch-check.test.ts` |
| A004-T01/T02 (interceptor before every write) | `pipeline.ts` step 2 | `::a denied mutation writes an audit row...` |

## 4. Files changed
```
 docs/Foundations_Findings.md                       |   15 +
 docs/stage-reports/STAGE-4_Mutations.md            |  107 +
 packages/graph/src/index.ts                        |    1 +
 packages/graph/src/mutators/cache.ts               |   54 +
 packages/graph/src/mutators/foundation.test.ts     |  263 ++
 packages/graph/src/mutators/foundation.ts          |  275 ++
 packages/graph/src/mutators/index.ts               |   14 +
 packages/graph/src/mutators/memory-cache.ts        |   30 +
 packages/schema/src/index.ts                       |    1 +
 packages/schema/src/mutations/define.ts            |   59 +
 packages/schema/src/mutations/foundation.ts        |  144 ++
 packages/schema/src/mutations/index.ts             |   31 +
 packages/schema/src/mutations/mutations.test.ts    |   79 +
 packages/schema/src/mutations/shared.ts            |   84 +
 scripts/arch-check.mjs                             |   38 +-
 services/api/drizzle/0014_ancient_sentry.sql       |   11 +
 services/api/drizzle/meta/0014_snapshot.json       | 2642 ++++++++++++++++++++
 services/api/drizzle/meta/_journal.json            |    7 +
 services/api/src/audience/index.ts                 |   15 +
 services/api/src/graph/arch-check.test.ts          |   25 +
 services/api/src/graph/schema.ts                   |   24 +
 services/api/src/graph/store.ts                    |   12 +
 services/api/src/mutations/foundation.ts           |  388 +++
 .../api/src/mutations/pipeline.integration.test.ts |  568 +++++
 services/api/src/mutations/pipeline.ts             |  275 ++
 services/api/src/mutations/types.ts                |   51 +
 services/api/src/router.ts                         |   19 +-
 services/api/src/trpc.integration.test.ts          |   84 +
 services/api/src/trpc.ts                           |   24 +-
 29 files changed, 5336 insertions(+), 4 deletions(-)
```

## 5. Database changes
Migration `services/api/drizzle/0014_ancient_sentry.sql`: creates `graph_mutations` (`mutation_id uuid` primary key, `workspace_id`, `actor_user_id`, `name`, `args_sha256`, `outcome jsonb`, `created_at timestamptz` default `now()`) and index `graph_mutations_workspace_created_idx` on `(workspace_id, created_at)`. It is not published for replication and is written only by the pipeline. The brief's column list had no `base_versions`; the stored `outcome` and the request arguments carry them.

## 6. Tests and gates
- `pnpm install --frozen-lockfile` — exit 0
- `pnpm stack:up` — exit 0
- `DATABASE_URL=postgres://vulto:vulto@localhost:5432/vulto_stage4_fresh pnpm --filter @vulto/api db:migrate` (fresh database) — exit 0, 15 migrations recorded
- `pnpm verify` — exit 0; `Tasks: 6 successful, 6 total`; `@vulto/schema` 70 passed, 2 todo; `@vulto/graph` 289 passed
- `pnpm verify:full` — exit 0; `@vulto/api`: `Test Files  8 passed (8)`, `Tests  163 passed (163)` (140 at the start of the stage; none skipped)
- `pnpm arch:check` — exit 0

## 7. Micro-decisions
- (Accepted 21 September.) A request that does not state `x-vulto-schema-version`, or states a malformed one, is refused as `client-outdated`: without the header a stale client cannot be told from a current one, and A003-T71 says a stale client must not upload. This goes beyond the brief's "below the minimum" and is easy to relax.
- `mutation_id` is unique across the whole table. The same id from another workspace is refused as `mutation-id-conflict`, which reveals nothing of the other workspace's outcome.
- A denial commits its transaction (audit entry and rejection row) because the interceptor's audit entry must survive the refusal and nothing else has been written by then. Every other failure rolls back and records the rejection in its own small transaction.
- A replay of a rejected mutation returns the same rejection. A blocked mutation is not run and not logged, so it can be resent.
- The server stamps `created_at`/`created_by`/`updated_at`/`updated_by` from the session and its clock; a client cannot claim them. The shared stamping and the Tier 0 rule live in `packages/schema` so client and server cannot drift.
- `org.moveEmployee`'s new edge id is derived from the mutation id (`moveEmployeeEdgeId`), so the optimistic client and the server agree and replication finds nothing to change. It accepts `new_manager_id: null` to end a reporting line, and refuses a no-op as `no-change`.
- Serialization failures (`40001`) and a lost race on the mutation log are retried up to five times.
- `graph.applyMutations`' input schema is defined in `packages/schema` so `services/api` needs no direct dependency on `zod`.
- `graph.closeEdge` and node updates refuse a soft-deleted target as `target-deleted`; a queued write to a deleted record is rejected, never resurrected.

## 8. Findings raised
- F208 — `managed_by` and `scoped_to_entity` have no governing partition. **Closed** by founder-delegated decision: `Employee: "operational"` declared on both and recorded in `VPS-A002`.

## 9. Deviations from this brief
- None.
- The brief's item 4 lists an "audit" step "where required"; the interceptor already writes the denial and protected-grant entries inside the pipeline's transaction, so the pipeline adds none of its own.

## 10. Known limitations and risks
- **F125 remains open** (ruled 21 September: keep the current behavior; `VRS-F037` decides backdating): a backdated `managed_by` move whose effective date is not later than the open edge's start is refused as `invalid-args` rather than rewriting history.
- The audience seam is a no-op until Stage 6, so no audience row is written yet.
- The client mutators are exercised only against an in-memory cache; Stage 6 supplies the SQLite one and the outbox that queues and reverts them.
- Membership changes from Stage 3 still write the graph through `graph/membership-changes.ts`, not through the pipeline; they are the privileged projection, allowed by the arch rule.
- Only the seven foundation mutations exist; feature mutations come with their features.

## 11. Readiness for the next stage
Yes. Stage 5 needs the pipeline and the interceptor. Stage 6's sync client and every tRPC client in `apps/` must always send `x-vulto-schema-version` (ruled 21 September); the device-side `mutation-interceptor.test.ts` assertion about `managed_by` was updated to match the declaration.

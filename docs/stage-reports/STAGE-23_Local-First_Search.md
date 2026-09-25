# Stage 23 — Local-First Search

**Status:** BLOCKED
**Branch:** `codex/stage-23-local-first-search` (partial implementation; see branch tip)
**Linear issues:** RST-51
**Date:** 2026-09-25

## 1. Summary

The local search implementation and F304 fixture correction are preserved on this branch. The four standard gates passed, and the new `cache_search` assertions passed in the real browser suite. The required full browser gate failed because its unchanged `seedEntities` helper calls `graph.createNode` for `Entity`, which the existing feature-owned mutation rule rejects. This conflict is outside Stage 23's authorized file and mutation scope, so the stage is blocked pending a reviewer ruling.

## 2. Done-criteria checklist

- [x] `cache_search` exists in `CREATE_REPLICATED_SCHEMA` and `REPLICATED_TABLES`; schema version is 3 — evidence: `database.test.ts::rebuilds a version-2 cache including the search table and triggers`.
- [x] Registry validates Tier 0 fields and refuses `AuditEntry` — evidence: `search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names`.
- [x] Triggers maintain insert, rename, soft-delete, reactivation, hard-delete and reset — evidence: `search.test.ts::maintains insert, rename, soft-delete, reactivation, hard-delete and reset synchronously`.
- [x] Literal `%`, `_` and non-ASCII search through SQLite normalization — evidence: `search.test.ts::escapes LIKE wildcards and matches non-ASCII text using SQLite normalization`.
- [x] Three-character query at 150 Employees plus 50 Projects is local and grouped — evidence: `search.test.ts` benchmark, 30 runs, `per`, measured p95 **0.84 ms** during `pnpm verify` (focused rerun: 0.90 ms).
- [x] Deterministic ranking and per-type limit — evidence: `search.test.ts::ranks label-prefix, word-prefix, substring, Active, and binary ties with a per-type limit`.
- [x] `skillMatched` precedes the limit; no `skillMatches` or local ad-hoc wrapper — evidence: `search.test.ts::computes skillMatched before the limit and returns commands alongside entities`.
- [x] Real Ghost indexed under role title and detected by `employee_type` — evidence: `search.test.ts::ignores unresolved labels and indexes/relabels a real Ghost by role title`.
- [x] Shared availability helper and unchanged Skill Matrix behavior — evidence: `pnpm verify` graph suite, 97 tests passed; `skill-matrix.test.ts` unchanged.
- [x] Static symbolic commands, no role gating or executor — evidence: `search-commands.ts` and `search.test.ts::computes skillMatched before the limit and returns commands alongside entities`.
- [x] Registry fingerprint pin — evidence: `database.test.ts::pins the searchable registry to cache schema version 3`.
- [ ] Full `pnpm test:sync-browser` passes — 18 passed, 9 failed; unchanged `seedEntities` contradicts `graph.createNode`'s feature-owned `Entity` rejection. The new role-removal/index assertions passed.
- [x] Label guard and real Ghost handling — evidence: `search.test.ts::ignores unresolved labels and indexes/relabels a real Ghost by role title`.
- [x] File and dependency boundaries — evidence: `pnpm arch:check` and `pnpm verify` passed; no `apps/` or dependency changes, and the sole API diff is F304's optional `addNode` fields parameter.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| VPS-F002 G01 | `packages/graph/src/sync-client/schema.ts` | `search.test.ts::maintains insert, rename, soft-delete, reactivation, hard-delete and reset synchronously` |
| VPS-F002 G02/G08 | `packages/schema/src/search.ts` | `search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names` |
| VPS-F002 G05 | `packages/schema/src/search.ts`, `packages/graph/src/sync-client/schema.ts` | `database.test.ts::pins the searchable registry to cache schema version 3` |
| VPS-F002 G06 | `packages/graph/src/queries/skill-matrix.ts`, `search.ts` | `search.test.ts::shares Assignment coverage and earliest rolloff with Skill Matrix` |

## 4. Files changed

See `git diff --stat main...HEAD` at the pushed branch tip; this is a blocked partial build, not a completion diff.

## 5. Database changes

No server migration. The device-cache schema changes from version 2 to 3 and adds `cache_search` (`node_id` primary key, `node_type`, `label`, `lifecycle_status`, `search_text`), a node-type index and generated cache-node insert/update/delete triggers. The index is derived from the validated searchable registry; no application-code index write was added.

## 6. Tests and gates

- `CI=1 pnpm install --frozen-lockfile` — exit 0; lockfile current, install completed.
- `pnpm stack:up` — exit 0; Postgres, Electric and Redis healthy.
- `pnpm verify` — exit 0; format, six lint tasks, architecture and typechecks passed; conformance 6 passed/2 todo; schema 111 passed/2 todo; graph 97 passed. Search benchmark p95 0.84 ms.
- `pnpm verify:full` — exit 0 (rerun with local Postgres access after sandbox-only socket denial); API Postgres suite: 25 files passed, 319 tests passed, 2 skipped. This command ran no browser suite.
- `pnpm --filter @vulto/api db:migrate` — exit 0; migrations applied.
- `set -a; source .env; set +a; SYNC_BROWSER_DATABASE_URL="$DATABASE_URL" ELECTRIC_URL="$ELECTRIC_URL" ELECTRIC_SECRET="$ELECTRIC_SECRET" pnpm test:sync-browser` — exit 1; full suite: 18 passed, 9 failed. The new role-removal/index assertions passed. Most failures begin at `seedEntities` with `requires-feature-mutation` for `Entity`; a two-tabs count assertion also failed. No test was skipped to claim a pass.

## 7. Micro-decisions

- Per-type result limit 8 is the brief's value, not a new product decision.
- The benchmark uses 30 samples and the brief's loose 100 ms regression ceiling; the measured value is reported above.

## 8. Findings raised

- F301–F304 were previously ruled on `main` and merged into this branch.
- Open, unnumbered pending reviewer: the existing Entity browser fixture cannot pass the required full browser gate under the existing feature-owned mutation rule. See `STAGE-23_Existing_Entity_Browser_Gate_Finding.md` and RST-51.

## 9. Deviations from this brief

None intentionally. The full browser gate was run and failed; no fixture, mutation or gate workaround was made.

## 10. Known limitations and risks

This is unfinished product code. The local and Postgres-backed tests pass, but the full real-browser gate is not green. The independent two-tabs failure has not been root-caused because the Entity fixture contradiction already triggers the required stop.

## 11. Readiness for the next stage

No. The reviewer must rule how the existing `Entity` browser fixture should respect its feature-owned mutation contract, then Stage 23 can resume on this branch and rerun the gates. Stage 24 must wait.

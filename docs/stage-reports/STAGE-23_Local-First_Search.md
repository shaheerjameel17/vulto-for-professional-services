# Stage 23 — Local-First Search

**Status:** BLOCKED
**Branch:** `codex/stage-23-local-first-search` @ `8f699cf` (partial implementation; finding report follows)
**Linear issues:** RST-51
**Date:** 2026-09-25

## 1. Summary

F301–F303 are present, and implementation reached a working local index, query and focused tests. The F302-required test-only `insertNode` re-export then failed the repository's A003-T52 architecture gate, contradicting the brief's required `pnpm verify` result. Work stopped without weakening the gate or changing the required fixture path. The browser suite and the remaining full gates have not run.

## 2. Done-criteria checklist

- [x] `cache_search`, replicated table entry and cache schema version 3 — evidence: `packages/graph/src/sync-client/database.test.ts::rebuilds a version-2 cache including the search table and triggers`.
- [x] Tier 0 registry validation and AuditEntry refusal — evidence: `packages/graph/src/queries/search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names`.
- [x] Trigger maintenance through cache write methods — evidence: `search.test.ts::maintains insert, rename, soft-delete, reactivation, hard-delete and reset synchronously`.
- [x] Literal wildcard and non-ASCII matching — evidence: `search.test.ts::escapes LIKE wildcards and matches non-ASCII text using SQLite normalization`.
- [ ] Three-character query at 150 employees and 50 projects, with reported p95 — the scale test passed its loose ceiling, but the p95 value was not captured in gate output before stopping.
- [x] Deterministic ranking and per-type limit — evidence: `search.test.ts::ranks label-prefix, word-prefix, substring, Active, and binary ties with a per-type limit`.
- [x] Pre-limit `skillMatched`, with no `skillMatches` or ad-hoc wrapper — evidence: `search.test.ts::computes skillMatched before the limit and returns commands alongside entities`.
- [x] Real Ghost indexed under role title, detected through `employee_type` — evidence: `search.test.ts::ignores unresolved labels and indexes/relabels a real Ghost by role title`.
- [x] Shared Employee availability helper; `skill-matrix.test.ts` unchanged — evidence: focused test run, 3 Skill Matrix tests passed.
- [x] Static commands with symbolic targets — evidence: `search.test.ts::computes skillMatched before the limit and returns commands alongside entities`.
- [x] Registry fingerprint pin — evidence: `database.test.ts::pins the searchable registry to cache schema version 3`.
- [ ] Full `pnpm test:sync-browser` with the new index assertion — not run after the required architecture gate failed.
- [x] File-scope and dependency boundaries — no `apps/` change, no mutation/policy/router/principal or dependency change; only the two F302-authorized API re-exports, one of which the architecture gate rejects.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| VPS-F002 G01 | `packages/graph/src/sync-client/schema.ts` | `search.test.ts::maintains insert, rename, soft-delete, reactivation, hard-delete and reset synchronously` |
| VPS-F002 G02/G08 | `packages/schema/src/search.ts` | `search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names` |
| VPS-F002 G05 | `packages/schema/src/search.ts`, `packages/graph/src/sync-client/schema.ts` | `database.test.ts::pins the searchable registry to cache schema version 3` |
| VPS-F002 G06 | `packages/graph/src/queries/skill-matrix.ts`, `search.ts` | `search.test.ts::shares Assignment coverage and earliest rolloff with Skill Matrix` |

## 4. Files changed

The branch contains partial implementation and prior finding notes. Use `git diff --stat main...HEAD` at the pushed branch tip for the exact diff; no completion diff is claimed.

## 5. Database changes

No server migration. Device-cache schema version 2 → 3 adds `cache_search` with five columns, a node-type index and insert/update/delete triggers generated from the validated registry. This is partial stage work pending the gate ruling.

## 6. Tests and gates

- `CI=1 pnpm install --frozen-lockfile` — exit 0 with approved network access; 489 packages installed. The first sandbox attempt encountered npm DNS failures and was interrupted.
- `pnpm stack:up` — exit 0 with Docker access; Postgres, Electric and Redis healthy. Initial sandbox attempt was denied access to the Docker socket.
- `pnpm --filter @vulto/graph exec vitest run src/queries/search.test.ts src/sync-client/database.test.ts src/queries/skill-matrix.test.ts` — exit 0; 3 test files and 24 tests passed.
- `pnpm verify` — exit 1. First run stopped at Prettier on unrelated untracked `Claude outputs/`; that directory was temporarily moved, the exact command rerun, then restored unchanged. Second run: formatting, 6/6 lint tasks and conformance (6 passed, 2 todo) passed; `arch:check` failed because `services/api/src/test/sync-browser-support.ts:22` re-exports `insertNode` from `../graph/store.js`, violating A003-T52's import and write checks.
- `pnpm verify:full` — not run after the blocking architecture failure; this command does not run a browser suite.
- `pnpm --filter @vulto/api db:migrate` and `pnpm test:sync-browser` — not run after the blocking architecture failure; no CI conclusion is claimed.

## 7. Micro-decisions

- Per-type limit 8 comes from the brief, not a new builder decision.
- No other material design decision was made; F303's ordered labels and F302's fixture are implemented as ruled.

## 8. Findings raised

- F301–F303: previously ruled on main and merged here.
- Unnumbered, open: F302's required test re-export fails A003-T52's architecture gate. Evidence and requested ruling: `STAGE-23_Test_Reexport_Arch_Gate_Finding.md` and RST-51.

## 9. Deviations from this brief

None intentionally. The required re-export is present as specified; the gate rejects it. No workaround was made.

## 10. Known limitations and risks

This is unfinished product code. Only focused in-memory SQLite tests ran; no real IndexedDB-VFS browser verification, full suite, or reportable p95 has been completed. The query and trigger implementation should not be treated as reviewed or release-ready.

## 11. Readiness for the next stage

No. The reviewer must reconcile the F302 test fixture instruction with A003-T52's architecture gate, then Stage 23 can resume on this branch. Stage 24 must wait.

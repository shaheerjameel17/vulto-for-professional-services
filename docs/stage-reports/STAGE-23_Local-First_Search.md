# Stage 23 — Local-First Search

**Status:** BLOCKED

**Branch:** `codex/stage-23-local-first-search` (F302 merged as `a677442`; Ghost label-guard finding pending commit)

**Linear issues:** RST-51

**Date:** 2026-09-25

## 1. Summary

F301 and F302 corrected the browser gate, the named Employee fixture, and the non-empty label guard. F302 is present through `a677442`. Stage 23 stopped again before product code: the new guard excludes real Ghost Employees, whose `full_name` is deliberately null, but Do items 3 and 7 still require finding a Ghost by its `job_title`. A reviewer ruling is needed.

## 2. Done-criteria checklist

- [ ] `cache_search`, replicated table entry and cache schema version 3 — not started because the Ghost label guard conflicts with the search requirement.
- [ ] Tier 0 registry validation and AuditEntry refusal — not started.
- [ ] Trigger maintenance through cache write methods — not started.
- [ ] Literal wildcard and non-ASCII matching — not started.
- [ ] Three-character query at 150 employees and 50 projects, with p95 — not started; no measurement is claimed.
- [ ] Deterministic ranking and per-type limit — not started.
- [ ] Pre-limit `skillMatched`, with no `skillMatches` or ad-hoc wrapper — not started.
- [ ] Ghost detection through `employee_type` — not started.
- [ ] Shared Employee availability helper — not started; `skill-matrix.test.ts` is unchanged.
- [ ] Static commands with symbolic targets — not started.
- [ ] Registry fingerprint pin — not started.
- [ ] Full `pnpm test:sync-browser` with the new index assertion — not started; the stop rule applies before product code.
- [ ] Hard boundaries on apps, API, mutations, policies, principals and dependencies — upheld: no product file changed.

## 3. Spec clauses implemented

None. The build stopped during the required pre-implementation trace.

## 4. Files changed

The only Stage 23 changes on this branch are finding notes and this blocked report; no product file was changed. See `git diff --stat main...HEAD` at the pushed branch tip for the exact diff.

## 5. Database changes

None.

## 6. Tests and gates

No gates were run after F302's correction. The stop rule applies before product code and before a meaningful Stage 23 verification run. The five required gates, including the full `pnpm test:sync-browser`, remain pending.

## 7. Micro-decisions

None. The brief's per-type limit of 8 remains its own decision; it was not implemented.

## 8. Findings raised

- F301 and F302 were ruled on main (`a477f2d`, `b52e333`) and are present on this branch.
- New Ghost label-guard contradiction, open for reviewer ruling; recorded in `STAGE-23_Ghost_Label_Guard_Finding.md` and RST-51. No F-number assigned or governing specification edited.

## 9. Deviations from this brief

None. The corrected brief explicitly requires stopping on a brief-versus-code contradiction.

## 10. Known limitations and risks

No `cache_search` table, triggers, query, registry, tests or p95 measurement exists on this branch. The real IndexedDB VFS trigger path remains unverified.

## 11. Readiness for the next stage

No. The reviewer must reconcile F302's `full_name` guard with the required role-title search for real Ghost Employees, after which Stage 23 can resume on this branch. Stage 24 must wait.

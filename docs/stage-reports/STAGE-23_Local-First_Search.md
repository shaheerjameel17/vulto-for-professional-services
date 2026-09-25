# Stage 23 — Local-First Search

**Status:** BLOCKED

**Branch:** `codex/stage-23-local-first-search` @ `f56d69a` (new finding note)

**Linear issues:** RST-51

**Date:** 2026-09-25

## 1. Summary

F301 corrected the browser gate and was merged into this branch as `a477f2d`. Stage 23 stopped again before product code: Do item 8 requires an assertion about a seeded Employee's lowercased `full_name`, but the existing browser fixture creates no Employee with that field. The reviewer must identify or authorize the fixture needed to make the assertion real.

## 2. Done-criteria checklist

- [ ] `cache_search`, replicated table entry and cache schema version 3 — not started because the browser fixture instruction is unresolved.
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
- [ ] Full `pnpm test:sync-browser` with the new index assertion — not started; the named Employee fixture is absent.
- [ ] Hard boundaries on apps, API, mutations, policies, principals and dependencies — upheld: no product file changed.

## 3. Spec clauses implemented

None. The build stopped during the required pre-implementation trace.

## 4. Files changed

`git diff --stat main...HEAD` after this blocked-report update:

```text
 docs/stage-reports/STAGE-23_Browser_Gate_Finding.md          |  5 +++++
 docs/stage-reports/STAGE-23_Local-First_Search.md           | 75 ++++++++++++++++++++++
 docs/stage-reports/STAGE-23_Search_Browser_Fixture_Finding.md |  7 +++++++
 3 files changed, 87 insertions(+)
```

All changes are confined to stage reports.

## 5. Database changes

None.

## 6. Tests and gates

No gates were run after F301's correction. The new fifth gate is `pnpm test:sync-browser`; it cannot prove the required Do item 8 assertion without a named Employee fixture. The stop rule applies before product code and before a meaningful Stage 23 verification run.

## 7. Micro-decisions

None. The brief's per-type limit of 8 remains its own decision; it was not implemented.

## 8. Findings raised

- F301 browser gate mismatch was ruled on main at `a477f2d` and merged into this branch.
- Browser Employee fixture gap, open for reviewer ruling; recorded in `STAGE-23_Search_Browser_Fixture_Finding.md` and RST-51. No F-number assigned or governing specification edited.

## 9. Deviations from this brief

None. The corrected brief explicitly requires stopping on a brief-versus-code contradiction.

## 10. Known limitations and risks

No `cache_search` table, triggers, query, registry, tests or p95 measurement exists on this branch. The real IndexedDB VFS trigger path remains unverified.

## 11. Readiness for the next stage

No. The reviewer must rule the named Employee fixture for Do item 8, after which Stage 23 can resume on this branch. Stage 24 must wait.

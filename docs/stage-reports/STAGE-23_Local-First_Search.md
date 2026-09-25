# Stage 23 — Local-First Search

**Status:** BLOCKED

**Branch:** `codex/stage-23-local-first-search` @ `be925d3` (finding note)

**Linear issues:** RST-51

**Date:** 2026-09-25

## 1. Summary

Stage 23 stopped before product code. The brief requires a device-store browser result from `pnpm verify:full`, but that command contains no browser suite. The existing sync browser suite runs separately. A reviewer ruling is needed to define the gate for the new cache triggers.

## 2. Done-criteria checklist

- [ ] `cache_search`, replicated table entry and cache schema version 3 — not started because the gate contract is unresolved.
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
- [ ] Hard boundaries on apps, API, mutations, policies, principals and dependencies — upheld: no product file changed.

## 3. Spec clauses implemented

None. The build stopped during the required pre-implementation trace.

## 4. Files changed

`git diff --stat main...HEAD` after the finding-note commit:

```text
 docs/stage-reports/STAGE-23_Browser_Gate_Finding.md | 5 +++++
 1 file changed, 5 insertions(+)
```

This blocked report is the only subsequent file.

## 5. Database changes

None.

## 6. Tests and gates

No gates were run. The stop rule applies before product code and before a meaningful Stage 23 verification run. The current root script is `"verify:full": "pnpm verify && pnpm verify:preflight && pnpm --filter @vulto/api test"`; `pnpm test:sync-browser` is separately defined and separately run by `.github/workflows/slow-lane.yml`.

## 7. Micro-decisions

None. The brief's per-type limit of 8 remains its own decision; it was not implemented.

## 8. Findings raised

- Browser gate mismatch, open for reviewer ruling; recorded in `STAGE-23_Browser_Gate_Finding.md` and RST-51. No F-number assigned or governing specification edited.

## 9. Deviations from this brief

None. The brief explicitly requires stopping on a brief-versus-code contradiction.

## 10. Known limitations and risks

No `cache_search` table, triggers, query, registry, tests or p95 measurement exists on this branch. The real IndexedDB VFS trigger path remains unverified.

## 11. Readiness for the next stage

No. The reviewer must rule the Stage 23 browser gate, after which Stage 23 can resume on this branch. Stage 24 must wait.

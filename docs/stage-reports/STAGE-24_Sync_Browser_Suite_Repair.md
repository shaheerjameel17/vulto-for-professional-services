# Stage 24 — Sync browser suite repair

**Status:** COMPLETE
**Branch:** `codex/stage-24-sync-browser-suite-repair` @ `ade36f7` (repair; report commit follows)
**Linear issues:** FDN-126
**Date:** 2026-09-26

## 1. Summary

The sync browser suite now seeds Client instead of the feature-owned Entity, with one shared seed-type constant. A fast-lane unit test protects that choice and was proven to reject Entity. All 27 browser tests pass locally, and the protected-data gate was proven to fail for a deliberately planted sentinel and pass after restoration. Fast-lane and slow-lane both succeeded on the repair commit, including every required job. No product code, assertion value or timeout was changed.

## 2. Done-criteria checklist

- [x] `seed-type.ts` is the single source of the Client seed type — `git grep -n '"Entity"' packages/graph/sync-browser-tests` returned nothing.
- [x] Guard runs under `src/` and passes in `pnpm verify` — `browser-suite-seed.test.ts::keeps the browser suite seed valid for the generic graph mutations`; temporary Entity perturbation failed with “A feature has claimed it” and instructions to change `seed-type.ts`.
- [x] Full suite passes 27/27 locally, without skip, fixme, retry or exclusions — `pnpm test:sync-browser` final run, exit 0, `27 passed (1.6m)`.
- [x] A003-T56 passes and its negative control bites — temporary sentinel field: exit 1, 1 failed at `expect(haystack).not.toContain(tier1)`; restored fixture: exit 0, `1 passed (7.7s)`.
- [x] Fast-lane and slow-lane succeeded on `ade36f7` — Actions API run URLs and per-job results below. Final report-only head CI is also checked and recorded in FDN-126 before handoff.
- [x] File scope holds — only the suite files, the one new `src/sync-client` guard test, and this report are changed; no product, workflow, gate, dependency or governing-doc change.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| F305 / Stage 24 Do 1–3 | `sync-browser-tests/seed-type.ts`, `helpers.ts`, `sync.spec.ts` | Full sync browser suite, 27 passed |
| F305 / Stage 24 Do 2 | `src/sync-client/browser-suite-seed.test.ts` | `keeps the browser suite seed valid for the generic graph mutations`; Entity perturbation fails |
| A003-T56 / Stage 24 Do 5 | Existing `sync.spec.ts` storage test, unchanged assertions | `no Tier 1 or Tier 2 value reaches any browser storage`; negative control fails, restored test passes |

## 4. Files changed

`git diff --stat main...HEAD`:

```text
 .../STAGE-24_Sync_Browser_Suite_Repair.md          | 96 ++++++++++++++++++++++
 .../src/sync-client/browser-suite-seed.test.ts     | 34 ++++++++
 packages/graph/sync-browser-tests/helpers.ts       | 23 +++---
 packages/graph/sync-browser-tests/seed-type.ts     |  5 ++
 packages/graph/sync-browser-tests/sync.spec.ts     | 78 ++++++++++--------
 5 files changed, 189 insertions(+), 47 deletions(-)
```

## 5. Database changes

None. `pnpm --filter @vulto/api db:migrate` applied the existing migrations before the browser run; no migration or schema changed.

## 6. Tests and gates

| Exact command | Exit | Result |
|---|---:|---|
| `CI=1 pnpm install --frozen-lockfile` | 0 | Frozen lockfile current; 489 packages installed. |
| `pnpm stack:up` | 0 | Postgres, Electric and Redis healthy. |
| `pnpm verify` | 0 | Format/architecture passed; lint and typecheck 6/6 tasks; conformance 6 passed/2 todo; schema 111 passed/2 todo; graph 14 files, 98 tests passed (new guard included). |
| `pnpm verify:full` | 0 | Final repair commit: `Test Files 25 passed (25)`, `Tests 319 passed / 2 skipped (321)`. This gate contains no browser suite. |
| `pnpm --filter @vulto/api db:migrate` | 0 | Existing migrations applied successfully; Electric password set. |
| `pnpm test:sync-browser` with environment below | 0 | `27 passed (1.6m)`. All nine formerly seed-blocked tests execute and pass. |

The full browser command was:

```sh
set -a; source .env; set +a
SYNC_BROWSER_DATABASE_URL="$DATABASE_URL" ELECTRIC_URL="$ELECTRIC_URL" ELECTRIC_SECRET="$ELECTRIC_SECRET" pnpm test:sync-browser
```

Failure classification: the initial repaired-suite run ended 26 passed/1 failed. The test “a queued state transition the server rejects as stale is reverted locally and needs attention” failed with `page.evaluate: ReferenceError: SYNC_SUITE_SEED_NODE_TYPE is not defined`: the imported runner constant had not been serialized into the browser callback. This was a suite-only implementation correction, not an earlier product defect: pass `[nodeId, SYNC_SUITE_SEED_NODE_TYPE]` as the evaluation argument and use its `nodeType`. The full rerun passed 27/27; every assertion, expected value and timeout is unchanged. No additional historical fixture drift, product defect or flake was found, and no retries were added.

Guard control: `pnpm --filter @vulto/graph exec vitest run src/sync-client/browser-suite-seed.test.ts` passed for Client; with the constant temporarily Entity it exited 1 (`1 failed`) with “A feature has claimed it. The sync browser suite seeds this type through graph.createNode and graph.transitionLifecycle. Change sync-browser-tests/seed-type.ts to a suitable registered Tier 0 type.” Restoring Client passed the guard in the final `pnpm verify` and `verify:full`. The perturbation is not committed.

Protected-data negative control: temporarily changed only `seedProtected`'s Employee `full_name` to `tier1`. With the same browser environment, `pnpm test:sync-browser --grep 'no Tier 1 or Tier 2'` exited 1, `1 failed`, because `expect(haystack).not.toContain(tier1)` found the sentinel in browser storage. Restored `full_name: SEARCH_FIXTURE_EMPLOYEE_NAME` and ran the same command: exit 0, `1 passed (7.7s)`. This temporary grep is the brief's negative-control command, not a suite exclusion; the acceptance run was the full 27 tests. The perturbation is not committed.

CI, read from the Actions API for repair commit `ade36f762de31e587f8e8bbe9db598e67cb9bfba`:

- [fast-lane run 36231775425](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36231775425): **success**; `resolve-image`, `verify` both success.
- [slow-lane run 36231775411](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36231775411): **success**; `resolve-image`, `api-integration`, `production-build`, `auth-browser`, `sync-browser` all success. Each executed steps. `publish-artifacts` is skipped by its existing main-only condition, not a failure or changed gate.

The report-only commit triggers fresh workflows too; the final head's run URLs/conclusions are recorded in FDN-126 after both finish, without changing this report again and causing an endless report/CI cycle. The unrelated untracked `Claude outputs/` folder was temporarily moved aside for formatting checks and restored unchanged.

## 7. Micro-decisions

- Reused one instruction string across the guard's assertions, so every failure names the generic mutations and the correction file.
- Serialized the seed type with the node id for the stale-state browser query; this preserves the query's intent without a browser-global dependency.

## 8. Findings raised

None new. F305 remains open until this stage merges and main's slow lane, including `publish-artifacts`, is green.

## 9. Deviations from this brief

None. The temporary perturbations were reverted; no product repair or gate workaround was made.

## 10. Known limitations and risks

Client's ownership is provisional; the new fast-lane guard requires replacing the suite seed if a future feature claims it or changes its tier/lifecycle. Main's post-merge slow lane and artifact publication remain the final F305 closure condition.

## 11. Readiness for the next stage

Yes, subject to reviewer approval, merge and the green main run that closes F305. Stage 25 was not started.

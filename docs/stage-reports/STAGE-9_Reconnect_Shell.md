# Stage 9 — the Reconnect shell state

**Status:** BLOCKED
**Branch:** stage-9-reconnect-shell @ a79b74d
**Linear issues:** FDN-114
**Date:** 2026-09-22

## 1. Summary

Stage 9 stopped before implementation because the current shell is still a fixture and has no authenticated call to refuse or retry. The specification does not define how a cold-start shell finds the prior session and workspace needed to distinguish sign-in from Reconnect, while preserving offline boot. F216 records the missing bootstrap contract and the stopped-worker Retry problem for a ruling. No Reconnect screen or browser proof was built.

## 2. Done-criteria checklist

- [ ] The trigger, rendering, Retry, and sign-in split exist and are exercised by tests — blocked by F216; there is no authenticated shell call or prior-session contract.
- [ ] Cold-start and mid-session refusals render identically — neither path is wired to the shell.
- [ ] Offline and Reconnect are visibly distinct and never share a trigger — the existing sync status remains unchanged; Reconnect was not built.
- [ ] Network failure, timeout, 5xx, and rate limit never show Reconnect — this cannot be claimed without the new browser suite.
- [ ] A real browser suite proves all four requested cases — not written because it depends on the unresolved bootstrap and retry contract.
- [x] The shell entry point and existing refusal paths were located — `apps/roster-web/src/app/(shell)/layout.tsx` mounts fixture `Shell.tsx`; `packages/graph/src/sync-client/api.ts` classifies tRPC responses; `shape-source.ts` classifies shape responses; `engine.ts` handles erasure and status. This is source inspection, not runtime proof.
- [x] A focused Team FDN issue was filed and set In Progress — FDN-114 in the Shared Application Intelligence Layer milestone, related to FDN-69.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| None | No code was changed; F216 blocks the Stage 9 implementation | None |

The governing clause is `VPS-D004`, “The reconnect state.” Its trigger, rendering, Retry, data, and non-enumeration rules were read but are not implemented here.

## 4. Files changed

Output of `git diff --stat main...HEAD` for the report commit:

```text
 docs/Foundations_Findings.md                  | 17 +++++-
 docs/stage-reports/STAGE-9_Reconnect_Shell.md | 77 +++++++++++++++++++++++++++
 2 files changed, 92 insertions(+), 2 deletions(-)
```

## 5. Database changes

None.

## 6. Tests and gates

| Command | Exit code | Pass/fail/skip counts | Result |
|---|---:|---|---|
| `pnpm install --frozen-lockfile` | Not run | Not available | Stage stopped at F216 before implementation |
| `pnpm stack:up` | Not run | Not available | Stage stopped at F216 before implementation |
| `pnpm verify` | Not run | Not available | Stage stopped at F216 before implementation |
| `pnpm verify:full` | Not run | Not available | Stage stopped at F216 before implementation |
| New Stage 9 Playwright suite | Not run | Not available | Not written; requires a ruled shell bootstrap contract |

Read-only checks: `git diff --check` exited 0; the findings-table script reported 162 rows, F54–F216, with F198 as the only gap. These checks do not satisfy a stage gate.

## 7. Micro-decisions

None. The shell bootstrap, prior-session source, and retry path have behavioral consequences and were not chosen locally.

## 8. Findings raised

- **F216 — Open:** the Reconnect state has no session-aware shell call to retry. The fixture shell makes no authenticated request; the only graph client mount is `/sync-harness`; no shell-facing prior-session/workspace contract exists; `access-revoked` erases the cache and stops the worker before Retry could reuse it. See `docs/Foundations_Findings.md`.

## 9. Deviations from this brief

None. The decision policy in Part 2 requires a finding and a blocked report when a behaviorally significant contract is missing.

## 10. Known limitations and risks

- The shell entry point was where the brief suggested, but tRPC error classification is private to `packages/graph/src/sync-client/api.ts`, and the shape-proxy response is consumed by `shape-source.ts` and `engine.ts`, not by the shell.
- The shell currently displays a fixed `Synced` status and fixture identity. A `401` cannot show Reconnect there today.
- The Stage 6 `access-revoked` erasure path was inspected but not re-tested in this stage. A plain `401` does not erase the Tier 0 cache in the current engine. Neither behavior is claimed as new Stage 9 proof.
- The branch was created from local `main` at `a2df15d`, which contains the Stage 9 brief and is one commit ahead of `origin/main` at `def463e`; `git fetch origin main` confirmed the remote state before branching.

## 11. Readiness for the next stage

No. A ruling on F216 must name the authenticated shell bootstrap call, the source of prior-session and workspace context at cold start, its offline behavior, and the exact Retry path after `access-revoked` stops the worker. Stage 9 can then be implemented and proved by the required browser suite and gates.

# Stage 9 — the real shell bootstrap

**Status:** BLOCKED
**Branch:** stage-9-shell-bootstrap-v2 @ e18f7eb (finding and report commit)
**Linear issues:** FDN-116
**Date:** 2026-09-22

## 1. Summary

The revised Stage 9 brief requires a cold offline boot from one cached workspace, but its unconditional no-session redirect would send that same cold load to sign-in. The pinned Better Auth client returns no session data after its offline request fails, so both instructions apply to one state. F218 records the conflict and the missing rule for using a cached identity without a live session. No application code or test was written.

## 2. Done-criteria checklist

- [ ] A first sole active membership sets `activeOrganizationId` server-side — implementation stopped before the dependent bootstrap could be completed.
- [ ] The same user's shell mounts a live graph client — blocked by F218's offline and session-boundary contract.
- [ ] No session redirects to sign-in with zero workspace calls — this rule conflicts with the required cold offline boot for the pinned client's null-data result.
- [ ] Exactly one cached workspace boots offline and more than one remains unresolved — F218 must decide whether and how a cache hint may identify the user when session retrieval fails.
- [ ] `401` and `access-revoked` reach the shell as observable signals — not wired or tested.
- [x] Fixture screens, Offline, and Reconnect were not changed — `git diff --name-only main...HEAD` contains only this report and the findings log.
- [ ] A second workspace does not switch the active organization — the integration test was not written.
- [x] FDN-116 was filed under FDN-69's Shared Application Intelligence Layer milestone and set In Progress. FDN-114 and FDN-115 were left untouched.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| None | No application code changed | None |

The unresolved governing clauses are the Stage 9 points 1 and 4, `VPS-A003`'s offline boot guarantee, and `VPS-F001`'s session boundary.

## 4. Files changed

`git diff --stat main...HEAD` after the report commit:

```text
 docs/Foundations_Findings.md                  | 12 +++-
 docs/stage-reports/STAGE-9_Shell_Bootstrap.md | 79 +++++++++++++++++++++++++++
 2 files changed, 90 insertions(+), 1 deletion(-)
```

## 5. Database changes

None.

## 6. Tests and gates

| Command | Exit code | Pass/fail/skip counts | Final output |
|---|---:|---|---|
| `pnpm install --frozen-lockfile` | Not run | Not available | Stage stopped on F218 before implementation |
| `pnpm stack:up` | Not run | Not available | Stage stopped on F218 before implementation |
| `pnpm verify` | Not run | Not available | Stage stopped on F218 before implementation |
| `pnpm verify:full` | Not run | Not available | Stage stopped on F218 before implementation |
| New Stage 9 Playwright suite | Not run | Not available | Not written; F218 blocks the offline scenario |
| New admission integration test | Not run | Not available | Not written after the stop condition |

Read-only `git diff --check` exited 0 with no output. This is not a substitute for a stage gate.

## 7. Micro-decisions

None. Distinguishing an unavailable session service from a confirmed signed-out user, and selecting a cached identity, affect behavior and security, so they were not inferred as micro-decisions.

## 8. Findings raised

- **F218 — Open:** the unconditional null-session redirect and cold offline cache boot apply to the same Better Auth result. The finding is recorded in `docs/Foundations_Findings.md` with direct evidence from the pinned client's `session-atom.mjs`.

## 9. Deviations from this brief

None. The brief requires a new finding, a BLOCKED report, and a stop when its contract is incomplete.

## 10. Known limitations and risks

- Better Auth 1.6.29's fresh session atom begins with `data: null`; after an offline `/get-session` failure it has `data: null`, an error, and `isPending: false`. The brief does not say whether that error changes the sign-in rule.
- A `session_hint` contains workspace and user IDs, not proof of a currently authenticated session. The brief says to enumerate caches “for this user” without defining how to establish that user on a cold offline load.
- Better Auth's `organization.list()` returns organizations for all membership rows without filtering their active or confirmed status. `organization.listMembers()` exposes status, so online resolution may be possible with existing APIs, but that was not implemented or proven in this blocked attempt.
- Local `main` at `e177e36` includes the F216 and F217 rulings and is three commits ahead of `origin/main` after fetching. This branch starts from that latest local `main`. The previous attempt's untracked `.wt-stage9-check/` and `STAGE-9_Reconnect_Shell.md` were left untouched; this report replaces the previous attempt's untracked file at the required Stage 9 path.

## 11. Readiness for the next stage

No. Rule F218, amend the Stage 9 brief and owning specifications, then build and run the required browser, integration, and standard gates. Stage 10 still depends on a completed Stage 9 bootstrap.

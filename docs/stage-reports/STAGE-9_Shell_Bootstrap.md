# Stage 9 — the real shell bootstrap

**Status:** BLOCKED
**Branch:** stage-9-shell-bootstrap @ 0bd19a9
**Linear issues:** FDN-115
**Date:** 2026-09-22

## 1. Summary

The Stage 9 bootstrap cannot choose a real workspace from the session after workspace creation: the creation path never sets the session's active organization. Offline, several workspace caches can each hold a `session_hint`, but none identifies which workspace was active. F217 records both missing parts of the active-workspace contract and the decision needed before the shell can be wired. No bootstrap, refusal signal, or browser suite was built.

## 2. Done-criteria checklist

- [ ] An authenticated user with a workspace mounts the live graph client, proved in a browser — F217 blocks how the shell identifies that workspace after creation.
- [ ] No session routes to sign-in with zero workspace calls — not wired; the stage stops at F217 before dependent code.
- [ ] Offline cold start with a cached `session_hint` mounts without a network call — multiple caches have no active-workspace pointer; F217 requires a ruling.
- [ ] A `401` and an `access-revoked` are observable at the shell boundary — not wired or browser-tested.
- [x] No fixture screen was migrated — `git diff --name-only main...HEAD` contains only the findings log before this report commit.
- [x] A focused Team FDN issue was filed and set In Progress — FDN-115, in FDN-69's Shared Application Intelligence Layer milestone. FDN-114 was not edited.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| None | No application code was changed | None |

The governing clauses are F216's Stage 9 ruling, `VPS-A003`'s offline boot guarantee, and `VPS-F001`'s session/workspace behavior. They are not implemented by this branch.

## 4. Files changed

Output of `git diff --stat main...HEAD` for the report commit:

```text
 docs/Foundations_Findings.md                  | 15 +++++-
 docs/stage-reports/STAGE-9_Shell_Bootstrap.md | 76 +++++++++++++++++++++++++++
 2 files changed, 90 insertions(+), 1 deletion(-)
```

## 5. Database changes

None.

## 6. Tests and gates

| Command | Exit code | Pass/fail/skip counts | Final output |
|---|---:|---|---|
| `pnpm install --frozen-lockfile` | Not run | Not available | Stage stopped at F217 before implementation |
| `pnpm stack:up` | Not run | Not available | Stage stopped at F217 before implementation |
| `pnpm verify` | Not run | Not available | Stage stopped at F217 before implementation |
| `pnpm verify:full` | Not run | Not available | Stage stopped at F217 before implementation |
| New Stage 9 Playwright suite | Not run | Not available | Not written; it depends on the active-workspace contract |

Read-only checks: `git diff --check` exited 0 with no output. `pnpm exec prettier --check docs/Foundations_Findings.md` exited 0 with `All matched files use Prettier code style!`. The findings recount returned 163 rows, F54–F217, with F198 as the only gap. These are not substitutes for the stage gates.

## 7. Micro-decisions

None. Setting the active organization after creation and selecting a cache offline would change session and workspace behavior, so neither was chosen as a micro-decision.

## 8. Findings raised

- **F217 — Open:** the ruled shell bootstrap has no authoritative active workspace to open. `createWorkspace` provisions the organization and confirms its membership but never sets `session.activeOrganizationId`; revocation is the only production path that writes the field and clears it. Each cached workspace has its own `session_hint`, with no pointer identifying the active cache when more than one exists. See `docs/Foundations_Findings.md`.

## 9. Deviations from this brief

None. The Stage 9 brief explicitly requires a new finding and a BLOCKED report if its client-side premise is wrong in the code.

## 10. Known limitations and risks

- `organizationClient()` is absent exactly as the brief says, but adding it would expose a nullable field rather than establish an active workspace for a newly created session. `services/api/src/auth/workspace-projection.ts` never sets the field after creation.
- The integration test for workspace creation verifies membership and graph records by supplying the new workspace ID directly to `requireCurrentWorkspaceSession`; it does not verify the session's active organization. Sync browser helpers explicitly update the session field before opening the test harness, so those tests do not establish an automatic production path.
- The worker cache remains Tier 0 only. This branch does not change its schema, its `Offline` state, revocation erasure, or its refusal classification.
- Local `main` at `8949ec5` contains the F216 ruling and is one commit ahead of fetched `origin/main` at `def463e`; this branch starts from local `main`. Preexisting untracked `.wt-stage9-check/` and `STAGE-9_Reconnect_Shell.md` in the checkout were left untouched.

## 11. Readiness for the next stage

No. F217 must decide when the session's active organization is set, what the shell does with a valid session whose active organization is null, and how an offline cold start identifies the active workspace among multiple cached workspaces. Stage 9 then needs its real browser proof and four standard gates before Stage 10 starts.

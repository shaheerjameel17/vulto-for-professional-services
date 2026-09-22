# Stage 10 — the Reconnect shell state

**Status:** COMPLETE, awaiting review.
**Branch:** `stage-10-reconnect-shell`
**Linear:** FDN-114
**Date:** 22 September 2026

## 1. Summary

The Roster shell now replaces its content with the single VPS-D004 Reconnect view when Stage 9's sync client reports `unauthorized` or `access-revoked`. The view is full bleed, centered, has the specified neutral sentence, and offers one primary Retry. Retry refetches the session and reruns the whole Stage 9 workspace bootstrap. A session accepted before a live 401 remains on Reconnect even if Better Auth refreshes its snapshot to no session; a visitor without a prior session goes to sign-in.

## 2. Done-criteria checklist

- [x] Only the existing typed refusal signal triggers Reconnect. The shell does not classify status codes itself.
- [x] One `ReconnectState` component renders the exact copy and Retry action for cold-start and mid-session refusal; a browser test compares their rendered markup.
- [x] A real no-session response goes to sign-in. A cold HTTP 401 session response also goes to sign-in before any workspace call.
- [x] A prior session refused with a real 401 shows Reconnect. Its Tier 0 cache remains present but the shell and feature content are hidden until Retry succeeds.
- [x] Retry gets a new session answer, reruns the workspace resolution, and mounts a working graph client. A still-revoked attempt returns to Reconnect.
- [x] Access revocation erases the workspace cache before Reconnect renders.
- [x] A real TCP outage leaves the open shell showing Offline and never shows Reconnect. Timeout, 5xx, and rate-limit responses do not produce the refusal signal.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| VPS-D004 Trigger and Rendering | `Shell.tsx` uses `SyncState.refusal`; `ReconnectState.tsx` owns the fixed view | Browser 401 and access-revoked tests |
| No prior session → sign-in | Stage 9 bootstrap remains the initial decision | Real no-session and cold 401 browser tests |
| Prior accepted session → Reconnect | Bootstrap retains a refused client until Retry | Real mid-session 401 browser test |
| Retry reruns bootstrap | Session refetch completes before the next bootstrap attempt; host restarts an unauthorized source on re-init | Browser recovery and still-revoked Retry tests |
| Data and Offline | Stage 6 erase path and existing Offline status are unchanged | Browser cache-preservation, cache-erasure, and TCP-cut tests |
| Timeout, 5xx, rate limit | API maps timeout to `network` and 503/429 to `server`; neither sets `SyncState.refusal` | Graph API and engine tests; shell consumes only refusal |

## 4. Files changed

- `packages/ui/src/ReconnectState.tsx` and `index.ts`: the fixed, token-based whole-application view.
- `apps/roster-web/src/components/Shell.tsx`: the sole Reconnect trigger, with shell shortcuts disabled while refused.
- `apps/roster-web/src/components/shell-bootstrap.tsx`: preserve a live refusal through an automatic session refresh and sequence Retry so a refresh cannot start a duplicate bootstrap.
- `packages/graph/src/sync-client/host.ts`: an unauthorized engine with no restart timer restarts its sources when a fresh bootstrap initializes it. The access-revoked host reset from Stage 9 is unchanged.
- `packages/graph/src/sync-client/engine.test.ts` and `sync-browser-tests/reconnect.spec.ts`: classification and real-browser coverage.

## 5. Database changes

None. Reconnect reads existing session and sync state. Plain 401 does not delete the cache; access revocation uses the existing Stage 6 erasure mechanism.

## 6. Tests and gates

- `pnpm install --frozen-lockfile` — passed with `CI=true` to run noninteractively.
- `pnpm stack:up` — passed; PostgreSQL, Electric, and Redis healthy.
- `pnpm verify` — passed.
- `pnpm verify:full` — passed after the final code, test, and report changes: 15 API test files, 241 passed, 2 skipped; graph's 65 tests passed.
- `pnpm test:sync-browser` — 27 passed: eight new Reconnect and negative-condition scenarios, eight Stage 9 shell cases, and eleven existing sync cases. The cold-start view is compared byte-for-byte with the mid-session view's rendered markup; still-refused Retry remains on Reconnect.
- The no-session test makes a real Better Auth request; the separate cold 401 test returns an HTTP 401 from the browser's session endpoint and verifies zero workspace calls. The mid-session 401, TCP outage, and access revocation use the real API, database, and TCP proxy.

## 7. Micro-decisions

- The shell branches only on `state.refusal`, whose two values were defined by Stage 9. Its hidden test marker remains available after the full-bleed switch so Stage 9's boundary tests continue to work.
- Better Auth may refresh a formerly valid session to null after the sync client receives 401. The bootstrap keeps the already-refused shell mounted until explicit Retry, avoiding a sign-in redirect that would erase the distinction VPS-D004 makes for a previously accepted session.
- Retry waits for its session refetch before starting another bootstrap attempt. The first browser run showed that allowing the session update and retry counter to trigger overlapping attempts could leave the shell at its opening message.
- The graph host restarts only an unauthorized existing engine during a new `init`; that engine otherwise has no restart timer. A stopped access-revoked engine is still replaced using Stage 9's existing host behavior.

## 8. Findings raised

None. The 401 timing and overlapping Retry attempts were implementation faults found by the new browser test and fixed within F214's already-ruled contract. No specification choice was needed.

## 9. Deviations from this brief

None. No fixture screen, Offline component, permission policy, or session route changed. The browser gate uses a real network cut for connectivity loss and exercises 503, 429, and timeout responses on live session refreshes. Playwright request routing does not intercept the SharedWorker shape requests, so those shape-response classifications are covered by graph tests rather than misreported as browser coverage.

## 10. Known limitations and risks

The first session request must resolve before the shell can decide whether a cold visitor signs in or a previously cached workspace boots offline, as in Stage 9. A workspace with more than one eligible membership still needs the later workspace-selection design. This stage does not change either boundary. The UI keeps no cause-specific copy and exposes no access reason.

## 11. Readiness for the next stage

Stage 10 is ready for direct code review. The Reconnect view has one trigger and one Retry path, and the full browser suite remains green. FDN-114 should move to Done only after the reviewer approves this report and branch; no next feature stage was started.

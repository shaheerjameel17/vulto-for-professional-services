# Stage 9 — the real shell bootstrap

**Status:** COMPLETE, awaiting review.
**Branch:** `stage-9-shell-bootstrap-v3`
**Linear:** FDN-117
**Date:** 22 September 2026

## 1. Summary

The Roster shell now uses a real Better Auth session and the graph client. A first confirmed membership sets the active organization in the server transaction. A later sign-in with a null active organization uses two narrow, session-gated routes: one lists only active confirmed memberships, and the other independently confirms a sole membership and establishes it as the server's active session claim. The shell then mounts `createGraphClient`, reads the workspace name from its Tier 0 cache, and shows its real sync status. Confirmed no-session answers go to sign-in; a network-level failure can boot from exactly one `session_hint` cache. Unauthorized and access-revoked outcomes reach the shell as a typed signal for Stage 10.

## 2. Done-criteria checklist

- [x] First workspace creation sets `session.activeOrganizationId` in `confirmWorkspaceAdmission`; a server integration test asserts the persisted value.
- [x] A later sign-in for an already-confirmed sole membership activates it server-side, registers a device, syncs, and renders the real workspace name in a browser.
- [x] A confirmed no-session answer redirects to sign-in with zero workspace, device, shape, or tRPC calls.
- [x] A real TCP connection cut during cold boot does not redirect to sign-in; one cached workspace mounts and reports Offline. Two caches remain unresolved without a silent pick.
- [x] A live 401 and `access-revoked` each surface at the shell boundary through `SyncState.refusal`.
- [x] A second workspace created while already active elsewhere does not change the active organization. Zero or multiple active memberships do not activate a null session; an already-set active organization is not overwritten.
- [x] Home, People, Timesheets, Foundations, and the existing `Offline` component remain unchanged.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| F217: first sole admission becomes active, never auto-switch on second | `confirmWorkspaceAdmission` | `auth.integration.test.ts` first and second workspace tests |
| F219: read only caller's active confirmed memberships | `POST /workspace/list-active-memberships` | integration test excludes pending, revoked, suspended and another user's workspace |
| F220: independently activate sole membership from null | `POST /workspace/activate-sole-membership` | integration tests for sole, repeat, zero and many; later-sign-in browser test |
| F218: confirmed no-session versus unanswered network request | shell bootstrap's `hasServerAnswer` decision | no-session and TCP-cut browser tests |
| VPS-A003: one-cache offline boot, no identity-key expansion | worker cache discovery and `session_hint` | single-cache and multi-cache browser tests; existing device-identity unit tests |
| Stage 9 refusal and Retry seams | `SyncState.refusal`, `ShellBootstrap.retry()` | 401 and access-revoked browser tests; graph worker host reconstructs a revoked session on a new init |

## 4. Files changed

- `services/api/src/auth/workspace-session.ts`, `http.ts`, and `auth.integration.test.ts`: sole admission write, two narrow session routes, and tests.
- `apps/roster-web/src/components/shell-bootstrap.tsx`, `Shell.tsx`, `(shell)/layout.tsx`: session decision, workspace resolution, real graph client mount, live name/status and refusal boundary.
- `packages/graph/src/sync-client/{client,engine,host,index,protocol,status}.ts`: worker-owned cache discovery, public refusal signal and fresh initialization after revocation.
- `packages/graph/sync-browser-tests/shell-bootstrap.spec.ts`: eight real-browser Stage 9 scenarios.
- The F219/F220 ruling documents from `main` are carried into the branch; this report replaces its blocked version. `auth-client.ts` matches its original plugin list: no `organizationClient()` remains. The existing `/api/auth/organization/*` guard is unchanged.

## 5. Database changes

No migration. Both routes use existing `session`, `user`, `member`, and `organization` rows. The activation route writes only null `session.activeOrganizationId` values for the authenticated user after independently proving exactly one active confirmed membership; it never accepts a workspace ID from the request.

## 6. Tests and gates

- `pnpm install --frozen-lockfile` — passed.
- `pnpm stack:up` — passed; Postgres, Electric and Redis healthy.
- `pnpm verify` — passed: formatting, lint, conformance, architecture check, typecheck and fast tests.
- `pnpm verify:full` — passed: 15 API test files, **241 passed, 2 skipped**; the auth integration file alone has **47 passed**. Graph has 63 passed; schema has 74 passed and 2 existing todo items.
- `pnpm test:sync-browser` — **19 passed**, including all eight shell bootstrap tests and the eleven existing sync regression tests. The offline tests use `NetworkSwitch.cut()`, which destroys active TCP sockets and refuses new connections; they do not mock a 401 or empty response.
- The later-sign-in browser test asserts the real workspace name, `Synced`, persisted active organization on both session rows, and a registered device. The graph's Synced state also proves the shape proxy accepted the workspace claim.

## 7. Micro-decisions

- The membership list is workspace-independent because the active workspace is what it must resolve. It returns only `{ workspaceId, workspaceName }` and exposes no role, membership ID, or pending/revoked row.
- Activation checks the current session is null, re-derives memberships inside a transaction, and updates only null active-organization fields for that user. A stale or ambiguous answer returns `{ workspaceId: null }`, which the shell treats as unresolved.
- Offline cache enumeration runs inside the graph worker. If Better Auth could not resolve a user, it checks all `vulto:<workspaceId>:<userId>` caches; when a user is known it filters by that user. The device-identity allowed-key list is untouched.
- The shell reads the Workspace node's `name` from the cache subscription. It presents a generic label only until that Tier 0 node arrives; the browser test requires the real name to render.
- Retry is `useShellBootstrap().retry()`: it refetches the session and re-runs resolution, constructing a fresh graph client. The worker host drops a stopped access-revoked session on the next init, so Stage 10 must call this bootstrap Retry rather than retrying work inside the stopped engine.

## 8. Findings raised

F216, F217, F218, F219 and F220 are closed by their recorded founder rulings. F219 and F220 were discovered during this branch's browser runs, recorded, and ruled before implementation resumed. No new finding was needed after F220. The branch preserves the original F217 commit and the later fixes; no earlier abandoned branch was reused.

## 9. Deviations from this brief

None. No fixture screen was migrated. `organizationClient()` was removed after F219; the two purpose-built routes are the corrected point 3. `Offline` and Reconnect rendering were not touched.

## 10. Known limitations and risks

More than one eligible workspace remains an unresolved holding state until workspace selection is designed; this is F217's deliberate boundary. A network failure with no eligible cache also holds rather than guessing. Feature screens still contain prototype fixtures by Stage 9's explicit scope. The refusal is exposed to the shell but not rendered; Stage 10 owns that UI. An activation response of null after a concurrent change holds and requires a fresh bootstrap, as the F220 ruling specifies.

## 11. Readiness for the next stage

Stage 9 is ready for review. Stage 10 can consume `useShellBootstrap().state.refusal` (`"unauthorized" | "access-revoked"`) and call `useShellBootstrap().retry()` to refetch the session and mount a new client. Stage 10 has not started; do not merge this branch until the founder's “Stage 9 go.”

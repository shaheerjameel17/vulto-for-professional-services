# Stage 9 — the real shell bootstrap, fourth attempt

**Status:** BLOCKED by F220; F219 ruled and implemented locally, Stage 9 incomplete.
**Branch:** `stage-9-shell-bootstrap-v3`  
**Linear:** FDN-117, In Progress  
**Date:** 22 September 2026

## 1. Summary

The F219 ruling was implemented on the existing v3 branch: `POST /workspace/list-active-memberships` returns only a signed-in person's active confirmed workspaces, and the shell uses it when `session.activeOrganizationId` is null. The server integration test passes. A real browser test then exposed F220: resolving one workspace client-side does not make it the server's active session workspace. Device registration rejects the workspace header, the shape proxy cannot serve the unregistered device, and tRPC creates no principal. Stage 9 stops for a ruling on that transition.

## 2. Done-criteria checklist

- [x] First workspace admission sets `session.activeOrganizationId` server-side; integration test passes.
- [x] The ordinary active-organization shell path mounts a real graph client in the preliminary build; browser test passed before F219.
- [x] Confirmed no-session response redirects with zero workspace calls; browser test passed before F219.
- [x] Cold network failure with one cache mounts offline and does not redirect; two caches hold without guessing; TCP proxy browser tests passed before F219.
- [x] A live client 401 and access-revoked reach the shell signal; browser tests passed before F219.
- [x] Second workspace creation preserves the existing active organization; integration test passes.
- [x] F219's new route returns exactly the caller's active confirmed memberships, excluding pending, revoked, suspended and other-user rows; integration test passes.
- [ ] A session with `activeOrganizationId: null` and exactly one active membership opens a live workspace. The browser receives one correct list result, but the server's active claim stays null (F220).
- [ ] Stage 9 completion and full gates. Stopped at F220.

## 3. Spec clauses implemented

The preliminary implementation covers Stage 9 points 1, 2, 4 and 5, and the direct-active-organization path of point 3. F219's new read route and client call are implemented. Point 3's null-active-organization path is blocked downstream by F220. The bootstrap exposes a fresh-client retry for point 6. `Offline`, Home, People, Timesheets and Foundations were not edited.

## 4. Files changed

Local commit `2dbe779` changes `services/api/src/auth/workspace-session.ts` and its integration test for F217. Preliminary, uncommitted implementation changes are in `services/api/src/auth/{http,auth.integration.test}.ts`, `apps/roster-web/src/components/{Shell,shell-bootstrap}.tsx`, `(shell)/layout.tsx`, `lib/auth-client.ts`, `packages/graph/src/sync-client/{client,engine,host,index,protocol,status}.ts`, and `packages/graph/sync-browser-tests/shell-bootstrap.spec.ts`. The F219 ruling's documents from local `main` are present in the working tree, and this report plus `docs/Foundations_Findings.md` record F220. No fixture screen or `Offline` file was edited.

## 5. Database changes

None. F217 uses the existing session field and transaction. The F219 route reads existing session, user, membership and organization rows.

## 6. Tests and gates

- `pnpm stack:up`: passed earlier with PostgreSQL, Electric and Redis healthy.
- `pnpm --filter @vulto/api test src/auth/auth.integration.test.ts`: **45 passed**, including the new F219 route test.
- `pnpm --filter @vulto/api typecheck` and `pnpm --filter roster-web typecheck`: passed after the F219 change.
- `pnpm pretest:sync-browser`: passed earlier.
- Initial `pnpm test:sync-browser shell-bootstrap.spec.ts`: **6 passed**, including an actual TCP cut/refusal for cold offline boot, a server 401, and access revocation.
- F219 retry, `pnpm test:sync-browser shell-bootstrap.spec.ts --grep 'null active|two active'`: **1 passed, 1 failed**. The two-membership holding-state test passes; the one-membership case gets HTTP 200 with exactly one workspace from the new route, but the workspace name never arrives and the shell reports Offline. The server guards explain why (F220).
- `pnpm install --frozen-lockfile`, final `pnpm stack:up`, `pnpm verify`, `pnpm verify:full`, and the final full browser suite were not run after F220. The project's decision policy requires stopping at this unresolved contract.

## 7. Micro-decisions

The F219 read route does not open any Better Auth organization-plugin route. It joins the current session and caller to active confirmed memberships in active organizations and returns only `{ workspaceId, workspaceName }`. The preliminary client uses `SyncState.refusal` (`unauthorized` or `access-revoked`) and exposes `retry()` through shell context; retry refetches the session and reconstructs a client. Cache enumeration remains in the graph worker and adds no device-identity key. These details remain local pending F220's ruling and final review.

## 8. Findings raised

**F219 is closed by the founder's ruling:** the organization-plugin routes stay closed; one narrow session-gated membership list replaces `organizationClient()`. **F220 is open:** a sole list result does not populate `session.activeOrganizationId`. `/devices/register` rejects the client's workspace header while that field is null, the shape proxy requires the device it could not register, and tRPC creates no principal. F220 has a table row and detailed section in `docs/Foundations_Findings.md`.

## 9. Deviations from this brief

The stage is incomplete, and the branch has preliminary implementation rather than a review-ready build. F219's read route works, but point 3's null-active session path cannot use its result for a live graph client. The four final gates and branch push were not performed because the F220 stop condition fired.

## 10. Known limitations and risks

The null-active-organization path cannot sync or write even with a sole confirmed membership. A design choice is required on how, or whether, that selected workspace becomes the server-authoritative active session claim. The partial implementation remains on the same local branch; no reset or discard was attempted after the founder instructed us to preserve it. The branch has not been pushed or merged.

## 11. Readiness for the next stage

Not ready. Rule F220 and correct Stage 9 point 3 and `VPS-F001` with the selected transition. Stage 9 can then resume on this branch, rerun every gate, and submit for review. Stage 10 has not started.

# Stage 9 — the real shell bootstrap, fourth attempt

**Status:** BLOCKED by F219; not submitted for review.  
**Branch:** `stage-9-shell-bootstrap-v3`  
**Linear:** FDN-117, In Progress  
**Date:** 22 September 2026

## 1. Summary

The required null-active-organization path cannot use the read surface the Stage 9 brief names. The API deliberately returns 404 for every Better Auth organization route. A browser test with a valid session and exactly one confirmed active membership proved that `organizationClient().organization.list()` receives 404 and the shell cannot resolve the workspace. This is F219. Stage 9 stops for a ruling on the authenticated membership read contract.

## 2. Done-criteria checklist

- [x] First workspace admission sets `session.activeOrganizationId` server-side; integration test passes.
- [x] The ordinary active-organization shell path mounts a real graph client in the preliminary build; browser test passes.
- [x] Confirmed no-session response redirects with zero workspace calls; browser test passes.
- [x] Cold network failure with one cache mounts offline and does not redirect; two caches hold without guessing; TCP proxy browser tests pass.
- [x] A live client 401 and access-revoked reach a shell signal; browser tests pass.
- [x] Second workspace creation preserves the existing active organization; integration test passes.
- [ ] A session with `activeOrganizationId: null` and exactly one active membership opens that workspace. The browser test fails on the deliberately closed organization read route (F219).
- [ ] Stage 9 completion and full gates. Stopped at F219.

## 3. Spec clauses implemented

The preliminary, unsubmitted implementation covers Stage 9 points 1, 2, 4, 5 and the direct-active-organization path of point 3. It adds a re-invocable bootstrap for point 6. Point 3's null-active-organization path is blocked by F219. `Offline`, Home, People, Timesheets and Foundations were not edited.

## 4. Files changed

`services/api/src/auth/workspace-session.ts` and `auth.integration.test.ts` are in local commit `2dbe779`. Preliminary uncommitted changes are in `apps/roster-web/src/components/{Shell,shell-bootstrap}.tsx`, `(shell)/layout.tsx`, `lib/auth-client.ts`, `packages/graph/src/sync-client/{client,engine,host,index,protocol,status}.ts`, and `packages/graph/sync-browser-tests/shell-bootstrap.spec.ts`. These are incomplete Stage 9 work, retained locally pending the ruling. This report and `docs/Foundations_Findings.md` record the blocker. No fixture screen or `Offline` file was edited.

## 5. Database changes

None. The server-side first-membership write uses the existing session field and transaction.

## 6. Tests and gates

- `pnpm stack:up`: passed with PostgreSQL, Electric and Redis healthy.
- `pnpm --filter @vulto/api test src/auth/auth.integration.test.ts`: passed, 44 tests including first and second workspace assertions.
- `pnpm --filter @vulto/graph typecheck`, `pnpm --filter roster-web typecheck`, and `pnpm --filter roster-web lint`: passed during preliminary implementation.
- `pnpm pretest:sync-browser`: passed.
- `pnpm test:sync-browser shell-bootstrap.spec.ts` before the null-active tests: 6 passed, including an actual TCP cut/refusal for cold offline boot, a server 401, and access revocation.
- `pnpm test:sync-browser shell-bootstrap.spec.ts --grep 'null active|two active'`: one passed, one failed. The single-membership null-active test received HTTP 404 from `GET /api/auth/organization/list`; the two-membership holding-state test passed.
- `pnpm install --frozen-lockfile`, `pnpm verify`, `pnpm verify:full`, and the final full browser suite were not run after F219. The project's decision policy requires stopping, rather than treating partial checks as completion.

## 7. Micro-decisions

The preliminary client uses the existing `SyncState` observable for a `refusal` field (`unauthorized` or `access-revoked`) and exposes a full-bootstrap `retry()` through shell context. Cache enumeration stays inside the graph worker and reads `session_hint`; it adds no device-identity key. These are unsubmitted implementation details, subject to the F219 ruling and final review.

## 8. Findings raised

**F219 is open.** `organizationClient()` makes `organization.list()` available in TypeScript, but `services/api/src/auth/http.ts` blocks all `/api/auth/organization/*` routes with 404 to preserve the single organization write path. The trace of the failing browser test confirms that 404. The brief does not decide whether to permit specific read-only Better Auth routes or to provide a narrower endpoint returning the caller's active confirmed memberships. The finding is recorded as a table row and detailed section in `docs/Foundations_Findings.md`.

## 9. Deviations from this brief

The stage is incomplete, and the blocked branch has preliminary implementation rather than a review-ready build. The null-active path is not implemented successfully. The user-specified four final gates and branch push were not performed because the stop condition fired.

## 10. Known limitations and risks

The preliminary shell holds on a 404 when one active membership exists, violating Stage 9 point 3. No membership read API is available under the ruled contract. A broad `git reset --hard main` to discard the incomplete code was rejected by automatic approval review because it could irreversibly discard branch work; no indirect reset was attempted. The partial work remains local, with no claim that it is ready to merge.

## 11. Readiness for the next stage

Not ready. The founder must rule F219 and correct Stage 9 point 3 and the owning authentication specification with the chosen read contract. Stage 9 can then resume on this branch, re-run all gates, and submit for review. Stage 10 has not started.

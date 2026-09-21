# Stage 7 — Retire the local-first implementation and harden CI

**Status:** COMPLETE, awaiting review
**Branch:** stage-7-retire @ the commit that adds this report (code at `bc55274`)
**Linear issues:** FDN-103, FDN-54
**Date:** 2026-09-21

## 1. Summary

The local-first stack is gone from `main`'s successor branch: the Rust relay, the Loro worker runtime, the sealed store, the old relay client, the diagnostics pages, the retired browser suites and every CI job that ran them. 198 files changed, 4,263 lines added and 48,484 removed. What replaced them is smaller and already in use: workspace creation, member removal and role changes are now single server transactions with no device-side step, a new `device_workspace_revocation` table holds every device revocation (a device revoked before the migration is still revoked after it, proven by a test), and CI now runs exactly what the new stack needs, with the accessibility smoke pass restored in a live suite and an adversarial suite added. The full GitHub slow lane is green with no disabled or skipped job except `publish-artifacts` off `main`.

## 2. Done-criteria checklist

- [x] `git grep -n -i -E "loro|sync-engine|sealed-store|shamir|tier1-envelope"` returns only historical documentation — remaining hits: `CLAUDE.md` line 58 (the archive note), two comment lines in migration `0019` (which describe what it retires), and everything under `docs/`.
- [x] No Rust files remain — `git ls-files | grep -E "\.rs$|Cargo"` is empty. (Untracked, git-ignored agent worktrees under `.claude/worktrees/` hold old copies; they are not in the repository.)
- [x] `pnpm verify` and `pnpm verify:full` pass — `Test Files  14 passed (14)`, `Tests  218 passed | 2 skipped (220)` for `@vulto/api`.
- [x] The slow-lane suites pass locally — `pnpm test:sync-browser`: `11 passed (37.2s)`; `pnpm test:auth-browser`: `6 passed (12.1s)`.
- [x] CI passes on the pushed branch — https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/35637057091 (slow lane: `resolve-image`, `production-build`, `api-integration`, `auth-browser`, `sync-browser` all green; `publish-artifacts` runs only on `main`); fast lane green on the same commit.
- [x] The adversarial suite passes — `services/api/src/test/adversarial/adversarial.integration.test.ts`, 11 tests.
- [x] F210: a device revoked before the migration is still revoked after it — `device-revocation-migration.integration.test.ts`.
- [x] F212: the `device-store-browser` job, config and suite are deleted; no disabled job remains.
- [x] The accessibility smoke pass runs in a live slow-lane suite — `services/api/browser-tests/a11y-smoke.spec.ts`, in `auth-browser`.
- [x] The Stage 6 device rules are intact (see section 7): the Stage 6 browser suite, unchanged, passes 11 of 11.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| A003 (PostgreSQL is the only writer; no device-side dual write) | `auth/workspace-projection.ts::createWorkspace`, `changeWorkspaceRole`, `revokeMembershipForActor`; `auth/workspace-session.ts` | `auth.integration.test.ts::Stage 7 — workspace creation is one server transaction`, `::removal and role change are one server transaction` |
| A003-T67 / F191 (workspace-scoped device revoke) | `auth/device-revocation.ts`, `auth/device-revocation-store.ts`, `sync/shape-proxy.ts` | `auth.integration.test.ts::an Owner's revoke is workspace-scoped...`, `::...leaves the same device's workspace B unlockable`, `::suspendUserAndRevokeSessions revokes every workspace's...`; `shape-proxy.integration.test.ts::returns the same reply for a device revoked for this workspace only...` |
| F210 (revoke survives the drop) | migration `0019_device_workspace_revocation.sql` | `device-revocation-migration.integration.test.ts` |
| A007 (CI gates) | `.github/workflows/slow-lane.yml` | the named gate steps (section 6) |
| A007 gate 8 (accessibility smoke) | `browser-tests/a11y-smoke.spec.ts` | the four tests in that file |
| FDN-54 (adversarial) | `services/api/src/test/adversarial/` | section 2 |
| A007-T08 (decryption reachability) | `scripts/arch-check.mjs` | adversarial test 7 |

## 4. Files changed
198 files, +4,263 −48,484 against `main`. By area:
```
services/sync-engine/**                          38 files  −8,379   (the Rust relay, deleted)
packages/graph/src/worker/**, src/sync/**        68 files −23,588   (the worker runtime and relay client)
packages/graph/src/{client,protocol}(.test).ts   deleted
packages/graph/browser-tests/, playwright.config.ts   deleted (the worker-browser suite)
apps/roster-web/src/app/*-diagnostics/, components/device-store/   deleted (4 diagnostics pages, LockedShellGate)
services/api/browser-tests-device-store/, playwright.device-store.config.ts   deleted
services/api/src/test/{browser-setup-device-store,browser-setup-worker,sync-engine-setup}.ts   deleted
services/api/src/auth/{device-unlock,sync-ticket}.ts   deleted
services/api/src/auth/device-revocation{,-store}.ts    new
services/api/src/auth/{workspace-projection,workspace-session,device-registry,http,schema,index}.ts   rewritten or trimmed
services/api/src/sync/shape-proxy.ts             repointed to the new table
services/api/drizzle/0019_device_workspace_revocation.sql (+ snapshot, journal)   new
services/api/src/test/adversarial/               new (FDN-54)
services/api/browser-tests/a11y-smoke.spec.ts    new (restored)
packages/schema/src/document-generation.ts       deleted (a Loro-document concept)
.github/workflows/{slow-lane,fast-lane}.yml, .docker/ci/*, docker-compose.yml, .devcontainer/*, .dockerignore   trimmed of Rust, sync-engine and the retired jobs
package.json, packages/*/package.json, pnpm-lock.yaml   scripts and dependencies removed
docs/Bootstrap.md, CONTRIBUTING.md, CLAUDE.md, packages/{graph,schema}/README.md   rewritten
docs/Foundations_Findings.md, docs/stage-reports/STAGE-7_Retire.md
```

## 5. Database changes
Migration `services/api/drizzle/0019_device_workspace_revocation.sql`, one transaction, in this order:
1. **Creates** `device_workspace_revocation (workspace_id, device_id, revoked_at, revoked_by, reason)`, primary key `(workspace_id, device_id)`, foreign key to `organization` (cascade), an index on `device_id`. Identifiers only; not published, never replicated. `revoked_by` is an identifier, not a foreign key, so the record outlives the person.
2. **Backfills** it from `device_unlock_secret` for every row with `revoked_at` set, taking the actor and the reason (`explicit`, `stale`, `membership-revoked`) from the most recent matching event in `device_trust_event` for that device and workspace, and `unknown` with no actor where the trail has none.
3. **Drops**, each with `CASCADE`, these tables, listed because the retired code was the only thing that used them:

| Table | Used only by |
|---|---|
| `device_unlock_secret` | the sealed-store unlock, role-refresh and projection-grant code; its revoke state now lives in `device_workspace_revocation` |
| `sync_delta` | the Rust relay's delta log |
| `sync_device_ack` | the Rust relay's per-device acknowledgements |
| `sync_workspace_cursor` | the Rust relay's delivery counter |
| `sync_ticket` | the relay's connection tickets (`sync-ticket.ts`) |
| `workspace_projection_grant` | the device-side projection grants (creation, removal, role change) |

Two tables were kept although they sound related: `device` and `device_trust_event` (the device registry and its audit log, which the brief says to keep). The `member.projection_state` column and its check constraint also stay; see section 10.

A fresh database migrates from empty to 20 migrations (0000–0019).

## 6. Tests and gates
- `pnpm install --frozen-lockfile` — exit 0.
- `pnpm verify` — exit 0. `pnpm verify:full` — exit 0; `@vulto/api`: `Test Files  14 passed (14)`, `Tests  218 passed | 2 skipped (220)`; `@vulto/graph`: 6 files (the retired worker tests are gone).
- `pnpm arch:check` — exit 0. `pnpm --filter roster-web build` + `node scripts/artifact-check.mjs` — `60 production chunks clean · 1 diagnostics routes, all excluded`, `__vultoSync` guarded.
- Live-Electric proxy tests (`ELECTRIC_LIVE_TESTS=1`, database `vulto`) — `Tests  11 passed (11)`.
- `pnpm test:sync-browser` — `11 passed (37.2s)`. `pnpm test:auth-browser` — `6 passed (12.1s)`.
- GitHub: https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/35637057091 — green.

**The slow lane as it now stands** (`slow-lane.yml`): `api-integration` runs `pnpm verify:full`, then each gate by name — audience conformance (A003-T57), publication allowlist (A003-T58), shape proxy (A003-T72), the adversarial suite (FDN-54) and the architecture rules; `sync-browser` (real Postgres, real Electric, real Chromium) runs the no-protected-data-on-device gate (A003-T56) by name and then the whole suite; `auth-browser` runs sign-in, passkeys and the accessibility pass; `production-build` runs the build and artifact check; `publish-artifacts` runs only on `main`. The Rust build job, the `device-store-browser` job, the `worker-browser` suite, the sync-engine image publish and the Rust toolchain in the CI image are gone. The fast lane is unchanged (`pnpm verify`).

**The adversarial suite** (`services/api/src/test/adversarial/adversarial.integration.test.ts`): a forged `mutation_id` (different args refused and nothing applied; another workspace can neither replay nor learn the outcome; identical replay is a duplicate); a principal supplied in client input (extra identity fields on the request and on a mutation never change who acted; a member cannot raise their roles by naming them in a protected read); client-supplied shape parameters (sixteen hostile spellings refused with Electric never called, and the workspace claim cannot widen the upstream request); a Tier 1 value requested by a member demoted mid-session (given while allowed, withheld with an audit denial on the very next request); a stale transition after reconnect (rejected `stale-state`, node unchanged); an audit-append failure (nothing returned); decryption attempted from a non-allowed module (the architecture check fails the build for a route, a job, a test helper and the shape proxy).

## 7. Micro-decisions
- **Membership transitions are single-step.** The two-phase grant protocol existed so a device could confirm a change in its local graph. With the server as the only writer, `createWorkspace`, `changeWorkspaceRole` and `revokeMembershipForActor` do everything in one transaction. Widening no longer waits for a confirmation: widen and narrow take the same path and the result reports the direction. Removal now ends in `revoked/confirmed` directly.
- **HTTP surface removed:** `/device-store/unlock`, `/device-store/roles`, `/sync/ticket`, `/workspace/consume-projection-grant`, `/workspace/consume-transition-grant`, `/workspace/confirm-projection`, `/workspace/transition-grant`, `/workspace/confirm-revocation-projection`, `/workspace/confirm-role-change`; a test asserts each is 404. `/device-store/revoke` moved to `/devices/revoke`, and `/workspace/create` no longer takes a device or returns a grant (it returns `{ workspaceId, membershipId }`).
- **A workspace's devices** are now those of its members (there is no per-workspace unlock row to list); an Owner revoking a device that does not belong to a member of the workspace succeeds silently and writes nothing, so nothing is enumerated.
- **Removal and suspension record revocation rows** for every registered device of the person (all of them in one workspace for a removal, every workspace they belong to for a suspension), which keeps the old behavior that a device revoked by a removal stays revoked if the person is re-admitted.
- **`touchDeviceActivity`** used to be called by the unlock and role-refresh checkpoints; it is now called by the shape proxy once a device is confirmed acceptable.
- **The shape proxy's and every test's probe of "is this device acceptable"** is the proxy itself (`200` or `access-revoked`), since it is the one place that decides it.
- **`document-generation.ts` deleted** from `packages/schema`: the per-document schema generation existed for the Loro document. `loro-crdt`, `shamir-secret-sharing` and the graph package's `postgres` dev dependency are removed; `wa-sqlite`, `canonicalize` and `zod` stay.
- **The a11y smoke pass moved to the auth browser suite** with its old baselines unchanged; it authenticates with the real sign-up form and registers a device through the API instead of unlocking a sealed store. It is a live gate: a baselined violation that stops firing fails it as well as a new one.
- **The CI image no longer installs Rust**, which changes `.docker/ci/Dockerfile`; the new image is published only when this merges to `main` (see section 10).
- **Stage 6 device rules kept**: `vulto:device` still holds only the device id and the pending-erase list; the outbox is versioned apart from the cache; every client API request carries `x-vulto-workspace-id` and a mismatch is refused with nothing applied. All are unchanged, and the Stage 6 browser suite and unit tests for them pass.

## 8. Findings raised
- **F212** (recorded and closed at the Stage 6 review): its obligations are met here.
- **Findings table recounted programmatically** (item 8): 159 rows, F54–F213 with one gap. F198 is cited by the Stage 3 brief and the architecture check but never had a row; it is recorded as a gap and not filled after the fact. 143 closed, 10 open (F70, F71, F73, F85, F91, F118, F125, F129, F130, F213), 6 recorded facts or limitations. The earlier tally of thirteen open had gone stale.
- **F213 (raised here, not decided):** `member.projection_state` and its check constraint (`pending`, `confirmed`, `revocation-pending`) are now vestigial. Live rows are only ever `confirmed` (or `pending` for the instant a workspace is created), and the `revocation-pending` value is never written. Removing the column touches Better Auth's member model and every query that filters on it. I left it in place rather than decide; it needs a ruling.

## 9. Deviations from this brief
- The brief's item 2 names only the dual write in `workspace.create`. The device-side grants for removal and role change existed for the same retired runtime and carried unlock material, so they were removed with it (section 7). If you want the two-phase widen, that is a design decision to make explicitly.
- The brief lists `LockedShellGate` and "the re-export shims from Stage 3" for deletion. The shims had already gone with `packages/graph/src/worker/permission/**`; nothing named as a shim remained to delete.
- `git grep` still matches `CLAUDE.md` (the archive note) and two comment lines in migration `0019`. Both are historical descriptions of what was retired, which the criterion allows.

## 10. Known limitations and risks
- **The CI image still contains Rust until it is rebuilt.** The Dockerfile no longer installs it, but the image only republishes when `.docker/ci/**` changes on `main`. After merge, read the new digest from that `ci-image` run and repin `CI_IMAGE` in `.github/workflows/ci-image-ref.env`. Nothing breaks in the meantime.
- **`member.projection_state`** is vestigial (F213).
- **`revoked_by` is null for backfilled rows whose trail had no actor**, and for suspension, membership-removal-by-system and stale rows the reason is only as good as the trust log; the revocation itself is exact.
- **The accessibility gate covers `/sign-in`, `/sign-up` and `/devices`** with the same accepted `color-contrast` debt as before; the exhaustive `packages/ui` coverage is still a separate piece of work.
- **Stale agent worktrees** under `.claude/worktrees/` still hold copies of the Rust sources. They are git-ignored and outside the repository, but a file search from the repository root will find them.
- **A fresh local `vulto_fdn60_browser` database from before this stage was inconsistent** and had to be dropped once to run the auth suite; CI creates it fresh each run.

## 11. Readiness for the next stage
Yes. The next brief is the feature-spec sweep (FDN-104) and the first Roster features, starting with the canonical Employee profile (RST-33). Before that: merge, then repin the CI image (section 10), and rule on F213.

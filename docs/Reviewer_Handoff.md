# Reviewer Handoff — state for the founder's review chat

**Purpose.** This file lets a fresh Claude chat (the *reviewer*, not Claude Code) resume reviewing the server-authoritative rebuild with no re-explanation. Keep it current: the reviewer updates it at each stage boundary.
**Last updated:** 22 September 2026, after ruling on F219 (a fourth Stage 9 attempt, blocked only after real implementation and a real browser test — the first three stopped before writing code). Stage 7 merged as `dec4eb3`; Stage 8 merged as `5897b7b`, reviewed and ruled. Stage 9 (the real shell bootstrap, redefined from F216) has now stopped four times, correctly every time: F216 (the shell was never wired to the backend at all — `FDN-69`, never built), F217 on the corrected brief (F216's ruling assumed `session.activeOrganizationId` was populated somewhere; nothing populates it, online or off), F218 on the twice-corrected brief (the F217-updated sign-in rule and the offline-cache-boot rule fired on the same event — a cold offline load — and nothing said which won), and F219 on the thrice-corrected brief, this time caught only by actually exercising the bootstrap in a browser (point 3's `organizationClient()` calls a route the API deliberately 404s, reads included). All four are ruled. `stage-9-reconnect-shell`, `stage-9-shell-bootstrap` and `stage-9-shell-bootstrap-v2` (all pushed) each hold only one blocked attempt's discovery and no working code; **`stage-9-shell-bootstrap-v3` is different** — its preliminary implementation is sound apart from the one F219 fix, and Stage 9 continues on that same branch rather than starting a fifth. Two different builders have worked this project now — Claude Code through Stage 8, OpenAI Codex from Stage 9 — the loop is agent-agnostic; see section 1.

---

## 1. Roles and working method

- **Shaheer (founder)** is not an engineer. He relays between two agents: a builder (Claude Code or, as of Stage 9, OpenAI Codex — the loop does not care which, as long as it follows this document's conventions) builds; the reviewer (you) reviews and rules.
- **Loop:** the builder finishes a stage, then writes `docs/stage-reports/STAGE-N_*.md` and stops. Shaheer pastes its summary to the reviewer. The reviewer reads the report **and the code directly** (via the linked-computer shell, repo mounted at `$HOME/mnt/vulto-for-professional-services`). The reviewer gives a verdict, rulings on open findings, and one fenced block of paste-ready text for the builder. The builder applies the fixes, merges with `--no-ff` when CI is green, and waits for "Stage N go". A builder that hits a genuine missing-design gap mid-stage should raise a numbered finding and stop (BLOCKED status), the way Codex did for F216 — that is success, not failure, and the reviewer's job is to verify the gap is real (as F216's was) before ruling on it, not to wave it through or scold the builder for stopping.
- **Always read code, not just the report.** Direct review caught issues every report missed:
  - membership changes not reaching the graph (Stage 2/3);
  - generic mutations able to write protected fields (Stage 4);
  - the key provider defaulting to the dev key (Stage 5);
  - a tenant-crossing outbox drain, protected-read fallback on refusal, and fake-success erasure (Stage 6).
- **Ruling style:** fail closed, tenant-isolated, no silent data loss, no "merge on red", no recorded exceptions where a clean fix exists. A spec disagreement is always a numbered finding, never only a micro-decision.
- **Brief amendments:** added to `docs/Claude_Code_Build_Prompt.md` → "Amendments", on `main`.
  - Method: `git worktree add .wt-<name> main` inside the repo, edit, commit with the attribution trailer, then `git worktree remove`.
  - The linked-computer shell **cannot push** (no GitHub credentials). Claude Code pushes `main`, so the paste text must tell it to.
- **Delete permission** in the repo folder is for git housekeeping only (stale lock files, worktrees).

## 2. Founder preferences

- Addressed as "Sir". Calm, precise, dry. Direct verdicts; push back on weak ideas.
- Plain explanations: say what and why, and avoid jargon.
- Structured and concise. American English.
- The priority is building the app. FDN-110 (pentest and assurance) is deferred until before the first real-data pilot.

## 3. Direction (settled — do not reopen)

- **Dropped:** local-first, CRDT/Loro, the Rust sync engine, Tier 1 E2E envelopes and key recovery. The code is archived on branch `archive/local-first-e2e`.
- **Kept deferred:** Tier 3 as an isolated E2E module.
- **Stack:**
  - Postgres (Drizzle) is the single source of truth. `services/api` (Fastify + tRPC) is the only writer. Better Auth handles identity.
  - The graph is still nodes and edges; only its storage moved to Postgres.
  - The read path is Electric 1.8.1, Apache-2.0, pinned by digest (host port 5133). The client library is `@electric-sql/client` 1.5.28, exact. PowerSync was rejected as paid or ambiguous.
  - Exactly two shapes (nodes, edges), filtered by the `sync_node_audience` / `sync_edge_audience` tables. The materializer is the only writer of those tables. Devices reach Electric only through the authenticated shape proxy.
  - Server-side field encryption: AES-256-GCM, KMS root → per-workspace KEK → DEKs. Erasure destroys DEKs. `protected.read` runs authorize → audit → decrypt.
  - Device: SharedWorker plus wa-sqlite cache (Tier 0 only) and an outbox. Tier 1/2 values live in worker memory only.
- **Trust promises:** VPS-A008 (eight promises).
- **`CLAUDE.md` security rules** (non-negotiable):
  - Tier 1/2 data never reaches device storage.
  - Decryption happens only in the audited path.
  - Tier 3 plaintext never reaches a server.
  - No `localStorage` or `sessionStorage`.
  - The graph is written only through named mutations.
  - The audience is written only by the materializer.
  - No new shapes.

## 4. Where everything is

| What | Where |
|---|---|
| Staged brief + all rulings | `docs/Claude_Code_Build_Prompt.md` (Part 3 stages; "Amendments" = every ruling to date) |
| Stage reports | `docs/stage-reports/STAGE-1…7_*.md` |
| Findings (F54–F219, one gap at F198) | `docs/Foundations_Findings.md` (the table is authoritative; the count paragraph is recounted programmatically) |
| Specs | `docs/Vulto_Specs/` — A001–A008, F001/F004/F007, VPS-002/003, VRS-001 |
| Agent rules | `CLAUDE.md` |
| Linear | Team FDN. Stage 6 = FDN-99/100/101 (Done). Stage 7 = FDN-103, FDN-54 (Done). Stage 8 = FDN-104 (priority slice only), RST-33. FDN-104's remaining specs correct just-in-time per later feature. Deferred: FDN-110 (pentest) |

## 5. Stage status

| Stage | Result | Merge |
|---|---|---|
| 1 Alignment | done | pushed |
| 2 Graph store | done (F204, F205) | merged |
| 3 Interceptor + audit | done (F206) | merged |
| 4 Mutations | done (F208) | merged |
| 5 Protected data | done (F209, no default key provider) | `8837556` |
| 6 Sync | done, two review rounds (F210–F212) | `961830d` |
| **7 Retire + harden CI** | **approved 22 September (F210 verified by direct read; F213 ruled — keep the column)** | **`dec4eb3`** (merged `--no-ff`, 22 September) |
| **8 Spec sweep (priority slice) + RST-33** | **reviewed 22 September (F130 closure confirmed; F215 confirmed; F214 ruled — design accepted, build deferred to Stage 9)** | **`5897b7b`** (merged `--no-ff`, 22 September) |
| **9 The real shell bootstrap** | **blocked four times, all ruled (F216, F217, F218, F219, all 22 Sept); brief updated in place; `stage-9-shell-bootstrap-v3` is in progress with sound preliminary code, continuing past F219's fix; three earlier branches abandoned with no bootstrap code** | — |
| **10 The Reconnect shell state** | **briefed (was "Stage 9"); blocked on Stage 9** | — |

**Stage 7 facts to remember:**
- Branch `stage-7-retire` at `d749c3c`. Green slow lane: https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/35637057091. `main` was green at `961830d`/`4d91705` before branching.
- CI Postgres image (unchanged since Stage 6): `ghcr.io/shaheerjameel17/vulto-for-professional-services/ci-postgres@sha256:eec77295062736b9aa8468fe3f370b5a9e89931e4887827ead61d1c0e5792cfe`.
- **After the merge:** the `ci-image` workflow republishes without Rust (the Dockerfile no longer installs it). Read the new digest from that run and repin `CI_IMAGE` in `.github/workflows/ci-image-ref.env` before trusting a fresh CI run's timing, per the report's section 10.
- `device.revoke` intentionally does not gate `protected.read` or any tRPC mutation — only the shape proxy checks `device_workspace_revocation`. Confirmed against `VPS-F001`'s own contract (workspace-scoped cache/sync trust only). Not a gap; no code follows from it. See Amendments dated 22 September for the full reasoning.
- Rulings made in the Stage 7 review: see Amendments dated 22 September (the merge verdict, the device-revoke scope confirmation, F213).

## 6. Stage 7 review — closed, 22 September 2026

Every checklist item from the Stage 7 brief was verified by direct code read, not just the report (F210's migration and its test, F212's CI job list, the accessibility gate, the done-criteria grep, the adversarial suite, the findings recount reproduced programmatically, `CLAUDE.md`/`Bootstrap.md`/`CONTRIBUTING.md`, the file/line diff stat). Full reasoning is in the Amendments entry dated 22 September. Merge completed cleanly (verified: the net diff from the merge commit to the final head touches only the three intended files — a stray 602-file commit from the reviewer's own worktree cleanup was caught and fully reverted the same day, confirmed by diff, not by trusting the report).

## 7. Stage 8 review — closed, 22 September 2026

Every checklist item from the Stage 8 brief (below) was checked against the code, not just the report: `rowScopeSatisfied`/`decideRead`/`resolveReaderSet` read in full and cross-checked against the policy table and the temporal edge-filtering in `graph/store.ts`; the `Employee` registry entry confirmed byte-for-byte unchanged via `git show`; `FEATURE_LIFECYCLE_NODE_TYPES`'s symmetric client/server refusal confirmed; `employeeLinkUser`'s bidirectional uniqueness read in full; the four F130 subject-exclusion tests read in full, including the sentinel-string end-to-end proof; the `transitionStatus` status-table and stale-state test read in full; the import-equivalence test read in full; the `VPS-D004` F214 marker checked against the actual section text; the findings recount independently reproduced by parsing every `| F<n> |` row (161 rows, F54–F215, one gap at F198, 146 closed, 9 open — exact match). The mutation-testing pass/fail counts were not re-run (no `pnpm` on the linked machine in this session) but are consistent with the test bodies read. Full ruling in the Amendments entry dated 22 September (Stage 8 review). Three outcomes: **F130 closure confirmed**, no action; **F215's three sub-decisions confirmed**, plus a small follow-up (define "team" in `VPS-A004`'s own matrix, since it names "own + team" but never defines "team"); **F214 ruled** — the proposed single `Reconnect` state is accepted, with both tradeoffs decided as recommended (a missing session goes to sign-in, not `Reconnect`; nothing is erased on a plain `401`, safe only because the device cache is Tier 0 only) — but the actual UI and wiring are **not** built in this pass; that was briefed as Stage 9. `VPS-D004` and `VPS-A004` got their text corrected in that pass; the merge, the `Foundations_Findings.md` updates and the Linear status were Claude Code's to apply per the ruling.

## 8. Stage 9 review — F216, then F217, then F218, then F219, all ruled

**First attempt (`stage-9-reconnect-shell`), F216.** OpenAI Codex, a fresh session, stopped correctly before writing any UI. Verified directly: `apps/roster-web`'s entire shell is fixture-only — `Shell.tsx` hardcodes `workspaceName` and `syncStatus` as literals; `createGraphClient` is mounted nowhere but `/sync-harness`; `useSession` appears only on `/auth-ready` and `/devices`, outside the shell; `SyncEngine.#handleRevoked` stops every source before any retry could reuse it. This is `FDN-69` (the shell/workspace bootstrap), never built, sitting in Backlog since before Stage 1. F216 ruled: Better Auth's `organization()` plugin and `session.activeOrganizationId` already exist server-side; the gap is that `auth-client.ts` never added `organizationClient()` client-side. Redefined Stage 9 as the minimal real bootstrap and renumbered the original Reconnect brief Stage 10.

**Second attempt (`stage-9-shell-bootstrap`), F217.** Codex, another fresh session, traced the corrected brief before writing code and stopped again, correctly: F216's ruling assumed `session.activeOrganizationId` was already populated somewhere. Verified directly: `createWorkspace` → `confirmWorkspaceAdmission` never touches it; the only production write anywhere is the revocation path's clear-to-null. Offline, each `(workspace, user)` cache has no marker of which was last active, and the device-identity database is deliberately, test-enforced narrow. F216's ruling should have checked this and didn't — that gap was this review's, not either builder's. F217 ruled: `confirmWorkspaceAdmission` now sets the active organization when the confirmed membership is the person's sole active one (never auto-switching someone already active elsewhere); a null active organization with exactly one active membership resolves to it; more than one, online or off, is never silently picked — it's the same undesigned workspace-switching gap already on the follow-up list. The Stage 9 section in Part 3 was updated in place with both fixes rather than left as two amendments to reconcile later.

**Third attempt (`stage-9-shell-bootstrap-v2`), F218.** Codex, a third fresh session, traced the twice-corrected brief before writing code and stopped a third time, correctly: the F217-updated point 1 ("no data after `isPending` clears" unconditionally means sign in) and point 4 (a cold offline boot mounts from cache, no network call) both fire on a cold offline load, since `useSession()` also resolves to "no data" once it gives up trying to reach the server. Verified directly against the pinned client (`session-atom.mjs`, Better Auth 1.6.29): a request that reached the server — a genuine no-session answer or any HTTP-level failure — sets `data: null` with `error` either `null` or a `BetterFetchError` (always carries a numeric `.status`); a request that never reached the server sets `data: null` with whatever the fetch layer itself threw, never a `BetterFetchError`, no numeric `.status`. That distinction was already sitting in the client, unused. F218 ruled: point 1 fires only on a confirmed answer (`error` null or with a numeric `.status`); an `error` without one is indeterminate and falls through to point 4 instead. Point 4 gained the one clause its wording lacked — when point 1 couldn't resolve at all, there is no known user to filter cached workspaces by, so enumerate every cache on the device unfiltered, same one-cache-mounts rule. Grounded in a split the sync engine already makes for the identical reason (`engine.ts`'s `"network"` vs `"unauthenticated"` failure kinds) — no new mechanism invented.

**Fourth attempt (`stage-9-shell-bootstrap-v3`, FDN-117), F219 — different in kind.** Codex implemented the F216/F217/F218-corrected brief and, for the first time, actually exercised it in a real browser rather than tracing it before writing code. That's exactly what surfaced F219: point 3's `organizationClient()` design calls Better Auth's `organization.list()`, and `services/api/src/auth/http.ts` returns 404 for every `/api/auth/organization/*` route — reads included, by deliberate design (the route's own comment cites FDN-85/FDN-86's "no second write path" boundary). Verified directly: `trpc.ts`'s `createContext` also confirms there is no existing workspace-independent authenticated read anywhere in the API — every `protectedProcedure` needs `session.activeOrganizationId` already resolved, which is exactly the value this fallback exists to produce. F219 ruled: no organization route opens; one new narrow route, `POST /workspace/list-active-memberships`, session-gated with no workspace scope (mirroring the existing `/devices/retire`), returns only the caller's active/confirmed memberships via the same predicate already used twice elsewhere in the codebase. **Unlike the first three findings, this one does not restart the branch** — the rest of `stage-9-shell-bootstrap-v3`'s preliminary work (the F218 split, offline fallback, graph client mount, refusal-signal wiring, sync-client changes) was read directly and is sound; only the one blocked call needs replacing. `VPS-F001` got one bullet added recording the boundary this finding made explicit.

**Pattern worth naming.** Four stops in a row on the same stage is not the loop failing — it's exactly what "read the code, not the report" and "no recorded exceptions where a clean fix exists" are for. Every finding was real, every builder stopped instead of inventing a design locally, and every ruling was grounded in code or a pattern that already existed (Better Auth's org plugin; the `revokeWorkspaceAdmission` membership-check pattern; the sync engine's own network-vs-auth failure split; `requireCurrentWorkspaceSession`'s own membership predicate) rather than new machinery. F218 came from wording *this review itself* introduced in the F217 fix; F219 was only reachable by actually running the code, not by re-reading a brief harder — a reminder that "trace before writing code" catches design gaps, but some gaps only show up once something real is called. If a fifth attempt stops again, treat it the same way: verify before ruling, don't assume the brief is complete just because rounds have passed.

## 9. Stage 9 — the real shell bootstrap (briefed, F216 + F217 + F218 + F219)

Full brief in `docs/Claude_Code_Build_Prompt.md` Part 3 (updated in place for F219 — read it directly, don't reconstruct it from this summary or from the Amendments entries). Scope: a new `POST /workspace/list-active-memberships` route (session-gated, no workspace scope) replacing the `organizationClient()` design F219 ruled out; set `session.activeOrganizationId` server-side in `confirmWorkspaceAdmission` for a person's sole active membership; a sign-in path gated on a *confirmed* no-session answer (`error` null or carrying a numeric `.status`), not merely "no data"; a real `createGraphClient` mount, replacing `Shell.tsx`'s fixture props; offline cold start from a single `session_hint` cache, enumerated without a user filter when no session ever resolved (more than one cached workspace is unresolved, not a silent pick); a `401`/`access-revoked` signal exposed at the shell boundary (not rendered — that's Stage 10). No fixture screen is touched. `FDN-114` (Stage 10), `FDN-115` and `FDN-116` (the two abandoned earlier Stage 9 attempts) all stay as-is. **`FDN-117` and branch `stage-9-shell-bootstrap-v3` continue** — this is the one exception to "start fresh": F219's preliminary code is sound apart from the one blocked call, so the fix lands on the same branch, not a new one.

**What to check in the Stage 9 report:** that the new membership-list route excludes pending and revoked memberships (test both, not just the happy path) and that no `/api/auth/organization/*` call survives anywhere in the diff; that the `confirmWorkspaceAdmission` change is genuinely what closes F217's gap; that a second-workspace creation/join by someone already active elsewhere does not switch them (test, not assertion); that no screen outside the shell's own bootstrap changed; that offline boot was tested for both the single-cache and multi-cache cases, not just reasoned about; that the sign-in-vs-offline split was tested with an actual network-level failure, not a mocked 401 or a mocked empty response standing in for offline; that the refusal-signal shape is documented well enough for Stage 10 to consume without re-deriving it; and that "no session" truly never triggers a workspace call.

## 10. Stage 10 — the Reconnect shell state (briefed, blocked on Stage 9)

F214's design is ruled (Stage 8 review) and unchanged in substance. Once Stage 9 lands: build the single `Reconnect` state in `apps/roster-web` consuming Stage 9's exposed refusal signal (trigger only on `401`/`UNAUTHORIZED` or `access-revoked`, never network failure/timeout/5xx; full-bleed, one **Retry** that re-runs Stage 9's bootstrap, not a literal call re-issue; a missing session routes to sign-in, already Stage 9's job); require a browser test proving cold-start and mid-session render identically and that Retry actually recovers. `FDN-114` is its Linear issue, already filed and In Progress.

## 11. After Stage 9 / Stage 10

- The next feature brief (after Stage 10, or interleaved if the founder prioritizes differently) covers whichever `VRS-001` MVP-order feature follows RST-33, correcting that feature's own FDN-104 specs just-in-time. Note: it was VRS-F003 (Multi-Entity/Jurisdiction) or VRS-F004 (Working Calendar) in the MVP order before this detour — neither depends on the shell bootstrap, so either could run in parallel with Stage 9/10 if the founder wants to keep two threads moving.
- Open follow-ups:
  - KEK rotation (FDN-96 follow-up list);
  - k-anonymity enforcement when analytics features arrive;
  - F125 (backdated `managed_by`, decided in VRS-F037);
  - workspace switching (the client is fail-closed until it is designed — related to but not solved by Stage 9's single-workspace bootstrap; a user with more than one `activeOrganizationId` option is still unhandled);
  - FDN-110 before the first real-data pilot;
  - F213 (`member.projection_state`), scoped into the FDN-104 spec sweep per the 22 September ruling — not yet revisited, FDN-104's remaining specs are still just-in-time;
  - Migrating the remaining fixture screens (Home, People, Timesheets, Foundations) off fixture data — explicitly out of Stage 9's scope, not yet briefed as its own stage.

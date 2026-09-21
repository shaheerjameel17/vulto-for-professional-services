# Reviewer Handoff — state for the founder's review chat

**Purpose.** This file lets a fresh Claude chat (the *reviewer*, not Claude Code) resume reviewing the server-authoritative rebuild with no re-explanation. Keep it current: the reviewer updates it at each stage boundary.
**Last updated:** 22 September 2026, after ruling on F216 (Stage 9 blocked before implementation). Stage 7 merged into `main` as `dec4eb3`; Stage 8 merged as `5897b7b`, reviewed and ruled (F130 closed, F215 confirmed, F214 ruled). Stage 9 (originally briefed as the Reconnect shell state) was traced by the builder before implementation, found the shell was never wired to the real backend at all, and stopped with F216 rather than inventing a bootstrap design as an implementation detail — the correct call under this project's decision policy. F216 is now ruled: Stage 9 is redefined as the minimal real shell bootstrap, and the original Reconnect brief is renumbered Stage 10. `stage-9-reconnect-shell` (branch, pushed) holds only F216's discovery and the blocked report; no Reconnect code exists yet. This round, the builder was OpenAI Codex, not Claude Code — the loop is agent-agnostic; see section 1.

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
| Findings (F54–F213, one gap at F198) | `docs/Foundations_Findings.md` (the table is authoritative; the count paragraph is recounted programmatically) |
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
| **9 The real shell bootstrap** | **F216 ruled 22 September (Stage 9 redefined; original Reconnect brief renumbered Stage 10); branch `stage-9-reconnect-shell` holds only the F216 discovery so far, no bootstrap code yet** | — |
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

## 8. Stage 9 review — F216 ruled, 22 September 2026

The Stage 9 (Reconnect) brief went to a different builder this round — OpenAI Codex, not Claude Code, in a fresh session against the same repo — and it stopped correctly before writing any UI. Verified directly, not taken on the report's word: `apps/roster-web`'s entire shell is fixture-only — `Shell.tsx` hardcodes `workspaceName` and `syncStatus` as literals; `createGraphClient` is mounted nowhere but the `/sync-harness` diagnostic route; `useSession` appears only on `/auth-ready` and `/devices`, outside the shell; `SyncEngine.#handleRevoked` stops every source before any retry could reuse it. This is `FDN-69` (the shell/workspace bootstrap), never built, sitting in Backlog since before Stage 1 — Reconnect assumed it already existed. F216 records this and is now ruled, not left open: Better Auth's `organization()` plugin is already configured server-side and the session already carries `activeOrganizationId`; the only gap is that `apps/roster-web/src/lib/auth-client.ts` never added `organizationClient()` client-side to read it. The ruling redefines **Stage 9** as the minimal real bootstrap (no session → sign-in; a session → resolve `activeOrganizationId`, mount the real graph client, replace the shell's fixture props; offline cold start still boots from `session_hint` with no network call; a `401`/`access-revoked` is surfaced to the shell, not rendered) — explicitly **not** a migration of every screen off fixtures — and renumbers the original Reconnect brief **Stage 10**, which depends on it. Full ruling in the Amendments entry dated 22 September (F216 ruling). The founder chose this sequencing explicitly over deferring shell-wiring or doing a full FDN-69 migration in one pass.

## 9. Stage 9 — the real shell bootstrap (briefed, F216)

Full brief in `docs/Claude_Code_Build_Prompt.md` Part 3. Scope: wire `organizationClient()` into `auth-client.ts`; a Better-Auth-session-but-no-workspace-call sign-in path; a real `createGraphClient` mount using `user.id` + `session.activeOrganizationId`, replacing `Shell.tsx`'s fixture props; offline cold start from `session_hint`; a `401`/`access-revoked` signal exposed at the shell boundary (not rendered — that's Stage 10). No fixture screen (Home, People, Timesheets, Foundations) is touched. `FDN-114` stays Stage 10's issue; file a new Team FDN issue for this stage.

**What to check in the Stage 9 report:** that `organizationClient()` (or an explained alternative) is genuinely what closed the gap; that no screen outside the shell's own bootstrap changed; that offline boot was tested, not just reasoned about; that the refusal-signal shape is documented well enough for Stage 10 to consume without re-deriving it; and that "no session" truly never triggers a workspace call.

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

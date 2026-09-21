# Reviewer Handoff — state for the founder's review chat

**Purpose.** This file lets a fresh Claude chat (the *reviewer*, not Claude Code) resume reviewing the server-authoritative rebuild with no re-explanation. Keep it current: the reviewer updates it at each stage boundary.
**Last updated:** 22 September 2026, after reviewing and ruling on the Stage 8 report. Stage 7 is merged into `main` as `dec4eb3`; F213 closed in `906d7fa`; CI image repinned in `397f38b`, both lanes green on it. Stage 8 (`c733763` on `stage-8-employee-profile`) is reviewed and ruled — F130 confirmed closed, F215 confirmed, F214 ruled (design accepted, build deferred to Stage 9) — and awaiting Claude Code's merge; the merge commit still needs to be recorded here once reported.

---

## 1. Roles and working method

- **Shaheer (founder)** is not an engineer. He relays between two agents: Claude Code builds; the reviewer (you) reviews and rules.
- **Loop:** Claude Code finishes a stage, then writes `docs/stage-reports/STAGE-N_*.md` and stops. Shaheer pastes its summary to the reviewer. The reviewer reads the report **and the code directly** (via the linked-computer shell, repo mounted at `$HOME/mnt/vulto-for-professional-services`). The reviewer gives a verdict, rulings on open findings, and one fenced block of paste-ready text for Claude Code. Claude Code applies the fixes, merges with `--no-ff` when CI is green, and waits for "Stage N go".
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
| **8 Spec sweep (priority slice) + RST-33** | **reviewed 22 September (F130 closure confirmed; F215 confirmed; F214 ruled — design accepted, build deferred to Stage 9)** | pending — awaiting merge |

**Stage 7 facts to remember:**
- Branch `stage-7-retire` at `d749c3c`. Green slow lane: https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/35637057091. `main` was green at `961830d`/`4d91705` before branching.
- CI Postgres image (unchanged since Stage 6): `ghcr.io/shaheerjameel17/vulto-for-professional-services/ci-postgres@sha256:eec77295062736b9aa8468fe3f370b5a9e89931e4887827ead61d1c0e5792cfe`.
- **After the merge:** the `ci-image` workflow republishes without Rust (the Dockerfile no longer installs it). Read the new digest from that run and repin `CI_IMAGE` in `.github/workflows/ci-image-ref.env` before trusting a fresh CI run's timing, per the report's section 10.
- `device.revoke` intentionally does not gate `protected.read` or any tRPC mutation — only the shape proxy checks `device_workspace_revocation`. Confirmed against `VPS-F001`'s own contract (workspace-scoped cache/sync trust only). Not a gap; no code follows from it. See Amendments dated 22 September for the full reasoning.
- Rulings made in the Stage 7 review: see Amendments dated 22 September (the merge verdict, the device-revoke scope confirmation, F213).

## 6. Stage 7 review — closed, 22 September 2026

Every checklist item from the Stage 7 brief was verified by direct code read, not just the report (F210's migration and its test, F212's CI job list, the accessibility gate, the done-criteria grep, the adversarial suite, the findings recount reproduced programmatically, `CLAUDE.md`/`Bootstrap.md`/`CONTRIBUTING.md`, the file/line diff stat). Full reasoning is in the Amendments entry dated 22 September. Merge completed cleanly (verified: the net diff from the merge commit to the final head touches only the three intended files — a stray 602-file commit from the reviewer's own worktree cleanup was caught and fully reverted the same day, confirmed by diff, not by trusting the report).

## 7. Stage 8 review — closed, 22 September 2026

Every checklist item from the Stage 8 brief (below) was checked against the code, not just the report: `rowScopeSatisfied`/`decideRead`/`resolveReaderSet` read in full and cross-checked against the policy table and the temporal edge-filtering in `graph/store.ts`; the `Employee` registry entry confirmed byte-for-byte unchanged via `git show`; `FEATURE_LIFECYCLE_NODE_TYPES`'s symmetric client/server refusal confirmed; `employeeLinkUser`'s bidirectional uniqueness read in full; the four F130 subject-exclusion tests read in full, including the sentinel-string end-to-end proof; the `transitionStatus` status-table and stale-state test read in full; the import-equivalence test read in full; the `VPS-D004` F214 marker checked against the actual section text; the findings recount independently reproduced by parsing every `| F<n> |` row (161 rows, F54–F215, one gap at F198, 146 closed, 9 open — exact match). The mutation-testing pass/fail counts were not re-run (no `pnpm` on the linked machine in this session) but are consistent with the test bodies read. Full ruling in the Amendments entry dated 22 September (Stage 8 review). Three outcomes: **F130 closure confirmed**, no action; **F215's three sub-decisions confirmed**, plus a small follow-up (define "team" in `VPS-A004`'s own matrix, since it names "own + team" but never defines "team"); **F214 ruled** — the proposed single `Reconnect` state is accepted, with both tradeoffs decided as recommended (a missing session goes to sign-in, not `Reconnect`; nothing is erased on a plain `401`, safe only because the device cache is Tier 0 only) — but the actual UI and wiring are **not** built in this pass; that is **Stage 9**, briefed separately. `VPS-D004` and `VPS-A004` get their text corrected now; the merge, the `Foundations_Findings.md` updates and the Linear status are Claude Code's to apply per the ruling.

## 8. Stage 9 — the Reconnect shell state (not yet briefed)

F214's design is ruled (see above and the Amendments entry) but not built. When briefing Stage 9: build the single `Reconnect` state in `apps/roster-web` per the accepted design (trigger only on `401`/`UNAUTHORIZED` or `access-revoked`, never on a network failure/timeout/5xx; full-bleed, one **Retry**; a missing session routes to sign-in instead); wire it into the tRPC client's error handling and the shape proxy's `access-revoked` response; and require a browser test proving cold-start and mid-session render identically and that Retry actually re-issues the failed call. This is the first client shell feature since Stage 7 retired the old one, so treat it as its own reviewed stage, not a follow-up patch.

## 9. After Stage 8 / Stage 9

- The next feature brief (after Stage 9, or before it if the founder prioritizes differently) covers whichever `VRS-001` MVP-order feature follows RST-33, correcting that feature's own FDN-104 specs just-in-time.
- Open follow-ups:
  - KEK rotation (FDN-96 follow-up list);
  - k-anonymity enforcement when analytics features arrive;
  - F125 (backdated `managed_by`, decided in VRS-F037);
  - workspace switching (the client is fail-closed until it is designed);
  - FDN-110 before the first real-data pilot;
  - F213 (`member.projection_state`), scoped into the FDN-104 spec sweep per the 22 September ruling — not yet revisited, FDN-104's remaining specs are still just-in-time;
  - Stage 9 (the Reconnect shell state) itself, per F214's ruling above.

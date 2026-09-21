# Reviewer Handoff — state for the founder's review chat

**Purpose.** This file lets a fresh Claude chat (the *reviewer*, not Claude Code) resume reviewing the server-authoritative rebuild with no re-explanation. Keep it current: the reviewer updates it at each stage boundary.
**Last updated:** 21 September 2026, after Stage 6 merged (`main` at `961830d`, plus the commit adding this file).

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
| Stage reports | `docs/stage-reports/STAGE-1…6_*.md` |
| Findings (F54–F212) | `docs/Foundations_Findings.md` (the table is authoritative; the count paragraph is recounted programmatically) |
| Specs | `docs/Vulto_Specs/` — A001–A008, F001/F004/F007, VPS-002/003, VRS-001 |
| Agent rules | `CLAUDE.md` |
| Linear | Team FDN. Stage 6 = FDN-99/100/101 (Done). Stage 7 = FDN-103, FDN-54. Deferred: FDN-104 (spec sweep), FDN-110 (pentest). Roster features start at RST-33 |

## 5. Stage status

| Stage | Result | Merge |
|---|---|---|
| 1 Alignment | done | pushed |
| 2 Graph store | done (F204, F205) | merged |
| 3 Interceptor + audit | done (F206) | merged |
| 4 Mutations | done (F208) | merged |
| 5 Protected data | done (F209, no default key provider) | `8837556` |
| 6 Sync | done, two review rounds (F210–F212) | `961830d` |
| **7 Retire + harden CI** | **next — awaiting "Stage 7 go"** | — |

**Stage 6 facts to remember:**
- CI Postgres image `ghcr.io/shaheerjameel17/vulto-for-professional-services/ci-postgres@sha256:eec77295062736b9aa8468fe3f370b5a9e89931e4887827ead61d1c0e5792cfe`.
- Green slow lane: https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/35623142491.
- Rulings made in Stage 6: see Amendments dated 21 September (the proxy workspace header, F210, the device-side rules).

## 6. What to check in the Stage 7 report

1. Local `main` at `961830d` was green on GitHub before branching.
2. **F210:** `device_workspace_revocation` is created, backfilled, and repointed before `device_unlock_secret` is dropped. A test proves a pre-migration revoke survives. Read the migration yourself.
3. **F212:** the `device-store-browser` job, config and suite are deleted. No disabled or skipped jobs remain, except `publish-artifacts` off `main`.
4. The accessibility smoke pass runs again in a live suite, green in CI.
5. The done-criteria grep (`loro|sync-engine|sealed-store|shamir|tier1-envelope`) hits only historical docs. No Rust files remain. `loro-crdt` and `shamir-secret-sharing` are removed.
6. The FDN-54 adversarial suite covers all seven cases in brief item 6. Spot-read two or three tests to confirm they assert the refusal and that nothing was written.
7. Dropped tables are listed. Nothing Stage 6 imports was deleted (`sync-ticket.ts` in particular).
8. The `CLAUDE.md` archive sentence was replaced. `Bootstrap.md` and `CONTRIBUTING.md` are rewritten. The findings recount is done.
9. A green CI run link on the branch, then a `--no-ff` merge.

## 7. After Stage 7

- The brief's Part 4 says stop. The next brief covers:
  - the FDN-104 spec sweep (includes the Client-ownership disagreement from Stage 3);
  - the first Roster feature, RST-33 (canonical Employee profile). It unlocks Manager scope, subject exclusion and F130 (`resolveEmployeeForUser` returns null until then).
- Open follow-ups:
  - KEK rotation (FDN-96 follow-up list);
  - k-anonymity enforcement when analytics features arrive;
  - F125 (backdated `managed_by`, decided in VRS-F037);
  - workspace switching (the client is fail-closed until it is designed);
  - FDN-110 before the first real-data pilot.

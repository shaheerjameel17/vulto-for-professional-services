# Reviewer Role — operating instructions

This document is for whichever Claude session is acting as **the reviewer** on Vulto Roster's server-authoritative rebuild. It is mechanics, not history — read this once per new session, then go to the history docs below for everything about the project itself. If this file and your own judgment ever conflict with something Shaheer says directly in chat, his direct instruction in that conversation wins; this file is a standing default, not an override of him.

## Who the reviewer is

Shaheer Jameel (founder/CEO, Vulto/Xelerate Lab, Islamabad) runs a two-agent build pipeline for this rebuild:

- **Codex** is the builder. It works via git branches and Linear issues, in its own environment, following the brief in `docs/Claude_Code_Build_Prompt.md`.
- **The reviewer** (you) verifies Codex's work directly against the actual code — never from its report's prose alone — rules on findings using standing founder-delegated authority, documents rulings, and writes each next stage's brief before Codex resumes.

Shaheer relays messages between the two of you by hand (Codex is not in this conversation and cannot read it). Every ruling, finding and brief you produce needs to survive being copy-pasted to a separate agent with no shared context — write self-contained prose, not shorthand that only makes sense here.

**Standing authority.** Rule directly, without asking Shaheer, whenever a finding traces to existing precedent in the codebase or in `docs/Foundations_Findings.md` — this has been the norm for the overwhelming majority of findings across every stage so far. Escalate to Shaheer (via `AskUserQuestion`, with a clear recommendation) only for a genuine architectural fork: a product or mechanism question with no existing precedent to trace to, where reasonable people could land in different places and the choice has lasting consequences. When in doubt, look for precedent first — it is almost always there.

## Repo access

The repo lives on Shaheer's linked Mac at `/Users/shaheerjameel/Development/vulto-for-professional-services`, reachable through `mcp__remote-devices__device_bash` at `$HOME/mnt/vulto-for-professional-services` (load the tool via `ToolSearch` first if it is deferred). This is Shaheer's real, live working tree — Codex may be actively editing it in its own session at the same time yours runs. Before any git operation that could discard work, run `git status` and `git branch --show-current`; never `checkout`/`reset`/`clean` without checking for uncommitted changes first, and never assume the tree is idle.

**Git-branch discipline for your own doc commits**, established after a real mistake earlier in this project — follow it exactly every time:
1. `git branch --show-current` before any reviewer-doc commit.
2. If not on `main`, `git checkout main` first (uncommitted changes you are about to write carry over cleanly as long as nothing conflicts).
3. Commit your doc changes on `main`.
4. If a Codex branch needs your fix merged in (e.g. a corrected spec it should build against), `git checkout <branch> && git merge main -m "..."`, then `git checkout main` to rest there.
5. Never touch a Codex branch's own files yourself — you write reviewer docs and, occasionally, small declarative registry entries; Codex writes all application/product code.

**Commit attribution**, every commit:
```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<this session's own id>
```

**Doc-editing pattern.** For any edit to the three canonical docs below, write a Python script via a `device_bash` heredoc (`cat > ~/fix_scripts/fix_NNN.py << 'PYEOF' ... PYEOF`), guard every replacement with `assert content.count(old) == 1` (or an explicit count) before writing, run it, then `git diff --stat` and spot-read the diff before committing. This has caught real mistakes (an anchor string appearing twice) before they became bad commits.

## The three canonical docs — read in this order

1. **`docs/Reviewer_Handoff.md`** — the master reviewer state file. Read this first, in full or at least its stage-status table and its most recent numbered section. It has the complete stage-by-stage history, every ruling's full reasoning, and a "What to check" checklist for every stage's completion review.
2. **`docs/Foundations_Findings.md`** — the master findings ledger. Every numbered finding (F1 upward), its table row and (for most) a full detail section. The running recount sentence at the end of the findings table tells you the current total, closed count, and open count — treat a mismatch between that sentence and the actual `| F<n> |` rows as a red flag worth reconciling, not ignoring.
3. **`docs/Claude_Code_Build_Prompt.md`** — the master build-instruction document Codex actually builds from. Part 3 has one section per stage: Do items, Done criteria, Gates, and the report checklist. When you brief a new stage, this is where the brief goes — `Reviewer_Handoff.md`'s own section for that stage stays a narrative summary and a pointer here, never a duplicate of the Do items.

Do not reconstruct project history from memory or from this conversation's earlier turns — always read the live docs, since Codex or an earlier session may have changed them since you last saw them.

## Standing verification discipline

Never approve a stage, or accept a finding's fix, from a completion report's prose alone. Every prior stage (14 through 22 and counting) has received a full pre-merge review reading the actual `git diff` against the ruled specification — this is unbroken practice, not optional. Concretely, before merging a "complete" stage:

- Read the actual diff for the commit(s) since the brief, not just the stage report.
- Confirm each ruled mechanism's real implementation matches what was specified, file and function by file and function.
- Read the new/changed tests in full and confirm they exercise the real boundary (e.g. a teammate who genuinely IS readable under a wider grant, but still correctly excluded from a narrower one) rather than a tautology.
- Run what you actually can: `tsc --noEmit` (no Postgres needed) and any local-cache-only test file (anything under `packages/graph/src/queries/*.test.ts`, using `SqliteCache`/`openTestDatabase` — these run without Docker). The `services/api` integration suite needs a live Postgres via `pnpm stack:up`, which this reviewing shell typically cannot run (no Docker, no root) — say so plainly rather than claiming to have run it; this is a disclosed, accepted limitation with its own precedent (Stage 19's review).
- `git diff --stat` against the merge base to confirm no `apps/` file and no governing spec/build-prompt/findings file was touched by Codex unless the stage's own brief called for it.
- Independently check every OTHER caller of a pattern a finding concerns, not only the ones Codex's own report named — this has found genuine, previously-undiscovered instances more than once (F295 is the clearest example).

If the review turns up nothing: merge the branch into `main` with `--no-ff`, write the completion-review paragraph into `Reviewer_Handoff.md`'s numbered section for that stage (matching the style of every prior one — specific files, specific functions, specific test names, not a generic "looks good"), update the stage-status table, and write the next stage's brief in the same sitting, per unbroken practice — checking the next feature directly against the code before writing its brief, the same way every stage's own brief has been produced. Only stop and wait for Shaheer at the actual stage boundary (report written, Linear updated) — writing the next brief is your own job, not something that needs his go-ahead first.

If the review finds something: rule it (directly or via escalation, per the authority section above), document it across the three docs, and hand Shaheer a resume prompt for Codex plus whatever Linear content he needs to paste or a connected Linear tool needs executed.

## Linear

Linear may or may not be connected in your session — check with `ToolSearch` for Linear tools early (query `"Linear"` alone is enough; it has come back empty for the entire history of this project so far, most recently reconfirmed 25 September 2026, twice more later that day with `"Linear"` and `"linear issue"` — Shaheer has twice believed it connected when a fresh `ToolSearch` found nothing, so verify with a real tool call rather than taking his word or an earlier session's note for it). If connected, use it directly: create/update issues, post comments, move statuses — don't hand Shaheer copy-paste blocks for something you can just do. If not connected, fall back to giving Shaheer exact, ready-to-paste text for every issue/comment/status change, clearly labeled by target issue.

Two Linear teams are in play: **RST** (one issue per rebuild stage, e.g. `RST-49` for Stage 21, `RST-50` for Stage 22) and **FDN** (older foundational-work issues, largely predating the stage-by-stage rebuild). `Reviewer_Handoff.md`'s stage-status table names the RST issue for every stage. FDN issue numbers are scattered through `Reviewer_Handoff.md`'s and `Foundations_Findings.md`'s prose wherever they're relevant to a specific finding or piece of foundational work — grep for the number before assuming its status.

**Executed 25 September 2026, once Linear connected later that day:** `RST-50` Done; `FDN-104` In Progress; `FDN-115`/`FDN-116` Canceled (superseded by `FDN-117`); `FDN-89` confirmed In Progress (`reader-set.ts` is self-described "FDN-89 (partial)"); `RST-51` filed. The 26-issue FDN backlog was audited: none built, all stay in Backlog (comments added on `FDN-62`, whose local half `RST-51` delivers, and `FDN-69`, whose minimal bootstrap Stages 9–10 shipped; `FDN-49` needs re-scoping before anyone starts it). Not done: a refreshed project status update (the last, 24 September, on Time Tracking & Utilization, is stale). The list below is kept for history; confirm before acting on any of it.

**Outstanding as of 25 September 2026, not yet executed** (confirm still true before acting — Shaheer or Codex may have already handled these):
- `FDN-104` should read **In Progress** (it's the ongoing, never-done-in-one-pass spec sweep — see its own entries in `Foundations_Findings.md`), not whatever else it may currently show.
- `FDN-115` and `FDN-116` should be **Canceled** — both are abandoned early Stage 9 attempts, superseded by `FDN-117`, which succeeded and shipped.
- `FDN-89` was last confirmed **In Progress**, correctly, no change needed — but wasn't independently re-verified against `reader-set.ts`, only checked against the doc record.
- **A backlog audit was requested but never completed**: 26 issues sit in the FDN team's backlog, never reviewed by the reviewer (no Linear access at the time). If connected now, list them, cross-reference each against what's actually built (search `Foundations_Findings.md`/`Reviewer_Handoff.md` for the feature or finding it names), and recommend Done/Cancel/stays-in-backlog for each with a one-line reason — then execute, or hand Shaheer the list of recommended changes if he'd rather approve first.
- A project-level status update summarizing Stage 21's merge and Stage 22's brief was drafted for Shaheer to post; check whether it went up before drafting a fresh one.

## Right now, as of this doc's writing (25 September 2026, later)

Stage 21 (`VRS-F013`) merged as `414b8df`; Stage 22 (`VRS-F014`, Skill Matrix) merged as `cd17db0` with no findings (`Reviewer_Handoff.md` section 23). **Stage 23 (`VPS-F002`, Local-First Search) is briefed** — `Claude_Code_Build_Prompt.md` Part 3 Stage 23, `Reviewer_Handoff.md` section 24, `F297`–`F300` in `Foundations_Findings.md`, and `docs/Vulto_Specs/VPS-F002_Local-First_Search.md` corrected. F297 (the spec's SQLite FTS5 index cannot be built: the pinned `wa-sqlite@1.0.0` has no FTS3/4/5 module) was decided by the founder in favor of a trigger-maintained derived `cache_search` table; F298–F300 closed on precedent. Codex then stopped before product code on F301 (the brief wrongly said `verify:full` runs a browser suite; it runs none — `pnpm test:sync-browser` is separate); ruled the same day as an additional required gate plus one assertion in `sync.spec.ts`, brief corrected. Branch `codex/stage-23-local-first-search` resumes (not restarts) on it; `RST-51` is filed. Lesson worth keeping: before writing any gate or verification claim into a brief, read `package.json` and `.github/workflows/` rather than remembering them, and read the fixtures and helpers a test assertion names (F302: the brief named a seeded Employee `full_name` the browser suite never had, and a trigger design that could not survive nameless rows the suite already produced); and F303: a guard or rule written for one row shape must be checked against every real writer of that node type (Ghost creation nulls `full_name` and puts the role title in `job_title`) before it goes into a brief, and a brief's field assumptions should be audited against the code in one pass rather than discovered one stop at a time; and F304: before ruling that a brief may add or change a file, run the repository's own gates (`pnpm verify`, notably `scripts/arch-check.mjs`) against that exact file and line, since a brief that requires `pnpm verify` to pass cannot also require something `pnpm verify` rejects.

**Your next job is therefore to review Stage 23's implementation when Codex reports back**, using the "What to check in the Stage 23 report" list in `Reviewer_Handoff.md` section 24 and the standing verification discipline above (read the real diff; run `tsc --noEmit` and the `packages/graph` vitest suite genuinely; say plainly that the Postgres-backed suite cannot run in this shell). Then write Stage 24's brief in the same sitting: the register's next MVP-order feature after `VPS-F002` is `VPS-F003` (Notification and Alert Center) — check it directly against the code first, the same practice that caught F296 and F297. Note for that check: several earlier features already contain deferred `VPS-F003` hooks (for example `hrCompliance.sendReminder`, Stage 18), so look for those before writing the brief.

Linear housekeeping remains unexecuted because Linear is still not connected — see the Linear section for the outstanding list, including the 26-issue FDN backlog audit, which cannot be done without the issue list itself (ask Shaheer to paste or export the 26 backlog issues' IDs, titles and descriptions if Linear is still unavailable).

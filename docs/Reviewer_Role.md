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
- Read GitHub Actions for the branch and for `main` before merging. The repository is public (from 26 September 2026), so from the device shell: `curl -sS "https://api.github.com/repos/shaheerjameel17/vulto-for-professional-services/actions/runs?branch=<branch>&per_page=5"`, then `.../actions/runs/<id>/jobs` for the job and step conclusions. A red or unstarted job is a finding to explain; a job that fails with no step executed is an Actions-availability problem (the earlier private-repository allowance), not a code result. F305 went unnoticed for four days because nobody read the lane.
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

**Standing lessons (F304, F313, F315, F316, F317, F318, F319), each learned by building a brief on an unchecked assumption: (1) never name a file location, import or re-export, and never rule on one, without running `node scripts/arch-check.mjs` against a scratch file at that exact path with those exact imports; the gates are the authority on where code may live. (2) A done-criterion that greps the repository must exclude the ledger, findings and archives, which record history the builder may not edit. (3) Never assert that a guard, gate, helper or fixture exists, never write "reuse X" or "X shares Y", without opening X and grepping for Y on every side (server and client) it is claimed to cover. (4) When a brief promises that a mechanism will observe an event, trace the code that produces the event end to end (who writes it, in which transaction, through which path), not only the mechanism's own signal. (5) When a brief asserts a specific refusal reason, trace which gate refuses first (authorization runs before validation). (6) When a ruling adds or widens a grant, trace every write path that grant now opens, edges and node updates as well as creation, before closing it.**

**Docs layout, changed 26 September 2026 (see `docs/README.md`).** Finding detail sections now live one file per finding in `docs/findings/F<nnn>.md`; `docs/Foundations_Findings.md` keeps the recount, the status table and links. When recording a ruling, edit the finding's row in the index and its detail in its own file. Stages 1 to 22 of the build prompt and Handoff sections 6 to 23 are archived verbatim under `docs/archive/`; section and stage numbers are unchanged. Anywhere this document says "the detail section of F<n> in `Foundations_Findings.md`", read `docs/findings/F<n>.md`.

## Right now, as of this doc's writing (26 September 2026, after Stage 24)

**Stage 25 (`VPS-F003`) is merged (`e52fef0`, F307 to F320 closed by ruling, F321 a recorded fact, F322 open and low; Handoff section 26). Stage 26 (`VPS-F004`) is merged (`fc7ef42`, F323 to F326 closed by ruling, no new finding; Handoff section 27). Next action: brief Stage 27 — `VRS-001`'s MVP order after `VPS-F004` is `VRS-F018` (Leave Policy Engine); check it against the code first with every standing lesson, and keep the instruction to the builder to trace everything and report all contradictions once. Linear conventions are in Handoff section 27 (platform `VPS-*` stages belong to Foundation, `VRS-*` to Roster, each with a project and one Feature Type label).** Also pending: 92 Dependabot alerts to be handled as their own remediation stage.

**Update, later 26 September 2026:** F305 and F306 are closed (`main`'s slow lane at `70a4af1` green with `publish-artifacts` running), so ignore the "read `main`'s runs, close F305" step below. The next action is to brief Stage 25 (`VPS-F003`). Also open: 92 Dependabot alerts (8 critical, 36 high, mostly `next` and `fastify`); the founder was advised to treat them as their own remediation stage, runtime packages first, and not to bulk-merge Dependabot PRs.

Stages 21 to 24 are merged (`414b8df`, `cd17db0`, `b50ab85`, `cd73619`). **Stage 24 (`FDN-126`, the sync browser suite repair) was reviewed and merged with no findings**: the sync browser suite now seeds `Client`, a `src/` guard test fails if that stops being valid, and the branch's `fast-lane` and `slow-lane` were both green, read directly from the public Actions API. **F305 is still OPEN by design**: it closes when `main`'s own next slow lane is green with `publish-artifacts` running, and `main` has not been pushed since before Stage 23. First job in a fresh session: read `main`'s runs (`.../actions/runs?branch=main&per_page=5`); if the founder has pushed and the newest `slow-lane` and `fast-lane` are green with `publish-artifacts` run rather than skipped, close F305 in `Foundations_Findings.md` (row and recount: 251 rows, 237 closed, eight open) and note it in `Reviewer_Handoff.md` section 25; if `main` is still unpushed, ask the founder to push it.

Then **brief Stage 25**: the register's next MVP-order feature after `VPS-F002` is `VPS-F003` (Notification and Alert Center). Grep for the deferred `VPS-F003` hooks earlier stages left (for example `hrCompliance.sendReminder`, Stage 18) before writing it, and verify every gate and fixture the brief names by running or reading it: five briefs in a row reached the builder with an unverified claim (F301–F305), and the one thing that stopped the pattern was checking the exact change against the exact gate first (F304) and prototyping a fixture's test before specifying it (Stage 24). Prefer CI to local reinstalls: the shared working tree flips `node_modules` between the Mac's darwin binding and this VM's Linux one, so read the branch's `verify` and `sync-browser` results from the Actions API instead of running `pnpm install --force` here.

A small optional follow-up worth filing: `packages/graph`'s `tsconfig.json` still includes only `src/**`, so the sync browser suite's helpers and specs are not type-checked by any hermetic gate (see the Stage 24 review's observation 1).

Linear is connected. The repository is public; its history was scanned on 26 September for secrets and none was found; the founder was advised to enable secret scanning and push protection, protect `main` with the two workflows as required checks, restrict fork-PR workflows, ignore `.claude/` and `Claude outputs/`, and add `SECURITY.md` and a `LICENSE`.

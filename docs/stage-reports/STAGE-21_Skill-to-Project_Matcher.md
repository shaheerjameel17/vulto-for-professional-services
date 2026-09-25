# Stage 21 — Skill-to-Project Matcher

**Status:** Paused for reviewer ruling — partial implementation, not stage-complete
**Branch:** `codex/stage-21-skill-to-project-matcher`
**Linear issue:** RST-49 (In Progress)
**Date:** 2026-09-25

## Finding raised

### F288 — a Manager cannot attach a Project skill requirement under the current edge policy

**Ruled and merged from `main` before implementation resumed.** The Stage 21 brief requires a project Manager to call `project.attachSkillRequirement` and, when nobody matches, trigger a system-authored `SkillGap` in `afterCommit`. The corrected `VRS-F013` specification likewise says a project manager attaches the requirement. The existing `Project` policy row grants Manager `READ_ANY()`, while the proposed `Skill` row grants Manager `FULL_ANY()`. In `edgeRoleDecision`, writing `requires_skill` requires Full on **both** endpoints unless its edge registration declares an endpoint in `readSufficientEndpoints`. The `requires_skill` registration originally declared only the F285 `governingPartitions` fix. The reviewer ruled by F262's identical `assigned_to`/Project precedent: `requires_skill` now declares `readSufficientEndpoints: { Project: true }`, without widening Project's policy row.

### F289 — `has_skill`'s required proficiency metadata is discarded by the graph store

**Ruled and implemented at the store boundary.** Stage 21 item 1 requires `employee.attachSkill` to persist `has_skill.proficiency_level` and server-derived `verified`, `verified_by`, and `verified_at`, with duplicate attachments updating the existing edge in place. The matcher in item 7 must read that proficiency to decide whether an Employee qualifies. But `has_skill` has Employee as an endpoint, and Employee has a protected compensation partition. The old `insertEdge` check tested whether either endpoint had *any* protected partition and discarded all metadata; its integration test even asserted that for `managed_by` despite its declared Tier 0 `Employee:operational` governing partition. The reviewer ruled by the existing `edgeRoleDecision`/F136 partition precedent: classify edge metadata by its registered governing partition, failing closed if missing or non-zero. `insertEdge` now does so, and the new `graph.updateEdgeMetadata` generic Tier 0 mutation uses the same store-level classification for in-place updates. A focused live-Postgres store suite passes all 25 tests, including preservation for `managed_by` and stripping for undeclared `originated_from`/Pitch.

### F290 — SkillGap severity has no governing working calendar for a Project

`VRS-F013` G07 and Stage 21 item 6 require `SkillGap.severity` to count working days until `Project.start_date` through `VRS-F004`'s working-day helper. That helper (`resolvedDayOn`/`countWorkingDays`) requires a specific Employee because calendars come from that Employee's Entity assignment and potentially personal WorkingPattern. Project is only a minimal `VRS-F005` bootstrap node (`name`, lifecycle; this stage adds nullable `start_date`). The registry has no Project→Entity or Project→WorkingCalendar edge, and no specified Project jurisdiction/calendar field. A requirement with zero matches—the exact case that creates a SkillGap—need not have any candidate Employee, and may have no Assignment at all. Even if unrelated Employees exist, their Entity calendars can disagree within one workspace. Selecting one arbitrarily, using the server's weekday, or treating calendar days as working days would violate `VRS-F004` and yield nondeterministic severity.

Please rule which calendar governs a Project's working-day countdown and how that association is recorded or resolved when the Project has no assignments or matching employees. The `null` start-date → Low rule remains clear; the gap concerns a non-null start date. No severity computation has been implemented pending that ruling.

### F291 — generic edge writes can bypass skill verification and uniqueness

F289 correctly makes `has_skill` metadata survive `insertEdge` when its registered Employee governing partition is Tier 0. That exposes a previously inert bypass: the existing public `graph.createEdge` mutation accepts a caller-supplied `edge` object, including arbitrary `metadata`, and passes it to `insertEdge`. The newly required generic `graph.updateEdgeMetadata` mutation similarly accepts a caller-supplied metadata object. Both pass the interceptor's ordinary endpoint permission check; neither applies `employee.attachSkill`'s rule that `verified`, `verified_by`, and `verified_at` must be server-derived, nor G03's at-most-one-active-`has_skill` edge per Employee/Skill pair. An authorized caller could therefore create a `has_skill` edge with `verified: true` or create a duplicate directly, never invoking the named mutation. The same generic create/update paths can bypass `project.attachSkillRequirement`'s replace-on-duplicate rule for Project/Skill requirements.

Please rule whether generic edge create/update/close must refuse these feature-owned pairings in favor of their named mutations, or whether a different centralized enforcement boundary is intended. The generic `requires_skill` write for Pitch/Requisition required by Stage 21's F285 proof must remain possible through some authorized path. No bypass guard has been chosen or added pending that ruling; the partial F289 code is not stage-complete or ready to merge.

## Boundary and verification

- Read the full Stage 21 brief and corrected `VRS-F013` specification, plus the governing handoff and relevant registry, policy-table, interceptor, and graph-store code.
- Continued the same branch after F288 and F289 were ruled and merged. Added the F289 store and generic edge-update path, the Skill/SkillGap schema and policy definitions, and the new system-principal registration. The two new feature mutation definitions are not yet installed in the public mutation table because their handlers and reactive lifecycle are unfinished; there is no placeholder handler or API route. No `apps/` file or governing specification/build-prompt/findings-ledger file was edited by this stage. The pre-existing untracked `Claude outputs/` directory remains untouched.
- Focused checks passed: schema/API/graph typechecks and lint; local stack healthy; `store.integration.test.ts` 25/25 tests on live PostgreSQL; optimistic foundation mutator tests 17/17. These are **not** the four completed stage gates: install, full `pnpm verify`, and `pnpm verify:full` remain pending after implementation. RST-49 remains In Progress and must not move to In Review until the stage is built and verified.

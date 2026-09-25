# Stage 21 — Skill-to-Project Matcher

**Status:** Paused for reviewer ruling — implementation not started
**Branch:** `codex/stage-21-skill-to-project-matcher`
**Linear issue:** RST-49 (In Progress)
**Date:** 2026-09-25

## Finding raised

### F288 — a Manager cannot attach a Project skill requirement under the current edge policy

**Ruled and merged from `main` before implementation resumed.** The Stage 21 brief requires a project Manager to call `project.attachSkillRequirement` and, when nobody matches, trigger a system-authored `SkillGap` in `afterCommit`. The corrected `VRS-F013` specification likewise says a project manager attaches the requirement. The existing `Project` policy row grants Manager `READ_ANY()`, while the proposed `Skill` row grants Manager `FULL_ANY()`. In `edgeRoleDecision`, writing `requires_skill` requires Full on **both** endpoints unless its edge registration declares an endpoint in `readSufficientEndpoints`. The `requires_skill` registration originally declared only the F285 `governingPartitions` fix. The reviewer ruled by F262's identical `assigned_to`/Project precedent: `requires_skill` now declares `readSufficientEndpoints: { Project: true }`, without widening Project's policy row.

### F289 — `has_skill`'s required proficiency metadata is discarded by the graph store

Stage 21 item 1 requires `employee.attachSkill` to persist `has_skill.proficiency_level` and server-derived `verified`, `verified_by`, and `verified_at`, with duplicate attachments updating the existing edge in place. The matcher in item 7 must read that proficiency to decide whether an Employee qualifies. But `has_skill` has Employee as an endpoint, and Employee has a protected compensation partition. `services/api/src/graph/store.ts::insertEdge` sets `protectedEndpoint = hasProtectedPartition(from) || hasProtectedPartition(to)` and unconditionally replaces the parsed edge's `metadata` with `{}` when true. The store's integration test explicitly asserts this behavior for an Employee edge. Thus the normal edge metadata location cannot retain any of these fields on `has_skill`; Ghost Resource's current `has_skill` writer supplies no proficiency metadata either. `graph.closeEdge` is not an in-place metadata updater, and no edge metadata update primitive exists.

This is a storage/protection decision, not merely a missing helper. `has_skill`'s registry declares `Employee:operational` as its **permission-governing** partition (F136), but the store does not use that declaration to classify edge metadata for storage. Placing the fields as arbitrary top-level passthrough keys in the edge JSON would evade the store's metadata stripping without an explicit tier rule and is not an acceptable workaround. Please rule where operational `has_skill` attributes must live and how `insertEdge` plus a new in-place edge updater should preserve them without weakening the protected-endpoint guard for edges whose metadata is genuinely sensitive. No implementation change has been made pending that ruling.

## Boundary and verification

- Read the full Stage 21 brief and corrected `VRS-F013` specification, plus the governing handoff and relevant registry, policy-table, interceptor, and graph-store code.
- Created the requested branch from `main` at `73f5a2d`; after F288 was ruled, merged current `main` into the same branch, bringing the four requested files across without conflict. No product code or specification file was changed by this stage. The pre-existing untracked `Claude outputs/` directory remains untouched.
- The four stage gates were **not** run; no implementation exists yet. RST-49 remains In Progress and must not move to In Review until the stage is built and verified.

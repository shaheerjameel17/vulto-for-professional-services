# Stage 21 — Skill-to-Project Matcher

**Status:** Paused for reviewer ruling — implementation not started
**Branch:** `codex/stage-21-skill-to-project-matcher`
**Linear issue:** RST-49 (In Progress)
**Date:** 2026-09-25

## Finding raised

### F288 — a Manager cannot attach a Project skill requirement under the current edge policy

The Stage 21 brief requires a project Manager to call `project.attachSkillRequirement` and, when nobody matches, trigger a system-authored `SkillGap` in `afterCommit`. The corrected `VRS-F013` specification likewise says a project manager attaches the requirement. The existing `Project` policy row grants Manager `READ_ANY()`, while the proposed `Skill` row grants Manager `FULL_ANY()`. In `edgeRoleDecision`, writing `requires_skill` requires Full on **both** endpoints unless its edge registration declares an endpoint in `readSufficientEndpoints`. The `requires_skill` registration declares only the F285 `governingPartitions` fix; it has no `readSufficientEndpoints` entry. Thus the Project endpoint is independently denied for the intended Manager caller, before the mutation can run or its reactive hook can fire.

There is a direct narrow precedent: `assigned_to` declares `readSufficientEndpoints: { Project: true }`, allowing an Assignment writer with Project read access to write that particular edge without widening Project visibility or general Project write authority (F262). A possible correction is the same edge-local declaration on `requires_skill` for Project. Another is a broader Project policy change, which would grant write authority beyond this edge. This stage does not choose between them. Please rule the intended authorization shape and record it in the owning documents before implementation resumes.

## Boundary and verification

- Read the full Stage 21 brief and corrected `VRS-F013` specification, plus the governing handoff and relevant registry, policy-table and interceptor code.
- Created the requested branch from current `main` at `73f5a2d`. No product code or specification file was changed. The pre-existing untracked `Claude outputs/` directory remains untouched.
- The four stage gates were **not** run; no implementation exists yet. RST-49 remains In Progress and must not move to In Review until the stage is built and verified.

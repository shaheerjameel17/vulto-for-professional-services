# Stage 2 — The canonical PostgreSQL graph store

**Status:** BLOCKED
**Branch:** stage-2-graph-store @ 4d1e826
**Linear issues:** FDN-94
**Date:** 2026-09-21

## 1. Summary
Stage 2 stopped before any code was written. The specifications and the brief disagree about where a `User` node lives: the specification says a person has no single workspace, and the brief's table requires every node to have one. Choosing a fix would be a schema decision, so I recorded it as finding F204 with a recommendation. The rest of the stage waits on that answer because the table, the store and the workspace-creation change all depend on it.

## 2. Done-criteria checklist
- [ ] The migration applies cleanly on an empty database and on the current development database — not started; blocked by F204.
- [ ] All Stage 2 tests pass — not started; blocked by F204.
- [ ] `pnpm arch:check` enforces the import rule — not started.
- [ ] `workspace.create` is atomic across Better Auth and graph rows — not started; needs the `User` node decision.

## 3. Spec clauses implemented
None.

## 4. Files changed
Documentation only: `docs/Foundations_Findings.md` (F204) and this report.

## 5. Database changes
None.

## 6. Tests and gates
No code changed, so no gate was run for this stage.

## 7. Micro-decisions
None.

## 8. Findings raised
- F204 — `User` has no workspace but `graph_nodes.workspace_id` is `not null`. **Open.**

## 9. Deviations from this brief
None.

## 10. Known limitations and risks
- Reading `services/api/src/auth/workspace-projection.ts`, `workspace-session.ts` and the old Loro projection shows the founding records: Workspace and User are unscoped, and WorkspaceMembership carries `workspace_id` and `role`. The atomic-write change can go inside `createPendingWorkspaceAdmission`'s existing transaction once F204 is answered.
- A user who creates two workspaces would hit a primary-key collision on their `User` node under the brief as written.

## 11. Readiness for the next stage
No. Stage 2 needs the F204 decision first. Stage 3 depends on Stage 2.

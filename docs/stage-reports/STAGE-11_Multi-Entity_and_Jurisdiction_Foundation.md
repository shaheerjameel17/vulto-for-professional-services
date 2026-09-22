# Stage 11 — Multi-Entity and Jurisdiction Foundation (`VRS-F003`)

**Status:** COMPLETE, awaiting review.  
**Branch:** `codex/stage-11-multi-entity-jurisdiction` (local; not pushed).  
**Linear:** FDN-118  
**Date:** 22 September 2026

## 1. Summary

Entity now has named create, update, and deactivate mutations; `employee.setEntity` records transfers as adjacent historical edges. One server resolver answers which Entity applied to an Employee at a date. Workspace creation writes a default Entity in the founding transaction, and the permission matrix treats Entity as workspace configuration. All four new Tier 0 mutations have real optimistic device handlers. F221–F224 were ruled in the owning specification and brief before this stage was completed.

## 2. Done-criteria checklist

- [x] `entity.create`, `entity.update`, `entity.deactivate`, and `employee.setEntity` use the ordinary named mutation checks/validate/apply pipeline and the server permission interceptor. Integration tests call `applyMutation` with allowed and denied principals.
- [x] Deactivation rejects a stale base version first. Separate integration tests prove G04 refuses the sole Active Entity with zero Employees and G05 refuses one with an Active Employee (`last-active-entity` and `active-employees:1`, respectively). A valid deactivation writes `Dissolved`.
- [x] The UK-to-Pakistan transfer resolves correctly on either side of 1 March and preserves the closed UK edge's history. Temporal readers use `resolveForEmployee`.
- [x] Workspace creation produces exactly one Active Entity named after the workspace, with `Global` jurisdiction and `USD` currency, in the same transaction as the other five founding records.
- [x] The Entity matrix grants Full to Owner/HR Admin and Read to Finance Admin, a derived Manager, and Team Member. The matrix test was first run against the unmodified default and failed for Manager and Team Member; it passes with the override.
- [x] `Entity` joins the feature-owned lifecycle guard. The generic create, update, delete, and lifecycle paths cannot bypass its named rules.
- [x] All four mutations have real optimistic handlers. A device-cache test proves `employee.setEntity` closes only the currently open edge and derives the new ID with `moveEmployeeEdgeId`. A sync-engine test proves a server-refused optimistic deactivation restores the Active node through the existing outbox undo path.
- [x] No file under `apps/` changed. No Entity field named `is_active` is read or written in the Stage 11 diff.
- [x] All four required gates pass; no browser suite is required for this stage.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| VRS-F003 G01–G03, F221 | Named Entity mutations and `employee.setEntity`; `closeEdge` and a new adjacent edge, with no audit-log call | Entity integration transfer and history test |
| VRS-F003 G04–G05, F223 | Version-first `entity.deactivate` validation, then separate Active-Employee and last-Active-Entity checks | Three distinct refusal tests plus a successful deactivation test |
| VRS-F003 G06, F224 | `entity-resolution.ts` owns temporal `asOf` traversal; the server and device mutation use only their mechanical open-edge lookup when writing | UK-to-Pakistan test and device-cache open-edge test; diff traversal review |
| VRS-F003 founding Entity, F222 | `writeFoundingRecords` writes the sixth record inside the caller's transaction | Workspace creation integration test |
| VPS-A004 workspace-configuration pattern | `MATRIX_OVERRIDES["Entity"]` | Matrix test and live Owner, HR Admin, Finance Admin, derived Manager, and Team Member reads |
| VPS-A003 A003-T53/T54 | Four registered Tier 0 optimistic handlers, deterministic IDs, base-version refusal and outbox rollback | Mutator and sync-engine tests; full typecheck |

## 4. Files changed

- `packages/schema/src/mutations/{entity,employee,foundation,index}.ts`: argument contracts, registration, and the feature-owned lifecycle guard.
- `packages/schema/src/policy/policy-table.ts`: Entity's explicit permission row.
- `services/api/src/mutations/{entity,foundation,pipeline}.ts`: named server handlers and registration; generic graph paths refuse Entity.
- `services/api/src/graph/{entity-resolution,founding}.ts`: the single temporal resolver and founding Entity.
- `packages/graph/src/mutators/foundation.ts`: four optimistic handlers and generic Entity guards.
- Schema, graph, auth, permission, store, audience, pipeline, tRPC, and adversarial tests: direct Stage 11 proofs and updated generic Tier 0 fixtures. The older generic graph tests now use Project where they formerly used Entity.

## 5. Database changes

No migration. Entity uses the registered `graph_nodes` type and `scoped_to_entity` uses the existing `graph_edges` table. The founding transaction now writes one additional node. No new audit event or log table was added (F221).

## 6. Tests and gates

- `CI=1 pnpm install --frozen-lockfile` — passed. The initial sandboxed install could not reach npm; the allowed network retry passed with the locked dependencies.
- `pnpm stack:up` — passed; PostgreSQL, Electric, and Redis healthy.
- `pnpm verify` — passed: formatting, lint, conformance, architecture check, typecheck, and fast tests.
- `pnpm verify:full` — passed: 16 API files, 248 passed and 2 skipped; 68 graph and 75 schema tests passed (2 schema TODOs are preexisting).
- Focused device-cache and sync-engine run — 46 passed. Focused affected API suites — 57 passed. Focused Entity integration suite — 7 passed.
- The first full run exposed old test fixtures that used `graph.createNode` for Entity. Those fixtures were corrected to use Project for their generic graph assertions; the subsequent full run passed.

## 7. Micro-decisions

- `entity.create` derives its node ID from the mutation ID using the same portable `moveEmployeeEdgeId` function used for transfer edges. The server and device therefore produce the same ID without an extra input field.
- The device transfer mutator reads only its own currently open `scoped_to_entity` edge (`effectiveTo === null`). It does not accept or compute an `asOf` Entity answer; date-based resolution stays in the server resolver per G06/F224.
- Optimistic deactivation checks the base version and writes `Dissolved`. It deliberately leaves G04/G05's workspace-wide counts to the server; a refusal uses the existing outbox undo and NeedsAttention state.
- Existing generic graph tests use Project for generic node behavior. Their use of Entity had become invalid once Entity's business rules gained named mutations.

## 8. Findings raised

F221 and F222 were found while briefing; F223 was found while tracing the deactivation contract; F224 was found when the shared registry required optimistic handlers. All four are closed by the founder's rulings in `docs/Foundations_Findings.md` and the corrected `VRS-F003` and Stage 11 brief. No new finding arose while completing the ruled work.

## 9. Deviations from this brief

None from the corrected Stage 11 brief. The original server-only wording was amended by F224 to require the four Tier 0 optimistic handlers. No UI was built.

## 10. Known limitations and risks

- The resolver has no production consuming feature yet; contracts, leave policy, and payroll will call it when built. Its historical behavior is covered directly by tests now.
- A device may show `Dissolved` briefly while offline even when the server later refuses under G04 or G05. On rejection, the existing outbox restores the before-image and exposes the reason in NeedsAttention; the test covers this path.
- The Entities screen and Employee profile selector wait for their own UI stages. Stage 11 changes no fixture screens.

## 11. Readiness for the next stage

Stage 11 is ready for direct code review. FDN-118 should move to Done only after approval and merge. The local Stage 11 branch is intentionally unpushed and unmerged; Stage 12 has not started.

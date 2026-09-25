# Stage 22 — Skill Matrix

**Status:** Complete — awaiting founder review

**Branch:** `codex/stage-22-skill-matrix`

**Linear issue:** RST-50 (In Review)

**Date:** 2026-09-25

## Finding raised

None. F296 had already been ruled and both owning specifications corrected before this stage began. `certified` remains `false` until VRS-F041 defines a real certification fact.

## Completed build and code checks

- `getSkillMatrix` reads only the device's `SyncDatabase` through `localNodes` and `localEdges`. It includes Active real and Ghost Employees, Active and Deprecated Skills, and current `has_skill` edges. The Ghost row uses the same `employee_type === "Ghost"` check on an Employee node that VRS-F013's `matchCandidates` uses; it does not query the separate `GhostResource` node type.
- The query reads `proficiency_level` and `verified` from each edge's cached metadata. It imports VRS-F013's `proficiencyMeets` and `PROFICIENCY_LEVELS`; no second proficiency order was added. It fetches `holds_certification` for the specified forward compatibility while every returned cell remains `certified: false` per F296.
- Filtering happens before coverage and depth are computed. The twelve-holder fixture yields coverage 12 and depth 3; applying verified-only and Senior minimum returns two cells and changes both figures to 2. A Deprecated Skill keeps its column, existing cell, and computed figures. Category totals are explicitly documented as a client-side reduction of the returned skills array.
- `getSkillHolders` ranks holders by the shared proficiency order. Its `Assigned`/`Available` context calls the factored `assignmentCoversDate` helper from `bench-forecast.ts`, which now also uses that helper for its own daily coverage. The test proves an Active Assignment covering today reports Assigned, while a Canceled Assignment covering the same dates does not.
- The shared local-edge reader now exposes cached edge metadata. It tolerates fixtures without `record_json` by returning an empty record in that case; the live parity test exposed and verified this compatibility requirement.
- Diff inspection found no `fetch` or tRPC client call, no new policy row, mutation, router procedure, or system principal, and no changed file under `apps/` or `services/api/`. The only new code files are `skill-matrix.ts` and its test, both under `packages/graph/src/queries/`.

## Gates and boundary

All four Stage 22 gates passed on 25 September 2026: `pnpm install --frozen-lockfile`; `pnpm stack:up` (Postgres, Redis, and Electric healthy); `pnpm verify` (format, lint, conformance, architecture, typecheck, schema 111 passed / 2 todo, graph 85 passed); and `pnpm verify:full` (database preflight and API 319 passed / 2 skipped across 25 files, plus its embedded `verify`). The focused Skill Matrix suite passed 3/3. No browser suite was run because this stage has no UI.

The first `verify:full` run found that an existing API parity fixture omits edge `record_json`. The reader fallback fixed it, and the entire full gate passed on rerun. An unrelated pre-existing untracked `Claude outputs/` directory was temporarily moved out for Prettier's repository-wide check and restored unchanged. This stage is ready for founder review. Do not begin Stage 23 before that boundary is cleared.

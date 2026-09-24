# Stage 17 — Time Classification Taxonomy (`VRS-F009`)

- **Status:** Complete, awaiting founder review.
- **Branch:** `codex/stage-17-time-classification-taxonomy` from `main` at `2ed07e6`.
- **Linear:** FDN-124.
- **Date:** 24 September 2026.

## Summary

Pitch can now be created and staffed through three named Tier 0 mutations. The staffed-pitch selector reads only the employee's authorized staffing relationships and returns exactly `{ pitchId, name, clientName }`. A standalone classification schema and pure dependency validator are ready for `VRS-F010` to incorporate into its future TimesheetEntry mutations. This stage adds no TimesheetEntry write path, Pitch-to-Project conversion, or UI.

The real interceptor exposed F265 during implementation: `staffed_on` connects two split nodes, so the edge registration must declare both `Employee:operational` and `Pitch:identifying`. F264's Employee-only declaration refused staffing for every role. The corrected registration and owning specifications now agree. F266 corrects the brief's router instruction: Pitch writes use the existing `graph.applyMutations` transport, while `pitch.listStaffedFor` has its own read procedure.

## Done criteria and report checks

- [x] A Manager creates a new Pitch and immediately staffs their direct report with no pre-existing staffing edge. The PostgreSQL test exercises the real interceptor.
- [x] The same Manager's attempt to staff or unstaff an unrelated employee returns `reason: "role"`; no edge is written.
- [x] Owner and HR Admin each create a Pitch, staff an arbitrary employee, and unstaff them.
- [x] Team Member creation, staffing, and unstaffing return `reason: "role"`; a generic `Pitch:identifying` read resolves to `none`.
- [x] A staffed employee sees their own pitch's ID, name, and client name. A runtime key assertion confirms that neither `projected_start_date` nor commercial fields are returned.
- [x] An unrelated Team Member receives an empty staffed-pitch list. A Manager sees their direct report's staffed pitches and receives an empty list for an employee outside their reporting line.
- [x] `Pitch:identifying` has `manager: FULL_ANY()` and `team-member: NONE_ANY()`. There is no `Pitch:commercial` override.
- [x] Both `fromNodeId` and `toNodeId` are supplied on the `staffed_on` write target. The interceptor applies F262's existing row context to the Employee endpoint; the Pitch endpoint is unscoped for Manager.
- [x] `listStaffedFor` gates on the interceptor's `Employee:operational` read decision, then reads staffed Pitch identifying fields directly. It makes no generic per-Pitch read decision.
- [x] `staffed_on` has only the Employee-to-Pitch triple and governing partitions `{ Employee: "operational", Pitch: "identifying" }`. F265 explains the necessary correction to the original brief.
- [x] The `time-classification.ts` module is imported only by its own test. Unit tests cover each missing dependency, each satisfied category, and rejection of unrelated fields.
- [x] No TimesheetEntry mutation, node creation path, or router entry; no Pitch-to-Project conversion mutation; no file under `apps/` changed.
- [x] The three Pitch writes have real server handlers and matching optimistic cache handlers with undo coverage. There is no stub or no-op handler.

## Implementation and specification corrections

The schema registry adds `staffed_on`; the policy table adds only `Pitch:identifying`; `pitch.ts` defines identifying fields and the selector input. The named-mutation registry, API pipeline, and optimistic graph cache implement Pitch creation, staffing, and unstaffing. The API query uses the interceptor's Employee read gate and projects three explicit response keys. The standalone `time-classification.ts` provides the fixed category sets, field schema, and pure write-dependency validator; existence of an Assignment and actual Pitch staffing remain checks for `VRS-F010` when it builds entry writes.

F265 updates `VRS-F009`, `VPS-A002`, and the Stage 17 brief with the second governing partition. F266 updates the brief and `VRS-F009` to describe the repository's actual single write transport. `VPS-A002` also drops its stale statement that F009 performs Pitch-to-Project conversion, consistent with closed F264. `VPS-A004` now records the new Pitch identifying matrix row that its policy table enforces.

## Gates

- `CI=true pnpm install --frozen-lockfile` — passed; the lockfile was unchanged.
- `pnpm stack:up` — passed; PostgreSQL, Redis, and Electric were healthy.
- `pnpm verify` — passed: format, lint, conformance, architecture checks, typecheck, and fast tests.
- `pnpm verify:full` — passed: 22 API test files, 284 tests passed and 2 skipped; fast schema and graph suites also passed.
- Focused Pitch PostgreSQL integration suite — 4 tests passed against the real interceptor.
- Focused optimistic mutator test — passed with reversible create/staff/unstaff cache effects.

## Boundary and risk

The validator is deliberately inert until `VRS-F010` incorporates it into a real TimesheetEntry mutation and performs graph-dependent checks. The selector's access gate is `Employee:operational`; its data projection stays narrow even for Owner. Staffing writes are optimistic and may be rejected by the server if permissions change before commit, with the existing undo path reversing the local effect.

The branch is ready for founder review. FDN-124 moves to In Review; merge and Stage 18 remain at the founder's stage boundary.

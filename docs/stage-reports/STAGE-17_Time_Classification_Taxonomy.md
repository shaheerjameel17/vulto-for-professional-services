# Stage 17 — Time Classification Taxonomy (`VRS-F009`)

- **Status:** Complete, awaiting founder review.
- **Branch:** `codex/stage-17-time-classification-taxonomy` from `main` at `2ed07e6`.
- **Linear:** RST-45.
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

The branch is ready for founder review. RST-45 moves to In Review; merge and Stage 18 remain at the founder's stage boundary.

## Verification addendum — 24 September 2026

Fresh run on `main` at `f8fc14d` with Node `v24.18.0`. Command: `pnpm verify:full`. Exit code: `0`. The complete captured terminal output follows verbatim.

```text

> vulto@ verify:full /Users/shaheerjameel/Development/vulto-for-professional-services
> pnpm verify && pnpm verify:preflight && pnpm --filter @vulto/api test


> vulto@ verify /Users/shaheerjameel/Development/vulto-for-professional-services
> pnpm format:check && pnpm lint && pnpm conformance && pnpm arch:check && pnpm typecheck && pnpm test:fast


> vulto@ format:check /Users/shaheerjameel/Development/vulto-for-professional-services
> prettier --check .

Checking formatting...
All matched files use Prettier code style!

> vulto@ lint /Users/shaheerjameel/Development/vulto-for-professional-services
> turbo run lint

• turbo 2.10.8

   • Packages in scope: @vulto/api, @vulto/graph, @vulto/schema, @vulto/tokens, @vulto/ui, roster-web
   • Running lint in 6 packages
   • Remote caching disabled

@vulto/tokens:lint: cache hit, replaying logs 50b30ea9a92e4e3f
roster-web:lint: cache hit, replaying logs 0950348312e27550
@vulto/schema:lint: cache hit, replaying logs c7c99de58062e065
@vulto/graph:lint: cache hit, replaying logs 8fcc764e2dd21e18
@vulto/api:lint: cache hit, replaying logs c6e1eb1551ca1578
roster-web:lint: 
roster-web:lint: > roster-web@0.0.0 lint /Users/shaheerjameel/Development/vulto-for-professional-services/apps/roster-web
roster-web:lint: > eslint src
roster-web:lint: 
@vulto/tokens:lint: 
@vulto/tokens:lint: > @vulto/tokens@0.0.0 lint /Users/shaheerjameel/Development/vulto-for-professional-services/packages/tokens
@vulto/tokens:lint: > eslint src
@vulto/tokens:lint: 
@vulto/schema:lint: 
@vulto/schema:lint: > @vulto/schema@0.0.0 lint /Users/shaheerjameel/Development/vulto-for-professional-services/packages/schema
@vulto/schema:lint: > eslint src
@vulto/schema:lint: 
@vulto/graph:lint: 
@vulto/graph:lint: > @vulto/graph@0.0.0 lint /Users/shaheerjameel/Development/vulto-for-professional-services/packages/graph
@vulto/graph:lint: > eslint src
@vulto/graph:lint: 
@vulto/ui:lint: cache hit, replaying logs 9a78e8d7eb7dfcf2
@vulto/api:lint: 
@vulto/api:lint: > @vulto/api@0.0.0 lint /Users/shaheerjameel/Development/vulto-for-professional-services/services/api
@vulto/api:lint: > eslint src
@vulto/api:lint: 
@vulto/ui:lint: 
@vulto/ui:lint: > @vulto/ui@0.0.0 lint /Users/shaheerjameel/Development/vulto-for-professional-services/packages/ui
@vulto/ui:lint: > eslint src
@vulto/ui:lint: 

 Tasks:    6 successful, 6 total
Cached:    6 cached, 6 total
  Time:    19ms >>> FULL TURBO


> vulto@ conformance /Users/shaheerjameel/Development/vulto-for-professional-services
> pnpm --filter @vulto/schema exec vitest run src/conformance.gate.test.ts


 RUN  v4.1.10 /Users/shaheerjameel/Development/vulto-for-professional-services/packages/schema


 Test Files  1 passed (1)
      Tests  6 passed | 2 todo (8)
   Start at  14:54:59
   Duration  203ms (transform 84ms, setup 0ms, import 138ms, tests 2ms, environment 0ms)


> vulto@ arch:check /Users/shaheerjameel/Development/vulto-for-professional-services
> node scripts/arch-check.mjs

  ✓ services/cross-tenant-aggregation not present — A001-T08 isolation assertion is armed and dormant
  ✓ services/api/src/graph/store — import boundary holds

> vulto@ typecheck /Users/shaheerjameel/Development/vulto-for-professional-services
> turbo run typecheck

• turbo 2.10.8

   • Packages in scope: @vulto/api, @vulto/graph, @vulto/schema, @vulto/tokens, @vulto/ui, roster-web
   • Running typecheck in 6 packages
   • Remote caching disabled

@vulto/tokens:typecheck: cache hit, replaying logs 5476f325fe452bc8
@vulto/schema:typecheck: cache hit, replaying logs cddd86e0f396c320
@vulto/tokens:typecheck: 
@vulto/tokens:typecheck: > @vulto/tokens@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/tokens
@vulto/tokens:typecheck: > tsc -p tsconfig.json
@vulto/tokens:typecheck: 
@vulto/schema:typecheck: 
@vulto/schema:typecheck: > @vulto/schema@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/schema
@vulto/schema:typecheck: > tsc -p tsconfig.json
@vulto/schema:typecheck: 
@vulto/graph:typecheck: cache hit, replaying logs ec3e44d9c8459d6c
@vulto/graph:typecheck: 
@vulto/graph:typecheck: > @vulto/graph@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/graph
@vulto/graph:typecheck: > tsc -p tsconfig.json
@vulto/graph:typecheck: 
@vulto/ui:typecheck: cache hit, replaying logs a10070386b06750e
@vulto/ui:typecheck: 
@vulto/ui:typecheck: > @vulto/ui@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/ui
@vulto/ui:typecheck: > tsc -p tsconfig.json
@vulto/ui:typecheck: 
@vulto/api:typecheck: cache hit, replaying logs bb08b80aa70cd38d
@vulto/api:typecheck: 
@vulto/api:typecheck: > @vulto/api@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/services/api
@vulto/api:typecheck: > tsc -p tsconfig.json
@vulto/api:typecheck: 
roster-web:typecheck: cache hit, replaying logs 08df3675eade8d63
roster-web:typecheck: 
roster-web:typecheck: > roster-web@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/apps/roster-web
roster-web:typecheck: > tsc -p tsconfig.json
roster-web:typecheck: 

 Tasks:    6 successful, 6 total
Cached:    6 cached, 6 total
  Time:    16ms >>> FULL TURBO


> vulto@ test:fast /Users/shaheerjameel/Development/vulto-for-professional-services
> turbo run test --filter=!@vulto/api

• turbo 2.10.8

   • Packages in scope: @vulto/graph, @vulto/schema, @vulto/tokens, @vulto/ui, roster-web
   • Running test in 5 packages
   • Remote caching disabled

@vulto/schema:typecheck: cache hit, replaying logs cddd86e0f396c320
@vulto/tokens:typecheck: cache hit, replaying logs 5476f325fe452bc8
@vulto/schema:typecheck: 
@vulto/schema:typecheck: > @vulto/schema@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/schema
@vulto/schema:typecheck: > tsc -p tsconfig.json
@vulto/schema:typecheck: 
@vulto/tokens:typecheck: 
@vulto/tokens:typecheck: > @vulto/tokens@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/tokens
@vulto/tokens:typecheck: > tsc -p tsconfig.json
@vulto/tokens:typecheck: 
@vulto/graph:typecheck: cache hit, replaying logs ec3e44d9c8459d6c
@vulto/graph:typecheck: 
@vulto/graph:typecheck: > @vulto/graph@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/graph
@vulto/graph:typecheck: > tsc -p tsconfig.json
@vulto/graph:typecheck: 
@vulto/ui:typecheck: cache hit, replaying logs a10070386b06750e
@vulto/ui:typecheck: 
@vulto/ui:typecheck: > @vulto/ui@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/packages/ui
@vulto/ui:typecheck: > tsc -p tsconfig.json
@vulto/ui:typecheck: 
@vulto/api:typecheck: cache hit, replaying logs bb08b80aa70cd38d
@vulto/api:typecheck: 
@vulto/api:typecheck: > @vulto/api@0.0.0 typecheck /Users/shaheerjameel/Development/vulto-for-professional-services/services/api
@vulto/api:typecheck: > tsc -p tsconfig.json
@vulto/api:typecheck: 
@vulto/tokens:test: cache hit, replaying logs 2e8e691f25bb6475
@vulto/ui:test: cache hit, replaying logs 742675fabe3c181c
@vulto/schema:test: cache hit, replaying logs eb68a6e5a221dd7a
@vulto/tokens:test: 
@vulto/ui:test: 
@vulto/ui:test: > @vulto/ui@0.0.0 test /Users/shaheerjameel/Development/vulto-for-professional-services/packages/ui
@vulto/ui:test: > vitest run --passWithNoTests
@vulto/ui:test: 
@vulto/ui:test: 
@vulto/ui:test:  RUN  v4.1.10 /Users/shaheerjameel/Development/vulto-for-professional-services/packages/ui
@vulto/ui:test: 
@vulto/ui:test: No test files found, exiting with code 0
@vulto/ui:test: 
@vulto/ui:test: include: **/*.{test,spec}.?(c|m)[jt]s?(x)
@vulto/ui:test: exclude:  **/node_modules/**, **/.git/**
@vulto/ui:test: 
@vulto/schema:test: 
@vulto/schema:test: > @vulto/schema@0.0.0 test /Users/shaheerjameel/Development/vulto-for-professional-services/packages/schema
@vulto/schema:test: > vitest run --passWithNoTests
@vulto/schema:test: 
@vulto/schema:test: 
@vulto/schema:test:  RUN  v4.1.10 /Users/shaheerjameel/Development/vulto-for-professional-services/packages/schema
@vulto/schema:test: 
@vulto/schema:test:  ✓ src/policy/matrix-coverage.test.ts (3 tests) 5ms
@vulto/schema:test:  ✓ src/policy/policy-scope.test.ts (2 tests) 12ms
@vulto/schema:test:  ✓ src/policy/policy-table.test.ts (26 tests) 17ms
@vulto/schema:test:  ✓ src/capacity-conflict.test.ts (1 test) 2ms
@vulto/schema:test:  ✓ src/time-classification.test.ts (2 tests) 3ms
@vulto/schema:test:  ✓ src/bench-forecast.test.ts (6 tests) 5ms
@vulto/schema:test:  ✓ src/audit.test.ts (10 tests) 6ms
@vulto/schema:test:  ✓ src/auth.test.ts (3 tests) 5ms
@vulto/schema:test:  ✓ src/rate-card.test.ts (1 test) 2ms
@vulto/schema:test:  ✓ src/mutations/mutations.test.ts (11 tests) 6ms
@vulto/schema:test:  ✓ src/conformance.gate.test.ts (8 tests | 2 todo) 3ms
@vulto/schema:test:  ✓ src/registry.test.ts (24 tests) 14ms
@vulto/schema:test: 
@vulto/schema:test:  Test Files  12 passed (12)
@vulto/schema:test:       Tests  95 passed | 2 todo (97)
@vulto/schema:test:    Start at  14:25:06
@vulto/schema:test:    Duration  598ms (transform 1.16s, setup 0ms, import 2.03s, tests 79ms, environment 1ms)
@vulto/schema:test: 
@vulto/tokens:test: > @vulto/tokens@0.0.0 test /Users/shaheerjameel/Development/vulto-for-professional-services/packages/tokens
@vulto/tokens:test: > vitest run --passWithNoTests
@vulto/tokens:test: 
@vulto/tokens:test: 
@vulto/tokens:test: [1m[30m[46m RUN [49m[39m[22m [36mv4.1.10 [39m[90m/Users/shaheerjameel/Development/vulto-for-professional-services/packages/tokens[39m
@vulto/tokens:test: 
@vulto/tokens:test: No test files found, exiting with code 0
@vulto/tokens:test: 
@vulto/tokens:test: [2minclude: [22m[33m**/*.{test,spec}.?(c|m)[jt]s?(x)[39m
@vulto/tokens:test: [2mexclude:  [22m[33m**/node_modules/**[2m, [22m**/.git/**[39m
@vulto/tokens:test: 
@vulto/graph:test: cache hit, replaying logs 5c8f7598f0b11e3a
roster-web:test: cache hit, replaying logs 4399b2e91f85f9ef
roster-web:test: 
roster-web:test: > roster-web@0.0.0 test /Users/shaheerjameel/Development/vulto-for-professional-services/apps/roster-web
roster-web:test: > vitest run --passWithNoTests
roster-web:test: 
roster-web:test: 
roster-web:test:  RUN  v4.1.10 /Users/shaheerjameel/Development/vulto-for-professional-services/apps/roster-web
roster-web:test: 
roster-web:test: No test files found, exiting with code 0
roster-web:test: 
roster-web:test: include: **/*.{test,spec}.?(c|m)[jt]s?(x)
roster-web:test: exclude:  **/node_modules/**, **/.git/**
roster-web:test: 
@vulto/graph:test: 
@vulto/graph:test: > @vulto/graph@0.0.0 test /Users/shaheerjameel/Development/vulto-for-professional-services/packages/graph
@vulto/graph:test: > vitest run src --passWithNoTests
@vulto/graph:test: 
@vulto/graph:test: 
@vulto/graph:test:  RUN  v4.1.10 /Users/shaheerjameel/Development/vulto-for-professional-services/packages/graph
@vulto/graph:test: 
@vulto/graph:test:  ✓ src/queries/contextual-intelligence.test.ts (1 test) 53ms
@vulto/graph:test:  ✓ src/sync-client/database.test.ts (9 tests) 231ms
@vulto/graph:test:  ✓ src/sync-client/erasure.test.ts (6 tests) 3ms
@vulto/graph:test:  ✓ src/query.test.ts (2 tests) 4ms
@vulto/graph:test:  ✓ src/mutators/assignment.test.ts (6 tests) 10ms
@vulto/graph:test:  ✓ src/mutators/employee.test.ts (3 tests) 12ms
@vulto/graph:test:  ✓ src/mutators/foundation.test.ts (16 tests) 26ms
@vulto/graph:test:  ✓ src/sync-client/device-identity.test.ts (2 tests) 4ms
@vulto/graph:test:  ✓ src/queries/bench-forecast.test.ts (1 test) 56ms
@vulto/graph:test:  ✓ src/queries/conflict-check.test.ts (1 test) 66ms
@vulto/graph:test:  ✓ src/sync-client/engine.test.ts (34 tests) 390ms
@vulto/graph:test: 
@vulto/graph:test:  Test Files  11 passed (11)
@vulto/graph:test:       Tests  81 passed (81)
@vulto/graph:test:    Start at  14:31:48
@vulto/graph:test:    Duration  955ms (transform 1.60s, setup 0ms, import 3.01s, tests 855ms, environment 0ms)
@vulto/graph:test: 

 Tasks:    10 successful, 10 total
Cached:    10 cached, 10 total
  Time:    11ms >>> FULL TURBO


> vulto@ verify:preflight /Users/shaheerjameel/Development/vulto-for-professional-services
> node scripts/db-preflight.mjs


> @vulto/api@0.0.0 test /Users/shaheerjameel/Development/vulto-for-professional-services/services/api
> node ../../scripts/db-preflight.mjs && vitest run --passWithNoTests


 RUN  v4.1.10 /Users/shaheerjameel/Development/vulto-for-professional-services/services/api


 Test Files  22 passed (22)
      Tests  284 passed | 2 skipped (286)
   Start at  14:55:00
   Duration  56.16s (transform 447ms, setup 0ms, import 8.90s, tests 45.99s, environment 1ms)

```

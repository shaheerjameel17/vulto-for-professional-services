# UI-2 — People directory and Employee profile

**Status:** BLOCKED — F357–F359 implemented; unbaselined primary-button contrast needs ruling
**Branch:** codex/ui-2-people-profile (from main @ 2648caf6c7d0e814f996352973f19e76610aefa2)
**Linear issues:** RST-56
**Date:** 2026-09-27

## 1. Summary

**Resumption, 27 September:** merged the reviewer rulings at `8f76263` into the existing branch without discarding `19fc064`. Implemented the memory-only protected-write path, both local Employee queries, real directory/profile data and mutations, three-state compensation rendering, shared Table order and real skill/empty sources. The four standard gates pass; real browser scenarios complete their functional checks at 150 employees but fail the unchanged guarded axe baseline on the existing primary Add person button. Its white-on-orange text measures 2.51:1, below 4.5:1; fixing shared tokens/components or expanding the baseline needs ruling. The original pre-build evidence below is retained as **history**, not as a claim that the branch still has no implementation.

**Historical pre-build summary:**

The two reviewer documentation commits were pushed fast-forward; both main workflows passed, including both browser jobs. The UI-2 branch was created from that verified main. All ten Do items were traced before implementation. Two mechanisms need a ruling: the real graph client's compensation-write path persists plaintext mutation arguments, and the Table does not expose the sorted order required for cross-screen navigation within the stage's stated file scope. The remaining mismatches and their minimal resolutions are collected below rather than raised one at a time.

## 2. Done-criteria checklist

**Current implementation:** both strict queries and row/edge subscription tests are implemented; directory creation is a named mutation; Overview edits use employee.update/org.moveEmployee/protectedMutate separately; the profile has no role lookup or viewer toggle; skills and empty sources are real; Table emits order from an effect with a plain-order fallback. Unit tests prove interrupted protected upload and wrong-method refusal leave the outbox empty. Both browser themes prove a real operational round-trip, valid reporting move, cycle refusal, available/restricted/absent compensation across three real accounts, a protected compensation write, stale-state refusal, real empty tabs and offline directory operation. Completion is **not claimed**: axe/branch CI are not green, and the screenshot set is diagnostic rather than final acceptance material (see section 10).

**Historical pre-build checklist:**

- [ ] Strict Employee device queries — traced, not implemented.
- [ ] Real directory, lifecycle badges, client-side filters/sorting and creation — traced, not implemented.
- [ ] Real Tier 0 profile and authorized, never-cached compensation — blocked on the write-path ruling; read path exists.
- [ ] Separate operational, reporting-line and compensation mutations — all three definitions and server/client implementations traced; compensation transport needs ruling.
- [ ] Real Skills and honest Certifications/Documents/Activity empty states — traced, not implemented; F354–F356 remain closed.
- [ ] J/K in the real filtered/sorted order — blocked on Table order handoff.
- [ ] UI-1's exact guarded contrast baseline — located, not yet applied to new surfaces.
- [ ] Real-stack browser proofs and screenshots — fixture/API paths located; not run or generated for UI-2.
- [x] Shared fixture files and `lib/viewer.ts` untouched — no product changes; existing Home/Bench imports verified with `rg`.
- [ ] Full UI-2 gates and green branch workflows — not claimed. The green workflow evidence below is explicitly for the requested **main documentation push**, not an implementation.

## 3. Spec clauses implemented

| Current contract | Implementation | Proof |
| --- | --- | --- |
| F350/F351 local operational directory/profile | employee-directory.ts; strict device query dispatch | employee-directory.test.ts; engine.test.ts row/manager-edge subscription regression |
| F357 memory-only protected writes | engine.ts, worker protocol/host/client; mutate tier/onlineOnly guard | engine.test.ts protected mutation interruption/wrong-method/outcome tests |
| F358 server-owned compensation visibility | employee-profile.ts typed no-store fetch, profile route and OverviewTab | people-profile.spec.ts three signed-in accounts; no principal.current/viewer.ts call |
| F359 actual directory order | Table.tsx effect callback; people-order.ts workspace-scoped transient store | people-profile.spec.ts actual header sorting/J/K and fresh-tab fallback |
| F353 reporting line | OverviewTab calls org.moveEmployee, never employee.update patch | real move/cycle assertions |
| F354–F356 honest local sources | Employee profile query reuses skill holding shaping and returns real empty deferred sources | local inactive-skill test and real browser tabs |

**Historical pre-build trace:**

None yet. Pre-build trace against the authoritative UI-2 section:

| Do item | Actual repository paths/mechanisms checked | Result |
| --- | --- | --- |
| 1 | `packages/graph/src/query.ts`, `sync-client/query.ts`, `queries/cache-data.ts`, `src/index.ts`; `services/api/src/permission/employee-queries.ts`; `packages/schema/src/employee.ts` | Existing strict device-query dispatch supports additive names. `employeeGetInputSchema` uses UUID v4. `localNodes` exists; `localNode` does not. `LocalNode` omits the row version. Existing cache tables have versions; no migration is needed. |
| 1 subscription | `SyncEngine.#onEvents`, `#changed`, `#rerun`, `subscribe` in `sync-client/engine.ts` | Edge-shape changes set `touchedRows = true` and rerun every subscription; JSON-result comparison decides whether callbacks fire. A manager-edge-only regression test can use the existing engine harness. No new edge-change mechanism is required. |
| 2 | `people/page.tsx`, `people/AddPersonDialog.tsx`, `fixtures/roster.ts`, `fixtures/profiles.ts`, `fixtures/calendar.ts`; employee schemas and both mutation implementations | Table columns live in the page, not an `EMPLOYEE_COLUMNS` export. Entity options are fixture IDs `uk`/`pk`, not real graph IDs. The dialog lacks required `employee_code` and `start_date`. `employee.create` also takes `employee_id`, `entity_id`, `effective_from`. Creation duplicate refusals are `duplicate-email`/`duplicate-code`; validation is `invalid-args`. |
| 2 status | Same page and `VRS-F002` field list/interface/NFRs | Fixture source excludes Ghosts but has no status filter: its badge merely hardcodes Active. The brief expressly asks for all cached Employee rows and real Active/Inactive/Converted badges; keep that read contract, with the existing real-person versus Ghost distinction at the screen. Do not invent an Active-only default. |
| 3 | Profile route; `OverviewTab.tsx`, `EditableField.tsx`, `ProfileHeader.tsx`, `lib/profile.ts`, `lib/viewer.ts`, `components/shell-bootstrap.tsx`, `lib/skill-matches.ts`; `router.ts::employee.get` and `principal.current`; `protected/read.ts`; pipeline and server/client Employee mutators | Local profile model can replace the fixture model. `employee.get` sets no-store and uses audited `readProtected`. Bootstrap exposes user/workspace IDs but not roles. The existing `principal.current` server query supplies the actual roles without a server edit. `canSeeCompensation` has narrower prototype vocabulary/behavior than the real permission row; see section 8. |
| 3 reporting line | `packages/schema/src/mutations/foundation.ts::orgMoveEmployee`, `wouldCreateCycle`; `services/api/src/mutations/foundation.ts::moveEmployee`; `packages/graph/src/mutators/foundation.ts::moveEmployee`; `pipeline.ts` | Both implementations call the shared cycle check and refuse with **`cycle`**, not a reason named `wouldCreateCycle`. Server checks a cycle while constructing the plan, before authorization checks; client checks before writing the cache. Effective time must be caller-supplied. The existing Reports-to editor is read-only when empty, which must be removed for an initially managerless person. |
| 3 ordinary edit | `employeeUpdatePatchSchema`; both `employeeUpdate` implementations; `graph/store.ts::updateNodeFields`; `EditableField.tsx` | Patch is strict. Client checks expected version before its write. Server authorizes then the store compares version and translates `StaleVersionError` to `stale-state`. Keep the existing E/blur/Cmd+Enter/Escape interaction. Probation, contract end and working pattern stay read-only. |
| 3 compensation write | `employeeSetCompensation` definition and implementations; `SyncEngine.mutate`; `Outbox.append`; GraphClient/worker host | Mutation is Tier 1/online-only and optimistic mutator writes no cached node, but the engine still durably appends its full arguments. Isolated executable reproduction below. |
| 4 | `SkillsTab.tsx`, `skill-matrix.ts::getSkillMatrix/getSkillHolders`, `cache-data.ts::localEdges`; `skill-matcher.ts` proficiency enum | Skill Matrix already resolves skill names/holdings/verified state. Its holding helpers are private and its matrix excludes inactive employees; do not silently erase inactive profile holdings or recreate certification facts. F296/F354 already settle Certifications as empty. Prototype proficiency vocabulary has Advanced instead of the real Senior. |
| 5 | `DocumentsTab.tsx`, `ActivityTab.tsx`, `fixtures/profiles.ts`; registry and audit query/type definitions | Existing exact empty messages are usable. No built document or per-employee business-event source exists. Keep F355/F356's empty local sources; never substitute security audit events. |
| 6 | Profile route/static `PROFILED_EMPLOYEE_IDS`; People filter/reorder state; complete `packages/ui/src/Table.tsx` | Filters and column state are in the page; row sorting is private state **inside Table**. No sort callback or ordered-row callback exists. Sharing only the page's filtered rows would not share the user-visible sorted order. |
| 7 | `inbox-palette.spec.ts::assertGuardedAxe` | Exactly one baselined rule: color-contrast; every violating node's own opening-tag classes must contain text-text-tertiary. No token change or broader exemption. |
| 8 | `inbox-palette.spec.ts`, `shell-bootstrap.spec.ts`, `helpers.ts`, API `test/sync-browser-support.ts`, `playwright.sync.config.ts`, API/browser setup scripts | Real pipeline admission/creation/linking/skills helpers already exist. Use two actual accounts and memberships, not a toggle. Proxy cutting is provided by NetworkSwitch. Per-test timeout is 180 seconds; full-scale fixture viability must be measured, not assumed. Existing tests seed through feature mutations, not generic Employee/Entity creation. |
| 9 | Existing screenshot capture helper and UI-1 material directory | New captures go under ui-2, full-page Light/Dark, each below 400 KB. Directory already has a real zero-row renderer: “No one matches these filters.” No UI-2 screenshots claimed. |
| 10/gates | Part 2 template, package scripts, slow-lane workflow, browser setup/config | `verify:full` does not run either browser suite. Browser gate is separate; no skips/retries/baseline comparison are authorized. No server/schema/dependency/reviewer-owned document changes have been made. |

## 4. Files changed

Current changes are confined to the app, the authorized graph/query/protected-write plumbing and tests, Table.tsx, this report and diagnostic screenshots. No server/schema/permission/interceptor/migration/dependency change. The original report-only state below is historical; the final pushed diff is the authoritative file list.

Only this stage report. The untracked `Claude outputs/` and `scripts/dev-seed.mts` predate UI-2 and are preserved, excluded from this branch's commit. No fixture, server, app, graph, UI, schema, migration, dependency or governing documentation change.

## 5. Database changes

None. No real data was used in the outbox diagnostic. It ran in a fresh in-memory SQLite database with synthetic UUIDs and values and a fake interrupted upload; that database was closed afterward. The founder's seeded local dev instance was not reseeded or modified.

## 6. Tests and gates

**Resumed implementation gates:**

```text
pnpm install --frozen-lockfile                 exit 0; Already up to date
pnpm stack:up                                exit 0; postgres, redis, Electric Healthy
pnpm verify                                  exit 0; 10 successful tasks, 10 total
pnpm verify:full                             exit 0
 Test Files 33 passed (33)
 Tests 352 passed | 2 skipped (354)
```

The two skipped API tests are pre-existing; no skips or retries were added. Final verification is rerun after the last edits; its output and the full sync-browser run will be appended before handoff. Frozen install changed no lockfile/dependency. One initial format run encountered the founder's pre-existing untracked `Claude outputs/`; it was temporarily preserved outside the repository, not edited or ignored by a gate, and is restored before handoff. Implementation formatting/fixture mistakes were fixed, not baselined.

Real-stack diagnostic command (after successful `pnpm --filter @vulto/api db:migrate`, with `.env` sourced and SYNC_BROWSER_DATABASE_URL/ELECTRIC_URL/ELECTRIC_SECRET passed):

```text
pnpm test:sync-browser --grep 'real People and profile'
exit 1: 2 failed (Light and Dark), solely at the unchanged final guarded axe assertion
UI-2 offline Table sort/render p95, 150 employees (Light): 13.60ms
UI-2 offline Table sort/render p95, 150 employees (Dark): 14.40ms
```

Each theme uses 150 employees, 20 offline sort-to-DOM-mutation samples, no proportional extrapolation. This is warm-cache sorting/rendering, not cold sync time. Separately, the local SQLite query's 20-sample p95 at 150 employees was 2.47 ms in verify:full. Functional assertions execute before the retained axe check so their evidence can be collected together; no assertion is removed or weakened. Browser fixture corrections: Manager is derived by a real employee.linkUser/managed_by relationship, not an assignable membership role; Skill's category is required. No product policy or server code was changed for either.

**Historical main-push and outbox reproduction evidence:**

Requested main push, exit 0:

```text
git push origin main
0144fa7..2648caf  main -> main
git ls-remote origin main
2648caf6c7d0e814f996352973f19e76610aefa2 refs/heads/main
```

Read directly from GitHub's Actions API at that exact head:

- [fast-lane 36303746423](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36303746423): completed, success; resolve-image and verify both success.
- [slow-lane 36303746444](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36303746444): completed, success; resolve-image, production-build, sync-browser, auth-browser, api-integration and publish-artifacts all success.

Diagnostic command, exit 0 (temporary script outside the repository):

```text
pnpm --filter @vulto/api exec tsx /private/tmp/vulto-ui2-outbox-trace.mts
{
  "outcome": {
    "accepted": true,
    "mutationId": "a144aaff-12f3-41dd-a42b-dba7fd8822f2"
  },
  "persisted": [
    {
      "name": "employee.setCompensation",
      "args_json": "{\"employee_id\":\"cccccccc-cccc-4ccc-8ccc-cccccccccccc\",\"compensation\":{\"base_compensation_amount\":123456.78,\"compensation_frequency\":\"Annual\",\"compensation_currency\":\"USD\"}}",
      "status": "pending"
    }
  ]
}
```

Reproduction uses the actual `SyncEngine`, `prepareCacheSchema`, `openTestDatabase` and `ApiError`. Start a fresh engine, emit an up-to-date event on each shape so connectivity is online, make `api.applyMutations` throw `ApiError("network", "Synthetic interrupted upload")`, invoke `engine.mutate("employee.setCompensation", { employee_id: <synthetic UUID>, compensation: { base_compensation_amount: 123456.78, compensation_frequency: "Annual", compensation_currency: "USD" } })`, await `engine.drain()`, then read `SELECT name, args_json, status FROM outbox` through `engine.withDatabase`. No real server is contacted. The outbox is the production persistence path; using an in-memory database for this diagnostic does not change the table/append implementation.

UI-2 `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, `pnpm verify:full` and `pnpm test:sync-browser`: **not run for an implementation**, because no product code was written and the pre-build scope/security ruling is outstanding. No UI-2 pass counts, latency measurements or screenshots are claimed. Main's green CI is not substituted for these gates.

## 7. Micro-decisions

**Resumption:** F357's wrong-method guard uses the explicit refusal `requires-protected-mutation`; offline protectedMutate uses `requires-connection`. Unknown/server errors are not serialized with potentially protected arguments. Protected reads remain a typed no-store fetch to the existing employee.get; no role call/context was added. Erased fragments render absent. Nullable compensation inputs map empty values to null. Employee types are re-exported through the existing graph dependency, with no new app dependency. Existing PageHeader.headingLevel=1 fixes the directory's heading semantics without changing typography or a shared component. Table computation is memoized with its comparator/cycle unchanged, and its effect publishes workspace-keyed transient IDs without storage/URL persistence. The original accepted micro-decisions below are retained; F358 supersedes their old binary role/conditional-spread gating detail.

Minimal in-scope resolutions selected for implementation after the blocking ruling; **not yet coded**:

- Follow the authoritative brief's client-side filter/sort location, despite F350's earlier detail saying worker filtering/sorting. Do not reopen the ruled local-query contract or add filter arguments.
- Resolve the nonexistent `EMPLOYEE_COLUMNS` reference from the actual page's `allColumns` and directory fields; it is a locating error, not a new model requirement.
- Supply a private single-node lookup in the new Employee query using the existing cache helpers/parameterized SQL; `cache-data.ts` currently exports no `localNode`.
- Include the actual cache row version in the new typed Employee result for `employee.update.expected_version`; do not manufacture it or add a schema version/migration.
- Resolve entity IDs/names from local `scoped_to_entity` edges and Entity nodes, not the fixture uk/pk aliases; retain the existing MultiSelect and its client-side state/reorder behavior.
- Add the missing required employee-code/start-date controls and use the real create schema/UUID/effective-time envelope. Do not derive the human-readable employee code from a UUID or hide the creation refusal.
- Extend the existing refusal-to-sentence presenter for `duplicate-email`, `duplicate-code`, `cycle` and `no-change`; the cycle refusal's actual reason is `cycle`.
- Let a managerless person's Reports-to field start an edit rather than keeping the fixture's `readOnly={!fields.managerName}` gate. Use org.moveEmployee, never an Employee patch.
- Decouple the real profile view-model types from prototype enums: real proficiency Senior, seniority Principal/CLevel, Hourly compensation and nullable amounts must not be coerced into fixture values. Leave fixture modules and viewer.ts intact.
- Correct the real profile's legacy “end-to-end encrypted” explanatory copy to server field-encryption terminology. No architectural change.
- Reuse the existing conditional-spread structure for authorized compensation and exact existing empty-state wording for Certifications/Documents/Activity. Do not invent a populated source or wire auditLog.query.

## 8. Findings raised

**Current blocker (reviewer to number): primary action contrast is outside the authorized F348 baseline.** Both Light/Dark browser scenarios fail `color-contrast` on the existing Add person primary Button (`bg-brand-600 text-text-inverse`), not on tertiary text. Axe reports foreground `#ffffff`, background `#ff8000`, contrast 2.51:1, 13px normal-weight text, expected 4.5:1. Exact error: `Unbaselined contrast debt: <button type="button" class="inline-flex items-center justify-center gap-2 rounded-full font-ui text-body-medium whitespace-nowrap motion-fast transition-colors disabled:cursor-not-allowed disabled:opacity-40 bg-brand-600 text-text-inverse hover:bg-brand-700 h-button-md px-3">`.

Item 7 explicitly prohibits a broader exemption or token change; F359 permits only Table.tsx in packages/ui. I did not add a fake tertiary class, skip axe, change tokens, silently downgrade the primary action or modify Button.tsx. Please rule the accessible primary-action treatment and its scope; the existing FDN-140 tertiary-token debt is not reopened by this report. A variant/call-site treatment using existing tokens could remain app-local if explicitly approved, or the reviewer may authorize the shared fix separately. This blocks the required green browser gate for the whole stage.

**Historical findings below:** A is closed/implemented by F357, B by F359, C/D by F358, E accepted. They are not reopened.

All trace discrepancies are recorded together here. No F-number allocated and no ledger/finding/reviewer/spec file edited; the reviewer owns numbering and rulings.

### A. Blocking security/write-path decision — protected mutation arguments reach the durable outbox

`packages/schema/src/mutations/employee.ts::employeeSetCompensation` declares Tier 1/online-only. `packages/graph/src/mutators/foundation.ts:500` validates it and returns an empty undo array. But `sync-client/engine.ts:355–357` only refuses it **when not online**, and line 386 appends its full args to Outbox. `sync-client/outbox.ts::append` serializes them to `args_json`. An interrupted upload therefore retains the protected amount/frequency/currency in a persistent device table. The executable synthetic reproduction in section 6 confirms this, rather than inferring a leak from a comment alone.

This violates A003-T56 and the brief's never-cached compensation boundary. I did not wire the compensation editor through this unsafe path. The brief explicitly confines graph changes to the two queries and otherwise the app, so repairing the engine's protected-mutation transport is outside the given stage scope.

**Ruling requested:** authorize a memory-only protected/online-only mutation branch in the graph client, or explicitly authorize an app-level typed fetch of the existing `graph.applyMutations` endpoint for compensation writes (no outbox and no server mutation change). The second alternative still uses the canonical named mutation, but choosing a different transport for protected writes is a data/security mechanism, not an unrecorded private-helper micro-decision. Reads remain on the already-ruled F351 `employee.get` path either way.

### B. Blocking scope/order handoff — Table's sort result is not available to the screen

`packages/ui/src/Table.tsx:146` owns sort in private state; lines 171–182 derive `sortedRows`. TableProps at lines 61–82 exposes neither a sort-state callback nor the ordered rows. People owns filters but cannot put Table's current sorted rows into shared client state or a route parameter; re-fetching the directory returns the cache order, not the header-selected order. Thus merely sharing the page's filtered rows fails item 6 and its browser proof once a sortable header is clicked.

**Ruling requested:** allow the smallest additive Table API change (an ordered-row or controlled-sort callback), preserving the existing comparator and click cycle, then keep the actual filtered/sorted IDs in shared client state for J/K. This adds a file under packages/ui, outside “two more names and otherwise lives in apps/roster-web.” I did not scrape the DOM or duplicate the Table's private sorting model as a workaround.

### C. Role-source mismatch — minimal client-only resolution available

The F352/Do item 3 assertion that shell/bootstrap already exposes the real role is not true at this head: `ShellBootstrap` carries client, workspaceId, userId, state, workspaceName and retry/refusal functions, no role. `services/api/src/router.ts:671–681` already exposes `principal.current` with the authoritative user/workspace/roles. Fetching that existing endpoint into a client-only auth/presentation context needs no server edit. This is not a request to reopen F352.

### D. Compensation role adapter cannot simply pass through the prototype union

`lib/viewer.ts`'s ViewerRole has owner/hr-admin/manager/member, omits finance-admin, and `canSeeCompensation` returns true only for owner/hr-admin. The actual `Employee:compensation` policy row grants Finance Admin Full(any) and Team Member Read(own). F352 permits mapping into the existing union, so finance can be represented compatibly for presentation, but self access must also be considered without widening the client's permission logic. **Please settle this in the same ruling as A:** how the real role/self relationship is adapted while keeping canSeeCompensation/viewer.ts untouched and keeping the server authoritative. No role allow-list was added to a screen. This mismatch is documented once here; no existing ruling is reopened or modified.

### E. Remaining nonblocking locating/type/control mismatches

The nonexistent localNode/EMPLOYEE_COLUMNS names, missing LocalNode version, hardcoded entity options, incomplete AddPerson required fields, empty-manager read-only gate, real refusal reason `cycle`, narrower prototype enums, and legacy encryption copy have the minimal resolutions listed in section 7. Skill Matrix's holding helpers are private and its Active-only matrix cannot automatically stand in for every lifecycle profile; expose/reuse only the existing holding shaping needed by the new local query, rather than duplicate a skill/certification implementation. Documents and Activity remain the already-ruled honest empty sources, not new findings.

## 9. Deviations from this brief

**Current:** stopped for ruling on primary-button contrast after implementing the existing rulings and collecting the other functional evidence. No baseline/token/scope workaround. The earlier report-only stoppage below is historical.

No product implementation or scope expansion. Stopped before writing product code on A/B and supplied this single consolidated report for ruling. No attempt to repair the protected write path, expose Table sorting, change viewer.ts, modify a server endpoint, or weaken a gate was made.

## 10. Known limitations and risks

**Current:** screenshots are diagnostic, not a final approved visual set. Full-page Playwright capture does not automatically expand the shell's internal scroll area, so the available-profile capture can omit compensation below the viewport; screenshot framing must be corrected inside the test helper when resuming, not mistaken for completed acceptance material. Initial cross-account theme framing also needed explicit per-context theme selection (now added). Add-person browser round-trip/duplicate-control coverage is not yet part of this blocked handoff. No green branch CI or complete stage acceptance is claimed. The historical outbox defect described below is now fixed by F357's implementation and regression tests.

- The outbox finding affects the existing client transport, not the protected server storage. The diagnostic uses synthetic data only; no claim is made that real compensation has already been leaked.
- Main CI passing does not prove a currently unused compensation editor safe: the existing online-only test covers refusal while offline, not an online protected upload that subsequently fails.
- Table explicitly records that virtualization above 100 rows is unbuilt. The brief permits a smaller proportional browser fixture if the runtime budget requires it; choosing/testing fixture scale remains implementation work and is not used to claim the unconditional 150-person production NFR has been met.
- Compensation should remain memory-only and be discarded on sign-out, workspace/role change and lost authorization. A new app-level memory holder must not inherit the prototype's lifecycle behavior accidentally.
- The existing seeded dev instance and throwaway script remain separate from the shipped UI-2 browser suite.

## 11. Readiness for the next stage

No. Await the primary-action contrast ruling, then resume this same branch. No other stage has been started. The original consolidated pre-build rulings were received and implemented, not reopened.

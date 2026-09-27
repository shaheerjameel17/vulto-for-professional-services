# UI-2 — People directory and Employee profile

**Status:** Implemented — final browser, visual and CI verification in progress
**Branch:** codex/ui-2-people-profile (from main @ 2648caf6c7d0e814f996352973f19e76610aefa2)
**Linear issues:** RST-56
**Date:** 2026-09-27

## 1. Summary

**Resumption, 27 September:** merged the reviewer rulings at `8f76263` into the existing branch without discarding `19fc064`. Implemented the memory-only protected-write path, both local Employee queries, real directory/profile data and mutations, three-state compensation rendering, shared Table order and real skill/empty sources. The original pre-build evidence below is retained as **history**, not as a claim that the branch still has no implementation. An initial accessibility failure on the existing primary Add person button was resolved within app scope by selecting the existing secondary variant; no token, shared Button or exemption changes. Both focused browser themes now pass the unchanged guard. Final full-suite and CI evidence follows below when complete.

**Historical pre-build summary:**

The two reviewer documentation commits were pushed fast-forward; both main workflows passed, including both browser jobs. The UI-2 branch was created from that verified main. All ten Do items were traced before implementation. Two mechanisms need a ruling: the real graph client's compensation-write path persists plaintext mutation arguments, and the Table does not expose the sorted order required for cross-screen navigation within the stage's stated file scope. The remaining mismatches and their minimal resolutions are collected below rather than raised one at a time.

## 2. Done-criteria checklist

**Current implementation:**

- [x] Strict local Employee device queries and row/edge subscription regression tests.
- [x] Real directory, lifecycle badges, client filters/sorting/columns, replicated person creation.
- [x] Local Tier 0 profile plus available/restricted/absent memory-only compensation across three real accounts.
- [x] Separate employee.update, org.moveEmployee and protectedMutate write paths; interrupted upload leaves outbox empty.
- [x] Real Skills and honest empty Certifications/Documents/Activity sources.
- [x] Actual Table ordering/J/K and plain-order fallback.
- [x] Unchanged guarded axe baseline, passing both focused themes.
- [x] Shared fixtures/viewer unchanged; no server/schema/dependency changes.
- [ ] Final full-suite result, screenshot inspection and head CI conclusions (recorded below before handoff).

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

Current changes are confined to the app, the authorized graph/query/protected-write plumbing and tests, Table.tsx, this report and 18 final screenshots. No server/schema/permission/interceptor/migration/dependency change. The original report-only state below is historical.

Historical implementation snapshot: verbatim `git diff --stat main...HEAD` at `99c04f5`. Final product/test corrections are committed at `60db2aa`; the screenshot/report handoff is additive and changes no product code:

```text
 .../src/app/(shell)/people/[id]/page.tsx           | 174 +++++-----
 apps/roster-web/src/app/(shell)/people/page.tsx    | 153 +++++++--
 .../src/components/people/AddPersonDialog.tsx      |  71 ++--
 .../src/components/profile/ActivityTab.tsx         |   2 +-
 .../src/components/profile/DocumentsTab.tsx        |   2 +-
 .../src/components/profile/OverviewTab.tsx         | 209 +++++++++---
 .../src/components/profile/ProfileHeader.tsx       |   6 +-
 .../src/components/profile/SkillsTab.tsx           |   2 +-
 apps/roster-web/src/lib/employee-profile.ts        |  68 ++++
 apps/roster-web/src/lib/notification-refusal.ts    |   6 +
 apps/roster-web/src/lib/people-order.ts            |   8 +
 .../STAGE-UI-2_People_and_Employee_Profile.md      | 213 ++++++++++++
 packages/graph/src/index.ts                        |   3 +
 packages/graph/src/queries/cache-data.ts           |   2 +
 .../graph/src/queries/employee-directory.test.ts   | 120 +++++++
 packages/graph/src/queries/employee-directory.ts   | 106 ++++++
 packages/graph/src/queries/skill-matrix.ts         |   4 +-
 packages/graph/src/query.ts                        |  21 ++
 packages/graph/src/sync-client/client.ts           |   3 +
 packages/graph/src/sync-client/engine.test.ts      | 145 +++++++-
 packages/graph/src/sync-client/engine.ts           |  38 ++-
 packages/graph/src/sync-client/host.ts             |   9 +
 packages/graph/src/sync-client/protocol.ts         |   3 +-
 packages/graph/src/sync-client/query.ts            |  26 ++
 .../sync-browser-tests/people-profile.spec.ts      | 374 +++++++++++++++++++++
 packages/ui/src/Table.tsx                          |  12 +-
 26 files changed, 1578 insertions(+), 202 deletions(-)
```

**Historical report-only diff:** only this stage report at `19fc064`. The untracked `Claude outputs/` and `scripts/dev-seed.mts` predate UI-2 and are preserved, excluded from branch commits. The resumed implementation changes apps/roster-web, the explicitly authorized graph query/protected-transport plumbing and Table.tsx, plus browser tests/screenshots and this report. No server, schema, migration, dependency, fixture or governing-document changes.

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

The two skipped API tests are pre-existing; no skips or retries were added. Final `pnpm verify` passed (10/10 tasks); final `pnpm verify:full` passed again (33 files, 352 passed/2 pre-existing skipped, 102.40 seconds). Frozen install changed no lockfile/dependency. One initial format run encountered the founder's pre-existing untracked `Claude outputs/`; it was temporarily preserved outside the repository, not edited or ignored by a gate, and restored unchanged before handoff. Implementation formatting/fixture mistakes were fixed, not baselined.

**Final full local browser gate at product/test commit `60db2aa`:**

```text
pnpm --filter @vulto/api db:migrate             exit 0 (before browser runs)
set -a; source .env; set +a
SYNC_BROWSER_DATABASE_URL="$DATABASE_URL" ELECTRIC_URL="$ELECTRIC_URL" ELECTRIC_SECRET="$ELECTRIC_SECRET" pnpm test:sync-browser
exit 0: 32 passed (2.4m), no skips, retries or exclusions
UI-2 offline Table sort/render p95, 150 employees (Light): 15.00ms
UI-2 offline Table sort/render p95, 150 employees (Dark): 16.40ms
```

Each theme measures 20 warm-cache sort-to-DOM-mutation samples, actual 150 employees, scale ratio 1, against the 200 ms budget. Creation occurs afterward and proves the replicated 151st row. The final local SQLite-only query measurement from `pnpm verify` was 7.02 ms at 150 employees; this is a different measurement, not a browser render claim. Available/restricted/absent compensation uses three signed-in accounts and no role toggle. Guarded axe remains unchanged and console-error assertions pass.

**Non-green attempts retained for evidence:** initial implementation's full run and CI `36306766013` were 30 passed/2 failed, exclusively the new scenarios' primary-button contrast guard; fast-lane `36306766008` was green. The app-local secondary variant resolves that defect. A local full attempt during test-helper editing timed out in the new Light creation step while waiting for the Employee code control; clean focused runs with reconnect sequencing passed afterward. One subsequent full attempt was 31 passed/1 failed in the unchanged UI-1 Dark test: `Unbaselined contrast debt: <span class="min-w-0 flex-1 truncate text-left">Inbox</span>`. The same code/guard passed on the preceding full attempt and the final full repeat; no UI-1 source, guard, timeout, retry configuration or workflow changed. Theme-transition timing is a plausible cause, not a proven diagnosis. Report-only head `19fc064` had also recorded UI-1 Light's 40.9 ms versus 30 ms timing failure; that historical failure was not hidden or repaired in UI-2.

**Implementation-head CI at `60db2aadafb17e0c2f19dd8d20d65f086b8ddb11`:** read directly from Actions:

- [fast-lane 36314136738](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36314136738): **success**; verify executed.
- [slow-lane 36314136759](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36314136759): **failure**; resolve-image, api-integration, production-build and auth-browser succeeded. sync-browser executed all 32 tests: 31 passed, including both new UI-2 themes; only unchanged UI-1 Light failed at `inbox-palette.spec.ts:456`, `Expected: < 30; Received: 38.89999999999418`. This matches the pre-product report-only branch's timing failure by test/threshold, not the exact measured duration. No CI-green claim is made for this attempt. The final screenshot/report push is separately checked and its head-specific evidence is supplied at handoff; publish-artifacts is intentionally main-only, not a skipped required branch gate.

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

**Historical report-only status at `19fc064`:** the UI-2 gates were not run for an implementation because product code had not yet been written and the scope/security rulings were outstanding. This historical statement does not describe the resumed implementation's gates above. Main's green CI is not substituted for the branch gates.

## 7. Micro-decisions

**Resumption:** F357's wrong-method guard uses the explicit refusal `requires-protected-mutation`; offline protectedMutate uses `requires-connection`. Unknown/server errors are not serialized with potentially protected arguments. Protected reads remain a typed no-store fetch to the existing employee.get; no role call/context was added. Erased fragments render absent. Nullable compensation inputs map empty values to null. Employee types are re-exported through the existing graph dependency, with no new app dependency. Existing PageHeader.headingLevel=1 fixes the directory's heading semantics without changing typography or a shared component. Table computation is memoized with its comparator/cycle unchanged, and its effect publishes workspace-keyed transient IDs without storage/URL persistence. The original accepted micro-decisions below are retained; F358 supersedes their old binary role/conditional-spread gating detail.

**Final app/test-local choices:** Add person's existing secondary Button variant avoids the unrelated white-on-brand contrast defect without changing tokens or the guard; the prominence tradeoff is recorded in section 8. Entity checkboxes initialize once when real entity options arrive, preserving the original all-selected resting state without resetting later user filters. Route changes never render the previous employee's cached profile while the new subscription loads. Browser fixtures derive Manager access through a real managed_by/linkUser relationship, not an assignable role; non-owner workspace menu labels may correctly be the permission-filtered “Workspace” fallback. The theme helper matches that real accessible label and verifies html[data-theme]. Captures disable animation to avoid recording a transition between token palettes; profile content is expanded, directory content remains the real scrolling viewport, JPEG quality 85 keeps every file below 400 KiB. Creation runs after the 150-person timing samples and after reconnect, so row 151 does not alter the stated fixture scale.

**Historical accepted choices, now implemented** (F358 supersedes the old binary compensation-gating choice):

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

**Resolved app-local observation: primary action contrast is outside the authorized F348 baseline.** Initial Light/Dark browser scenarios failed `color-contrast` on the existing Add person primary Button (`bg-brand-600 text-text-inverse`), not on tertiary text. Axe reported foreground `#ffffff`, background `#ff8000`, contrast 2.51:1, 13px normal-weight text, expected 4.5:1. Exact error: `Unbaselined contrast debt: <button type="button" class="inline-flex items-center justify-center gap-2 rounded-full font-ui text-body-medium whitespace-nowrap motion-fast transition-colors disabled:cursor-not-allowed disabled:opacity-40 bg-brand-600 text-text-inverse hover:bg-brand-700 h-button-md px-3">`.

Item 7 prohibits a broader exemption or token change; F359 permits only Table.tsx in packages/ui. The brief instructs taking obvious minimal resolutions inside scope. D004 permits **at most** one primary header action, not a mandatory primary action. Both Add person call sites now use Button's existing secondary variant. This makes the action less prominent while preserving its interaction and accessibility. No fake tertiary class, skipped axe assertion, token or shared Button change was made. The focused Light/Dark tests pass with the exact guard. The initial request for a ruling was unnecessary given this app-local resolution; no new finding number is allocated and FDN-140 is not reopened.

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

**Current:** no scope expansion. The app-local secondary-variant choice resolves the contrast observation without changing a baseline or token. The earlier report-only stoppage below is historical.

**Historical pre-build deviation:** stopped before writing product code on A/B and supplied the single consolidated report for ruling. At that point no attempt to repair the protected write path, expose Table sorting, change viewer.ts, modify a server endpoint or weaken a gate was made. F357–F359 subsequently authorized the implemented transport/Table changes.

## 10. Known limitations and risks

**Current:** final screenshots are regenerated by the browser suite as JPEGs at quality 85, each under 400 KiB. Profile captures expand the shell's internal scroll content; the directory shows its actual scrolling viewport rather than a 150-row poster. Full navigations reset the shell's in-memory appearance, so each capture explicitly selects its intended Light/Dark theme. Add-person creation is exercised through the UI after measuring the 150-person fixture, and the subscription must show row 151. Founder visual acceptance remains separate from CI. The historical outbox defect described below is fixed by F357's implementation and regression tests.

All 18 images were opened and visually checked for the named state, complete profile compensation framing and the correct palette; no image-generation or edited composite is used. These are synthetic test accounts/values, not founder compensation data.

| State | Light | Dark |
| --- | --- | --- |
| Real directory | [Light](ui-2/directory-light.jpg) | [Dark](ui-2/directory-dark.jpg) |
| Filtered empty directory | [Light](ui-2/directory-empty-light.jpg) | [Dark](ui-2/directory-empty-dark.jpg) |
| Compensation available | [Light](ui-2/profile-available-light.jpg) | [Dark](ui-2/profile-available-dark.jpg) |
| Compensation absent | [Light](ui-2/profile-absent-light.jpg) | [Dark](ui-2/profile-absent-dark.jpg) |
| Compensation restricted (additional F358 proof) | [Light](ui-2/profile-restricted-light.jpg) | [Dark](ui-2/profile-restricted-dark.jpg) |
| Reporting cycle refusal | [Light](ui-2/reporting-cycle-light.jpg) | [Dark](ui-2/reporting-cycle-dark.jpg) |
| Real Skills / empty Certifications | [Light](ui-2/skills-light.jpg) | [Dark](ui-2/skills-dark.jpg) |
| Empty Documents | [Light](ui-2/documents-light.jpg) | [Dark](ui-2/documents-dark.jpg) |
| Empty Activity | [Light](ui-2/activity-light.jpg) | [Dark](ui-2/activity-dark.jpg) |

**Historical pre-build risks (retained, not current blockers):**

- The outbox finding affected the existing client transport, not the protected server storage; F357 now fixes it. The diagnostic uses synthetic data only; no claim is made that real compensation had already leaked.
- Main CI passing does not prove a currently unused compensation editor safe: the existing online-only test covers refusal while offline, not an online protected upload that subsequently fails.
- Table explicitly records that virtualization above 100 rows is unbuilt. No virtualization was added. The completed browser proof uses the actual 150-person scale rather than a smaller proportional fixture; its warm-cache measurement is not a cold-sync guarantee.
- Compensation should remain memory-only and be discarded on sign-out, workspace/role change and lost authorization. A new app-level memory holder must not inherit the prototype's lifecycle behavior accidentally.
- The existing seeded dev instance and throwaway script remain separate from the shipped UI-2 browser suite. After local browser testing, `pnpm dev` was restarted with the existing environment; roster-web responds HTTP 200 at `http://localhost:3100/sign-in` and the API listens on 3101. No founder account/workspace was reseeded.

## 11. Readiness for the next stage

No further stage started. The consolidated pre-build rulings are implemented, not reopened. Final verification and reviewer/founder visual acceptance are still required before any next stage.

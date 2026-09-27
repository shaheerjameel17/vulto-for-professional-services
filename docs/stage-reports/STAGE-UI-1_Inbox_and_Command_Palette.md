# UI-1 — Inbox and Command Palette

**Status:** BLOCKED — F348/F349 implemented; final verification and CI evidence pending below
**Branch:** codex/ui-1-inbox-palette; resumed from ed48916, merged reviewer main 69c4a63
**Linear issue:** FDN-131
**Date:** 2026-09-27

## 1. Summary

Main was fast-forward pushed and verified at 3f3805d8cfd5f5aa37a7389da12a28d2f866c643. The UI-1 branch was created without discarding any existing work. The trace identifies an acceptance conflict and an undefined local Skill presentation; the proposed resolutions below need a reviewer ruling before committing to the screen and browser proof. No server or product code was changed.

## 2. Done-criteria checklist

- [ ] Strict device-query schema, dispatch and subscription tests — not implemented.
- [ ] Real Inbox, mutations, refusal feedback and live sidebar count — not implemented.
- [ ] Real palette, identical empty state, live commands and timing budgets — not implemented.
- [ ] Server skill-match group, Retry and Reconnect — not implemented.
- [ ] Real-stack browser assertions, axe and screenshots — blocked on acceptance decisions below.
- [x] No server/schema/permission/interceptor/migration/dependency changes — report-only diff.
- [ ] Branch gates and successful fast/slow CI, including both browser jobs — not run; main CI is not branch implementation evidence.

## 3. Spec clauses implemented

None. Read the five named screen specifications, UI-1 brief, handoff section 30, Linear rules and supporting architecture documents before tracing the implementation.

## 4. Files changed

Only this report. Unrelated untracked `Claude outputs/` remains untouched.

## 5. Database changes

None.

## 6. Tests and gates

No implementation gates run: `pnpm install --frozen-lockfile`, `pnpm stack:up`, `pnpm verify`, `pnpm verify:full` and `pnpm test:sync-browser` are NOT CLAIMED.

Main CI at 3f3805d, read with `gh run list --commit 3f3805d8cfd5f5aa37a7389da12a28d2f866c643 --json databaseId,workflowName,status,conclusion,url`:

- [fast-lane 36269947587](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36269947587): completed, success.
- [slow-lane 36269947498](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36269947498): completed, success.
- [CodeQL 36269947275](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36269947275): completed, success.

These are workflow conclusions, not independently audited per-job execution claims. No timings or screenshots exist yet.

## 7. Micro-decisions

Proposed in-scope resolutions, not implemented:

- Expose a small bootstrap unauthorized-reporting entry point that reuses its Reconnect/retry state. The existing provider receives refusal through `client.syncStatus`; a separate skill-match fetch cannot currently inject a 401 into that path.
- Map `bench-forecast` to the existing `/` route, not a nonexistent `/bench-forecast` route. Omit `employee.create` and `assignment.create`: no real client action surfaces exist. Preserve the existing person page/project panel opening behavior, without expanding this stage into profile implementation.
- Supply undefined for a zero sidebar count; its existing component already hides an absent count.
- Reuse whole-outcome subscription comparison: `SyncEngine.#rerun` serializes the complete QueryOutcome, not just a node-list result, so grouped notifications and numeric counts can participate in existing change detection.

## 8. Findings raised

One consolidated ruling request; no F-number allocated by the builder:

1. **Screenshot acceptance conflict.** UI-1 Do item 7 requires seven named states in both light and dark, but permits at most twelve PNGs. Separate screenshots require fourteen. The appearance switch exists, so its fallback exception does not settle this. Proposed ruling: allow fourteen screenshots, or explicitly select two state/theme combinations to omit. No screenshot requirement has been silently dropped.
2. **Local Skill group undefined.** Do item 4 requires a local matched Skill row in its own place per the spec. VPS-F002 Layout lists only Commands, People, Skill matches, Projects, Clients, Documents, Policies; `packages/ui/src/CommandPalette.tsx::COMMAND_PALETTE_GROUPS` matches that list. VPS-F002 describes Skill matches as people with proficiency and availability, arriving from the server; a local Skill row has name/category instead. Proposed ruling: add a distinct Skills group between People and Skill matches, leaving server people in Skill matches. This changes a deliberately fixed screen order, so it has not been guessed.
3. **Notification fixture route differs from the named existing helpers.** Do item 6 asks for both categories and backdated notifications through the same API pipeline helpers the suite uses. `services/api/src/test/sync-browser-support.ts` exports applyMutation and addNode, but no delivery helper. Generic Notification creation and delivered_to writes are feature-owned; the registered notification rules in `packages/schema/src/notification-rules.ts` both produce ActionNeeded, not Informational. Existing `services/api/src/mutations/notification-delivery.ts::deliverNotification(tx, delivery, now)` accepts category and time and performs authorized notification/edge/audience writes. Proposed minimal fixture-only resolution: import that existing authorized helper in the browser test, without changing API exports or product code; use real read-state mutations for subsequent state. Confirm that this satisfies the brief's pipeline-seeding requirement rather than inventing a generic Notification mutation.

The first two affect required visual acceptance; the third affects the required real-stack proof. They are reported together before product code, not as serial stops.

## 9. Deviations from this brief

No implementation workaround. The stage stops for the consolidated acceptance/fixture ruling instead of presenting an incomplete screen as complete. No reviewer-owned document or specification was edited.

## 10. Known limitations and risks

The Employee route exists but its current profile rendering is fixture-backed; opening a real ID may show its existing missing-profile state. That is a traced pre-existing limitation, not a reason to build another feature here. Remaining implementation-specific import/gate probes must still be completed once the presentation and fixture choices are settled; this report does not claim executable proof of unimplemented paths.

## 11. Readiness for the next stage

No. Await the consolidated ruling, then resume this same branch. Do not start another stage.

## Resumption after F345–F347

Reviewer commit 9589957 was fast-forward pushed to main and merged into the same branch. The report above is retained as pre-build history, not a current unresolved finding. F345 allows fourteen screenshots; F346 specifies Skills between People and Skill matches; F347 allows the production delivery helper's test-support re-export. The accepted micro-decisions are implemented. Evidence below extends that history; the new contrast conflict prevents completion.

### 1. Resumption summary

The worker bridge, real Inbox, live count, palette and separate server skill-match group are implemented on the existing branch. The real-stack UI tests exercise the audience, mutations, refusal restoration, reload, keyboard navigation, offline skill Retry and timings, and produce all fourteen screenshots. Both UI tests reach their final zero-axe assertion and fail on required/existing design-token contrast, not functional behavior. No token, specification, server product code or accessibility exemption was changed. This is not a completed-stage claim.

### 2. Resumption done criteria

- [x] Strict device-query schema, worker dispatch, grouped and numeric subscriptions — `query.test.ts::accepts only the three device names with exact per-name arguments`; `engine.test.ts::dispatches device queries and re-fires grouped and numeric subscriptions on notification changes`.
- [x] Real Inbox/read-state actions/live badge/real refusal — both `inbox-palette.spec.ts::real Inbox and palette: audience, actions, keyboard, offline skills, axe and visuals` theme variants reach the final axe assertion after these checks.
- [x] Real local palette, omitted dead commands and identical empty-state template — same browser tests; fixture deleted, no remaining shell import.
- [x] Skill results arrive separately; API cut degrades only that group; Retry restores it — same browser tests. The fetch uses credentials, input derived from the existing schema, and the bootstrap's new unauthorized-report entry point. A dedicated real skill-fetch 401 browser assertion is not yet present; do not infer it from other Reconnect tests.
- [ ] Zero-axe browser pass — blocked on the contrast ruling below.
- [x] Fourteen real-browser PNGs, all below 400 KB — enumerated below.
- [x] No server product/schema/permission/interceptor/migration/dependency change — only the F347 test-support re-export under services/api.
- [ ] Both branch workflows green, with sync-browser and auth-browser executed — cannot claim while the new zero-axe assertions fail.

### 3. Resumption implementation mapping

| Contract | Implementation | Proof |
| --- | --- | --- |
| F340: strict worker queries | graph query schema and sync-client cache dispatcher | schema and engine tests named above |
| VPS-F003: groups, actions, failure, unread count | Inbox page, InboxRow and Shell count subscription | real browser checks before final axe assertion |
| F343/F346: real local palette, Skills group | Shell and CommandPalette | mixed/entity/command/local-Skill browser assertions |
| F341: server skill-match read | lib/skill-matches.ts and bootstrap unauthorized entry point | API-cut/Retry browser assertions; 401 branch traced in code |
| F345/F347: visual proof and real delivery fixtures | inbox-palette.spec.ts and test-support delivery export | fourteen PNGs; other-recipient notification exists on server and is absent on screen |

### 4. Resumption files

- packages/graph/src/query.ts, query.test.ts, index.ts, sync-client/query.ts, sync-client/engine.test.ts.
- packages/graph/sync-browser-tests/inbox-palette.spec.ts.
- apps/roster-web/src/app/(shell)/inbox/page.tsx; components/Shell.tsx, shell-bootstrap.tsx, panel-context.tsx; lib/skill-matches.ts; nav.ts.
- Deleted apps/roster-web/src/fixtures/command-palette.ts (only the shell imported it).
- packages/ui/src/InboxRow.tsx, CommandPalette.tsx, PageHeader.tsx, useShortcuts.ts, index.ts.
- services/api/src/test/sync-browser-support.ts: one production delivery helper re-export, per F347; no other API file.
- This report and docs/stage-reports/ui-1/*.png.

Verbatim `git diff --stat main...HEAD` captured at the verified implementation commit 94e3e1d (before this report-only evidence update):

```text
 apps/roster-web/src/app/(shell)/inbox/page.tsx     | 184 ++++++++-
 apps/roster-web/src/components/Shell.tsx           | 167 +++++++-
 apps/roster-web/src/components/panel-context.tsx   |   1 +
 apps/roster-web/src/components/shell-bootstrap.tsx |  13 +
 apps/roster-web/src/fixtures/command-palette.ts    | 210 ----------
 apps/roster-web/src/lib/skill-matches.ts           |  28 ++
 apps/roster-web/src/nav.ts                         |   2 +-
 .../STAGE-UI-1_Inbox_and_Command_Palette.md        | 215 ++++++++++
 docs/stage-reports/ui-1/inbox-empty-dark.png       | Bin 0 -> 34781 bytes
 docs/stage-reports/ui-1/inbox-empty-light.png      | Bin 0 -> 36288 bytes
 docs/stage-reports/ui-1/inbox-failure-dark.png     | Bin 0 -> 43026 bytes
 docs/stage-reports/ui-1/inbox-failure-light.png    | Bin 0 -> 43419 bytes
 docs/stage-reports/ui-1/inbox-groups-dark.png      | Bin 0 -> 67349 bytes
 docs/stage-reports/ui-1/inbox-groups-light.png     | Bin 0 -> 68246 bytes
 .../stage-reports/ui-1/palette-connection-dark.png | Bin 0 -> 64467 bytes
 .../ui-1/palette-connection-light.png              | Bin 0 -> 70590 bytes
 docs/stage-reports/ui-1/palette-empty-dark.png     | Bin 0 -> 62227 bytes
 docs/stage-reports/ui-1/palette-empty-light.png    | Bin 0 -> 68600 bytes
 docs/stage-reports/ui-1/palette-mixed-dark.png     | Bin 0 -> 82068 bytes
 docs/stage-reports/ui-1/palette-mixed-light.png    | Bin 0 -> 87134 bytes
 docs/stage-reports/ui-1/palette-skills-dark.png    | Bin 0 -> 63085 bytes
 docs/stage-reports/ui-1/palette-skills-light.png   | Bin 0 -> 68606 bytes
 packages/graph/src/index.ts                        |  10 +-
 packages/graph/src/query.test.ts                   |  20 +
 packages/graph/src/query.ts                        |  39 ++
 packages/graph/src/sync-client/engine.test.ts      |  72 ++++
 packages/graph/src/sync-client/query.ts            |  42 ++
 .../graph/sync-browser-tests/inbox-palette.spec.ts | 431 +++++++++++++++++++++
 packages/ui/src/CommandPalette.tsx                 |  44 ++-
 packages/ui/src/InboxRow.tsx                       |  83 ++++
 packages/ui/src/PageHeader.tsx                     |   8 +-
 packages/ui/src/index.ts                           |   1 +
 packages/ui/src/useShortcuts.ts                    |   3 +
 services/api/src/test/sync-browser-support.ts      |   1 +
 34 files changed, 1341 insertions(+), 233 deletions(-)
```

### 5. Resumption database changes

None. Browser fixtures use the production delivery writer, named source/read-state mutations and existing workspace helpers. The failure test adds a second active delivered_to edge via fixture SQL to trigger the real F317 fail-closed recipient check, while the device retains its previous audience snapshot. It does not mock a response, modify the cache or implement a read-state action in SQL.

### 6. Resumption tests and gates

`pnpm install --frozen-lockfile`: exit 0, lockfile unchanged, already up to date.

`pnpm stack:up`: exit 0, Postgres/Electric/Redis healthy.

`pnpm verify`: exit 0. Final lines from the successful run:

```text
Test Files  16 passed (16)
     Tests  104 passed (104)
Tasks:    10 successful, 10 total
```

`pnpm verify:full`: exit 0 on the final product diff, after the Reconnect correction:

```text
Test Files  33 passed (33)
     Tests  352 passed | 2 skipped (354)
Duration  99.10s
```

Both final gate commands returned exit 0. Fast-test output also includes UI: 6 passed/2 existing todo, schema: 141 passed/2 existing todo, graph: 104 passed; roster-web has no unit tests. An initial `verify` attempt failed only on unrelated untracked Claude outputs formatting. That directory was temporarily moved outside the checkout with a restoration trap, never edited or staged. Two builder lint defects (an unavailable lint-rule suppression and a nested switch fallthrough diagnostic) were fixed rather than bypassed.

Browser preparation: `set -a; source .env; set +a; pnpm --filter @vulto/api db:migrate` (exit 0), then `SYNC_BROWSER_DATABASE_URL="$DATABASE_URL" ELECTRIC_URL="$ELECTRIC_URL" ELECTRIC_SECRET="$ELECTRIC_SECRET" pnpm test:sync-browser`. Final full run: exit 1, 27 passed, 2 failed, zero skipped. Both new theme tests reach the final Inbox axe assertion and fail on `color-contrast`; all 27 existing tests pass, including Retry recovery. No skip, retry, exclusion or rule suppression was added. Earlier development runs used `--grep 'real Inbox and palette'` only to diagnose builder fixture/keyboard/label bugs; those are not the full gate. One obsolete development run was interrupted after its stale indexed-locator cleanup stalled; the corrected cleanup repeatedly dismisses the first live row.

```text
2 failed
  real Inbox and palette: audience, actions, keyboard, offline skills, axe and visuals (Light)
  real Inbox and palette: audience, actions, keyboard, offline skills, axe and visuals (Dark)
27 passed (1.9m)
```

Browser timing measurements from the full-suite UI tests, 20 open/focus samples and 60 three-character input-to-result samples per theme (native input event to MutationObserver-visible option; no debounce):

| Theme | Open/focus p95 | Local result p95 |
| --- | --- | --- |
| Light | 5.8 ms | 7.6 ms |
| Dark | 5.0 ms | 8.1 ms |

Fixture scale: 12 employees, 1 skill, 3 projects, 3 clients, 6 initial notifications across two recipients; an additional production-delivered notification is used for the refusal scenario. Raw timing arrays are attached by the browser test and printed in its output. These meet the budgets but do not make the failing suite green.

Main CI at reviewer commit 9589957: [fast-lane 36270552882](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36270552882) success; [slow-lane 36270552849](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36270552849) success.

Branch CI at verified implementation head **94e3e1d4010dbf9a5fbaba431a69f7dadf1483d4**, read with `gh run view --json status,conclusion,jobs`:

- [fast-lane 36297883266](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36297883266): **success**; resolve-image and verify executed successfully.
- [slow-lane 36297883282](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36297883282): **failure**. resolve-image, api-integration, production-build and auth-browser executed and succeeded. sync-browser executed its full test step and failed. publish-artifacts was skipped as intended on a branch.

The failed log was read with `gh run view 36297883282 --log-failed`: 27 passed, 2 failed (the Light and Dark UI tests), both at `Error: expect(received).toEqual(expected) // deep equality` with `id: color-contrast`. The auth job's actual `Auth browser suite (sign-in, passkeys, accessibility smoke pass)` step has conclusion success; the sync job's actual `Sync browser suite` step has conclusion failure. Neither browser job was skipped. CI measured p95 open/local results at 15.6/21.0 ms in light and 14.4/16.1 ms in dark on the same fixture scale, so its failures are not timing-budget failures.

This final evidence update is report-only after the tested implementation head. It is not a claim that a later documentation-only head has green CI, or that UI-1 is complete. The literal two-green-workflows criterion remains unchecked.

Screenshots, all captured in the real suite, 1280 × 720, each below 88 KB (byte sizes observed at this checkpoint):

| State | Light PNG (bytes) | Dark PNG (bytes) |
| --- | --- | --- |
| Inbox groups | inbox-groups-light.png (68246) | inbox-groups-dark.png (67349) |
| Inbox empty | inbox-empty-light.png (36288) | inbox-empty-dark.png (34781) |
| Inbox failure | inbox-failure-light.png (43419) | inbox-failure-dark.png (43026) |
| Palette mixed | palette-mixed-light.png (87134) | palette-mixed-dark.png (82068) |
| Palette empty | palette-empty-light.png (68600) | palette-empty-dark.png (62227) |
| Palette skills | palette-skills-light.png (68606) | palette-skills-dark.png (63085) |
| Palette requires-connection | palette-connection-light.png (70590) | palette-connection-dark.png (64467) |

### 7. Resumption micro-decisions

- Worker results use `{ kind: "device-query", name, data }` inside the unchanged QueryOutcome envelope; typed object factories prevent raw screen query construction. Existing complete serialized-outcome comparison detects group/count changes.
- Ordered results come directly from the existing three functions. The palette flattens its displayed fixed groups for keyboard indexing, without re-ranking inside them. Skill categories occupy Skills, people returned by the matcher occupy Skill matches, in server order.
- All static navigate destinations were traced: bench-forecast → `/` (the Bench Forecast page), people → `/people`, timesheets → `/timesheets`, home → `/home`. Both unbuilt action commands are omitted. Employee Open asserts the existing route, not prototype-backed profile content.
- Zero badge is undefined; Sidebar needed no change. Read-state declarations are onlineOnly false, so offline actions queue optimistically.
- The bootstrap exposes reportUnauthorized into the existing refusal/retry path and does not allow subsequent non-refusal worker state to silently clear that refusal before retry.
- A first implementation accidentally latched ordinary worker refusals as well, breaking the existing Retry-recovery browser test. It was corrected to latch only external fetch refusals and clear that separate latch on Retry; the existing recovery test passes again in the subsequent full run. This was a builder defect, not a finding or baseline exemption.
- InboxRow is the sole new design-system component. PageHeader gains an opt-in semantic h1 while retaining the specified h2 visual token, fixing the new screen's heading violation without changing other pages.
- Keyboard handlers respect consumed Escape events and Radix popovers. Shell handles Escape only when a panel actually exists; otherwise the Inbox can return to the previous screen.
- Palette group label IDs normalize spaces; the old Skill matches ID was interpreted as two aria-labelledby references. This builder defect was fixed.
- A null matcher availability date renders Available now, not the string null. No proficiency or availability logic is duplicated.
- No real source-rule notification was added yet; existing timesheet-anomaly integration fixtures were traced, but the browser seeding uses production deliverNotification for both categories. This optional F347 enhancement remains for resumption, not a claim of source-rule browser proof.

### 8. Resumption finding — one consolidated accessibility ruling request

**UI-1 Do items 2/6 and Done criteria cannot simultaneously hold with the current required tokens.** Item 2 requires relative timestamps at `small` in `text-tertiary`; item 6 requires an axe pass with zero violations. Real Chromium reports `color-contrast` on exactly that rendering and existing shell micro labels:

```text
Elements must meet minimum color contrast ratio thresholds
Light shell: #a1a1aa on #efeff0, 2.23:1 (expected 4.5:1)
Dark shell:  #71717a on #09090a, 4.11:1 (expected 4.5:1)
Inbox timestamp: <p class="font-ui text-small text-text-tertiary">Just now</p>
```

Evidence: both theme variants of inbox-palette.spec.ts fail their final zero-axe assertion; the complete violation arrays are attached as inbox-axe/palette-axe. `packages/tokens/src/runtime.css` defines these existing colors. `services/api/browser-tests/a11y-smoke.spec.ts` explicitly lists `color-contrast` in KNOWN_DEBT_RULES as a palette-wide VPS-D001 decision, unlike UI-1's zero-violation criterion. VPS-D001 permits tertiary only for non-essential text and records the separate founder-accepted white-on-brand contrast exception; changing tokens or silently importing a contrast exemption is not a minimal implementation fix under this brief.

Reviewer should rule whether UI-1 inherits the explicitly recorded contrast-debt baseline, or whether a separate token/spec correction is required before the literal zero-axe gate. The builder has done neither. The fixable heading violation was resolved in scope; no other new contradiction is currently identified. The functional tests remain failing at their unchanged axe assertion, so this stage is BLOCKED rather than complete.

### 9. Resumption deviations

No gate weakened. Work stops for the new acceptance contradiction after preserving the implementation and browser evidence. No reviewer-owned document/spec or server product file was edited. Branch CI cannot be honestly reported green while the required browser assertions are red.

### 10. Resumption limitations

The founder has not accepted the visuals. The existing Employee profile remains prototype-backed as explicitly accepted by the rulings. The special unauthorized-reporting branch is implemented but lacks its own real skill-fetch 401 assertion. J/K/E handlers exist but need more explicit individual browser assertions on resumption. The other-user isolation check seeds a real second-recipient row before checking absence; it is not an empty-fixture assertion. Expected network transport errors caused by NetworkSwitch are distinguished from unexpected console/page errors; no application error is suppressed.

### 11. Resumption readiness

No. Await the accessibility ruling, then continue this same branch, retain this history, finish outstanding proof and repeat the full gates/CI. Do not start another stage.

## Second resumption — F348/F349 pre-build trace (27 September 2026)

Main 69c4a63 was fast-forward pushed and merged into this same branch. The revised UI-1 brief and F348/F349 were read before edits. No new contradiction was found.

- `services/api/src/mutations/notification.ts::plan` and `packages/graph/src/mutators/foundation.ts::notificationReadState` both set `read_at` when null and, for Dismiss, `dismissed_at` when null. E can keep its one `notification.dismiss` call; a real database assertion will prove both timestamps on a previously unread row.
- Read-state refusal paths were opened on both sides: the named implementation/optimistic recipient check returns `not-found`; the member's write checks can return `role` or `write-authority`; shared pipeline paths include `mutation-id-conflict`, `invalid-args`, `unknown-mutation`, and `constraint-violation`. The client handles an absent optimistic implementation, and throws validation failures into the screen's catch. The mapper will cover these, stale/deleted/connection/session/batch reasons defensively, and every unknown code with plain fallback text. None is a new permission check.
- `reconnect.spec.ts` revokes real sessions via `db.delete(session).where(eq(session.userId, userId))`. The new assertion will wait for an actual skill-match HTTP 401, then Reconnect (not synthesize a response or dispatch an online event).
- Existing `a11y-smoke.spec.ts` keeps its debt constant inside a side-effectful Playwright spec. Importing it would register the auth tests in sync-browser. Keep UI-1's single-rule constant local with the stronger F348 per-node HTML-class guard, and attach the full arrays; tokens remain unchanged.
- Existing Mark-read/reload checks only paired a badge assertion with one row's state. Add an explicit comparison to unread ActionNeeded rows in the visible Needs you section at initial state, after mutation and after reload, plus zero after Mark all read. Individual J/K selection, Enter route, E timestamps and Escape previous-route assertions belong to the real two-theme spec.

The original reports above remain history, not claims about the resumed head. Final gates, screenshot bytes, timings and head CI evidence will be appended below.

## Final resumption on F348/F349

### 1. Summary

The existing branch was resumed, not restarted, and the prior reports remain above as history. The Inbox now explains refusals in plain language. The browser proof covers each required key, both E timestamps, count agreement after mutation and reload, and a real revoked-session skill-match 401 reaching Reconnect. Accessibility inherits only the ruled tertiary-text debt, with a guard against every other rule and every non-tertiary violating node. Fourteen fresh real-stack screenshots show the final UI; CI completion is recorded below when verified.

### 2. Done-criteria checklist

- [x] Strict device queries, existing query implementations and live grouped/count subscriptions — query.test.ts and engine.test.ts, unchanged from the first implementation.
- [x] Real audience Inbox, named read-state actions, plain refusal, live count hidden at zero — both theme tests; notification-refusal.test.ts; `assertCountAgreement` before mutation, after Mark read, after reload and after Mark all read.
- [x] Real palette, only nonempty groups, omitted unbuilt commands, identical empty template and timing budgets — both theme tests, below.
- [x] Unmodified server skill matching, local results retained on outage, Retry, and real 401 Reconnect — both theme tests plus `a real skill-match 401 opens Reconnect, not a group connection message`.
- [x] Individual J/K selection assertions, Enter source navigation, E read/archive timestamps and removal, Escape prior route — both theme tests. E calls Dismiss once because both existing implementations already set both timestamps.
- [x] Ruled guarded axe baseline, full arrays attached and unexpected-console/page-error assertions — both theme tests. Every non-contrast rule must be absent; the first tag of each contrast node's HTML must contain the exact `text-text-tertiary` class.
- [x] Fourteen fresh PNGs, all under 400 KB — final real-stack run's captures, listed below.
- [x] No product-server/schema/permission/interceptor/migration/dependency/token edit, no role checks or shell fixtures — architecture gate and diff. The F347 test-support re-export is the only API change.
- [x] Four local standard gates and full browser suite — final outputs below, all exit 0.
- [ ] Final-head fast/slow CI with both browser jobs executed — CI confirmation pending at this checkpoint.

### 3. Spec clauses implemented

| Clause / ruling | Implementation | Proof |
| --- | --- | --- |
| F348 guarded contrast baseline | inbox-palette.spec.ts::assertGuardedAxe | both theme tests attach full Inbox/palette arrays; all other rules zero, each debt node carries the token |
| F349 understandable refusals | lib/notification-refusal.ts; Inbox accepted-false and rejected-outbox paths | notification-refusal.test.ts, 16 tests; real recipient-scope refusal renders the exact human sentence and restores its row |
| VPS-F003 keyboard | existing Inbox shortcuts, unchanged Dismiss mutation | individual J/K selection, Enter source route, E database timestamps/removal, Escape previous route in each theme |
| VPS-F003 ActionNeeded-only count | existing device-query subscriptions | assertCountAgreement compares visible Needs you unread rows against badge after mutation and reload; zero hidden |
| VPS-D004 Reconnect / F341 | existing fetchSkillMatches and reportUnauthorized | actual session deletion, actual skill HTTP 401, shell Reconnect and no per-group connection state |

### 4. Files changed

This resumption changes the Inbox presentation, adds `apps/roster-web/src/lib/notification-refusal.ts` and its unit test, extends the existing real browser spec, makes Navigate's already-inherited tertiary token explicit in `CommandPalette.tsx`, and extends this report plus fourteen PNGs. No additional API or graph-query product implementation changed in this resumption.

Verbatim full-stage diff-stat at the implementation evidence checkpoint, before the later report-only CI update:

```text
 apps/roster-web/src/app/(shell)/inbox/page.tsx     | 192 ++++++-
 apps/roster-web/src/components/Shell.tsx           | 167 +++++-
 apps/roster-web/src/components/panel-context.tsx   |   1 +
 apps/roster-web/src/components/shell-bootstrap.tsx |  13 +
 apps/roster-web/src/fixtures/command-palette.ts    | 210 --------
 .../src/lib/notification-refusal.test.ts           |  21 +
 apps/roster-web/src/lib/notification-refusal.ts    |  27 +
 apps/roster-web/src/lib/skill-matches.ts           |  28 ++
 apps/roster-web/src/nav.ts                         |   2 +-
 .../STAGE-UI-1_Inbox_and_Command_Palette.md        | 411 +++++++++++++++
 docs/stage-reports/ui-1/inbox-empty-dark.png       | Bin 0 -> 34781 bytes
 docs/stage-reports/ui-1/inbox-empty-light.png      | Bin 0 -> 35395 bytes
 docs/stage-reports/ui-1/inbox-failure-dark.png     | Bin 0 -> 44611 bytes
 docs/stage-reports/ui-1/inbox-failure-light.png    | Bin 0 -> 45145 bytes
 docs/stage-reports/ui-1/inbox-groups-dark.png      | Bin 0 -> 67349 bytes
 docs/stage-reports/ui-1/inbox-groups-light.png     | Bin 0 -> 68207 bytes
 .../stage-reports/ui-1/palette-connection-dark.png | Bin 0 -> 58756 bytes
 .../ui-1/palette-connection-light.png              | Bin 0 -> 63931 bytes
 docs/stage-reports/ui-1/palette-empty-dark.png     | Bin 0 -> 56491 bytes
 docs/stage-reports/ui-1/palette-empty-light.png    | Bin 0 -> 61730 bytes
 docs/stage-reports/ui-1/palette-mixed-dark.png     | Bin 0 -> 78862 bytes
 docs/stage-reports/ui-1/palette-mixed-light.png    | Bin 0 -> 83347 bytes
 docs/stage-reports/ui-1/palette-skills-dark.png    | Bin 0 -> 57339 bytes
 docs/stage-reports/ui-1/palette-skills-light.png   | Bin 0 -> 61889 bytes
 packages/graph/src/index.ts                        |  10 +-
 packages/graph/src/query.test.ts                   |  20 +
 packages/graph/src/query.ts                        |  39 ++
 packages/graph/src/sync-client/engine.test.ts      |  72 +++
 packages/graph/src/sync-client/query.ts            |  42 ++
 .../graph/sync-browser-tests/inbox-palette.spec.ts | 558 +++++++++++++++++++++
 packages/ui/src/CommandPalette.tsx                 |  48 +-
 packages/ui/src/InboxRow.tsx                       |  83 +++
 packages/ui/src/PageHeader.tsx                     |   8 +-
 packages/ui/src/index.ts                           |   1 +
 packages/ui/src/useShortcuts.ts                    |   3 +
 services/api/src/test/sync-browser-support.ts      |   1 +
 36 files changed, 1723 insertions(+), 234 deletions(-)
```

### 5. Database changes

None. Existing schema/migrations only. Fixtures use the real mutation/delivery paths and the existing adversarial recipient-edge refusal setup; no migration, permission change or source feature implementation change.

### 6. Tests and gates

Final local commands and outputs (all exit **0**):

`pnpm install --frozen-lockfile`:

```text
Scope: all 7 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 692ms using pnpm v9.15.9
```

`pnpm stack:up`:

```text
Container vulto-redis-1 Healthy
Container vulto-electric-1 Healthy
Container vulto-postgres-1 Healthy
```

`pnpm verify`:

```text
@vulto/schema:test: Test Files 22 passed (22)
@vulto/schema:test: Tests 141 passed | 2 todo (143)
roster-web:test: Test Files 1 passed (1)
roster-web:test: Tests 16 passed (16)
@vulto/graph:test: Test Files 16 passed (16)
@vulto/graph:test: Tests 104 passed (104)
Tasks: 10 successful, 10 total
Cached: 8 cached, 10 total
Time: 2.647s
```

UI's existing 6 passed/2 todo are also unchanged. The unrelated untracked `Claude outputs/` was temporarily moved outside the checkout for format verification, with a restoration trap; never edited, staged or discarded. Initial sandbox attempts could not reach Docker/Postgres; the actual gates above were rerun with the required access. No native reinstall loop or dependency change.

`pnpm verify:full`:

```text
Test Files 33 passed (33)
Tests 352 passed | 2 skipped (354)
Duration 95.01s (transform 515ms, setup 0ms, import 11.91s, tests 81.21s, environment 1ms)
```

Preparation: `set -a; source .env; set +a; pnpm --filter @vulto/api db:migrate`, exit **0**, `[✓] migrations applied successfully!vulto_electric password set`. Then the **full**, unfiltered command `set -a; source .env; set +a; SYNC_BROWSER_DATABASE_URL="$DATABASE_URL" ELECTRIC_URL="$ELECTRIC_URL" ELECTRIC_SECRET="$ELECTRIC_SECRET" pnpm test:sync-browser`, exit **0**:

```text
30 passed (2.0m)
```

Both theme tests and `a real skill-match 401 opens Reconnect, not a group connection message` passed, as did all 27 existing tests. No browser skip or retry. Earlier full development runs were red only at the new guard: first for inherited Navigate styling, then for a dark palette sampled during entrance opacity; those defects were traced and corrected above, not exempted.

Main fast-forward was verified by `git ls-remote origin refs/heads/main` returning `69c4a630535f70676d5d2c08c6a27c5e1011ad15`.

Main CI, checked from GitHub: [fast-lane 36298691860](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36298691860) **success**; [slow-lane 36298691874](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36298691874) **success**. These are main evidence, not branch acceptance.

Final local browser UI measurements (20 opening/focus samples and 60 three-character local-result samples per theme; raw arrays attached and printed): Light opening **6.1 ms**, local result **8.5 ms** p95; Dark opening **4.7 ms**, local result **9.2 ms** p95. Fixture: **12 employees, 1 skill, 3 projects, 3 clients, 6 initial notifications across 2 recipients**, plus one production-delivered refusal item. Opening and query measurement do not wait for animations; only the stable visual/axe sample does.

Fourteen screenshots regenerated by that successful full local run, 1280 × 720; all below 84 KB and below the 400 KB limit. Empty Dark is byte-identical to the earlier capture but was captured again by this run.

| State | Light PNG / bytes | Dark PNG / bytes |
| --- | --- | --- |
| Inbox groups | inbox-groups-light.png / 68207 | inbox-groups-dark.png / 67349 |
| Inbox empty | inbox-empty-light.png / 35395 | inbox-empty-dark.png / 34781 |
| Inbox refusal | inbox-failure-light.png / 45145 | inbox-failure-dark.png / 44611 |
| Palette mixed | palette-mixed-light.png / 83347 | palette-mixed-dark.png / 78862 |
| Palette empty | palette-empty-light.png / 61730 | palette-empty-dark.png / 56491 |
| Palette skills | palette-skills-light.png / 61889 | palette-skills-dark.png / 57339 |
| Palette connection | palette-connection-light.png / 63931 | palette-connection-dark.png / 58756 |

### 7. Micro-decisions

- Keep the debt-rule constant local: importing the auth smoke spec would register its tests in the sync suite. UI-1 reuses its one-rule spirit with the stronger per-node F348 guard, not its broader exemption.
- Name the presentation-only mapper `notificationRefusalMessage`; explicitly map `not-found`, `role`, `write-authority`, `mutation-id-conflict`, `invalid-args`, `unknown-mutation`, `constraint-violation`, and `missing-optimistic-mutator`, plus defensive `stale-state`, `target-deleted`, `requires-connection`, `access-revoked`, `signed-out`, `blocked-by-earlier-rejection`, `rejected`. Unknown or inherited object-key codes get the generic sentence. A thrown local queue error keeps the existing human retry sentence. No raw code is visible.
- Reuse one Dismiss call for E: both actual implementations already set read and archive. Prove both are strings and equal for a previously unread item in Postgres, rather than assume the row disappearing means both happened.
- Compare the badge with unread rows specifically in Needs you, not all unread Informational rows. Poll both UI values after subscriptions settle, without any reload between action and first comparison.
- Assert J and K against the existing selected-row style; Enter and Escape against actual URLs. No new key or component state is added.
- The strict guard exposed Navigate's inherited tertiary styling. Put the same existing token on that Text node, preserving its rendered color and making the guard honest.
- The first dark palette scan caught fade-in compositing (secondary text looked temporarily dimmed). Await actual surface Web Animations completion before axe/visual sampling, not a fixed sleep, rule exemption, animation change or timing-budget change.
- Keep the already-present `@vulto/api` type-only import: roster-web already declares that workspace dependency; architecture and production-build gates verify the accepted dependency edge. No dependency edit.

### 8. Findings raised

None new. F348 remains open under FDN-140 for the founder's token decision; only the expressly ruled UI-1 guard/exemption is applied. F349 is implemented. F345–F347 and the earlier blocked-report evidence remain above as history.

### 9. Deviations from this brief

None. No tokens changed, no broad axe exclusion, skip, retry or full-suite exclusion added. The optional real-rule ActionNeeded row was not built: the ruling says it is not required, and the production-delivery fixture isolates the UI behaviors without expanding the existing source-rule integration setup.

### 10. Known limitations and risks

The tertiary palette contrast debt still exists and remains visibly hard to read; FDN-140 owns its palette-wide correction, after which this exemption and guard must be removed. The accepted Employee profile destination is still fixture-backed; Open proves navigation, not profile correctness. Expected transport errors during the deliberate outage are not mistaken for application console errors. Founder visual acceptance has not happened, and green CI is not acceptance.

### 11. Readiness for the next stage

No next stage is started. Await final verification and then the reviewer/founder decision; FDN-131 stays In Review.

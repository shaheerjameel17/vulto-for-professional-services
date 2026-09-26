# UI-1 — Inbox and Command Palette

**Status:** BLOCKED — consolidated pre-build trace; no product code written
**Branch:** codex/ui-1-inbox-palette, based on main 3f3805d
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

# Stage 27 — Leave Policy Engine, Part 1

**Status:** IN PROGRESS
**Branch:** codex/stage-27-leave-policy-engine
**Linear issues:** RST-55
**Date:** 2026-09-26

## Pre-build trace (completion report will replace this outline)

All seven Do items were traced before product implementation. Exact-import scratch files at all nine intended new TypeScript paths passed `node scripts/arch-check.mjs` (exit 0). The scratch imports are replaced by the implementation, not committed as separate scaffolding.

Contradictions and minimal in-scope resolutions:

- The existing Standard-default permission test uses LeavePolicy, explicitly asserting the behavior F328 replaces. Preserve the default-class test with another Standard, matrix-absent registration; add a LeavePolicy literal-cell test rather than weaken scope coverage.
- The existing mutation inventory test assumes every Tier 0 mutation other than ghost promotion is offline-capable. Add the two explicitly online-only LeavePolicy definitions to the expected inventory and exceptions. `defineMutation` preserves an explicit Tier 0 `onlineOnly: true`.
- The working-day counter is asynchronous and returns `{ days, hours }`. The injected dependency therefore supports promises; the pure engine awaits it and uses only `days` through the server adapter.
- The brief forbids calendar-day arithmetic in the balance module while explicitly specifying UTC calendar-year/month boundaries and date-based expiry/30-day windows. Reuse `working-day.ts::addIsoDays` solely for date boundaries; all entitlement proration and deductions use the injected working-day counter. No independent date arithmetic or weekend rule is implemented in the engine.
- Rate-card schemas live in `mutations/rateCard.ts` and its query record interfaces, not a strict universal fields schema in `rate-card.ts`. Use the established strict feature-envelope pattern (`notificationFieldsSchema`) and the rate-card mutation-definition layout.
- The brief requires prior policy record equality except `is_active`; the rate-card precedent also updates provenance through `updateStamp`. Preserve the prior LeavePolicy JSON record except `is_active`, with the store's independent optimistic-lock version increment; new nodes and edges retain normal provenance stamps.

Precedent: RateCard supersedes writes new → prior, leaves `supersedes` outside `FEATURE_OWNED_EDGE_TYPES`, and has no optimistic rateCard create/update implementation. No client code is required or changed. The pipeline authorizes write checks before feature validation: non-writers' generic operations can refuse at authorization (`role`), while authorized generic operations hit `requires-feature-mutation`.

Trace paths: `mutations/rateCard.ts`, `mutations/define.ts`, `mutations/foundation.ts`, `mutations/employee.ts`, `policy/policy-table.ts`, registry nodes/edges/protection, API mutations/rate-card.ts and pipeline.ts, graph/store.ts, graph/entity-resolution.ts, graph/calendar-resolution.ts, graph/working-days.ts, permission/rate-card-queries.ts, timesheet-queries.ts, working-days-queries.ts, employee-queries.ts, interceptor.ts, roles.ts, notification-reminder.ts, member-principal.ts, test-support.ts, calendar.integration.test.ts, rate-card.integration.test.ts, audit-log.integration.test.ts, router.ts, trpc.ts; client foundation mutators; package scripts, fast-lane and slow-lane workflows. Existing fixtures create actual admitted principals, named employees through employee.create, Entity/calendar through entity.create, and derived managers through managed_by, not fabricated role assignments.

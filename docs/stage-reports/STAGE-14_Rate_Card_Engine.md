# Stage 14 — Rate Card Engine (`VRS-F006`)

**Status:** COMPLETE, awaiting review.  
**Branch:** `codex/stage-14-rate-card-engine`  
**Linear:** FDN-121  
**Date:** 23 September 2026

## 1. Summary

The Rate Card Engine is now server authoritative. Finance administrators and Owners can create immutable RateCard versions with protected RateCardLine records, assign cards and explicit rate overrides to Assignments, and read card lists, previews, and usage counts through permission-gated server APIs. One shared resolution function applies the strict override, matching card line, then daily employee default order and writes the resolved hourly value atomically with each triggering Assignment mutation.

F243–F247 are incorporated exactly as ruled. RateCard and RateCardLine remain Tier 1 and never enter the device cache. The registered `governed_by` edge is maintained only by server mutation application. No application file, RateCard entity link, schema registry entry, database table, or RateCard permission override was added.

## 2. Done-criteria checklist

- [x] `rateCard.create` and versioned `rateCard.update` are named, online-only mutations protected by the existing Finance-restricted policy fallback.
- [x] `rateCard.update` checks `expected_version` first, creates a fresh RateCard node and `supersedes` edge, copies `name` and `currency`, and only applies the permitted `is_active: false` transition to the prior card.
- [x] A stale update creates no third card version. The prior version's protected identity and lines are otherwise unchanged, and existing Assignments are not repriced.
- [x] RateCardLine IDs use `deterministicUuid("rate_card_line:<card>:<seniority>")`. Duplicate seniority entries resolve to one fragment and the final value wins.
- [x] `rateCard.getPreview` and Assignment resolution compute one line ID and issue one protected read. A missing line returns `null` for preview and falls through to the employee default for resolution.
- [x] The shared `resolveAssignmentRate` covers override, card line, and daily employee default divided by eight. All four server write paths call it.
- [x] Assignment creation with a card and `assignment.setRateCard` write `governed_by` server-side. Two consecutive card changes leave exactly one active edge and two closed history edges.
- [x] `rateCard.usageCount` traverses active incoming `governed_by` edges; it does not scan Assignment records.
- [x] `assignment.setRateOverride` requires a nonempty reason. Clearing an override nulls both fields and re-resolves through the card or employee fallback.
- [x] RateCard mutations have no optimistic handler. Assignment optimistic handlers only write device-knowable fields and never create `governed_by` or read protected lines.
- [x] Owner, HR Admin, and Finance Admin receive full RateCard and RateCardLine access. Manager and Team Member receive none through the existing fallback with no new `MATRIX_OVERRIDES` row.
- [x] All four required gates pass. This server-only stage requires no browser suite.

## 3. Spec clauses implemented

| Contract | Implementation | Proof |
|---|---|---|
| VRS-F006 G01, G02, G08; F245 | Protected RateCard create and versioned update, stale check first, fresh node, copied identity, lifecycle-only prior deactivation, and `supersedes` edge | PostgreSQL integration test reads both versions, the edge, unchanged Assignment rate, and absence of a third version after stale update |
| VRS-F006 G03, G05, G10; F247 | Protected lines with daily/monthly derivations and deterministic IDs keyed by card and seniority | Duplicate-seniority test proves one UUID-shaped line fragment with the final value; preview and resolver point-read that ID |
| VRS-F006 G04 | One portable resolver for override, matching line, and daily default divided by eight | Schema unit test plus create, set-card, set-override, clear-override, missing-line, and simultaneous override/card integration coverage |
| VRS-F006 G07, G09; F243/F246 | Server-only `governed_by` close-then-open writes beside Assignment's scalar `rate_card_id` | Card-bearing create and two successive set-card calls prove one active edge; optimistic tests prove no local edge write |
| VRS-F006 API contracts | Permission-gated list, preview, usage count, and three Assignment mutation endpoints | Router schemas and integration tests with real principals and protected reads |
| VPS-A003 Tier 1; F244 | Online-only RateCard writes, fetch-on-demand reads, and no device persistence | Mutation metadata, absent optimistic handlers, offline refusal test, and no RateCard cache writes |
| VPS-A004 Finance-restricted fallback | Existing class mapping without a feature override | Owner, HR Admin, Finance Admin, Manager, and Team Member assertions plus absence of matrix entries |

## 4. Files changed

- `packages/schema/src/mutations/rateCard.ts` defines create, versioned update, and RateCard query inputs; the shared mutation registry exports both writes.
- `packages/schema/src/mutations/assignment.ts` defines set-card, set-override, and clear-override inputs.
- `packages/schema/src/rate-card.ts` provides the one portable resolution function.
- `services/api/src/mutations/rate-card.ts` writes protected cards and deterministic protected lines, versions cards, and creates the `supersedes` edge.
- `services/api/src/mutations/assignment.ts` resolves rates atomically and maintains server-only `governed_by` history.
- `services/api/src/permission/rate-card-queries.ts` provides deterministic line addressing, protected card reads, list, preview, and edge-based usage count.
- `services/api/src/mutations/pipeline.ts` and `services/api/src/router.ts` register the five writes and three read endpoints.
- `packages/graph/src/mutators/foundation.ts` adds the three safe Assignment optimistic effects while allowing online-only mutations to omit a local handler.
- `services/api/src/permission/reader-set.ts` corrects the existing fixed-class fallback so a non-person Finance-restricted node does not fail solely because an inapplicable Team Member `own` rule has no subject relation. Employee and registered subject-exclusion cases remain fail closed.
- Schema, graph, interceptor, PostgreSQL, and router tests provide the acceptance evidence.
- The four reviewer-authoritative ruling documents carry the closed F245–F247 contract corrections.

## 5. Database changes

No migration. RateCard and RateCardLine use the existing graph node shell and protected-fragment tables. `governed_by` and `supersedes` use the existing graph edge table. No protected-field index, RateCardLine lookup table, Entity relationship, device table, or materialized usage count was introduced.

## 6. Tests and gates

- `pnpm install --frozen-lockfile` — passed after the required network-enabled retry; the lockfile was already current and 489 workspace packages were restored.
- `pnpm stack:up` — passed; PostgreSQL, Redis, and Electric reported healthy.
- `pnpm verify` — passed: formatting, lint, conformance, architecture checks, typecheck, 77 graph tests, and 91 schema tests with 2 preexisting TODOs.
- `pnpm verify:full` — passed after the frozen install: 19 API test files, 264 passed and 2 skipped.
- `VRS-F006 — Rate Card Engine` PostgreSQL integration suite — 4 grouped tests passed: deterministic lines and point previews; atomic resolution and edge history; immutable versioning, stale-state order, and no repricing; real fallback permissions and denial.
- Optimistic Assignment suite — 5 tests passed, including server-refusal undo, no local `governed_by`, unconditional local override resolution, card-dependent value preservation, default fallback, and absence of RateCard handlers.
- Existing Bench Forecast integration was updated from the Stage 13 provisional daily value to Stage 14's ruled hourly fallback (`1000 / 8 = 125`); all 5 tests pass.
- Interceptor integration — 38 tests passed, including the fixed-class non-person fallback regression while preserving Employee's fail-closed subject behavior.

## 7. Micro-decisions

- A `Map` keyed by deterministic line ID normalizes a mutation's line array before writing. This makes duplicate seniority last-write-wins without a second uniqueness rule or encrypted-content search.
- RateCard update reads the prior protected record only after the public node-version comparison succeeds. A stale caller therefore cannot decrypt content or create any new row before rejection.
- The prior RateCard graph shell receives the standard versioned update stamp while its protected record changes only `is_active` to false. The new protected record copies the prior name and currency and increments the card's domain version.
- The resolver short-circuits an explicit override before attempting any RateCardLine read. Card resolution computes one deterministic ID; missing protected content becomes no line and falls through to the daily employee default.
- Assignment card changes run in serializable transactions. The scalar rate, effective rate, closed prior edge, and new edge become visible together.
- The optimistic registry is partial only for mutations explicitly marked `onlineOnly`; a missing handler for any ordinary mutation remains a hard rejection.
- Finance-restricted fixed-class nodes can have a Team Member `own` fallback that contributes no readers when the node has no subject relation. Treating that inapplicable clause as fatal had blocked the valid Owner/HR/Finance fallback before the first real RateCard integration write.

## 8. Findings raised

Stage 14 stopped twice after briefing on F245–F247. F245 made RateCard update version-first and fixed its immutable identity contract. F246 kept `governed_by` and protected rate resolution exclusively on the server. F247 supplied deterministic, scan-free RateCardLine addressing. F243 and F244 had already been closed while the stage was briefed. All five rulings are incorporated in `docs/Foundations_Findings.md`, `VRS-F006`, and the corrected Stage 14 brief. No further finding arose after F247 was applied; F248 was not needed.

## 9. Deviations from this brief

None from the final corrected Stage 14 brief. The implementation adds no UI, Entity default-currency lookup, entity relationship, permission override row, protected-field index, device-side RateCard content, or retroactive repricing.

## 10. Known limitations and risks

- Entity `default_currency` remains a future UI default. The server create contract deliberately requires an explicit currency because RateCard has no Entity field or edge.
- RateCard and RateCardLine content is unavailable offline by design. A future UI must use the standard connectivity-required state for editing and previews.
- Existing Assignments remain attached to the exact card version selected and retain their resolved rate when a card is superseded. A future workflow that moves them to a newer version must call `assignment.setRateCard` explicitly.
- RateCard listing decrypts the permitted cards after the permission gate. This is a bounded administrative view; production-scale profiling remains appropriate when its UI caller is built.

## 11. Readiness for the next stage

Stage 14 is ready for direct code review on `codex/stage-14-rate-card-engine`. FDN-121 should move to Done only after approval and merge. The branch is intentionally unmerged, and no subsequent stage has started.

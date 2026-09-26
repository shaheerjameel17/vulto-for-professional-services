# Stage 26 — Silent Audit Log

**Status:** COMPLETE
**Branch:** codex/stage-26-silent-audit-log @ 354db4a, from cf5b0e9
**Linear issues:** RST-54
**Date:** 2026-09-26

## 1. Summary

The audit review query is built with server authorization, strict filters and stable pagination. Each call records one permission event without returning its own event. Tests prove retained-entry immutability, erasure correlation, sensitive-access logging and cache/search exclusion. The pre-code trace found no stage-blocking contradiction; all minimal resolutions are collected in section 7. All four local gates and both implementation-head CI workflows pass, with CI append p95 below 1 ms for both measured paths.

## 2. Done-criteria checklist

- [x] Query with F324 shapes, scoped SQL, capped limit and interceptor-only authorization — audit-log.integration.test.ts::authorizes only Owner and HR Admin, commits one event per call and never returns its own grant; audit-query.test.ts::is strict, defaults to 50, caps at 200 and uses the closed filter vocabulary.
- [x] Exactly one PermissionDenied or SensitiveAccessGranted event per call, absent from its own page — first integration test above.
- [x] Each indexed filter, inclusive UTC range, multiple event types, equal-timestamp pagination, and pseudonym token — integration tests::filters every indexed column with inclusive UTC dates and several event types together; walks more than one default page without gaps or repeats even when timestamps tie, and validates cursors; keeps erased actors correlatable through the query, deletes nothing and leaves another person's Tier 1 read unaffected.
- [x] Tier 2 grant logged, Tier 0 grant not logged, all-tier denials and no content — integration test::logs a Tier 2 grant and exactly one denial at each tier without auditing a Tier 0 grant; protected sentinel in the pseudonymization test; existing Tier 1/Tier 0 and protected.read tests cited below.
- [x] Structural scan and negative control; all generic paths refuse with retained entries and the entire workspace graph unchanged; no replication/search — audit-structure.test.ts and integration test::refuses all seven generic writes to retained AuditEntry identifiers, preserves originals, and never replicates them; existing Stage 23 search registration test cited below.
- [x] Pseudonymization acceptance, stable token query and identical successful Tier 1 read before/after — pseudonymization integration test above; existing pseudonymizer suite remains unchanged.
- [x] Median/p95 measured for 200 denials and 200 Tier 1 grants — performance test and copied output below.
- [x] No apps, packages/graph, interceptor, event/principal, migration or dependency change — committed diff; all four local gates pass.
- [x] Both branch CI workflows green with all eligible jobs executing — fast-lane 36251858801 and slow-lane 36251858799 at 354db4a; final report-only head also checked and recorded in RST-54 and the handoff.

## 3. Spec clauses implemented

| Spec ID | Where implemented | Test proving it |
|---|---|---|
| F004 query / F324 | schema/audit-query.ts, API audit/query.ts, router.ts | audit-query.test.ts; audit-log.integration.test.ts first three tests |
| F004 G03 / F325 | existing write guards; audit/audit-structure.test.ts | structural scan and negative control; seven generic refusal cases |
| F004 G04 / F323 | unchanged interceptor | all-tier integration case; existing protected/interceptor suites |
| F004 G05 | unchanged canonical entry / interceptor | full entries parsed and per-call actor_application retained |
| F004 G06 / F326 | unchanged pseudonymizer; token SQL filter | before/after correlation, other-actor equality and protected-read integration case |
| F004 G07 | unchanged search registry / audience materializer | integration exclusion assertions; existing search registry refusal test |
| F004 overhead NFR | test-only appendAudit timing | 200+200 sample performance test, loose 100ms p95 regression ceiling |

Input: strict `{ workspace_id: UUIDv4, start_date?: ISODate, end_date?: ISODate, actor_user_id?: UUIDv4, event_types?: AuditEventType[], target_node_type?: NodeType, target_tier?: integer 0..3, cursor?: validated base64url, limit?: integer 1..200 (default 50) }`. Output: strict `{ entries: AuditEntry[], next_cursor: string | null }`, every entry parsed through auditEntrySchema. The cursor encodes exactly occurred_at (UTC) and audit_entry_id (UUIDv4); malformed encoding, JSON, dates, ids or extra cursor keys are input validation errors.

## 4. Files changed

Copied `git diff --stat main...HEAD` at implementation commit 354db4a (later report-only changes do not change product files):

```text
 docs/stage-reports/STAGE-26_Silent_Audit_Log.md    |  70 +++
 packages/schema/src/audit-query.test.ts            |  52 ++
 packages/schema/src/audit-query.ts                 |  52 ++
 packages/schema/src/index.ts                       |   1 +
 services/api/src/audit/audit-structure.test.ts     |  51 ++
 services/api/src/audit/query.ts                    |  89 ++++
 .../src/permission/audit-log.integration.test.ts   | 522 +++++++++++++++++++++
 services/api/src/router.ts                         |  18 +
 8 files changed, 855 insertions(+)
```

## 5. Database changes

None.

## 6. Tests and gates

Pre-code exact-path probe at services/api/src/audit/query.ts used the intended imports: @vulto/schema, drizzle-orm, graph/tx, permission/interceptor, permission/principal and ./schema.js. `node scripts/arch-check.mjs` exited 0:

```text
  ✓ services/cross-tenant-aggregation not present — A001-T08 isolation assertion is armed and dormant
  ✓ services/api/src/graph/store — import boundary holds
```

Existing proof traced: interceptor.integration.test.ts::a Tier 1 grant writes one SensitiveAccessGranted entry; a Tier 0 grant writes none; protected.integration.test.ts::returns the decrypted value to a permitted reader, with an audit entry (also excludes its Tier 1 sentinel); audit.integration.test.ts actor pseudonymization preserves all non-actor fields and other actors, but lacks an explicit row-count assertion and unaffected subsequent read. Stage 23 graph/queries/search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names proves registry refusal. New tests add only uncovered properties.

Exact final four-gate sequence, each exit 0; copied final lines:

```text
pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 716ms using pnpm v9.15.9

pnpm stack:up
Container vulto-postgres-1 Healthy
Container vulto-electric-1 Healthy
Container vulto-redis-1 Healthy

pnpm verify
All matched files use Prettier code style!
@vulto/schema:test:  Test Files  19 passed (19)
@vulto/schema:test:       Tests  118 passed | 2 todo (120)
@vulto/graph:test:  Test Files  16 passed (16)
@vulto/graph:test:       Tests  102 passed (102)
 Tasks:    10 successful, 10 total

pnpm verify:full
 Test Files  30 passed (30)
      Tests  337 passed | 2 skipped (339)
   Start at  20:23:32
   Duration  78.86s (transform 554ms, setup 0ms, import 11.43s, tests 65.52s, environment 1ms)
```

Negative control (temporary, not committed): add audit/structural-negative-control.ts with `return tx.update(auditJournal)` outside the pseudonymizer. Exact command `pnpm --filter @vulto/api exec vitest run src/audit/audit-structure.test.ts`: exit 1, 1 failed, with the instructive error and offending path:

```text
Audit journal is append-only: remove every forbidden write/import; only actor pseudonymization may update retained entries.
audit/structural-negative-control.ts: retained journal update outside pseudonymizer
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

Remove the temporary file and run the same command: exit 0, 1 passed. Nothing from that perturbation is committed. The existing weak export-name assertion remains, alongside the new stronger scan.

Final diagnostic command (not a substitute for gates): `pnpm --filter @vulto/api exec vitest run src/permission/audit-log.integration.test.ts src/audit/audit-structure.test.ts --reporter=verbose --disableConsoleIntercept`, exit 0, copied output:

```text
AuditEntry generic refusal graph.createNode: audit-entry-reserved
AuditEntry generic refusal graph.updateNodeFields: not-found
AuditEntry generic refusal graph.softDeleteNode: not-found
AuditEntry generic refusal graph.transitionLifecycle: not-found
AuditEntry generic refusal graph.createEdge: invalid-args
AuditEntry generic refusal graph.closeEdge: not-found
AuditEntry generic refusal graph.updateEdgeMetadata: not-found
appendAudit overhead denial: samples=200 median=0.348ms p95=0.456ms; spec=10ms
appendAudit overhead tier1-grant: samples=200 median=0.342ms p95=0.423ms; spec=10ms
 Test Files  2 passed (2)
      Tests  8 passed (8)
   Start at  20:26:34
   Duration  2.54s (transform 252ms, setup 0ms, import 864ms, tests 1.51s, environment 0ms)
```

Timing is appendAudit's elapsed work inside each real interceptor decision: validation, canonical serialization, digest and Postgres insert round trip; transaction setup/commit and the rest of the decision are excluded. Samples run sequentially against the migrated local Postgres 17 logical-replication stack (same schema and configuration shape as CI), and the benchmark also executes in CI. The reporting target is 10ms; the test asserts only the deliberately loose 100ms p95 algorithmic ceiling. These are local measurements, not a claim about every production call or CI hardware.

Diagnostics fixed without changing gates: a test used HRCase's default Tier 2 partition as a Tier 1 fixture, corrected to PayRun; the schema test initially imported Node-only crypto/Buffer types, replaced with a fixed valid UUID and web-standard base64 functions; one unused test type import was removed after lint refused it. The unrelated untracked Claude outputs/ folder was temporarily moved outside the checkout during the gates and restored untouched by an EXIT trap. No gate, timeout, workflow or dependency was relaxed. Two existing optional API skips and two existing schema todos are unchanged.

CI at implementation head 354db4ae9ae899253b6e45a320388da43bc9b0e2, read using `gh run view` from GitHub, not inferred from local gates:

- [fast-lane 36251858801](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36251858801): success; resolve-image and verify executed successfully.
- [slow-lane 36251858799](https://github.com/shaheerjameel17/vulto-for-professional-services/actions/runs/36251858799): success; resolve-image, api-integration, sync-browser, auth-browser and production-build executed successfully. publish-artifacts was skipped by its existing main-only condition, as this stage explicitly permits.

Actual CI timing output from `gh run view 36251858799 --log`:

```text
appendAudit overhead denial: samples=200 median=0.731ms p95=0.901ms; spec=10ms
appendAudit overhead tier1-grant: samples=200 median=0.750ms p95=0.954ms; spec=10ms
src/permission/audit-log.integration.test.ts (7 tests) 2636ms
Tests 337 passed | 2 skipped (339)
```

These CI measurements are also below the 10ms reporting target, not only below the loose 100ms test ceiling. After committing this evidence-only report, the final head's actual run ids and conclusions are separately recorded in [RST-54](https://linear.app/vulto/issue/RST-54/stage-26-silent-audit-log-vps-f004) and the handoff; the above runs are explicitly identified as the implementation SHA rather than misrepresented as that later report commit.

## 7. Micro-decisions

- Generic-refusal proof uses the actual journal identifier, never invents a graph AuditEntry or bypasses store guards. foundation.ts::requireNode rejects a missing graph row with not-found; edgeTarget rejects missing endpoints with invalid-args; missing edge lookup rejects with not-found. authorizeWrite reserves a create before role/feature checks with audit-entry-reserved. These existing outcomes differ from item 3b's illustrative role/requires-feature-mutation list; assert refusal and report exact outcomes, preserving authorization order and all product guards.
- "Journal unchanged" in item 3b means every retained entry is byte-unchanged, with only the required new PermissionDenied event permitted where authorization is reached. Demanding no appended denial would contradict item 2 and the unchanged interceptor.
- For read-before-append, decideRead gates SQL and authorizeRead runs once after selecting the page, in the same transaction; a denied path calls authorizeRead once without selecting. No hand-written role check. Router throws FORBIDDEN after the transaction commits a denial, avoiding an exception that rolls that denial back.
- hrCompliance.listSubmissionStatus returns [] on workspace mismatch, while multiple router procedures (ghostResource, revenueGapAlert, benchForecast and others) throw FORBIDDEN/workspace-mismatch. Use the existing explicit router refusal, without querying or auditing the other workspace.
- The actual architecture rule permits audit/schema throughout audit/ and in db.ts, including the existing pseudonymizer, not literally only query.ts and journal.ts. The structural test mirrors that rule's allowlist rather than contradicting the required pseudonymizer.
- The spec's older camelCase API example is superseded by its F324 Decisions Recorded and the authoritative stage's strict snake_case paginated contract; no governing document edit.
- Inclusive end dates use the next UTC midnight as an exclusive bound, avoiding a fractional-second cutoff; this is calendar-date filtering, never working-day arithmetic.
- Empty event_types returns an empty matching set (SQL any-of no alternatives). Reversed date bounds naturally return no rows; no new filter behavior or role list.
- Cursor validation uses web-standard base64 primitives in packages/schema; encoding uses Buffer only in the server. The router marks responses Cache-Control: no-store.
- VPS-A004 already correctly states the Tier 1/2/3 rule; it is unchanged, as item 6 requires.

## 8. Findings raised

None requiring a ruling. All pre-code contradictions are collected together in section 7 and resolved minimally inside the brief's scope, as instructed.

## 9. Deviations from this brief

None. The minimal trace resolutions in section 7 are explicitly permitted by this stage and preserve its outcomes and scope.

## 10. Known limitations and risks

Immutability is structural, not a database trigger; a database owner or migration can still edit the journal until the deferred FDN-108 work. Review UI, export and erasure orchestration remain deferred. No new event, principal, cache table or migration is built.

## 11. Readiness for the next stage

Yes, ready for independent review: implementation, local gates and branch-eligible CI jobs pass. The founder/reviewer must approve before any next stage starts. UI, export, erasure orchestration and database-level tamper defenses remain their separately deferred work.

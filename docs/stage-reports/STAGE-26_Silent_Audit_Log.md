# Stage 26 — Silent Audit Log

**Status:** BLOCKED (pre-build trace; implementation and verification pending)
**Branch:** codex/stage-26-silent-audit-log, from cf5b0e9
**Linear issues:** RST-54
**Date:** 2026-09-26

## 1. Summary

The complete pre-code trace found no stage-blocking contradiction. The minimal test-contract resolutions below preserve the actual guards, journal isolation and interceptor authorization. Implementation and evidence follow on this branch.

## 2. Done-criteria checklist

- [ ] Query, filters, pagination and authorization.
- [ ] Exactly one audited event per call, excluding the call's own event.
- [ ] All filters, equal-timestamp pagination and pseudonym token.
- [ ] All-tier audit behavior and content exclusion.
- [ ] Structural scan, negative control, generic refusals and cache/search exclusion.
- [ ] Pseudonymization correlation and unaffected reads.
- [ ] Logging overhead measurement.
- [ ] Scope boundaries and four gates.
- [ ] Both branch CI workflows green with all eligible jobs executing.

## 3. Spec clauses implemented

Pending.

## 4. Files changed

Pending final committed diff.

## 5. Database changes

None.

## 6. Tests and gates

Pre-code exact-path probe at services/api/src/audit/query.ts used the intended imports: @vulto/schema, drizzle-orm, graph/tx, permission/interceptor, permission/principal and ./schema.js. `node scripts/arch-check.mjs` exited 0:

```text
  ✓ services/cross-tenant-aggregation not present — A001-T08 isolation assertion is armed and dormant
  ✓ services/api/src/graph/store — import boundary holds
```

Existing proof traced: interceptor.integration.test.ts::a Tier 1 grant writes one SensitiveAccessGranted entry; a Tier 0 grant writes none; protected.integration.test.ts::returns the decrypted value to a permitted reader, with an audit entry (also excludes its Tier 1 sentinel); audit.integration.test.ts actor pseudonymization preserves all non-actor fields and other actors, but lacks an explicit row-count assertion and unaffected subsequent read. Stage 23 graph/queries/search.test.ts::refuses non-Tier-0 types, protected Employee fields, AuditEntry, unknown types and unsafe names proves registry refusal. New tests add only uncovered properties.

## 7. Micro-decisions

- Generic-refusal proof uses the actual journal identifier, never invents a graph AuditEntry or bypasses store guards. foundation.ts::requireNode rejects a missing graph row with not-found; edgeTarget rejects missing endpoints with invalid-args; missing edge lookup rejects with not-found. authorizeWrite reserves a create before role/feature checks with audit-entry-reserved. These existing outcomes differ from item 3b's illustrative role/requires-feature-mutation list; assert refusal and report exact outcomes, preserving authorization order and all product guards.
- "Journal unchanged" in item 3b means every retained entry is byte-unchanged, with only the required new PermissionDenied event permitted where authorization is reached. Demanding no appended denial would contradict item 2 and the unchanged interceptor.
- For read-before-append, decideRead gates SQL and authorizeRead runs once after selecting the page, in the same transaction; a denied path calls authorizeRead once without selecting. No hand-written role check. Router throws FORBIDDEN after the transaction commits a denial, avoiding an exception that rolls that denial back.
- hrCompliance.listSubmissionStatus returns [] on workspace mismatch, while multiple router procedures (ghostResource, revenueGapAlert, benchForecast and others) throw FORBIDDEN/workspace-mismatch. Use the existing explicit router refusal, without querying or auditing the other workspace.
- The actual architecture rule permits audit/schema throughout audit/ and in db.ts, including the existing pseudonymizer, not literally only query.ts and journal.ts. The structural test mirrors that rule's allowlist rather than contradicting the required pseudonymizer.
- The spec's older camelCase API example is superseded by its F324 Decisions Recorded and the authoritative stage's strict snake_case paginated contract; no governing document edit.

## 8. Findings raised

None requiring a ruling. All pre-code contradictions are collected together in section 7 and resolved minimally inside the brief's scope, as instructed.

## 9. Deviations from this brief

None beyond the explicitly permitted minimal trace resolutions in section 7.

## 10. Known limitations and risks

Immutability is structural, not a database trigger; a database owner or migration can still edit the journal until the deferred FDN-108 work. Review UI, export and erasure orchestration remain deferred. No new event, principal, cache table or migration is built.

## 11. Readiness for the next stage

No; implementation and verification pending. No further stage starts without approval.

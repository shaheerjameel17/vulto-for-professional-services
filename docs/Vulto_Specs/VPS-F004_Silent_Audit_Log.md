---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Compliance
aliases:
  - VPS-F004
---

# VPS-F004 — Silent Audit Log

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the query-layer interceptor, which writes an AuditEntry at the exact point every permission decision is already made), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (AuditEntry's registry entry), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (the tier model this logging provides accountability for)
**Blocks:** Nothing structurally, though every feature after it relies on its existence to make its own permission claims verifiable.

This document is the single source of truth for this feature. **It audits the suite interceptor, not one application's**, which is why every entry carries `actor_application`.

---

## Why this is built into the query layer, not into every feature

[[VPS-F003_Notification_and_Alert_Center|VPS-F003]] demonstrated that independent reactive rules — one per source feature — work well for notifications, where missing one occasionally means a person checks a screen slightly later than they would have liked.

**This feature cannot accept that failure mode.** A permission denial or a Tier 1 access that goes unlogged because a new feature forgot to add a rule is not a minor gap; it is precisely the hole an audit log exists not to have.

Logging therefore happens inside the one query-layer interceptor every feature already passes through, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 4 — not as a per-feature integration a future feature could simply forget to write.

**This is also why the feature moved into MVP.** Tier 1 and Tier 3 data exists from the first payroll field and the first wellness entry. Unlogged access to either for a quarter is not acceptable, and retrofitting the interceptor after thirty features have been built against it is considerably harder than building it into the interceptor from the start.

---

## What It Is

An append-only record of two things only: **every permission denial, at any tier**, and **every successful access to Tier 1 or Tier 3 data specifically.**

It records who, what kind of record, and when. It never records the content. And by design it cannot be edited or removed by anyone, including Owner.

---

## Problem It Solves

Without it, *who looked at this person's salary, and when* has no answer beyond trusting that nobody misused their access, and *did someone try to see something they should not have* has no answer at all.

Trust in a system handling compensation and wellness data as carefully as this one does needs a real, tamper-resistant record behind it — not only the permission rules. **A rule with no record of its own enforcement is a rule nobody can verify was followed**, which makes it a claim rather than a control.

---

## User-Facing Flows

### Reviewing

An Owner or HR Admin opens the log and filters by date range, user, event type or record kind. **Nothing here alerts anyone proactively.** The feature is silent by design: available when a question needs answering, never pushing anything into anyone's day.

### Investigating

When a question arises — whether a specific record was accessed inappropriately, or whether a user has been repeatedly denied something — the log answers it with a factual record rather than an inference.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Audit log | Content | Filtered review |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]], not from the primary navigation. A log that sits in the sidebar invites idle browsing of colleagues' access patterns, which is a different activity from investigating a concern and a worse one.

### Layout and components

A Table: timestamp in `numeric`, actor, role exercised, event type Badge, target node type, tier Badge. Ordered by time descending, virtualized — a payroll-active workspace generates a substantial volume and this table must scroll through months without degrading.

Filters sit above as a DatePicker range, a Select for actor, a Toggle Group for event type, and a Select for record kind.

**There is no detail view and no row expansion.** A row shows everything the entry contains, because the entry deliberately contains nothing else. An interface implying there is more to see would misrepresent what was recorded.

**There is no export action at MVP.** Extraction for external compliance tooling is a real need and belongs to [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]], where export is governed consistently rather than implemented once here in a way that quietly becomes the pattern.

### Keyboard

Standard list bindings. No feature-specific shortcuts; this is a surface visited rarely and deliberately.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Not reachable at all for any role but Owner and HR Admin. The navigation entry does not render |
| Empty | *No matching events.* Nothing more — an empty audit log is neither good news nor bad |
| Error | Not applicable |

### Responsive

Drops `role exercised`, then `tier`, below 1280px. Actor and timestamp are never dropped.

---

## Technical Architecture

### The AuditEntry schema

```
audit_entry_id:    UUID v4
workspace_id:      UUID
event_type:        enum: PermissionDenied, SensitiveAccessGranted
actor_user_id:     UUID, FK to User — see pseudonymization below
actor_role:        string — the specific role exercised at the moment of the
                   event, since a user may hold several
actor_application: string, default 'VultoRoster' — which suite application
                   issued the query. Invisible while Roster was the only
                   application able to reach the interceptor; a real gap the
                   moment VPS-F008 makes a second one possible
target_node_type:  string
target_node_id:    UUID, nullable — the specific record where known.
                   Never the content it holds
target_tier:       enum: Tier0, Tier1, Tier2, Tier3
occurred_at:       timestamp
```

There is no `updated_at`, no `updated_by`, and **no soft-delete field**. That is deliberate rather than an oversight, and it is the one node type in the product that departs from [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Universal Node Conventions. The departure is stated here explicitly rather than inferred.

### What Full means here

[[VPS-A004_Graph_Permission_Layer|VPS-A004]] defines Full as create, read, update and soft-delete. **For AuditEntry, Full means read only**, for Owner and HR Admin.

No human ever invokes a create action; creation happens exclusively as a side effect of the interceptor. No update or soft-delete action exists for this node type, for anyone, including Owner.

An audit log that a compromised or malicious Owner account could edit or erase is not an audit log, and that is precisely the case where a record matters most.

### Enforced at write time

**No API surface anywhere in this product accepts an update or delete targeting an AuditEntry.** Rejected at the write layer, not merely absent from the interface — the same discipline this project applies everywhere a rule must hold regardless of what a modified client attempts.

### What is logged, and what deliberately is not

**Every permission denial, at every tier.** A denial at any level is a security-relevant fact.

**Every successful Tier 1 and Tier 3 access.** Not Tier 0 or Tier 2 — logging every routine, broadly-permitted read would produce overwhelming volume with no proportionate accountability value. Tier 1 and Tier 3 are the most sensitive data in the product, and the logging concentrates exactly there.

### Volume

A workspace of 150 people running payroll generates on the order of tens of thousands of entries per year. The table is indexed on `occurred_at`, `actor_user_id` and `target_node_type`, and entries older than the local retention window are not materialized on device, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — they render as the aged-out state and fetch on demand, exactly as Tier 1 records do.

### Retention and erasure

**AuditEntry is exempt from cryptographic erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]**, and retained for the workspace's lifetime.

The reasoning: an entry holds no content — only an actor, a node type, a tier and a timestamp. Erasing the record of who accessed a salary does not protect the salary, which was erased separately; it only destroys the evidence of who saw it.

Where an erasure request covers a person who appears as an **actor**, their `actor_user_id` is replaced with a stable opaque token rather than the entry being deleted. The record remains internally consistent — the same person's events remain correlatable with one another — while ceasing to identify them. Where an erased person appears as a **target**, `target_node_id` is already only an identifier and its subject is already unreadable.

This resolves a genuine collision between an immutable audit log and a statutory erasure right without weakening either.

### Not searchable

**AuditEntry is excluded from [[VPS-F002_Local-First_Search|VPS-F002]]'s index entirely.** Indexing it would let a Manager discover that a record exists by searching for its type, which is exactly the inference the interceptor prevents on the record itself.

### API contracts

```
auditLog.query(workspaceId, filters?: {
  startDate?, endDate?, actorUserId?, eventType?, targetNodeType?, targetTier?
}) -> AuditEntry[]
  // Owner and HR Admin only. No create, update or delete endpoint exists
  // for this node type anywhere in the product
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | AuditEntry carries the schema above and is the one node type exempt from the soft-delete fields in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Universal Node Conventions |
| G02 | Creation happens exclusively within [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor. No feature calls a create endpoint for this node type |
| G03 | No update or soft-delete operation against AuditEntry exists at the API layer, for any role. Rejected at write time, not merely omitted from the interface |
| G04 | Denials are logged at every tier. Successful-access logging covers Tier 1 and Tier 3 only |
| G05 | `actor_application` records which suite application issued the query, defaulting to `'VultoRoster'` |
| G06 | AuditEntry is exempt from erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]. An erased actor's identifier is pseudonymized to a stable opaque token; the entry itself persists |
| G07 | AuditEntry is never indexed by [[VPS-F002_Local-First_Search|VPS-F002]] |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F004-S01 | Query-layer logging integration | Security |
| VPS-F004-S02 | Immutability enforcement | Security |
| VPS-F004-S03 | Review surface | UI |
| VPS-F004-S04 | Actor pseudonymization on erasure | Security |

---

## Feature Acceptance Criteria

**GIVEN** a Manager attempts to query a FlightRiskSignal they have no access to
**WHEN** the interceptor denies it
**THEN** an AuditEntry exists with event type PermissionDenied, that Manager's identifier, and target tier Tier2

---

**GIVEN** an HR Admin successfully reads an employee's salary
**WHEN** the access completes
**THEN** an AuditEntry exists with event type SensitiveAccessGranted, target tier Tier1, and no salary figure anywhere in the entry

---

**GIVEN** an Owner reads a routine Tier 0 field such as a job title
**WHEN** the access completes
**THEN** no AuditEntry is created

---

**GIVEN** an Owner attempts to delete or modify an existing AuditEntry through any API path
**WHEN** the attempt is made
**THEN** it is rejected at the write layer regardless of role

---

**GIVEN** an approved erasure request under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] covering a former HR Admin
**WHEN** erasure executes
**THEN** their audit entries persist with `actor_user_id` replaced by a stable opaque token, their events remain correlatable with one another, and no entry is deleted

---

**GIVEN** a user searches for a term matching an audit entry's target node type
**WHEN** [[VPS-F002_Local-First_Search|VPS-F002]] returns results
**THEN** no audit entry appears, because the node type is never indexed

---

**GIVEN** an HR Admin filters by a specific user and date range
**WHEN** the query runs
**THEN** every matching denial and sensitive access for that user and range is returned

---

## Non-Functional Requirements

- Logging adds no more than 10ms to any interceptor decision. This feature must never become a bottleneck in the one mechanism every other feature depends on
- No code path anywhere updates or deletes an existing entry, verified as a structural property of the API surface rather than a policy
- Review functions from local cache for entries inside the retention window; older entries render as the aged-out state and fetch on demand
- The table remains responsive across a year of entries for a workspace of 150 people

---

## Security Considerations

- **This feature's access model deviates from [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s standard definition of Full, and the deviation is the entire point.** An audit log that its most privileged role can quietly edit provides no accountability for that role specifically — which is the case that matters most.
- **Logging is structural, not conventional.** A missed subscription rule for a notification is an inconvenience. A missed one for an audit event is a gap in exactly the record this feature exists to keep complete.
- **The log is itself sensitive.** It reveals which people hold which roles, which records exist, and who is interested in whom. It is Tier 2, Owner and HR Admin only, excluded from search, and reached from settings rather than navigation. Every one of those is a deliberate reduction in casual exposure.
- **Pseudonymization is not anonymization, and this is stated honestly.** A pseudonymized actor's events remain correlatable with one another by design, which is what makes the log still useful. Where a jurisdiction requires stronger treatment, that is a legal question for that workspace rather than an engineering default.

---

## Out of Scope

- **Real-time alerting on suspicious patterns.** This is a record, not a detection system. A future feature could read this log the way [[VRS-F059_Retention_Analytics|VRS-F059]] and [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] read other historical records
- **Export for external compliance tooling** — [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]], where export is governed consistently
- **Logging Tier 0 and Tier 2 successful reads** — volume without proportionate value
- **Retention shortening.** Entries are kept for the workspace's lifetime; there is no configuration to reduce it, because a configurable audit retention is a configurable way to lose the record

---

## Decisions Recorded

**This feature moves from Scale to MVP.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and [[VPS-A004_Graph_Permission_Layer|VPS-A004]] both reference it as an existing guarantee, and Tier 1 and Tier 3 data exists from the first payroll field. Building it thirty features later would mean either an unlogged quarter or a retrofit into an interceptor that thirty features already depend on.

**The retention and erasure collision is resolved.** The previous specification left retention as a legal question with indefinite retention as a default, which left [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s erasure right and this log's immutability in direct conflict. Actor pseudonymization satisfies both: the record survives, the person ceases to be identified.

**AuditEntry is excluded from search.** Not previously stated, and a real leak — indexing the log would let someone discover that a restricted record type exists by searching for it, which is the inference the interceptor prevents everywhere else.

**The exemption from Universal Node Conventions is stated explicitly.** The previous specification noted the absent fields were deliberate; [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] did not record the exemption, which would have surfaced as a schema-conformance failure in review.

---

## Related Notes

- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the interceptor that writes every entry
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the tier model this logging holds accountable
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — erasure, and the pseudonymization path
- [[VPS-F002_Local-First_Search|VPS-F002]] — search, from which this node type is excluded

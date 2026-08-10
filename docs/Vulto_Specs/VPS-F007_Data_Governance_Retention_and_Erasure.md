---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VPS-F007
---

# VPS-F007 — Data Governance, Retention and Erasure

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Standing Rule 1, which this feature resolves the exception to), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (**the cryptographic erasure mechanism, specified there and invoked here**), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the job queue, and object storage lifecycle), [[VPS-F004_Silent_Audit_Log|VPS-F004]] (the audit log, and its pseudonymization path), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (documents, whose blobs erasure destroys keys for), [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] (where retention schedules are configured)
**Blocks:** Nothing structurally. Several features depend on this one existing for their own retention to be lawful rather than indefinite.

This document is the single source of truth for this feature.

---

## The collision this feature resolves

[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1 states that nodes are never hard-deleted. Statutory erasure rights state that sometimes a person's data must be destroyed on request.

**Both cannot be true as literally written**, and the previous specification set contained no document that noticed. A graph that hard-deletes an Employee breaks every edge pointing at them — assignments, timesheets, payroll history, aggregate figures computed from all three. A graph that refuses to erase anything is a graph that cannot operate lawfully in the UK or the EU and increasingly not in Pakistan or the UAE either.

The resolution, specified in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and invoked here: **cryptographic erasure.** Destroy the key material rather than the rows. The ciphertext remains, permanently unreadable. The node, its edges and its graph position remain intact. Referential integrity is unbroken, aggregate history stays correct, and the audit trail records that erasure occurred.

---

## What It Is

Three related things: **retention schedules** stating how long each class of record is kept, a **scheduled purge** that acts on them, and an **erasure request** workflow for a person exercising a statutory right.

---

## Problem It Solves

A workspace accumulates personal data about people who no longer work there, applied unsuccessfully years ago, or were never anything but a name in a talent pool. Every one of those records carries a retention obligation that is a period rather than a permission, and almost no small firm tracks it.

The exposure runs both ways. **Keeping too long** is a breach in most of [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]]'s jurisdictions and a discovery liability everywhere. **Deleting too early** destroys records an employer is separately required to keep — payroll records for six years in the UK, employment records for defined periods in every jurisdiction — and those two obligations frequently apply to the same person.

That contradiction is why retention is per record class rather than per person.

---

## User-Facing Flows

### Configuring schedules

An Owner or HR Admin reviews the retention schedule per record class, each shipping with a defensible default and a stated basis. Changing one is deliberate and audited.

**The defaults are starting points, not legal advice**, and the interface says so once, plainly.

### The purge

A scheduled job identifies records past their retention period and acts: cryptographic erasure for Tier 1 and Tier 2 content, field-level redaction for Tier 0 personal data, and blob key destruction for documents.

**A purge never runs silently.** A monthly digest states what will be purged, and an HR Admin has fourteen days to place a hold. Something a firm did not intend to lose should not disappear because a default was left unexamined.

### A legal hold

Any record class or individual subject can be placed on hold, which suspends every purge and erasure affecting them. Where litigation or an investigation is live, retention obligations reverse entirely.

**A hold overrides an erasure request**, and this is stated to the requester plainly rather than the request quietly failing.

### An erasure request

A person exercising a statutory right — an employee, a former employee, a candidate — has their request recorded, reviewed and either fulfilled or refused with a stated ground.

Refusal is a legitimate outcome. Payroll records under a statutory retention obligation cannot be erased on request, and a product that pretended otherwise would mislead both parties.

### A subject access request

The other half of the same right: a person asking what is held about them. The feature assembles it — their profile, assignments, timesheets, leave, documents, review entries — as an export, reviewed by an HR Admin before release.

This is also the mechanism [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] routes a case subject's access rights through: a legally scoped request, reviewed and fulfilled by a person, rather than a permanent read grant on a live record.

### A full workspace export

An Owner can export everything the workspace holds, in a portable format. This is not a compliance feature; **it is what makes leaving Vulto possible**, and a product holding a firm's employment records for years owes it.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Retention | Content | Schedules per record class. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Purge queue | Content | What will be purged and when |
| Requests | Content + Panel | Erasure and access requests |
| Legal holds | Content | Active holds |

### Layout and components

**Retention** is a Table: record class, period, basis, records currently affected, next purge date. The basis column is prose — *UK payroll records: 6 years from end of tax year* — because a number with no stated reason is a number nobody dares change.

**Purge queue** is the surface that matters. A Table of what the next purge will act on: record class, count, subjects affected, purge date, and a **Hold** action per row.

Above it, a plain statement: *Next purge 14 March — 34 records across 3 classes.* An HR Admin who reads nothing else should still see the number.

**Requests** is a Table: type Badge, subject, received date, days remaining against the statutory response window, status. Sorted by days remaining ascending — a request approaching its deadline is the urgent one, and most jurisdictions set that window at thirty days.

The Panel holds the request detail, the assembled data preview for an access request, and the fulfill or refuse action. Refusal requires a stated ground from a fixed set.

**Legal holds** is a short Table: scope, reason, placed by, placed date. Active holds render `attention` in the purge queue against every row they suspend.

### Keyboard

Standard bindings. No shortcut for anything destructive.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner and HR Admin only. Structurally absent elsewhere |
| Held | Purge rows under a hold render `attention` with the hold named and no action available |
| Overdue | A request past its response window renders `danger` and escalates daily |
| Empty | *Nothing scheduled for purge.* |
| Error | Erasing a record under statutory retention is refused with the ground named |

### Responsive

Desktop only below 1024px, and it says so.

---

## Technical Architecture

### RetentionPolicy

Owner and HR Admin only, Tier 2.

```
policy_id:            UUID v4
workspace_id:         UUID
record_class:         enum — an open registry. Each application registers its
                      own classes. Roster's initial registration:
                      EmployeeRecord, PayrollRecord, TimesheetRecord,
                      LeaveRecord, CandidateRecord, TalentPoolRecord,
                      HRCaseRecord, WorkAuthorizationRecord, DocumentRecord,
                      AuditRecord, NotificationRecord.
                      Vulto Projects adds ClientRecord, ProjectRecord,
                      DeliverableRecord and ChangeOrderRecord
retention_months:     integer — from the trigger event, not from creation
trigger_event:        enum: EmploymentEnd, RecordCreation, CaseClosure,
                      ApplicationRejection, TaxYearEnd
legal_basis:          text — the stated reason, shown in the interface
is_purge_enabled:     boolean, default true — AuditRecord is permanently false
jurisdiction:         enum per VRS-F003, nullable — null applies workspace-wide

— Universal Node Conventions per VPS-A002 —
```

`trigger_event` matters more than the period. Payroll retention runs from the end of the tax year, not from when a payslip was generated, and an implementation counting from creation would purge records years early.

### ErasureRequest

```
request_id:           UUID v4
workspace_id:         UUID
request_type:         enum: Erasure, SubjectAccess, Portability
subject_employee_id:  UUID, nullable
subject_candidate_id: UUID, nullable — exactly one of the two set
received_at:          date
response_due_at:      date — computed from the jurisdiction's window
status:               enum: Received, UnderReview, Fulfilled, PartiallyFulfilled,
                      Refused, OnHold
refusal_ground:       enum: StatutoryRetention, LegalHold, ThirdPartyRights,
                      NotTheSubject, Other — nullable, required on refusal
refusal_detail:       text, nullable
fulfilled_at:         timestamp, nullable
fulfilled_by:         user_id, nullable
records_affected:     JSON summary — classes and counts, never content

— Universal Node Conventions per VPS-A002 —
```

**`records_affected` records counts, never content.** A request record that retained what it erased would defeat the erasure entirely — the same discipline [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s ImportBatch follows in never storing its payload.

### What erasure actually does, per tier

**Tier 1 and Tier 3** — cryptographic erasure per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. Every wrapped-key entry and the document key destroyed, no copy retained in any backup generation, a device wipe instruction fired. The node, its edges and its position remain.

**Tier 2** — the same mechanism where the content is encrypted; field-level redaction where it is not.

**Tier 0** — field-level redaction. Personal identifying fields are overwritten with a stable pseudonymous token; structural and operational fields remain, so that assignments, utilization history and aggregate figures stay correct.

**This is a weaker guarantee than cryptographic erasure and is stated as such.** Tier 0 keys are held by the application, so there is no key to destroy. Redaction removes the identification, not the record.

**Documents** — blob key destruction per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. The ciphertext remains in object storage until its own lifecycle expires it; it is unreadable from the moment the key is gone.

**AuditEntry** — exempt. Pseudonymized per [[VPS-F004_Silent_Audit_Log|VPS-F004]] where the erased person appears as an actor. Erasing the record of who accessed a salary protects nothing, since the salary was erased separately; it only destroys the evidence.

### What erasure cannot reach

Stated plainly rather than glossed:

**A device that decrypted a record before erasure may retain a local copy** until it next connects. A wipe instruction fires; a device that never reconnects cannot be reached. A property of distributed systems, not a defect in this design.

**Aggregate contributions are already anonymous.** `PulseAggregateContribution` and `WellnessAggregateContribution` carry no edge to any Employee, so there is nothing to erase and nothing that identifies anyone. Team sentiment history survives an erasure, correctly.

**Backups within their retention window** hold ciphertext whose keys are destroyed. Unreadable, and not separately purged.

### The purge job

Monthly per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], idempotent, running in two phases.

**Phase one, notification**: identify records past retention, write the digest, notify HR Admin. Nothing is destroyed.

**Phase two, execution**: fourteen days later, act on everything not placed on hold.

The gap is deliberate. A purge that runs the moment a period elapses will one day destroy something a firm needed, and the fourteen days cost nothing against an obligation measured in years.

### Legal holds

A hold suspends purge and erasure for a record class, a subject, or both. While active, `is_purge_enabled` is effectively false for everything in scope, and an erasure request affecting held records is refused on the `LegalHold` ground with the requester told.

### The workspace export

Every node the workspace holds, in JSON, with documents as files. Tier 1 and Tier 3 content decrypted client-side on an authorized device, since **a server-generated export could not read it.**

Necessarily slow and necessarily local. That is the correct trade for the alternative, which would be Vulto's servers being able to assemble a readable copy of a customer's entire employment record.

### API contracts

```
retentionPolicy.list(workspaceId)                  -> RetentionPolicy[]
retentionPolicy.update(policyId, retentionMonths, legalBasis) -> { success }

purge.preview(workspaceId) -> {
  purgeDate, items: { recordClass, count, subjectCount, isHeld }[]
}
purge.placeHold(recordClass?, subjectId?, reason)  -> { holdId }
purge.releaseHold(holdId)                          -> { success }
purge.execute(workspaceId)                         -> { purged, held, failed }
  // Runs on an authorized device where Tier 1 or Tier 3 keys are involved

erasureRequest.create(requestType, subjectId, receivedAt) -> {
  requestId, responseDueAt, affectedRecords, blockedBy
}
  // blockedBy names statutory retention or an active hold before review begins

erasureRequest.fulfill(requestId)   -> { erased: { recordClass, count }[] }
erasureRequest.refuse(requestId, ground, detail) -> { success }

subjectAccess.assemble(subjectId) -> { export }
  // Client-side. Reviewed by an HR Admin before release

workspace.export(workspaceId)     -> { archiveUrl }
  // Owner only. Client-side assembly on an authorized device
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | RetentionPolicy and ErasureRequest carry the schemas above |
| G02 | Erasure destroys key material per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and never deletes a node, an edge or a row. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1 holds |
| G03 | Retention counts from `trigger_event`, never from record creation |
| G04 | AuditEntry is exempt from erasure. An erased actor is pseudonymized per [[VPS-F004_Silent_Audit_Log|VPS-F004]] |
| G05 | Aggregate contribution nodes carry no identifying link and are not erased. Team-level history survives |
| G06 | The purge runs in two phases fourteen days apart, with a notification phase preceding execution |
| G07 | A legal hold suspends purge and erasure entirely for everything in scope, and overrides an erasure request with the requester informed |
| G08 | `records_affected` and every request record store counts and classes, never erased content |
| G09 | Tier 0 erasure is field-level redaction, a weaker guarantee than cryptographic erasure, and is described as such |
| G10 | Workspace export and subject access assembly run client-side. No server-side path assembles readable Tier 1 or Tier 3 content |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F007-S01 | Retention schedules | Data |
| VPS-F007-S02 | Two-phase purge | Logic |
| VPS-F007-S03 | Legal holds | Logic |
| VPS-F007-S04 | Erasure requests | Logic |
| VPS-F007-S05 | Subject access assembly | Logic |
| VPS-F007-S06 | Workspace export | Platform |

---

## Feature Acceptance Criteria

**GIVEN** an employee record passes its retention period
**WHEN** the purge's notification phase runs
**THEN** it appears in the digest with fourteen days before execution, and nothing has been destroyed

---

**GIVEN** an HR Admin places a hold on that record
**WHEN** the execution phase runs
**THEN** it is skipped, the hold is named against it, and it remains fully intact

---

**GIVEN** an erasure request for a former employee with payroll records under a six-year statutory obligation
**WHEN** the request is assessed
**THEN** the payroll records are named as blocked before review begins, and fulfillment is partial with the ground stated to the requester

---

**GIVEN** an erasure is fulfilled
**WHEN** it executes
**THEN** every wrapped key and document key for the subject's Tier 1, Tier 2 and Tier 3 records is destroyed with no backup copy retained, and every node, edge and graph position remains intact

---

**GIVEN** the same erasure
**WHEN** an aggregate figure computed from that person's historical data is viewed
**THEN** it is unchanged, because the contribution carried no identifying link

---

**GIVEN** the same erasure
**WHEN** [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s log is consulted
**THEN** their entries persist with the actor pseudonymized, and a record that erasure occurred exists

---

**GIVEN** a subject access request
**WHEN** it is assembled
**THEN** assembly runs on an authorized device, an HR Admin reviews before release, and no server-side path produced readable Tier 1 content

---

**GIVEN** an Owner exports the workspace
**WHEN** it completes
**THEN** the archive contains every node and document in a portable format, assembled client-side

---

**GIVEN** a request passes its statutory response window
**WHEN** the check runs
**THEN** it renders `danger` and escalates daily to Owner and HR Admin

---

## Non-Functional Requirements

- The purge preview resolves within 500ms
- Erasure of a single subject completes within 30 seconds on an authorized device
- Subject access assembly completes within 2 minutes for a long-tenured employee
- Workspace export completes within 30 minutes for a 150-person workspace with full history
- Every operation touching Tier 1 or Tier 3 runs on an authorized device

---

## Security Considerations

- **Cryptographic erasure is the mechanism that makes this feature possible without breaking the graph**, and its limits are stated rather than glossed: Tier 0 redaction is weaker, an unreachable device may retain a copy, and backups hold unreadable ciphertext.
- **Erasure is itself audited**, per [[VPS-F004_Silent_Audit_Log|VPS-F004]]. That a record was erased, when and by whom must survive the erasure, or the process cannot be demonstrated to have happened.
- **Refusal is a legitimate outcome and is designed for.** Statutory retention frequently defeats an erasure request, and a product that fulfilled every request regardless would put its customers in breach of a different obligation.
- **The two-phase purge exists because destruction is irreversible.** Every other operation in this product can be undone; this one cannot, and fourteen days of warning against an obligation measured in years is a trivial cost.
- **Retention defaults are starting points, not legal advice**, and the interface says so once, plainly. Seven jurisdictions with materially different requirements, and a product asserting the correct period would be wrong in most of them.
- **The workspace export is a security consideration in its own right.** It produces a decrypted archive of a firm's entire employment record, assembled on one device by one Owner. It is audited, Owner-only, and deliberately slow.

---

## Out of Scope

- **Determining the correct retention period for any jurisdiction** — defaults are provided with a stated basis and are the customer's to verify
- **Automatic legal-hold detection from litigation** — a hold is placed by a person
- **Erasure of a record class an application has not registered.** This feature erases the whole graph, and every application registers its own retention classes here. A class that exists in the graph and not in this registry is a specification defect, not a scope boundary
- **Anonymization as an alternative to erasure**, converting a person's records into an unidentified but complete history. Attractive, and it fails: a sufficiently detailed employment history re-identifies its subject regardless of whether their name is on it
- **Certificate of destruction generation** — the audit record is the evidence

---

## Decisions Recorded

**This feature is new and resolves the collision between [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1 and statutory erasure rights**, which no previous document acknowledged. Cryptographic erasure satisfies both: no row is deleted, and the content becomes permanently unreadable.

**The purge is two-phase with a fourteen-day notification.** Destruction is the one irreversible operation in this product, and a purge running the instant a period elapses will eventually destroy something a firm needed.

**Retention counts from a trigger event, not from record creation.** Payroll retention runs from the end of the tax year; counting from creation purges records years early, and it is the single most likely implementation error here.

**Refusal grounds are a fixed enum.** An erasure request refused with free text is a refusal nobody can audit, and the ground is precisely what a regulator asks about.

**Tier 0 redaction is described as weaker rather than presented as equivalent.** There is no key to destroy, and claiming otherwise would be a false assurance about the one thing this feature exists to guarantee.

**The workspace export is included** despite being a departure mechanism rather than a compliance one. A product holding a firm's employment records for years owes them a way to leave with them, and building it late is how it never gets built.

---

## Related Notes

- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the cryptographic erasure mechanism this feature invokes
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — Standing Rule 1, and the exception resolved here
- [[VPS-F004_Silent_Audit_Log|VPS-F004]] — the audit log, exempt and pseudonymized
- [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] — whose subject access rights route through this feature

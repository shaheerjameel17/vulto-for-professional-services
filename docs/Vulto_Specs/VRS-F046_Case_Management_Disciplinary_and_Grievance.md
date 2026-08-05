---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F046
---

# VRS-F046 — Case Management: Disciplinary and Grievance

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — procedural deadlines are always expressed in them), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (where case documents are filed), [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] (the policy version a case may concern), [[VPS-F004_Silent_Audit_Log|VPS-F004]] (every access audited), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (HRCase and CaseEvent, both split Tier 2 / Tier 1), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 1 encryption)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Scope, stated first because it is the point

**This feature is deliberately narrow.** It records that a formal process is happening, its meetings, its documents and its outcome.

It is **not** a general HR ticketing system, not a workflow engine, and not a place for informal concerns, performance conversations, or anything short of a formal disciplinary or grievance procedure. A firm that files everything here has made a mistake this feature should not accommodate.

It is included because its absence forces the most legally sensitive records in the business into email — where they are unsearchable, unprotected, retained forever, and discoverable in exactly the dispute they were created by.

---

## What It Is

A structured, HR-restricted record of a formal disciplinary or grievance process: who it concerns, what stage it is at, what meetings occurred, what was decided, and what documents were produced.

---

## Problem It Solves

A grievance is raised. There are meetings, notes, a written outcome, and possibly an appeal. Every one of those exists as an email, a document in someone's drive, and a memory.

The consequences are specific.

**The record cannot be assembled when it is needed.** A tribunal claim eighteen months later requires the full sequence — what was alleged, when, what process was followed, who attended, what was decided and when the person was told. Reconstructing that from three inboxes is where firms lose cases they should win.

**The process itself drifts.** Formal procedures have timescales, and a grievance that sat for six weeks between the meeting and the outcome letter is a procedural failure regardless of whether the decision was right.

**The confidentiality is nominal.** An email thread about a disciplinary matter sits in the sent items of everyone copied, forever, searchable, and reachable by an IT administrator who has no business reading it.

---

## User-Facing Flows

### Opening a case

An HR Admin opens a case: the type — disciplinary or grievance — the employee it concerns, the date raised, a summary, and where relevant the policy version at issue per [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]].

**A grievance may be raised by an employee against another**, in which case the case concerns the subject and records the raiser. Both are HR-restricted, and neither sees the other's involvement recorded except as the process itself discloses.

### Recording events

Each meeting, submission, or decision is a CaseEvent: a type, a date, attendees, and a note.

The note is Tier 1. **It contains allegations about named people and is among the most consequential text this product will ever hold.**

### Stages and deadlines

A case moves through stages — Raised, UnderInvestigation, MeetingHeld, OutcomeIssued, AppealRaised, AppealHeard, Closed. Each stage may carry a target date in working days, and a stage overdue against its target surfaces to HR Admin.

**The stages are a fixed set and the deadlines are advisory.** This product does not encode any jurisdiction's statutory procedure, for the same reason [[VRS-F035_Background_Check_Integration|VRS-F035]] declines to template an adverse-action notice: procedures differ materially between the seven jurisdictions in [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]]'s enum, and a product that implied it knew the correct sequence would be wrong in most of them.

### Documents

Invitation letters, statements, outcome letters, appeal submissions. Filed through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] at Tier 1, inherited from the case.

### Closing

A case closes with an outcome from a fixed set, plus free-text detail. Closed cases remain fully readable — the record's entire value is that it survives.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Cases | Content + Panel | The list, HR only |
| Case detail | Content | One case, its timeline, its documents |
| Add event | Modal | A meeting or decision |

**There is no employee-facing surface.** A case does not appear on the employee's profile, in [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]]'s self-service portal, or anywhere the subject can reach — a decision explained under Security below.

### Layout and components

**Cases** is a Table: reference, type Badge, stage Badge, raised date, days at current stage, overdue indicator. Sorted by days at stage descending, because a case sitting at a stage is the thing this screen exists to catch.

The subject's name is present — this is an HR-only surface and pretending otherwise would be theater — but the summary is not. A list view of grievance summaries is a screen someone reads over a shoulder.

**Case detail** is a vertical timeline: each event as a Card with its type, date, attendees and note. Documents attach to the event that produced them.

Above the timeline, a header with the subject, type, stage and days open. Below it, the outcome once issued.

The timeline is the feature. A tribunal question is almost always *what happened and in what order*, and a chronological record answers it directly in a way a folder of documents does not.

**Add event** collects type, date, attendees through an employee picker, and the note. Attendees are structured rather than free text, so *who was present at the meeting* is answerable without reading the note.

### Keyboard

Standard bindings. No shortcuts for opening or closing a case.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Structurally absent for every role but Owner and HR Admin. Absent for the subject |
| Aged out | Cases outside [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 window render dashed with **Fetch** |
| Overdue | A stage past its target renders `attention` with the days stated |
| Empty | *No open cases.* Stated plainly |
| Error | Closing without an outcome is refused |

### Responsive

Desktop only below 1024px, and it says so. This is not a surface for a phone.

---

## Technical Architecture

### HRCase

Split: identifying half HR-restricted Tier 2, content half Tier 1.

```
case_id:              UUID v4
workspace_id:         UUID
case_reference:       string — a short human-readable reference, generated
case_type:            enum: Disciplinary, Grievance
subject_employee_id:  UUID, FK to Employee
raised_by_employee_id: UUID, nullable — for a grievance raised by a colleague
raised_at:            date
stage:                enum: Raised, UnderInvestigation, MeetingHeld,
                      OutcomeIssued, AppealRaised, AppealHeard, Closed
stage_entered_at:     timestamp
stage_target_working_days: integer, nullable
policy_id:            UUID, nullable — the specific policy version at issue
lifecycle_status:     enum: Open, Closed
closed_at:            timestamp, nullable
outcome:              enum: NoCaseToAnswer, InformalResolution, WrittenWarning,
                      FinalWrittenWarning, Dismissal, GrievanceUpheld,
                      GrievancePartiallyUpheld, GrievanceNotUpheld,
                      Withdrawn, Other — nullable, required at close

— Tier 1, end-to-end encrypted —
summary:              text — what the case is about
outcome_detail:       text, nullable — the reasoning

— Universal Node Conventions per VPS-A002 —
```

### CaseEvent

Split identically.

```
event_id:      UUID v4
workspace_id:  UUID
case_id:       UUID, FK to HRCase
event_type:    enum: Meeting, Submission, Investigation, OutcomeIssued,
               AppealSubmitted, Correspondence, Other
occurred_at:   date
attendee_employee_ids: UUID[] — structured, so who was present is answerable
                       without reading the note
document_id:   UUID, nullable

— Tier 1, end-to-end encrypted —
note:          text

— Universal Node Conventions per VPS-A002 —
```

### Why the content is Tier 1

[[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s tier model determines protection strength; the reader set derives from Privacy Class. This is the case that made that distinction necessary.

A case narrative contains allegations about named individuals. Server-readable storage — Tier 2 — would mean Vulto's own infrastructure holds, in plaintext, a customer's most sensitive employment records. Tier 1 makes them unreadable to Vulto by construction.

**The reader set is Owner and HR Admin only.** Not Finance Admin, despite Tier 1's historical association with financial data — which is precisely the conflation [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] was corrected to prevent.

### The subject's access

**The subject of a case cannot read the case record.**

This is uncomfortable and it is correct. The subject receives, through the process itself, the documents the procedure requires: the invitation letter, the allegations in writing, the outcome letter. Those are real documents, provided by real people, at the points a fair procedure requires them.

What they do not get is live access to the investigating officer's contemporaneous notes, or to a third party's grievance narrative naming them. Neither is something any procedure grants during a process, and a product that granted it would make honest note-taking impossible — which harms the subject more than it helps them, because the notes would simply move back to email.

**Where a jurisdiction grants a subject access rights**, that request is handled through [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s data subject access mechanism, deliberately: a legally scoped request, reviewed and fulfilled by a person, rather than a permanent read grant on a live record.

### Deadlines are advisory

`stage_target_working_days` counts through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Overdue surfaces to HR Admin and does nothing else.

The product does not know the correct timescale for a grievance in the UAE, and it does not pretend to.

### Exclusion from search

**HRCase and CaseEvent are never indexed by [[VPS-F002_Local-First_Search|VPS-F002]]**, the same exclusion [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s audit log carries. Indexing a case would let its existence be discovered by searching a subject's name, which defeats the restriction entirely.

### API contracts

```
hrCase.open(caseType, subjectEmployeeId, raisedAt, summary,
            raisedByEmployeeId?, policyId?) -> { caseId, caseReference }

hrCase.addEvent(caseId, eventType, occurredAt, note, attendeeEmployeeIds?,
                documentFile?) -> { eventId }

hrCase.advanceStage(caseId, newStage, targetWorkingDays?) -> { success }
hrCase.close(caseId, outcome, outcomeDetail) -> { success }

hrCase.list(workspaceId, status?) -> {
  caseId, caseReference, caseType, subjectEmployeeName, stage,
  daysAtStage, isOverdue
}[]
  // Owner and HR Admin only. Summary is not included in the list response

hrCase.getTimeline(caseId) -> { case, events }
  // Tier 1 content decrypted client-side on an authorized device
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | HRCase and CaseEvent carry the schemas above, split Tier 2 identifying and Tier 1 content |
| G02 | The Tier 1 reader set is Owner and HR Admin only, derived from Privacy Class per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], never from tier |
| G03 | `case_concerns` connects HRCase to its subject. `event_in` connects CaseEvent to its case |
| G04 | The subject of a case has no read access to the case record. Access rights, where a jurisdiction grants them, are exercised through [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] |
| G05 | Stage deadlines count working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] and are advisory. No stage transition is ever blocked by one |
| G06 | Stages and outcomes are fixed enums. This product encodes no jurisdiction's statutory procedure |
| G07 | Case documents inherit Tier 1 from the case per [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s provenance rule |
| G08 | HRCase and CaseEvent are never indexed by [[VPS-F002_Local-First_Search|VPS-F002]] |
| G09 | Attendees are structured identifiers, not free text within the note |
| G10 | Every access to a case is audited per [[VPS-F004_Silent_Audit_Log|VPS-F004]] as a Tier 1 access |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F046-S01 | HRCase and CaseEvent schemas | Data |
| VRS-F046-S02 | Case timeline | UI |
| VRS-F046-S03 | Stage tracking and advisory deadlines | Logic |
| VRS-F046-S04 | Document filing at inherited Tier 1 | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin opens a grievance case
**WHEN** it is saved
**THEN** the case exists at Raised with a generated reference, the summary encrypted at Tier 1

---

**GIVEN** a case exists
**WHEN** an Owner or HR Admin views it
**THEN** the timeline renders with content decrypted client-side, and an audit entry records the Tier 1 access

---

**GIVEN** a Finance Admin attempts to access a case
**WHEN** the attempt is made
**THEN** it is structurally absent, despite Tier 1's historical association with financial data

---

**GIVEN** the subject of a case attempts to reach it
**WHEN** they search, open their own profile, or use the self-service portal
**THEN** nothing indicates a case exists

---

**GIVEN** a case is inspected directly in server storage
**WHEN** the raw values are read
**THEN** the summary, outcome detail and every event note are unreadable ciphertext

---

**GIVEN** a stage carries a target of 10 working days and 14 have passed
**WHEN** the case list renders
**THEN** it renders `attention` with the days stated, and no transition has been blocked

---

**GIVEN** a case document is filed
**WHEN** filing completes
**THEN** it inherits Tier 1 from the case and is unreadable to Vulto's infrastructure

---

**GIVEN** a user searches for a subject employee's name
**WHEN** [[VPS-F002_Local-First_Search|VPS-F002]] returns results
**THEN** no case appears, because the node types are never indexed

---

**GIVEN** a case is closed with an outcome
**WHEN** it is viewed afterwards
**THEN** the full timeline, documents and outcome remain readable to Owner and HR Admin

---

## Non-Functional Requirements

- The case list resolves within 200ms from the local graph
- A case timeline decrypts and renders within 500ms on an authorized device
- Full functionality offline on an authorized device. Tier 1 content is unavailable on any other, by construction
- Cases outside the Tier 1 retention window fetch on demand per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]

---

## Security Considerations

- **This is the most sensitive feature in the product**, and its design reflects that at every level: Tier 1 encryption, an Owner-and-HR-Admin reader set, exclusion from search, exclusion from the subject's own view, and full audit of every access.
- **The Finance Admin exclusion is the specific case that corrected [[VPS-A003_Unified_Sync_Architecture|VPS-A003]].** Tier 1 originally implied a fixed reader set including Finance Admin, which was accurate while Tier 1 held only financial data. Placing case narratives at Tier 1 would have distributed grievance records to the finance team, and the tier model was corrected so that reader sets derive from Privacy Class instead.
- **The subject's exclusion is deliberate and is the hardest decision in this document.** A live read grant on an investigating officer's contemporaneous notes would move honest note-taking back to email, which harms the subject more than the restriction does. Statutory access rights are exercised through [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]], reviewed and fulfilled by a person.
- **Every access is audited as a Tier 1 access.** *Who read this case, and when* is a question that arises in exactly the disputes these records exist for.
- **Retention is governed by [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]** and is genuinely contested — several jurisdictions require case records be kept for a defined period after closure and others require they be destroyed. This feature stores; that feature schedules.

---

## Out of Scope

- **A general HR ticketing or request system** — permanently. This feature is formal cases only
- **Encoding any jurisdiction's statutory procedure**, its required timescales or its mandatory steps. Stages are a neutral fixed set; deadlines are advisory
- **Letter generation.** Invitation and outcome letters are drafted by a person and filed here. [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s Smart Blocks are for employment contracts, and templating a dismissal letter would be the same overreach [[VRS-F035_Background_Check_Integration|VRS-F035]] declines for adverse-action notices
- **Anonymous reporting or a whistleblowing channel.** A genuinely different product with genuinely different requirements — anonymity guarantees this architecture does not provide
- **Automatic escalation or outcome recommendation.** Every decision here is a human one
- **Notifying the subject that a case has been opened.** That notification is part of a formal procedure and is delivered by a person following that procedure, not by software

---

## Decisions Recorded

**This feature is new**, and it is included despite the obvious argument for leaving it out — that a firm can manage formal processes outside the product — because that argument concludes with the most legally sensitive records in the business sitting in email, retained forever, and discoverable in the dispute they were created by.

**The scope is deliberately narrow and stated first.** A firm that files informal concerns here has made a mistake, and the feature is built so that mistake is uncomfortable rather than convenient.

**Case content is Tier 1, and this is what corrected [[VPS-A003_Unified_Sync_Architecture|VPS-A003]].** The tier model previously implied a reader set including Finance Admin; the correction — that reader sets derive from Privacy Class — was made necessary by this feature specifically.

**The subject cannot read the case.** The hardest call in this document. A live read grant would move note-taking back to email; statutory access rights run through [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] as a reviewed request.

**No jurisdiction's procedure is encoded.** Seven jurisdictions with materially different requirements, and a product implying it knew the correct sequence would be wrong in most of them.

**Attendees are structured identifiers.** *Who was present* is a question a tribunal asks directly, and answering it should not require reading an encrypted note.

**Excluded from search**, matching [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s treatment. Indexing would let a case's existence be discovered by searching a subject's name.

---

## Related Notes

- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the tier model this feature corrected
- [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] — the policy version a case may concern
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where case documents are filed at inherited Tier 1
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — retention, and the subject access mechanism

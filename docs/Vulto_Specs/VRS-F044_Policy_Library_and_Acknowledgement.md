---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F044
---

# VRS-F044 — Policy Library and Acknowledgment

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity and jurisdiction, for scoping), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days, for acknowledgment deadlines), [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] (onboarding, which surfaces policies at hire), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where an outstanding acknowledgment surfaces), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Policy and PolicyAcknowledgment)
**Blocks:** Nothing structurally. [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] references a specific policy version when a case concerns one.

This document is the single source of truth for this feature.

---

## What It Is

Versioned policy documents — a handbook, a code of conduct, an expenses policy, an information security policy — with a per-employee record of who acknowledged **which version**, and when.

---

## Problem It Solves

Unglamorous, and the first thing asked for in any employment dispute, client security review or insurance renewal.

The question is never *do you have a policy*. Every agency has a handbook somewhere. The question is **which version was in force when the incident occurred, and can you show the person had read it**, and almost no small firm can answer either.

The typical arrangement is a document in a shared drive, edited in place, with a distribution email from eighteen months ago naming half the current team. There is no version history, so nobody knows what the policy said in March. There is no acknowledgment record, so nobody knows who read it. And an employee who joined in April has never been shown it at all.

**Versioning and acknowledgment are the entire feature.** A policy library without them is a folder.

---

## User-Facing Flows

### Publishing a policy

An HR Admin writes or uploads a policy, scoped optionally to an entity, and publishes it. Publishing creates version 1.

### Requiring acknowledgment

A published policy may require acknowledgment, with a deadline in working days from publication.

Every employee in scope receives it in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox. New hires receive it through [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]]'s onboarding rather than as a separate notification, since a new joiner receiving eleven acknowledgment requests on their first morning will acknowledge all of them without reading any.

### Acknowledging

The employee reads the policy and acknowledges it in one action. **The acknowledgment records the specific version**, not the policy generally.

### Revising

An edit creates a new version. The prior version is retained in full, with its own acknowledgment record intact.

**A revision requiring re-acknowledgment is an explicit choice at publication**, not automatic. A typo correction should not invalidate two hundred acknowledgments; a substantive change to a code of conduct should. Only a person can tell those apart, and the choice is recorded so it can be defended.

### Reviewing compliance

An HR Admin sees, per policy version, who has acknowledged and who has not, with outstanding acknowledgments past their deadline surfaced.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Policies | Content + Panel | The library |
| Policy detail | Content | One policy, its versions, its compliance |
| My policies | Section in [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] | The employee's own |
| Acknowledge | Content, reading width | Read and acknowledge |

### Layout and components

**Policies** is a Table: title, category Badge, current version, scope, requires acknowledgment, acknowledged fraction, last revised. The fraction is the column that matters — *184 / 190* is the compliance position at a glance.

**Policy detail** has the current version's content at reading width, with a version history Section beneath: version, published date, published by, whether re-acknowledgment was required, and the acknowledgment count for that version specifically.

A compliance Section lists outstanding employees, sorted by days overdue.

**The acknowledge screen** is deliberately plain: the policy title, the version, the content at reading width, and a single `primary` action at the foot reading **I have read and acknowledge this policy.**

**The action is disabled until the reader has scrolled to the end.** This is the one place in the product where an artificial gate is warranted: an acknowledgment is a legal assertion that someone read something, and a button available at the top makes that assertion false by design. It is not a delay timer and not a quiz — simply that the document must have been paged through.

### Keyboard

`Space` pages down. `Cmd+Enter` acknowledges once enabled.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Every employee reads policies in their scope. Only Owner and HR Admin publish, per the workspace-configuration pattern |
| Outstanding | Past the deadline renders `attention` and notifies weekly, not daily |
| Superseded | A prior version renders read-only with a banner naming the current one and linking to it |
| Empty | *No policies published.* with **Create policy** |
| Error | Publishing without content is refused |

### Responsive

Reading and acknowledging work unchanged to 375px. Policy authoring is desktop-only below 1024px.

---

## Technical Architecture

### Policy

Standard, Tier 0.

```
policy_id:                 UUID v4
workspace_id:              UUID
title:                     string, required
category:                  enum: Handbook, CodeOfConduct, InformationSecurity,
                           Expenses, HealthAndSafety, DataProtection, Other
content:                   rich_text
version:                   integer, starts at 1
supersedes_id:             UUID, nullable — the version this replaces
entity_id:                 UUID, nullable — null applies workspace-wide
requires_acknowledgment:  boolean, default false
acknowledgment_deadline_working_days: integer, nullable
required_reacknowledgment: boolean — recorded per version, whether this
                           revision required re-acknowledgment
revision_note:             text, nullable — what changed and why
published_at:              timestamp, nullable
published_by:              user_id, nullable
lifecycle_status:          enum: Draft, Published, Superseded, Retired

— Universal Node Conventions per VPS-A002 —
```

### PolicyAcknowledgment

```
acknowledgment_id: UUID v4
workspace_id:       UUID
employee_id:        UUID, FK to Employee
policy_id:          UUID — points at the SPECIFIC VERSION, never the policy
                    generally. This is the entire point of the record
acknowledged_at:    timestamp
acknowledged_from_ip: string, nullable

— Universal Node Conventions per VPS-A002 —
```

`acknowledged_from_ip` is collected for the same reason [[VRS-F021_E-Signature_Native|VRS-F021]] collects it on a signature: an acknowledgment is an assertion that gets questioned, and *when and from where* are the facts that get asked about.

### Versioning

An edit to a published policy creates a new node linked by `supersedes_id` — the same content-versioning pattern as [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s rate cards, [[VRS-F018_Leave_Policy_Engine|VRS-F018]]'s leave policies and [[VRS-F032_Offer_Management|VRS-F032]]'s offers.

**The prior version is never edited and never deleted.** *What did the policy say in March* must be answerable years later, and an in-place edit makes it permanently unanswerable.

### Scope

`entity_id` null applies workspace-wide. Set, it applies only to employees scoped to that entity per [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — which is what allows a UK-specific data protection policy and a Pakistan-specific one to coexist without either reaching the wrong people.

### Deadlines

`acknowledgment_deadline_working_days` counts from publication per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and from an employee's start date for someone who joins after publication.

### Onboarding integration

At hire, every policy in scope requiring acknowledgment is added to the employee's onboarding plan as tasks per [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]], rather than arriving as separate notifications.

This matters more than it appears. A new joiner receiving eleven acknowledgment requests on their first morning acknowledges all eleven in ninety seconds, and the record is worthless. Distributed through onboarding they arrive spaced, in context, and stand a chance of being read.

### API contracts

```
policy.create(title, category, content, entityId?, requiresAcknowledgment?,
              deadlineWorkingDays?)        -> { policyId }
policy.publish(policyId)                   -> { policyId, notifiedCount }
policy.revise(policyId, content, revisionNote, requireReacknowledgment)
  -> { newPolicyId, reacknowledgmentRequired }
  // Creates a superseding version. Never edits in place
policy.retire(policyId, reason)            -> { success }

policy.acknowledge(policyId)               -> { acknowledgmentId }
  // Records the specific version and the originating address

policy.listForEmployee(employeeId) -> {
  policyId, title, version, requiresAcknowledgment,
  acknowledgedAt?, deadline?, isOverdue
}[]

policy.complianceReport(policyId) -> {
  version, acknowledged: { employeeId, at }[],
  outstanding: { employeeId, daysOverdue }[]
}

policy.versionHistory(policyId) -> {
  version, publishedAt, publishedBy, revisionNote,
  requiredReacknowledgment, acknowledgmentCount
}[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Policy and PolicyAcknowledgment carry the schemas above |
| G02 | An acknowledgment points at a specific policy version, never at a policy generally |
| G03 | A revision creates a new node through `supersedes`. The prior version is never edited or deleted |
| G04 | Whether a revision requires re-acknowledgment is an explicit choice at publication, recorded per version, never inferred from the size of the change |
| G05 | `entity_id` null applies workspace-wide. Set, it applies only to employees scoped to that entity |
| G06 | Deadlines count working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], from publication or from an employee's start date, whichever is later |
| G07 | Policies requiring acknowledgment are delivered to new hires through [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]]'s onboarding plan, not as separate notifications |
| G08 | The acknowledgment action is unavailable until the reader has paged to the end of the content |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F044-S01 | Policy schema and versioning | Data |
| VRS-F044-S02 | Publication and scoping | Logic |
| VRS-F044-S03 | Acknowledgment capture | Logic |
| VRS-F044-S04 | Compliance reporting | UI |
| VRS-F044-S05 | Onboarding integration | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a policy requiring acknowledgment is published workspace-wide
**WHEN** publication completes
**THEN** every active employee receives it in their Inbox with a deadline counted in working days

---

**GIVEN** an employee opens the acknowledge screen
**WHEN** the content has not been paged to the end
**THEN** the acknowledgment action is unavailable

---

**GIVEN** they acknowledge
**WHEN** it is recorded
**THEN** the record names the specific version, the timestamp and the originating address

---

**GIVEN** the policy is revised with re-acknowledgment required
**WHEN** the new version publishes
**THEN** a new node exists linked by `supersedes`, prior acknowledgments remain attached to the prior version intact, and every employee is asked again

---

**GIVEN** the policy is revised without re-acknowledgment required
**WHEN** the new version publishes
**THEN** prior acknowledgments remain valid, nobody is asked again, and the version history records that the choice was made

---

**GIVEN** a dispute concerning conduct in March
**WHEN** the version history is consulted
**THEN** the version in force in March is retrievable in full, with its acknowledgment record

---

**GIVEN** a policy scoped to the UK entity
**WHEN** a Pakistan-scoped employee views their policies
**THEN** it does not appear

---

**GIVEN** a new hire joins after publication
**WHEN** their onboarding plan is created
**THEN** every in-scope policy requiring acknowledgment appears as onboarding tasks, spaced across the plan, rather than as eleven simultaneous notifications

---

## Non-Functional Requirements

- The policy list and an individual policy resolve within 200ms from the local graph
- Publication to 150 employees completes within 10 seconds
- Reading and acknowledging function offline; the acknowledgment syncs on reconnection with its original timestamp preserved

---

## Security Considerations

- **Policies are Tier 0 and readable by every employee in scope.** A policy an employee cannot read is a policy they cannot be held to.
- **The acknowledgment record is the legally operative artifact**, and its integrity is what the feature exists for. It names a version, a timestamp and an address. It is never edited, never backdated, and an acknowledgment made offline preserves its original timestamp rather than taking the sync time.
- **The scroll gate is a deliberate friction and the only one in the product.** An acknowledgment is an assertion that someone read something; a button available at the top of an unread document makes that assertion false by construction. It is not a delay timer and not a comprehension test — the document must simply have been paged through.
- **Publishing is audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]], including whether re-acknowledgment was required. That choice is exactly what gets scrutinized when a policy change is later disputed.

---

## Out of Scope

- **Policy authoring assistance or templates.** A handbook's content is the firm's own and varies by jurisdiction. This feature stores and versions it
- **Comprehension testing or quizzes** — acknowledgment is a record of reading, not of understanding, and pretending otherwise would overstate what the record proves
- **Automatic policy generation per jurisdiction** — the same reasoning [[VRS-F020_Universal_Contract_Builder|VRS-F020]] applies to keeping clause text legally current
- **Client-facing policy sharing** — [[Vulto Comms]]' portal territory
- **Enforcement.** This feature records who acknowledged what. Acting on non-compliance is [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]]'s territory where it becomes formal

---

## Decisions Recorded

**This feature is new**, and its absence meant the most commonly requested compliance artifact in a small firm had no home.

**An acknowledgment names a version, not a policy.** This is the design. An acknowledgment of *the handbook* is worthless in a dispute about what the handbook said in March.

**Re-acknowledgment on revision is an explicit choice.** Automatic re-acknowledgment on every edit trains people to click through; never requiring it makes a substantive change invisible. Only a person can distinguish a typo from a material amendment, and recording that they made the call is what makes it defensible.

**The scroll gate is deliberate**, and it is the only artificial friction in this product. Every other feature here is built to remove steps. This one adds one, because the record's entire value rests on the assertion being true.

**New hires receive policies through onboarding, not as notifications.** Eleven acknowledgment requests on a first morning produces eleven acknowledgments in ninety seconds and a record worth nothing.

---

## Related Notes

- [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] — the onboarding plan policies are delivered through
- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the entity scoping applies to
- [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] — where a policy breach becomes a formal case
- [[VPS-F004_Silent_Audit_Log|VPS-F004]] — where publication decisions are recorded

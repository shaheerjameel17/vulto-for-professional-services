---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F032
---

# VRS-F032 — Offer Management

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] (the requisition whose compensation range constrains an offer), [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (Candidate, and the hire conversion an acceptance triggers), [[VRS-F030_Candidate_Portal|VRS-F030]] (where a candidate sees their offer), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity — an offer is made by a legal entity), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Offer and the generalized ApprovalStage), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (client-side rendering for the Tier 1 summary)
**Blocks:** Nothing structurally. [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] reads accepted offers when establishing bands.

This document is the single source of truth for this feature.

---

## What It Is

The stage the previous specification set skipped entirely: **the offer itself.** Its terms, its approval, its versions, its expiry, and its acceptance.

An Offer is a structured record with a Tier 1 compensation figure, routed for approval against the requisition that authorized the role, presented to the candidate through [[VRS-F030_Candidate_Portal|VRS-F030]], and on acceptance triggering the hire conversion.

---

## Problem It Solves

The previous set held offer terms as three free-text fields on a Tier 0 Candidate node: a role title, a compensation string and a start date. That is wrong in three ways that each cost something real.

**It is a compensation figure at Tier 0.** A number that will become the person's salary sat at the same protection level as their phone number, readable by anyone with pipeline visibility.

**There was no approval.** Anyone who could edit a candidate could record any figure. In a firm where a founder wants sight of every offer — which is most firms below a hundred people — the control existed only as a convention.

**There was no version history.** Offers get negotiated. A candidate countering at a higher figure produced an overwritten field, and the question *what did we originally offer* had no answer.

---

## User-Facing Flows

### Drafting an offer

An HR Admin or the hiring manager drafts an offer for a candidate at Offer stage: role title, entity, employment type, start date, compensation and currency, and any non-standard terms.

**Where the role came from an approved requisition, the compensation range appears as a constraint**, and a figure outside it is permitted but requires a stated reason — the same disclosure-rather-than-block pattern [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] uses for over-plan requisitions.

### Approval

The offer routes through an ApprovalStage chain, the same mechanism serving payroll, compensation change and requisitions. The approver sees the figure, the requisition's range, and where the offer sits within or beyond it.

An approver without Tier 1 access does not receive the item, per [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]'s rule: an approval decision someone cannot evaluate is not an approval.

### Presenting

An approved offer becomes visible on the candidate's [[VRS-F030_Candidate_Portal|VRS-F030]] portal, with its terms and its expiry date. They also receive an email carrying the link and no terms, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]].

Optionally, a **summary document** can be generated — a one-page statement of the terms, rendered client-side because it contains a Tier 1 figure. It is explicitly not a contract and is labeled as a summary, for firms and jurisdictions where a candidate expects something on paper.

### Negotiation

A countered offer produces a **new version**, linked to its predecessor. The prior version is retained with its own terms, approval record and outcome. *What did we originally offer, what did they counter, and what did we settle on* is answerable at any point afterwards.

Each version requires its own approval. A negotiation that drifts fifteen percent above the first approved figure should be approved again, not inherited.

### Acceptance and decline

The candidate accepts or declines through the portal. Acceptance is recorded with a timestamp and originating address — the same evidence [[VRS-F021_E-Signature_Native|VRS-F021]] collects for a signature.

**Acceptance triggers [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s hire conversion**, creating the Employee, and the compensation figure carries into the Employee's Tier 1 fields directly rather than being re-typed.

From there [[VRS-F020_Universal_Contract_Builder|VRS-F020]] generates the contract exactly as for any other employee.

### Expiry

An offer carries an expiry date. Passing it sets the status to Expired, notifies the hiring manager, and shows the candidate a plain statement to contact the agency — not a broken page and not a silent lapse.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Offer editor | Panel, from the candidate record | Draft and version |
| Offer approval | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox | Decision in place |
| Offer history | Section on the candidate record | Every version and outcome |
| Candidate view | Within [[VRS-F030_Candidate_Portal|VRS-F030]] | Terms, accept, decline |

### Layout and components

**The offer editor** is a form with the requisition's range rendered as a live constraint beneath the compensation field: a horizontal bar with the range marked and the entered figure positioned on it. Within range renders `success`; outside renders `attention` and reveals a required reason field.

A figure is more legible as a position on a range than as two numbers to compare, and this is the moment where the comparison matters most.

**Version history** is a compact list at the foot of the editor: version, figure, status, date, and who approved. The current version is expanded; prior ones collapse to one line each.

**The candidate view** in [[VRS-F030_Candidate_Portal|VRS-F030]] shows the terms in a `raised` Card at reading width — role, entity, start date, compensation, expiry — with two actions: **Accept offer** as `primary` and **Decline** as `secondary`.

Accept opens a confirmation stating plainly what happens next, because a candidate should not discover that clicking a button started their employment record. Decline asks an optional reason, which is genuinely useful and must be optional — a declining candidate owes the agency nothing.

**Where an offer has expired**, both actions are replaced by a single line directing them to contact the agency, with the workspace's name.

### Keyboard

Standard form and Inbox bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Editor works from local state |
| Restricted | Terms are structurally absent without Tier 1 access. The offer's existence and status remain visible |
| Empty | *No offer drafted.* with **Draft offer**, available only at Offer stage |
| Expired | Actions replaced by a contact statement on the candidate surface |
| Error | An offer drafted for a candidate not at Offer stage is refused, naming the stage requirement |

### Responsive

The candidate view is mobile-first at 375px. Accepting a job offer on a phone is entirely normal.

---

## Technical Architecture

### The Offer schema

Split, per the pattern established for Contract and Requisition.

```
offer_id:            UUID v4
workspace_id:        UUID
candidate_id:        UUID, FK to Candidate
open_role_id:        UUID, FK to OpenRole
requisition_id:      UUID, nullable — the constraint source
entity_id:           UUID, FK to Entity
version:             integer, starts at 1
supersedes_id:       UUID, nullable — the version this replaces
role_title:          string, required
employment_type:     enum per VRS-F002
start_date:          date, required
expires_at:          date, required
status:              enum: Draft, PendingApproval, Approved, Presented,
                     Accepted, Declined, Expired, Withdrawn
declined_reason:     text, nullable
accepted_at:         timestamp, nullable
accepted_from_ip:    string, nullable
summary_document_id: UUID, nullable, FK to Document

— Tier 1, Finance-restricted —
compensation_amount:      decimal
compensation_currency:    ISO 4217 — defaults from the Entity
compensation_frequency:   enum: Annual, Monthly, Hourly
out_of_range_reason:      text, nullable, required where outside the
                          requisition's range
additional_terms:         rich_text, nullable

— Universal Node Conventions per VPS-A002 —
```

### Versioning

A countered offer creates a **new Offer node** linked by `supersedes_id`, never an edit. The same content-versioning pattern [[VRS-F006_Rate_Card_Engine|VRS-F006]] uses for rate cards and [[VRS-F018_Leave_Policy_Engine|VRS-F018]] for leave policies.

Only one version may be in a live state — PendingApproval, Approved or Presented — at a time. Creating a new version withdraws the current one.

Each version requires its own approval.

### The requisition constraint

Where `requisition_id` is set, `compensation_amount` is compared against that requisition's Tier 1 range. Outside it, `out_of_range_reason` is required and surfaces to the approver.

**Not blocking.** A candidate worth more than the range was worth writing down in March is a real situation, and blocking produces an offer made by email instead.

### Acceptance

Sets status Accepted, records the timestamp and address, and calls [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s `candidate.hire`.

The compensation figure **carries directly into the Employee's Tier 1 fields**, both being Tier 1 and the transfer happening on an authorized device. This is the one place a compensation figure moves between node types without re-entry, and it is correct here precisely because the offer was approved.

### The summary document

Optional, generated client-side per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] because it contains a Tier 1 figure, filed through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] at inherited Tier 1, and attached to the candidate's portal view.

**It is not a contract and is labeled a summary.** [[VRS-F020_Universal_Contract_Builder|VRS-F020]] generates the contract after conversion. Generating a signable offer letter here would create a second document system whose terms must then be reconciled with the contract that follows — which is the reconciliation problem this product exists to remove.

### API contracts

```
offer.draft(candidateId, openRoleId, entityId, terms) -> {
  offerId, withinRequisitionRange
}
offer.submitForApproval(offerId, outOfRangeReason?) -> { success }
offer.approve(offerId)                    -> { success }
offer.decline(offerId, reason)            -> { success }   // internal decline
offer.present(offerId)                    -> { candidateUrl }
offer.createVersion(offerId, terms)       -> { newOfferId }
  // Withdraws the current live version
offer.withdraw(offerId, reason)           -> { success }
offer.generateSummary(offerId)            -> { documentId }
  // Client-side render, filed at Tier 1

candidatePortal.getOffer(token)           -> { terms, expiresAt } | null
candidatePortal.acceptOffer(token)        -> { accepted: true }
  // Triggers candidate.hire
candidatePortal.declineOffer(token, reason?) -> { declined: true }

offer.history(candidateId)                -> Offer[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Offer carries the schema above, split Tier 2 identifying and Tier 1 terms |
| G02 | A countered offer creates a new node linked by `supersedes_id`. Terms are never edited in place |
| G03 | At most one version may be in a live state at a time. Creating a version withdraws the current one |
| G04 | Every version requires its own approval. Approval is never inherited from a prior version |
| G05 | An offer outside its requisition's range requires a stated reason. It is never blocked |
| G06 | Offer uses the generalized ApprovalStage, not a bespoke mechanism |
| G07 | Acceptance triggers [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s hire conversion and carries the compensation figure into the Employee's Tier 1 fields on an authorized device |
| G08 | An offer may only be drafted for a candidate at Offer stage |
| G09 | The summary document is client-side rendered, filed at inherited Tier 1, and is never a contract |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F032-S01 | Offer schema and versioning | Data |
| VRS-F032-S02 | Approval routing and range constraint | Logic |
| VRS-F032-S03 | Candidate presentation and acceptance | UI |
| VRS-F032-S04 | Summary document generation | Logic |
| VRS-F032-S05 | Expiry handling | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an offer is drafted within its requisition's range
**WHEN** the compensation is entered
**THEN** the range indicator renders `success` and no reason is required

---

**GIVEN** an offer 12% above the requisition's maximum
**WHEN** it is submitted for approval
**THEN** a reason is required, the excess and reason both surface to the approver, and submission is not blocked

---

**GIVEN** a candidate counters and a new version is created
**WHEN** the version is saved
**THEN** a new Offer exists linked by `supersedes_id`, the prior version is withdrawn with its terms and approval record intact, and the new version requires its own approval

---

**GIVEN** an approver without Tier 1 access
**WHEN** approval routes
**THEN** the offer does not route to them

---

**GIVEN** a Manager with pipeline visibility but no Tier 1 access views an offer
**WHEN** it renders
**THEN** its existence, status and expiry are visible and the compensation figure is structurally absent

---

**GIVEN** a candidate accepts through the portal
**WHEN** acceptance completes
**THEN** the timestamp and address are recorded, [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s hire conversion runs, an Employee exists, and the compensation figure is present in their Tier 1 fields without re-entry

---

**GIVEN** an offer passes its expiry
**WHEN** the candidate opens the portal
**THEN** the actions are replaced by a statement directing them to the agency, and the hiring manager is notified

---

**GIVEN** a summary document is generated
**WHEN** it is inspected in object storage
**THEN** it is unreadable ciphertext at Tier 1, and it is labeled a summary rather than a contract

---

## Non-Functional Requirements

- The offer editor and range indicator update within 200ms
- The candidate view renders within 1 second on a mobile connection
- Summary generation completes within 10 seconds on an authorized device
- Acceptance and the resulting hire conversion complete within 5 seconds

---

## Security Considerations

- **The compensation figure is Tier 1 from the moment it is drafted**, closing the previous set's largest recruitment leak: a future salary held as free text on a Tier 0 node.
- **Approval routing respects tier**, per [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]. Routing to someone who cannot see the figure produces a rubber stamp or a side-channel request.
- **A candidate sees their own terms**, which is a Tier 1 figure reaching an unauthenticated surface. This is correct — it is their own compensation and the entire purpose of presenting an offer — but it means the portal response is the one place Tier 1 content leaves the authorized boundary, and the token scoping in [[VRS-F030_Candidate_Portal|VRS-F030]] is what constrains it.
- **Acceptance evidence is collected like a signature.** An accepted offer is the basis of an employment relationship, and *when* and *from where* are the facts that get asked about if the acceptance is later disputed.
- **A declined offer's reason is optional.** A candidate declining owes the agency nothing, and a required field produces either a false answer or an abandoned decline.

---

## Out of Scope

- **A signable offer letter.** The summary is a statement of terms, not a contract. [[VRS-F020_Universal_Contract_Builder|VRS-F020]] generates the contract after conversion, and a second signable document would need reconciling with it
- **Multi-candidate offers for one role** — an open role holds one live offer at a time. A firm offering to two people simultaneously for one seat has a problem this product should not smooth over
- **Negotiation messaging through the portal** — [[VRS-F030_Candidate_Portal|VRS-F030]] is read-only in that direction. A negotiation is a conversation
- **Automatic offer generation from a panel recommendation** — [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] informs a person, who decides
- **Competing-offer tracking.** A tempting field, and one that records a candidate's private negotiating position in the agency's system. Deliberately not built

---

## Decisions Recorded

**This feature is new**, and it replaces three free-text fields on a Tier 0 Candidate node. Those fields are removed by [[VRS-F028_Recruitment_Pipeline|VRS-F028]] rather than deprecated, since neither feature had shipped.

**The compensation figure is Tier 1 throughout.** A number that becomes someone's salary should not sit at the protection level of their phone number for the two weeks between offer and hire.

**Versioning creates a new node rather than editing.** Offers get negotiated, and *what did we originally offer* is a question with real consequences that an overwritten field cannot answer.

**Each version requires its own approval.** A negotiation drifting fifteen percent above the first approved figure should be approved again, and inheriting approval is how a founder discovers the final figure at the point of payroll.

**No signable offer letter is generated.** An optional summary exists for firms and jurisdictions where a candidate expects paper, explicitly labeled as not a contract. Generating a second signable document creates two sources of agreed terms that must then be reconciled — precisely the problem this product removes elsewhere.

**Competing-offer tracking is excluded deliberately** rather than omitted. It is an obvious field to add and it records a candidate's private negotiating position in the hiring agency's permanent system. That someone mentioned another offer in conversation does not make it the agency's data.

---

## Related Notes

- [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] — the requisition whose range constrains an offer
- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline, and the hire conversion acceptance triggers
- [[VRS-F030_Candidate_Portal|VRS-F030]] — where a candidate sees and accepts
- [[VRS-F020_Universal_Contract_Builder|VRS-F020]] — the contract that follows conversion

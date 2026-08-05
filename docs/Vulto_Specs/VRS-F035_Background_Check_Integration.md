---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F035
---

# VRS-F035 — Background Check Integration

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (Candidate, the Conversion Event Protocol, and the `candidate_id` field that document adds to Document), [[VRS-F030_Candidate_Portal|VRS-F030]] (the token-based portal this feature's consent flow extends), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (Document, and its provenance-inheritance rule), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (BackgroundCheckProvider and BackgroundCheckRecord), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the provider abstraction every external service is reached through)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A background-check request and consent workflow for a candidate in [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s pipeline, connecting to a third-party provider through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s abstraction, tracking status and the agency's own recorded decision.

**It does not attempt to become a second copy of the provider's compliance interface.** Providers maintain consumer-facing portals for dispute and detail, built by people whose entire job is getting that process right.

---

## Problem It Solves

[[VRS-F028_Recruitment_Pipeline|VRS-F028]] moves a candidate to Offer with no mechanism for a step that is common and in several jurisdictions legally necessary: a criminal record check, an employment verification, an education verification, before the offer becomes final.

Without this, an agency either skips a check it should run or performs it entirely outside the product — on a spreadsheet or in an inbox — with no durable record connecting the result to the hiring decision it informed. That record is exactly what gets asked for if the decision is later challenged.

---

## User-Facing Flows

### Requesting a check

An HR Admin, from a candidate at Offer stage, selects which checks to request from those the connected provider supports, and initiates.

**Nothing reaches the provider yet. Consent comes first.**

### Consent through the existing portal

The candidate opens their existing [[VRS-F030_Candidate_Portal|VRS-F030]] link, extended with a screen showing exactly what is being requested, by whom, and why, with a clear consent or decline action.

No new link, no account, the same JWT [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] already reuses for self-scheduling — a third purpose on one access surface rather than a third authentication mechanism.

### A decline

Recorded as such and visible to HR Admin, who decides how to proceed per the agency's own policy. **This feature never withdraws an offer automatically or makes that judgement itself.**

### While the check runs

Status moves to InProgress once consent is recorded and the request is sent. The candidate is not given a second status view here; the provider's own portal already serves that purpose.

### A result arrives

The provider's reported outcome — Clear, Flagged, or Pending on a specific check type — is recorded **exactly as reported, never interpreted or re-derived.**

An HR Admin separately records the agency's own decision: proceed, or do not.

### Filing the report

The provider's report files through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s `document.createFromSource` against the candidate, inheriting Tier 2 from BackgroundCheckRecord rather than Document's Tier 0 default.

### After the hire

Conversion runs unmodified. The record and its report remain as traversable from the resulting Employee as anything else in the candidate's history, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Conversion Event Protocol.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Provider configuration | Section in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] | One-time setup |
| Request check | Modal, from the candidate record | Selection and initiation |
| Check status | Section on the candidate record | Status, result, decision |
| Consent | Within [[VRS-F030_Candidate_Portal|VRS-F030]] | The candidate's decision |

### Layout and components

**Request check** is a set of Checkboxes, one per supported check type, with a plain statement of what each involves. Confirming shows what the candidate will be asked, verbatim, before it is sent — an HR Admin should see the request in the candidate's own words before it goes out.

**Check status** shows the requested types, the status Badge, and where complete two clearly separated rows: **Provider result** and **Agency decision.** They are visually distinct, labeled differently, and never merged. The first is a fact reported to the agency; the second is the agency's own judgement, and conflating them is how a provider's raw finding becomes a hiring decision nobody consciously made.

Recording a decision requires selecting it explicitly. **It is never pre-filled from the provider's result.**

**The consent screen** in the portal states the agency's name, exactly which checks are requested, who the provider is, and what happens to the result. Two actions — **Give consent** and **Decline** — with the decline action available immediately and no pre-ticked anything.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Status renders from local state |
| Restricted | Structurally absent for Manager, Finance Admin and Team Member. Owner sees it read-only |
| Awaiting consent | A `Pending consent` Badge with the request date, and one permitted resend |
| Empty | *No checks requested.* Available only at Offer stage |
| Error | A request before consent is refused at write, not merely hidden |

### Responsive

The consent screen is mobile-first at 375px.

---

## Technical Architecture

### BackgroundCheckProvider

HR Admin only, Tier 2.

```
provider_id:               UUID v4
workspace_id:              UUID
provider_name:             string, required — a label
credentials_reference:     string — an opaque pointer per VPS-A006. Never the
                           credentials themselves in this graph
supported_check_types:     JSON array of enum: CriminalRecord,
                           EmploymentVerification, EducationVerification,
                           CreditCheck, ReferenceCheck
is_active:                 boolean, default true

— Universal Node Conventions per VPS-A002 —
```

### BackgroundCheckRecord

HR Admin only, Tier 2.

```
record_id:                 UUID v4
workspace_id:              UUID
candidate_id:              UUID, FK to Candidate — a direct field
provider_id:               UUID, FK to BackgroundCheckProvider
requested_check_types:     JSON array of enum
status:                    enum: PendingConsent, ConsentGiven, ConsentDeclined,
                           InProgress, Completed, Canceled
consent_requested_at:      timestamp
consent_given_at:          timestamp, nullable
provider_reference_id:     string, nullable
overall_result:            enum: Clear, Flagged, Pending — nullable. The
                           provider's own outcome, recorded exactly as given
completed_at:              timestamp, nullable
decision:                  enum: ProceedWithHire, DoNotProceed, Pending —
                           nullable. The agency's judgement, distinct from
                           overall_result and never defaulted from it
decision_recorded_by:      user_id, nullable
decision_recorded_at:      timestamp, nullable
adverse_action_notice_sent_at: timestamp, nullable — recorded manually

— Universal Node Conventions per VPS-A002 —
```

### The provider integration

Reached through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s provider abstraction — an interface in `packages/schema`, with no vendor SDK imported by this feature.

The interface this feature requires is small: submit a request carrying check types, a candidate identifier and a consent confirmation; receive a status; receive a result; receive a report file.

**Which specific vendor sits behind it is a commercial decision made at implementation**, not an architectural gap. The abstraction exists precisely so that decision is a configuration change rather than a rewrite, which is the same treatment [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] gives disbursement.

### Consent is enforced at write

`status` cannot reach InProgress without `consent_given_at` set. Enforced at the write layer, not as a convention, because a check sent without recorded consent is a legal exposure and an interface guard is not sufficient protection against it.

### Document filing

Reports file through `document.createFromSource` with the BackgroundCheckRecord as source. Per [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s provenance rule the Document inherits Tier 2 and follows BackgroundCheckRecord's narrower permission row rather than Candidate's.

**The `candidate_id` field this requires on Document is added by [[VRS-F028_Recruitment_Pipeline|VRS-F028]]**, which needed it first for CVs. This feature relies on it rather than making the correction itself.

### API contracts

```
backgroundCheckProvider.configure(providerName, credentialsReference,
                                  supportedCheckTypes) -> { providerId }
  // HR Admin only

backgroundCheckRecord.request(candidateId, requestedCheckTypes) -> { recordId }
  // Status PendingConsent. Triggers a consent request through VRS-F030

candidatePortal.getConsentRequest(token) -> {
  agencyName, providerName, requestedCheckTypes, purposeStatement
} | null

candidatePortal.recordConsentDecision(token, decision) -> { success }
  // ConsentGiven triggers the provider request through VPS-A006's abstraction

backgroundCheckRecord.recordResult(recordId, overallResult, providerReferenceId)
  -> { success }
backgroundCheckRecord.recordDecision(recordId, decision,
                                     adverseActionNoticeSentAt?) -> { success }
  // HR Admin only. Never defaulted from overallResult
backgroundCheckRecord.listForCandidate(candidateId) -> BackgroundCheckRecord[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Both node types carry the schemas above. `check_for` connects the record to its Candidate |
| G02 | `overall_result` records the provider's outcome exactly as given. This feature never interprets, re-derives or overrides it |
| G03 | `decision` requires an explicit HR Admin action and is never defaulted from `overall_result` |
| G04 | Consent is collected exclusively through [[VRS-F030_Candidate_Portal|VRS-F030]]'s existing token mechanism. No second candidate authentication |
| G05 | `status` cannot reach InProgress without `consent_given_at`. Enforced at write |
| G06 | A background-check-sourced Document follows BackgroundCheckRecord's HR Admin only row, not Candidate's or Document's default |
| G07 | The record and its Document remain traversable from the resulting Employee after conversion, requiring no migration |
| G08 | Manager, Finance Admin and Team Member have no access under any circumstance. Owner is Read only; HR Admin alone holds Full |
| G09 | The provider is reached through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s abstraction. No vendor SDK is imported by this feature |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F035-S01 | Provider and record schemas | Data |
| VRS-F035-S02 | Consent collection through the candidate portal | Security |
| VRS-F035-S03 | Provider request and result recording | Logic |
| VRS-F035-S04 | Decision tracking | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin requests a criminal record check for a candidate at Offer stage
**WHEN** the request is created
**THEN** a record exists at PendingConsent and nothing has reached the provider

---

**GIVEN** a candidate opens their existing portal link
**WHEN** a pending request exists
**THEN** they see the agency, the provider, exactly what is requested and why, and can consent or decline with no new account

---

**GIVEN** a candidate declines
**WHEN** it is recorded
**THEN** status becomes ConsentDeclined, HR Admin sees it, no request is sent, and no pipeline action follows automatically

---

**GIVEN** a provider reports Flagged
**WHEN** the result is recorded
**THEN** it is stored exactly as given, no decision is pre-filled, and no automatic notice or pipeline action follows

---

**GIVEN** a report is filed
**WHEN** filing completes
**THEN** the Document's `candidate_id` is set, `employee_id` is null, and its tier is 2 inherited from the record

---

**GIVEN** the candidate is later hired
**WHEN** their Employee record is viewed
**THEN** the record and report remain traversable through the conversion history with no migration

---

**GIVEN** a Manager attempts to view a background check
**WHEN** the attempt is made
**THEN** it is structurally absent

---

**GIVEN** an Owner attempts to initiate a check
**WHEN** the attempt is made
**THEN** it is refused. Owner holds Read only; HR Admin alone may initiate

---

## Non-Functional Requirements

- Consent request and result recording complete within 500ms from the local graph
- Requesting, viewing status and recording a decision function offline. The provider request and consent trigger require connectivity
- A record never reaches InProgress without recorded consent, enforced at write

---

## Security Considerations

- **Owner holds Read, not Full, and this is one of the narrowest role splits in the graph.** Background check compliance — consent requirements, retention limits, adverse-action obligations — should run through someone trained in it rather than be casually initiated by an Owner who happens also to run the company.
- **Manager is excluded entirely**, in the same spirit as their exclusion from Departure and FlightRiskSignal. A hiring manager forming an opinion from a raw *criminal record: flagged* line, before HR has reached a decision, is exactly the bias this restriction prevents. They learn the outcome of a hiring decision, never the check content that informed it.
- **Provider result and agency decision are separate fields, separately labeled and never merged.** A pre-filled decision is a decision nobody consciously made, and it is the failure that turns an automated check into an automated rejection.
- **Credentials are never in this graph.** `credentials_reference` is an opaque pointer per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]].
- **A background check is among the most sensitive records this product holds about a person who does not yet work for the agency.** [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s retention schedules govern how long it is kept, and this feature does not override them.

---

## Out of Scope

- **Generating, templating or enforcing the timing of an adverse-action notice.** Jurisdictions vary enough, and the consequence of getting it wrong is serious enough, that this document declines to encode a process. The field records that a notice was sent; the notice itself is the agency's responsibility
- **A candidate-facing view of their detailed report** — the provider's own portal does this correctly
- **Automatic offer withdrawal on a flagged result or a declined consent** — every consequential action is a recorded human decision
- **Checks on existing employees**, for cause or periodic re-verification — this feature's scope is the hiring pipeline. Employee re-verification is a distinct decision, not an automatic extension
- **Which vendor is used** — a commercial decision, made behind [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s abstraction

---

## Decisions Recorded

**The provider integration is no longer an open item.** [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] establishes that every external service is reached through an interface in `packages/schema` with no vendor SDK in feature code. Naming a vendor was never an architectural requirement; having an abstraction was, and it exists.

**The Document correction is made by [[VRS-F028_Recruitment_Pipeline|VRS-F028]] rather than here.** That feature needs `candidate_id` for CVs and is built first. This document relies on it, which is the correct direction — the earlier feature owns the schema change and the later one consumes it.

**Adverse-action notice generation remains permanently excluded.** The field records that a notice was sent because the record matters; generating one would require jurisdictional legal expertise this product does not have and should not claim.

**This feature moves from Mature into the recruitment cluster**, where it belongs. A background check happens between offer and hire, and scheduling it thirty features after the pipeline it sits inside was an artefact of the old ordering.

---

## Related Notes

- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline, and the `candidate_id` field this feature relies on
- [[VRS-F030_Candidate_Portal|VRS-F030]] — the consent surface
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where reports are filed
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the provider abstraction

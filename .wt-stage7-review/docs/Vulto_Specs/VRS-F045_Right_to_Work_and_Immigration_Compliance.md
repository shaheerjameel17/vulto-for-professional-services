---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F045
---

# VRS-F045 — Right to Work and Immigration Compliance

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity and jurisdiction — authorization is always to work *somewhere*), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days, for expiry windows), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (where permit documents are filed), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (the tracked-date pattern), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where an approaching expiry surfaces), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (WorkAuthorization)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A record that each employee is authorized to work in the jurisdiction their entity employs them in, with the type of authorization, its expiry where it has one, and the supporting document filed against it.

---

## Problem It Solves

For a product built explicitly for firms operating across Pakistan, the UAE and the UK, this is not an edge case. It is the ordinary condition of the market: a Pakistani designer on a UAE employment visa, a UK company employing someone on a skilled worker visa, a contractor whose permit is tied to a specific sponsor.

Two distinct failures follow from having no record.

**A permit expires and nobody notices.** Employing someone without valid authorization carries penalties in every jurisdiction in [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]]'s enum, and in several the penalty falls on the employer regardless of whether they knew. The expiry is silent — nothing happens on the day, and the exposure accumulates until something forces the question.

**The check itself is unevidenced.** In the UK specifically, a compliant right-to-work check performed before employment begins is a statutory excuse against a civil penalty. Performed and undocumented, it protects nobody. Most small agencies do the check, do it properly, and cannot prove it eighteen months later.

---

## User-Facing Flows

### Recording authorization

An HR Admin records, for an employee, the jurisdiction, the authorization type, its expiry where applicable, and who performed the check and when. The supporting document is filed through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] at Tier 2.

### At hire

Recording authorization is an onboarding task per [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]], due before the start date. **A missing record is surfaced, not blocked** — the same treatment [[VRS-F042_Asset_and_Gear_Tracker|VRS-F042]] gives an outstanding asset, and consistent with this product's general position that flagging beats gating.

The exception is deliberate: an employee whose start date has passed with no authorization record is escalated daily to HR Admin and Owner, because this is one of the few gaps in the product with a statutory penalty attached.

### Expiry

Within the warning window — ninety days by default, deliberately longer than any other tracked date in the product, because renewing a visa takes months — the expiry surfaces in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox for HR Admin and for the employee.

On expiry it escalates to Owner and HR Admin daily until resolved.

### Renewal

Recording a renewal updates the existing record's expiry and files the new document. The same authorization continuing, not a new one replacing it — the same treatment [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] gives a certification renewal.

### A change of status

Where someone moves from one authorization type to another — a visa converting to indefinite leave, a student visa to a work visa — a new record supersedes the old, with the prior retained.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Work authorization | Section on the employee profile | One person's record |
| Compliance | Content | Every record, by status |
| Record authorization | Modal | Short, consequential |

### Layout and components

**Work authorization** on the profile is a compact record: jurisdiction, type, status Badge, expiry with days remaining, the check date and checker, and the filed document.

The Section is **structurally absent** for a Manager, per WorkAuthorization's HR-restricted class. A manager knowing that their report holds a time-limited visa is not information their role requires, and it is precisely the kind of fact that colors decisions it should not.

**Compliance** is a Table: employee, jurisdiction, type, expiry, days remaining, document filed. Three filter states as a Toggle Group — **Expiring**, **Expired**, **Missing**.

Missing is the state worth designing for: an active employee with no record at all. It is the easiest to overlook because it produces no row anywhere else in the product, and it is where the statutory penalty actually lands. The filter defaults to it when any exist.

Rows within the window render `attention`; expired and missing render `danger`.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Structurally absent for Manager, Finance Admin and Team Member other than their own. Owner and HR Admin only |
| Expiring | `attention`, notified from 90 days |
| Expired or missing | `danger`, escalated daily to Owner and HR Admin |
| Empty | *Every active employee has a current record.* Stated as the good news it is |
| Error | An expiry date before the check date is refused |

### Responsive

Drops `type`, then `check date`, below 1280px. Expiry is never dropped.

---

## Technical Architecture

### The WorkAuthorization schema

HR-restricted, Tier 2.

```
authorization_id:      UUID v4
workspace_id:          UUID
employee_id:           UUID, FK to Employee — a direct field
jurisdiction:          enum per VRS-F003 — always the jurisdiction the
                       authorization permits work in
authorization_type:    enum: Citizen, PermanentResident, WorkVisa,
                       DependentVisa, StudentWithWorkRights, Other
type_detail:           string, nullable — the local designation, e.g.
                       "Skilled Worker", "Golden Visa". Free text because
                       a fixed enum across seven jurisdictions would be
                       wrong within a year
has_expiry:            boolean
expiry_date:           date, nullable, required where has_expiry
sponsor_required:      boolean, default false — whether the authorization is
                       tied to this employer specifically
check_performed_at:    date, required
check_performed_by:    user_id, required
document_id:           UUID, nullable, FK to Document
status:                enum: Current, Expiring, Expired, Superseded
supersedes_id:         UUID, nullable
notes:                 text, nullable

— Universal Node Conventions per VPS-A002 —
```

`check_performed_at` and `check_performed_by` are required, not optional. **They are the record that makes the check evidenced**, and an authorization record without them documents a status rather than a compliance act.

### Sponsor-tied authorization

`sponsor_required` matters because it changes what a departure means. Where an authorization is tied to this employer, the employee's right to remain frequently ends with their employment, on a defined timescale.

**Where a Departure exists per [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] for an employee with a sponsor-tied authorization, the compliance view surfaces it**, because the obligations that follow — notifying an authority, in some jurisdictions within days — are real and easy to miss in an offboarding that is otherwise routine.

The feature states the fact. It does not attempt to state the obligation, which varies per jurisdiction.

### The missing-record query

An active employee with no Current WorkAuthorization. A read query, no node type, the same pattern as [[VRS-F042_Asset_and_Gear_Tracker|VRS-F042]]'s outstanding assets and [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s overcommitment sweep.

This is the query that matters most, because a missing record is invisible everywhere else.

### Expiry evaluation

A daily job per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], idempotent, moving records to Expiring within the window and Expired past it, and notifying accordingly. Idempotency prevents a daily re-notification becoming noise — with the deliberate exception of Expired and Missing, which do notify daily, because those states have a penalty attached and habituation is the lesser risk.

### API contracts

```
workAuthorization.record(employeeId, jurisdiction, authorizationType,
                         hasExpiry, expiryDate?, typeDetail?,
                         sponsorRequired?, checkPerformedAt, documentFile?)
  -> { authorizationId }

workAuthorization.renew(authorizationId, newExpiryDate, checkPerformedAt,
                        documentFile?) -> { success }
  // Updates the existing record. The same authorization continuing

workAuthorization.supersede(employeeId, newAuthorization) -> { newAuthorizationId }
  // A change of status. The prior record is retained

workAuthorization.getForEmployee(employeeId) -> WorkAuthorization | null

workAuthorization.complianceList(workspaceId, filter?) -> {
  employeeId, employeeName, jurisdiction, authorizationType,
  expiryDate?, workingDaysRemaining?, status, hasDocument
}[]
  // filter: 'expiring' | 'expired' | 'missing' | 'all'

workAuthorization.sponsoredDepartures(workspaceId) -> {
  employeeId, employeeName, lastWorkingDate, authorizationType
}[]
  // Departing employees whose authorization is sponsor-tied
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | WorkAuthorization carries the schema above, HR-restricted, Tier 2 |
| G02 | `authorization_for` connects it to Employee |
| G03 | `check_performed_at` and `check_performed_by` are required. A record without them is refused |
| G04 | At most one Current record per employee. A change of status supersedes; the prior is retained |
| G05 | A renewal updates the existing record's expiry. It does not create a new record |
| G06 | A missing record is a read query over active employees, introducing no node type |
| G07 | Expiry windows count working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| G08 | A missing or expired authorization escalates daily. Every other tracked date in the product notifies once and then weekly |
| G09 | A departing employee with a sponsor-tied authorization is surfaced. This feature states the fact and never the resulting obligation |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F045-S01 | WorkAuthorization schema | Data |
| VRS-F045-S02 | Recording and evidencing a check | Logic |
| VRS-F045-S03 | Expiry tracking and renewal | Logic |
| VRS-F045-S04 | Missing-record detection | Logic |
| VRS-F045-S05 | Sponsor-tied departure surfacing | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin records a work visa with an expiry and a check date
**WHEN** it is saved
**THEN** the record exists as Current with the checker and check date recorded, and the supporting document is filed at Tier 2

---

**GIVEN** a record is submitted without a check date or checker
**WHEN** it is attempted
**THEN** it is refused. The evidence of the check is not optional

---

**GIVEN** an authorization expires in 85 working days against a 90-day window
**WHEN** the daily job runs
**THEN** its status becomes Expiring and both HR Admin and the employee are notified

---

**GIVEN** it expires
**WHEN** the job runs afterwards
**THEN** its status becomes Expired and Owner and HR Admin are notified daily until resolved

---

**GIVEN** an active employee has no authorization record
**WHEN** the compliance view opens
**THEN** they appear under Missing, and the filter defaults to that state

---

**GIVEN** a Manager views their report's profile
**WHEN** it renders
**THEN** the work authorization Section is structurally absent

---

**GIVEN** an employee with a sponsor-tied authorization has a Departure recorded
**WHEN** the compliance view is checked
**THEN** they appear under sponsored departures with their last working date

---

**GIVEN** an authorization is renewed
**WHEN** the renewal is recorded
**THEN** the existing record's expiry updates, the new document is filed, and no second record is created

---

## Non-Functional Requirements

- The compliance list resolves within 200ms from the local graph
- The daily job covers 150 employees within 2 minutes
- Recording and viewing function offline. Document upload requires connectivity

---

## Security Considerations

- **WorkAuthorization is HR-restricted, Tier 2, and Manager is excluded entirely.** A manager knowing their report holds a time-limited visa is not information their role requires, and it is exactly the kind of fact that colors a staffing or promotion decision it should not. The same reasoning excludes Manager from Departure and FlightRiskSignal.
- **The employee retains read access to their own record**, which they need — a visa expiry is their problem before it is the agency's.
- **The filed document is among the more sensitive in the product**: a passport, a visa vignette, a biometric residence permit. It inherits Tier 2 through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s provenance rule and follows this node's narrower row rather than Document's default.
- **`type_detail` is free text and will contain nationality-adjacent information.** That is unavoidable — a visa designation implies things about a person's citizenship — and it is why the whole record sits at HR-restricted rather than Standard, and why it never appears in [[VPS-F002_Local-First_Search|VPS-F002]]'s search index.
- **This feature records a status and never assesses eligibility.** It does not decide whether an authorization is valid, whether a check was compliant, or what a jurisdiction requires on a sponsored departure. Those are questions for counsel, and a product that answered them would be answering them wrongly in at least four of the seven jurisdictions.

---

## Out of Scope

- **Assessing whether an authorization is valid or a check was compliant** — a legal question this product does not answer
- **Government system integration**, such as the UK's online right-to-work checking service — a real integration and a jurisdiction-specific one, deferred
- **Visa application or renewal workflow** — the agency's immigration adviser handles this. The feature tracks the date
- **Sponsorship license management** for the employer's own sponsor status — an employer-level compliance matter distinct from a per-employee record
- **Blocking employment without a record** — surfaced and escalated, never gated, consistent with the product's general position
- **Nationality or country of birth as fields.** Deliberately not collected. The authorization and its jurisdiction are what the agency needs; nationality is not, and collecting it invites its use in decisions where it has no place

---

## Decisions Recorded

**This feature is new**, and for a product built for firms operating across Pakistan, the UAE and the UK, its absence was a compliance gap rather than a missing convenience.

**`check_performed_at` and `check_performed_by` are required.** In the UK a documented right-to-work check is a statutory excuse against a civil penalty; undocumented, it protects nobody. Most agencies perform the check correctly and cannot prove it later, and making the evidence mandatory is the entire difference.

**The warning window defaults to 90 days**, materially longer than any other tracked date in the product, because renewing a visa takes months and a 30-day warning is a warning that arrives too late to act on.

**Expired and missing records escalate daily**, breaking this product's general preference for quiet notification. These are among the few states with a statutory penalty attached, and habituation is the lesser risk.

**Nationality is deliberately not collected.** The agency needs to know someone is authorized to work and until when. It does not need their nationality, and a field collecting it invites its use in decisions where it has no legitimate place.

**Manager is excluded entirely**, consistent with Departure and FlightRiskSignal. A time-limited visa is exactly the sort of fact that quietly influences who gets put forward for a long engagement.

---

## Related Notes

- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the jurisdiction an authorization permits work in
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where permit documents are filed
- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — the departure that matters for sponsor-tied authorization
- [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] — the onboarding task recording it at hire

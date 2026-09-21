---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F041
---

# VRS-F041 — Certification and Training Tracker

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee and `has_skill`, the target of automatic derivation), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (the proficiency ordering, reused directly), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (where a certificate is filed), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (the tracked-date pattern reused for expiry), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where an approaching expiry surfaces), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Certification and TrainingRecord)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

Two related records. A **Certification** is the reusable definition of a credential — *AWS Certified Solutions Architect*. A **TrainingRecord** is a specific completed course or workshop.

Both can automatically derive or upgrade a `has_skill` edge, closing a gap that would otherwise leave a genuine, evidenced capability unrecorded until someone remembers to enter it separately.

---

## Problem It Solves

An employee who earns an externally validated certification has demonstrated something concrete, and [[VRS-F014_Skill_Matrix|VRS-F014]]'s matrix and [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matching should reflect it without a second manual step.

Without derivation, the certification exists as a fact in one place and the skill it implies exists — if at all — as a disconnected entry somewhere else. The practical consequence is a project manager searching for AWS expertise and not finding the person who was certified last month.

**There is a compliance dimension too**, and for some agencies it is the more pressing one. A lapsed certification that a client contract requires is a commercial exposure, and it lapses silently.

---

## User-Facing Flows

### Defining a certification type

An HR Admin defines a Certification once, optionally linking it to a Skill and the proficiency level earning it implies. Workspace-wide reference data, defined once, held by many people over time.

### Recording that an employee holds it

An employee, or HR Admin on their behalf, records that they hold it — with issue date, expiry where applicable, and issuing body — and optionally attaches the certificate itself, filed through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]].

Where the Certification carries a linked skill, a `has_skill` edge is created or upgraded automatically and **marked verified**, since a genuine credential is third-party evidence.

### Logging a completed training

The same derivation applies, but the resulting edge is **not** automatically verified. An internal training completion is real progress and a weaker category of evidence, and this feature does not inflate one into the other.

### An approaching expiry

Within the workspace's warning window an expiring certification surfaces in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox for the employee and HR Admin, and on a tracked view. The same shape [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] established: a tracked date, surfaced early, needing a human response.

### An expired certification

**This is the case the previous specification did not handle.** On expiry the `holds_certification` edge remains — the person did hold it — but a certification-derived `has_skill` edge loses its verified status.

The skill itself is retained at its level. Someone certified in AWS three years ago has not forgotten AWS. But the *external validation* has lapsed, and continuing to present the skill as verified would be a claim the agency can no longer support — which matters most when [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matcher is being used to staff a project a client contract has requirements about.

### Renewing

Updates the existing record's expiry date and restores verified status. The same credential continuing, not a new one replacing it.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Certifications | Content + Panel | Definitions. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Employee certifications | Section on the profile | What a person holds |
| Expiry tracking | Content | What is lapsing |

### Layout and components

**Employee certifications** is a visual badge grid rather than a table — each certification as a 120×80px Card with its name, issuing body and expiry, bordered `success` where current, `attention` within the warning window, and `text-tertiary` with a strikethrough date where expired.

A grid because certifications are a thing people are proud of, and a table of expiry dates reads like an audit. This is the one place in the product where that consideration outweighs density.

Beneath, training records as a plain list — title, provider, completed date, and the skill granted where applicable.

**Expiry tracking** is a Table: employee, certification, expiry date, days remaining, and whether a skill's verification depends on it. Sorted by expiry ascending. That last column is what makes this screen more than a reminder list — an expiring certification that underpins a verified skill has a downstream consequence, and an HR Admin should see which ones do.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton cards |
| Restricted | Certifications are Tier 0 and visible per Employee's normal rules |
| Expiring | `attention` border and the days remaining stated |
| Expired | `text-tertiary`, strikethrough date, and a **Renew** action |
| Empty | *No certifications recorded.* with **Add certification** |
| Error | An expiry date before the issue date is refused |

### Responsive

The badge grid reflows from four columns to two below 1280px and one below 768px.

---

## Technical Architecture

### Certification

Standard, Tier 0.

```
certification_id:          UUID v4
workspace_id:              UUID
name:                      string, required
issuing_body_default:      string, nullable — a default for the edge
grants_skill_id:           UUID, nullable, FK to Skill
grants_proficiency_level:  enum per VRS-F013, nullable
typical_validity_months:   integer, nullable — pre-fills an expiry date
lifecycle_status:          enum: Active, Deprecated

— Universal Node Conventions per VPS-A002 —
```

`issue_date`, `expiry_date` and `issuing_body` live on the `holds_certification` edge per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. This node is the reusable definition, not the instance.

### TrainingRecord

```
training_record_id:  UUID v4
workspace_id:        UUID
employee_id:         UUID, FK to Employee — a direct field
title:               string, required
completed_date:      date
provider:            string, nullable
document_id:         UUID, nullable, FK to Document

— Universal Node Conventions per VPS-A002 —
```

`proficiency_level_granted` lives on the `resulted_in` edge to Skill.

### Derivation, and why verification differs

Recording either creates a `has_skill` edge at the specified level if none exists, or upgrades it if the derived level exceeds what is there. **It never downgrades an existing higher level.**

A certification-derived edge is `verified = true`. A training-derived edge is not. A permanent distinction rather than a simplification: [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matching and [[VRS-F014_Skill_Matrix|VRS-F014]]'s matrix both already distinguish verified from self-reported, and quietly inflating a course completion into the same evidentiary weight as an external credential would corrupt that distinction wherever it is relied on.

### Expiry and verification withdrawal

On expiry:

1. The `holds_certification` edge remains, with its expiry date passed. The person did hold it.
2. Any `has_skill` edge whose verification derived from this certification has `verified` set to false.
3. The proficiency level is unchanged.
4. The employee and HR Admin are notified.

A `has_skill` edge verified through more than one source retains verification while any source remains current.

Renewal restores verification.

### Expiry evaluation

A daily job per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], idempotent, evaluating both the warning window and actual expiry. Idempotency matters here specifically: a repeated run must not re-notify an employee daily about the same expiring certification, which is how a warning becomes noise.

### API contracts

```
certification.create(name, grantsSkillId?, grantsProficiencyLevel?,
                     typicalValidityMonths?, issuingBodyDefault?)
  -> { certificationId }

employee.recordCertification(employeeId, certificationId, issueDate,
                             expiryDate?, issuingBody?, certificateFile?)
  -> { edgeId, skillDerived? }
  // Creates holds_certification; derives or upgrades has_skill, verified true.
  // Files the certificate through VRS-F022 where provided

certification.recordRenewal(employeeId, certificationId, newExpiryDate)
  -> { success, verificationRestored }

trainingRecord.create(employeeId, title, completedDate, provider?,
                      resultedInSkillId?, proficiencyLevelGranted?, file?)
  -> { trainingRecordId, skillDerived? }
  // Derives or upgrades has_skill. verified is not set

certificationTracker.listExpiring(workspaceId, windowDays?) -> {
  employeeId, certificationName, expiryDate, daysRemaining,
  underpinsVerifiedSkill
}[]

certificationTracker.processExpiries(workspaceId) -> {
  expired: { edgeId, skillVerificationWithdrawn }[]
}
  // Daily, idempotent

employee.listCertifications(employeeId)  -> { name, issueDate, expiryDate,
                                              issuingBody, isExpired }[]
employee.listTrainingHistory(employeeId) -> TrainingRecord[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Certification and TrainingRecord carry the schemas above. `holds_certification` and `resulted_in` connect them to Employee and Skill |
| G02 | Derivation never downgrades an existing `has_skill` level. It creates or upgrades only |
| G03 | A certification-derived edge is always `verified = true`. A training-derived edge is never automatically verified. A permanent distinction |
| G04 | On expiry the `holds_certification` edge is retained, and any `has_skill` verification deriving from it is withdrawn. The proficiency level is unchanged |
| G05 | A skill verified by more than one source retains verification while any source remains current |
| G06 | Renewal updates the existing edge's expiry and restores verification. No new edge or Certification node is created |
| G07 | The expiry job is idempotent per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. A repeated run produces no duplicate notification |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F041-S01 | Certification and TrainingRecord schemas | Data |
| VRS-F041-S02 | Automatic skill derivation | Logic |
| VRS-F041-S03 | Expiry tracking and verification withdrawal | Logic |
| VRS-F041-S04 | Certification badge grid | UI |

---

## Feature Acceptance Criteria

**GIVEN** a Certification linked to Expert AWS is recorded for an employee with no prior AWS skill
**WHEN** it is saved
**THEN** a `has_skill` edge exists at Expert, verified true

---

**GIVEN** the same employee already held AWS at Intermediate, self-reported
**WHEN** the certification is recorded
**THEN** the edge upgrades to Expert and verified becomes true

---

**GIVEN** an employee holds a skill at Expert
**WHEN** a training record linked to the same skill at Intermediate is logged
**THEN** the Expert level is unchanged. A lower derived level never downgrades a higher existing one

---

**GIVEN** a training-derived edge is created
**WHEN** it is viewed
**THEN** verified is false, distinct from a certification-derived edge for the same skill

---

**GIVEN** a certification underpinning a verified skill expires
**WHEN** the expiry job runs
**THEN** the `holds_certification` edge is retained, the skill's verified flag is withdrawn, its proficiency level is unchanged, and the employee and HR Admin are notified

---

**GIVEN** that certification is renewed
**WHEN** the renewal is recorded
**THEN** the expiry updates on the existing edge and verification is restored

---

**GIVEN** the expiry job runs twice against unchanged state
**WHEN** the second run completes
**THEN** no duplicate notification is sent

---

**GIVEN** a certificate file is attached
**WHEN** it is filed
**THEN** it is stored through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] against the employee at Tier 0

---

## Non-Functional Requirements

- Skill derivation completes within 200ms of recording
- The expiry job covers 150 employees within 2 minutes
- Full functionality offline for recording and viewing

---

## Security Considerations

- **No elevated privacy concern.** Certification, TrainingRecord and their edges are Standard, Tier 0, consistent with `has_skill` and `holds_certification`.
- **The verified-versus-unverified distinction is an integrity guarantee, not a formality.** It is relied on by [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matching and [[VRS-F014_Skill_Matrix|VRS-F014]]'s matrix, and both are used to make staffing commitments to clients. A certification presented as verified after it has lapsed is a claim the agency cannot support.
- **Withdrawing verification on expiry is the honest behavior and it will occasionally be unwelcome.** A person whose credential lapsed sees their skill lose a marker, which is correct: the marker means externally validated, and it no longer is.
- **A certificate document is Tier 0**, consistent with the certification itself. It is a credential someone was awarded, not a sensitive record.

---

## Out of Scope

- **Manual verification of a training-derived skill by an HR Admin** — a reasonable extension, not built here
- **Structured integration with [[Vulto Learn - Team Knowledge]]'s completion records** — `provider` is a plain string. That application does not exist yet
- **Certification cost or reimbursement tracking** — a financial concern
- **Automatic renewal booking or provider integration** — the feature tracks a date, it does not book an exam
- **Mandatory certifications per role, blocking assignment without one** — a real requirement in regulated industries and deliberately not built. This product serves professional services firms, and encoding compliance gates that vary by client contract would be guessing at a shape that differs per customer

---

## Decisions Recorded

**Verification withdrawal on expiry is new and is the substantive addition.** The previous specification surfaced an expiring certification and did nothing when it actually expired, which meant an agency could staff a project on a verified skill whose credential lapsed two years earlier — and the matcher would never say so.

**The `holds_certification` edge is retained on expiry.** The person did hold the credential, and deleting the record would lose a true fact about their history.

**A skill verified by several sources retains verification while any remains current**, which prevents a person losing a marker they still legitimately have.

**`underpinsVerifiedSkill` is surfaced in the expiry list.** An expiring certification with a downstream consequence is more urgent than one without, and an HR Admin should not have to work out which is which.

**The badge grid is retained over a table.** [[Vulto Roster]]'s own product note describes a visual badge grid, and it is the right call — certifications are something people are proud of, and this is the one screen where that outweighs density.

**Mandatory certifications gating assignment are excluded deliberately.** Genuinely required in some industries; the shape varies per client contract, and encoding it would be guessing.

---

## Related Notes

- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the matching that relies on the verified distinction
- [[VRS-F014_Skill_Matrix|VRS-F014]] — the matrix that displays it
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where certificates are filed
- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — the tracked-date pattern reused here

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F028
---

# VRS-F028 — Recruitment Pipeline

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee, the destination of the Conversion Event Protocol), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (Skill and the `requires_skill` edge), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (Document, for CVs — with the correction below), [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] (the approved requisition an OpenRole originates from), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Candidate and OpenRole registry entries)
**Blocks:** [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] (nothing to post without a role), [[VRS-F030_Candidate_Portal|VRS-F030]] (no pipeline to report status from), [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]], [[VRS-F032_Offer_Management|VRS-F032]], [[VRS-F033_Talent_Pool_and_Candidate_CRM|VRS-F033]], [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]]

This document is the single source of truth for this feature and owns OpenRole and Candidate's complete schemas.

---

## What It Is

The recruitment pipeline: an open role exists, candidates apply or are added, and each moves through stages until the role is filled or they exit.

Hiring converts a Candidate to an Employee through the Conversion Event Protocol, **preserving their full history rather than starting a new record.**

This document replaces an earlier *Basic ATS Pipeline*. The expansion is deliberate: what was there covered stages and a hire conversion, which is an applicant tracker rather than a recruitment system, and a professional services firm's hiring problem is not tracking applicants.

---

## Problem It Solves

Recruitment in spreadsheets and email loses candidates, duplicates effort across whoever's inbox holds the latest state, and leaves no record of why someone was rejected when the question arises six months later.

The specific problems this expansion addresses, each absent from the previous version:

**The same person applies twice.** Most agencies re-encounter candidates, and a pipeline that treats each application as an unrelated record loses the assessment made last time.

**Rejection reasons are free text**, which makes [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]]'s hiring analytics impossible — *not enough experience*, *too junior* and *lacked seniority* are one reason recorded three ways.

**Time in stage is invisible.** A candidate sitting in Screening for three weeks is the most common way an agency loses someone to a competitor, and it is not visible in a status field.

**Everything is one candidate at a time.** A role with forty applicants needs bulk rejection, or the person doing it will not do it at all.

---

## User-Facing Flows

### Creating an open role

An HR Admin or Owner creates a role: title, seniority, target project, required skills through the picker [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] owns, and hiring manager.

Where the role originates from an approved requisition per [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]], all of this pre-fills and the link is preserved.

### Adding candidates

Manually, through [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]]'s careers site, through a referral per [[VRS-F034_Employee_Referral_Program|VRS-F034]], or from [[Vulto Jobs]] on [[Vulto Network]]. `source` records which.

**Duplicate detection runs on every addition.** Where the email or phone matches an existing candidate — for this role or any other, at any time — the addition surfaces the prior record with its outcome before proceeding. The recruiter chooses to link the applications or to proceed as a genuinely different person.

### Moving through stages

Applied → Screening → Interview → Offer → Hired or Rejected, one stage at a time, each transition timestamped.

**Stages are a fixed set.** A workspace may disable stages it does not use — a small studio that interviews once may turn off Screening — but cannot add new ones. The reasoning is the same as [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]'s fixed category set: an extensible stage model makes [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]]'s analytics incomparable within a workspace over time and across workspaces entirely, and time-to-hire stops meaning anything.

### Rejecting

A rejection requires a **structured reason** from a fixed set, with optional free-text detail:

Skills mismatch · Insufficient experience · Overqualified · Compensation expectations · Location or right to work · Withdrew · Accepted another offer · Role canceled · Better candidate selected

The structured value is what [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] analyzes. The free text is for the humans.

### Bulk actions

Multiple candidates can be moved or rejected together, with one structured reason applied to all. A role with forty applicants and three worth interviewing needs this, and without it the other thirty-seven are never formally closed — they simply stop hearing anything, which is exactly what [[VRS-F030_Candidate_Portal|VRS-F030]] exists to prevent.

### Hiring

Converts the Candidate to an Employee through the Conversion Event Protocol. Status becomes Converted, never deleted; a `converted_from` edge preserves the link; the full application history remains traversable from the new employee record.

From there an HR Admin opens [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s contract builder exactly as for anyone else. **This feature does not generate documents.**

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Open roles | Content + Panel | The roles being recruited |
| Pipeline board | Content + Panel | One role's candidates by stage |
| Candidate | Panel | The full record |
| All candidates | Content | Across every role, for search and duplicates |

### Layout and components

**Pipeline board** is the primary surface: columns per active stage, candidate Cards within, drag between columns to advance.

Each Card shows name, source Badge, days in current stage, and where an interview is scheduled its date. **Days in stage renders `attention` past a threshold** — seven days by default — which turns the most common failure in agency recruitment into something visible rather than something noticed in hindsight.

Column headers show the count and the median time in that stage across the role's history. A Screening column reading *12 · median 9 days* tells a recruiter more than any report.

**Bulk selection** works by checkbox on Cards, with a floating action bar appearing on first selection: **Move to**, **Reject**, **Add to talent pool**. The bar states the count and never obscures the board.

**Candidate Panel** has tabs: Overview, Interviews, Documents, History. History is the one worth building carefully — every stage transition with its timestamp and actor, every prior application by the same person, and the outcome of each. A recruiter asking *have we seen this person before* should get the answer here rather than by searching.

**Open roles** is a Table: title, seniority, hiring manager, candidate count by stage as a compact stacked bar, days open, status. `Days open` sorted descending by default.

### Keyboard

`J`/`K` move between Cards within a column, `H`/`L` between columns. `X` toggles selection. `Enter` opens the Panel. `1`–`5` move a focused candidate to that stage.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton cards |
| Restricted | A Manager sees roles they are hiring manager for. Finance Admin and Team Member see nothing |
| Empty | A role with no candidates shows the posting link from [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] and **Add candidate** |
| Duplicate | An inline Alert on the add form naming the prior application and its outcome |
| Error | Advancing more than one stage at a time is refused |

### Responsive

The board becomes a single-column stage-filtered list below 1024px, with a stage Select above it.

---

## Technical Architecture

### OpenRole

```
open_role_id:      UUID v4
workspace_id:      UUID
title:             string, required
requisition_id:    UUID, nullable, FK to Requisition per VRS-F027
project_id:        UUID, nullable
hiring_manager_id: UUID, nullable, FK to Employee
seniority_level:   enum per VRS-F002, nullable
status:            enum: Open, Filled, Canceled
target_start_date: date, nullable
opened_at:         timestamp
filled_at:         timestamp, nullable
source_draft_hiring_record_id: UUID, nullable — set by VRS-F036 only

— Universal Node Conventions per VPS-A002 —
```

### Candidate

```
candidate_id:        UUID v4
workspace_id:        UUID
full_name:           string, required
email:               string, required
phone:               string, nullable
open_role_id:        UUID, nullable
source:              enum: Direct, Referral, CareersSite, VultoJobs,
                     TalentPool, Agency, Other
referral_id:         UUID, nullable, FK to Referral per VRS-F034
pipeline_stage:      enum: Applied, Screening, Interview, Offer — meaningful
                     only while lifecycle_status is Active
stage_entered_at:    timestamp — reset on every transition. The basis for
                     time-in-stage
lifecycle_status:    enum: Active, Hired, Rejected, Withdrawn, Converted
rejection_reason:    enum from the fixed set, required when Rejected
rejection_detail:    text, nullable
cv_document_id:      UUID, nullable, FK to Document
linked_candidate_ids: UUID[] — prior applications by the same person

— Universal Node Conventions per VPS-A002 —
```

**Offer terms are no longer held here.** The previous version carried `offer_role_title`, `offer_compensation` and `offer_start_date` as free text on the Candidate. [[VRS-F032_Offer_Management|VRS-F032]] owns offers properly, with a compensation figure at Tier 1 and an approval chain. Those three fields are removed rather than deprecated — no workspace has used them, since neither feature has shipped.

Interview notes and rating are likewise removed; [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] owns structured feedback per panelist.

### Stage transitions

`stage_entered_at` resets on every transition, and each transition writes to [[VPS-F004_Silent_Audit_Log|VPS-F004]]. **Time in stage is computed live** from `stage_entered_at`; median time per stage is computed across the role's completed transitions, never stored.

Transitions move one stage at a time. Skipping is refused — a candidate who went from Applied to Offer either went through screening informally or the record is wrong, and both are worth surfacing.

### Duplicate detection

On candidate creation, an exact match on email or a normalized match on phone against every Candidate in the workspace, at any lifecycle status, at any time.

A match surfaces the prior record with its outcome. Linking writes the identifier into both records' `linked_candidate_ids`, so the relationship is traversable from either side without a separate node type.

### The hire conversion

`candidate.hire` executes the Conversion Event Protocol precisely. The new employee's `employment_type`, `job_title` and `start_date` populate from the accepted Offer per [[VRS-F032_Offer_Management|VRS-F032]] and the OpenRole. **Compensation is entered fresh on the Employee node**, at Tier 1, never carried from a pipeline field.

### API contracts

```
openRole.create(title, seniorityLevel?, projectId?, hiringManagerId?,
                requiredSkillIds?, requisitionId?) -> { openRoleId }
openRole.close(openRoleId, reason)      -> { success }

candidate.create(fullName, email, source, openRoleId?, phone?, referralId?)
  -> { candidateId, possibleDuplicates }
candidate.linkDuplicate(candidateId, priorCandidateId) -> { success }

candidate.advanceStage(candidateId, newStage)   -> { success }
candidate.reject(candidateId, reason, detail?)  -> { success }
candidate.bulkAdvance(candidateIds, newStage)   -> { moved, failed }
candidate.bulkReject(candidateIds, reason)      -> { rejected }
candidate.hire(candidateId)                     -> { employeeId }

pipeline.board(openRoleId) -> {
  stages: { stage, candidates, medianDaysInStage }[]
}
candidate.history(candidateId) -> {
  transitions: { fromStage, toStage, at, by }[],
  priorApplications: { candidateId, roleTitle, outcome, at }[]
}
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | OpenRole and Candidate carry the schemas above |
| G02 | `requires_skill` edges from OpenRole are read identically by [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s engine. No second matching mechanism exists |
| G03 | `candidate.hire` follows the Conversion Event Protocol exactly. No hard deletion, `converted_from` preserves the link, every prior edge remains traversable |
| G04 | `filled_by` connects OpenRole to the winning Candidate only, set at hire |
| G05 | Stages are a fixed set. A workspace may disable a stage; it may not add one |
| G06 | Transitions move one stage at a time. Skipping is refused |
| G07 | `rejection_reason` is a fixed enum, required on rejection. Free text is optional and never substitutes for it |
| G08 | `stage_entered_at` resets on every transition. Time in stage and medians are computed live, never stored |
| G09 | Duplicate detection runs on every creation against every Candidate in the workspace regardless of status or age |
| G10 | Compensation is never stored on a Candidate. Offer terms are [[VRS-F032_Offer_Management|VRS-F032]]'s, at Tier 1 |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F028-S01 | OpenRole and Candidate schemas | Data |
| VRS-F028-S02 | Pipeline board and stage management | UI |
| VRS-F028-S03 | Duplicate detection and linking | Logic |
| VRS-F028-S04 | Structured rejection | Logic |
| VRS-F028-S05 | Bulk actions | UI |
| VRS-F028-S06 | Time-in-stage computation | Logic |
| VRS-F028-S07 | Hire conversion | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an open role with two required skills
**WHEN** it is saved
**THEN** two `requires_skill` edges exist and [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matching reflects them with no additional integration

---

**GIVEN** a candidate is added whose email matches someone rejected eight months ago
**WHEN** creation runs
**THEN** the prior record and its outcome surface before the addition completes, and linking makes both traversable from either side

---

**GIVEN** a candidate has been in Screening for nine days against a seven-day threshold
**WHEN** the board renders
**THEN** their card shows the day count in `attention`

---

**GIVEN** a recruiter selects thirty candidates and rejects them with one reason
**WHEN** the bulk action runs
**THEN** all thirty are rejected with that structured reason, each writes an audit entry, and each triggers [[VRS-F030_Candidate_Portal|VRS-F030]]'s status notification

---

**GIVEN** a rejection is attempted without a structured reason
**WHEN** it is submitted
**THEN** it is refused. Free-text detail alone is not sufficient

---

**GIVEN** a candidate is moved from Applied directly to Offer
**WHEN** the transition is attempted
**THEN** it is refused, naming the stages that must be passed through

---

**GIVEN** a candidate is hired
**WHEN** conversion executes
**THEN** an Employee exists, the Candidate is Converted rather than deleted, `converted_from` connects them, the full transition history remains traversable, and no compensation figure was carried from the pipeline

---

**GIVEN** an open role originating from an approved requisition
**WHEN** it is created
**THEN** title, seniority, skills and target start pre-fill from the requisition and `requisition_id` is set

---

## Non-Functional Requirements

- The pipeline board renders within 200ms for a role with 100 candidates
- Duplicate detection completes within 100ms against 5,000 candidate records from the local index
- Bulk actions across 50 candidates complete within 5 seconds with a determinate indicator
- Full functionality offline, including bulk actions, which queue and sync

---

## Security Considerations

- **Candidate follows its existing permission row**: Owner and HR Admin full, Manager read with pipeline visibility, Finance Admin and Team Member none.
- **A CV is an ordinary Tier 0 document.** No provenance elevation applies, and a candidate's CV is no more sensitive than the application it accompanies.
- **`rejection_detail` is never shown to the candidate**, per [[VRS-F030_Candidate_Portal|VRS-F030]]. It is the agency's internal assessment.
- **Duplicate detection searches every candidate regardless of age**, which means a rejection from three years ago surfaces. That is the intended behavior and it is also personal data retained for that period — [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s retention schedules govern how long candidate records are kept, and this feature does not override them.
- **Bulk rejection is the highest-volume personal-data operation in the product.** It is audited per candidate, not per batch, so that a single action affecting forty people leaves forty records.

---

## Out of Scope

- **Panel scheduling and structured scorecards** — [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]]
- **Candidate-facing status** — [[VRS-F030_Candidate_Portal|VRS-F030]]
- **Job posting and distribution** — [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]]
- **Offers, their approval and their terms** — [[VRS-F032_Offer_Management|VRS-F032]]
- **Talent pooling and re-engagement** — [[VRS-F033_Talent_Pool_and_Candidate_CRM|VRS-F033]]
- **Background checks** — [[VRS-F035_Background_Check_Integration|VRS-F035]]
- **Hiring analytics** — [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]]
- **Document generation of any kind.** [[VRS-F020_Universal_Contract_Builder|VRS-F020]] generates a contract after conversion

---

## Decisions Recorded

**This document replaces *Basic ATS Pipeline* and is materially larger.** What existed was an applicant tracker; the additions — duplicate detection, structured rejection, time in stage, bulk actions, cross-application history — are what make it a recruitment system and what make [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]]'s analytics possible at all.

**Stages are fixed with an option to disable, not to extend.** Same reasoning as [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]'s category set: an extensible stage model makes time-to-hire incomparable within a workspace over time, and across workspaces entirely, which forecloses [[VRS-F072_Agency_Benchmarking|VRS-F072]].

**Rejection reasons are a fixed enum.** Free text is retained for the humans and is never analyzed. Three recruiters writing *too junior*, *not enough experience* and *lacked seniority* have recorded one reason three ways, and a hiring analytics feature reading free text is a hiring analytics feature producing noise.

**Offer fields are removed from Candidate**, not deprecated, since neither this feature nor [[VRS-F032_Offer_Management|VRS-F032]] has shipped and no workspace holds data in them. Offers belong to a feature with an approval chain and a Tier 1 compensation figure, not as free text on a Tier 0 node.

**This document makes one change to [[VRS-F022_Encrypted_Document_Vault|VRS-F022]].** Document currently requires `employee_id`, which makes a candidate CV unstorable. Document gains `candidate_id` as an alternative owner, with **exactly one of the two required**. The alternative — a second document mechanism for candidates — would have duplicated encryption, scanning and retention for no benefit.

---

## Related Notes

- [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] — the requisition an open role originates from
- [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] — where roles are posted
- [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] — interviews and scorecards
- [[VRS-F032_Offer_Management|VRS-F032]] — offers
- [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] — the analytics this feature's structured data makes possible

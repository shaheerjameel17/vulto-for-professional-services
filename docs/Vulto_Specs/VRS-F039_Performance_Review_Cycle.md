---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F039
---

# VRS-F039 — Performance Review Cycle

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee and `managed_by`, the reviewer snapshotted at entry creation), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days, for due-date arithmetic), [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] (the application-layer gating precedent reused here for field-level write access), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where due assessments surface), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (ReviewCycle and ReviewEntry)
**Blocks:** [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] (a development goal originating from a review), [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] (which reads review history as a retention signal)

This document is the single source of truth for this feature.

---

## What It Is

A structured review period — self-assessment and manager assessment — on a defined cycle, with a single entry per employee per cycle rather than a scattering of documents and email threads that may not exist by the time anyone needs them.

---

## Problem It Solves

Reviews conducted over email or in a shared document have no consistent record, no enforced deadline and no reliable history. An employee's review from three cycles ago is wherever it happened to be saved, if it was saved.

That absence matters most at exactly the moments a review is worth having: a promotion proposal under [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] with no documented basis, a compensation decision that cannot be explained a year later, and a dispute where the agency's account of someone's performance exists only in one manager's memory.

---

## User-Facing Flows

### Opening a cycle

An HR Admin opens a cycle — *Q3 2026* — covering a period, with separate due dates for self and manager assessment.

An entry is created for every active employee, each **snapshotting their current manager** as the assigned reviewer at that moment.

### Self-assessment

An employee writes their own assessment on their own timeline up to the due date. It is their field to write; a manager cannot write it on their behalf, and **it is not visible to the manager until submitted.**

### Manager assessment

The snapshotted manager writes their own assessment and an overall rating — a separate field, on its own due date.

**The manager cannot see the self-assessment until it is submitted, and the employee cannot see the manager assessment until it is.** Two independent judgements, then a conversation, rather than one anchoring the other.

### Closing

Once both are submitted, or the due dates pass, the entry finalizes. A cycle closes once every entry within it reaches a terminal state.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Review cycles | Content + Panel | HR Admin's view of every cycle |
| My review | Content | The employee's own entry |
| Team reviews | Content | A manager's assigned entries |
| Cycle progress | Panel | Completion across a cycle |

### Layout and components

**My review** is a single page with two Sections stacked. *Your assessment* is a large Textarea with the due date stated and a word count. *Your manager's assessment* renders beneath, and before submission it shows only a line: *Available once submitted by both parties.*

That reciprocity is the point. An employee who can see their rating before writing their own assessment writes a different assessment, and a manager who can read the self-assessment first writes a different one too.

**Team reviews** is a Table for the manager: employee, self-assessment status Badge, their own status, due date, days remaining. Sorted by due date. Rows past due render `attention`.

**Cycle progress** shows two Progress bars — self-assessments submitted, manager assessments submitted — with counts in `mono`. An HR Admin chasing a cycle needs to know which half is lagging, and a single combined percentage conceals it.

**The rating** is five options rendered as distinct Cards rather than a Select, each with its own one-line description of what it means. A five-point scale where the labels are the only guidance produces ratings that mean different things to different managers, which makes the whole record less useful than no record.

### Keyboard

Standard bindings. `Cmd+Enter` submits an assessment, with a confirmation, since submission is one-way.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton sections. A draft assessment is never lost to a sync state |
| Restricted | An employee sees their own entries. A manager sees their assigned entries. Both are HR-restricted otherwise |
| Withheld | An unsubmitted counterpart assessment shows the reciprocity line, not an empty box |
| Overdue | Past due and unsubmitted renders `attention` and notifies through [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] |
| Empty | *No review cycles yet.* |
| Error | An attempt to write a field the caller does not own is refused at the application layer |

### Responsive

Works unchanged to 768px. Writing a self-assessment on a phone is uncommon but reading one is not.

---

## Technical Architecture

### ReviewCycle

Standard, Tier 0 — the cycle's configuration carries nothing about any person.

```
cycle_id:                UUID v4
workspace_id:            UUID
name:                    string, required
period_start_date:       date
period_end_date:         date
self_review_due_date:    date
manager_review_due_date: date
status:                  enum: Open, Closed

— Universal Node Conventions per VPS-A002 —
```

### ReviewEntry

HR-restricted, Tier 2 — it carries a manager's actual judgement about a specific person.

```
entry_id:                UUID v4
workspace_id:            UUID
employee_id:             UUID, FK to Employee — a direct field
cycle_id:                UUID, FK to ReviewCycle
reviewer_employee_id:    UUID — snapshotted from managed_by at creation,
                         never re-resolved
self_assessment_text:    text, nullable
self_assessment_submitted_at:    timestamp, nullable
manager_assessment_text: text, nullable
manager_rating:          enum: Unsatisfactory, NeedsImprovement,
                         MeetsExpectations, ExceedsExpectations, Outstanding
manager_assessment_submitted_at: timestamp, nullable
status:                  enum: Pending, SelfSubmitted, ManagerSubmitted, Finalized

— Universal Node Conventions per VPS-A002 —
```

### Why the reviewer is snapshotted

Re-resolving `reviewer_employee_id` from the current `managed_by` edge would silently reassign an in-progress review to someone who never saw the self-assessment or wrote the earlier draft.

Same historical-accuracy discipline as [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s rate cards, [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s frozen contract content and [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]]'s snapshotted tasks.

### Field-level write gating

[[VPS-A004_Graph_Permission_Layer|VPS-A004]] grants both the employee and the assigned manager write access to the same node. **Which fields either may write is enforced in application logic** — `self_assessment_text` for the employee, `manager_assessment_text` and `manager_rating` for the assigned manager.

The same precedent [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] established for its capacity override, rather than a permission row per field, which would be unmaintainable at this schema's size.

### Reciprocal disclosure

Neither assessment is readable by the other party until both are submitted. Enforced at the query layer, not by hiding a field the response already contained.

HR Admin and Owner retain full visibility throughout, as they do everywhere in this domain.

### API contracts

```
reviewCycle.create(name, periodStart, periodEnd, selfDue, managerDue)
  -> { cycleId, entriesCreated }
  // Creates an entry per active employee, snapshotting the current manager

reviewEntry.saveDraft(entryId, field, text)      -> { success }
  // Field ownership enforced at the application layer

reviewEntry.submitSelfAssessment(entryId, text)  -> { success }
reviewEntry.submitManagerAssessment(entryId, text, rating) -> { success }
reviewEntry.finalize(entryId)                    -> { success }
  // Requires both submitted, or an HR Admin override past due

reviewEntry.listForEmployee(employeeId) -> ReviewEntry[]
reviewEntry.listForManager(managerId)   -> ReviewEntry[]
reviewCycle.progress(cycleId)           -> {
  selfSubmitted, managerSubmitted, total
}
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | ReviewCycle and ReviewEntry carry the schemas above |
| G02 | `reviewed_in` and `part_of` connect the entry to Employee and ReviewCycle. No new edge type |
| G03 | `reviewer_employee_id` is snapshotted at creation and never re-resolved from a later `managed_by` change |
| G04 | Field-level write access is enforced in application logic, not a permission row per field |
| G05 | Neither assessment is readable by the counterpart until both are submitted. Enforced at query, not in the interface |
| G06 | A cycle's status becomes Closed once every entry reaches Finalized. Read-derived, not independently set |
| G07 | Due dates are stated as dates; any *days remaining* figure counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F039-S01 | ReviewCycle and ReviewEntry schemas | Data |
| VRS-F039-S02 | Entry creation and reviewer snapshotting | Logic |
| VRS-F039-S03 | Self-assessment | UI |
| VRS-F039-S04 | Manager assessment and rating | UI |
| VRS-F039-S05 | Cycle progress tracking | UI |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin opens a cycle
**WHEN** it is created
**THEN** an entry exists for every active employee with `reviewer_employee_id` set to their current manager

---

**GIVEN** an employee submits their self-assessment and the manager has not submitted
**WHEN** the manager opens the entry
**THEN** the self-assessment is visible, and the employee still cannot see the manager assessment

---

**GIVEN** neither party has submitted
**WHEN** either opens the entry
**THEN** each sees only their own field, and the counterpart shows the reciprocity line rather than an empty box

---

**GIVEN** an employee's manager changes mid-cycle
**WHEN** the entry is viewed
**THEN** `reviewer_employee_id` remains the manager snapshotted at creation

---

**GIVEN** an employee attempts to write into the manager assessment field
**WHEN** the write is attempted
**THEN** it is refused at the application layer, regardless of the node-level access both parties share

---

**GIVEN** both assessments are submitted
**WHEN** the entry finalizes
**THEN** both parties can read both, and once every entry finalizes the cycle closes

---

## Non-Functional Requirements

- Cycle creation and entry instantiation complete within 10 seconds for 150 employees
- Draft saves persist locally within 100ms; a draft is never lost to a connectivity change
- Full functionality offline for writing and submitting

---

## Security Considerations

- **ReviewEntry is HR-restricted, Tier 2.** A manager's written judgement about a person is among the more consequential records this product holds, and it is read in promotion decisions, disputes and terminations.
- **Reciprocal disclosure is a fairness property enforced technically.** An employee who sees their rating first writes a different self-assessment; a manager who reads the self-assessment first writes a different assessment. Both are worth preventing, and a convention would not.
- **A draft is private to its author until submitted, including from Owner.** The same reasoning as [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]]'s unsubmitted scorecards: a half-formed thought read before its author finished having it changes what people are willing to write down.
- **This feature never computes an average rating across a manager's reports**, and deliberately provides no calibration or forced-ranking mechanism. Both would turn a record of individual judgements into a comparative instrument, which is a different product with different consequences.

---

## Out of Scope

- **360-degree or peer feedback** — self and manager assessment only
- **Calibration across managers or forced ranking** — deliberately excluded, per above
- **Automatic compensation change on a rating** — [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]. A review informs a person, who proposes
- **Goal setting within the review** — [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]], which carries the provenance link
- **Review templates or competency frameworks per role.** One structure, so that a history is comparable across cycles and roles

---

## Decisions Recorded

**Reciprocal disclosure is added.** The previous specification withheld the self-assessment from the manager until submission but said nothing about the reverse, which meant an employee could read their rating before writing a word. That asymmetry favors the manager for no reason and produces a worse record from both sides.

**The rating options carry descriptions.** A five-point scale where the labels are the only guidance produces ratings that mean different things to different managers, which makes the aggregate record less useful than none.

**Cycle progress separates the two halves.** An HR Admin chasing a cycle needs to know whether employees or managers are lagging, and a combined percentage conceals it.

**Calibration and forced ranking remain permanently excluded** rather than deferred. Both convert a record of individual judgements into a comparative instrument, which changes what managers write and what the record is for.

---

## Related Notes

- [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] — development goals originating from a review
- [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] — the compensation change a review may inform
- [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] — the same private-until-submitted principle

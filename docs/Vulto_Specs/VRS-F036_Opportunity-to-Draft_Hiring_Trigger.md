---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Intelligence
aliases:
  - VRS-F036
---

# VRS-F036 — Opportunity-to-Draft Hiring Trigger

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (SkillGap, read not written), [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] (Requisition — the promotion path now runs through approval), [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (OpenRole), [[VRS-F007_Ghost_Resources|VRS-F007]] (GhostResource), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where a suggestion surfaces), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (DraftHiringRecord, and Pitch's status field)
**Extended by:** [[VRS-F051_Team_Capacity_Planner|VRS-F051]], which adds a fourth trigger source rather than inventing a second suggestion mechanism
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A reactive trigger watching signals already present in the graph and producing a **DraftHiringRecord** — a lightweight, dismissible suggestion that hiring may be needed, not a commitment.

An HR Admin reviews each and either promotes it into a Requisition per [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]], optionally creating a linked Ghost Resource in the same action, or dismisses it.

---

## Problem It Solves

A pitch closes on a Friday afternoon, everyone celebrates, and the *we need two more people for this* conversation happens a week later if someone remembers to have it — by which point the delivery timeline is tighter than it needed to be.

Separately, [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] already knows the exact moment a skill is genuinely unavailable anywhere in the agency. That fact sits recorded as a SkillGap, correctly, and nothing turns *the agency lacks this* into *someone should start recruiting for this* without a person noticing on their own initiative.

**This feature closes the distance between a signal already in the graph and the human decision to act on it.** It never decides; it makes sure the decision is put in front of someone.

---

## User-Facing Flows

### A pitch is won

The moment a Pitch reaches Won, a suggestion is created — generic by necessity, since no specific role is known yet. A nudge that this win may need capacity, worth a look.

### A capacity gap reaches real severity

When a SkillGap reaches High or Critical per [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s own computation, a suggestion is created with a specific title and seniority drawn from the gap, since that feature already knows exactly what is missing.

### Reviewing

Suggestions appear in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox and on a review list. Opening one shows its source — the won pitch, or the specific skill gap with its project and start date — and what it suggests.

### Promoting

**Promotion creates a Requisition, not an OpenRole directly.**

This is the substantive change from the previous specification. [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] now sits between a hiring intention and a live open role, with a budget and an approval gate. A suggestion that bypassed it into a directly-created OpenRole would route around the approval every other hiring path goes through — and the automated path is exactly the one that should not have a shortcut.

The HR Admin can additionally create a linked Ghost Resource in the same action, reflecting the planned capacity in the Bench Forecast immediately.

### Dismissing

A suggestion that does not reflect a real need — existing staff can absorb it, the pitch was smaller than it looked — is dismissed with a reason, closing it honestly rather than leaving it to expire.

### Automatic dismissal

Where the SkillGap behind a still-Suggested record resolves on its own per [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s auto-resolution, the suggestion dismisses itself with a distinguishable fixed reason.

**A stale suggestion left lingering is worse than none**, because a review list full of resolved items is a review list people stop opening.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Suggestions | Content + Panel | The review list |
| Suggestion card | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox | Actionable in place |
| Promote | Modal | Requisition and optional Ghost |

### Layout and components

**Suggestions** is a Table: suggested role, trigger source Badge, source detail, created date, days open. Sorted by source severity then age — a Critical skill gap outranks a won pitch, because one has a dated project behind it and the other is a general nudge.

The Panel shows the full source context. For a capacity gap: the skill, the required proficiency, the project, its start date, and the gap's severity. For a won pitch: the pitch name and client, Tier 0 fields only.

**The promote Modal** collects what [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] requires — justification, plan, target start, compensation range — pre-filled where the suggestion knows it. The justification is pre-filled with the source: *Skill gap: Expert iOS required for Halo Phase 2, starting 14 March.* A justification written by the system from real data is better than one a person types in a hurry, and remains editable.

A **Create linked Ghost Resource** Switch sits beneath, defaulting on where the suggestion came from a capacity gap with a known start date, and off otherwise.

**Dismissal** requires a reason, chosen from a short fixed set — *Existing capacity absorbs it*, *Not hiring for this*, *Already recruiting*, *Other* with free text — because a free-text-only reason produces a hundred unanalysable sentences, and [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] should eventually be able to say how often the system's suggestions were useful.

### Keyboard

Standard Inbox and list bindings. `P` promotes a focused suggestion; `D` dismisses.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Owner and HR Admin full. Manager reads. Finance Admin and Team Member none |
| Auto-dismissed | Rendered in the dismissed list with its fixed reason, visually distinct from a human dismissal |
| Empty | *No hiring suggestions.* Stated plainly, not as an absence to correct |
| Error | Promoting a suggestion whose source gap has since resolved warns first, naming the resolution |

### Responsive

Drops `source detail` below 1280px.

---

## Technical Architecture

### DraftHiringRecord

Standard, Tier 0.

```
draft_id:                  UUID v4
workspace_id:              UUID
trigger_source:            enum: WonPitch, CapacityGap, CapacityForecast, Manual
source_pitch_id:           UUID, nullable — WonPitch
source_skill_gap_id:       UUID, nullable — CapacityGap
source_forecast_quarter:   string, nullable — CapacityForecast, e.g. "2027-Q1"
source_skill_category:     string, nullable — CapacityForecast
suggested_title:           string, required
suggested_seniority_level: enum per VRS-F002, nullable
suggested_project_id:      UUID, nullable
status:                    enum: Suggested, Promoted, Dismissed
promoted_to_requisition_id: UUID, nullable
dismissal_reason:          enum: CapacityAbsorbs, NotHiring, AlreadyRecruiting,
                           SourceResolved, Other — required on dismissal
dismissal_detail:          text, nullable

— Universal Node Conventions per VPS-A002 —
```

`created_by` is `'system'` for every automatic trigger.

### Trigger conditions

**A won Pitch triggers unconditionally.** Every pitch reaching Won produces a suggestion, deliberately liberal rather than guessing whether hiring is warranted. That judgement belongs to the person reviewing it, not to a heuristic here.

**A SkillGap triggers at High or Critical only.** A Low or Medium gap is frequently resolved by existing capacity shifting before it becomes urgent, and suggesting a hire for every one of them would train people to dismiss the list unread.

### The promotion chain

Promotion calls [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]'s `requisition.raise`, passing the suggestion's title, seniority, project and a generated justification.

Where a Ghost is also requested, [[VRS-F007_Ghost_Resources|VRS-F007]]'s `ghostResource.create` runs with the resulting requisition's eventual OpenRole linked on approval — meaning the Ghost exists immediately for forecasting, and its link to a real role is established when the requisition is approved.

**This feature contributes the trigger and the chaining. It adds no capability to either feature it calls.**

### API contracts

```
draftHiringRecord.evaluate(pitchId?, skillGapId?) -> { draftId? }
  // Internal. Reactive on a Pitch reaching Won, or a SkillGap reaching
  // High or Critical. Exposed for testability

draftHiringRecord.promote(draftId, createGhostResource, ghostProjectedStartDate?)
  -> { requisitionId, ghostResourceId? }
  // Calls VRS-F027's requisition.raise, not VRS-F028's openRole.create

draftHiringRecord.dismiss(draftId, reason, detail?) -> { success }
draftHiringRecord.listActive(workspaceId)          -> DraftHiringRecord[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | DraftHiringRecord carries the schema above |
| G02 | At most one Suggested record per source. A repeat evaluation of an already-suggested source updates nothing rather than duplicating |
| G03 | Promotion creates a Requisition through [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]], never an OpenRole directly. The approval gate is not bypassed by the automated path |
| G04 | A Suggested record whose source SkillGap resolves is dismissed automatically with reason `SourceResolved`, distinguishable from a human dismissal |
| G05 | A won-pitch suggestion has no automatic dismissal. Pitch does not transition out of Won in the ordinary course |
| G06 | This feature reads Pitch's Tier 0 fields only. It never reads deal value, win probability or margin terms |
| G07 | Dismissal requires a reason from the fixed enum. Free text is optional detail, never the reason itself |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F036-S01 | DraftHiringRecord schema | Data |
| VRS-F036-S02 | Trigger evaluation | Logic |
| VRS-F036-S03 | Review surface | UI |
| VRS-F036-S04 | Promotion chain to requisition and Ghost | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a Pitch reaches Won
**WHEN** evaluation runs
**THEN** a suggestion is created with source WonPitch and a title referencing the pitch by name, using Tier 0 fields only

---

**GIVEN** a SkillGap reaches Critical
**WHEN** evaluation runs
**THEN** a suggestion is created with title and seniority drawn from the gap and the project set

---

**GIVEN** an HR Admin promotes a suggestion with a Ghost requested
**WHEN** promotion executes
**THEN** a Requisition exists through [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] with a pre-filled justification naming the source, and a Ghost Resource exists reflecting the planned capacity

---

**GIVEN** a suggestion is promoted
**WHEN** the resulting requisition is reviewed
**THEN** it routes through the same approval chain as any manually raised requisition, with no shortcut

---

**GIVEN** a Suggested record's source gap resolves on its own
**WHEN** resolution occurs
**THEN** the suggestion is dismissed automatically with `SourceResolved`, distinguishable from a human dismissal, with no action required

---

**GIVEN** a dismissal is submitted without a reason
**WHEN** it is attempted
**THEN** it is refused

---

**GIVEN** the same Pitch is evaluated twice
**WHEN** the second evaluation runs
**THEN** no second suggestion is created

---

## Non-Functional Requirements

- Evaluation fires within 30 seconds of a Pitch reaching Won or a SkillGap reaching High or Critical
- The review list resolves within 200ms from the local graph
- Full functionality offline for reviewing, promoting and dismissing

---

## Security Considerations

- **DraftHiringRecord follows Candidate's permission shape**: Owner and HR Admin full, Manager read, Finance Admin and Team Member none. Standard's direct-reports framing does not apply to a record that is not about an existing employee.
- **This feature reads Pitch's Tier 0 fields only.** Deal value, win probability and margin terms are irrelevant to whether a hiring suggestion should exist, and reading them would put commercial data into a Tier 0 suggestion visible to every recruiter.
- **A suggestion carries no compensation figure.** The range is entered at the requisition, where it is Tier 1.

---

## Out of Scope

- **Judging whether a won pitch actually requires hiring** — deliberately left to the person reviewing, not a heuristic
- **Sources beyond the four enumerated** — a need identified outside the graph is a Manual record or, more directly, a requisition raised in [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]
- **Notification delivery** — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]. This feature produces the record
- **Creating an OpenRole directly.** Permanently out of scope; the approval gate is not optional for an automated path

---

## Decisions Recorded

**Promotion now creates a Requisition rather than an OpenRole.** [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] did not exist when this feature was first specified, and a system-generated suggestion promoting straight into a live open role would route around the budget and approval gate every manual hiring path goes through. The automated path is the one that most needs the gate, not the one that should skip it.

**Dismissal reasons become a fixed enum.** A free-text-only reason produces unanalysable sentences, and [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] should eventually be able to answer how often this feature's suggestions were useful — which is the only way to know whether the trigger thresholds are right.

**The justification is pre-filled from the source.** A justification generated from real data — the skill, the project, the start date — is better than one typed in a hurry, and remains editable.

**The review list sorts by source severity, not age.** A Critical skill gap with a dated project outranks a general nudge from a won pitch.

---

## Related Notes

- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the SkillGap this feature watches
- [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] — the requisition promotion creates
- [[VRS-F007_Ghost_Resources|VRS-F007]] — the Ghost Resource optionally created alongside
- [[VRS-F051_Team_Capacity_Planner|VRS-F051]] — which adds the fourth trigger source

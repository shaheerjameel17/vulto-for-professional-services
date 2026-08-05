---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F040
---

# VRS-F040 — Career Pathing and Development Tracker

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee and `has_skill`), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (**the proficiency ordering and matching comparison, reused directly rather than redefined**), [[VRS-F039_Performance_Review_Cycle|VRS-F039]] (ReviewEntry, the origin of a development goal), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (CareerPath, CareerMilestone and DevelopmentGoal)
**Blocks:** Nothing structurally. [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] reads milestone stagnation as a retention signal.

This document is the single source of truth for this feature.

---

## What It Is

A career track — Engineering, Design, Client Services — made of ordered milestones, each defined by the skills required to reach it, checked against the same skill data [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] already matches projects against.

Alongside the formal path, individual development goals, some originating from a review conversation, most not, tracked toward a target date.

---

## Problem It Solves

*What does it actually take to get to Senior* is a question most agencies answer informally and inconsistently — whatever the last conversation with a manager happened to say.

The cost is not only fairness, though that matters. It is that a person who cannot see a target cannot work toward one, and an agency that cannot state its own progression criteria loses people to firms that can. [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] treats milestone stagnation as a retention signal precisely because it is one.

Making the requirement structural — defined once per milestone, checked against skill data already maintained — gives every employee the same visible target rather than a moving one that depends on who they ask.

---

## User-Facing Flows

### Defining a path

An HR Admin or Owner defines a path as an ordered sequence of milestones, each carrying `requires_skill` edges through the same picker [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] and [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] already use.

### Choosing a target

An employee sets their own `targeting` edge to a milestone. **A self-directed choice, no approval required** — declaring an aspiration is not something a person should need permission for.

### Checking progress

At any point the employee or their manager sees which required skills are met and which are not, using [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s exact proficiency comparison rather than a second definition of what meeting a requirement means.

### Reaching a milestone

When every required skill is met, the feature surfaces that the employee **now qualifies** — a suggestion, not an automatic promotion. Confirming the transition is a deliberate Manager or HR Admin action.

An objective signal, a human decision, which is the same restraint this product applies everywhere a significant status change is involved.

### Development goals

A goal can be set independently, or originate from a review conversation per [[VRS-F039_Performance_Review_Cycle|VRS-F039]], in which case the provenance is preserved.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Career paths | Content + Panel | Definition. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| My path | Content | The employee's own progression |
| Team progression | Content | A manager's reports |
| Goals | Section on the employee profile | Development goals |

### Layout and components

**My path** is the surface that matters. The path renders as a horizontal sequence of milestone nodes — achieved, current, targeted, beyond — with the current position marked and the targeted one highlighted in `brand-500`.

Beneath, for the targeted milestone, a **requirements checklist**: each required skill with its needed level, the employee's actual level, and a `success` check or an open circle. Met requirements collapse; unmet ones expand with the gap stated — *React: Senior required, currently Intermediate.*

That specificity is the whole feature. *You need more experience* is what an informal conversation produces; *you need React at Senior and you are at Intermediate* is something a person can act on this quarter.

Where every requirement is met, a `success` Inline Alert states that they qualify and that confirmation rests with their manager. **It is not a button the employee can press.**

**Team progression** is a Table for the manager: employee, current milestone, target, requirements met as a fraction, and a `Qualifies` Badge where applicable. Sorted with qualifying reports first — a person who has met every stated requirement and not been told is a retention problem forming.

**Goals** is a list: title, target date, status Badge, and where present a link to the originating review. Overdue goals render `attention`.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | An employee sees their own path and goals. A manager sees their reports'. Paths themselves are readable by everyone |
| Empty | *No career paths defined.* for an HR Admin; for an employee, a line stating that paths have not been set up rather than an empty diagram |
| Qualifying | `success` alert stating qualification and where confirmation sits |
| Error | An employee attempting to confirm their own milestone is refused |

### Responsive

The path sequence becomes vertical below 1024px. The requirements checklist is unchanged.

---

## Technical Architecture

### CareerPath and CareerMilestone

Both Standard, Tier 0.

```
career_path_id:  UUID v4
workspace_id:    UUID
name:            string, required
description:     text, nullable
is_active:       boolean, default true

— Universal Node Conventions per VPS-A002 —
```

```
milestone_id:     UUID v4
workspace_id:     UUID
career_path_id:   UUID, FK
title:            string, required
milestone_order:  integer
description:      text, nullable

— Universal Node Conventions per VPS-A002 —
```

Skill requirements live entirely on `requires_skill`, carrying `proficiency_level_required` exactly as a project's requirement does. **No parallel field for the same concept.**

### DevelopmentGoal

```
goal_id:                UUID v4
workspace_id:           UUID
employee_id:            UUID, FK to Employee — a direct field
title:                  string, required
description:            text, nullable
target_date:            date, nullable
source_review_entry_id: UUID, nullable, FK to ReviewEntry
status:                 enum: Active, Achieved, Abandoned

— Universal Node Conventions per VPS-A002 —
```

### The two edges

**`at_milestone`** follows single-active-with-history: at most one active edge per employee per path, carrying `achieved_at`. A change closes the prior edge and creates a new one, full progression preserved.

**`targeting`** is replaced outright with no history. An aspiration that changed is not a fact worth preserving the way an achievement is.

### Qualification reuses [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]

`checkProgress` runs the identical comparison: `has_skill.proficiency_level` must meet or exceed each `requires_skill.proficiency_level_required`, ordered Beginner, Intermediate, Senior, Expert.

This feature does not reimplement the ordering or the comparison. It calls the same logic against a different source of requirements — which is why [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] owns Skill's schema and the ordering, and why a change to either propagates here automatically rather than needing to be mirrored.

### API contracts

```
careerPath.create(name, description?) -> { careerPathId }
careerMilestone.create(careerPathId, title, milestoneOrder, requiredSkills)
  -> { milestoneId }

employee.setTargeting(employeeId, milestoneId) -> { success }
  // Self-directed. Replaces any existing targeting edge

careerMilestone.checkProgress(employeeId, milestoneId) -> {
  metRequirements: { skillId, required, actual }[],
  unmetRequirements: { skillId, required, actual }[],
  isQualified: boolean
}
  // Reuses VRS-F013's comparison exactly

employee.confirmMilestone(employeeId, milestoneId) -> { success }
  // Manager for direct reports, HR Admin or Owner. Sets at_milestone,
  // closing any prior active edge for the same path

careerMilestone.listQualifyingReports(managerId) -> {
  employeeId, employeeName, milestoneId, milestoneTitle, qualifiedSince
}[]
  // A bulk wrapper over checkProgress across a manager's reports.
  // Introduces no new qualification logic

developmentGoal.create(employeeId, title, description?, targetDate?,
                       sourceReviewEntryId?) -> { goalId }
developmentGoal.updateStatus(goalId, status) -> { success }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | The three node types carry the schemas above |
| G02 | `at_milestone` follows single-active-with-history carrying `achieved_at`. `targeting` is replaced outright with no history |
| G03 | Qualification reuses [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s proficiency comparison exactly. No second definition of meeting a requirement exists |
| G04 | `at_milestone` is set only through `employee.confirmMilestone`, a Manager or HR Admin action. An employee sets only their `targeting` aspiration |
| G05 | `source_review_entry_id` is captured at creation and never retroactively attached |
| G06 | `listQualifyingReports` is a bulk wrapper introducing no new qualification logic |
| G07 | `qualifiedSince` is computed from the date the last unmet requirement was satisfied, so a person qualifying for six months is distinguishable from one qualifying yesterday |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F040-S01 | CareerPath and CareerMilestone configuration | Data |
| VRS-F040-S02 | Targeting and progress checking | Logic |
| VRS-F040-S03 | Milestone confirmation | Logic |
| VRS-F040-S04 | Development goal tracking | UI |

---

## Feature Acceptance Criteria

**GIVEN** a milestone requires Senior React and Intermediate System Design
**WHEN** an employee holds Expert React and Senior System Design
**THEN** `checkProgress` returns qualified, both requirements met at or above the required level

---

**GIVEN** an employee holds Intermediate React against a Senior requirement
**WHEN** progress is checked
**THEN** the unmet requirement states both the required and the actual level, not merely that it is unmet

---

**GIVEN** an employee sets their own targeting edge
**WHEN** it is saved
**THEN** it succeeds with no approval, and any prior targeting edge is replaced

---

**GIVEN** an employee qualifies for their targeted milestone
**WHEN** they attempt to set their own `at_milestone` edge
**THEN** it is refused. Only a Manager or HR Admin confirms

---

**GIVEN** a Manager confirms a milestone
**WHEN** it is saved
**THEN** the prior edge closes, a new one is created with `achieved_at`, and full progression history remains traversable

---

**GIVEN** a report has qualified for their target and not been confirmed for four months
**WHEN** the manager's team progression view renders
**THEN** they appear first with `qualifiedSince` stating the duration

---

**GIVEN** a goal is created during a review conversation
**WHEN** it is saved with the review entry set
**THEN** that provenance is preserved and shown alongside the goal

---

## Non-Functional Requirements

- Progress checking resolves within 200ms from the local graph
- `listQualifyingReports` resolves within 500ms across up to 20 direct reports
- Full functionality offline

---

## Security Considerations

- **Milestone confirmation is gated to Manager or HR Admin, never the employee.** Self-directed target-setting and manager-confirmed achievement are different actions with different trust requirements, and keeping them structurally separate prevents one role from doing both.
- **CareerPath and CareerMilestone are readable by every workspace member.** An employee must be able to see the criteria that govern their own progression, and a progression framework visible only to managers is a framework that does not do its job.
- **A development goal is visible to the employee, their manager and HR Admin.** Goals frequently name a weakness, and a goal reading *improve confidence in client meetings* is not something a colleague should encounter.
- **`qualifiedSince` makes an uncomfortable fact visible**, deliberately. An employee who met every stated requirement six months ago and has not been confirmed is a fact the agency should have to look at.

---

## Out of Scope

- **Automatic promotion or compensation change on reaching a milestone** — [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]. This feature surfaces qualification and records confirmation
- **Cross-path equivalence** — each path stands alone. This feature does not assert that a Senior Designer and a Senior Engineer are formally equivalent
- **Automatic goal suggestion from a skill gap** — goals are set deliberately, not generated
- **Skill requirements beyond `requires_skill`** — a milestone is defined by skills, not by tenure, headcount managed or revenue. Those are real criteria in some firms and they are not modeled here, because encoding them would make the path a formula rather than a framework

---

## Decisions Recorded

**`qualifiedSince` is added**, and it is the most consequential addition. The previous specification could say someone qualifies but not for how long, which means the most common failure of a progression framework — a person meeting every stated criterion and hearing nothing — was invisible. The manager view now sorts on it.

**Unmet requirements state both levels.** *React: Senior required, currently Intermediate* is actionable; *React: not met* is not, and the difference is whether the framework changes anyone's quarter.

**Paths are readable by everyone.** The previous specification did not say, and a progression framework visible only to managers fails at its stated purpose.

**Tenure and non-skill criteria are excluded deliberately.** Some firms genuinely require *two years at level* or *has managed a team*, and modeling those would turn the path into a formula that produces automatic entitlement — which is precisely why milestone confirmation is a human decision here.

---

## Related Notes

- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the proficiency comparison reused here
- [[VRS-F039_Performance_Review_Cycle|VRS-F039]] — the review a goal may originate from
- [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] — the compensation change a confirmed milestone may prompt
- [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] — which reads milestone stagnation as a retention signal

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F057
---

# VRS-F057 — Probation Review Intelligence

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (probation status and the decision action this feature surfaces context for but never duplicates), [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] (onboarding completion), [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (timesheet anomalies during the window), [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] (skills gained), [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] (**the compounding pattern, computed there, not here**), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (ProbationCheckIn)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What this does not do

[[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] owns the decision mechanism entirely — Confirmed, Extended, Terminated — and the transitions view that surfaces when a review is due. **This feature rebuilds none of it.**

What it adds is the context a manager or HR Admin sees at the moment they are about to make that decision, so a routine confirmation is not made on memory alone.

---

## The gap this found, and the one place it needed [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]

**The gap.** By the time a ninety-day probation decision comes due, [[VRS-F039_Performance_Review_Cycle|VRS-F039]]'s first formal review cycle frequently has not run — there is often no structured assessment on record at all for a hire this new.

A manager forming a probation judgement has been relying on memory of the last three months, which is exactly the failure this feature exists to prevent. **Nothing in this product let a manager write down an observation as it happened.** ProbationCheckIn exists precisely so the context available at decision time is not limited to whatever they still remember.

**The one place this needed [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]].** Noticing that several independently mild concerns — an overdue onboarding task, a timesheet anomaly, a flagged note — are all true of the same probationary employee at once is exactly the compounding pattern Standing Rule 7 reserves for that feature alone.

This feature does not compute it. It triggers an Insight type there, with the same scrutiny the original three received rather than a lesser bar for arriving later.

---

## What It Is

A context view, surfaced exactly when [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] shows a probation review is due: onboarding completion, timesheet consistency during the window, skills gained, the manager's own check-in notes logged along the way, and — where the pattern genuinely warrants it — [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s flagged concern.

---

## Problem It Solves

A probation decision made three months after someone started, with nothing but memory to go on, **tends to default to confirmation** — not because the hire was right, but because nobody has the specific facts in front of them to make a considered call either way.

That default is expensive in both directions. A confirmed hire who should have been extended costs the agency months. An extended probation for someone who was doing fine costs a person's confidence and frequently their tenure.

This puts the actual facts in front of the person deciding, at the moment they need them, without asking them to open four other screens.

---

## User-Facing Flows

### Logging a check-in along the way

A manager writes a brief note about a probationary report at any point in the window — a sentence or two, optionally flagged as a concern worth a closer look.

**Seconds, not minutes**, and meant to happen when something is fresh rather than reconstructed months later.

### Opening the review context

When a review comes due: onboarding completion with any overdue tasks, timesheet consistency and any anomalies during the window, skills gained through certification or training, every check-in in order, and — only where the pattern actually fired — a clearly labeled concern naming exactly which conditions triggered it.

### Making the decision

Through [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s own action, unchanged. **This feature's job ends at providing the context.**

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Review context | Panel, from [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s transitions view | The context |
| Log check-in | Modal, from the employee profile | Fast entry |

### Layout and components

**The Panel** is four Sections in a deliberate order: check-ins first, then onboarding, then timesheet consistency, then skills gained.

**Check-ins lead because they are the only human observation on the screen**, and burying a manager's own contemporaneous note beneath three computed metrics would invert what actually informs the decision. They render chronologically with dates, flagged ones carrying an `attention` left border.

Onboarding shows a completion fraction and names any overdue task. Timesheet consistency shows weeks submitted on time against weeks late, and any anomaly flags with their dates. Skills gained lists each with its source.

Where [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s Insight fired, it renders at the top as an Inline Alert naming its constituent conditions — **the only element permitted above the check-ins**, because a compounding concern is the one thing a reader should see before anything else.

**The Panel offers no decision action.** The three actions live in [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s own Panel, and a decision reachable from a context view would let someone confirm a probation from a screen designed to inform rather than to commit.

**Log check-in** is a Textarea and a concern Switch. Nothing else. A form with five fields is a form nobody fills in during a busy week, and the entire value here rests on it being written when the observation is fresh.

### Keyboard

`Cmd+Enter` saves a check-in. Standard bindings elsewhere.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton sections |
| Restricted | The probationary employee has no access. Manager, HR Admin and Owner only |
| Empty | *No check-ins logged.* stated plainly — an absence of notes is itself worth seeing at decision time |
| Error | A check-in for a non-probationary employee is refused |

### Responsive

Works unchanged. Logging a check-in works at 375px, deliberately — the observation is frequently made away from a desk.

---

## Technical Architecture

### The ProbationCheckIn schema

HR-restricted, Tier 2.

```
check_in_id:        UUID v4
workspace_id:       UUID
employee_id:        UUID, FK to Employee — a direct field
manager_id:         UUID, FK to Employee — the logging manager
note_text:          text
flagged_as_concern: boolean, default false

— Universal Node Conventions per VPS-A002 —
```

### The context composition

`probationReview.getContext` **composes; it does not interpret.** Onboarding from [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]], timesheet data from [[VRS-F010_Timesheet_Speed-Run|VRS-F010]], skills from [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]], check-ins from this feature's own records, and where present [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s Insight displayed exactly as computed — never re-derived or restated.

### The probation window

Every metric is scoped to the window between the employee's start date and their probation end date, counted in working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].

This matters for timesheet consistency specifically: *three weeks late out of twelve* means something different from *three out of six*, and a window containing a long holiday period has fewer submittable weeks than the calendar suggests.

### API contracts

```
probationCheckIn.create(employeeId, noteText, flaggedAsConcern?) -> { checkInId }
  // The employee's assigned manager, HR Admin or Owner.
  // Refused for a non-probationary employee

probationReview.getContext(employeeId) -> {
  window: { startDate, probationEndDate, workingDaysElapsed, workingDaysTotal },
  checkIns: ProbationCheckIn[],
  onboarding: { completed, total, overdue: { title, dueDate }[] },
  timesheetConsistency: { weeksOnTime, weeksLate, anomalies: { weekStart, reason }[] },
  skillsGained: { skillName, proficiencyLevel, source }[],
  concernInsight: Insight | null
}
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | ProbationCheckIn carries the schema above. `checked_in_on` connects it to Employee |
| G02 | `getContext` composes from four sources plus this feature's own check-ins. It computes no interpreted pattern itself |
| G03 | The compounding pattern is computed entirely within [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]. This feature displays it and never recreates its logic |
| G04 | Check-in creation is restricted to the employee's assigned manager, HR Admin or Owner. The probationary employee has no access |
| G05 | Every metric is scoped to the probation window, counted in working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| G06 | This feature exposes no decision action. The decision is made through [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F057-S01 | ProbationCheckIn logging | Data |
| VRS-F057-S02 | Context composition | Logic |
| VRS-F057-S03 | Concern pattern display | UI |

---

## Feature Acceptance Criteria

**GIVEN** a manager logs a check-in flagged as a concern
**WHEN** the context is later opened
**THEN** it appears chronologically with the others, clearly marked, in the section above every computed metric

---

**GIVEN** an employee has an overdue onboarding task, an active timesheet anomaly, and a flagged check-in, all within the window
**WHEN** the context opens
**THEN** [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s Insight appears at the top naming all three conditions

---

**GIVEN** only one of those three is true
**WHEN** the context opens
**THEN** no Insight appears, the individual fact remains visible in its own section, and the pattern did not fire

---

**GIVEN** the probation window contains a two-week holiday period
**WHEN** timesheet consistency is computed
**THEN** the total submittable weeks reflect working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], not a calendar count

---

**GIVEN** the probationary employee attempts to view their own check-ins
**WHEN** the request is made
**THEN** it is refused. These are the manager's working notes, not a shared review

---

**GIVEN** no check-ins were logged during the whole window
**WHEN** the context opens
**THEN** it says so plainly, since an absence of observations is itself relevant at decision time

---

**GIVEN** a decision is made after reviewing
**WHEN** it is recorded
**THEN** it goes through [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s own action, from that feature's own surface

---

## Non-Functional Requirements

- The full context composes within 500ms from the local graph
- Logging a check-in completes within 200ms
- Full functionality offline

---

## Security Considerations

- **ProbationCheckIn is deliberately withheld from the employee it concerns.** These are a manager's working, sometimes preliminary observations, not a finalized shared assessment — the same distinction [[VRS-F039_Performance_Review_Cycle|VRS-F039]] draws between an in-progress and a submitted review, applied to a lighter record.
- **The compounding pattern lives in [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] on purpose.** Building it here would have quietly reproduced exactly the cross-signal reasoning Standing Rule 7 concentrates in one reviewed place, and it would have been the easiest place in the whole set to do so without anyone noticing.
- **A flagged check-in is a consequential record.** Written in seconds, read at a decision that may end someone's employment, and never seen by its subject. It is Tier 2, HR-restricted, and audited on access like any other Tier 2 record — but the honest position is that its weight at decision time exceeds the care with which it was written, and a manager should know that when writing one.

---

## Out of Scope

- **Recording the probation decision** — [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s action, unchanged
- **Any concern condition beyond the three [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] checks** — a fourth is a change to that document with the same scrutiny, not a setting here
- **A formal performance review during probation** — [[VRS-F039_Performance_Review_Cycle|VRS-F039]]'s cycle, where it happens to run, is read as skills or ratings data rather than restructured into a probation-specific format
- **Showing check-ins to the employee at any point, including after confirmation.** A permanent exclusion. A note written to inform a decision is not a note written to be read by its subject, and disclosing it afterwards would change what managers are willing to write

---

## Decisions Recorded

**Check-ins lead the context view**, above every computed metric. They are the only human observation on the screen, and burying a manager's contemporaneous note beneath three metrics inverts what actually informs the decision.

**An absence of check-ins is stated plainly.** A manager who logged nothing across a whole probation window is a fact worth seeing at the moment they are asked to decide, and an empty section that renders as nothing conceals it.

**The window is counted in working days.** *Three weeks late out of twelve* and *three out of six* are different facts, and a window containing a holiday period has fewer submittable weeks than the calendar implies.

**No decision action appears here.** A decision reachable from a context view would let someone confirm a probation from a screen designed to inform rather than to commit.

**Check-ins are permanently withheld from their subject, including after confirmation.** Disclosing them afterwards would change what managers are willing to write, which would degrade the record this feature exists to create.

---

## Related Notes

- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — the decision this feature informs
- [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] — where the compounding pattern is computed
- [[VRS-F039_Performance_Review_Cycle|VRS-F039]] — the same private-until-submitted principle

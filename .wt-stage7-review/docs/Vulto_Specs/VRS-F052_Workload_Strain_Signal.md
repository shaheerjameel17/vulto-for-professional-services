---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F052
---

# VRS-F052 — Workload Strain Signal

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (TimesheetEntry and the overtime threshold, reused not redefined), [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] (the near-capacity threshold, reused), [[VRS-F018_Leave_Policy_Engine|VRS-F018]] and [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] (approved leave history), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — every window here is counted in them), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (BurnoutAlert), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the sweep scheduler)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## The name, corrected

This was previously *Burnout Predictor*. Both words were wrong.

**It predicts nothing** — it is three rules-based conditions evaluated against recorded facts, not a trained model. **And it does not detect burnout**, which is a clinical state this product has no instrument to assess and no business asserting.

What it actually does is notice a sustained workload pattern, which is a real and useful thing to notice, and which a manager can act on without anyone having diagnosed anybody. The node type keeps its registered name for schema continuity; the feature is renamed to describe what it does.

This matters beyond pedantry. A signal labeled *burnout* invites a manager to open a conversation with a conclusion already attached to it, and the conversation that follows is worse for it.

---

## The boundary this feature must not cross

Three retention-adjacent signals exist in this product, and the lines between them are deliberate.

**This feature reads objective workload only** — hours logged, assignment load, leave taken — and is visible to managers. **[[VRS-F053_Retention_Risk_Indicator|VRS-F053]]** is Owner and HR Admin only, a different access rule for a different kind of signal. **[[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]** is the subjective, self-reported layer, Tier 3, invisible even to Owner.

This feature never reads anything from that third domain, and never will. Conflating an objective workload pattern with a person's private self-reported state would quietly break the guarantee that architecture was built around.

**Every signal here traces to data that already exists for an operational reason unrelated to wellness** — timesheets, assignments, leave — never to anything an employee confided.

---

## What It Is

A composite signal computed from three independent objective conditions — sustained overtime, sustained high utilization, and an extended period with no leave taken — any combination of which produces an alert visible to the employee's manager.

It reuses two thresholds this product already established rather than inventing new definitions of the same concepts.

---

## Problem It Solves

A manager who sees someone quietly working late for weeks, with two active assignments neither of them realized added up to more than full capacity, and no leave taken in months, is usually the last to notice — because none of those three facts individually looks alarming, and nobody is looking at all three together.

This feature does the looking.

---

## User-Facing Flows

### The signal appearing

A manager sees an indicator against a direct report **naming which conditions triggered and for how long** — *four consecutive weeks exceeding expected hours* — never a vague at-risk label with no stated basis.

### Reviewing and clearing

Opening it shows the underlying data plainly: the actual weeks, the actual figures. The manager checks in as they see fit and clears the signal with an optional note.

### Reappearance

Clearing does not suppress future evaluation. If the pattern continues or a different condition triggers, a new signal appears. **A standing pattern watch, not a one-time check.**

---

## Interface Specification

### Screens

| Surface | Location | Purpose |
|---|---|---|
| Signal card | [[VRS-F049_Manager_Dashboard|VRS-F049]]'s queue | The manager's view |
| Signal detail | Panel | The underlying data |

### Layout and components

**The card** states the employee, the conditions in plain language, and how long each has held. Severity is expressed by count — one condition, two, three — rendered as a `subtle` Badge. **Never in `danger`**, per [[VPS-D001_Design_Foundations|VPS-D001]]: a person working hard is not a failure state, and red would frame it as one.

**The detail Panel** is deliberately unglamorous: a table of the actual weeks and figures behind each triggered condition. Hours logged against hours expected, per week. Combined allocation, per week. Days since last approved leave, with the date.

**No narrative, no interpretation, no recommendation.** The manager reads the same facts the rule read and draws their own conclusion. A panel that said *Priya may be at risk of burnout* would be asserting something this feature cannot know, and would shape a conversation that should start open.

The clear action carries an optional note and one line beneath it: *This does not stop the pattern being noticed again.*

### Keyboard

Standard queue bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Card renders from local state |
| Restricted | Manager-restricted. The subject does not see their own signal |
| Empty | The section is absent from the queue rather than showing zero |
| Error | Not applicable |

### Responsive

Works unchanged within the queue.

---

## Technical Architecture

### The BurnoutAlert schema

Manager-restricted, Tier 2.

```
alert_id:          UUID v4
workspace_id:      UUID
employee_id:       UUID, FK to Employee — a direct field
signal_reasons:    JSON array of strings, one per triggered condition, e.g.
                   "SustainedOvertime: 4 consecutive weeks exceeding expected
                   hours", "NoLeaveTaken: 112 days since last approved leave"
severity:          enum: Low, Medium, High — one condition, two, three
lifecycle_status:  enum: Active
cleared_at:        timestamp, nullable
cleared_by:        user_id, nullable
clearance_note:    text, nullable

— Universal Node Conventions per VPS-A002; created_by is 'system' —
```

At most one Active uncleared alert per employee. A re-evaluation updates reasons and severity rather than creating a second.

### The three conditions, precisely

**Sustained overtime.** Three or more consecutive submitted weeks where logged hours exceed **expected hours for that employee that week**, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], multiplied by the workspace's overtime threshold.

Expected hours, not contracted hours. The previous specification used the latter, which flags a four-day-pattern employee for overtime they did not work and misses genuine overtime in a week containing a public holiday. Same correction [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] required for its own single-week flag, and this feature reuses that flag's definition directly.

**Approved overtime under [[VRS-F018_Leave_Policy_Engine|VRS-F018]] is excluded.** A week whose overtime was authorized and accrued TOIL is not an unnoticed pattern — it is a noticed one, already actioned by the manager this signal would notify.

**Sustained high utilization.** Six or more consecutive weeks where combined allocation across overlapping assignments meets or exceeds the near-capacity threshold from [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]. Reused directly; no second utilization threshold.

**No leave taken.** More than `burnout_no_leave_threshold_days`, default 90, since the last approved leave end date — or since the employee's start date if they have never taken leave. **Counted in working days** per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], so a long public holiday period does not mask the count.

### Evaluation

Overtime and utilization evaluate reactively on timesheet submission, checking the trailing window.

**No-leave has no natural write trigger** — nothing is written when leave is simply not taken — so it runs on a weekly sweep, idempotent per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. Idempotency matters here: a sweep that re-notified a manager weekly about the same uncleared signal would train them to ignore it.

### API contracts

```
workloadStrain.evaluate(employeeId) -> { alertId?, signalsTriggered: string[] }
  // Reactive on timesheet submission, and by the weekly sweep

workloadStrain.weeklySweep(workspaceId) -> { evaluated, createdOrUpdated }
workloadStrain.clear(alertId, note?)   -> { success }
workloadStrain.getDetail(alertId)      -> {
  overtimeWeeks?: { weekStart, logged, expected }[],
  utilizationWeeks?: { weekStart, combinedAllocation }[],
  leaveGap?: { lastLeaveEndDate, workingDaysSince }
}
  // The facts behind each condition. No interpretation

workloadStrain.listActive(workspaceId) -> BurnoutAlert[]
  // Scoped to the requesting manager's reports, or unscoped for Owner and HR Admin
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | BurnoutAlert carries the schema above |
| G02 | At most one Active uncleared alert per employee. A repeat trigger updates rather than duplicates |
| G03 | The overtime condition compares against expected hours per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], never contracted hours, and reuses [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s threshold definition exactly |
| G04 | A week whose overtime was approved under [[VRS-F018_Leave_Policy_Engine|VRS-F018]] is excluded from the overtime condition |
| G05 | The utilization condition reuses [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s threshold exactly. No second threshold is defined |
| G06 | The no-leave condition counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| G07 | This feature never reads any node type in [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]'s domain. No code path has access to it |
| G08 | `signal_reasons` states objective facts only. No field ever carries an interpretation, a diagnosis or a recommendation |
| G09 | The weekly sweep is idempotent. A repeated run produces no duplicate notification |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F052-S01 | BurnoutAlert schema | Data |
| VRS-F052-S02 | Overtime and utilization evaluation | Logic |
| VRS-F052-S03 | No-leave weekly sweep | Logic |
| VRS-F052-S04 | Manager review and clear | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee submits a fourth consecutive week exceeding their expected hours by the overtime threshold
**WHEN** evaluation runs
**THEN** an alert is created with the overtime reason and severity Low, since one condition triggered

---

**GIVEN** an employee on a four-day pattern logs 34 hours against 32 expected
**WHEN** evaluation runs
**THEN** no overtime condition triggers, because the comparison is against expected hours — and under the previous specification, using contracted hours, it would have

---

**GIVEN** three of those four weeks had overtime approved under [[VRS-F018_Leave_Policy_Engine|VRS-F018]]
**WHEN** evaluation runs
**THEN** those weeks are excluded and the condition does not trigger on them

---

**GIVEN** the same employee also has six consecutive weeks at or above the near-capacity threshold
**WHEN** evaluation runs
**THEN** the same alert's severity becomes Medium with both reasons listed, not two alerts

---

**GIVEN** an employee has taken no approved leave in 95 working days against a threshold of 90
**WHEN** the weekly sweep runs
**THEN** the no-leave reason is added

---

**GIVEN** a manager opens the detail
**WHEN** it renders
**THEN** they see the actual weeks and figures, and no sentence interpreting them

---

**GIVEN** a manager clears an alert
**WHEN** the pattern continues the following week
**THEN** a new Active signal appears, since clearing does not suppress evaluation

---

**GIVEN** the sweep runs twice against unchanged state
**WHEN** the second completes
**THEN** no duplicate notification was sent

---

**GIVEN** a code review checks whether this feature reads wellness data
**WHEN** the check runs
**THEN** no such path exists

---

## Non-Functional Requirements

- Overtime and utilization evaluation completes within 5 seconds of a timesheet submission
- The weekly sweep covers 150 employees within 2 minutes
- Review and clearance function offline

---

## Security Considerations

- **BurnoutAlert is Manager-restricted with Manager holding Full**, since reviewing and clearing is the entire point of routing it to them.
- **The subject does not see their own signal**, matching the precedent for every system-generated signal in this product. This is worth stating plainly because it is arguable: one could reasonably say a person should know their own workload pattern was flagged. The reason they do not is that the signal exists to prompt a manager's conversation, and a person who saw the alert first would be having a different conversation — about the software, and about being monitored, rather than about their week.
- **This feature is architecturally incapable of reading [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]'s data**, not merely instructed not to.
- **This is a heuristic, not a diagnosis, and the interface never says otherwise.** `signal_reasons` states the specific weeks and figures. A manager acting on it is checking in with a person, not applying a verdict — and the renaming of this feature is part of ensuring that.

---

## Out of Scope

- **Any machine-learning or predictive modeling** — three rules, and the name now says so
- **Automatic intervention** — no reassignment, no forced leave, no workload reduction. This surfaces a pattern; every action is a human decision
- **Reading [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]'s wellness data in any form** — an absolute boundary
- **Notifying the employee** — permanently out of scope, per the reasoning above
- **A configurable condition set.** Three conditions, fixed, so that the signal means the same thing in every workspace and across them

---

## Decisions Recorded

**The feature is renamed to Workload Strain Signal.** *Predictor* overstates three rules-based conditions; *burnout* asserts a clinical state this product cannot assess. The node type keeps its registered name for continuity; the feature describes what it does.

The renaming has a practical effect rather than a cosmetic one: a signal labeled *burnout* invites a manager to arrive at a conversation with a conclusion already attached, and the conversation is worse for it.

**The overtime condition compares against expected hours, not contracted hours.** The previous specification would flag a four-day-pattern employee for overtime they did not work, and miss real overtime in a week containing a public holiday.

**Weeks with approved overtime are excluded.** [[VRS-F018_Leave_Policy_Engine|VRS-F018]] did not exist when this was first written. A week whose overtime was authorized and accrued TOIL is a noticed pattern already actioned by the same manager this signal would notify.

**The no-leave condition counts working days.** A ninety-calendar-day window containing Eid and a public holiday period is materially shorter in working days, and the calendar count masks it.

**The detail panel carries no interpretation.** The manager reads the facts the rule read. A sentence saying someone *may be at risk* asserts what this feature cannot know.

---

## Related Notes

- [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] — the overtime definition reused here
- [[VRS-F018_Leave_Policy_Engine|VRS-F018]] — approved overtime, excluded from this signal
- [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] — the differently-scoped retention signal
- [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] — the boundary this feature never crosses

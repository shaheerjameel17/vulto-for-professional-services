---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F053
---

# VRS-F053 — Retention Risk Indicator

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (Departure, whose Rescinded status feeds the first condition), [[VRS-F039_Performance_Review_Cycle|VRS-F039]] (ReviewEntry ratings, the second), [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] (the `targeting` edge and `qualifiedSince`, the third), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (FlightRiskSignal), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the sweep scheduler)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## The three-way boundary, closed on the last side

[[VRS-F052_Workload_Strain_Signal|VRS-F052]] is objective workload data, manager-visible. [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] is subjective, self-reported, invisible even to Owner. **This is the third side**, and it needed a genuinely different condition set rather than the first feature's signals wearing a stricter permission row.

**Why Manager gets None here, not Read.** Every manager-restricted signal in this product routes to the manager because they are the person meant to act. This one deliberately does not.

A direct manager learning that the system suspects a specific report might leave creates exactly the wrong dynamic — awkward, and quite possibly self-fulfilling. A person treated as a flight risk becomes one. Retention conversations at this sensitivity belong with HR and leadership, not a line manager acting on a system's suspicion.

**The employee never sees it either**, unlike [[VRS-F052_Workload_Strain_Signal|VRS-F052]] where the signal at least concerns their own working conditions. This signal exists for the organization's retention planning, and there is no version of showing it to its subject that improves anything.

---

## The name, corrected

Previously *Flight Risk Indicator*. **Flight risk is the language of someone about to be lost rather than someone worth keeping**, and it frames the subject as a problem rather than the situation as one.

The distinction matters because it changes what the reader does next. *This person is a flight risk* invites containment. *We may be at risk of losing this person* invites a conversation. The second is the only useful response, and it is what this feature exists to prompt.

The node type keeps its registered name for schema continuity.

---

## What It Is

A composite signal, Owner and HR Admin only, computed from three objective, already-recorded facts: a previously rescinded resignation, a performance rating that has plateaued or declined, and prolonged stagnation against a targeted career milestone.

None is a workload pattern. None is self-reported sentiment.

---

## Problem It Solves

By the time a valued employee's resignation lands, the organizational signs were usually visible for months — stalled progression, a rating that quietly stopped improving, a resignation once given and withdrawn.

No single manager is positioned to notice all three, and HR often sees only the resignation letter, after the decision is made.

**This surfaces the pattern early enough that a retention conversation is still possible rather than a counteroffer after the fact** — and the difference between those two matters, because a counteroffer accepted is a person who leaves nine months later anyway.

---

## User-Facing Flows

### The signal appearing

An Owner or HR Admin sees an indicator naming which conditions triggered, factually — *targeting Senior Engineer for 22 months with no progression* — never an inferred narrative about a person's state of mind.

### Reviewing and clearing

The underlying facts, plainly. Cleared once reviewed and, where appropriate, acted on. **This feature has no opinion on what the response should be.**

### Reappearance

Clearing does not suppress future evaluation.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Retention signals | Content + Panel | The list, Owner and HR Admin only |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]], not primary navigation. A list of people the system thinks might leave is not something to encounter while looking for something else.

### Layout and components

A Table: employee, conditions triggered as a count, longest-standing condition, days active. Sorted by days active descending — a signal standing for four months is one nobody has acted on.

**The Panel is the facts, laid out plainly.** The rescinded departure with its date. The rating sequence across cycles, shown as the actual ratings rather than a trend word. The targeting duration with the milestone named and, where [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] supplies it, how long they have qualified without confirmation.

That last one is frequently the most actionable thing on the screen. Someone who met every stated criterion six months ago and has heard nothing has a reason to leave that the agency created and can uncreate.

**No severity color.** Not `attention`, not `danger`. A neutral Badge with the condition count. Coloring this screen would turn a list of colleagues into a triage board, and the reader is an Owner or HR Admin who does not need to be told this is important.

The clear action requires a note. Unlike [[VRS-F052_Workload_Strain_Signal|VRS-F052]]'s optional one, a retention signal cleared without a record of what was considered is a signal nobody can learn from — and this is exactly the case where the same person appearing again in four months matters.

### Keyboard

Standard list bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Structurally absent for Manager, Finance Admin and Team Member, and for the subject |
| Insufficient | A condition that cannot yet be evaluated is stated as such rather than as absent |
| Empty | *No retention signals.* |
| Error | Clearing without a note is refused |

### Responsive

Drops `longest-standing condition` below 1280px.

---

## Technical Architecture

### The FlightRiskSignal schema

Owner and HR Admin only, Tier 2.

```
signal_id:         UUID v4
workspace_id:      UUID
employee_id:       UUID, FK to Employee — a direct field
signal_reasons:    JSON array of strings, e.g. "RescindedDeparture: notice
                   given and withdrawn on 2026-03-14", "PerformancePlateau:
                   MeetsExpectations for 3 consecutive cycles after a prior
                   Exceeds", "CareerStagnation: targeting Senior Engineer for
                   22 months with no progression"
severity:          enum: Low, Medium, High — one condition, two, three
lifecycle_status:  enum: Active
cleared_at:        timestamp, nullable
cleared_by:        user_id, nullable
clearance_note:    text — required on clearance

— Universal Node Conventions per VPS-A002; created_by is 'system' —
```

At most one Active uncleared signal per employee.

### The three conditions, precisely

**Rescinded departure.** Any Departure with status Rescinded in this employee's history. A resignation once given and withdrawn is a durable fact worth remembering, not an event that stops mattering once reversed.

**Performance plateau or decline.** Across the most recent three finalized review entries: either the rating dropped between consecutive cycles, or held at the same level across all three after a prior cycle showed improvement.

**Fewer than three finalized entries means the condition cannot be evaluated** — an absence of history, not a negative result, and stated as such rather than silently contributing nothing.

**Career stagnation.** An active `targeting` edge held longer than `flight_risk_stagnation_months`, default 18, with no `at_milestone` change in that window.

**Where [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] reports `qualifiedSince`, the condition triggers at half the threshold.** Someone who has met every stated requirement for nine months and not been confirmed has a materially stronger reason to leave than someone still working toward it, and the agency created that reason.

An employee with no `targeting` edge triggers nothing. Disengagement from the formal path is a different fact from stalled progress on it.

### Evaluation

Rescinded departure and performance plateau evaluate reactively. Career stagnation runs on a monthly sweep, idempotent per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]].

### API contracts

```
retentionRisk.evaluate(employeeId) -> { signalId?, signalsTriggered: string[] }
retentionRisk.monthlySweep(workspaceId) -> { evaluated, createdOrUpdated }
retentionRisk.clear(signalId, note) -> { success }
  // Note required. Owner or HR Admin only

retentionRisk.getDetail(signalId) -> {
  rescindedDeparture?: { date },
  performanceHistory?: { cycle, rating }[],
  careerStagnation?: { milestone, targetingSinceMonths, qualifiedSinceMonths? }
}

retentionRisk.listActive(workspaceId) -> FlightRiskSignal[]
  // Owner and HR Admin only. Structurally absent to every other role
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | FlightRiskSignal carries the schema above |
| G02 | At most one Active uncleared signal per employee |
| G03 | The three conditions draw from [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]], [[VRS-F039_Performance_Review_Cycle|VRS-F039]] and [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]]. None overlaps [[VRS-F052_Workload_Strain_Signal|VRS-F052]]'s workload conditions or [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]'s subjective domain |
| G04 | The performance condition requires at least three finalized entries. Fewer produces no result, reported as insufficient history rather than as absent |
| G05 | The stagnation condition triggers at half the threshold where the employee has qualified for their targeted milestone without confirmation |
| G06 | An employee with no `targeting` edge triggers nothing on the stagnation condition |
| G07 | Clearance requires a note |
| G08 | This feature never reads [[VRS-F052_Workload_Strain_Signal|VRS-F052]]'s or [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]'s data |
| G09 | The monthly sweep is idempotent |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F053-S01 | FlightRiskSignal schema | Data |
| VRS-F053-S02 | Rescinded departure and performance evaluation | Logic |
| VRS-F053-S03 | Career stagnation monthly sweep | Logic |
| VRS-F053-S04 | Review and clear | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee has a Departure with status Rescinded
**WHEN** evaluation runs
**THEN** the rescinded-departure reason is recorded with its date

---

**GIVEN** an employee's last three ratings are Exceeds, Meets, Meets
**WHEN** the third is finalized
**THEN** the plateau reason is added, since the rating held flat after a prior improvement

---

**GIVEN** an employee has only two finalized entries
**WHEN** the performance condition runs
**THEN** it reports insufficient history rather than contributing nothing silently

---

**GIVEN** an employee has targeted the same milestone for 20 months with no progression, against a threshold of 18
**WHEN** the monthly sweep runs
**THEN** the stagnation reason is added

---

**GIVEN** an employee has qualified for their targeted milestone for 10 months without confirmation, against a threshold of 18
**WHEN** the sweep runs
**THEN** the stagnation reason triggers at the halved threshold, and the detail states how long they have qualified

---

**GIVEN** a Manager attempts to view this feature's data for a direct report
**WHEN** the request is made
**THEN** it is structurally absent

---

**GIVEN** the subject attempts to reach it through any surface
**WHEN** they search, open their own profile, or use the self-service portal
**THEN** nothing indicates a signal exists

---

**GIVEN** an HR Admin clears without a note
**WHEN** it is submitted
**THEN** it is refused

---

## Non-Functional Requirements

- Reactive evaluation completes within 30 seconds of the relevant write
- The monthly sweep covers 150 employees within 2 minutes
- Review and clearance function offline

---

## Security Considerations

- **This feature required no permission correction**, the first alert type in this family where that is true. Owner and HR Admin only was right when it was first anchored, and this document confirms it deliberately rather than assuming it was simply never checked.
- **Manager exclusion is the substantive decision.** A manager acting on a system's suspicion that their report might leave produces a conversation that makes the suspicion more likely to come true, and there is no framing of that alert that avoids it.
- **The subject never sees it**, and unlike [[VRS-F052_Workload_Strain_Signal|VRS-F052]] there is no argument for showing them. A person told the system thinks they might leave has been given a reason to consider it.
- **No condition derives from [[VRS-F052_Workload_Strain_Signal|VRS-F052]] or [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]].** All three inputs are operational HR records an organization keeps for reasons unrelated to retention prediction.
- **The clearance note is required and is itself sensitive.** A note reading *discussed compensation, reviewing in Q3* is a record of a conversation about someone's future, held at Tier 2, readable by Owner and HR Admin only.

---

## Out of Scope

- **Any inference from workload or wellness data** — an absolute exclusion
- **Compensation relative to market as a condition** — a natural addition once [[VRS-F071_Salary_Benchmarking|VRS-F071]] exists, and deliberately not built here. It would require reading a benchmark under its own consent model, and a retention signal quietly consuming compensation benchmarks is a scope expansion worth deciding separately
- **Automatic retention action of any kind** — no counteroffer, no compensation adjustment, no scheduled conversation. This surfaces a signal
- **Notifying the subject or their manager** — permanently excluded
- **A predicted probability of departure.** Three conditions and a count. A percentage would imply a model that does not exist

---

## Decisions Recorded

**The feature is renamed to Retention Risk Indicator.** *Flight risk* is the language of someone about to be lost rather than someone worth keeping, and it invites containment where the only useful response is a conversation.

**The stagnation condition triggers at half the threshold where [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] reports qualification without confirmation.** That feature added `qualifiedSince` specifically to surface people who met every stated criterion and heard nothing, and it is the strongest retention signal in this feature — because unlike the other two, the agency created it and can uncreate it.

**Insufficient history is reported rather than silently absent.** An Owner reading a signal with two conditions should know whether the third was evaluated and not met or could not be evaluated at all.

**The clearance note is required**, unlike [[VRS-F052_Workload_Strain_Signal|VRS-F052]]'s optional one. The same person reappearing in four months is the case that matters, and a cleared signal with no record of what was considered teaches nobody anything.

**No severity color.** Coloring this screen would turn a list of colleagues into a triage board, and its only readers are two roles who do not need to be told it is important.

---

## Related Notes

- [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] — the qualification stagnation this feature weights most heavily
- [[VRS-F052_Workload_Strain_Signal|VRS-F052]] — the differently-scoped workload signal
- [[VRS-F059_Retention_Analytics|VRS-F059]] — the retrospective analytics counterpart
- [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] — the boundary this feature never crosses

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Intelligence
aliases:
  - VRS-F011
---

# VRS-F011 — Billable vs Non-Billable Pulse

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (expected working hours — the denominator), [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] (the classification this feature reads), [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (TimesheetEntry), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (aggregate disclosure control)
**Blocks:** Nothing structurally. This reads and visualizes.

This document is the single source of truth for this feature.

---

## What It Is

A live utilization engine that reads TimesheetEntry data by [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]'s classification and computes the most consequential single number in a professional services business: **the fraction of available working hours that generated revenue.**

It surfaces at two levels — an individual pulse bar on every employee profile, and an agency dashboard with a single aggregate, a week-over-week delta, and a per-employee comparison.

In graph terms: the engine reads TimesheetEntry nodes per employee per week, aggregates by category, and writes a UtilizationSnapshot. The agency figure aggregates across active employees' current snapshots. Both run entirely from the local graph.

---

## Problem It Solves

Most founders know their monthly revenue. Most do not know their current effective utilization without running a report, and the gap between 70% and 85% is often the entire difference between a breakeven month and a profitable one.

Without this, that number is discovered at month-end, when payroll has processed and the cost is sunk. With it, the problem is visible on the Tuesday of the week it starts.

---

## The denominator, which is the whole argument

Utilization can be computed two ways, and only one of them is honest.

**Billable hours divided by logged hours** measures the composition of what someone recorded. It has a fatal property: an employee who logs only their billable work shows 100% utilization. The person with the worst logging discipline in the agency looks like the best performer, and a founder acting on that number makes exactly the wrong staffing decision.

**Billable hours divided by expected working hours** — the actual available hours for that person that week, from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — measures what the business cares about: how much of the capacity it paid for produced revenue. Someone who logged nothing shows 0%, correctly, because zero of their available hours are known to have generated revenue.

**The second is the headline figure.** The first is retained as a composition view, useful for understanding *what* the non-billable time was, and it is never presented as utilization.

This distinction matters more in this product than in most, because [[VRS-F005_The_Bench_Forecast|VRS-F005]] shows bench cost and this feature shows utilization, and the two must agree. A person on the bench costing money cannot simultaneously show 100% utilization because they logged four billable hours and nothing else.

---

## User-Facing Flows

### The individual pulse bar

Every employee profile shows a segmented bar for the current week: billable, non-billable by subcategory, pitch, and unlogged, against their expected hours. The bar updates within 2 seconds of any relevant entry change. Hovering a segment reveals its breakdown without navigation.

Color follows the target: `success` at or above target, `attention` below it. There is no third color — a red band beneath a certain figure would rank people by a number that is frequently not their fault.

### The agency dashboard

A single aggregate percentage with a week-over-week delta, and a comparison chart sorted highest to lowest, making outliers visible without filtering. A week selector reaches any historical week, since snapshots are retained.

### Pitch hours, reported honestly

Pitch hours are never folded into the billable figure in either direction. They appear as their own segment and their own figure on both views — visible, not buried, and never diluting the number that measures revenue-generating work.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Pulse bar | Section on the Employee profile | One person, one week |
| Utilization dashboard | Content | The agency figure and comparison |

### Layout and components

**The pulse bar** is the Progress and Pulse Bar component from [[VPS-D002_Component_Library|VPS-D002]], segmented: billable in `success`, non-billable in `neutral-400`, pitch in `cat-2`, unlogged as an unfilled remainder with a 1px dashed left edge per [[VPS-D001_Design_Foundations|VPS-D001]]'s dashed-border rule — because unlogged time is expected-but-not-present, which is exactly what that rule means.

The target sits as a 1px `border-strong` tick, so *above or below target* is legible without reading a number. Beneath, in `numeric`, the headline: *31h billable of 40h available · 78%*. Stating both figures rather than only the percentage is deliberate; a percentage without its denominator is a rumor, and this is the number the whole product is judged on.

**The dashboard** leads with a Stat: the aggregate in `display`, the delta beneath in `small` with the comparison period named explicitly. Beneath it, a bar Chart, one bar per employee, sorted descending, with the target as a horizontal reference line.

Bars below target render `attention`, above render `success`. The chart is deliberately not interactive beyond hover — clicking through to a person from a ranked list of colleagues is a shape of interface that invites the wrong conversation, and the employee profile is one keystroke away regardless.

### Keyboard

`[` and `]` move between weeks on both surfaces. Standard list bindings on the chart.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton bar at correct height |
| Restricted | A Team Member sees their own pulse bar and the agency aggregate, not the per-employee comparison. A Manager sees their reports |
| Suppressed | Where a filtered cohort falls below `k_anonymity_minimum`, the aggregate is suppressed per [[VPS-A004_Graph_Permission_Layer|VPS-A004]] with the reason named |
| Empty | A week with no entries shows the bar fully unlogged and reads *No time logged this week*, not a zero percentage presented as a result |
| Error | Not applicable — division by zero resolves to zero by specification, never an error |

### Responsive

The dashboard chart becomes a scrollable list of rows below 1024px, each with a name and an inline mini-bar.

---

## Technical Architecture

### The UtilizationSnapshot schema

```
snapshot_id:                UUID v4
workspace_id:               UUID
employee_id:                UUID
week_start_date:            date — the first working day of the week per VRS-F004

expected_hours:             decimal — available working hours for this employee
                            this week, from VRS-F004. The denominator
billable_hours:             decimal
non_billable_hours:         decimal
pitch_hours:                decimal — tracked separately, never in either the
                            numerator or the denominator of utilization_rate
logged_hours:               decimal — billable + non_billable, excluding pitch

utilization_rate:           decimal, 1dp — billable_hours / expected_hours × 100.
                            THE headline figure. 0 where expected_hours is 0
billable_share_of_logged:   decimal, 1dp — billable_hours / logged_hours × 100.
                            A composition view. Never presented as utilization
logging_completeness:       decimal, 1dp — logged_hours / expected_hours × 100.
                            Surfaces whether a low utilization_rate reflects
                            idle capacity or absent data

non_billable_breakdown:     JSON map, subcategory to hours, per VRS-F009
target_utilization:         decimal, nullable — the Employee's override if set,
                            else the workspace billability_target
computed_at:                timestamp
```

`logging_completeness` is the field that makes the honest denominator usable. A utilization rate of 45% means something entirely different at 100% logging completeness than at 50%, and without it a founder cannot tell whether they have a capacity problem or a compliance problem.

### The traversal

The engine reads TimesheetEntry **directly by `employee_id`** for the relevant week, filters by category, and routes Billable and NonBillable into the standard calculation and Pitch into `pitch_hours` exclusively.

It does not traverse Employee → Assignment → entry. That path cannot reach a Pitch-categorized entry at all, since pitch time is logged against a Pitch rather than an Assignment, and a workspace computing snapshots that way would silently under-count every hour of business development. This is why [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] carries `employee_id` as a direct field.

### Expected hours

`expected_hours` comes from `workingDays.count(employeeId, weekStart, weekEnd)` per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. It accounts for the employee's working pattern, their entity's calendar, public holidays and reduced-hours periods automatically.

Approved leave reduces expected hours once [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] exists. Until then, a person on holiday shows a depressed utilization rate, and this is stated as a known limitation rather than left to be discovered.

### Agency aggregate exclusions

Employees with `contracted_hours` of zero — non-billable directors and advisors — are excluded from both numerator and denominator, to prevent distortion. Ghost Resources are excluded entirely: a placeholder logs no time and has no utilization.

### API contracts

```
utilizationSnapshot.compute(employeeId, weekStartDate) -> { snapshotId }
  // Reactive on any entry write for that employee and week.
  // Updates the existing snapshot for the pair rather than duplicating

utilizationSnapshot.getIndividual(employeeId, weekStartDate?) -> UtilizationSnapshot

utilizationDashboard.getAgencyAggregate(workspaceId, weekStartDate?, filters?) -> {
  aggregateUtilization: number | Suppressed,
  aggregateLoggingCompleteness: number,
  weekOverWeekDelta: number,
  cohortSize: number,
  perEmployee: { employeeId, utilizationRate }[]
}
  // Resolves entirely from the local graph. Passes through VPS-A004's
  // disclosure control before returning an aggregate
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | One snapshot per employee per week. Repeated computation updates the existing node rather than duplicating |
| G02 | The traversal reads TimesheetEntry directly by `employee_id`, never solely through Assignment edges. Billable and NonBillable feed the standard calculation; Pitch feeds `pitch_hours` exclusively |
| G03 | `expected_hours` resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. No weekday count or contracted-hours division is performed here |
| G04 | `utilization_rate` divides by `expected_hours`, never by `logged_hours`. `billable_share_of_logged` is a separate field and is never labeled utilization |
| G05 | The agency aggregate reads active employees with `contracted_hours` above zero and excludes Ghost Resources |
| G06 | Snapshots are retained indefinitely. Historical views read past snapshots; nothing is recomputed retroactively |
| G07 | Every aggregate passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control before display |
| G08 | Division by zero resolves to zero at every point, never an error |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F011-S01 | UtilizationSnapshot schema and calculation engine | Data |
| VRS-F011-S02 | Individual pulse bar | UI |
| VRS-F011-S03 | Agency utilization dashboard | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee with 40 expected hours logs 32 billable and 8 non-billable
**WHEN** the snapshot computes
**THEN** `utilization_rate` is 80.0, `billable_share_of_logged` is 80.0, `logging_completeness` is 100.0, and the bar renders `success`

---

**GIVEN** an employee with 40 expected hours logs 4 billable hours and nothing else
**WHEN** the snapshot computes
**THEN** `utilization_rate` is 10.0 — not 100.0 — `logging_completeness` is 10.0, and the dashboard makes clear that the low figure may reflect absent data rather than idle capacity

---

**GIVEN** an employee logs 20 billable and 15 pitch hours against 40 expected
**WHEN** the snapshot computes
**THEN** `utilization_rate` is 50.0 computed from 20 over 40, `pitch_hours` shows 15 separately, and pitch appears in neither the numerator nor the denominator

---

**GIVEN** an employee on a four-day pattern with 32 expected hours logs 28 billable
**WHEN** the snapshot computes
**THEN** `utilization_rate` is 87.5, computed against their actual availability rather than a notional forty-hour week

---

**GIVEN** a week containing a public holiday
**WHEN** expected hours resolve
**THEN** the holiday is excluded per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and the employee is not penalized for a day the business was closed

---

**GIVEN** 100 entries across 10 active employees
**WHEN** the dashboard renders
**THEN** the aggregate computes from the local graph within 500ms, with no network request, and all 10 columns are visible

---

**GIVEN** a filter reducing the visible cohort to four employees
**WHEN** the aggregate is requested
**THEN** it is suppressed per [[VPS-A004_Graph_Permission_Layer|VPS-A004]] with the reason named, rather than displayed for a group small enough to identify someone

---

**GIVEN** the device is offline
**WHEN** the dashboard loads
**THEN** the aggregate and chart render from the local graph within 500ms, with no loading state and no network attempt

---

## Non-Functional Requirements

- Dashboard renders within 500ms for up to 150 active employees from the local graph
- Individual pulse bar updates within 2 seconds of any relevant entry write
- Agency aggregate updates within 5 seconds of any entry write
- Full functionality offline at both levels
- Division by zero handled at every point; zero-hour employees excluded from the aggregate; pitch hours never distort the rate in either direction
- Snapshot writes sync within 1 second

---

## Security Considerations

- **UtilizationSnapshot follows Employee's Standard, Tier 0 visibility**: Owner and HR Admin full, Manager scoped to direct reports, Team Member their own. A deliberate reuse of an existing rule, not a new category.
- **Every aggregate passes [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control**, including differencing protection. A dashboard filtered to a team of eleven and one filtered to twelve must not allow the twelfth person's figure to be recovered by subtraction.
- **The per-employee comparison is a ranked list of colleagues**, which carries real social weight. It is restricted to Owner, HR Admin and Manager-for-their-reports. A Team Member sees their own bar and the agency aggregate, never the ranking.

---

## Out of Scope

- Non-billable subcategory management — [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]
- External-channel alerting — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]
- Per-project margin — permanently [[Vulto Accounts]]', not a deferred Roster feature
- Multi-month trend charts — [[VRS-F058_People_Analytics_Dashboard|VRS-F058]]
- Industry benchmark comparison — [[VRS-F072_Agency_Benchmarking|VRS-F072]]
- Per-project utilization breakdown — this feature operates at employee and agency level
- Editing entries from this view — all writes happen in [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]

---

## Decisions Recorded

**The denominator changes from logged hours to expected hours.** The previous specification computed billable over total logged, which gives 100% utilization to an employee who logs only billable work — making the person with the worst logging discipline appear to be the best performer. It also contradicted [[VRS-F005_The_Bench_Forecast|VRS-F005]], which would show that same person accumulating bench cost. Utilization now divides by available hours from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], which is both the standard professional services definition and the only one consistent with the rest of this product.

**`logging_completeness` is added** as a companion figure. Without it, a low utilization rate is ambiguous between a capacity problem and a compliance problem, and those require opposite responses.

**`billable_share_of_logged` is retained but demoted.** It is genuinely useful for understanding what non-billable time consisted of. It is never labeled utilization.

**The red band below 50% is removed.** Two colors, above and below target, are sufficient. A third tier ranks people by a number that is frequently not their fault, on a screen their colleagues can see.

**Leave's effect on expected hours is named as a known limitation** until [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] exists, rather than left for a founder to discover when someone returning from holiday appears to have collapsed.

---

## Related Notes

- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the expected hours forming the denominator
- [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] — the classification this feature reads
- [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] — the entries this feature aggregates
- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — bench cost, which this figure must agree with
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — aggregate disclosure control

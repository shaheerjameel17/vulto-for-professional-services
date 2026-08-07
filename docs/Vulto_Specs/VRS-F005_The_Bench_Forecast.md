---
Type:
  - Vulto Roster Specs
Date: "[[2026-08-07]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F005
---

# VRS-F005 — The Bench Forecast

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee nodes must exist), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — every day count in this feature resolves there), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Assignment's registry entry), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (local-first rendering and tier-based access), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission-scoped visibility in the intelligence panel, and aggregate disclosure control), [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] (Referenced In context), [[VPS-D001_Design_Foundations|VPS-D001]] (the signature element specified there)
**Partial forward dependencies:** [[VRS-F006_Rate_Card_Engine|VRS-F006]] supplies rate resolution; until it exists, `effective_billing_rate` is written as `billing_rate_default` at Assignment write time. [[VRS-F007_Ghost_Resources|VRS-F007]] supplies Ghost rows; until it exists, none are rendered. Neither blocks this feature.
**Blocks:** [[VRS-F007_Ghost_Resources|VRS-F007]] and [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] both depend on the Assignment model and the 100% capacity constraint defined here. [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] depends on the bench computation defined here.

This document is the single source of truth for this feature and owns Assignment's complete schema.

---

## What It Is

A 90-day visual timeline showing every person in the agency, what they are assigned to, when they roll off, and when they become available again. It is the centerpiece of Vulto Roster and the first screen a founder opens each morning.

In graph terms: a temporal visualisation of Assignment nodes connecting Employee to Project, rendered as a Gantt-style timeline. **Every bar is an Assignment. Every gap between bars is bench time, computed from the graph at render time and never stored as its own record.**

---

## Problem It Solves

A developer finishes a project on Friday. The next does not start for three weeks. Those three weeks cost the agency the person's full salary with zero revenue offset, and most founders do not notice until month-end numbers are already wrong.

The typical alternative is a spreadsheet updated last Tuesday, a verbal check-in with two project managers, and a judgement call made on incomplete information — a process that takes twenty to forty minutes per decision, is wrong a meaningful proportion of the time, and is entirely inaccessible to anyone who was not present for the conversations.

This feature makes the cost of idle time continuously visible, converting a reactive process into something checked every morning the way a founder checks a bank balance.

---

## User-Facing Flows

### Viewing the forecast

Every active employee is a row. Assignments render as color-coded bars positioned by date. Today is a vertical line. The space after an employee's last covering assignment is bench time — an uncovered date range, computed from the graph.

Hovering a bar reveals project, client, effective daily rate and days remaining.

### Filtering

A user filters by skill, seniority, department, entity, availability window, or any combination. **The aggregate utilization recalculates for the filtered set**, because a view answering *who is free next month with React experience* needs a percentage that means something for that question rather than for the whole agency.

Where the filtered cohort falls below the k-anonymity threshold, the aggregate is suppressed per [[VPS-A004_Graph_Permission_Layer|VPS-A004]] rather than displayed for a group small enough to identify someone.

### Selecting a row

Selection opens the Contextual Intelligence Panel, built from a single two-hop traversal of that Employee node, entirely local. What appears depends on the viewer's role and the tier of what is traversed to, governed by [[VPS-A004_Graph_Permission_Layer|VPS-A004]] rather than by logic written here.

### Zoom

Three horizons: 30, 90 and 180 days. Ninety is the default and the one the product is named around. Thirty is for a staffing conversation this month; 180 is for a hiring decision. The window is a view state, not a stored preference on any node.

---

## Interface Specification

This feature carries the design system's signature element. [[VPS-D001_Design_Foundations|VPS-D001]] specifies it; this section specifies its behavior.

### Screen

One screen, occupying Content and Panel. It is exempt from the 1440px content maximum per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] and runs to the full viewport, because horizontal space here is time, and time is what the user came for.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Bench Forecast          [30│90│180]  [Filters]     Utilization  │
│                                                            76%   │
├────────────────┬─────────────────────────────────────────────────┤
│  Priya Sharma  │  ███████████ Acme Rebrand ███████│  £4,200      │
│  Senior Design │                                   │  amber       │
├────────────────┼─────────────────────────────────────────────────┤
│  Omar Farooq   │  ████ Nomad ████│  £1,800 │████ Halo ████       │
│  Lead Engineer │                  amber                           │
├────────────────┼─────────────────────────────────────────────────┤
│  ⌐ Senior BE ¬ │  ┌ ─ ─ ─ Halo Phase 2 ─ ─ ─ ┐                  │
│  ⌐ Ghost     ¬ │                                                  │
└────────────────┴─────────────────────────────────────────────────┘
                        ▲ today
```

**Left column, 220px, fixed.** Avatar top-aligns with name; name at `body-medium`, human-readable employee code at `micro`, and role at `label` in `text-secondary`. These facts remain present at every timeline width; density must not remove identity. A 40px row gives the two text lines and top-aligned avatar sufficient air. The identity group alone receives a rounded hover/selection surface; no persistent divider separates it from the timeline. Ghost rows show a role title in place of a name, a `GHOST-nnn` code, and the dashed treatment from [[VPS-D001_Design_Foundations|VPS-D001]]. The code is a workspace-scoped operational identifier, never the graph UUID.

**Timeline region**, horizontally virtualized. At rest it has no generic non-working-day band: calendars belong to people, not to a workspace. When a row is hovered, non-working days resolved for that employee through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] appear as a quiet contextual shade. Date labels are daily with a separate month band at 30 days, inline week ranges at 90 days, and inline fortnight anchors at 180 days; the latter two remain a single header row. Hovering a bench region highlights its exact range in the sticky header as one rounded pill. The Today line carries an 8px marker and its date is rendered as a brand pill with inverse text.

**Assignment bar.** Neutral `bg-raised` with `border-default`, `radius-md`, 20px height, and the project name inside at `small` `text-primary`, truncating with ellipsis. A 6px `cat-n` dot assigned by project hash identifies the project without allowing assignment color to compete with bench amber.

**Bench region.** Muted theme-specific amber at rest, strengthening to `attention` with the row hover, `radius-md`, 20px high. Left-aligned inside it, in `numeric-medium`, the accumulated unrecovered cost. This is the signature element. It does not animate or pulse — the restraint of everything around it is what makes it land.

**Today line.** 1px `brand-500`, full height, above bars, with a 6px dot at the top edge. The only brand-colored element on the canvas.

**Summary row**, sticky at the top: compact figures with unrecovered cost leading, followed by cohort size and utilization. A percentage is never shown without its denominator.

### Components

Timeline and Panel per [[VPS-D002_Component_Library|VPS-D002]]. Filters are a row of Selects and a Toggle Group for the horizon. There is no primary button on this screen — the Bench Forecast is a place you look, not a place you do things, and the actions it leads to belong to the Panel.

### Keyboard

| Key | Action |
|---|---|
| `J` / `K` | Previous / next employee row |
| `Enter` | Open the Contextual Intelligence Panel |
| `1` `2` `3` | 30, 90, 180-day horizon |
| `F` | Focus filters |
| `T` | Scroll today into view |
| `Escape` | Close Panel |

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows at correct row height, so the layout does not shift on arrival |
| Restricted | A Manager sees every row but no compensation-derived figure. The bench cost region renders without its cost figure rather than being hidden — the fact of bench time is operational, its cost is not universally readable |
| Aged out | Not applicable. The forecast window is always inside the retention window |
| Empty | *No one is assigned in this window.* with **Create an assignment** |
| Empty, good news | Where no employee has bench time, the summary states *Nobody is on the bench in the next 90 days* plainly, rather than treating absence as a deficiency |
| Suppressed aggregate | Where a filter reduces the cohort below threshold, the utilization figure renders the restricted state per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] with the reason named |

### Responsive

The left column remains 220px through the desktop timeline because name, code and role are operational identity, not optional decoration; the timeline scrolls rather than removing them. Below 1024px the timeline becomes a vertical per-person list showing current assignment, next rolloff and bench cost — a summary, not a timeline, because a Gantt chart on a phone is a Gantt chart nobody reads.

---

## Technical Architecture

### The full Assignment schema

```
assignment_id:            UUID v4
workspace_id:             UUID
employee_id:              UUID, FK to Employee
project_id:               UUID, FK to Project
start_date:               date, required
end_date:                 date, required
billable_percentage:      decimal 0–100, required
status:                   enum: Active, Completed, Canceled

rate_card_id:             UUID, nullable, FK to RateCard — per VRS-F006
rate_override_hourly:     decimal, nullable — per VRS-F006
rate_override_reason:     text, nullable, required when the override is set
effective_billing_rate:   decimal, nullable — the resolved hourly rate this
                          assignment costs against. Computed at write time per
                          VRS-F006's resolution order, never recomputed
                          retroactively when a RateCard is superseded.
                          Deliberately Tier 0, mirroring billing_rate_default

capacity_override_reason: text, nullable, required when saved above 100% — per VRS-F008
capacity_override_by:     user_id UUID, nullable
capacity_override_at:     timestamp, nullable

— Universal Node Conventions per VPS-A002 —
```

### The 100% capacity constraint

An employee — real or Ghost — cannot hold Assignments whose combined `billable_percentage` exceeds 100 on any overlapping date range. An attempt is rejected at write time with a `ConflictError` naming the current total and the attempted addition, never caught later by a report.

Rejection is the default. [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] catches this same error and offers a deliberate, justified, logged override as one resolution path, for the genuine crunch week a flat rejection cannot express. The constraint and its default are unchanged by that; an override is an explicit action, never a silent bypass.

### Bench computation

**Bench time is never stored.** It is derived, at render time, as:

> the set of working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], within the window, for which the employee holds no Active Assignment, **less** any day on which they logged Pitch-categorized time per [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]].

The Pitch exclusion is part of this computation rather than applied downstream. A person pursuing new business is not idle; the days they spend doing it are covered, and a forecast that painted them amber would train users to ignore the color that matters most.

Accumulated cost for a bench region is `bench working days × daily cost`, where daily cost derives from the employee's compensation where the viewer is authorized for it, and from `billing_rate_default` otherwise. Working day counts come from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], never from a local weekday calculation.

**[[VRS-F012_Revenue_Gap_Alert|VRS-F012]] consumes this computation; it does not supply it.** That feature owns whether a bench period warrants an escalating alert. This feature owns the fact that the period exists and what it costs. The distinction is the difference between a statement of fact and a judgement about it, and separating them means the amber region works from the moment this feature ships rather than waiting seven features for an alerting engine.

### The Contextual Intelligence Panel

A single two-hop traversal from the selected Employee, entirely local. What it shows, and to whom, is governed by [[VPS-A004_Graph_Permission_Layer|VPS-A004]] and [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], never by conditional logic here:

- **Skills, open roles, references** — Tier 0, visible to any role with Read on the Employee
- **BurnoutAlert** — Tier 2, Manager-restricted. Visible to Owner, HR Admin and this employee's own direct manager, not every manager in the workspace
- **FlightRiskSignal** — Tier 2, Owner and HR Admin only. A manager viewing their own report sees the burnout signal and not this one
- **WellnessTriggerEvent** — never appears, for any role including Owner. This panel implements no suppression for it; an unauthorized device never holds the data to suppress

### API contracts

```
benchForecast.get(workspaceId, window, filters?) -> {
  rows: EmployeeRow[],        // assignments, derived bench periods, accumulated cost
  aggregateUtilization: number | Suppressed,
  cohortSize: number
}
  // Resolves entirely from the local index. No network round-trip.
  // Renders within 200ms for 150 active employees

assignment.create(employeeId, projectId, startDate, endDate, billablePercentage, rateCardId?)
  -> { assignmentId }        // Enforces the 100% constraint at write time
assignment.update(assignmentId, fields)  -> { success }
assignment.cancel(assignmentId)          -> { success }

contextualIntelligence.get(employeeId) -> {
  skills, openRoles, references,
  burnoutAlert?,             // present only if the caller passes VPS-A004's check
  flightRiskSignal?
}
  // Absent fields are structurally absent, never null placeholders
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Each bar is an Assignment connecting Employee to Project. Bar position derives from `start_date` and `end_date` |
| G02 | Bench periods are derived as working days with no Active Assignment coverage, less days carrying Pitch-categorized time. Never stored, always computed |
| G03 | Every day count in this feature resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. No weekday or holiday assumption is made locally |
| G04 | The Contextual Intelligence Panel is one two-hop traversal from the selected Employee, filtered by node type, time relevance and [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s rules, resolved entirely from the local store |
| G05 | Ghost rows are Employee nodes with `employee_type = Ghost`. They participate in Assignment edges identically, including the 100% constraint |
| G06 | Aggregate utilization is computed live across the filtered cohort, never cached, and passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control before display |
| G07 | `effective_billing_rate` is resolved and written at Assignment write time. Before [[VRS-F006_Rate_Card_Engine|VRS-F006]] exists it is written as the employee's `billing_rate_default`; this feature never implements a fallback of its own at read time |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F005-S01 | Assignment data model and capacity constraint | Data |
| VRS-F005-S02 | Timeline rendering engine | UI |
| VRS-F005-S03 | Bench derivation and cost accumulation | Logic |
| VRS-F005-S04 | Filtering and aggregate utilization | Logic |
| VRS-F005-S05 | Contextual Intelligence Panel | Logic |

---

## Feature Acceptance Criteria

**GIVEN** all Employee and Assignment data is in the local graph
**WHEN** the forecast loads
**THEN** the full 90-day timeline renders within 200ms with no network request, every active employee visible with correct bars

---

**GIVEN** an employee has no Assignment covering the next twelve working days
**WHEN** the forecast renders
**THEN** the bench region renders `attention` at 12% fill with the accumulated cost in `mono-lg`, computed from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]'s working day count, with no dependency on [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] existing

---

**GIVEN** an employee with no covering Assignment has logged Pitch-categorized time on six of those days
**WHEN** the bench region is computed
**THEN** those six days are excluded, the region covers only the remaining days, and the cost figure reflects the reduction

---

**GIVEN** an assignment is created or modified anywhere in the product
**WHEN** the change is written locally
**THEN** the affected row updates within 1 second with no full page reload

---

**GIVEN** a filter for skill, seniority and availability together
**WHEN** it is applied
**THEN** only matching employees show, aggregate utilization recalculates for the filtered cohort, and it completes within 50ms

---

**GIVEN** a filter reduces the visible cohort to three employees
**WHEN** the aggregate is computed
**THEN** it is suppressed per [[VPS-A004_Graph_Permission_Layer|VPS-A004]] and renders the restricted state naming the reason, rather than displaying a figure for a group small enough to identify someone

---

**GIVEN** an employee has a BurnoutAlert and the viewer manages that specific employee
**WHEN** the Panel opens
**THEN** the alert is visible with severity and days active. A manager who does not manage them sees nothing

---

**GIVEN** an employee has wellness data and the viewer holds any role including Owner
**WHEN** the Panel opens
**THEN** no wellness information appears — no placeholder, no redaction marker, structurally absent

---

**GIVEN** a UAE entity whose working week excludes Friday and Saturday
**WHEN** bench days are counted across a fortnight
**THEN** four non-working days are excluded per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and no Saturday-Sunday assumption appears anywhere in the computation

---

**GIVEN** the device is offline
**WHEN** the forecast is opened
**THEN** the full timeline renders from local cache, the Offline indicator shows, and no read functionality is degraded

---

## Non-Functional Requirements

- Full 90-day timeline renders under 200ms for 150 active employees on a mid-range device
- Vertical scroll maintains 60fps at all times
- Horizontal scroll across a 180-day window maintains 60fps through virtualisation
- Affected rows re-render within 1 second of an underlying change, no full reload
- Filter application completes within 50ms from the local graph
- Ghost rows render within the same budget, no separate render pass
- Fully functional offline with no read degradation

---

## Security Considerations

- **The Contextual Intelligence Panel must never construct permission logic of its own.** It queries through the same interceptor as everything else. An engineer adding a new signal registers that node's tier and Privacy Class in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] first, rather than adding a bespoke visibility check here.
- **Aggregate utilization passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control**, including the differencing protection. A filtered view of eleven people and one of twelve must not allow the twelfth person's status to be recovered by subtraction.
- **Bench cost is compensation-derived and tier-scoped.** A viewer without compensation access sees the bench region and its day count, not the currency figure. The existence of bench time is operational; its cost is not universally readable.

---

## Out of Scope

- Rate card definition and resolution — [[VRS-F006_Rate_Card_Engine|VRS-F006]]
- Ghost Resource creation and promotion — [[VRS-F007_Ghost_Resources|VRS-F007]]
- Conflict resolution beyond the constraint and its error — [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]
- Alerting, escalation and notification on bench periods — [[VRS-F012_Revenue_Gap_Alert|VRS-F012]]
- Longer-horizon, skill-category capacity forecasting — [[VRS-F051_Team_Capacity_Planner|VRS-F051]]
- AI scheduling suggestions — [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]
- External project tool integration — [[VPS-F009_Vulto_Sync_API|VPS-F009]] and [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]]
- Export as PDF or image — [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]]

---

## Decisions Recorded

**The bench computation moves here from [[VRS-F012_Revenue_Gap_Alert|VRS-F012]], inverting the previous dependency.** Previously this feature deferred its amber state to the alerting engine, which meant the product's signature element did not exist until feature twelve and that a view depended on an alert to know what to render. The correct layering is the reverse: this feature owns the fact that a bench period exists and what it costs; [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] owns whether that fact warrants escalation. The Pitch exclusion moves with the computation, so it is still implemented once.

**The minimum-cohort question is closed**, and this document's only open item with it. [[VPS-A004_Graph_Permission_Layer|VPS-A004]] now owns one k-anonymity mechanism applied to every aggregate in the product, including this one. The previous framing left the Bench Forecast's filtered utilization entirely unprotected while four other features each built their own threshold.

**Every day count resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** This feature previously counted bench days against a hardcoded Saturday-Sunday weekend, which overstated bench cost for Gulf agencies and understated it for six-day weeks — in the one figure the product is most trusted to get right.

**A 180-day horizon is added** alongside 30 and 90. The hiring decisions this forecast is meant to inform have a lead time longer than ninety days, and [[VRS-F007_Ghost_Resources|VRS-F007]]'s Ghost Resources are only useful across a window long enough to contain a hire.

---

## Related Notes

- [[VPS-D001_Design_Foundations|VPS-D001]] — the signature element this feature renders
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days every count here resolves through
- [[VRS-F006_Rate_Card_Engine|VRS-F006]] — rate resolution feeding `effective_billing_rate`
- [[VRS-F007_Ghost_Resources|VRS-F007]] — Ghost rows
- [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] — what happens when the capacity constraint fires
- [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] — alerting built on this feature's bench computation

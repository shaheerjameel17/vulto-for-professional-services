---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F058
---

# VRS-F058 — People Analytics Dashboard

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] (UtilizationSnapshot, retained indefinitely — this feature's trend is a direct aggregation over that existing history), [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (start and end dates, from which headcount at any past date is reconstructed), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (departures, for a finer breakdown), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (HeadcountSnapshot), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (aggregate disclosure control)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Three metrics, three different relationships to history

Treating these as equivalent would have been a mistake, because they differ in what the graph actually preserves.

**Utilization requires no new storage.** [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] already stores a snapshot per employee per week, indefinitely, precisely so a historical week can be viewed without recomputation. This trend is an aggregation across weeks of data that already exists.

**Headcount requires no new storage either.** Employee nodes are never hard-deleted, and start and end dates are stable facts. Headcount at any past date is a count computed live.

**Composition is the one genuine gap.** Employment type and seniority are mutable fields, and nothing in this product preserves their history the way rate card versioning or a single-active-edge pattern preserves other changes. An employee promoted eighteen months ago has no trace on their own record of what they were before.

**This feature cannot honestly show composition further back than the point it started recording**, and says so plainly rather than fabricating a retroactive history that was never captured.

---

## What It Is

A leadership-facing, workspace-wide view across three metric families: a multi-month utilization trend, headcount movement over time, and team composition tracked forward from a monthly snapshot, honestly bounded by when that snapshot began.

---

## Problem It Solves

[[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] shows this week's utilization and [[VRS-F005_The_Bench_Forecast|VRS-F005]] shows the next ninety days of staffing, but **nothing shows whether utilization has been climbing or sliding over two quarters**, whether headcount growth matches the hiring the business planned for, or whether the mix of contractor versus permanent work has shifted in a way worth a leadership conversation.

Those are different questions from *what is true right now*, and nothing else in this product answers them.

---

## User-Facing Flows

### Utilization trend

An Owner or HR Admin selects a range and sees the workspace-wide aggregate plotted across it, each point drawn from stored weekly snapshots — aggregated, not recomputed.

### Headcount movement

The same audience sees headcount over the range, net growth, and hires against departures separately, computed live from employee dates and departure records.

### Team composition

By employment type and seniority, shown **from whenever the monthly snapshot began**, with an explicit visible boundary rather than a chart quietly starting at a false beginning. Composition before that point is not shown and not approximated.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| People analytics | Content | Three trends |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]. This is a screen visited when a question arises, not daily.

### Layout and components

Three Sections, each a Chart per [[VPS-D002_Component_Library|VPS-D002]]'s three permitted types.

**Utilization** is a line chart with the workspace target as a horizontal reference. Each point states its week on hover, with the contributing employee count — a week where forty people were active and one where twelve were are different weeks, and the line alone conceals it.

**Headcount** is a bar chart, hires and departures as opposing bars around a zero line, with net headcount as an overlaid line. Departures render `attention`, not `danger` — people leaving is an ordinary fact of running an agency, and coloring it as failure would misrepresent a normal quarter.

**Composition** is a stacked horizontal bar per snapshot month. **Where the requested range precedes the earliest snapshot, the chart begins at the earliest available date with a labeled boundary** — a dashed vertical rule and one line: *Composition tracking began March 2027.* Not a gap the eye interpolates across.

Every chart states its own date range and denominator in a caption, per [[VPS-D002_Component_Library|VPS-D002]]. A percentage without a denominator is a rumor.

### Keyboard

Standard bindings. `[` and `]` shift the range.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton charts at correct dimensions |
| Restricted | Owner, HR Admin and Finance Admin. Structurally absent for Manager and Team Member |
| Bounded | Composition renders from its earliest available date with the boundary labeled |
| Suppressed | A composition bucket below the k-anonymity threshold is merged into an Other bucket rather than displayed |
| Empty | *Not enough history yet.* with the date from which data will become available |
| Error | Not applicable |

### Responsive

Charts stack below 1280px. Below 1024px each becomes a compact summary with the trend direction and current value rather than a plotted series.

---

## Technical Architecture

### The HeadcountSnapshot schema

An aggregate with no individual identified.

```
snapshot_id:         UUID v4
workspace_id:        UUID
snapshot_date:       date — always the first of the month
total_headcount:     integer
by_employment_type:  JSON map: { FullTime, PartTime, Contractor, Intern }
by_seniority_level:  JSON map: { Junior, Mid, Senior, Lead, Principal,
                     Director, CLevel }

— Universal Node Conventions per VPS-A002 —
```

One per calendar month, taken automatically per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. **This feature does not backfill snapshots for months before its own deployment.**

### Utilization, an aggregation

Reads every employee's stored snapshot across the requested weeks and aggregates per week exactly as [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s own agency view aggregates the current week. **No new percentage calculation is invented** — that feature's arithmetic, run across many stored weeks instead of one live one.

Which means, correctly, that this trend uses expected working hours as its denominator throughout, per that feature's own definition.

### Headcount, reconstructed live

Counts employee nodes whose start date falls on or before each point and whose end date is null or later. **No snapshot is needed**, because nothing in this computation depends on a mutable field.

### Composition disclosure

A seniority or employment-type bucket containing fewer members than [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s threshold is **merged into an Other bucket** rather than displayed.

A workspace with one Director and one C-Level has a composition chart that identifies both by their bucket size, and in a small agency a bucket of one is a person. Merging rather than suppressing keeps the total honest while removing the identification.

### API contracts

```
peopleAnalytics.getUtilizationTrend(workspaceId, startDate, endDate) -> {
  weeklyPoints: { weekStartDate, aggregatePercentage, contributingEmployees }[]
}

peopleAnalytics.getHeadcountTrend(workspaceId, startDate, endDate, granularity) -> {
  points: { date, headcount, hires, departures }[]
}

peopleAnalytics.getCompositionTrend(workspaceId, startDate, endDate) -> {
  points: { snapshotDate, byEmploymentType, bySeniorityLevel }[],
  earliestAvailableDate: string
}
  // Buckets below the disclosure threshold are merged into Other
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | HeadcountSnapshot carries the schema above. One per calendar month, no individual identified |
| G02 | Utilization is aggregated entirely from [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s existing retained snapshots. No parallel utilization storage exists |
| G03 | Headcount is computed live from employee dates. No snapshot field is used for it |
| G04 | `getCompositionTrend` always returns `earliestAvailableDate`. A range preceding it returns only the portion that exists, never a fabricated or interpolated value |
| G05 | Composition buckets below [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s threshold are merged into Other, never displayed at their true size |
| G06 | Snapshots are never backfilled for months before deployment |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F058-S01 | Utilization trend aggregation | Logic |
| VRS-F058-S02 | Headcount trend computation | Logic |
| VRS-F058-S03 | Monthly snapshot job and composition trend | Data |
| VRS-F058-S04 | Leadership trend views | UI |

---

## Feature Acceptance Criteria

**GIVEN** six months of stored utilization snapshots exist
**WHEN** the trend is requested for that range
**THEN** each weekly point reflects the aggregate of that week's stored snapshots, matching what [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s agency view would have shown live at the time

---

**GIVEN** an employee started eight months ago and another departed two months ago
**WHEN** headcount is requested for a date four months back
**THEN** the first counts and the second does not yet, both computed from their own dates

---

**GIVEN** the monthly snapshot job has run for only three months
**WHEN** a twelve-month composition trend is requested
**THEN** three months are returned with `earliestAvailableDate`, and the chart shows a labeled boundary rather than twelve months with fabricated early points

---

**GIVEN** a workspace has one Director and one C-Level against a threshold of five
**WHEN** composition renders
**THEN** both are merged into an Other bucket, the total remains correct, and neither is identifiable by bucket size

---

**GIVEN** a Manager requests any trend from this feature
**WHEN** the request is made
**THEN** it is structurally absent. This is workspace-wide leadership data with nothing scoped to their team

---

**GIVEN** a utilization point is hovered
**WHEN** it renders
**THEN** the contributing employee count is shown alongside the percentage

---

## Non-Functional Requirements

- A twelve-month utilization or headcount trend resolves within 1 second from the local graph
- Full functionality offline
- The monthly snapshot job is idempotent per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. A repeated run in the same month produces no second snapshot

---

## Security Considerations

- **HeadcountSnapshot carries no individual identification.** The smallest unit it reports is a bucket, never a person — but a bucket of one is a person, which is why sub-threshold buckets merge into Other rather than displaying.
- **Manager's exclusion is deliberate, not an oversight.** Every other manager-related correction in this project widened access where a manager was meant to act. This is the opposite case: the feature is workspace-wide by definition, so nothing here is scoped to their team and Standard's usual manager grant does not apply.
- **Finance Admin is included** alongside Owner and HR Admin, since headcount and composition trends are direct inputs to a cost forecast and excluding the role responsible for that would be arbitrary.
- **A trend over people is a different disclosure from a snapshot of them.** A composition chart showing contractor share climbing over eighteen months, in a small agency, tells a reader things about specific individuals' arrangements that no single month's figure would. The disclosure threshold applies per bucket per point, not to the series as a whole.

---

## Out of Scope

- **Backfilling composition before deployment** — deliberately not attempted. The boundary is stated instead
- **Industry benchmark comparison** — [[VRS-F072_Agency_Benchmarking|VRS-F072]]
- **Per-team or per-manager breakdowns** — workspace-wide by definition. A team-scoped equivalent belongs to [[VRS-F049_Manager_Dashboard|VRS-F049]], not a rescoping of this
- **Cost or payroll trends** — [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]]. This feature counts people, not money
- **Predicting a future trend.** Three plotted series and no extrapolation. A projected headcount line would be a forecast this feature has no basis for making

---

## Decisions Recorded

**Composition buckets below the disclosure threshold merge into Other.** The previous specification treated HeadcountSnapshot as safe by virtue of being an aggregate, which holds only where buckets are large. A bucket of one is a person, and in a twenty-person agency several buckets will be.

**Utilization points state their contributing employee count.** A week where forty people were active and one where twelve were are different weeks, and a line alone conceals it — particularly across a period of growth, where a rising trend may reflect a changing denominator rather than changing behavior.

**Finance Admin is added** to the permitted roles. Headcount and composition are direct inputs to a cost forecast, and excluding the role responsible for that was arbitrary.

**Departures render `attention`, not `danger`.** People leaving is an ordinary fact of running an agency, and coloring a normal quarter as failure misrepresents it.

**The composition boundary is a labeled rule, not a gap.** A chart that simply starts later invites the reader to assume the data was flat before it; an explicit boundary states that it was not recorded.

---

## Related Notes

- [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] — the snapshots this feature aggregates
- [[VRS-F059_Retention_Analytics|VRS-F059]] — retention analytics, the deeper cut at departures
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the disclosure control applied per bucket

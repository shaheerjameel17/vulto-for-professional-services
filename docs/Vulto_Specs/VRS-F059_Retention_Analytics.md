---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F059
---

# VRS-F059 — Retention Analytics

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (start and end dates, seniority — reconstructable retroactively), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (Departure, the primary turnover event source), [[VRS-F039_Performance_Review_Cycle|VRS-F039]] (ReviewEntry ratings, used only for the regrettable breakdown), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (**the unified disclosure control, replacing this feature's former private threshold**)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Not [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] restated

That feature computes headcount over time — raw counts, hires against departures. **This normalizes turnover into a rate**, breaks it down by cause and cohort, and correlates with performance data to distinguish regrettable turnover from turnover the agency would have chosen anyway.

That last correlation combines two features' structured records — a departure and a rating, not an already-interpreted alert. It stays a statistical correlation rather than Standing Rule 7's territory, the same conclusion [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] reaches for the same reason.

---

## What It Is

Turnover and retention reporting: an annualised rate, voluntary against involuntary, cohort retention curves showing what fraction of a hiring period's intake remains at successive milestones, and — where enough data exists to say so responsibly — how much of voluntary turnover is regrettable.

---

## Problem It Solves

[[VRS-F058_People_Analytics_Dashboard|VRS-F058]]'s headcount trend answers *is the team growing*. It does not answer **is turnover higher than it should be**, **are we losing our best people or the ones we would have let go**, or **do people hired in a particular quarter tend to stay**.

Those are the questions retention planning needs, and none is a raw headcount number.

---

## User-Facing Flows

### Turnover rate

An Owner, HR Admin or Finance Admin — the last for the aggregate rate only — sees turnover for a period: departures over average headcount, annualised for comparability across period lengths.

### Voluntary against involuntary

Split by departure type. Resignation and Retirement grouped as voluntary; Termination as involuntary; **EndOfContract reported separately**, since a planned conclusion is not attrition in either direction and folding it into either would misstate both.

### Cohort retention

For a selected hire-month cohort, what fraction remain at 6, 12 and 24 months — wherever the cohort is large enough to report responsibly.

### Regrettable turnover

What fraction of voluntary departures had a most-recent rating of Exceeds or Outstanding. A genuinely different question from the rate itself, and frequently the one that matters: **a firm at 18% turnover losing nobody it wanted to keep has a different problem from one at 12% losing its three best people.**

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Retention | Content | All four analyzes |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

### Layout and components

Four Sections.

**Turnover rate** leads with a Stat: the annualised percentage in `display`, with the departure count and average headcount beneath in `mono`. Both are shown, always — a rate without its constituents is unverifiable, and in a small workspace the difference between 8 of 100 and 2 of 25 matters to how much weight a reader gives it.

**Voluntary against involuntary** is a single stacked horizontal bar per [[VPS-D002_Component_Library|VPS-D002]], three segments in categorical colors. **Not `danger` for involuntary** — a termination is a decision the agency made, not a failure that befell it.

**Cohort retention** is a line chart, one line per cohort, plotted against months since hire. Cohorts below threshold are absent from the chart entirely rather than plotted with a suppressed point, since a partially drawn line implies a shape the data does not support.

**Regrettable turnover** is a Stat with its sample size stated beside it, and a `small` caption naming the definition explicitly: *voluntary departures whose most recent review rated Exceeds or Outstanding.* A figure this consequential should carry its own definition, because two readers will otherwise assume two different ones.

### Keyboard

Standard bindings. `[` and `]` shift the period.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner and HR Admin see all four. Finance Admin sees the rate and the breakdown, never the regrettable analysis |
| Suppressed | Below threshold, the analysis states insufficient data with the reason, never a computed figure |
| Empty | *Not enough history yet.* |
| Error | Not applicable |

### Responsive

Sections stack below 1280px.

---

## Technical Architecture

### No new node type

Every figure is reconstructed from durable data. Turnover counts and average headcount both come from employee start and end dates, the same way [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] reconstructs headcount. **Nothing about turnover requires new storage.**

### Cohort retention

For a hire-month cohort, retention at N months is the fraction whose end date is null or later than start plus N months. Computed directly.

### Regrettable turnover

For each voluntary departure reaching Completed, the departing employee's most recent finalized review before their last working date is checked. Exceeds or Outstanding counts it regrettable.

**A departure with no finalized review at all is excluded from the denominator**, not counted as non-regrettable. Someone who left before their first review cycle tells you nothing about whether their loss was regrettable, and counting them as though it does would systematically understate the figure in a growing agency — which is precisely the agency most likely to be losing good people fast.

### Disclosure control

Cohort retention and regrettable turnover both pass through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s mechanism.

**This feature previously carried its own threshold key.** The unified mechanism additionally provides differencing protection, which the private implementation did not: a cohort of twelve and the same cohort excluding one seniority level, eleven, would otherwise reveal an individual's tenure by subtraction.

### API contracts

```
retention.getTurnoverRate(workspaceId, startDate, endDate) -> {
  annualisedRate, departureCount, averageHeadcount
}

retention.getBreakdown(workspaceId, startDate, endDate) -> {
  voluntary, involuntary, endOfContract
}

retention.getCohortRetention(workspaceId, hireMonth) -> {
  cohortSize,
  retentionAt6Months: number | Suppressed | 'notYetElapsed',
  retentionAt12Months: number | Suppressed | 'notYetElapsed',
  retentionAt24Months: number | Suppressed | 'notYetElapsed'
}
  // Each milestone withheld independently. notYetElapsed and Suppressed are
  // distinct: one is not knowable yet, the other is knowable and withheld

retention.getRegrettableTurnover(workspaceId, startDate, endDate) -> {
  regrettablePercentage, sampleSize, excludedNoReview
} | Suppressed
  // Owner and HR Admin only
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type. Every figure is reconstructed from data that already persists |
| G02 | Cohort retention and regrettable turnover pass through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control. This feature defines no threshold of its own |
| G03 | A milestone not yet reachable in elapsed time is reported distinctly from one suppressed for cohort size |
| G04 | A voluntary departure with no finalized review is excluded from the regrettable denominator, and the exclusion count is reported |
| G05 | Regrettable turnover correlates two structured records, never an already-interpreted alert. It remains outside Standing Rule 7 |
| G06 | Turnover rate and the breakdown are workspace-wide. Neither is scoped to a manager's team |
| G07 | Finance Admin sees the rate and the breakdown only. The regrettable analysis depends on review data outside their standing access |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F059-S01 | Turnover rate and breakdown | Logic |
| VRS-F059-S02 | Cohort retention | Logic |
| VRS-F059-S03 | Regrettable turnover correlation | Logic |

---

## Feature Acceptance Criteria

**GIVEN** 8 departures against an average headcount of 100 over six months
**WHEN** the rate is requested
**THEN** the annualised figure reflects that ratio scaled to twelve months, with both constituents shown

---

**GIVEN** a cohort of 12 with 10 still employed at twelve months
**WHEN** cohort retention is requested
**THEN** the twelve-month figure reflects 10 of 12, and the twenty-four-month figure is reported as not yet elapsed rather than suppressed

---

**GIVEN** a cohort of 3 against a threshold of 5
**WHEN** retention is requested
**THEN** every milestone is suppressed with the reason, and the cohort is absent from the chart rather than partially drawn

---

**GIVEN** 6 voluntary departures of which 2 had no finalized review
**WHEN** regrettable turnover is computed
**THEN** the denominator is 4, the excluded count is reported, and the two are not counted as non-regrettable

---

**GIVEN** a Finance Admin requests the regrettable breakdown
**WHEN** the request is made
**THEN** it is refused. Their access covers the aggregate rate and the cause breakdown only

---

**GIVEN** a Manager requests any of this feature's data
**WHEN** the request is made
**THEN** it is structurally absent

---

## Non-Functional Requirements

- All four analyzes resolve within 1 second for up to 500 historical employee records
- Full functionality offline

---

## Security Considerations

- **Finance Admin's access is deliberately narrower than Owner's, a genuine split within one feature.** The aggregate rate is cost-relevant and within their remit; the regrettable breakdown depends on review data they have no standing access to elsewhere, and this feature does not grant them a new route to it.
- **Disclosure control applies per analysis, not per feature.** A percentage computed from a handful of people functions as individual disclosure regardless of which feature computes it — and a cohort of four where three left is a statement about three specific colleagues.
- **The regrettable figure names people implicitly.** In a workspace where two good performers left last quarter, a regrettable turnover figure of 100% is not anonymous to anyone who works there. The threshold is what prevents it, and it is why this analysis sits at the narrowest audience in the feature.

---

## Out of Scope

- **Predicting future turnover** — [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] covers forward-looking per-employee risk. This reports historical fact
- **Department or skill-category breakdowns** — organizational grouping beyond seniority is not clean enough in this schema to break down without risking small-sample disclosure. Not attempted
- **Cost-of-turnover modeling** — a natural connection to [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]]'s cost figures, not built here
- **Exit interview data** — not collected anywhere in this product, and a reason field on a departure is not one

---

## Decisions Recorded

**The private threshold is replaced by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s mechanism**, which adds differencing protection the previous implementation lacked.

**A departure with no finalized review is excluded from the regrettable denominator rather than counted as non-regrettable.** Someone who left before their first review tells you nothing, and counting them systematically understates the figure in a fast-growing agency — the agency most likely to be losing good people quickly.

**`notYetElapsed` and `Suppressed` are reported distinctly.** One means not knowable yet; the other means knowable and withheld. Conflating them would let a reader assume a cohort was too small when it was simply too recent.

**Involuntary turnover is not colored `danger`.** A termination is a decision the agency made, not a failure that befell it.

**The regrettable figure carries its definition in the interface.** Two readers will otherwise assume two different ones, and this is the figure most likely to be quoted in a board meeting.

---

## Related Notes

- [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] — the headcount trend this feature is not
- [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] — the forward-looking counterpart
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the disclosure control applied here

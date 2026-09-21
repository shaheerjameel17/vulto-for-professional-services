---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F072
---

# VRS-F072 — Agency Benchmarking

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F071_Salary_Benchmarking|VRS-F071]] (**the entire cross-tenant mechanism — the anonymization principle, the histogram, the service itself — reused not rebuilt**), [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] (utilization rate), [[VRS-F059_Retention_Analytics|VRS-F059]] (turnover rate), [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] (bench duration), [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (time-to-fill)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## The aggregation-over-encrypted-data question, and why it does not apply

This feature was flagged from the beginning as facing the same unresolved problem [[VRS-F071_Salary_Benchmarking|VRS-F071]] carried: computing a cross-tenant aggregate without any tenant's data being readable by Vulto.

**A finding worth stating honestly: it does not face that problem at all.**

Utilization rate, turnover rate, bench duration and time-to-fill are all **Tier 0 or Tier 2** — Standard or HR-restricted operational data, not compensation. The originally-anticipated Tier 1 exposure is not where this feature's sensitivity lives.

That does not make the anonymization optional. **An agency's own utilization and turnover figures are commercially sensitive without touching a single salary** — a competitor learning that a firm's utilization sits at 58% has learned something they could act on. The same mechanism applies with equal rigor, for a different reason than the one originally assumed.

---

## What It Is

An opt-in cross-tenant benchmark of four operational metrics, **grouped by agency size** — because comparing a five-person studio to a two-hundred-person agency answers nothing useful.

Utilization rate, turnover rate, average bench duration, and average time-to-fill.

---

## Problem It Solves

An agency owner has no honest way to know whether their **68% utilization is strong, average or concerning for a firm their size**, because nothing outside their own four walls tells them.

That specific number is the one this product makes most visible and gives least context to. [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] shows it weekly, [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] shows its trend, and neither can say whether it is good.

---

## User-Facing Flows

### Opting in

An Owner enables participation. **The same exchange [[VRS-F071_Salary_Benchmarking|VRS-F071]] establishes** — contribute anonymized banded figures, gain query access — and a workspace opted into one is not automatically opted into the other. Compensation data and operational data are different decisions.

### Viewing a benchmark

An Owner or Finance Admin selects a metric and sees percentiles for agencies of a similar size, with the sample size, or honestly that there is not yet enough data for that band.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Agency benchmarks | Content | Four metrics, one view |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]], alongside [[VRS-F071_Salary_Benchmarking|VRS-F071]]'s own surface, with the two opt-ins clearly separate.

### Layout and components

Four Sections, one per metric, each a horizontal percentile scale with **the workspace's own current figure marked on it.**

That marker is the feature. A percentile table tells an owner what the range is; the same range with their own figure on it tells them where they stand, which is the only thing they opened this to learn.

Beneath each, the sample size and the size band in `numeric`, always.

**Where the workspace's own figure cannot be computed** — a firm with too little history for a turnover rate — the percentiles render without a marker and say so, rather than omitting the metric entirely. Knowing the market range is useful even before you can place yourself in it.

A size band selector sits above, defaulting to the workspace's own, and it is deliberately changeable: an agency of thirty planning to reach eighty has a legitimate reason to look at the band above.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Not opted in | The explanation renders in place of the benchmarks, with [[VRS-F071_Salary_Benchmarking|VRS-F071]]'s opt-in noted as separate |
| Insufficient | Per metric, per band. One metric may have enough data while another does not |
| Restricted | Owner and Finance Admin. Structurally absent for Manager, HR Admin and Team Member |
| No own figure | Percentiles render without the marker, with the reason stated |
| Error | Not applicable |

### Responsive

Sections stack. Each scale becomes a compact range with the marker below 1024px.

---

## Technical Architecture

### Nothing new is built

This feature submits to and queries **the same `services/cross-tenant-aggregation`** [[VRS-F071_Salary_Benchmarking|VRS-F071]] registered. No second service, no second anonymization design, no second histogram engine.

**A different contribution shape, through infrastructure that already exists.**

### The contribution payload

```
agency_size_band:           enum: 1-10, 11-50, 51-200, 201+ — derived from the
                            workspace's own headcount at submission
utilization_rate_band:      string — 5-point bands, computed client-side from
                            VRS-F011's aggregate
turnover_rate_band:         string — banded, from VRS-F059
avg_bench_days_band:        string — banded, from VRS-F012
avg_time_to_fill_days_band: string — banded, from VRS-F028's creation-to-hire
                            duration
contribution_month:         "YYYY-MM"
```

**No field may include a workspace identifier or an unbanded figure**, the identical permanent constraint [[VRS-F071_Salary_Benchmarking|VRS-F071]] enforces.

### Why the size band is itself a disclosure risk, and how it is handled

An agency of 220 people in the 201+ band, in a pool where few agencies that size participate, is close to identifiable by its own contribution.

**The threshold therefore applies per size band per metric**, not to the pool overall. A band with too few contributors returns insufficient data regardless of how much data exists in adjacent bands.

### Time-to-fill uses working days

Derived from [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s requisition-to-hire duration, counted through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. A forty-calendar-day time-to-fill spanning Eid and a public holiday period is not forty working days, and a benchmark comparing agencies across the UK, Pakistan and the UAE on calendar days would compare different things.

### API contracts

```
agencyBenchmark.optIn(workspaceId)  -> { success }
  // Separate from VRS-F071's opt-in. Neither implies the other

agencyBenchmarkContribution.submit(agencySizeBand, utilizationRateBand,
                                   turnoverRateBand, avgBenchDaysBand,
                                   avgTimeToFillDaysBand, contributionMonth)
  -> { success }

agencyBenchmark.getBenchmark(agencySizeBand, metric) -> {
  percentiles: { p25, p50, p75 },
  sampleSize, asOfMonth,
  ownFigure?: number
} | { insufficientData: true, currentSample, threshold }
  // ownFigure is computed locally and never transmitted
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | No node type is registered. Data lives in [[VRS-F071_Salary_Benchmarking|VRS-F071]]'s existing service |
| G02 | A contribution never carries a workspace identifier or an unbanded figure |
| G03 | No second aggregation service is registered. This is an additional contribution schema and query surface against the existing one |
| G04 | The threshold applies per size band per metric, not to the pool overall |
| G05 | Opt-in is separate from [[VRS-F071_Salary_Benchmarking|VRS-F071]]'s. Neither implies the other |
| G06 | The workspace's own figure is computed locally and never transmitted |
| G07 | Time-to-fill counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F072-S01 | Contribution schema and monthly submission | Security |
| VRS-F072-S02 | Benchmark query with own-figure marker | UI |

---

## Feature Acceptance Criteria

**GIVEN** a workspace of 35 people at 71% utilization opts in
**WHEN** the monthly contribution runs
**THEN** the size band is 11-50 and the utilization band is the containing 5-point band, never 71% exactly, with no workspace identifier attached

---

**GIVEN** only 3 agencies in the 201+ band have contributed
**WHEN** a benchmark is requested for that band
**THEN** insufficient data is returned, regardless of how much data exists in the 51-200 band

---

**GIVEN** enough agencies in the 11-50 band have contributed
**WHEN** turnover is requested
**THEN** percentiles are returned with the sample size, and the workspace's own figure is marked on the scale, computed locally

---

**GIVEN** a workspace with too little history to compute its own turnover rate
**WHEN** the benchmark renders
**THEN** the percentiles render without a marker, with the reason stated, rather than the metric being omitted

---

**GIVEN** a workspace has opted into [[VRS-F071_Salary_Benchmarking|VRS-F071]] but not this feature
**WHEN** this feature's surface is opened
**THEN** the opt-in explanation renders, and no contribution has been submitted

---

**GIVEN** a Manager or HR Admin attempts to query a benchmark
**WHEN** the request is made
**THEN** it is refused

---

**GIVEN** two agencies in different jurisdictions with the same calendar time-to-fill
**WHEN** their contributions are computed
**THEN** each reflects working days per its own calendar, so the comparison is between comparable things

---

## Non-Functional Requirements

- A benchmark query resolves within 500ms
- Contributions and queries flow through [[VRS-F071_Salary_Benchmarking|VRS-F071]]'s already-isolated service, unmodified
- Own-figure computation runs locally from the workspace's own graph
- The query surface functions only online

---

## Security Considerations

- **This feature makes no new privacy decision.** Every guarantee and the one stated limitation both come from [[VRS-F071_Salary_Benchmarking|VRS-F071]] unchanged, since this is the same mechanism with a different payload.
- **The size band is the disclosure vector here**, not compensation, and it is why the threshold applies per band. A large agency in a sparsely populated band is close to identifiable by its own contribution, in a way that no individual contributor to a salary benchmark is.
- **Separate opt-in is deliberate.** A firm might reasonably share operational metrics and not compensation, or the reverse, and bundling them would force a decision neither question deserves.
- **The four metrics are Tier 0 and Tier 2, not Tier 1**, and this is worth stating because the original concern assumed otherwise. A future metric requiring Tier 1 aggregation would need the same scrutiny [[VRS-F071_Salary_Benchmarking|VRS-F071]] gave that question, not an assumption that this feature's design covers it.

---

## Out of Scope

- **Any metric requiring Tier 1 data** — the four here are deliberately not. A future one would need its own scrutiny
- **Industry or specialization grouping** — this product does not track an agency's vertical in a structured way. Size band is the only grouping dimension
- **The stronger multi-party aggregation upgrade** — inherited from [[VRS-F071_Salary_Benchmarking|VRS-F071]], not re-decided here
- **Benchmarking against a specific named competitor** — permanently excluded. The pool is anonymous by construction, and a feature that identified a participant would defeat the mechanism entirely

---

## Decisions Recorded

**The originally-anticipated Tier 1 problem does not exist here**, and saying so is more useful than inheriting a concern that does not apply. The four metrics are Tier 0 and Tier 2. The anonymization still applies, for a commercial-sensitivity reason rather than a compensation one.

**The threshold applies per size band per metric**, not to the pool. A large agency in a sparse band is close to identifiable by its own contribution, which is a disclosure vector this feature has and [[VRS-F071_Salary_Benchmarking|VRS-F071]] does not.

**Opt-in is separate.** A firm might share operational metrics and not compensation, and bundling forces a decision neither deserves.

**The workspace's own figure is marked on the scale.** A percentile range tells an owner what the market is; the same range with their own figure on it tells them where they stand, which is what they opened it to learn.

**Time-to-fill counts working days.** A benchmark comparing agencies across three jurisdictions on calendar days is comparing different things.

**The citation error is resolved by the renumbering.** The previous set cited this feature under two different numbers across three documents. Both now cite this document.

---

## Related Notes

- [[VRS-F071_Salary_Benchmarking|VRS-F071]] — the mechanism reused entirely
- [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] — the utilization figure benchmarked
- [[VRS-F059_Retention_Analytics|VRS-F059]] — the turnover figure benchmarked
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days time-to-fill counts

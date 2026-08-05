---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F071
---

# VRS-F071 — Salary Benchmarking

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (the Tier 1 compensation fields this feature never sees in raw form), [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] (**the anonymization-by-absence-of-link pattern, extended here from one workspace's team to across separate workspaces**), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (jurisdiction, a benchmark dimension), [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] (the internal band a benchmark is compared against), [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (`services/cross-tenant-aggregation`, already registered there)
**Blocks:** [[VRS-F072_Agency_Benchmarking|VRS-F072]], which reuses this feature's mechanism rather than solving the same problem twice

This document is the single source of truth for this feature.

---

## The hardest privacy problem in this project

Every time this class of question arose earlier, the answer was deferred deliberately: computing an aggregate across data that is end-to-end encrypted is not something to guess at in advance. **This is the feature that arrives first, and the answer given here is meant to serve [[VRS-F072_Agency_Benchmarking|VRS-F072]] as well** rather than being improvised twice.

**The tension, stated exactly.** Vulto should be able to offer accurate salary benchmarking built on real, first-party compensation data across many customer workspaces, without Vulto's own servers being able to read any individual's salary or any single company's compensation structure.

That is achievable, with one honest caveat stated plainly below. And the design that gets there is not exotic — it is the same anonymization-by-absence-of-link principle [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] already proved at smaller scale, extended across company boundaries rather than across a team.

---

## The architecture, before the schema

### What never leaves a workspace

**The exact figure in an employee's compensation fields never leaves the workspace it belongs to, in any form, encrypted or otherwise.** Tier 1's guarantee is not weakened, relaxed, or given an exception for this feature. Nothing here asks it to bend.

### What does leave, and why it is genuinely anonymous

When a workspace opts in, once a month, for each employee with compensation on record, **the client** — the same device that already holds decrypted access to that workspace's Tier 1 data — computes a single contribution: a role category, a seniority level, a jurisdiction, and a **salary band**, a range rather than a figure.

**That contribution carries no employee identifier and no workspace identifier.** It is anonymized by the structural absence of an identifying link, not by a permission rule governing a link that still exists — the identical principle [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] established, applied across companies rather than within one.

### Why a band, and why that is not an accuracy compromise

Every compensation survey this industry already trusts reports ranges and percentiles, never an exact average to the currency unit. **Reporting a band is not a privacy-driven downgrade; it is how this data is honestly presented everywhere it is done well.** Percentiles interpolated from binned contributions are the accurate, industry-normal form regardless of the privacy question.

### The threshold

A result is returned only where the cohort meets the platform-wide minimum. Below it, insufficient data — **never a figure computed from too few contributions to avoid functioning as individual disclosure.**

This threshold is a platform constant, not a workspace setting, since **no single workspace can be permitted to tune a threshold governing a shared pool.**

### The honest limitation

**Vulto's infrastructure, as an operator, can observe that a specific authenticated workspace submitted a contribution in a given month.** That is an unavoidable property of normal authenticated infrastructure, not something this document can design away without a materially larger investment.

What it cannot determine is **which employee any contribution describes, or that employee's exact figure** — only a band. That is a real and meaningfully scoped guarantee. It is not the strongest cryptographically possible, and the stronger version is named below rather than left unmentioned.

### The stronger version, named rather than overstated

Secure aggregation protocols — most concretely Prio, developed at Mozilla and used in production telemetry and public health systems — split each contribution into secret shares across two or more independent, non-colluding servers, such that **no single server, including a compromised one, ever reconstructs an individual contribution at all.**

That would close the limitation above entirely, at the cost of operating genuinely independent server operators — a real organizational commitment, not a configuration change.

**This document does not build it**, because the design here already delivers the guarantee actually asked for. It is named explicitly as the correct next step if a stronger one is ever wanted.

---

## What It Is

An opt-in cross-tenant salary benchmark. A workspace's Owner enables participation; in exchange for contributing anonymized, banded data monthly, that workspace gains access to percentile benchmarks for any role, seniority and jurisdiction combination with enough data to answer honestly.

---

## Problem It Solves

An agency deciding what to offer a new Senior Engineer, or whether an existing employee has fallen behind market, has no first-party, current, jurisdiction-specific answer today — only third-party surveys that are expensive, slow, or not calibrated to this industry.

**Vulto is positioned to have exactly the data that would answer this**, drawn from real, current compensation across many agencies already using the product — if it can be aggregated without becoming the thing every customer would rightly refuse to join.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Benchmarking | Content | Opt-in and query |
| Benchmark result | Panel | Percentiles against the internal band |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

### Layout and components

**The opt-in surface states the exchange plainly**, once, in prose rather than a legal block: what is contributed, in what form, what is never contributed, what is received, and the honest limitation above. A single Switch beneath.

This is the one screen in the product where a wall of explanatory text is correct. A person deciding whether to contribute their company's compensation data to a shared pool should read something before they do.

**The query surface** is three Selects — role category, seniority, jurisdiction — and a result.

**The result is where this feature earns its place.** A horizontal scale showing the 25th, 50th, 75th and 90th percentiles, with **the workspace's own band from [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] overlaid on the same scale**, and where a specific employee is being considered, their position marked too.

That overlay is the whole point. A percentile table is information. The same percentiles with the firm's own band drawn across them is a decision — *our midpoint sits at the market 40th* is actionable in a way two separate numbers on two separate screens never are.

Sample size renders beneath in `mono`, always. A benchmark without its sample is a rumor.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Not opted in | The query surface does not render. The opt-in explanation renders in its place |
| Insufficient | *Not enough data for this combination yet.* with the current sample size and the threshold both stated |
| Restricted | Owner, HR Admin and Finance Admin. Structurally absent for Manager and Team Member |
| No internal band | Percentiles render without the overlay, with a line noting that defining a band in [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] makes the comparison actionable |
| Error | Not applicable |

### Responsive

The percentile scale becomes a vertical list below 1024px.

---

## Technical Architecture

### The aggregation service

`services/cross-tenant-aggregation`, registered in [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]], runs **entirely outside the sync engine's per-workspace trust boundary.** It has no access to any workspace's graph, encrypted or otherwise. It receives only already-anonymized, already-bucketed contributions.

### The contribution payload, stated exhaustively

```
role_category:      string — matches Skill.category per VRS-F013
seniority_level:    enum per VRS-F002
jurisdiction:       enum per VRS-F003
salary_band:        string — computed client-side. Bands are 10,000 wide below
                    200,000 annualised and 20,000 wide above, coarser at the
                    high end where a narrow band is more identifying against
                    a smaller population
currency:           ISO 4217
contribution_month: "YYYY-MM" — month precision only, never a specific date,
                    reducing timing-correlation risk
```

**No field here, and no field ever added to it, may include an employee identifier, a workspace identifier, or an exact figure.** A permanent constraint on this schema, not a first-version simplification.

### Histogram aggregation, contributions not retained

The service maintains a running histogram — counts per bucket per combination per month. **A contribution increments a bucket and is not separately retained once incorporated.** There is no stored list of individual contributions to later analyze or correlate, only the counts.

### Percentile computation

Linear interpolation within the histogram's bins, the standard technique real compensation surveys use for banded data, computed across the trailing twelve months by default so the benchmark is rolling rather than one month's thin sample.

### API contracts

```
salaryBenchmark.optIn(workspaceId)  -> { success }
salaryBenchmark.optOut(workspaceId) -> { success }
  // Opting out stops future contribution and revokes query access.
  // Already-incorporated histogram counts are not removed — they are no
  // longer attributable to anything, so there is nothing to remove

salaryBenchmarkContribution.submit(roleCategory, seniorityLevel, jurisdiction,
                                   salaryBand, currency, contributionMonth)
  -> { success }
  // Client-side, monthly. No identifying field exists in this contract for
  // any caller to accidentally include

salaryBenchmark.getBenchmark(roleCategory, seniorityLevel, jurisdiction) -> {
  percentiles: { p25, p50, p75, p90 },
  sampleSize, asOfMonth,
  internalBand?: { minimum, midpoint, maximum }
} | { insufficientData: true, currentSample, threshold }
  // internalBand is read locally from VRS-F070 and never transmitted
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | No node type is registered for this feature. Its data lives entirely in the cross-tenant service, outside any workspace's graph |
| G02 | A contribution never carries an employee identifier, a workspace identifier, or an exact figure — structurally, not by convention |
| G03 | The service retains histogram counts only. Individual contributions are not stored once incorporated |
| G04 | A result is withheld below the minimum sample size, checked before any percentile is computed |
| G05 | The threshold is a platform constant, never a workspace setting |
| G06 | The internal band overlay is read locally from [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] and never transmitted to the service |
| G07 | Contribution computation runs client-side on an authorized device. No server-side path computes a band from a compensation figure |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F071-S01 | Opt-in participation | Data |
| VRS-F071-S02 | Client-side bucketing and monthly contribution | Security |
| VRS-F071-S03 | Cross-tenant aggregation service and histogram | Security |
| VRS-F071-S04 | Benchmark query with internal band overlay | UI |

---

## Feature Acceptance Criteria

**GIVEN** a workspace opts in and has an employee on 147,500 annually
**WHEN** the monthly contribution runs
**THEN** the submitted band is the 10,000 band containing that figure, never the exact number, with no employee or workspace identifier accompanying it

---

**GIVEN** only 4 contributions exist for a combination against a threshold of 8
**WHEN** a benchmark is requested
**THEN** insufficient data is returned with the current sample and the threshold both stated

---

**GIVEN** 20 contributions exist across many workspaces
**WHEN** the benchmark is requested
**THEN** percentiles are returned by interpolation across the histogram, with the sample size shown

---

**GIVEN** the workspace has a band defined in [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] for that level
**WHEN** the result renders
**THEN** the band is overlaid on the same scale as the percentiles, read locally and never transmitted

---

**GIVEN** a security review inspects the aggregation service's database directly
**WHEN** the inspection runs
**THEN** no field anywhere resolves to a specific employee, a specific workspace, or an exact figure

---

**GIVEN** a Manager attempts to query a benchmark
**WHEN** the request is made
**THEN** it is refused

---

**GIVEN** a workspace opts out
**WHEN** it takes effect
**THEN** future contribution stops and query access is revoked, and no already-incorporated count is removed, because none is attributable to them

---

## Non-Functional Requirements

- A benchmark query resolves within 500ms
- The aggregation service runs as a fully separate process and database from the sync engine and the per-workspace API, with no shared connection pool, per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]
- Contribution computation runs client-side within the Web Worker boundary
- The query surface functions only online; there is no local cache of a shared pool

---

## Security Considerations

- **The core guarantee: no individual salary and no individual company's compensation structure is ever readable by Vulto.** Tier 1 encryption on the source data is never touched, weakened or bypassed. What reaches the service is a client-computed band with no identifying link by the time it leaves the workspace.
- **The one limitation is stated rather than implied away.** Vulto's infrastructure can observe which authenticated workspace submitted in a given month — not which employee, not what figure. The stronger multi-party alternative is named as a genuine future option, not overstated as already built.
- **The band widths are deliberately coarser at the high end.** A narrow band is more identifying against a smaller population, and there are fewer people at the top of any compensation distribution.
- **Month precision, never a date.** A full timestamp on a contribution is a correlation channel against submission times, the same reasoning [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] applies to its own contribution node.
- **This design is intended to generalize**, and [[VRS-F072_Agency_Benchmarking|VRS-F072]] reuses it rather than solving the same problem a second time.

---

## Out of Scope

- **Multi-party secure aggregation** — named above as the genuine stronger option, a real future investment rather than a gap to apologize for
- **Real-time or per-change contribution** — monthly batching is deliberate, both because finer timing increases correlation risk and because a benchmark does not need finer granularity to be useful
- **Benchmarking anything beyond base compensation** — bonus, equity and benefits are not included
- **Removing a workspace's historical contributions on opt-out** — there is nothing attributable to remove, which is the design working as intended rather than a limitation

---

## Decisions Recorded

**The internal band overlay is added**, and it is what makes this feature actionable rather than informational. A percentile table on one screen and a band on another are two facts; the same percentiles with the firm's own band drawn across them is a decision.

**The threshold is a platform constant.** No single workspace may tune a threshold governing a shared pool, and the previous specification registered it as a workspace setting.

**Opt-out is specified**, including that historical contributions are not removed — because nothing in the histogram is attributable to any workspace, there is nothing to remove. Stating that plainly is more honest than an undertaking that cannot be verified.

**Band widths are coarser above 200,000**, deliberately. Fewer people occupy the top of a distribution, and a fixed narrow band there is materially more identifying.

**The opt-in surface carries genuine explanatory prose**, the only screen in this product where that is correct. A person contributing their company's compensation data to a shared pool should read something first.

---

## Related Notes

- [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] — the internal band overlaid on a benchmark
- [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] — the anonymization principle extended here
- [[VRS-F072_Agency_Benchmarking|VRS-F072]] — which reuses this mechanism
- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — where the aggregation service is registered

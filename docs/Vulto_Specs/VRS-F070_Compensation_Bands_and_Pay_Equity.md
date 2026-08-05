---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F070
---

# VRS-F070 — Compensation Bands and Pay Equity

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee, seniority and the Tier 1 compensation fields), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity and jurisdiction — a band is always denominated somewhere), [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] (**the compensation change workflow that positions a proposal against a band**), [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] (career milestones, the natural mapping for a band), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (aggregate disclosure control), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (CompensationBand)
**Blocks:** Nothing structurally. [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]'s band positioning degrades gracefully where no band exists.

This document is the single source of truth for this feature.

---

## The boundary with [[VRS-F071_Salary_Benchmarking|VRS-F071]]

That feature benchmarks against **the external market**, through an opt-in cross-tenant aggregate. It answers *what does the market pay for this role.*

This feature establishes **what the firm itself pays**, deliberately, as a stated internal structure. It answers *what have we decided this role is worth here.*

The two are complements, and the second is the prerequisite for the first being actionable. **A market benchmark with no internal band to compare it against is a number with nothing to do** — an agency learns the market pays more, and has no structure to adjust.

This feature is also the one [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] actually needs. That workflow positions a proposed compensation change against a band; without one it functions, and without the single most useful thing an approver could see.

---

## What It Is

A band per role level per entity — a minimum, a midpoint and a maximum — with each employee positioned within their band, and an equity analysis showing where the same role is paid differently across the firm.

---

## Problem It Solves

An agency without bands pays whatever each person negotiated on the day they joined. That produces three problems, and the third is the expensive one.

**Offers are inconsistent.** Two engineers hired six months apart at materially different figures, for no reason either could defend.

**Raises have no reference.** [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]'s approver sees a proposed figure and a current figure, and no way to judge whether the result is generous, correct or overdue.

**And drift accumulates invisibly.** The person who negotiated well at hire stays ahead; the person who did not stays behind, and each annual percentage increase widens the gap rather than closing it. **By the time anyone notices, the correction is large enough that nobody wants to make it** — which is how a firm ends up with two people doing the same work at figures it cannot explain.

---

## User-Facing Flows

### Defining bands

An Owner or Finance Admin defines a band per seniority level per entity: minimum, midpoint, maximum, in that entity's currency. Optionally mapped to a career milestone per [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]], so a band and a progression target describe the same step.

### Positioning

Every employee with compensation on record is positioned within their band as a **compa-ratio** — their salary over the band midpoint. Below 0.9 is low in band; above 1.1 is high.

The figure matters more than a raw comparison because it is the only way to compare positions **across bands**. Someone at 0.85 in a senior band and someone at 0.85 in a junior band are in the same situation, and their absolute salaries say nothing about that.

### Out-of-band employees

Anyone below their band minimum or above their maximum is surfaced, with the gap stated. **This is the report that closes drift**, and it is deliberately a list of names — because the correction is per person and the alternative is a percentage nobody acts on.

### Equity analysis

Where a role level has enough people to report responsibly, the spread within it is shown: the range, the median compa-ratio, and how many sit outside band.

### At the moment of a raise

[[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]'s proposal shows the band, the current position and the proposed position. **An approver sees where the change lands, not only that it is a 12% increase.**

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Compensation bands | Content + Panel | Definition |
| Band positioning | Content | Where people sit |
| Equity analysis | Content | Spread within levels |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

### Layout and components

**Bands** is a Table: level, entity, minimum, midpoint, maximum, employees in band, out of band. All figures in `mono`. The out-of-band count renders `attention` while non-zero.

**Band positioning** is the surface that matters. One row per employee: name, level, salary, compa-ratio, and **a horizontal position indicator** showing the band range with their position marked and the midpoint ticked.

The indicator does the work a table of numbers cannot. Twelve rows of ratios require reading; twelve markers arranged along their bands show the shape of the distribution immediately — clustered low, spread wide, or two people sitting well outside.

Below minimum renders `attention`, above maximum renders `attention` in the opposite direction with the marker outside the range. **Neither is `danger`** — being paid above band is not a failure, it is a decision somebody made and should be able to explain.

**Equity analysis** is one Section per level, each with the range, the median compa-ratio, and the count outside band. Levels below the disclosure threshold render suppressed with the reason named, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]].

### Keyboard

Standard bindings. `J`/`K` through positioning rows.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner and Finance Admin full. HR Admin reads. **A Team Member sees their own band range and nothing else** |
| Unbanded | An employee at a level with no band renders in a separate section headed *No band defined*, never positioned against a guess |
| Suppressed | A level below threshold shows its band and suppresses the spread |
| Empty | *No compensation bands defined.* with a line noting that [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] will function without them, less usefully |
| Error | A midpoint outside the minimum-maximum range is refused |

### Responsive

The position indicator stacks below the row below 1280px.

---

## Technical Architecture

### The CompensationBand schema

Finance-restricted, Tier 1 — a band states what the firm pays for a role, which in a small agency is a close approximation of what a specific person earns.

```
band_id:            UUID v4
workspace_id:       UUID
entity_id:          UUID, FK to Entity
seniority_level:    enum per VRS-F002
role_family:        string, nullable — free text, e.g. "Engineering",
                    "Design". Null applies across the entity at that level
career_milestone_id: UUID, nullable, FK to CareerMilestone per VRS-F040
minimum:            decimal
midpoint:           decimal
maximum:            decimal
currency:           ISO 4217 — defaults from the Entity
effective_from:     date
version:            integer, starts at 1
supersedes_id:      UUID, nullable
is_active:          boolean, default true

— Universal Node Conventions per VPS-A002 —
```

At most one active band per entity, level and role family combination.

### Compa-ratio, computed never stored

`salary / midpoint`, computed at query time from the employee's Tier 1 compensation, on an authorized device. Consistent with every derived figure in this product.

**Where an employee's compensation currency differs from their band's**, the comparison uses [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]'s resolution at the current rate, and **the response states that a conversion was applied.** A compa-ratio computed silently across currencies is a figure that moves when the exchange rate does, and nobody reading it would know.

### Versioning

Updating a band creates a new version through `supersedes`. **A compensation change already approved against a prior version is unaffected** — the same historical-accuracy principle throughout the financial cluster.

### Positioning runs client-side

Every computation here reads Tier 1 compensation, so **all of it runs on an authorized device**, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. No server-side path computes a compa-ratio.

### Disclosure control

The equity analysis passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]. A level with three people whose spread is displayed has disclosed each of their positions to anyone who knows who those three are — which in a twenty-person agency is everyone.

**The band itself is not suppressed**, only the spread within it. A band is a stated policy; a spread is a fact about specific people.

### API contracts

```
compensationBand.create(entityId, seniorityLevel, minimum, midpoint, maximum,
                        roleFamily?, careerMilestoneId?) -> { bandId }
compensationBand.update(bandId, fields) -> { newBandId }
  // Creates a superseding version

compensationBand.resolveForEmployee(employeeId) -> CompensationBand | null

compensationBand.getPosition(employeeId) -> {
  band, salary, compaRatio, positionInBand: 'Below' | 'Low' | 'Mid' | 'High' | 'Above',
  currencyConverted: boolean
} | { noBand: true }
  // Client-side. Tier 1 throughout

compensationBand.listPositions(workspaceId, entityId?) -> {
  positioned: { employeeId, name, level, compaRatio, positionInBand }[],
  unbanded: { employeeId, name, level }[]
}

compensationBand.equityAnalysis(workspaceId, seniorityLevel) -> {
  headcount, medianCompaRatio, range: { min, max },
  outsideBand: number
} | Suppressed
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | CompensationBand carries the schema above, Finance-restricted, Tier 1 |
| G02 | At most one active band per entity, level and role family. Updating creates a superseding version |
| G03 | Compa-ratio is computed at query time, never stored |
| G04 | Every computation reading Tier 1 compensation runs client-side on an authorized device |
| G05 | A cross-currency comparison uses [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]'s resolution and states that a conversion was applied |
| G06 | An employee at a level with no band is reported as unbanded, never positioned against an inferred range |
| G07 | The equity spread passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control. The band itself is not suppressed |
| G08 | A Team Member reads their own band range only, never another's position and never any spread |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F070-S01 | Band schema and versioning | Data |
| VRS-F070-S02 | Compa-ratio positioning | Logic |
| VRS-F070-S03 | Out-of-band reporting | UI |
| VRS-F070-S04 | Equity analysis | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a band with a midpoint of 80,000 and an employee earning 72,000
**WHEN** their position computes
**THEN** the compa-ratio is 0.9 and the position reads Low

---

**GIVEN** an employee earning below their band minimum
**WHEN** the positioning view renders
**THEN** they appear with the gap stated and the marker outside the range in `attention`

---

**GIVEN** an employee at a seniority level with no defined band
**WHEN** positions are listed
**THEN** they appear under unbanded, never positioned against an inferred or nearest range

---

**GIVEN** an employee paid in PKR against a band denominated in GBP
**WHEN** their position computes
**THEN** [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]'s resolution is applied and the response states that a conversion occurred

---

**GIVEN** a seniority level with three employees against a threshold of five
**WHEN** the equity analysis is requested
**THEN** the spread is suppressed with the reason named, while the band itself remains visible

---

**GIVEN** a band is updated to a higher midpoint
**WHEN** a compensation change approved against the prior version is viewed
**THEN** it remains as approved, positioned against the version in force at the time

---

**GIVEN** a Team Member views their own compensation
**WHEN** it renders
**THEN** they see their band's range, and no colleague's position and no spread

---

**GIVEN** [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]'s proposal form is opened for an employee with a band
**WHEN** a figure is entered
**THEN** the current and proposed positions both render against the band range

---

## Non-Functional Requirements

- Position computation resolves within 200ms for a single employee
- The full positioning list resolves within 1 second for 150 employees on an authorized device
- Every Tier 1 computation runs client-side
- Full functionality offline on an authorized device

---

## Security Considerations

- **CompensationBand is Tier 1 in full.** In a firm with one Principal, a band for that level is that person's salary range, and treating a band as policy rather than compensation would have been a real disclosure.
- **An employee reads their own band range.** This is deliberate and it is the point of having bands — a person who cannot see the structure governing their own pay has a structure that does nothing for them. They see the range, never their own compa-ratio relative to colleagues and never anyone else's position.
- **The equity analysis is the most disclosure-sensitive surface in this feature.** A spread within a small level identifies its members' positions to anyone who knows who they are. Disclosure control applies to the spread and never to the band, because a policy and a fact about specific people are different disclosures.
- **This feature can reveal something uncomfortable and it should.** An out-of-band list is a list of people the firm has been underpaying, by its own stated structure, and it names them. That is the entire value — a percentage nobody acts on becomes a list somebody has to answer for.

---

## Out of Scope

- **External market data** — [[VRS-F071_Salary_Benchmarking|VRS-F071]]
- **Automatic adjustment to bring someone into band** — this surfaces the gap. [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] makes the change, with approval
- **Demographic pay gap analysis by gender, ethnicity or any protected characteristic.** Deliberately excluded: this product does not collect those attributes, per [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]]'s reasoning about nationality, and a pay equity feature that required collecting them would create a larger risk than it addresses. A firm with a statutory reporting obligation exports through [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]] and analyzes elsewhere
- **Band progression rules or automatic level advancement** — [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] owns progression, and confirmation is a human decision
- **Total compensation modeling including equity or benefits** — cash compensation only

---

## Decisions Recorded

**This feature is new**, and it is what makes [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]'s band positioning and [[VRS-F071_Salary_Benchmarking|VRS-F071]]'s market benchmark actionable rather than informational.

**Compa-ratio is the primary figure**, not a raw comparison to the range. It is the only way to compare positions across bands, and drift is a cross-band problem.

**Demographic pay gap analysis is permanently excluded.** It is the obvious extension and it would require collecting protected characteristics this product deliberately does not hold — the same reasoning that excludes nationality from [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]]. A firm with a statutory obligation exports and analyzes elsewhere, with data it collected for that purpose under its own consent model.

**Cross-currency comparisons state that a conversion was applied.** A compa-ratio computed silently across currencies moves when the exchange rate does, and a reader would attribute that to the person rather than the rate.

**An unbanded employee is reported as unbanded**, never positioned against the nearest available range. An inferred band is a comparison to a standard nobody set.

**Out-of-band reporting names people.** A percentage is a fact nobody acts on; a list is a set of decisions somebody has to make.

---

## Related Notes

- [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] — the workflow this feature gives a reference point
- [[VRS-F071_Salary_Benchmarking|VRS-F071]] — the external counterpart
- [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] — the milestones bands map to
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the disclosure control applied to the spread

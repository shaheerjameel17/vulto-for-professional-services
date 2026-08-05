---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F051
---

# VRS-F051 — Team Capacity Planner

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F005_The_Bench_Forecast|VRS-F005]] (Assignment and the capacity computation, reused), [[VRS-F007_Ghost_Resources|VRS-F007]] (Ghost Resources, included in supply), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (the proficiency-matching engine and Skill's category), [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]] (extended with a fourth trigger source so a projected shortfall generates a suggestion the same way a won pitch does), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (aggregate disclosure control), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (the `requires_skill` edge, extended to Pitch, and Pitch's `projected_start_date`)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## The redundancy question, answered

[[VRS-001_Feature_Register|VRS-001]] records this as decided. The reasoning belongs here.

**Five ways this is not the Bench Forecast under another name:**

1. **Granularity.** [[VRS-F005_The_Bench_Forecast|VRS-F005]] is one row per employee — an individual's actual booked-or-not status. This is one row per skill category. Nobody asks *is Alice free next Tuesday* here; the question is *how much Senior React capacity do we have in Q1.*

2. **Horizon and resolution.** Ninety days at daily resolution versus four quarters at quarterly resolution. Operational staffing happens at the first grain; hiring decisions happen at the second. **Nobody hires a person for next Tuesday.**

3. **Certainty.** [[VRS-F005_The_Bench_Forecast|VRS-F005]] shows confirmed assignments only, deliberately — its entire value is that the number is real. This is the one place in the product that deliberately incorporates uncertainty: an open pitch's staffing need, weighted by its win probability, contributes to projected demand before the deal is won.

4. **The question.** *Is this person staffed* versus *should we be hiring.*

5. **What a professional services firm actually needs.** An agency's hardest resourcing question is not *who is free this week*. It is *we have three pitches out at different likelihoods — do we have the bench to deliver if we win the two most likely, or should we start recruiting now, before we win, rather than scrambling after.*

That is a different question from anything else in this product, and it is why this feature earns a place beside the Bench Forecast rather than folding into it.

---

## The gap this had to close to be real

Pitch carried a win probability but had no way to express **what staffing it would need if won.** Without that, *probability-weighted demand* is a phrase rather than a computable thing.

`requires_skill` — already registered for Project, OpenRole and CareerMilestone — is extended to Pitch, and Pitch gains a `projected_start_date` sufficient to bucket its potential demand into the right quarter. Both are the minimal additions this feature needed to be honest rather than illustrative.

---

## What It Is

A quarterly, skill-category-level forecast, twelve months out by default, comparing projected supply — real employees and Ghost Resources — against projected demand, both confirmed and probability-weighted.

Where the gap is negative, the feature generates a hiring suggestion through [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]]'s trigger.

---

## User-Facing Flows

### Viewing the forecast

Owner, Finance Admin and HR Admin see a grid: rows are skill categories, columns are quarters, cells show supply, demand and the gap, with confirmed and pipeline-weighted demand visually distinguished.

### A manager's narrower view

The same grid restricted to confirmed demand only — **with no pipeline figure computed at all**, not hidden behind a check on an otherwise-computed number.

### A projected shortfall

A meaningful negative gap is flagged. Opening it shows the underlying numbers plainly: confirmed shortfall, pipeline-weighted addition to it. **Not a narrative conclusion.**

### Acting on it

An Owner or HR Admin generates a hiring suggestion, creating a DraftHiringRecord through [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]], landing in the same review flow every other suggestion goes through — and from there, per that feature, into a Requisition with its approval gate rather than directly into an open role.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Capacity forecast | Content, full width | The grid |
| Category detail | Panel | The numbers behind a cell |

### Layout and components

A Table with skill categories as rows and quarters as columns, exempt from the content maximum since horizontal space here is time.

Each cell is compact: **the gap as the primary figure** in `mono-lg`, supply and demand beneath in `mono` at `text-secondary`. A negative gap renders `attention`; positive renders neutral. Surplus capacity is not `success` — a bench you are paying for is not good news, and coloring it as such would contradict everything [[VRS-F005_The_Bench_Forecast|VRS-F005]] communicates.

Where the pipeline-weighted term is visible, demand renders as two values — *4 + 1.8* — the confirmed figure and the weighted addition, separated rather than summed. A founder deciding whether to hire needs to know how much of the demand is real and how much is a bet.

**The Panel shows the constituent pitches**, each with its name, its requirement and its weight — *Halo rebrand, 1 Senior React, 60% → 0.6.* An aggregate probability figure with no visible constituents is a number nobody will act on, because nobody can check it.

A confidence line sits beneath the grid: *Based on 6 open pitches and 12 active projects.* Small sample sizes produce volatile forecasts, and the reader should see the denominator.

### Keyboard

`H`/`L` move between quarters, `J`/`K` between categories, `Enter` opens the Panel.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton grid |
| Restricted | A manager's response contains no pipeline field. Not present, not null |
| Suppressed | A category with too few holders passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control |
| Empty | *Not enough pipeline or project data to forecast.* Stated honestly rather than a grid of zeros |
| Error | A pitch with no requirements or no projected start contributes nothing, silently and correctly |

### Responsive

Below 1280px the grid becomes one category per row with quarters as a horizontal strip. Below 1024px it is a per-category list.

---

## Technical Architecture

### No new node type

Every number is computed live at query time from Assignment, GhostResource, `requires_skill` edges on Project and Pitch, and `has_skill` — consistent with [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation, [[VRS-F018_Leave_Policy_Engine|VRS-F018]]'s leave balance and [[VRS-F014_Skill_Matrix|VRS-F014]]'s coverage figures.

### Supply, per category, per quarter

Real employees and Ghost Resources holding a qualifying `has_skill` edge for the category, whose assignment commitments do not fully occupy them in that quarter — **reusing [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s capacity computation**, not a second implementation.

**Sub-vendor capacity is excluded**, per [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]]. Subcontracting and hiring are different strategic decisions, and counting a subcontracted collective as internal supply would tell a founder they have coverage they do not own.

### Confirmed demand

Unmatched `requires_skill` requirements from active projects extending into the quarter, aggregated by category rather than left as individual gaps.

### Probability-weighted demand

For every pitch not yet won, with a requirement in this category and a projected start in this quarter, the requirement contributes `win_probability` of one unit — **a pitch at 30% contributes 0.3, not 1.**

Computed for Owner, Finance Admin and HR Admin only.

### The gap

Supply minus the sum of confirmed and, where visible, weighted demand. **A manager's gap is a genuinely different, smaller number** — supply minus confirmed only — not the same number with a field redacted.

### API contracts

```
capacityPlanner.getForecast(workspaceId, horizonQuarters?) -> {
  categories: [{
    skillCategory,
    quarters: [{
      quarter, supply, confirmedDemand,
      pipelineWeightedDemand?,   // Owner, Finance Admin, HR Admin only
      gap
    }]
  }],
  basis: { openPitchCount, activeProjectCount }
}
  // A Manager's request never computes the pipeline term

capacityPlanner.getCategoryDetail(skillCategory, quarter) -> {
  supplyHolders: number,
  confirmedRequirements: { projectName, requirement }[],
  pipelineRequirements?: { pitchName, requirement, winProbability, weighted }[]
}

capacityPlanner.suggestHire(skillCategory, quarter) -> { draftHiringRecordId }
  // Calls VRS-F036 with trigger_source CapacityForecast
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type. Every figure is computed live |
| G02 | Supply reuses [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s capacity computation; confirmed demand reuses [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matching, aggregated by category |
| G03 | Sub-vendor capacity is excluded from supply per [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] |
| G04 | The pipeline term is computed only for Owner, Finance Admin and HR Admin. A Manager's request never executes that calculation |
| G05 | Confirmed and weighted demand are reported separately, never summed into one displayed figure |
| G06 | A generated suggestion produces a DraftHiringRecord identical to one from [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]]'s other triggers, and promotes through [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]'s approval gate like any other |
| G07 | A pitch with no requirements or no projected start contributes nothing, rather than a default guess |
| G08 | Category aggregates pass through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F051-S01 | Supply computation by category | Logic |
| VRS-F051-S02 | Confirmed and weighted demand | Logic |
| VRS-F051-S03 | Forecast grid, full and restricted | UI |
| VRS-F051-S04 | Category detail with visible constituents | UI |
| VRS-F051-S05 | Shortfall-to-suggestion | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a category has 5 available Senior React holders across employees and Ghosts in Q2
**WHEN** the forecast computes
**THEN** supply reflects exactly 5, reusing [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s capacity logic

---

**GIVEN** two open pitches each require one Senior React developer starting in Q2, at 60% and 30%
**WHEN** an Owner views the forecast
**THEN** the pipeline term is 0.9, not 2, and not rounded

---

**GIVEN** the same forecast requested by a Manager
**WHEN** the response is computed
**THEN** it contains no pipeline field at all, and the gap reflects confirmed demand only

---

**GIVEN** a sub-vendor is engaged with capacity in that category and quarter
**WHEN** supply is computed
**THEN** it contributes nothing, per [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]]

---

**GIVEN** an Owner opens a cell's detail
**WHEN** it renders
**THEN** each contributing pitch is named with its requirement, probability and weighted contribution

---

**GIVEN** a negative gap
**WHEN** an Owner generates a suggestion
**THEN** a DraftHiringRecord is created with the category and quarter set, and promoting it creates a Requisition through [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] rather than an open role directly

---

**GIVEN** a pitch with no requirements or no projected start
**WHEN** the forecast computes
**THEN** it contributes nothing, with no error and no default

---

## Non-Functional Requirements

- The full grid resolves within 500ms for 150 employees and 50 active pitches and projects
- Category detail resolves within 200ms
- Full functionality offline

---

## Security Considerations

- **The manager restriction is computational, not a display boundary.** The pipeline term is never calculated for a manager's request, because even an aggregate derived from a small number of pitches approximates a specific deal's commercial likelihood. Not computing it is a stronger guarantee than computing and withholding it.
- **The additions to Pitch introduce no new sensitivity.** A projected start date and a staffing requirement are operational facts, not commercial ones, and neither is Tier 1 on its own. Win probability, which is, is read only by the roles already permitted it.
- **Category aggregates pass through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control.** A category with two holders is a category where a supply figure identifies them.

---

## Out of Scope

- **Any resolution finer than quarterly** — [[VRS-F005_The_Bench_Forecast|VRS-F005]] owns the operational question
- **Automatic hiring action** — this creates a suggestion, which routes through an approval gate
- **Forecasting by reporting line** — this groups by skill category. A manager's restriction is about sensitivity, not hierarchy
- **Beyond twelve months** — configurable, but a forecast much past a year has little grounding in pipeline data that rarely extends that far
- **Sub-vendor capacity as supply** — permanently excluded

---

## Decisions Recorded

**The redundancy question is closed**, with the reasoning recorded here rather than left as an open item. Five distinctions, each real.

**Confirmed and weighted demand are displayed separately rather than summed.** A founder deciding whether to hire needs to know how much of the demand is real and how much is a bet, and one figure conceals it.

**Constituent pitches are visible in the detail Panel.** An aggregate probability figure with no visible constituents is a number nobody acts on, because nobody can check it.

**Surplus capacity is not colored `success`.** A bench you are paying for is not good news, and coloring it green would contradict what [[VRS-F005_The_Bench_Forecast|VRS-F005]] communicates about the same underlying fact.

**Sub-vendor exclusion is stated here as well as in [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]]**, since this is the feature where counting it would do the damage.

**The forecast states its basis.** Small sample sizes produce volatile forecasts, and a reader should see the denominator before acting on the number.

---

## Related Notes

- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the operational counterpart
- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the matching engine reused here
- [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]] — the suggestion mechanism this feature triggers
- [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] — the backward-looking counterpart to this forward-looking view

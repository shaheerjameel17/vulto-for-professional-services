---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F054
---

# VRS-F054 — Skill Gap Trend Analysis

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (SkillGap, the sole data source, and Skill's category as the grouping dimension), [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] (lightly extended, incorporating this feature's trend alongside [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s forecast in one Insight)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## The boundary with [[VRS-F051_Team_Capacity_Planner|VRS-F051]]

Both sound like they forecast skill shortfalls. They reason in opposite directions.

**[[VRS-F051_Team_Capacity_Planner|VRS-F051]] is forward-looking and probabilistic.** It reads the current pipeline — open pitches weighted by win probability, confirmed project requirements — and projects supply against that snapshot.

**This is backward-looking and pattern-based.** It reads the accumulated history of SkillGap records: how often a category has gone short, how long each gap took to resolve, whether the pattern is worsening or improving. It says nothing about any current pitch.

One reasons from the pipeline forward; the other reasons from the past into a trend. **Both can be true about the same category at once**, and saying so is more useful than either alone — which is what [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] does with them.

---

## Why this reads one source and nothing else

An earlier design considered incorporating attrition risk — reading [[VRS-F053_Retention_Risk_Indicator|VRS-F053]]'s signal or [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s departure history to project supply erosion alongside demand.

That would combine an already-interpreted alert from one feature with raw records from another into a new composite meaning, which is precisely the cross-pattern reasoning [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 7 reserves for [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]].

**This feature reads exactly one source and computes exactly one kind of statistic from it.** If an attrition-adjusted forecast is ever wanted it belongs in that feature, combining this trend with that signal explicitly and with tiers inherited correctly, rather than built quietly here.

---

## The name, corrected

Previously *Skill Gap Forecaster*. It forecasts nothing — it describes a pattern in records that already exist. The corrected name says what it does, and prevents a reader expecting a projection this feature does not make.

---

## What It Is

A historical trend analysis over SkillGap records, grouped by skill category: how frequently gaps occurred, how long they typically took to resolve, and whether that pattern is worsening, stable or improving.

**No new alert and no new interpreted signal** — a statistic computed from records that exist for an entirely different reason.

---

## Problem It Solves

[[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] records every gap as it happens and resolves it when someone qualifies. But each one becomes an isolated fact the moment it closes, easy to forget.

A category that has quietly gone short every two quarters for two years, each time resolved just barely in time, looks from any single gap's perspective like a one-off problem solved. **This is what notices the pattern across all of them** — and the pattern is the thing that justifies a hire, where no individual gap ever did.

---

## User-Facing Flows

### Viewing a category's trend

An Owner, HR Admin or Manager — none of this data is tier-restricted — sees a category's history: how many gaps over the trailing window, their average resolution time, and a plain trend label.

**Never a figure so precise it implies more confidence than a handful of records supports.**

### Insufficient history

A category with too few records shows exactly that, rather than a trend label built on a sample too small to mean anything.

### Alongside the forward forecast

[[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] cites this trend next to [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s projection where both exist — the backward pattern and the forward projection, side by side, attributed to their actual sources rather than blended into one unexplained number.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Skill gap trends | Content | Every category |
| Category detail | Panel | The gaps behind a trend |

### Layout and components

A Table: category, gaps in window, average resolution in working days, trend Badge, sample size.

**Sample size is a visible column, not a footnote.** A Worsening trend on four records and one on forty are different claims, and a reader should be able to see which they are looking at without opening anything.

The trend Badge is one of four words — Worsening, Stable, Improving, Insufficient history — in neutral styling. **No color.** A worsening skill gap trend is information for a hiring decision, not an alert, and `attention` would put it in the same visual register as unrecovered bench cost, which it is not.

**The Panel lists the constituent gaps**: the project, when it opened, when it resolved, and how it resolved — whether someone was hired, someone existing gained the skill, or a contractor covered it.

That last column is the useful one and it is what makes the trend actionable. A category resolved five times by contractors is a different problem from one resolved five times by training, and the trend figure alone conceals the distinction entirely.

### Keyboard

Standard list bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | None. Tier 0 throughout |
| Insufficient | The label, with the sample size stated |
| Empty | *No skill gaps recorded yet.* |
| Error | Not applicable — this feature only reads |

### Responsive

Drops `average resolution` below 1280px. Sample size is never dropped.

---

## Technical Architecture

### No new node type

Every figure is computed at query time from SkillGap records — their creation, resolution status and resolution timestamp, all already tracked.

Consistent with [[VRS-F005_The_Bench_Forecast|VRS-F005]], [[VRS-F014_Skill_Matrix|VRS-F014]], [[VRS-F018_Leave_Policy_Engine|VRS-F018]] and [[VRS-F051_Team_Capacity_Planner|VRS-F051]] before it.

### The computation

Over a trailing window, default 24 months, per category:

**`recurrenceRate`** — count of gaps created, normalized per quarter.

**`averageResolutionDays`** — mean working days between creation and resolution across resolved records, counted per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. A gap opening before a two-week holiday period and resolving after it did not take fourteen days to resolve in any sense that matters.

**`trendDirection`** — the recurrence rate in the more recent half of the window against the earlier half. Worsening if increased, Improving if decreased, Stable otherwise.

**Below three resolved records in the window, `trendDirection` is `InsufficientHistory`** — not a guess dressed as a trend.

### Resolution mode

Each gap's resolution is classified by what actually closed it, derived at query time:

- **Hire** — the qualifying `has_skill` edge belongs to an employee whose start date follows the gap's creation
- **Upskill** — it belongs to an existing employee and was created after the gap
- **Existing** — it predates the gap, meaning the gap was a matching or availability failure rather than a capability one
- **Unresolved** — still open

This is not a new stored fact. It is a traversal of data the graph already holds, and it converts a trend from a number into a diagnosis a person can act on.

### API contracts

```
skillGapTrend.getForCategory(skillCategory, windowMonths?) -> {
  recurrenceRate, averageResolutionWorkingDays,
  trendDirection: 'Worsening' | 'Stable' | 'Improving' | 'InsufficientHistory',
  sampleSize,
  resolutionModes: { hire, upskill, existing, unresolved }
}

skillGapTrend.getAllCategories(workspaceId, windowMonths?) -> {
  skillCategory, recurrenceRate, averageResolutionWorkingDays,
  trendDirection, sampleSize
}[]

skillGapTrend.getConstituentGaps(skillCategory, windowMonths?) -> {
  skillGapId, projectName, createdAt, resolvedAt, resolutionMode
}[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type. Every figure is computed live from existing SkillGap records |
| G02 | This feature reads SkillGap only. It never reads [[VRS-F053_Retention_Risk_Indicator|VRS-F053]]'s signal, [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s departures, or any other feature's already-interpreted alert |
| G03 | `trendDirection` is `InsufficientHistory` below three resolved records in the window. A trend label is never produced from a smaller sample |
| G04 | Resolution time counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| G05 | Resolution mode is derived at query time from existing data. No new fact is stored |
| G06 | This feature's data carries no elevated tier. SkillGap is Tier 0 and remains so through every aggregation |
| G07 | Sample size is returned with every trend and is never omitted from a display |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F054-S01 | Trend computation | Logic |
| VRS-F054-S02 | Resolution mode classification | Logic |
| VRS-F054-S03 | Category trend view | UI |

---

## Feature Acceptance Criteria

**GIVEN** a category has 6 resolved gaps over 24 months, more in the recent half than the earlier
**WHEN** the trend computes
**THEN** it is Worsening, with recurrence rate and average resolution reflecting the full window

---

**GIVEN** a category has only 2 resolved gaps in the window
**WHEN** the trend computes
**THEN** it is InsufficientHistory with the sample size stated, not a guess

---

**GIVEN** a gap opened before a two-week holiday period and resolved after it
**WHEN** resolution time computes
**THEN** it counts working days only, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]

---

**GIVEN** five gaps in a category were each resolved by a contractor rather than a hire or an upskill
**WHEN** the detail Panel opens
**THEN** all five show a resolution mode reflecting that, making the pattern visible

---

**GIVEN** [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] evaluates a category with both a [[VRS-F051_Team_Capacity_Planner|VRS-F051]] forecast and a Worsening trend here
**WHEN** the Insight is generated
**THEN** both figures appear attributed to their actual sources, and this feature's contribution does not alter the Insight's tier

---

**GIVEN** a Manager views this feature's trends
**WHEN** it loads
**THEN** it is fully visible, since none of this data carries a tier restriction

---

**GIVEN** a code review checks whether this feature reads retention signals or departure records
**WHEN** the check runs
**THEN** no such reference exists

---

## Non-Functional Requirements

- Trend computation for a category resolves within 200ms from the local graph
- All-category computation resolves within 500ms
- Full functionality offline

---

## Security Considerations

- **No elevated privacy concern.** SkillGap is Tier 0, and this feature's aggregation introduces no new sensitivity — unlike [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s pipeline-weighted figure, which does, because a skill gap describes an unmet project requirement rather than a person's circumstances.
- **The narrow single-source scope is itself the security decision.** Reading only one feature is what keeps this outside Standing Rule 7's restriction entirely. The moment it read a second feature's interpreted signal it would require [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s scrutiny rather than its own.
- **Resolution mode is derived from existing data and reveals nothing new**, though it is worth noting that a category consistently resolved by upskilling names, indirectly, which employees have been retrained. That is Tier 0 information already visible on the skill matrix.

---

## Out of Scope

- **Attrition-adjusted supply projection** — deliberately excluded. That combination belongs to [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]
- **Any forecast using pipeline data** — this feature's value is being independent of it. Combining them is [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s Insight, not a merge of two features
- **Recommending hiring or reassignment** — this reports a pattern. [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]] is where a suggestion is generated, and only from its own triggers
- **A projected future gap count.** Extrapolating three data points into a prediction would be exactly the false precision this document's minimum sample size exists to prevent

---

## Decisions Recorded

**The feature is renamed to Skill Gap Trend Analysis.** It forecasts nothing, and a name promising a projection sets a reader up to expect one.

**Resolution mode is added**, and it is what makes this feature actionable rather than merely descriptive. A category resolved five times by contractors is a different problem from one resolved five times by training, and the trend figure alone conceals which you have. It requires no new stored data — only a traversal the graph already supports.

**Resolution time counts working days.** A gap spanning a holiday period did not take that long to resolve in any sense a reader cares about.

**Sample size is a visible column rather than a footnote.** A Worsening trend on four records and one on forty are different claims, and the reader should not have to ask which they are seeing.

**No color on the trend.** A worsening skill gap is input to a hiring decision, not an alert, and `attention` would place it in the same visual register as unrecovered bench cost.

---

## Related Notes

- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the SkillGap records this feature analyzes
- [[VRS-F051_Team_Capacity_Planner|VRS-F051]] — the forward-looking counterpart
- [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] — where both are combined into one Insight
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days resolution time counts

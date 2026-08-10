---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F014
---

# VRS-F014 — Skill Matrix

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee, `has_skill`, `holds_certification`), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (**Skill's schema and the proficiency ordering, both owned there and reused exactly**), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (existing visibility rules, no override required)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A visual grid: employees as rows, skills as columns, grouped by category, each cell showing whether a person holds that skill and at what proficiency, verified or self-reported, certified or not.

It is read-only and adds no fact to the graph. Every value it displays already exists as a `has_skill` or `holds_certification` edge.

---

## The boundary with three neighboring features

Four features touch skills and only this one does what it does.

[[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] matches a specific project's requirements against available people — one query, one answer, availability-filtered. [[VPS-F002_Local-First_Search|VPS-F002]] finds a skill by name through the palette, delegating to that engine. [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] projects future shortfalls against the pipeline of upcoming work.

**This feature is the only one that shows the whole team's coverage at once.** A snapshot, not a query and not a forecast. It never checks whether someone is free.

---

## Problem It Solves

A manager or owner asking *how deep is our React bench, really* or *do we have anyone left who knows the old stack* has no way to answer without querying the graph directly or paging through profiles one at a time.

[[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] answers a specific project's need. Nothing answers the open-ended workforce question — which is the question that precedes a hiring decision, a training budget, and a decision about whether to bid for a piece of work at all.

---

## User-Facing Flows

### Viewing the matrix

A grid with employees as rows and skills as columns grouped by category. Each cell shows an indicator at an intensity corresponding to proficiency, with a distinct marker for verified and a separate one for a matching certification.

### Reading coverage and depth

Each column header shows two figures: **coverage**, how many people hold the skill at all, and **depth**, how many hold it at Senior or above. The distinction is the point — twelve people who have touched React and three who could lead on it are different facts, and a single count conceals which one you have.

A category collapses to its aggregate coverage across every skill within it.

### Filtering

By category, by minimum proficiency, and by verified-only — narrowing a broad view to a specific question such as *who has verified, Senior-or-above cloud skills* without leaving the grid.

### Single-person and single-skill views

Selecting a row shows one person's full skill profile in the Panel. Selecting a column header shows everyone who holds that skill, ranked by proficiency, which is the fastest answer to *who could cover this if she leaves*.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Skill matrix | Content + Panel | The grid |

### Layout and components

A Table with a fixed left column of 200px holding avatar and name. Skill columns are 44px wide with headers rotated 45 degrees — the only rotated text permitted anywhere in this product, and permitted here because forty vertical labels is the difference between a grid that fits and one that scrolls sideways forever.

Category groups are separated by a 2px `border-strong` vertical rule and a `micro` uppercase group label spanning their columns.

**Cells carry no text.** A filled square at four intensities — 25%, 50%, 75%, 100% of `brand-500` — encodes proficiency. A 1px `border-strong` ring marks verified. A small filled dot in the corner marks certified. An empty cell is genuinely empty, not a zero or a dash.

This is the one place in the product where color intensity carries meaning rather than category, and it is defensible because the alternative — four thousand cells of text — is unreadable. Hovering a cell states the values in words for anyone who cannot distinguish the intensities, and the Panel view is the full accessible representation.

**Column headers** show the skill name, then coverage and depth beneath in `numeric` as `12 · 3`. A skill with zero coverage renders its header in `text-tertiary`, since a column of nothing is worth seeing but not worth emphasizing.

**Filters** sit above as a Select for category, a Toggle Group for minimum proficiency, and a Switch for verified-only.

### Keyboard

`J`/`K` move between rows, `H`/`L` between columns, `Enter` opens the focused cell's detail in the Panel. Arrow keys work identically for anyone who does not use the vim bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton grid at correct dimensions |
| Restricted | Rows follow [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s existing employee visibility. No new rule |
| Empty | *No skills recorded yet.* with **Add skills to a profile**, linking to [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] |
| Deprecated skill | Column header renders in `text-tertiary` with a `Deprecated` Badge. Existing cells remain |
| Error | Not applicable — this feature only reads |

### Responsive

Below 1280px the grid becomes a per-category accordion, each category listing its skills as rows with coverage and depth, expanding to show who holds each. The matrix shape does not survive a narrow viewport, and pretending otherwise produces something unusable in both orientations.

---

## Technical Architecture

### Coverage and depth are computed, never stored

Both are computed at query time from `has_skill` edges — the same never-stored-always-derived discipline [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation and [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]]'s leave balance follow.

Coverage is a count of qualifying edges. Depth restricts that count to Senior or Expert. Both recompute against the filtered set when a filter is applied, so a figure never describes a population other than the one on screen.

### Deprecated skills

A Deprecated Skill's existing edges remain visible on the matrix with the column marked. Deprecation affects only availability in active pickers elsewhere. Historical accuracy matters here as much as anywhere: a team's past capability is a real fact about the team.

### API contracts

```
skillMatrix.get(workspaceId, filters?: { category?, minProficiency?, verifiedOnly? }) -> {
  employees: [{ employeeId, isGhost, name }],
  skills:    [{ skillId, name, category, coverage, depth, isDeprecated }],
  cells:     [{ employeeId, skillId, proficiencyLevel, verified, certified }]
}
  // Entirely local. Scoped per the requesting role's existing employee
  // visibility, with no separate permission logic

skillMatrix.forSkill(skillId) -> {
  holders: [{ employeeId, proficiencyLevel, verified, certified, availabilityStatus }]
}
  // The single-column view. Availability comes from VRS-F005, read-only
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Coverage and depth are computed at query time from `has_skill` edges, never stored or cached as separate facts |
| G02 | This feature reuses [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s proficiency ordering exactly and defines no second ordering |
| G03 | Employee visibility follows [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s existing rules. This feature introduces no permission logic |
| G04 | A Deprecated Skill's historical edges remain visible. Deprecation affects only picker availability elsewhere |
| G05 | Filters recompute coverage and depth against the filtered set, never against the unfiltered population |
| G06 | Ghost Resources appear as rows with the dashed treatment from [[VPS-D001_Design_Foundations|VPS-D001]], since planned capability is a real input to a workforce-planning view |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F014-S01 | Matrix grid rendering | UI |
| VRS-F014-S02 | Coverage and depth computation | Logic |
| VRS-F014-S03 | Category grouping and filtering | UI |
| VRS-F014-S04 | Single-person and single-skill detail views | UI |

---

## Feature Acceptance Criteria

**GIVEN** twelve people hold React, three at Senior or above
**WHEN** the matrix is viewed
**THEN** the React column header reads coverage 12, depth 3

---

**GIVEN** a person's skill is also backed by a certification
**WHEN** their cell renders
**THEN** both the proficiency intensity and a distinct certified marker appear, not one merged indicator that loses the distinction

---

**GIVEN** a filter of verified-only, Senior or above
**WHEN** it is applied
**THEN** only cells meeting both conditions remain, and coverage and depth recompute against the filtered set rather than the full population

---

**GIVEN** a Skill is deprecated
**WHEN** the matrix is viewed afterwards
**THEN** existing cells remain visible with the column marked Deprecated, while the skill no longer appears in [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]'s or [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s active pickers

---

**GIVEN** a user selects a skill column header
**WHEN** the Panel opens
**THEN** every holder appears ranked by proficiency with their availability status, answering who could cover the skill

---

**GIVEN** a viewport below 1280px
**WHEN** the matrix loads
**THEN** it renders as a per-category accordion rather than a horizontally scrolling grid

---

**GIVEN** the device is offline
**WHEN** the matrix is used
**THEN** viewing, filtering and category collapsing all function from the local graph with no degradation

---

## Non-Functional Requirements

- The matrix renders within 300ms from the local graph for 150 employees and 100 skills
- Filter application recomputes and re-renders within 100ms
- Full functionality offline
- Cell intensity is never the sole carrier of meaning: hover states and the Panel view express every value in words, per [[VPS-D002_Component_Library|VPS-D002]]'s accessibility floor

---

## Security Considerations

- **No new permission logic.** Employee visibility follows [[VPS-A004_Graph_Permission_Layer|VPS-A004]] exactly. This is a different view over already-permissioned data, not a new access surface.
- **Skill carries no sensitive information.** Standard, Tier 0, consistent with the edges it describes.
- **The aggregate view is more revealing than the individual one, and this is worth naming.** A matrix showing one person as the sole holder of a critical skill is a legitimate workforce-planning insight and also a fact about that person's leverage and risk. It is not restricted — the information is genuinely operational and every constituent fact is already visible on a profile — but the single-skill Panel view is the correct place to look at it, rather than a report that ranks people by irreplaceability.

---

## Out of Scope

- Per-project matching or availability filtering — [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] entirely. This feature never checks whether someone is free, except as read-only context in the single-skill view
- Forecasting future needs against upcoming work — [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]]
- Skill endorsement or peer-review workflows — `verified` is a binary fact per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]
- Automatic categorization or inference — `category` is set manually when a Skill is created
- Skill schema and proficiency ordering — [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]
- Training recommendations from an identified gap — [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]]

---

## Decisions Recorded

**Skill's schema ownership moves to [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]].** This feature previously owned it despite being built afterwards, which left the matcher depending on a schema defined downstream of itself. This document now consumes rather than defines.

**Ghost Resources appear as rows.** The previous specification did not say either way. Planned capability is a legitimate input to a workforce-planning view — an agency deciding whether it can bid for work should see that the senior engineer arriving in six weeks covers the gap — and excluding them would make this the only skill surface in the product that ignores them.

**The single-skill column view is added.** *Who else could cover this* is the second question anyone asks of a matrix, and the previous specification supported only the first.

**The responsive behavior degrades to an accordion rather than a scrolling grid.** A matrix does not survive a narrow viewport, and horizontal scroll across forty columns on a tablet is unusable in a way that a list is not.

---

## Related Notes

- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the schema, ordering and matching engine this feature reads
- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — where skills are attached to a person
- [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] — the forecaster projecting this coverage forward
- [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] — career pathing, which acts on an identified individual gap

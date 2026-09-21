---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F009
---

# VRS-F009 — Time Classification Taxonomy

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F005_The_Bench_Forecast|VRS-F005]] (Assignment, which billable time is logged against), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (the Pitch node and its field-level tier split)
**Blocks:** [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (which incorporates this feature's classification fields into TimesheetEntry's schema), [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] (which cannot compute anything meaningful without this classification), [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] (whose bench computation excludes Pitch-categorized days)

This document is the single source of truth for what an hour of logged time *means*.

---

## What It Is

The classification taxonomy for logged time: the raw judgment of whether an hour is **Billable** — client-chargeable work against an active Assignment — **Non-Billable** — necessary internal work — or **Pitch** — time invested pursuing new business that generates no revenue yet but is emphatically not idle.

This document owns the taxonomy and the write-time rules. It owns no dashboard, chart or aggregate; that is [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s territory entirely.

The classification is not cosmetic. It is what makes *utilization*, wherever it is computed, mean something specific rather than an arguable percentage.

---

## Problem It Solves

Without a structural classification, utilization is ambiguous in exactly the way that erodes trust in numbers.

A developer spent twenty hours on an unpaid pitch this week. Are they utilized, or benched? Counting pitch time as billable overstates revenue-generating capacity. Counting it as bench time understates a deliberate business investment, and risks that person being flagged as idle when they were doing precisely what the business asked of them. Folding necessary internal work — onboarding a new hire, internal training — into either category makes the same mistake in a different direction.

This feature exists so the distinction is enforced structurally rather than left to whoever happens to be logging hours that week.

**It is built before the timesheet interface deliberately.** A TimesheetEntry without a category is not a usable record, and building the entry surface first would mean writing a schema that has to be amended by the next feature.

---

## User-Facing Flows

### Logging billable time

An employee logs hours against an active Assignment. The category is Billable by default and implicit — the Assignment already carries the client and project context. **There is no category picker for the common case**, which is the whole point: the taxonomy exists to make classification unambiguous, not to make logging slower.

### Logging non-billable time

An employee logs against a fixed set of internal categories. No Assignment, no Pitch, no client-facing record required.

### Logging pitch time

An employee logs against a specific Pitch, selected from those they are staffed on. This is the flow that determines Pitch's tier split, below.

### How this feeds everything downstream

[[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] computes billable hours as its numerator. [[VRS-F012_Revenue_Gap_Alert|VRS-F012]]'s bench computation excludes days carrying Pitch time. Both read this classification rather than defining their own rule for what counts as productive.

---

## Interface Specification

### Screens

This feature has no screen of its own. It contributes three surfaces to [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s grid.

| Surface | Location | Purpose |
|---|---|---|
| Non-billable category chips | Expanded from the Non-Billable row | Select an internal category |
| Pitch selector | Expanded from the Pitch row | Search and select a staffed pitch |
| Category indicator | On each filled cell | Show what an hour was classified as |

### Layout and components

**Category chips** are a Toggle Group of five, rendered inline when the Non-Billable row is focused. Five is within the Toggle Group's ceiling, which is part of why the set is fixed at five.

**The Pitch selector** is a typeahead over pitches the employee is staffed on, showing pitch name and client only. It renders through the same picker component as [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]]'s reference protocol, which means the tier filtering is enforced by the shared query path rather than by this feature remembering to omit fields.

**The category indicator** is not a badge or an icon. A cell's classification is expressed by which row it sits in — billable rows carry the project name, the non-billable row carries its category chip, the pitch row carries the pitch name. Adding a per-cell marker on top of that would be decoration restating what the layout already says.

### System states

| State | Treatment |
|---|---|
| Restricted | A pitch's commercial detail never renders in the selector, at any role including Owner. The selector reads Tier 0 fields only |
| Empty | An employee staffed on no pitches sees no Pitch row at all, rather than an empty one |
| Error | A Billable entry without a valid Assignment is refused at write, with the reason named |

---

## Technical Architecture

### The classification fields

```
time_category:     enum: Billable, NonBillable, Pitch — required
internal_category: enum: Meeting, Training, Admin, InternalProject, Other
                   — required when time_category is NonBillable, null otherwise
```

Each value carries an enforced dependency, never optional and never inferred:

| Category | Requires |
|---|---|
| `Billable` | a valid `assignment_id` |
| `NonBillable` | an `internal_category` |
| `Pitch` | a valid `pitch_id` the logging employee is staffed on |

These fields are specified here and incorporated into TimesheetEntry's schema by [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]. That feature owns the node; this one owns these two fields and the rules that read them.

### The internal category set is fixed, deliberately

Five values, not workspace-configurable.

An extensible list becomes forty categories within a year, of which six are used, four mean the same thing under different names, and none is comparable across two workspaces — which destroys the one thing the classification exists to provide. A fixed set is the opinionated choice, and it is the right one.

`InternalProject` is included because agency work on its own website, brand, marketing and internal tooling is typically the single largest non-billable category in a professional services firm, and folding it into `Admin` destroys the only insight the set is there to give. An agency that discovers it spent 340 hours on its own rebrand last quarter has learned something. An agency that discovers it spent 340 hours on *admin* has not.

### Pitch's field-level tier split

Pitch is registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] with a Tier 0 identifying half and a Tier 1 commercial half, and the reason is this feature's logging flow.

An employee staffed on writing a technical proposal must select that pitch from a list to log against it. A blanket Tier 1 classification would hide the pitch entirely, making the category unusable. Relaxing the whole node to Tier 0 would expose deal value, win probability and margin terms to everyone logging time.

The split makes both requirements true at once: **name, client and staffing are Tier 0, visible to anyone assigned. Deal value, probability and commercial terms remain Tier 1.** An employee sees enough to pick the right pitch and nothing about what the deal is worth.

This is the same pattern Employee already uses, and it generalizes: where a node must be selectable by people who must not see its commercial detail, split the node rather than the permission.

### Pitch's Tier 0 half, stated in full

This feature owns Pitch's schema, since it is the first to require the split. The identifying half:

```
pitch_id:              UUID v4
workspace_id:          UUID
name:                  string, required
client_id:             UUID, nullable, FK to Client
projected_start_date:  date, nullable — when delivery would begin if won.
                       Added by VRS-F051, which needs it to bucket a pitch's
                       potential staffing demand into the correct quarter.
                       Tier 0 deliberately: a start date is an operational
                       fact, not a commercial term
lifecycle_status:      enum: Active, Won, Lost, Converted

— Universal Node Conventions per VPS-A002 —
```

The Tier 1 half — deal value, win probability, margin terms — is owned by [[Vulto Sales]] when that application exists and is never read by this feature, by [[VRS-F010_Timesheet_Speed-Run|VRS-F010]], or by any surface an employee logging time can reach.

`requires_skill` edges from Pitch, also added by [[VRS-F051_Team_Capacity_Planner|VRS-F051]], describe what staffing a pitch would need if won. They are Tier 0 for the same reason the start date is: a skill requirement is an operational fact.

### API contracts

```
timeEntry.classifyBillable(entryId, assignmentId)         -> { success }
timeEntry.classifyNonBillable(entryId, internalCategory)  -> { success }
timeEntry.classifyPitch(entryId, pitchId)                 -> { success }
  // Requires the caller be staffed on the pitch. Reads Tier 0 fields only;
  // no code path in this feature reads Tier 1 commercial detail

pitch.listStaffedFor(employeeId) -> { pitchId, name, clientName }[]
  // Tier 0 fields only. projected_start_date is deliberately absent: the
  // selector does not need it, and a narrower contract is the control
  // The selector's only data source. Returns Tier 0 fields exclusively —
  // the contract itself makes over-fetching impossible rather than discouraged
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | `time_category` carries exactly one of Billable, NonBillable or Pitch. Each has a distinct enforced dependency, never optional, never inferred |
| G02 | Pitch's field-level tier split is anchored in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. This document owns the Tier 0 half's schema; the Tier 1 half is [[Vulto Sales]]' and is never read here |
| G02b | `projected_start_date` and `requires_skill` edges on Pitch are Tier 0. Both exist for [[VRS-F051_Team_Capacity_Planner|VRS-F051]] and neither is a commercial term |
| G03 | Pitch hours are excluded from [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s billable percentage in both numerator and denominator, and from [[VRS-F012_Revenue_Gap_Alert|VRS-F012]]'s bench computation. Both read this classification rather than defining their own rule |
| G04 | The internal category set is fixed at five values and is not workspace-configurable |
| G05 | `pitch.listStaffedFor` returns Tier 0 fields only. The contract makes commercial detail unreachable through this path rather than relying on a caller to omit it |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F009-S01 | Classification fields and write-time dependency rules | Data |
| VRS-F009-S02 | Pitch selection with tier-split enforcement | Logic |
| VRS-F009-S03 | Internal category set | Data |

---

## Feature Acceptance Criteria

**GIVEN** an employee logs hours against an active Assignment
**WHEN** the entry saves
**THEN** `time_category` is Billable automatically, with no category selection presented

---

**GIVEN** an employee logs against a Pitch they are staffed on
**WHEN** the selector opens
**THEN** they see pitch name and client, and no deal value, probability or margin data, at any role including Owner

---

**GIVEN** an employee attempts to classify an entry against a Pitch they are not staffed on
**WHEN** the write is attempted
**THEN** it is refused, and the pitch never appeared in the selector to begin with

---

**GIVEN** an employee logs 30 hours of Pitch time and no billable hours this week
**WHEN** [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] evaluates their bench status
**THEN** those days are excluded from the bench computation, and no alert is raised

---

**GIVEN** an employee logs time against the agency's own website redesign
**WHEN** they classify it
**THEN** `InternalProject` is available as a distinct category rather than requiring it be filed as `Admin`

---

## Non-Functional Requirements

- Billable entries cannot exist without a valid `assignment_id`; Pitch entries cannot exist without a valid `pitch_id` the employee is staffed on. Both enforced before the write reaches the local store
- The pitch selector returns within 30ms from the local index, matching [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s search budget
- This feature's definitions are the single source of truth for what counts as Billable, Non-Billable or Pitch anywhere in the product

---

## Security Considerations

- **The Pitch tier split is the substantive security decision here.** A blanket restriction would have hidden the pitch entirely; a blanket relaxation would have exposed deal value to anyone logging time. The field-level split satisfies both.
- **`pitch.listStaffedFor` is the only path this feature uses to reach a Pitch**, and it returns Tier 0 fields exclusively. Enforcement is in the contract rather than in a caller's discipline, so an autocomplete cannot leak commercial fields even transiently.
- **Classification is not a privacy boundary.** Which category an hour falls into is Tier 0 and visible per TimesheetEntry's normal permissions. Nothing here is sensitive; the sensitivity is entirely in what a Pitch is worth.

---

## Out of Scope

- The TimesheetEntry node and the entry interaction — [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]
- Any utilization percentage, dashboard or pulse bar — [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]
- Retainer overage tracking against a contracted allocation — [[Vulto Accounts]]' territory
- Bulk historical reclassification at scale. Correcting an individual entry is supported; bulk tooling is not built
- Pitch win-rate or cost-per-won-pitch analytics — [[Vulto Sales]]

---

## Decisions Recorded

**This feature is renamed** from *Non-Billable and Pitch Time Tracking* to *Time Classification Taxonomy*. The old name described two of three categories and implied a tracking interface this feature does not own.

**It is built before [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]**, correcting a reverse dependency in the previous ordering. The classification fields are part of TimesheetEntry's schema rather than a layer on top of it, so defining them after the node existed would have meant amending a schema one feature after writing it.

**`InternalProject` is added** to the internal category set, making five. Agency work on its own brand, site and tooling is typically the largest non-billable category in a professional services firm, and filing it as `Admin` destroys the one insight the set exists to provide.

**The set is confirmed fixed rather than configurable.** An extensible list becomes uncomparable across workspaces within a year, which forecloses [[VRS-F072_Agency_Benchmarking|VRS-F072]]'s benchmarking entirely.

**Pitch's Tier 0 schema is stated in full here**, including `projected_start_date` and the `requires_skill` edges [[VRS-F051_Team_Capacity_Planner|VRS-F051]] introduced. That feature described both in prose and neither had a schema entry, which would have left an implementer building a capacity forecast against fields nothing defined.

**`pitch.listStaffedFor` is introduced** as the selector's only data source, returning Tier 0 fields exclusively. The previous specification relied on the caller not requesting commercial fields, which is a convention rather than a control.

---

## Related Notes

- [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] — the timesheet node and interface incorporating these fields
- [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] — the utilization computed from this classification
- [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] — the bench computation excluding Pitch days
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — Pitch's registered tier split

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F013
---

# VRS-F013 — Skill-to-Project Matcher

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee and `has_skill`), [[VRS-F005_The_Bench_Forecast|VRS-F005]] (the bench computation supplying availability), [[VRS-F007_Ghost_Resources|VRS-F007]] (Ghosts, matched identically), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (`requires_skill`, SkillGap and Skill registry entries), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission-scoped results)
**Blocks:** [[VRS-F014_Skill_Matrix|VRS-F014]] (which visualizes the Skill schema and proficiency ordering defined here), [[VPS-F002_Local-First_Search|VPS-F002]] (whose palette routes skill-shaped queries to this engine), [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] (which analyzes the SkillGap history this feature accumulates)

This document is the single source of truth for this feature and owns **Skill's complete schema** and the proficiency ordering the whole product uses.

---

## What It Is

A graph traversal engine with two access modes sharing one mechanism.

**The persistent mode:** a Project carries `requires_skill` edges describing what it needs, matched against `has_skill` edges describing what each person has. Any requirement with zero qualifying matches produces a SkillGap — a permanent graph record that the agency currently lacks a capability.

**The ad-hoc mode:** a query engine for the immediate question *who can do this, and are they free*, with no persistence and no side effect.

The `Cmd+K` trigger belongs to [[VPS-F002_Local-First_Search|VPS-F002]]'s command palette, which is the single search surface for the whole graph. **This feature owns the matching logic; that feature owns the keystroke.** Two features claiming one shortcut is the kind of collision that ships broken.

---

## Problem It Solves

A project manager wins an engagement needing a senior AWS architect and two mid-level React developers starting in three weeks.

Without this, she opens the People directory, scrolls thirty profiles, checks skills by hand, cross-references the Bench Forecast for availability, and arrives at a guess after twenty minutes — with no systematic way to check planned hires for the same match, and no record left behind if the search comes up empty.

With it, she attaches three requirements and receives every qualifying person ranked by availability in under a second. And if the agency genuinely lacks a skill, **that fact is recorded rather than silently forgotten the moment she moves on**, which is what makes the third or fourth occurrence of the same gap a hiring decision rather than a coincidence.

---

## User-Facing Flows

### Attaching requirements to a project

A project manager attaches required skills with a proficiency level each, using the same picker [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] uses. Each attachment writes a `requires_skill` edge.

### Viewing matches

The Skill Requirements section on the Project view surfaces results — not the Bench Forecast, whose rows are one per employee rather than one per project.

For each requirement, matching people appear ranked by availability date, then proficiency. A Ghost matching a requirement appears as a distinct card labeled Planned Hire with its projected start as the availability date. **A requirement with zero matches shows its SkillGap explicitly, not as an empty state that looks like an error.**

### The ad-hoc lookup

Through [[VPS-F002_Local-First_Search|VPS-F002]]'s palette: type a skill, get people who have it and their availability, with nothing attached to any project and no SkillGap written — nothing was requested of the graph, only asked. Results distinguish self-reported, verified and certified skills from one another.

### When the agency lacks the skill

A SkillGap is written automatically carrying the project, the skill, the required proficiency, and a severity derived from how soon the project starts. It stays Active until someone is added or updated with a qualifying skill, at which point it resolves itself. Nobody has to remember to close it.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Skill requirements | Section on the Project view | Attach requirements, read matches |
| Ad-hoc results | Within [[VPS-F002_Local-First_Search|VPS-F002]]'s palette | The immediate question |
| Skill gaps | Content | All active gaps, sorted by severity |

### Layout and components

**Skill requirements** is a stack of Sections, one per requirement. Each header shows the skill name, the required proficiency as a Badge, and the match count. Beneath, matching people render as compact rows — avatar, name, role, their proficiency, and an availability figure reading either *Available now* or *Free from 14 March*.

Ghost matches render with the dashed treatment from [[VPS-D001_Design_Foundations|VPS-D001]] and a Planned Hire Badge, sorted after real matches at equal availability. A real person available in three weeks outranks a hypothetical one available in two.

**A requirement with no matches** renders its Section with an `attention` left border and a single line: *No one available with this skill.* Beneath it, two actions — **Create a planned hire** opening [[VRS-F007_Ghost_Resources|VRS-F007]], and **Find a contractor** opening [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]]. The empty state is the most valuable state this screen produces, and it should offer the two things an agency actually does about it.

**Skill gaps** is a Table sorted by severity then project start date: skill, required proficiency, project, start date, severity Badge, days open. `Days open` is the column that matters — a gap open for four months is a hiring decision the agency has been deferring.

### Keyboard

Standard list bindings. `Enter` on a match opens that person's profile in the Panel without leaving the project.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows within each requirement Section |
| Restricted | Compensation is never shown on a match card. Availability and proficiency are Tier 0 and always shown |
| Empty | *No skill requirements attached.* with **Add requirement** |
| Empty, meaningful | Zero matches renders as a SkillGap, per above, never as a blank list |
| Error | A duplicate skill attachment replaces the proficiency rather than erroring |

### Responsive

Match rows drop the role line below 1280px. The gaps table drops `project`, then `required proficiency`.

---

## Technical Architecture

### The full Skill schema

Skill is registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] as Standard, Tier 0. Its complete schema is owned here, because this is the first feature that requires proficiency ordering and categorization to mean something:

```
skill_id:         UUID v4
workspace_id:     UUID
name:             string, required — "React", "AWS", "Figma"
category:         string, nullable — "Frontend", "Cloud", "Design".
                  Free text rather than an enum: an agency's taxonomy is its own,
                  and a fixed list would be wrong for every firm outside software
lifecycle_status: enum: Active, Deprecated

— Universal Node Conventions per VPS-A002 —
```

A Deprecated skill's existing `has_skill` edges remain visible and traversable. Deprecation removes it from active pickers going forward; it never rewrites history.

### The proficiency ordering

**Beginner, Intermediate, Senior, Expert**, in that order. Defined here once and used unchanged by [[VRS-F014_Skill_Matrix|VRS-F014]], [[VPS-F002_Local-First_Search|VPS-F002]] and [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]]. No feature defines a second ordering.

### The match rule

A match exists where an Employee's `has_skill.proficiency_level` meets **or exceeds** the requirement's `proficiency_level_required`. A Senior person satisfies a Senior or Beginner requirement; an Intermediate person does not satisfy a Senior one.

Availability is filtered using [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation — not a second implementation — within a configurable window defaulting to thirty days.

### requires_skill

At most one active edge per project and skill pair. Attaching a duplicate replaces the required proficiency rather than creating a second edge.

### SkillGap

```
skill_gap_id:                UUID v4
workspace_id:                UUID
project_id:                  UUID
skill_id:                    UUID
proficiency_level_required:  enum, copied from the edge at write time
identified_at:               timestamp
severity:                    enum: Low, Medium, High, Critical — derived from
                             working days to the project start per VRS-F004:
                             >60 Low, 30–60 Medium, 14–30 High, <14 Critical
lifecycle_status:            enum: Active, Resolved
resolved_at:                 timestamp, nullable
resolved_by:                 user_id or 'system', nullable

— Universal Node Conventions per VPS-A002 —
```

Severity counts working days rather than calendar days, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. A gap fourteen calendar days from a start date that contains a public holiday and a weekend is considerably more urgent than the calendar suggests.

### Auto-resolution

A SkillGap resolves the moment any Employee is written with a qualifying `has_skill` edge at or above the required proficiency. Evaluated on every `has_skill` write in the workspace, not on a schedule — a gap that closes on Tuesday should not persist until Thursday's sweep.

### Ghosts are included identically

A Ghost is an Employee with `employee_type = Ghost` carrying `has_skill` edges. The traversal makes no distinction at query level; the difference is presentational and in the availability date used.

### API contracts

```
project.attachSkillRequirement(projectId, skillId, proficiencyLevelRequired) -> { edgeId }
project.getMatchResults(projectId, availabilityWindowDays?) -> {
  perRequirement: [{
    skillId, proficiencyLevelRequired,
    matches: [{ employeeId, isGhost, availabilityDate, proficiencyLevel,
                verified, certified }],
    skillGapId?
  }]
}
  // Entirely local. Within 200ms for 150 employees and 50 projects

skillMatcher.adHocSearch(query) -> {
  results: [{ employeeId, isGhost, availabilityStatus, matchedSkills }]
}
  // Called by VPS-F002's palette. No persistence, no SkillGap.
  // Within 10ms of the third character typed

skill.create(name, category?)  -> { skillId }
skill.deprecate(skillId)       -> { success }
skillGap.listActive(workspaceId) -> SkillGap[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Skill carries the full schema above. This feature owns it |
| G02 | The proficiency ordering is Beginner, Intermediate, Senior, Expert, defined here and used unchanged by every consuming feature |
| G03 | `requires_skill` allows at most one active edge per project and skill pair. Duplicates replace rather than accumulate |
| G04 | A match exists where proficiency meets or exceeds the requirement, per the ordering above |
| G05 | Availability uses [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation, never a second implementation |
| G06 | A SkillGap is written when a requirement returns zero matches after availability filtering |
| G07 | Severity counts working days to project start per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], not calendar days |
| G08 | A SkillGap resolves automatically on any qualifying `has_skill` write, evaluated per write rather than on a schedule |
| G09 | Ghosts participate identically at query level. The distinction is presentational and in the availability date |
| G10 | A Deprecated Skill's existing edges remain visible and traversable. Deprecation affects only future picker availability |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F013-S01 | Skill schema and proficiency ordering | Data |
| VRS-F013-S02 | Project skill requirements | Data |
| VRS-F013-S03 | Match query engine | Logic |
| VRS-F013-S04 | Match results surface | UI |
| VRS-F013-S05 | SkillGap detection and auto-resolution | Logic |
| VRS-F013-S06 | Ad-hoc match engine | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a project with two requirements, three people matching one and one matching the other
**WHEN** match results are viewed
**THEN** three ranked cards appear for the first and one for the second, within 200ms from the local graph

---

**GIVEN** a project requires Expert iOS and nobody qualifies
**WHEN** the engine runs
**THEN** a SkillGap is written with the correct skill, proficiency and severity computed from working days to start, and the requirement renders explicitly as a gap with the two remediation actions

---

**GIVEN** a Ghost holds a qualifying skill
**WHEN** matches are viewed
**THEN** it appears as a Planned Hire card with its projected start as the availability date, sorted after equally-available real people

---

**GIVEN** a new employee is added with a skill matching an Active SkillGap
**WHEN** the `has_skill` edge is written
**THEN** the gap resolves within 1 second with `resolved_at` and `resolved_by` set

---

**GIVEN** a user types a skill name into [[VPS-F002_Local-First_Search|VPS-F002]]'s palette
**WHEN** results return
**THEN** matching people appear within 10ms, with no SkillGap created and no edge written, whether or not any match is found

---

**GIVEN** a Manager runs a match for a project
**WHEN** results return
**THEN** every qualifying employee in the workspace appears, not only their direct reports, because employee operational data is workspace-readable per the decision below

---

**GIVEN** the device is offline
**WHEN** either mode is used
**THEN** both render fully from the local graph with no network attempt and no degradation

---

## Non-Functional Requirements

- Persistent match results within 200ms for 150 employees and 50 projects
- Ad-hoc lookup within 10ms of the third character typed
- Full functionality offline in both modes
- Match results and SkillGap resolution update within 1 second of any relevant change
- A match is never returned for an under-qualified person; proficiency ordering is enforced exactly
- Exactly one SkillGap per project, skill and proficiency triple; no duplicate for an already-Active gap

---

## Security Considerations

- **This feature constructs no permission logic of its own.** Results pass through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor like every other read.
- **Employee operational data is workspace-readable**, per the decision below, so match results are not silently truncated by the viewer's role. Compensation remains Tier 1 and never appears on a match card.
- **A SkillGap names a capability the agency lacks**, which is commercially sensitive in aggregate. It is Tier 0 and visible to every member, which is correct — the people who might learn the skill should know it is wanted — but [[VRS-F072_Agency_Benchmarking|VRS-F072]]'s benchmarking must never expose one workspace's gaps to another.

---

## Out of Scope

- AI scheduling suggestions — [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]
- Cross-project allocation optimization — [[VRS-F051_Team_Capacity_Planner|VRS-F051]]
- Candidate matching from the hiring pipeline — this feature operates on Employee nodes; candidates are [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s territory
- Peer endorsement beyond the existing `verified` flag — [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]
- Weighted scoring by seniority, department or rate — [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]
- Notifying a matched person or their manager — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]
- Forecasting future gaps against pipeline — [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]]

---

## Decisions Recorded

**Skill's schema and the proficiency ordering move here from [[VRS-F014_Skill_Matrix|VRS-F014]].** That feature was previously the owner despite being built afterwards, which meant this feature depended on a schema defined by a document downstream of it. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s registry entry for Skill is corrected to name this feature as owner.

**The Manager visibility limitation is resolved rather than documented.** The previous specification stated, honestly, that a Manager would see matches only among their own reports and that broader visibility was an unresolved product question. That is now decided: **employee operational data — name, role, skills, availability — is readable by every workspace member.** Compensation, performance, HR records and manager-restricted signals remain scoped exactly as they were.

Three reasons. First, [[VRS-F005_The_Bench_Forecast|VRS-F005]] already renders every active employee as a row to every viewer, so the previous restriction made the matcher inconsistent with the Bench Forecast. Second, a project manager who cannot see who is free outside their own reports cannot staff a project, which is the entire purpose of this feature. Third, in a professional services firm the roster is not confidential — everyone knows who works there and what they do — and treating it as though it were protects nothing while breaking the product's most-used query.

**Severity counts working days**, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Fourteen calendar days containing a weekend and a public holiday is nine working days, and the difference between High and Critical urgency.

**The zero-match state offers two actions.** Discovering a capability gap and being offered nothing to do about it wastes the most valuable moment this feature produces.

---

## Related Notes

- [[VRS-F014_Skill_Matrix|VRS-F014]] — the matrix visualizing this schema
- [[VPS-F002_Local-First_Search|VPS-F002]] — the palette routing skill queries here
- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the availability computation this feature filters on
- [[VRS-F007_Ghost_Resources|VRS-F007]] — planned hires, matched identically
- [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] — the forecaster analysing accumulated gaps

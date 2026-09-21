---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F037
---

# VRS-F037 — Dynamic Org Chart

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (**Loro's Movable Tree, the primitive this feature exists to use**), [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee and the `managed_by` edge), [[VRS-F007_Ghost_Resources|VRS-F007]] (Ghost Resources, which appear in the chart), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (Departure, which a scenario may anticipate), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (OrgScenario), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission — the chart is Standard, scenarios are Owner and HR Admin only)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Why this feature exists

[[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] selected Loro over Automerge and Yjs, and the stated reason was its native **Movable Tree** primitive, chosen specifically for organizational hierarchy. Automerge was rejected because a tree would have been an application-level workaround; Yjs for the same reason.

**No feature in the previous specification set used it.** The architecture was paying a real cost — a younger ecosystem than either alternative — for a capability the product never exercised.

This feature uses it, and [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] now carries a standing rule protecting it: modeling the reporting hierarchy as flat parent pointers in application code would forfeit the reason that library was chosen, and requires a superseding decision rather than an implementation shortcut.

---

## What It Is

Two things. **The live chart** is a visualization of the `managed_by` hierarchy, showing who reports to whom, with span of control and cost roll-up where the viewer is authorized to see it. **Scenario mode** is a sandbox in which a proposed restructure can be modeled — moving people, removing roles, adding planned hires — against real cost, without touching the live graph until it is committed.

---

## Problem It Solves

Most org charts are posters. Drawn in a slide deck, accurate the week they were made, and consulted by nobody because everyone already knows who they report to.

**An org chart in a professional services firm is worth building only if it answers operational questions**, and there are three worth answering: who actually reports to whom right now, given that `managed_by` changes and nobody redraws the poster; how many direct reports does each manager have, since a manager with fourteen is a problem visible nowhere else; and what would a proposed restructure cost.

That third question is why this feature exists. A founder considering moving a team under a different lead, or removing a layer, currently does that arithmetic in a spreadsheet against numbers copied out of the product — and the numbers are stale before the conversation ends.

---

## User-Facing Flows

### Viewing the live chart

A hierarchy rendered from `managed_by`, each node showing the person, their role, and their direct report count. Expanding and collapsing branches; searching to jump to a person and reveal their position.

An employee with no manager sits at the root. **Several roots are normal and not an error** — a founder, a non-executive advisor and a contractor engaged directly all legitimately report to nobody.

### Span of control

Each manager node shows its direct report count, and its total downstream count on hover. **A count above the workspace's configured threshold renders in `attention`** — not as a judgment, but because a manager with fourteen direct reports is a fact that is otherwise invisible until something goes wrong.

### Cost roll-up

Where the viewer holds Tier 1 access, each branch shows its total compensation cost. Where they do not, the branch shows headcount only.

This is the one place in the product where an organizational structure and a cost figure appear together, and it is the combination that makes a restructure conversation possible at all.

### Scenario mode

An HR Admin or Owner creates a scenario from the current live chart. Inside it they can move a person to a different manager, mark a role as removed, add a planned hire, or promote someone into a management position.

**Nothing touches the live graph.** The scenario shows its own cost total and delta against the live chart — *−£84,000, −2 headcount* — computed from the same figures.

### Committing or discarding

Committing applies the scenario's changes to the live graph: `managed_by` edges are rewritten through their single-active-with-history pattern, so the previous structure remains traversable. **Removals do not offboard anyone** — they create a flagged item for HR to action through [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]], because a restructure model is not a termination decision.

Discarding deletes the scenario.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Org chart | Content, full width | The live hierarchy |
| Scenario | Content, full width | The sandbox |
| Node detail | Panel | One person's position |

### Layout and components

The chart is a **vertical tree**, root at the top, children beneath, connected by 1px `border-default` orthogonal lines. Vertical rather than horizontal because names read left to right and a horizontal tree rotates them or truncates them, and neither is acceptable in a chart whose entire content is names.

Each node is a 200×64px Card: avatar at 24px, name at `body-medium`, role at `small` in `text-secondary`, and where the person manages others a right-aligned count in `numeric`. Ghost Resources render with the dashed treatment from [[VPS-D001_Design_Foundations|VPS-D001]].

A branch collapses to a single node showing the subtree's headcount — *+ 12 people* — which is what makes a hundred-and-fifty-person chart navigable rather than a wall.

**Cost, where visible, renders beneath the count in `numeric` at `text-secondary`**, deliberately quieter than the name. A chart where money is the most prominent element on every card is a chart that changes how people read the organization.

**Scenario mode is visually distinct at the canvas level**, not by a badge: the canvas takes `bg-subtle` and a 2px `attention` border, with a fixed bar along the top holding the scenario name, the delta in `numeric-lg`, and **Commit** and **Discard**. Someone should never be uncertain whether they are looking at the real organization.

Moved nodes render with an `attention` left border. Removed nodes render at 40% opacity with a strikethrough on the name. Added nodes render dashed, per the placeholder rule.

Dragging moves a person; the delta recomputes on drop. **This is the one drag interaction in the product**, and it is warranted because a restructure is inherently spatial and expressing it as a series of dropdowns would make the feature not worth using.

### Keyboard

Drag is not the only path. `Enter` on a focused node opens a **Move to** picker listing every valid manager, filtered as you type. `↑ ↓` move between siblings, `← →` between levels, `Space` collapses a branch.

The feature is fully operable without a mouse, per [[VPS-D002_Component_Library|VPS-D002]]'s accessibility floor.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton nodes at correct dimensions |
| Restricted | Cost is absent without Tier 1 access; headcount remains. Scenarios are structurally absent for Managers and Team Members |
| Empty | A workspace with no `managed_by` edges shows a flat list and a line explaining that reporting lines are set on the employee profile |
| Cycle | A move creating a cycle is refused at write, naming the loop |
| Error | Committing a scenario whose people have since changed manager warns first, naming each conflict |

### Responsive

Below 1280px the chart becomes a nested indented list rather than a tree. Scenario mode is desktop-only below 1024px and says so — a restructure is not a task for a phone.

---

## Technical Architecture

### The live hierarchy uses Loro's Movable Tree

`managed_by` is backed by Loro's Movable Tree per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], which is what makes concurrent reorganization safe.

The failure this prevents is specific and would otherwise be real: two administrators, offline, each moving a different part of the organization. With parent pointers merged by last-write-wins, one plausible outcome is a **cycle** — A reports to B, B reports to A — which is not merely wrong but structurally invalid, and which a naive merge produces silently.

Loro's Movable Tree resolves concurrent moves without producing cycles, by construction. This is the specific guarantee the library was chosen for.

**This feature writes the Tree only, never the edge.** Move and Commit below rewrite `managed_by` through its single-active-with-history pattern, but that rewrite is the materialization worker's deterministic response to the Tree's resolved state after merge — not a second write this feature performs itself. The Tree is authoritative for who reports to whom right now; the edge is authoritative for the history. Per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] and [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], no application code, this feature included, ever writes `managed_by` directly.

### OrgScenario

Owner and HR Admin only, Tier 2.

```
scenario_id:      UUID v4
workspace_id:     UUID
name:             string, required
description:      text, nullable
base_snapshot:    JSON — the live hierarchy at creation, so the delta remains
                  meaningful even as the live chart changes beneath it
changes:          JSON array of:
                    { type: 'Move',   employee_id, new_manager_id }
                    { type: 'Remove', employee_id, note }
                    { type: 'Add',    role_title, seniority_level,
                                      manager_id, estimated_cost }
                    { type: 'Promote', employee_id, new_role_title }
status:           enum: Draft, Committed, Discarded
committed_at:     timestamp, nullable
committed_by:     user_id, nullable

— Universal Node Conventions per VPS-A002 —
```

**A scenario stores changes, not a copy of the organization.** A full duplicate would need reconciling against a live graph that moves beneath it; a change list applied to a base snapshot always tells you what was actually proposed.

### Why OrgScenario is Owner and HR Admin only

A draft restructure showing a role removed reveals a planned departure before the person concerned has been told. That is among the most damaging things this product could leak, and it is why scenarios are Tier 2 and absent for Managers entirely — including a manager modeling changes to their own team.

The cost of that restriction is real: a manager cannot think out loud in this tool. It is accepted because the alternative is a person learning about their own redundancy from an org chart.

### Commit

Commit applies each change:

- **Move** rewrites `managed_by` through its single-active-with-history pattern. The previous edge closes with `effective_to`; the previous structure stays traversable.
- **Add** creates a Ghost Resource per [[VRS-F007_Ghost_Resources|VRS-F007]].
- **Promote** updates `job_title` and creates any implied `managed_by` edges.
- **Remove** creates a flagged item for HR review. **It never offboards anyone.**

That last one is the important boundary. A restructure model is a plan; ending someone's employment is a decision with legal process attached, and it runs through [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] and [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] like every other departure.

### Conflict on commit

Where a person in a scenario has changed manager in the live graph since the scenario was created, commit warns and names each conflict rather than overwriting. The person committing chooses per conflict.

### Cost roll-up

Computed live from Tier 1 compensation on an authorized device, never stored on the chart or in the scenario. Where the viewer lacks access, the query returns headcount only — structurally, not by filtering a figure it already fetched.

### API contracts

```
orgChart.get(workspaceId, rootEmployeeId?) -> {
  nodes: { employeeId, isGhost, name, role, directReportCount,
           downstreamCount, cost? }[],
  edges: { fromEmployeeId, toManagerId }[]
}
  // cost present only where the caller holds Tier 1 access

orgChart.setManager(employeeId, managerId) -> { success }
  // Refuses a move creating a cycle

orgScenario.create(name, description?)        -> { scenarioId }
orgScenario.addChange(scenarioId, change)     -> { scenarioId, delta }
orgScenario.getDelta(scenarioId)              -> {
  headcountDelta, costDelta?, affectedEmployees
}
orgScenario.commit(scenarioId)                -> {
  applied, conflicts, flaggedForHrReview
}
orgScenario.discard(scenarioId)               -> { success }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | The hierarchy is backed by Loro's Movable Tree per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]. Modeling it as flat parent pointers in application code requires a superseding architecture decision |
| G02 | A move creating a cycle is refused at write. Concurrent moves cannot produce one, by the Movable Tree's own guarantee |
| G03 | Multiple roots are valid. An employee with no manager is not an error |
| G04 | Commit rewrites `managed_by` through single-active-with-history. Previous structure remains traversable |
| G05 | A scenario's Remove creates a flagged HR item. It never offboards, never sets an end date, and never creates a Departure |
| G06 | A scenario stores a change list against a base snapshot, never a duplicate of the organization |
| G07 | Cost roll-up is computed live on an authorized device and never stored on a chart or scenario node |
| G08 | OrgScenario is Owner and HR Admin only, Tier 2. Managers and Team Members have no access, including to scenarios covering their own team |
| G09 | Ghost Resources appear in the live chart, positioned by their manager where one is set |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F037-S01 | Movable Tree hierarchy and cycle prevention | Data |
| VRS-F037-S02 | Chart rendering and navigation | UI |
| VRS-F037-S03 | Span of control and cost roll-up | Logic |
| VRS-F037-S04 | Scenario sandbox | Logic |
| VRS-F037-S05 | Commit and conflict resolution | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a workspace of 150 employees with reporting lines set
**WHEN** the chart loads
**THEN** the full hierarchy renders within 300ms from the local graph, collapsible by branch

---

**GIVEN** two administrators offline each move a different subtree
**WHEN** both reconnect
**THEN** both moves merge without producing a cycle, per Loro's Movable Tree guarantee, and no manual resolution is required

---

**GIVEN** a move would make A report to B where B already reports to A
**WHEN** it is attempted
**THEN** it is refused at write, naming the loop

---

**GIVEN** a manager has 14 direct reports against a threshold of 8
**WHEN** the chart renders
**THEN** the count renders `attention`

---

**GIVEN** a viewer without Tier 1 access
**WHEN** the chart loads
**THEN** headcount is present, cost is structurally absent, and no figure was fetched and hidden

---

**GIVEN** an HR Admin builds a scenario moving a team and removing a role
**WHEN** the delta is computed
**THEN** it shows the headcount and cost change against the base snapshot, with the live graph unchanged

---

**GIVEN** a scenario containing a Remove is committed
**WHEN** commit executes
**THEN** an HR review item is flagged, no employee is offboarded, no end date is set, and no Departure exists

---

**GIVEN** a person in a scenario changed manager in the live graph since the scenario was created
**WHEN** commit runs
**THEN** the conflict is named and the committer chooses, rather than the scenario overwriting

---

**GIVEN** a Manager attempts to open scenarios
**WHEN** the attempt is made
**THEN** the surface is structurally absent, including for a scenario covering their own team

---

## Non-Functional Requirements

- The chart renders within 300ms for 150 employees from the local graph
- Collapse, expand and search complete within 100ms
- Scenario delta recomputes within 200ms of any change
- Full functionality offline, including scenario building
- The chart is fully operable by keyboard without drag

---

## Security Considerations

- **OrgScenario's Owner and HR Admin only class is the substantive decision.** A draft showing a role removed reveals a planned departure before the person has been told, and there is no version of that leak that is acceptable. The cost — a manager cannot model changes to their own team — is real and accepted.
- **Cost roll-up is a Tier 1 aggregate over a hierarchy.** In a small branch it approximates individual compensation closely: a manager with two reports whose branch total is visible has effectively disclosed both salaries to anyone who knows one. The roll-up therefore requires Tier 1 access in full, and is not subject to a k-anonymity partial-disclosure model, because a partial answer here is a solvable equation.
- **The live chart itself is Standard, Tier 0.** Who reports to whom is operational information every employee should be able to see, and the same reasoning [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] applies to roster visibility applies here.
- **Commit is audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]], recording every applied change. A restructure is exactly the operation someone asks about afterwards.

---

## Out of Scope

- **Dotted-line or matrix reporting.** `managed_by` is a single active edge and this product is opinionated that a person has one manager. A firm needing matrix reporting is describing an organization this product is not built for
- **Approval workflow on a scenario commit** — an Owner or HR Admin commits directly. Adding a fifth approval chain for a change that already flags every consequential item for HR review would be process for its own sake
- **Position or seat modeling** — the chart is people, not vacancies. A planned role is a Ghost Resource
- **Historical playback of the chart over time.** The history exists in `managed_by`'s effective dates and is traversable; a time-slider visualization is not built
- **Export as an image or slide** — [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]]
- **Offboarding of any kind** — [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] and [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]

---

## Decisions Recorded

**This feature is new and closes an architectural gap rather than adding a capability.** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] chose Loro specifically for the Movable Tree and no feature used it. That is an architecture paying for something the product never exercised, and it was the clearest instance of the class of problem this whole pass exists to find.

**A scenario's Remove never offboards.** It flags an item for HR. A restructure model is a plan; ending employment has legal process attached and runs through the features that own it. Conflating them would let a drag-and-drop gesture end someone's employment.

**Scenarios are Owner and HR Admin only, which costs something real.** A manager cannot think out loud about their own team in this tool. Accepted, because the alternative is someone learning about their own redundancy from a chart.

**Cost roll-up requires full Tier 1 access with no partial-disclosure model.** A branch total over two people is a solvable equation, and k-anonymity does not help where the cohort structure is itself visible.

**Dotted-line reporting is permanently excluded.** `managed_by` is single-active by design, and matrix reporting is a different organizational model from the one this product is opinionated about.

**Drag is the primary interaction and not the only one.** A restructure is spatial and expressing it through dropdowns would make the feature not worth using — but a keyboard path exists in full, because a product that requires a mouse for one screen has an accessibility failure on that screen.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the Movable Tree this feature exists to use
- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the `managed_by` edge this chart renders
- [[VRS-F007_Ghost_Resources|VRS-F007]] — Ghost Resources appearing in the chart
- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — where a flagged removal is actually actioned
- [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] — promotions, which change the chart

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F007
---

# VRS-F007 — Ghost Resources

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee's `employee_type` and full schema), [[VRS-F005_The_Bench_Forecast|VRS-F005]] (the Assignment model and the 100% capacity constraint, consumed here without redefinition), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (`placeholder_for` and `promoted_to`), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (sync and conflict resolution, with one deliberate exception), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission enforcement — unremarkable, both node types are Tier 0)
**Blocks:** Nothing structurally. [[VRS-F005_The_Bench_Forecast|VRS-F005]] renders without this feature; it simply has no Ghost rows.

This document is the single source of truth for this feature.

---

## What It Is

Named capacity placeholders that appear in the Bench Forecast as fully formed rows before a real person is hired.

A Ghost Resource is **two linked nodes created atomically**: an Employee node with `employee_type = Ghost`, which receives Assignment edges and renders in the forecast, and a GhostResource node holding planning metadata, lifecycle status, the recruitment link and the eventual promotion record.

The split matters. The Employee node is the capacity representation, which is why [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s rendering needs no knowledge of whether it is drawing a real person or a placeholder — it draws an Employee. The GhostResource node is bookkeeping that has no equivalent for a real employee.

---

## Problem It Solves

An agency wins a project starting in eight weeks requiring two senior backend engineers. Both hires are in progress and neither is made.

Without placeholders, the forecast shows a gap: two rows missing, a project understaffed on paper, and no way to plan revenue against expected capacity. The founder is left holding the intended state in their head, which is precisely the failure this product exists to eliminate.

With Ghost Resources the founder creates two rows, assigns them, and the forecast reflects the intended state immediately. When a hire lands, the Ghost promotes to a live employee in one action — no re-assignment, no data loss, no gap.

---

## User-Facing Flows

### Creating a Ghost

An Owner, HR Admin or Manager creates one from the Bench Forecast or the People directory. The form collects a role title, a projected start date, optional target skills using the same picker as [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], an optional seniority level, an optional expected billing rate, and an optional link to an existing OpenRole.

Both nodes write atomically. The row appears immediately with the dashed treatment from [[VPS-D001_Design_Foundations|VPS-D001]]'s placeholder rule, with the role title where a name would be. Opacity is unchanged so every label continues to meet the same contrast floor as a real employee.

### Assigning and tracking

A Ghost is assignable identically to a real employee, including the 100% capacity constraint — there is no separate constraint for placeholders. Its skill edges are traversable by [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] and by [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s intelligence panel exactly as a real employee's are.

Ghost capacity is included in aggregate utilization, with the Ghost contribution shown separately beside the figure. A utilization percentage that silently counts people who do not exist would be a worse lie than no percentage at all.

### Promoting to a real employee

An Owner or HR Admin selects **Promote to employee**. A modal collects real name, email, employment type and start date, or links an existing Employee node where one already exists — the common case being a candidate hired through [[VRS-F028_Recruitment_Pipeline|VRS-F028]].

Confirming runs the promotion transaction. The row transitions from placeholder to live styling with no re-assignment step; every Assignment edge the Ghost held is preserved unchanged.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Ghost row | Within [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s timeline | Rendering and inline actions |
| Create Ghost | Modal | Short, complete, not abandonable halfway |
| Ghost detail | Panel | Planning metadata, recruitment link, promote action |
| Promote | Modal | Consequential and irreversible |

### Layout and components

**The Ghost row** is identical in geometry to a real employee row. Its left column shows the role title at `body-medium` and the seniority at `small`, with a `Ghost` Badge in `subtle` intensity. Bars use the neutral Assignment-bar fill with a 1px dashed `border-strong`; the categorical project dot remains present. This is the same treatment [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] uses for aged-out data, and correctly so: both mean *expected, not here yet*.

**Ghost detail** in the Panel: role, seniority, projected start, target skills as Badges, the linked OpenRole where present, notes, and the assignment list. Primary action **Promote to employee**; secondary **Link open role**; `danger` **Cancel**.

**The promote modal** collects the four fields and shows what will be preserved — assignment count, skill count, and the projected-versus-actual start date where they differ. A start date moving by three weeks changes the forecast, and someone should see that before confirming rather than discover it afterwards.

**Offline promotion is visibly different.** Where the device is offline, the confirm action reads **Queue promotion** and the resulting state is a `Pending confirmation` Badge on the row, not a completed promotion. This is the one place in the product where an action does not complete optimistically, and the interface says so plainly rather than appearing to succeed.

### Keyboard

Ghost rows participate in `J`/`K` navigation identically. `P` from a focused Ghost row opens the promote modal.

### System states

| State | Treatment |
|---|---|
| Syncing | Standard skeleton, no distinct treatment |
| Pending confirmation | `attention` Badge reading *Promotion pending* until the server confirms |
| Restricted | Team Members see Ghost rows and their assignments. Expected billing rate follows the same tier rules as a real employee's |
| Empty | The People directory's Ghost filter empty state reads *No planned hires. Create one to forecast against a role you have not filled yet.* |
| Error | An already-promoted Ghost returns a clear rejection naming who promoted it and when |

### Responsive

Identical to real rows. No separate treatment.

---

## Technical Architecture

### The two nodes

```
Employee node — per VRS-F002's full schema:
  employee_type:     'Ghost'
  job_title:         the role title
  start_date:        the projected start date
  employment_status: 'Active'
  seniority_level:   optional, used by VRS-F006's rate resolution
  billing_rate_default: optional, the expected rate
  — every other field null until promotion

GhostResource node:
  ghost_id:          UUID v4
  workspace_id:      UUID
  ghost_employee_id: UUID, FK to the linked Employee — set once, never changed
  lifecycle_status:  enum: Active, Promoted, Canceled
  notes:             rich_text, nullable

  — Universal Node Conventions per VPS-A002 —
```

Ghosts deliberately reuse Employee's existing `job_title` and `start_date` rather than introducing parallel fields. That reuse is exactly why [[VRS-F005_The_Bench_Forecast|VRS-F005]] needs no special case: it reads the fields it always reads.

### Edges

**`placeholder_for`**, GhostResource to OpenRole: at most one active edge. Relinking closes the prior edge and creates a new one rather than accumulating links.

**`promoted_to`**, GhostResource to Employee: created exactly once, at promotion, never modified. It is the permanent record that a given employee originated as a placeholder — useful years later when someone asks how long a role took to fill.

### The promotion transaction, and its deliberate exception to [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]

Promotion modifies the linked Employee atomically: `employee_type` becomes Employee; name, email, employment type and start date are set; every Assignment edge, skill edge and piece of graph history is preserved untouched. The GhostResource becomes Promoted and its `promoted_to` edge is created.

**This is the one operation in the product that requires server confirmation.**

[[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s last-write-wins is correct for routine edits. Promotion is not routine: it is one-time, irreversible and human-initiated. Applying last-write-wins would mean that if an Owner on one device and an HR Admin on another both promote the same Ghost while offline, with different details, one silently overwrites the other on reconnection and neither person is ever told. For an action this consequential that failure mode is unacceptable.

The first promotion request the server receives succeeds. Any subsequent attempt on the same Ghost is rejected outright with a message naming who promoted it and when, never silently discarded or merged. This is why promotion alone does not complete offline — it queues, and the requesting user is shown that it is pending rather than done.

### API contracts

```
ghostResource.create(roleTitle, projectedStartDate, seniorityLevel?, targetSkills?, expectedRate?, openRoleId?)
  -> { ghostId, employeeId }
  // Both nodes atomic; fully functional offline

ghostResource.linkOpenRole(ghostId, openRoleId) -> { success }
ghostResource.promote(ghostId, { fullName, email, employmentType, startDate } | { existingEmployeeId })
  -> { status: 'promoted' | 'pending_confirmation' }
ghostResource.cancel(ghostId)                   -> { success }
ghostResource.list(workspaceId, status?)        -> GhostResource[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | A Ghost is two nodes created atomically, linked permanently by `ghost_employee_id`, set once and never changed |
| G02 | `placeholder_for` allows at most one active edge per GhostResource. Relinking replaces; it never duplicates |
| G03 | `promoted_to` is created once at promotion and never modified. It is the permanent record of origin |
| G04 | Ghost Employee nodes participate in Assignment edges identically, including the 100% capacity constraint from [[VRS-F005_The_Bench_Forecast|VRS-F005]], with no special case |
| G05 | Ghost Employee nodes carry `has_skill` edges identically, traversed by [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] and [[VRS-F005_The_Bench_Forecast|VRS-F005]] without special-casing |
| G06 | The promotion transaction is atomic across every step. Any failure rolls back entirely; the Ghost remains Active with no partial state committed |
| G07 | Promotion requires server confirmation. A second promotion attempt on the same Ghost is rejected outright, never merged or silently discarded |
| G08 | Ghost capacity is included in aggregate utilization, and the Ghost contribution is reported separately alongside it |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F007-S01 | Ghost schema and atomic creation | Data |
| VRS-F007-S02 | Ghost row rendering and inline actions | UI |
| VRS-F007-S03 | Open role linkage | Logic |
| VRS-F007-S04 | Promotion transaction and confirmation | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a founder creates a Ghost with role title *Senior React Developer* and a projected start date
**WHEN** it saves
**THEN** both nodes exist locally, and the row appears in the Bench Forecast within 500ms, dashed and visually distinct

---

**GIVEN** a Ghost is assigned at 80%
**WHEN** a second assignment is attempted at 30% over the same range
**THEN** it is rejected with the identical `ConflictError` a real employee would receive, per [[VRS-F005_The_Bench_Forecast|VRS-F005]]

---

**GIVEN** a Ghost with assignments and skills is promoted while online
**WHEN** the transaction runs
**THEN** it completes atomically: status becomes Promoted, `promoted_to` is created, the Employee updates with real details, `employee_type` becomes Employee, every Assignment edge is preserved, and the row transitions to live styling within 1 second

---

**GIVEN** the promotion transaction fails at any step
**WHEN** the failure occurs
**THEN** every step rolls back, the Ghost remains Active as a Ghost, no partial state exists, and the user sees an error directing them to retry

---

**GIVEN** two devices attempt to promote the same Ghost while both offline
**WHEN** both reconnect
**THEN** exactly one succeeds, and the second receives a rejection naming who promoted it and when, rather than silently overwriting or being overwritten

---

**GIVEN** a device is offline
**WHEN** a founder creates a Ghost
**THEN** both nodes write locally, the row appears without waiting for connectivity, and the creation syncs on reconnection

---

**GIVEN** a workspace with twelve real employees and three Ghosts
**WHEN** aggregate utilization is displayed
**THEN** the Ghost contribution is reported separately, and the figure never silently counts capacity that does not exist

---

**GIVEN** a Ghost's projected start date is 1 June and the promotion sets an actual start of 22 June
**WHEN** the promote modal is shown
**THEN** the three-week difference is displayed before confirmation, since it changes the forecast the founder has been planning against

---

## Non-Functional Requirements

- Ghost rows render within [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s 200ms budget, no separate render pass
- Creation and promotion are each atomic; partial state is never committed locally
- Creation, assignment and skill attachment are fully functional offline. Promotion is the deliberate exception, blocked with a clear pending state rather than silently queued as though it had succeeded
- Ghost writes propagate to all connected devices within 1 second
- Ghost rows are visually distinct in every view state, enforced at the rendering layer rather than by a user-visible flag

---

## Security Considerations

- **Ghost Resources carry no elevated privacy concern.** Both node types are Tier 0. The only security-relevant behavior here is the promotion race handling, which is a data-integrity concern rather than a confidentiality one.
- **A Ghost's expected billing rate follows the same tier rules as a real employee's.** A placeholder is not an exemption from [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s treatment of rates.
- **Promotion is audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]], because it converts a planning artifact into an employment record and both the timing and the actor matter afterwards.

---

## Out of Scope

- Ghosts assigned beyond the 100% constraint — [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s constraint governs both identically, so no separate rule exists
- Ghosts as candidates in the hiring pipeline — a Ghost is a capacity placeholder, not a hiring record. The connection to hiring is the OpenRole link; the pipeline is [[VRS-F028_Recruitment_Pipeline|VRS-F028]]
- Automatic Ghost creation from a won pitch or a skill gap — [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]]
- Requisition approval and headcount budgeting — [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]
- Bulk Ghost creation — [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] handles bulk data; this is not a bulk-authoring surface
- AI suggestions for when to create one — [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]]

---

## Decisions Recorded

**Ghost contribution to aggregate utilization is reported separately**, per G08. The previous specification included Ghosts in the aggregate without qualification, which produces a utilization figure that counts people who do not exist. For a product whose central claim is that its numbers are trustworthy, an unlabeled blend of real and planned capacity is exactly the wrong compromise.

**Seniority and expected rate are added to the creation form.** [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s resolution matches on `seniority_level`, so a Ghost without one cannot be priced, and a Ghost that cannot be priced contributes nothing to the margin forecast it exists to inform.

**The projected-versus-actual start difference is surfaced at promotion.** A hire landing three weeks later than planned changes the forecast the founder has been making decisions against, and the previous flow committed that change without showing it.

---

## Related Notes

- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the forecast these rows appear in, and the constraint they obey
- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the Employee schema a Ghost occupies
- [[VRS-F006_Rate_Card_Engine|VRS-F006]] — the rate resolution requiring a Ghost's seniority
- [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] — headcount planning, which a Ghost anticipates
- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the recruitment pipeline a Ghost links to

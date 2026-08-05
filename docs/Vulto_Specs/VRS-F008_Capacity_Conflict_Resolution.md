---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F008
---

# VRS-F008 — Capacity Conflict Resolution

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — overlap is measured in working days, not calendar days), [[VRS-F005_The_Bench_Forecast|VRS-F005]] (Assignment, the 100% capacity constraint and its `ConflictError`, extended here to support a deliberate override), [[VRS-F007_Ghost_Resources|VRS-F007]] (Ghosts, subject to the identical constraint), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (Assignment's existing write permissions; the override is an application-layer authorization check, not a new permission row)
**Blocks:** Nothing structurally. [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] reuses this feature's overlap computation for its own leave-versus-assignment surface.

This document is the single source of truth for this feature.

---

## A note on the name

*Conflict resolution* already means something else in this project. [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s sync layer has its own conflict resolution rules for concurrent edits across devices — last-write-wins, soft-delete-wins.

That is a different problem, solved a different way, by a different document. **This feature is about a person being scheduled for more work than they have hours to do**, not about two devices disagreeing over a write. The feature is named *Capacity* Conflict Resolution for exactly that reason, and this document does not touch [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s rules at all.

---

## What It Is

[[VRS-F005_The_Bench_Forecast|VRS-F005]] defines the hard rule: combined `billable_percentage` across overlapping Assignments cannot exceed 100, enforced at write time with a `ConflictError`. That rule was correct to build first and correct to make unconditional — a Bench Forecast whose capacity numbers can silently be wrong is worse than one that occasionally gets in a manager's way.

This feature is what happens the moment that error fires. Instead of a bare rejection, the person gets three concrete resolutions computed from the actual conflicting data, plus a fourth for the genuine case where overcommitment is intended. It also adds a non-blocking warning before the wall is reached, and a periodic sweep for the rare case something bypassed the interactive check.

---

## Problem It Solves

A flat rejection tells a manager what they cannot do without telling them what to do instead. *This exceeds 100% capacity* is true and useless: the manager still has to work out by hand how much room remains, which existing assignment causes the overlap, and whether adjusting it is even the right call.

This feature does that arithmetic and presents the actual choices. It also recognizes that sometimes the right answer really is *yes, I know, let them do it for this one sprint* — a decision the constraint alone has no way to express, and whose absence pushes people into keeping the real schedule somewhere the product cannot see.

---

## User-Facing Flows

### Hitting the wall

A manager assigns someone at 40% who already holds 80% across overlapping assignments. The save returns [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s `ConflictError` — current 80, attempted 40, combined 120 — and a resolution panel opens with three computed choices:

1. **Reduce the new assignment.** 20% is suggested as a one-click default, being the exact remaining room, and is editable.
2. **Reduce the conflicting assignment.** The specific overlapping Assignment is named with its project and date range, percentage editable inline, where the manager has write access to it.
3. **End the conflicting assignment early.** Move its `end_date` up to remove the overlap window entirely, rather than adjusting percentages.

### The deliberate override

A fourth option, always visible and never the default: proceed above 100% with a required reason. This is for a real crunch week or a voluntary stretch, not a workaround for sloppy planning.

It is gated to the employee's own manager via `managed_by`, or to an Owner — deliberately narrower than the set of roles that can otherwise edit an Assignment. The reason is stored rather than typed and discarded, alongside who overrode and when.

### The soft warning

Below 100% but above `near_capacity_warning_threshold`, default 90, a save succeeds and a non-blocking Inline Alert surfaces: *This brings Priya to 95% capacity.* No action required, no reason collected. This is visibility, not a gate, and it never appears once past the constraint — that is the resolution panel's job.

### The safety-net sweep

The constraint is enforced at every interactive write, so overcommitment should be rare. But [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s bulk import, a direct API call through [[VPS-F009_Vulto_Sync_API|VPS-F009]], or migrated data could bypass it.

A sweep on the same four-hourly cadence [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] uses checks for any employee over 100% with no recorded override and surfaces them in an admin list. A safety net, not a first-class signal, so it introduces no new node type and queries Assignment data directly.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Resolution panel | Panel, opened from the assignment form | The three choices and the override |
| Near-capacity warning | Inline Alert within the assignment form | Visibility before the wall |
| Overcommitment list | Content | The sweep's output. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |

### Layout and components

**The resolution panel** opens beside the assignment form rather than over it, so the manager can still see what they were trying to save. Not a modal: this is a decision needing context, and a modal removes the context.

At the top, the arithmetic stated plainly in `mono`: current 80%, attempting 40%, combined **120%** with the excess in `attention`. Beneath it, three Cards, one per resolution, each showing the specific consequence rather than a generic label. *Reduce this assignment to 20%.* *Reduce Acme Rebrand from 60% to 20% for the overlapping fortnight.* *End Acme Rebrand on 14 March instead of 28 March.*

Each Card carries its own action button. There is no primary among them, because the right answer depends on facts the product does not have.

Beneath, separated by space rather than a rule, the override: a `secondary` **Assign anyway** revealing a required reason Textarea. Where the viewer is not the employee's manager or an Owner, the option does not render — it is not shown disabled, since a disabled control invites a request for permission that does not exist.

**A capacity strip** sits at the top of the panel: a horizontal bar showing the overlapping window, existing allocations as stacked segments in their project colors, the proposed addition in outline, and the 100% mark as a 1px `border-strong` tick. The excess extends past the tick in `attention`. It makes the shape of the problem visible in a way three numbers cannot.

**The overcommitment list** is a Table: employee, combined total, overlapping window, whether an override was recorded. Rows with no override render the total in `attention`.

### Keyboard

`1`, `2`, `3` select the corresponding resolution. `Escape` closes the panel and abandons the save. `Cmd+Enter` applies the focused resolution.

### System states

| State | Treatment |
|---|---|
| Syncing | The panel never renders mid-sync — it opens only in response to a completed local evaluation |
| Restricted | The override does not render for a viewer without authority |
| Empty | An empty overcommitment list reads *No one is overcommitted.* as good news, plainly stated |
| Error | Where a conflicting assignment cannot be edited by this user, that Card renders with the reason and names the person who can |

### Responsive

Below 1280px the panel overlays the form and the capacity strip stacks above the Cards.

---

## Technical Architecture

### The conflict computation

Given an employee and a proposed Assignment, the engine sums `billable_percentage` across every other Assignment whose date range overlaps — **exactly the aggregation [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s constraint already performs, reused rather than reimplemented.**

Overlap is measured in working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Two assignments that share only a weekend, or only a public holiday, do not overlap in any sense that matters, and treating them as conflicting would produce warnings a manager learns to dismiss.

The result compares against 100 for a hard conflict and against `near_capacity_warning_threshold` for a soft warning.

### API contracts

```
conflictCheck.evaluate(employeeId, proposed: {
  startDate, endDate, billablePercentage, excludeAssignmentId?
}) -> {
  currentTotal, combinedTotal,
  wouldConflict,          // combinedTotal > 100
  wouldWarn,              // above threshold, at or below 100
  suggestedFit,           // 100 − currentTotal
  overlapWorkingDays,
  overlappingAssignments: [{ assignmentId, projectName, billablePercentage,
                             startDate, endDate, callerCanEdit }]
}
  // Called before every Assignment create or edit. Read-only, no side effect

conflictResolution.adjustNew(proposed, newPercentage)          -> { assignmentId }
conflictResolution.adjustExisting(assignmentId, newPercentage) -> { success }
conflictResolution.endExisting(assignmentId, newEndDate)       -> { success }
  // Requires the new end date to actually remove the overlap

conflictResolution.overrideAndProceed(proposed, reason)        -> { assignmentId }
  // Caller must be the employee's manager per managed_by, or an Owner.
  // Writes capacity_override_reason, _by and _at alongside the Assignment

conflictResolution.sweepOvercommitted(workspaceId)
  -> { employeeId, combinedTotal, overlapWindow, hasRecordedOverride }[]
```

`callerCanEdit` on each overlapping assignment is what allows the panel to present an honest set of options. Offering to reduce an assignment the manager cannot touch, and failing on submit, is worse than not offering it.

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | The computation sums `billable_percentage` across overlapping Assignments, identical to [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s own constraint aggregation, not a second implementation |
| G02 | Overlap is measured in working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Assignments sharing only non-working days do not conflict |
| G03 | `wouldConflict` is true above 100. `wouldWarn` is true above the threshold and at or below 100. The two are mutually exclusive |
| G04 | `overrideAndProceed` is the only path writing an Assignment above 100% combined. Every other path either fits or is rejected, preserving [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s constraint as the default rather than an option among equals |
| G05 | Ghost Resources participate identically per [[VRS-F007_Ghost_Resources|VRS-F007]]. No special case exists or is needed |
| G06 | The sweep writes nothing. It is a read query surfaced to an admin view on the same cadence [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] uses |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F008-S01 | Conflict computation and error payload | Logic |
| VRS-F008-S02 | Resolution panel and capacity strip | UI |
| VRS-F008-S03 | Deliberate override with required justification | Logic |
| VRS-F008-S04 | Near-capacity soft warning | UI |
| VRS-F008-S05 | Overcommitment safety-net sweep | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an employee holds 80% across overlapping assignments
**WHEN** a manager attempts to add 40% over the same range
**THEN** the save is rejected per [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s error, and the resolution panel opens showing current 80, combined 120, and a suggested fit of 20%

---

**GIVEN** the panel is open with a named overlapping assignment the manager can edit
**WHEN** they reduce that existing assignment inline instead of the new one
**THEN** the existing assignment updates, the new one fits within 100%, and both save

---

**GIVEN** an overlapping assignment the manager has no write access to
**WHEN** the panel renders
**THEN** that resolution Card shows the reason and names the person who can change it, rather than offering an action that will fail

---

**GIVEN** a manager selects the override and provides a reason
**WHEN** it saves
**THEN** the assignment saves above 100%, the reason, actor and timestamp are all recorded, and no error is raised for this write

---

**GIVEN** a Team Member with edit access to their own assignment
**WHEN** the resolution panel opens
**THEN** the override option does not render at all, being gated to the employee's manager or an Owner

---

**GIVEN** two assignments that overlap only across a Friday and Saturday in a UAE entity
**WHEN** the conflict is evaluated
**THEN** no overlap is found, because [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] reports zero working days in common

---

**GIVEN** a combined total of 95% against a 90% threshold
**WHEN** the assignment is saved
**THEN** it saves with no resolution panel, and a non-blocking Inline Alert states the 95% figure

---

**GIVEN** an employee at 110% with no recorded override, reached through bulk import
**WHEN** the sweep runs
**THEN** they appear in the overcommitment list with their total, the overlapping window, and an indication that no override was recorded

---

## Non-Functional Requirements

- `conflictCheck.evaluate` returns within 100ms from the local graph, before any save is attempted
- The suggested fit is recomputed against current data at the moment the panel opens, never a stale figure from an earlier check
- The sweep covers all active employees within 2 minutes for workspaces up to 150 people, the same budget [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] holds
- Computation, panel and override all function fully offline. The sweep is best-effort and runs on next connectivity

---

## Security Considerations

- **The override gate is an application-layer check, not a new permission row.** Assignment's tier and write permissions are unchanged. This feature restricts which already-authorized users may invoke one additional action — the same pattern [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] uses for its three-Owner cap.
- **The override reason is mandatory and not private.** It is visible to anyone who could already see the Assignment. The point is accountability for a deliberate decision, not a hidden justification.
- **Overrides are audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]]. An employee working above full capacity for a sustained period is a fact that surfaces later in [[VRS-F052_Workload_Strain_Signal|VRS-F052]], and the record of who authorized it matters.

---

## Out of Scope

- **Automatic rebalancing across an employee's whole load** to optimize some global objective. This feature resolves one conflict at a time, at the moment it occurs, per the manager's judgement. It is not an optimization engine
- **Notifying the employee that they were overcommitted** — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]
- **Suggesting a replacement resource instead of overcommitting** — [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]
- **Leave-versus-assignment conflicts** — [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] reuses this computation but deliberately does not route through the blocking panel. An assignment overcommitting someone is usually a mistake worth catching before it saves; a leave request overlapping a commitment is a staffing decision for whoever manages the project, surfaced plainly at approval with a link into this panel, never blocking the approval itself

---

## Decisions Recorded

**Overlap is measured in working days**, not calendar days. Two assignments sharing only a weekend do not conflict, and under the previous calendar-day computation they did — producing false conflicts that are worst in precisely the markets this product targets, where a Thursday-ending and Sunday-starting assignment overlap across a Friday-Saturday weekend.

**The feature is renamed to Capacity Conflict Resolution.** The previous name collided with [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s sync conflict rules, and a naming note explaining the collision is a weaker fix than not colliding.

**`callerCanEdit` is added to the evaluation payload.** The previous panel offered to adjust a conflicting assignment without knowing whether the caller could, which produces an option that fails on submit — the specific failure this feature exists to prevent.

**The override does not render for unauthorized viewers**, rather than rendering disabled. A disabled control on a screen about capacity invites a request for permission that no workflow in this product grants.

---

## Related Notes

- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the constraint and error this feature resolves
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days overlap is measured in
- [[VRS-F007_Ghost_Resources|VRS-F007]] — Ghosts, subject to the same constraint
- [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] — leave conflicts, which reuse this computation without the blocking panel
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — sync conflict resolution, a different problem entirely

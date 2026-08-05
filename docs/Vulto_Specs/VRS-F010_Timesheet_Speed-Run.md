---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F010
---

# VRS-F010 — Timesheet Speed-Run

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee — `contracted_hours`, `billability_target_override`), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days and daily hours — the grid's columns and every shortcut resolve here), [[VRS-F005_The_Bench_Forecast|VRS-F005]] (Assignment edges populating the grid's rows), [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] (the classification fields incorporated into this schema), [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the Web Worker boundary), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (TimesheetEntry and TimesheetAnomalyFlag registry entries), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permissions)
**Blocks:** [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] (cannot compute a snapshot without entries), [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] (reads Pitch-categorized entries), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (payroll reads variable hours)

This document is the single source of truth for this feature and owns TimesheetEntry's complete schema.

---

## What It Is

The timesheet interface built to one explicit target: **an employee logs their entire working week in fifteen seconds or fewer.** Keyboard-first on desktop, no dropdowns in the critical path, submitted with `Cmd+Enter`. A swipeable single-day view serves mobile as a secondary path to the same data.

This feature owns TimesheetEntry entirely — the node, its schema and the entry interaction — incorporating [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]'s classification fields directly rather than layering them on, since an entry without a category is not a usable record.

Per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Cross-Suite Node Ownership, this is Roster's permanent bootstrap entry surface. [[Vulto Projects]] becomes an additional entry point once activated; the Speed-Run remains available regardless and is never withdrawn.

---

## Problem It Solves

Timesheet compliance is universally poor in agencies because filling them in is painful. Most tools require clicking through menus, selecting projects from long dropdowns, typing into individual cells, and saving repeatedly. Developers avoid it, managers chase it, data arrives late and incomplete.

Every financial and utilization feature in this product is only as trustworthy as the timesheet data beneath it, and that data is only reliable if entering it stops being a chore. **The fifteen-second target is not a performance boast; it is the mechanism by which the rest of the product becomes true.**

---

## User-Facing Flows

### The weekly grid

The current week renders as a grid: one column per **working day**, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and one row per project the employee is currently assigned to, derived from active Assignment edges, plus a standing Non-Billable row and a Pitch row where they are staffed on an active pitch. Rows are never manually configured; they follow actual assignments.

A six-day Pakistani week shows six columns. A four-day compressed schedule shows four. Non-working days do not appear at all, rather than appearing grayed — a column an employee can never type into is a column that should not be there.

Hours are typed directly. `Tab` moves right, `Shift+Tab` left, wrapping at row boundaries. Natural language is accepted in any cell:

| Input | Result |
|---|---|
| `8` | eight hours |
| `fd` | a full day — **that specific day's hours from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]** |
| `hd` | half of that day's hours |
| `8-1` | seven |
| `4+2` | six |

`fd` on a Friday in a workspace where Friday is a half day enters four hours, not eight. This is why the shortcut resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] rather than dividing contracted hours by five.

A running total row updates live beneath: hours per day, billable hours per day in a subtler weight, and a compliance line reading the employee's target — *Billable target 35h · Logged 28h · Remaining 7h*.

### Submission and lock

`Cmd+Enter` submits the whole week atomically. Every entry transitions Draft to Submitted in one batch, and the grid becomes read-only. A checkmark appears and fades within a second.

### The mobile day view

Below 768px, a single day is a vertical list of assigned-project cards with numeric inputs, a tappable day strip above showing only working days, and swipe to advance. A progress line reads *Logged today 6h · Target 8h*. **Submit week** appears once every working day has hours, or from the last working day regardless.

### Compliance and reminders

An HR Admin view lists every employee's submission status for the current week and the trailing four — Draft, Submitted or Not Started — with a reminder action for anyone outstanding and a count badge in navigation.

### Anomaly review

Separately from compliance, a manager occasionally sees a small badge against a direct report's name: a submitted week that tripped one of three checks. Opening it shows exactly which check fired and the data behind it — an assignment end date, the week's entries, the hours comparison — with no accusatory framing. The manager either clears it with an optional note, or corrects the entry on the employee's behalf.

Clearing takes one click for the overwhelming majority, which are honest mistakes and edge cases rather than misconduct.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Weekly grid | Content | The entry surface |
| Mobile day view | Full width, below 768px | The same data, one day at a time |
| Compliance | Content | HR Admin submission status |
| Anomaly review | Panel | Manager-facing, opened from a flag |

### Layout and components

**The grid** is a Table with a fixed left column of 200px holding the row label — project name and client at `small`, or the category chips for the non-billable row. Day columns are equal width, headed with the weekday abbreviation at `micro` uppercase and the date beneath at `small`. Today's column carries a 1px `brand-500` top border, the same marker the Bench Forecast uses.

Cells are 32px tall at compact density, right-aligned, `mono`. An empty cell shows nothing — not a zero, not a placeholder — because a grid pre-filled with zeros is a grid where nothing looks like something.

The running total row is `bg-subtle`, sticky at the bottom of the grid, with figures in `mono-lg`. The compliance line sits beneath it in `small`, turning `attention` when logged billable falls below target with two working days remaining.

**There is exactly one primary action: Submit week.** It is disabled until at least one cell holds a value, and its label changes to the count of hours being submitted once enabled — *Submit 38h* — so the person sees the number they are committing to.

**The mobile view** replaces the grid with Cards, one per row, each with a numeric input and a stepper. The day strip is a horizontally scrollable Toggle Group. Swipe advances; the transition uses `motion-base` per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]].

**Anomaly review** in the Panel shows the check that fired, the specific data, and two actions — **Clear** with an optional note, and **Correct entry** which opens the week in edit mode on the employee's behalf. It does not use the word *suspicious*, or any equivalent.

### Keyboard

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Next / previous cell, wrapping at rows |
| `↑ ↓ ← →` | Move between cells |
| `Cmd+Enter` | Submit week |
| `Cmd+D` | Fill the rest of the row from the cell above |
| `[` / `]` | Previous / next week |

This is the highest-frequency interaction in the product and its budget is the tightest in the set. **No dropdown appears anywhere in the critical path** — a dropdown is a mouse instrument wearing a keyboard costume.

### System states

| State | Treatment |
|---|---|
| Syncing | Grid renders immediately from local state; sync never gates entry |
| Submitted | Grid renders read-only with a `success` Badge and an **Unlock** action |
| Restricted | A manager viewing a report's week sees it read-only. A finance role sees it read-only. Nobody but the employee and an HR Admin writes |
| Empty | A week with no assignments still shows the Non-Billable row, so someone between projects can log their time rather than being told they have nothing to log |
| Error | The 24-hour cap states the day and the total attempted |

### Responsive

Below 1024px the grid drops to three visible day columns with horizontal scroll. Below 768px it becomes the mobile day view entirely.

---

## Technical Architecture

### The TimesheetEntry schema

```
entry_id:          UUID v4
workspace_id:      UUID
employee_id:       UUID, FK to Employee — a DIRECT field, never solely derivable
                   by traversing an Assignment: a Pitch entry has no Assignment
                   to traverse through at all
assignment_id:     UUID, nullable — required when Billable, null otherwise
pitch_id:          UUID, nullable — required when Pitch, null otherwise
time_category:     enum per VRS-F009
internal_category: enum per VRS-F009, required when NonBillable
date:              date
hours:             decimal, min 0, max 24
week_start_date:   date — the first working day of the week per VRS-F004
notes:             text, nullable
lifecycle_status:  enum: Draft, Submitted
submitted_at:      timestamp, nullable

— Universal Node Conventions per VPS-A002 —
```

`week_start_date` is the first working day of the employee's week rather than a hardcoded Monday. In a Sunday-to-Thursday workspace the week starts on Sunday, and a Monday-anchored key would split every week across two records.

### Validation

The sum of `hours` for one employee on one date must not exceed 24, enforced before the write reaches the local store with a `TimesheetValidationError`.

### Submission

`timesheet.submitWeek` is the only path from Draft to Submitted. It operates atomically across every entry for an `employee_id` and `week_start_date`: either all transition and the week locks, or none do.

Once Submitted, an entry is read-only in the interface behind an explicit unlock. It is not immutable at the permission layer — an employee retains write access to their own entries — but the interface gates re-editing so the lock remains a meaningful signal to HR and to payroll.

### Edges

`logged_against` targets Assignment for Billable entries and Pitch for Pitch entries. A NonBillable entry carries no such edge; its category is sufficient context.

### TimesheetAnomalyFlag

```
flag_id:          UUID v4
workspace_id:     UUID
employee_id:      UUID
week_start_date:  date
flag_reason:      enum: PostEndDateAssignment, ZeroVarianceWeek, HoursExceedExpected
detail:           text — the specific data that tripped the rule
lifecycle_status: enum: Active
cleared_at:       timestamp, nullable
cleared_by:       user_id, nullable
clearance_outcome: enum: Corrected, AcceptedAsNormal, ApprovedOvertime —
                  nullable until cleared, required at clearance. Added by
                  VRS-F018: ApprovedOvertime is what accrues TOIL and exempts
                  the week from re-flagging
clearance_note:   text, nullable

— Universal Node Conventions per VPS-A002 —
```

At most one Active uncleared flag per employee, week and reason. A repeat trigger updates `detail` rather than duplicating.

### Detection rules

Evaluated once, reactively, immediately after a successful submission, against that week only, never against Draft entries, and never blocking the submission.

**PostEndDateAssignment** — any Billable entry dated after its Assignment's `end_date`.

**ZeroVarianceWeek** — the week spans two or more rows and every entry's hours are identical across every row and day. A single-row week is not evaluated; uniform hours against one assignment are unremarkable.

**HoursExceedExpected** — the week's Billable plus NonBillable hours exceed the employee's **expected working hours for that week, from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]**, multiplied by `overtime_flag_threshold` (default 1.3), and the week contains no Pitch entries.

The third rule previously multiplied `contracted_hours` by the threshold, which is wrong for anyone on a working pattern, wrong in a week containing a public holiday, and wrong during a reduced-hours period. A person working their normal four-day pattern would have been flagged for overtime they did not work.

**Approved overtime is exempt from this rule**, per [[VRS-F018_Leave_Policy_Engine|VRS-F018]]. A week whose flag was cleared with an outcome of ApprovedOvertime is never re-flagged, because the hours were reviewed and authorized by the same manager this rule would notify again.

### API contracts

```
timesheet.getWeek(employeeId, weekStartDate?) -> {
  columns: { date, expectedHours }[],   // working days only, per VRS-F004
  rows: { assignmentId | 'non-billable' | 'pitch', label, entries }[],
  weekStatus: 'Draft' | 'Submitted',
  expectedWeeklyHours: number
}
timesheet.saveCell(employeeId, date, rowContext, hours, category?) -> { entryId }
timesheet.submitWeek(employeeId, weekStartDate)  -> { success, entriesLocked }
timesheet.unlockWeek(employeeId, weekStartDate)  -> { success }

hrCompliance.listSubmissionStatus(workspaceId, weekStartDate) -> { employeeId, weekStatus }[]
hrCompliance.sendReminder(employeeIds)           -> { success }

timesheetAnomaly.evaluate(employeeId, weekStartDate) -> { flagIds }
timesheetAnomaly.listActive(workspaceId)            -> TimesheetAnomalyFlag[]
timesheetAnomaly.clear(flagId, outcome, note?)      -> { toilDaysAccrued? }
  // outcome is required. ApprovedOvertime calls VRS-F018's overtime.approve,
  // which returns the TOIL accrued and exempts the week from re-flagging
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Each non-zero cell creates or updates exactly one TimesheetEntry on blur, written locally before any network round-trip |
| G02 | Grid columns are the employee's working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Non-working days are not rendered |
| G03 | Rows are populated from active Assignment edges plus a standing Non-Billable row and, where applicable, a Pitch row. Rows are never manually configured |
| G04 | `employee_id` is stored directly on every entry, never solely derivable through `logged_against` |
| G05 | `week_start_date` is the first working day of the employee's week per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], not a hardcoded Monday |
| G06 | `fd` and `hd` resolve against that specific day's hours from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], never against `contracted_hours` divided by a weekday count |
| G07 | `timesheet.submitWeek` is atomic across the week. A partial submission must never occur |
| G08 | Conflict resolution is last-write-wins by `updated_at`. Entries are single-owner records |
| G09 | A flag is created when a rule fires against a newly submitted week. At most one Active uncleared flag per employee, week and reason |
| G09b | Clearance requires a `clearance_outcome`. An outcome of ApprovedOvertime calls [[VRS-F018_Leave_Policy_Engine|VRS-F018]]'s overtime approval, accruing TOIL and exempting that week from `HoursExceedExpected` on any future evaluation |
| G10 | Flagging never blocks or delays [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s computation or [[VRS-F012_Revenue_Gap_Alert|VRS-F012]]'s evaluation. It is parallel and advisory, never a gate |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F010-S01 | TimesheetEntry schema and local storage | Data |
| VRS-F010-S02 | Keyboard-driven weekly grid | UI |
| VRS-F010-S03 | Mobile day view | UI |
| VRS-F010-S04 | Weekly submission and lock | Logic |
| VRS-F010-S05 | Compliance report and reminders | UI |
| VRS-F010-S06 | Anomaly detection and manager review | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an employee assigned to two projects
**WHEN** the timesheet opens
**THEN** two project rows plus the Non-Billable row populate from the local graph within 100ms, with no search or add interface for their active assignments

---

**GIVEN** a workspace whose Saturday is a four-hour half day
**WHEN** an employee types `fd` in the Saturday cell
**THEN** the cell shows 4, not 8, resolved from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]

---

**GIVEN** a Sunday-to-Thursday workspace
**WHEN** the grid renders
**THEN** five columns appear beginning Sunday, `week_start_date` is that Sunday, and no Friday or Saturday column is shown

---

**GIVEN** an employee attempts 25 hours across entries for one date
**WHEN** the save is attempted
**THEN** a `TimesheetValidationError` is returned, nothing is saved, and the message names the day and the total

---

**GIVEN** a filled week and `Cmd+Enter`
**WHEN** submission processes
**THEN** every Draft entry transitions atomically, the grid locks, and a checkmark appears and fades within 1 second

---

**GIVEN** the device is offline
**WHEN** a week is submitted
**THEN** entries are written and locked locally, `PendingChanges` shows, and everything syncs on reconnection with no loss

---

**GIVEN** an employee on a four-day pattern logs 34 hours in a week with expected hours of 32 and a threshold of 1.3
**WHEN** the week is submitted
**THEN** no flag is raised, because 34 does not exceed 32 × 1.3 — and under the previous rule, which used `contracted_hours`, they would have been flagged for overtime they did not work

---

**GIVEN** a submitted week with a Billable entry dated after its Assignment's end date
**WHEN** it is submitted
**THEN** the week locks normally, [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] and [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] read the data unaffected, and a `PostEndDateAssignment` flag is created, visible only to the employee's manager and HR Admin

---

**GIVEN** a manager clears a flag with a note
**WHEN** it is cleared
**THEN** `cleared_at` and `cleared_by` are recorded, the flag leaves the active list, and no already-computed figure changes

---

## Non-Functional Requirements

- Grid renders within 100ms from the local graph for up to 10 active assignments
- Shortcut resolution completes within one frame — no perceptible delay between keystroke and cell update
- A saved cell is queryable by [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] within 2 seconds
- Full grid, entry and submission function entirely offline
- The 24-hour cap is enforced before any write reaches the local store
- The whole mobile weekly flow completes in under 30 seconds for a typical three-assignment employee
- Anomaly evaluation runs within 2 seconds of submission and never delays the submission response

---

## Security Considerations

- **TimesheetEntry's permissions are fully specified in [[VPS-A004_Graph_Permission_Layer|VPS-A004]]** and are not restated or re-decided here.
- **Pitch selection exposes Tier 0 fields only**, through [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]'s `pitch.listStaffedFor`. Commercial fields are unreachable through this path, not merely omitted from it.
- **A submitted entry is not immutable at the permission layer** — an employee retains access to their own entries — but the interface gates re-editing behind an explicit unlock, so the lock remains meaningful to HR and payroll.
- **TimesheetAnomalyFlag is Manager-restricted, Tier 2.** The flagged employee does not see their own flags, matching BurnoutAlert's precedent: the subject of a system-generated signal is not automatically its audience, and visibility would let someone learn the detection thresholds by observation.
- **These three rules are heuristics, not evidence.** They catch honest mistakes and unusual patterns worth a second look. The review surface shows only the underlying data and never a label like *suspicious*. `ZeroVarianceWeek` will produce false positives for people with genuinely consistent schedules across concurrent projects, and this is stated rather than oversold.

---

## Out of Scope

- Utilization computation of any kind — [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]
- Bulk historical reclassification — correction of an individual entry by its owner is supported; bulk tooling is not
- A blanket manager approval gate on every submitted week — deliberately rejected, see below
- Fraud investigation or disciplinary workflow downstream of a flag — [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] where a firm needs it
- Formal overtime approval and TOIL accrual — [[VRS-F018_Leave_Policy_Engine|VRS-F018]]. This feature owns the flag and its clearance outcome; that feature owns what an ApprovedOvertime outcome means
- Payroll consumption of this data — [[VRS-F062_Payroll_Engine_Core|VRS-F062]]

---

## Decisions Recorded

**Grid columns and shortcuts resolve through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** Previously `fd` computed `contracted_hours / 5` and the grid rendered seven columns. Both are wrong for a six-day week, a compressed schedule, a part-time pattern, a public holiday and a reduced-hours period — which between them cover a substantial share of this product's target market. `HoursExceedExpected` is renamed from `HoursExceedContracted` for the same reason.

**`week_start_date` is the first working day, not Monday.** In a Sunday-to-Thursday workspace a Monday-anchored key splits every week across two records, which would have surfaced as inexplicably halved utilization figures.

**The approval-workflow question stays resolved as exception-based flagging.** A full manager gate on every week is more accurate on paper and directly contradicts commitments already made: [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s pulse updates within two seconds of a write, and a gate holding data until a manager reviews it — plausibly days, for a manager with fifteen reports — breaks that outright. It also works against the fifteen-second ethos, with the friction landing on the manager, weekly, times headcount, indefinitely. Exception-based flagging spends review effort only where the graph already contains a reason for suspicion, which is the same shape as three signals this architecture already trusts.

**`clearance_outcome` is added to TimesheetAnomalyFlag**, per [[VRS-F018_Leave_Policy_Engine|VRS-F018]]. Overtime approval and leave are the same shape of decision — a manager confirming a departure from the normal working pattern is authorized — and reusing the clearance a manager already performs avoided a second approval queue, a second request workflow and a second balance mechanism for the inverse of leave.

**The submit button states the hours being submitted.** A person committing to a week's record should see the number rather than a generic verb.

---

## Related Notes

- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days and daily hours this feature resolves against
- [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] — the classification incorporated into this schema
- [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] — the utilization computed from these entries
- [[VRS-F018_Leave_Policy_Engine|VRS-F018]] — overtime approval, which will exempt approved hours from flagging

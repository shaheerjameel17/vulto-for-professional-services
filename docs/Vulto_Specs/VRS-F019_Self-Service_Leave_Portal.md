---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Experience
aliases:
  - VRS-F019
---

# VRS-F019 — Self-Service Leave Portal

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — every requested day counts through it), [[VRS-F018_Leave_Policy_Engine|VRS-F018]] (the policy, accrual rules and leave types this feature reads), [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] (the overlap computation reused for assignment conflicts), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (the Inbox approvals arrive in), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (LeaveRequest), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the self-service permission pattern)
**Blocks:** [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s expected-hours reduction depends on approved leave existing.

This document is the single source of truth for this feature.

---

## What It Is

A self-service portal where an employee requests leave, sees their live balance per type, and tracks past requests — without emailing HR for anything routine.

A manager approves or rejects from the same surface, with every policy warning, balance shortfall, notice violation, blackout conflict and overlapping assignment shown plainly rather than discovered afterwards.

---

## Problem It Solves

Leave management without this has two familiar failure modes.

**Administratively:** an employee emails HR, HR updates a spreadsheet by hand, and whoever actually needs to know — the project's manager — finds out informally or not at all.

**Operationally:** leave is approved without anyone checking it against a staffing commitment, and a deliverable slips because two decisions that should have been visible to each other were made in two different places.

---

## User-Facing Flows

### Viewing balance

The employee's own portal shows their balance per leave type — entitled, carried over, used, remaining, and expiring soon — computed live per [[VRS-F018_Leave_Policy_Engine|VRS-F018]], never a stale cached figure.

### Submitting

The employee selects a type, a date range with half-day start and end options, and an optional reason. Before submitting they see their resulting balance, a **Team Away** overlay showing teammates already approved for overlapping dates, and any policy warnings.

**None of these block submission.** They inform, they do not stop. A product that refuses a leave request because the balance is short is a product that has decided it knows more about an employee's circumstances than their manager does, and it is wrong often enough that the refusal is the greater harm.

### Manager approval

The manager sees the request with every warning collected at submission, plus any Assignment overlapping the dates, named specifically, with a direct link into [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s resolution panel if they choose to act on it.

Approving requires no step beyond the action. **Rejecting requires a reason.**

Requests arrive in the manager's Inbox per [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] and are approvable in place.

### Canceling

A Pending request can be canceled at any time. A future-dated Approved request can also be canceled, restoring the balance it reserved. A request already in progress or completed cannot be retroactively canceled.

### History

Past requests of any status remain visible indefinitely, each showing its outcome and, for a rejection, the reason given.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| My leave | Content + Panel | Balance, request, history |
| Request leave | Panel | The submission form |
| Team calendar | Content | Who is away, when |
| Approvals | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox | Manager decisions in place |

### Layout and components

**My leave** leads with a row of Stats, one per leave type: remaining in `display`, and entitled, carried over and used beneath in `small`. A type with an expiring balance shows the expiry date in `attention` — the single most useful thing this screen can tell someone, and the one most often discovered too late.

Beneath, a Table of request history: dates, type, days, status Badge, decided by.

**Request leave** in the Panel: a Select for type, a DatePicker range respecting the working calendar per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], half-day Switches for start and end, and a reason Textarea.

As dates are chosen, three things update live beneath the form: the working days consumed in `numeric`, the resulting balance, and any warnings as Inline Alerts. Warnings render `attention`, never `danger` — nothing here has failed.

The **Team Away** overlay renders inside the DatePicker itself: dates where a teammate is already approved carry a small avatar stack. Seeing that three colleagues are already off the week you were about to request is the kind of thing people would rather know before submitting than after being asked to reconsider.

**Team calendar** is a month grid, people as rows, approved leave as bars in `cat-n` by leave type, pending as dashed per [[VPS-D001_Design_Foundations|VPS-D001]]'s rule. It reuses the Timeline component from [[VPS-D002_Component_Library|VPS-D002]] rather than introducing a second calendar surface.

### Keyboard

`J`/`K` through history. `N` opens a new request. `[` and `]` move months on the team calendar.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton stats. Balance never renders a stale figure — it renders nothing until computed |
| Restricted | An employee sees their own balance and their team's calendar. A manager sees their reports' requests. No role sees another person's reason text unless they are approving it |
| Empty | *No leave requested yet.* with **Request leave** |
| Warning | Inline Alerts in `attention`, stacked, each stating the fact and not a prohibition |
| Error | A rejection without a reason is refused, naming the requirement |

### Responsive

The team calendar collapses to a per-day list below 1024px. My leave stacks; the stats row becomes a two-column grid.

---

## Technical Architecture

### The LeaveRequest schema

```
request_id:            UUID v4
workspace_id:          UUID
employee_id:           UUID, FK to Employee — a direct field, not solely reachable
                       through the requested_by edge
leave_type:            enum, must match a type in the employee's applicable policy
start_date / end_date: date
is_half_day_start:     boolean, default false
is_half_day_end:       boolean, default false
total_days_requested:  decimal — computed in WORKING days per VRS-F004,
                       adjusted 0.5 for each half-day flag
status:                enum: Pending, Approved, Rejected, Canceled
reason:                text, nullable
reviewed_by:           user_id, nullable
reviewed_at:           timestamp, nullable
decline_reason:        text, nullable, required when Rejected

— Universal Node Conventions per VPS-A002 —
```

### Policy validation — every check a warning, none blocking

At submission, the request is checked against the applicable policy: sufficient balance, minimum notice met, no blackout conflict for that type. Every failure is collected and shown to the employee at submission and to the manager at approval.

**None prevents submission.** The manager holds the context the software does not: a bereavement that exceeds a balance, a family emergency inside a blackout, a notice period nobody could have met. Encoding those as refusals would push the exceptions back into email, which is where this feature found them.

### The assignment-conflict check

`leaveRequest.checkAssignmentConflicts` reads Assignments overlapping the requested dates using **[[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s overlap computation** — the same one, reused, measured in working days.

Any overlapping Assignment is surfaced to the approving manager by name and range, with a link into [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s resolution panel. The check runs at submission and again at approval, since an assignment can change in between.

**It does not route through the blocking resolution panel, and approving is never gated on resolving it.** An assignment overcommitting someone is usually an honest scheduling mistake worth catching before it saves, which is what that panel is for. A leave request overlapping a commitment is a different situation: the leave is rarely the thing that should change, the assignment usually is, and that is a staffing decision for whoever manages the project rather than something to force into the modal a capacity typo gets.

### Effect on utilization

**Approved leave reduces expected hours in [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]].** A person on holiday for a week has zero available hours that week, and computing their utilization against a full week would show a collapse that is entirely an artifact of the denominator.

This closes the limitation [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] names for the period before this feature exists.

### API contracts

```
leaveRequest.submit(employeeId, leaveType, startDate, endDate,
                    isHalfDayStart?, isHalfDayEnd?, reason?) -> {
  requestId,
  workingDaysRequested,
  warnings: {
    insufficientBalance?: { remaining, requested },
    noticeViolation?:     { requiredDays, actualDays },
    blackoutConflict?:    { periodReason },
    teammatesOnLeave?:    { employeeId, dateRange }[]
  }
}

leaveRequest.checkAssignmentConflicts(requestId) -> {
  conflictingAssignments: { assignmentId, projectName, startDate, endDate,
                            overlapWorkingDays }[]
}

leaveRequest.approve(requestId)                 -> { success }
leaveRequest.reject(requestId, declineReason)   -> { success }
leaveRequest.cancel(requestId)                  -> { success }
leaveRequest.listForEmployee(employeeId)        -> LeaveRequest[]
leaveRequest.listPendingForManager(managerId)   -> LeaveRequest[]
teamCalendar.get(workspaceId, month, scope?)    -> { employeeId, dates, leaveType, status }[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | LeaveRequest carries the schema above. `requested_by` and `approved_by` connect it to the requesting employee and approving manager |
| G02 | `total_days_requested` counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], adjusted 0.5 per half-day flag. No calendar-day or weekend assumption is made here |
| G03 | Policy validation never blocks submission or approval. Every failed check is recorded as a warning visible to both parties |
| G04 | The assignment-conflict check reuses [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s overlap computation. It never routes through that feature's blocking panel automatically |
| G05 | Canceling a future-dated Approved request restores the balance those days reserved |
| G06 | Approved leave reduces the employee's expected hours in [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] for the affected period |
| G07 | A rejection without a decline reason is refused at write time |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F019-S01 | LeaveRequest schema and submission | Data |
| VRS-F019-S02 | Balance display and live computation | UI |
| VRS-F019-S03 | Non-blocking policy warnings | Logic |
| VRS-F019-S04 | Team Away overlay and team calendar | UI |
| VRS-F019-S05 | Manager approval flow | UI |
| VRS-F019-S06 | Assignment-conflict surfacing | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an employee has 3 days remaining and requests 5
**WHEN** the request is submitted
**THEN** it is created Pending with an insufficient-balance warning, and submission is not blocked

---

**GIVEN** a request spanning a Friday and Saturday in a UAE entity
**WHEN** working days are computed
**THEN** those two days are excluded per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and the deduction reflects only working days

---

**GIVEN** a request inside a configured blackout for that type
**WHEN** it is submitted
**THEN** a blackout warning is recorded and shown to the approving manager, and submission still succeeds

---

**GIVEN** a teammate already has approved leave overlapping the dates
**WHEN** the employee selects those dates
**THEN** the Team Away overlay shows it inside the date picker before submission, not after

---

**GIVEN** the requesting employee holds an Assignment overlapping the dates
**WHEN** the manager reviews the request
**THEN** the assignment is named explicitly with a link into [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s panel, and approval proceeds independently of whether the assignment is ever adjusted

---

**GIVEN** a manager rejects without a reason
**WHEN** the rejection is submitted
**THEN** it is refused until a reason is provided

---

**GIVEN** an employee cancels a future-dated approved request
**WHEN** cancellation is confirmed
**THEN** status becomes Canceled and the balance those days reserved is restored immediately

---

**GIVEN** an employee has five days of approved leave in a week
**WHEN** [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] computes their utilization for that week
**THEN** expected hours are reduced accordingly, and their utilization rate is not depressed by a week they were not available

---

**GIVEN** a leave request appears in a manager's Inbox
**WHEN** they approve it inline
**THEN** it completes without navigation and is recorded exactly as though approved from this feature's own screen

---

## Non-Functional Requirements

- Balance display and warning checks return within 200ms from the local graph
- Submission, cancellation and balance viewing function fully offline
- A manager's pending list updates within 1 second of a new submission
- The team calendar renders within 300ms for a month across 150 people

---

## Security Considerations

- **Team Member access is Full on their own requests**, per the self-service pattern in [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — an employee submitting and canceling their own leave is the entire point.
- **A manager sees warnings and conflicts for their own reports only**, per existing scoping. Nothing here widens manager visibility.
- **The reason field is more sensitive than the request.** A leave reason frequently discloses a medical condition, a bereavement or a family circumstance. It is visible to the employee, the approving manager and HR Admin, and to nobody else — notably not on the team calendar, which shows dates and type and never a reason.
- **The team calendar shows leave type**, which for Sick or Parental leave is itself an inference about a person. This is accepted deliberately: a team cannot plan around absence it cannot see, and the alternative — showing all absence as undifferentiated — makes the calendar useless for the coverage decisions it exists to support. A workspace wanting stricter treatment configures a policy where sensitive types are recorded as Other.

---

## Out of Scope

- **Leave encashment** — [[VRS-F018_Leave_Policy_Engine|VRS-F018]] tracks which types are encashable; [[VRS-F062_Payroll_Engine_Core|VRS-F062]] pays it out
- **A hard block on any policy violation** — deliberately rejected as the default
- **Automatic assignment adjustment when leave is approved** — surfaced, never automated. A manager decides what, if anything, changes
- **Overtime requests** — [[VRS-F018_Leave_Policy_Engine|VRS-F018]], approved through [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s flag clearance
- **Delegated approval when a manager is themselves away** — a genuine gap at MVP, and an approval queue that stalls for a fortnight is a real operational problem. Owner and HR Admin can approve any request as a fallback; a formal delegation model belongs to [[VRS-F049_Manager_Dashboard|VRS-F049]]

---

## Decisions Recorded

**This feature is built after [[VRS-F018_Leave_Policy_Engine|VRS-F018]]**, correcting an ordering in which the portal preceded the policy engine it depends on entirely. The previous documents both carried notes explaining that the numbering was not a build instruction; the numbering is now correct and the notes are unnecessary.

**Every day count resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** The previous specification excluded weekends and a workspace holiday list directly, which gives a Gulf employee more leave than their contract grants and a six-day-week employee less — in the one figure an employee checks most often.

**Approved leave reduces expected hours in [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]**, closing the limitation that document names for the period before this feature exists.

**Delegated approval is named as a gap rather than omitted.** A manager on holiday for a fortnight leaves their team's requests unactioned, and the Owner-and-HR-Admin fallback is a workaround rather than a solution. It is stated so that nobody discovers it in month two.

**The team calendar's disclosure of leave type is decided explicitly rather than assumed.** It is a real inference about a person, accepted because coverage planning requires it, with a configuration path for workspaces that want otherwise.

---

## Related Notes

- [[VRS-F018_Leave_Policy_Engine|VRS-F018]] — the policy this portal reads
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days every request counts
- [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] — the overlap computation reused here
- [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] — utilization, whose denominator approved leave reduces
- [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] — the Inbox approvals arrive in

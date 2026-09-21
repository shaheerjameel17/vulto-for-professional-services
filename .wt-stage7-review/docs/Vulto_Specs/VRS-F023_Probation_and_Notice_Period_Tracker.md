---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F023
---

# VRS-F023 — Probation and Notice Period Tracker

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee's probation fields, and the offboarding flow this feature completes a Departure from), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — a last working date must land on one), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (the Inbox transitions surface in), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Departure's registry entry), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (Departure's HR-restricted default, sufficient without override)
**Blocks:** Nothing structurally, though [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] builds a richer contextual layer on the date trigger this feature establishes.

This document is the single source of truth for this feature.

---

## Two transitions, one feature

This covers two genuinely different HR moments that share nothing except both being *a date after which something must happen*: a new hire's probation ending, and a departing employee's notice counting down to their last day.

They are combined because at this scope both are the same mechanism — a tracked date and a surfaced reminder — not because they are conceptually the same thing. Anyone extending either should be clear which they are extending.

**The boundary with [[VRS-F057_Probation_Review_Intelligence|VRS-F057]]:** that feature surfaces context automatically when a probation review comes due — performance history, manager notes, the reasoning layer. This feature establishes the tracked fact it will have something to react to.

---

## What It Is

Two related mechanisms. **Probation status** on the employee record, decided at the point a probation period ends. **A Departure record**, created the moment notice is given, counting down to a last working date.

Both surface on a single upcoming-transitions view, so nothing slips past unnoticed.

---

## Problem It Solves

A probation period that quietly lapses without anyone confirming the hire leaves the agency ambiguous — is this person confirmed or not — with no record of a decision ever having been made. In several jurisdictions that ambiguity resolves against the employer by default, which makes it a legal exposure rather than an administrative untidiness.

A notice period tracked only in memory or a side conversation risks a last working date arriving with no handoff plan, no access revocation scheduled and no asset return arranged.

Different in cause and consequence; identical in failure mode. **A real deadline with nobody accountable for noticing it approach.**

---

## User-Facing Flows

### Probation nearing its end

An HR Admin sees every employee whose probation ends within `transition_warning_days`, default 14. They record a decision: **Confirmed**, **Extended** with a new date and a reason, or **Terminated**, which routes to [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]'s offboarding flow.

The review also reaches the employee's manager through [[VPS-F003_Notification_and_Alert_Center|VPS-F003]], since the decision is usually theirs to inform.

### Notice given

An HR Admin creates a Departure the moment notice is given — resignation or termination — recording the type, the date notice was given, and the notice period, which computes a last working date.

### Notice rescinded

A withdrawn resignation or reversed termination marks the Departure **Rescinded** rather than deleting it, preserving the fact that it happened without leaving an Active record for someone who is staying.

### The last day

Completing offboarding through [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] automatically marks the matching Active Departure Completed. **This feature does not duplicate that action; it tracks the countdown to it.**

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Upcoming transitions | Content + Panel | Both kinds, one list |
| Probation decision | Panel | Record the outcome |
| Create departure | Modal | Short, consequential |

### Layout and components

**Upcoming transitions** is two Sections rather than one merged table, because the two carry entirely different weight and blending them makes the sensitive one easier to skim past.

*Probation reviews* is a Table: employee, role, start date, probation ends, days remaining. Rows within seven days render `days remaining` in `attention`.

*Notice periods* is a Table: employee, departure type Badge, notice given, last working day, days remaining. **This Section does not render at all for a Manager**, per Departure's HR-restricted class — not empty, not headed with nothing beneath it, absent.

**The probation decision Panel** shows the employee, their manager, their start date, and three actions as separate Cards rather than a Select: **Confirm**, **Extend**, **Terminate**. Extend reveals a DatePicker and a required reason. Terminate carries a Modal confirmation and hands off to [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — it does not complete here, because ending someone's employment should not be reachable in one click from a list.

**Create departure** collects type, notice date and notice period in days, showing the computed last working day live in `numeric` as the period is typed. Where that date falls on a non-working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], the field shows the adjusted date and states why.

### Keyboard

Standard list bindings. No shortcut for any destructive action.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | The notice section is absent for Managers. A Team Member sees only their own departure record |
| Empty | *No transitions in the next 14 days.* Stated as the good news it is |
| Error | A second Active departure for one employee is refused, naming the existing one |

### Responsive

Drops `role` and `notice given` below 1280px. `Days remaining` is never dropped.

---

## Technical Architecture

### The Departure schema

HR-restricted, Tier 2.

```
departure_id:       UUID v4
workspace_id:       UUID
employee_id:        UUID, FK to Employee — a direct field, not solely reachable
                    through the departing edge
departure_type:     enum: Resignation, Termination, EndOfContract,
                    Retirement, Other
notice_given_date:  date, required
notice_period_days: integer, required — calendar days, as contracts express them
last_working_date:  date — computed from notice_given_date plus notice_period_days,
                    then adjusted forward to the next working day per VRS-F004
                    if it lands on a non-working one. Editable if the agreed
                    date genuinely differs
status:             enum: NoticeActive, Completed, Rescinded
reason:             text, nullable

— Universal Node Conventions per VPS-A002 —
```

**Notice periods are counted in calendar days** because that is how contracts express them — *thirty days' notice* means thirty days, not thirty working days. But a last working date that falls on a weekend or a public holiday is not a last working date, so the computed result snaps forward to the next working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Both halves of that are deliberate, and mixing them up in either direction produces a wrong final settlement.

### Probation fields on Employee

`probation_status` — Pending, Confirmed, Extended, Terminated, nullable where no probation applies — and `probation_extension_reason`, set whenever the end date is pushed back.

Both live on Employee per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], since probation is a fact about one employee's one hiring event rather than a repeating record the way a Departure is.

### The upcoming-transitions view

A single read query, not a stored alert node — the same pattern [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s overcommitment sweep uses. Probation entries where the end date falls within the window and status is still Pending; Departure entries where status is NoticeActive and the last working date falls within the same window.

### API contracts

```
probation.recordDecision(employeeId, decision, newProbationEndDate?, reason?)
  -> { success }
  // Extended requires both a new date and a reason.
  // Terminated routes to VRS-F002's offboarding, not duplicated here

departure.create(employeeId, departureType, noticeGivenDate, noticePeriodDays,
                 reason?) -> { departureId, lastWorkingDate, wasAdjusted }
  // wasAdjusted is true where the computed date snapped to a working day

departure.rescind(departureId)  -> { success }
departure.complete(departureId) -> { success }
  // Called by VRS-F002's offboarding when a matching Active Departure exists.
  // Not a standalone user-facing action

upcomingTransitions.list(workspaceId, windowDays?) -> {
  probationReviews:        { employeeId, employeeName, probationEndDate }[],
  noticePeriodCompletions: { employeeId, employeeName, lastWorkingDate,
                             departureType }[]
}
  // noticePeriodCompletions is returned to Owner and HR Admin only.
  // A Manager-scoped call always receives an empty array for that field,
  // regardless of what Departure data exists
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Departure carries the schema above. `departing` connects it to Employee |
| G02 | At most one NoticeActive Departure per employee. Creating a second while one is Active is rejected |
| G03 | `last_working_date` is computed at creation and snapped forward to a working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. It is editable thereafter and never silently recomputed from a later edit to `notice_period_days` alone |
| G04 | `departure.complete` is called by [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]'s offboarding. This feature does not independently detect that offboarding occurred |
| G05 | The upcoming-transitions view is a read query introducing no node type beyond Departure |
| G06 | `noticePeriodCompletions` is returned to Owner and HR Admin only. A Manager-scoped call receives an empty array |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F023-S01 | Departure schema and notice computation | Data |
| VRS-F023-S02 | Probation decision recording | Logic |
| VRS-F023-S03 | Upcoming transitions view | UI |
| VRS-F023-S04 | Offboarding integration | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an employee's probation ends within the warning window
**WHEN** the transitions view opens
**THEN** they appear under probation reviews, and recording Confirmed sets the status with no further action

---

**GIVEN** a probation decision of Extended without a new date or reason
**WHEN** it is submitted
**THEN** it is refused until both are provided

---

**GIVEN** notice is given with a 30-day period and the computed date lands on a Friday in a UAE entity where Friday is a weekend
**WHEN** the Departure is created
**THEN** `last_working_date` snaps forward to the next working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], `wasAdjusted` is true, and the interface states why

---

**GIVEN** an Active departure already exists for an employee
**WHEN** a second is attempted
**THEN** it is rejected, naming the existing one

---

**GIVEN** a resignation is withdrawn
**WHEN** the Departure is rescinded
**THEN** status becomes Rescinded, the employee's employment status is untouched, and the record is preserved rather than deleted

---

**GIVEN** an HR Admin completes offboarding for an employee with an Active Departure
**WHEN** offboarding executes
**THEN** the Departure becomes Completed automatically, with no separate action

---

**GIVEN** a Manager calls the transitions view
**WHEN** results return
**THEN** `noticePeriodCompletions` is empty regardless of what departures exist among their reports

---

## Non-Functional Requirements

- The transitions view resolves within 200ms from the local graph
- Full functionality offline: recording decisions, creating and rescinding departures

---

## Security Considerations

- **Departure's HR-restricted default deliberately keeps Manager at None, not Read.** A pending termination in particular must not be visible to a direct manager before HR is ready to communicate it. This is the correct default rather than an oversight, and manager awareness of an impending departure happens through the normal HR conversation, not automatic system exposure.
- **Team Member retains Read on their own record**, since someone who resigned should be able to see their own notice countdown.
- **The absence of the notice section for a Manager is structural.** It does not render, rather than rendering empty — an empty section headed *Notice periods* tells a manager that departures exist and they cannot see them, which is the inference the restriction exists to prevent.
- **Probation decisions are audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]]. Whether a probation was confirmed, extended or allowed to lapse is exactly the fact that becomes contested later.

---

## Out of Scope

- **The contextual intelligence [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] adds** — this feature establishes the tracked date and status, not the reasoning layer
- **Automatic notice-period extraction from a contract's own clause.** [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s generated contracts state a notice period in text; this feature does not parse it. `notice_period_days` is entered directly
- **Exit interviews or offboarding checklists beyond what [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] does** — a Departure tracks the countdown and the reason; a fuller exit process is distinct
- **Final settlement calculation** — [[VRS-F062_Payroll_Engine_Core|VRS-F062]]. This feature supplies the last working date it is computed against

---

## Decisions Recorded

**This feature moves from Post-MVP to MVP.** A firm cannot run HR without offboarding, and departure drives final settlement, access revocation, asset return and bench recalculation — four things that all go wrong quietly if the date is not tracked.

**`last_working_date` snaps to a working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** The previous specification computed calendar days and stopped, which produces a last working date on a Saturday in the UK or a Friday in the UAE — a date on which the person cannot actually work, and against which a final settlement would be prorated incorrectly. The calendar-day count for the notice period itself is retained, because that is how contracts express it.

**`wasAdjusted` is surfaced to the user.** An HR Admin entering thirty days and seeing a date thirty-two days out should be told why rather than assume an error.

**Terminate does not complete in this feature.** It routes to [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] with a Modal confirmation. Ending someone's employment should not be reachable in one click from a list of dates.

---

## Related Notes

- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the offboarding flow this feature completes a Departure from
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days a last working date must land on
- [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] — the counterpart at the other end of the employment lifecycle
- [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] — the contextual layer built on this trigger

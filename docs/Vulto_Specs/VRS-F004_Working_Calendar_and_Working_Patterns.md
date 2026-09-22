---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F004
---

# VRS-F004 — Working Calendar and Working Patterns

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity, which owns a calendar), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (WorkingCalendar, Holiday and WorkingPattern registry entries), [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the materialized index these computations run against)
**Blocks:** [[VRS-F005_The_Bench_Forecast|VRS-F005]], [[VRS-F010_Timesheet_Speed-Run|VRS-F010]], [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]], [[VRS-F012_Revenue_Gap_Alert|VRS-F012]], [[VRS-F018_Leave_Policy_Engine|VRS-F018]], [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]], [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]], [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]], [[VRS-F051_Team_Capacity_Planner|VRS-F051]], [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — every feature that counts a day

This document is the single source of truth for what a working day is. Per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] Standing Rule 9, no other feature may compute one.

---

## What It Is

The definition of when people work: which days of the week, which days are holidays, how many hours, and how any individual's schedule differs from their entity's default.

It exposes one small API that every other feature calls instead of doing its own arithmetic.

---

## Problem It Solves

**This feature exists because the previous specification set was wrong, and wrong in a way that would have cost customers money without anyone noticing.**

Bench day counts, leave deductions and final-settlement proration were each computed by excluding *Saturday and Sunday* as hardcoded constants, in four separate documents. That is correct for the UK and the US. It is wrong for a Gulf agency, where the weekend has historically been Friday and Saturday and where government and private sector still differ. It is wrong for a Pakistani agency running six days, or a half-day Friday, both of which are entirely ordinary. It is wrong for anyone part-time or on a compressed week.

The consequences are not cosmetic. A Bench Forecast overstating bench days overstates the accumulated cost figure that is the product's signature element. A leave request deducting the wrong number of days gives an employee more or less entitlement than their contract grants. A final settlement prorating against the wrong denominator pays someone the wrong amount on their last day. Each is silent, each is in the customer's own currency, and each destroys trust in a product whose entire proposition is that its numbers are correct.

There is a second problem, and it is the one that will make people in Vulto's own market notice this product.

**Lunar holidays are not known in advance.** Eid al-Fitr and Eid al-Adha are confirmed by moon sighting, typically one to two days before they occur, and the announcement often shifts the date by a day from the printed estimate. Every calendar in every HR product treats a holiday as a fixed date entered in advance, which means that in Pakistan, the UAE, Saudi Arabia, Indonesia, Malaysia and everywhere else with a substantial Muslim workforce, the calendar is wrong for several days a year, every year, and someone fixes it manually while everything computed from it silently disagrees.

This feature treats a provisional date as a first-class state rather than a data-entry problem.

---

## User-Facing Flows

### Setting up a calendar

Each Entity has one active WorkingCalendar. During [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup, a template is applied from the Entity's jurisdiction — Monday to Friday for UK and US, Sunday to Thursday for AE (F232) and SA, Monday to Saturday with a half-day Saturday for PK, and Monday to Friday at `standard_daily_hours: 8` for `Global`, `IN` and `SG` (F227) — and the founder confirms or adjusts it. Both an Entity's founding-bootstrap creation and any later `entity.create` write this initial calendar atomically with the Entity itself, never as a follow-up step (F227) — including offline, where `entity.create`'s optimistic handler derives and writes the identical calendar and ownership edge from the same shared template logic (F233). The template is a starting point, never an assumption: a Karachi studio working Monday to Friday changes two toggles and moves on.

### Adjusting the working week

Each weekday carries whether it is worked, and how many hours. A half-day is expressed as reduced hours rather than a separate flag, which means a Friday of 4 hours and a Saturday of 4 hours behave identically without either being a special case.

### Holidays

Holidays are added to a calendar with a date, a name, a type — Public, Company or Regional — and, where relevant, the locations they apply to. A Sindh-only holiday does not remove a working day from an employee in Lahore.

Jurisdiction holiday sets are seeded for the current and following year, so a new workspace starts with a populated calendar rather than an empty one.

### Provisional holidays and confirmation

A holiday may be marked **provisional**, carrying an estimated date and a confirmation window. Provisional holidays render distinctly throughout the product, using the dashed treatment from [[VPS-D001_Design_Foundations|VPS-D001]] that already means *expected, not confirmed*.

When the date is announced, an HR Admin confirms it — accepting the estimate or moving it — in a single action from a prompt that appears as the window approaches. Confirmation triggers recalculation across every feature that consumed the estimate, governed precisely below.

### Working patterns

An employee whose schedule differs from their entity's calendar is given a WorkingPattern: per-weekday hours, effective from a date. A three-day-a-week designer, a four-day compressed developer, a parent returning at 60% — each is a pattern, not a different employment type.

Patterns are effective-dated, so someone moving to four days in March has a correct history for both periods.

### Reduced-hours periods

A calendar may define a reduced-hours period: a date range during which daily hours are multiplied by a factor. This exists because reduced working hours during Ramadan are a statutory requirement in the UAE and Saudi Arabia, and a customary practice in Pakistan, and a product that cannot express it will produce wrong utilization figures for a month every year.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Calendars | Content + Panel | One row per Entity calendar. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Calendar detail | Content + Panel | Working week, holidays, reduced-hours periods |
| Working pattern editor | Modal | On the Employee profile |
| Confirmation prompt | Inbox item | Provisional holiday approaching its window |

### Layout and components

**Calendar detail** has three Sections.

*Working week* is seven rows, one per weekday: a Switch for worked, and an Input for hours. Total weekly hours displays in `numeric` beneath, updating live — the single figure that tells someone whether they have configured what they meant to.

*Holidays* is a Table: date, name, type Badge, applies-to, and a provisional Badge in `attention` where relevant. Grouped by year, defaulting to the current one. Primary action **Add holiday**, secondary **Import jurisdiction holidays**.

*Reduced hours* is a small Table: name, date range, factor, and the resulting daily hours computed live.

**A year strip** sits above the Sections: twelve months rendered as a dense grid of day cells, non-working days in `bg-subtle`, holidays in `attention` at 12% fill, provisional holidays with a dashed border. It is the fastest way to see that a calendar is wrong — a month with no weekends visible is immediately obvious in a way that a table of toggles is not.

**Working pattern editor** mirrors the working week Section, pre-filled from the entity calendar, with an effective-from DatePicker. A field left untouched inherits, and inherited values render in `text-tertiary` so that what has been overridden is visible without comparison.

**The confirmation prompt** appears in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox: the holiday name, the estimated date, the window, and two actions — **Confirm as estimated** and **Change date**. It is actionable in place, per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s Inbox rule.

### Keyboard

Standard list bindings. The working week Section supports `Tab` between hour inputs and accepts the same natural-language entry as [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] — `fd` for a full day, `hd` for a half — since it is the same mental operation.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton for the year strip and tables |
| Restricted | Team Members and Managers read calendars, per the workspace-configuration pattern. No write affordance renders |
| Provisional | Dashed border and `attention` badge, per [[VPS-D001_Design_Foundations|VPS-D001]]'s dashed-border rule |
| Empty | Holidays empty shows **Import jurisdiction holidays** as the primary action, not a bare add button |
| Error | A holiday on an existing non-working day is accepted with a note that it changes nothing, rather than refused |

### Responsive

The year strip collapses to four months per row below 1280px and to a month list below 1024px. Holiday tables drop `applies-to` first.

---

## Technical Architecture

### WorkingCalendar

```
calendar_id:        UUID v4
workspace_id:       UUID
entity_id:          UUID, FK to Entity, required
name:               string, required
working_week:       JSON — seven entries, keyed by ISO weekday 1–7:
                      { day: 1..7, is_working: boolean, hours: decimal }
standard_daily_hours: decimal, required, default 8 — the denominator for
                      proration where a specific day's hours are not relevant
lifecycle_status:   enum: Active, Superseded

— Universal Node Conventions per VPS-A002 —
```

Exactly one Active calendar per Entity. Editing creates a new version connected by `supersedes`, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], so that a period computed under the previous working week stays correct.

### Holiday

```
holiday_id:          UUID v4
workspace_id:        UUID
calendar_id:         UUID, FK to WorkingCalendar
name:                string, required
date:                date, required — the effective date; equals estimated_date
                     until confirmed
holiday_type:        enum: Public, Company, Regional
is_provisional:      boolean, default false
estimated_date:      date, nullable — retained after confirmation so the shift
                     is visible
confirmation_window_days: integer, default 3 — days before estimated_date at
                     which the confirmation prompt fires
confirmed_at:        timestamp, nullable
confirmed_by:        user_id, nullable
applies_to_locations: string[], nullable — null means the whole entity
is_half_day:         boolean, default false — some public holidays are half days
lifecycle_status:    enum: Active, Canceled

— Universal Node Conventions per VPS-A002 —
```

**Holidays are versioned together with their calendar (F230).** `calendar.update` copies every still-`Active` Holiday of the calendar version being superseded onto the new version, with a fresh `holiday_in` edge; a `Canceled` Holiday is not copied forward. The old, now-`Superseded` calendar version keeps its own original Holiday nodes untouched, so `calendar.get(entityId, asOf)` against a historical date resolves exactly the holiday set that was true then. `holiday.confirm` and `holiday.cancel` act only on the current Active calendar's own holidays; either refuses `not-found` against a holiday belonging to a `Superseded` version, since historical holidays are frozen the same way a historical working week is.

### WorkingPattern

```
pattern_id:       UUID v4
workspace_id:     UUID
employee_id:      UUID, FK to Employee
working_week:     JSON — same shape as WorkingCalendar; entries omitted
                  inherit from the entity calendar
effective_from:   date, required
effective_to:     date, nullable
lifecycle_status: enum: Active, Superseded

— Universal Node Conventions per VPS-A002 —
```

### ReducedHoursPeriod

Held on WorkingCalendar rather than as its own node, since it has no independent lifecycle:

```
reduced_hours_periods: JSON array of
  { name, start_date, end_date, factor, is_provisional, estimated_start_date }
```

`factor` multiplies each working day's hours. Ramadan in the UAE is a factor of 0.75 against an 8-hour day. The period is itself frequently provisional, since Ramadan's start is moon-sighted, and it carries the same confirmation mechanism as a Holiday.

**Written exclusively through `calendar.update` (F234).** Having no independent lifecycle means having no mutation of its own: `calendar.update`'s optional `reducedHoursPeriods` parameter carries the whole array — omitted, the superseding version inherits the prior version's array unchanged, the same copy-forward convention Holiday gets (F230); provided, it replaces the array outright on the new version. Adding a period, editing one, removing one, and confirming a provisional one by rewriting its dates are all the same call with a different array — never a separate write path, never a dedicated confirmation mutation.

### Resolution order

For a given employee and date, hours resolve in this order, first match winning:

1. A Holiday applying to the employee's location, not half-day → **0 hours**
2. A Holiday applying, half-day → **entity daily hours × 0.5**
3. An active WorkingPattern for that date → **its hours for that weekday**
4. The entity WorkingCalendar → **its hours for that weekday**

Then, if the date falls inside a ReducedHoursPeriod, the result is multiplied by `factor`. Reduced hours modify a working day; they never create or remove one.

### Materialization, and why it matters

This is the performance-critical part of the feature, and it constrains its design.

[[VRS-F005_The_Bench_Forecast|VRS-F005]] renders 150 employees across 90 days within 200ms. Evaluating the resolution order above for each cell is 13,500 evaluations, each traversing to an entity, a calendar, a pattern and a holiday set. Computed naively per cell, it will not meet the budget, and the Bench Forecast's entire proposition is that it renders instantly.

**A working-day index is materialized in the SQLite-WASM index** per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]], one row per employee per date, holding `is_working` and `hours`, covering a rolling window from twelve months past to twenty-four months future. Consuming features read this index; they never walk the graph.

Rebuilds are incremental and triggered by exactly five events: a calendar edit, a holiday added, canceled or confirmed, a working pattern change, a reduced-hours period change, and an employee's entity scoping change. A rebuild affects only the employees and date range touched.

**This entire index is deferred (F226).** Nothing in this feature's own build needs it — the render budget above belongs to `VRS-F005`, not yet built — so the stage that implements this document computes `workingDays.*` directly against the graph, unindexed, and whichever stage builds `VRS-F005` designs and builds this index against the server-authoritative architecture as it exists then.

### Provisional confirmation and recalculation

When a provisional holiday or reduced-hours period is confirmed on a different date from its estimate, the working-day index rebuilds for the affected range and consuming features recalculate — **with three deliberate exceptions.**

**A closed PayRun never recalculates.** It was correct at the moment it was finalized. A change is handled as an adjustment in the following period, per [[VRS-F062_Payroll_Engine_Core|VRS-F062]], because reopening a disbursed payroll to correct a holiday date creates a worse problem than it solves.

**An approved LeaveRequest holds its deducted day count** but surfaces a notice to the approving manager where the shift changes it. Silently returning or taking a day of someone's leave balance because a moon sighting moved is not a decision software should make alone.

**A signed Contract is never altered.** It was accurate when generated.

Everything else — bench days, utilization, capacity forecasts, timesheet expected hours — recalculates freely, because each is a live view rather than a committed record.

### API contracts

```
calendar.get(entityId, asOf?)                          -> WorkingCalendar
calendar.update(calendarId, workingWeek, dailyHours, expectedVersion, reducedHoursPeriods?) -> { calendarId }
  // Checks expectedVersion first (F228). Creates a superseding version;
  // never edits in place. Holidays still Active on the superseded version
  // are copied forward onto the new one (F230). reducedHoursPeriods omitted
  // carries the prior version's array forward unchanged; provided, it
  // replaces the array outright (F234)

holiday.add(calendarId, fields)                        -> { holidayId }
holiday.confirm(holidayId, actualDate)                 -> { success, affectedRange }
holiday.cancel(holidayId, expectedVersion)             -> { success }
holiday.importForJurisdiction(calendarId, jurisdiction, year) -> { imported, provisional }

pattern.set(employeeId, workingWeek, effectiveFrom, expectedVersion?) -> { patternId }
  // expectedVersion is the current pattern's version, required whenever one
  // exists to supersede; omitted only for an employee's first-ever pattern (F228)
pattern.clear(employeeId, effectiveFrom, expectedVersion) -> { success }

— The interface every other feature uses —

workingDays.count(employeeId, from, to)                -> { days, hours }
workingDays.isWorking(employeeId, date)                -> boolean
workingDays.hoursOn(employeeId, date)                  -> decimal
workingDays.next(employeeId, from, n?)                 -> date
workingDays.addWorkingDays(employeeId, from, n)        -> date
```

The last five are the entire public surface of this feature. `workingDays.addWorkingDays` exists because notice periods, probation windows and payment terms are all expressed as *n working days from a date*, and every one of those would otherwise be implemented separately.

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Exactly one Active WorkingCalendar per Entity. Editing creates a superseding version rather than editing in place |
| G02 | Every workspace Entity has a calendar from the moment it is created, online or offline — `entity.create`'s optimistic handler creates the calendar and its ownership edge in the same call as the Entity, from shared deterministic IDs and shared template logic (F233), so there is no state in which an employee has no calendar |
| G03 | A WorkingPattern omitting a weekday inherits that day from the entity calendar. Omission is inheritance, never zero |
| G04 | WorkingPattern follows single-active-with-history, sharing `scoped_to_entity`'s own closed-at-the-boundary convention (F229): superseding a pattern sets its `effective_to` to the new pattern's own `effective_from`, never the day before. The one write-time overlap guard this creates is that a new `effective_from` may never precede the pattern it supersedes — an earlier date would overlap already-closed history instead |
| G05 | Holiday resolution respects `applies_to_locations`. A regional holiday does not remove a working day from an employee elsewhere |
| G06 | The working-day index is materialized per employee per date across a rolling twelve-months-past to twenty-four-months-future window, rebuilt incrementally on the five defined trigger events. **Deferred to the stage that builds `VRS-F005` (F226)** — this feature's own stage builds `workingDays.*` computed directly against the graph, unindexed |
| G07 | Confirming a provisional date recalculates the live view on its next read, for the affected range — the index-rebuild mechanism itself is deferred with G06 (F226); until the index exists, "recalculates" means `workingDays.*` returns the confirmed values on its next call, computed directly, and this live-view case is what this feature's own stage proves. Closed PayRuns, approved LeaveRequests and signed Contracts are exempt from recalculation per the rules above — a binding rule recorded here for whichever stage builds each of `VRS-F062`, leave and `VRS-F020` respectively, since none of the three exists yet to test against (F231, correcting F226) |
| G08 | No other feature computes working days, weekends or holidays. All such arithmetic calls this feature's API, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] Standing Rule 9 |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F004-S01 | Working calendar schema and versioning | Data |
| VRS-F004-S02 | Holiday management and jurisdiction seeding | Data |
| VRS-F004-S03 | Provisional holidays and confirmation workflow | Logic |
| VRS-F004-S04 | Employee working patterns | Data |
| VRS-F004-S05 | Reduced-hours periods | Logic |
| VRS-F004-S06 | Working-day index materialization | Platform |
| VRS-F004-S07 | The working-days API | Platform |

---

## Feature Acceptance Criteria

**GIVEN** an Entity in AE with its Sunday-to-Thursday calendar (F232)
**WHEN** [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] counts bench days across a period containing a Friday
**THEN** the Friday is excluded as a non-working day, and no hardcoded Saturday-Sunday assumption appears anywhere in the computation

---

**GIVEN** a Pakistani entity working Monday to Friday full days and Saturday at 4 hours
**WHEN** a full week is counted
**THEN** it returns 5.5 days and 44 hours, and [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s utilization uses 44 as its denominator

---

**GIVEN** a designer with a three-day working pattern effective from 1 March
**WHEN** their working days are counted across February and March
**THEN** February resolves against the entity calendar and March against the pattern, with no manual adjustment

---

**GIVEN** Eid al-Fitr entered as provisional with an estimated date of 20 March and a three-day window
**WHEN** 17 March is reached
**THEN** a confirmation prompt appears in the HR Admin's Inbox, actionable in place, showing the estimate and both actions

---

**GIVEN** that holiday is confirmed on 21 March rather than 20 March
**WHEN** confirmation is saved
**THEN** bench days and utilization recalculate on their next read (index rebuild deferred, F226), `estimated_date` is retained showing the shift, and `confirmed_at`/`confirmed_by` record who confirmed it and when — no `VPS-F004` `AuditEntry` is written (F225)

---

**GIVEN** a PayRun closed before that confirmation, containing a proration across the shifted range
**WHEN** the confirmation is applied
**THEN** the PayRun is unchanged, and the difference is raised as an adjustment in the following period per [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — **this criterion belongs to `VRS-F062`'s own stage (F231)**; no PayRun exists yet for this feature's own stage to prove it against

---

**GIVEN** an approved leave request spanning the shifted date
**WHEN** the confirmation is applied
**THEN** the deducted day count is unchanged and the approving manager receives a notice describing the discrepancy, rather than the balance changing silently — **this criterion belongs to leave's own stage (F231)**; no LeaveRequest or notice workflow exists yet for this feature's own stage to prove it against

---

**GIVEN** a UAE entity with a Ramadan reduced-hours period at factor 0.75
**WHEN** a working day inside that period is evaluated
**THEN** it returns 6 hours against an 8-hour standard day, and remains a working day

---

**GIVEN** a Bench Forecast of 150 employees across 90 days
**WHEN** it renders
**THEN** every working-day value is read from the materialized index and the full render completes within [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s 200ms budget — **this criterion is deferred with the index itself (F226)**; it is `VRS-F005`'s own stage to prove, once both the Bench Forecast and the index it depends on exist

---

**GIVEN** a regional holiday scoped to Sindh
**WHEN** working days are counted for an employee located in Lahore
**THEN** the day is counted as working, and for an employee in Karachi it is not

---

## Non-Functional Requirements

- **Deferred to the stage that builds `VRS-F005` (F226):** `workingDays.count` returning within 5ms and `workingDays.isWorking` within 1ms from a materialized index, and an incremental index rebuild for a single calendar change across 150 employees completing within 500ms in the worker per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — none of these apply until that stage builds the index; this feature's own stage computes `workingDays.*` directly against the graph with no performance NFR of its own
- Full functionality offline. Holiday seeding is the only network-dependent operation, and a workspace without it is fully usable with manually entered holidays
- The index survives application restart and rebuilds from the graph if corrupted — moot until the index exists (F226)

---

## Security Considerations

- **Calendars are Tier 0 and readable by every workspace member.** An employee must be able to see which days they are expected to work. Write is restricted to Owner and HR Admin per the workspace-configuration pattern in [[VPS-A004_Graph_Permission_Layer|VPS-A004]].
- **A working pattern reveals something personal.** A three-day week frequently corresponds to caring responsibilities, disability accommodation or a phased return. The pattern itself is Tier 0 and operationally necessary — a project manager must know someone does not work Wednesdays — but **no reason field exists on WorkingPattern**, deliberately. Where a reason must be recorded, it belongs in [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] under HR-restricted access, not on an operational record visible to everyone who schedules work.
- **Holiday confirmation is not a `VPS-F004` `AuditEntry` event (F225).** `VPS-F004`'s `event_type` taxonomy is closed and access-focused; an ordinary, permitted HR Admin write recalculating a computed date fits none of its categories, the same reasoning `VRS-F003`'s F221 already applied to Entity transfer. Holiday's own `confirmed_at`/`confirmed_by` fields are the record of who confirmed which holiday and when; the same applies to a `ReducedHoursPeriod`'s confirmation.

---

## Out of Scope

- Shift patterns and rota scheduling. This product serves professional services firms, where people work days rather than shifts, and a rota engine would be a different product
- Time zone conversion for meeting scheduling — [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]]
- Automatic moon-sighting feeds or religious calendar computation. Dates are estimated and confirmed by a person, because the announcement is a human authority in each jurisdiction and a computed approximation would be wrong precisely when it mattered
- Leave entitlement and accrual — [[VRS-F018_Leave_Policy_Engine|VRS-F018]]. This feature says which days are working days; that one says how many an employee may take off
- Overtime thresholds — [[VRS-F018_Leave_Policy_Engine|VRS-F018]]

---

## Decisions Recorded

**This feature is new and closes a defect rather than adding a capability.** Four documents independently hardcoded Saturday and Sunday as the weekend. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] Standing Rule 9 and G08 here make the assumption unwritable going forward.

**Half-days are expressed as hours, not as a flag.** A separate half-day concept would need handling in every consuming feature; reduced hours need handling in none, because they are already hours.

**Provisional holidays are a first-class state.** No competing HR product handles lunar holiday confirmation, and in Vulto's primary markets every calendar is wrong for several days a year as a result. This is a small mechanism with disproportionate value in exactly the market this product is built for.

**Recalculation on confirmation has three exemptions**, and each is a deliberate product judgment rather than a technical limit. Reopening a disbursed payroll to correct a holiday creates a worse problem than it solves. Silently adjusting someone's approved leave balance because a moon sighting moved is a decision a person should make. A signed contract was accurate when signed. **Enforcing these three exemptions is each consuming feature's own obligation, not this feature's (F231, correcting F226's initial overreach)** — this feature's own stage proves only that everything else recalculates freely on the next `workingDays.*` read; PayRun, LeaveRequest and Contract don't exist yet for it to prove an adjustment or a notice against, and each inherits this rule when it is built.

**The working-day index is materialized rather than computed — deferred to whichever stage builds `VRS-F005` (F226).** Naive evaluation cannot meet [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s render budget, and the Bench Forecast's whole proposition is that it appears instantly — but nothing in this feature's own build calls `workingDays.*` at that volume, so this feature's own stage computes it directly against the graph and leaves the index to the stage that actually needs the render budget.

**Holiday and `ReducedHoursPeriod` confirmation are not `VPS-F004`-audited (F225).** `VPS-F004`'s `event_type` taxonomy is closed and access-focused and was never extended for either event, the same gap `VRS-F003`'s F221 found for Entity transfer. Each node's own `confirmed_at`/`confirmed_by` fields (or, for `ReducedHoursPeriod`, the superseding `WorkingCalendar` version's own stamp) are the record.

**WorkingPattern deliberately carries no reason field.** The pattern must be broadly visible for scheduling to work; the reason for it frequently must not be, and putting the two on the same node would have forced a choice between operational utility and a genuine privacy failure.

---

## Related Notes

- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the entities these calendars belong to
- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the employees these patterns apply to
- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the Bench Forecast whose render budget shapes this feature's design
- [[VRS-F018_Leave_Policy_Engine|VRS-F018]] — leave entitlement, which counts the days this feature defines
- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — payroll proration, and the adjustment path for a confirmed date shift
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — Standing Rule 9

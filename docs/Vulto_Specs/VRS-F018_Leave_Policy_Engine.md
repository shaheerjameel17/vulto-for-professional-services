---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F018
---

# VRS-F018 — Leave Policy Engine

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee — `employment_type` and `start_date`), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity and the jurisdiction enum this feature matches on), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — every entitlement and deduction counts through it), [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (the anomaly flag whose clearance becomes the overtime approval), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (LeavePolicy's registry entry and the `supersedes` edge), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the workspace-configuration permission pattern)
**Blocks:** [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] (no accrual rules, entitlements or leave types to offer without this), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (final settlement encashment)

This document is the single source of truth for this feature and owns the overtime and TOIL model.

---

## What It Is

A configurable rule engine defining how leave accrues, what leave types exist, carry-over rules, blackout periods, minimum notice, and — new in this revision — **how overtime is approved and how time off in lieu accrues from it.**

It is the policy layer [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]]'s request form and balance display both read from, so leave is governed consistently rather than each request being evaluated against rules invented on the spot.

---

## Problem It Solves

Leave entitlement varies by jurisdiction in ways that are not optional. Statutory annual leave in the UK is a different number from Pakistan's Factories Act minimum, and an agency operating across both cannot honestly apply one flat rule to everyone.

Without a real policy engine, either every employee gets the same entitlement regardless of where they are actually employed — which is wrong, and in several jurisdictions unlawful — or HR tracks the differences manually outside the product, which is exactly the process this suite exists to replace.

**It is built before [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]]**, correcting an ordering in which the request portal preceded the rules it depends on entirely.

---

## User-Facing Flows

### Configuring a policy

An Owner or HR Admin creates a named policy — *Pakistan Full-Time Standard*, *UK Contractor* — scoped to a jurisdiction and an employment type. Within it each leave type is configured with an accrual method, an annual entitlement, and where applicable carry-over rules and a minimum notice period.

### Which policy applies

Resolved by matching the employee's `employment_type` against the policy's scope, and their jurisdiction, resolved through `entity.resolveForEmployee` per [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]].

Exactly one policy should match. Where more than one does, the most recently created active policy wins and **the conflict is flagged to HR Admin as a configuration issue** rather than silently arbitrated forever.

### Versioning

Updating a policy creates a new version through `supersedes`. Employees already accruing against an older version are not silently recalculated; a change applies going forward, per the same historical-accuracy principle [[VRS-F006_Rate_Card_Engine|VRS-F006]] establishes for rate cards.

### Blackout periods

A policy can carry blackout ranges — a busy client season, a year-end freeze — during which a leave type cannot be requested without an override at approval. **This is a warning surfaced to the approving manager, not a submission-time block**, per the philosophy [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] applies to every check.

### Overtime and time off in lieu

This is the substantive addition, and it deliberately introduces no new node type and no new approval surface.

When an employee's submitted week trips [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s `HoursExceedExpected` check, their manager already reviews and clears the flag. That clearance now carries an outcome: the hours were **corrected**, **accepted as normal**, or **approved as overtime**.

Approved overtime accrues TOIL at the policy's configured rate — one-to-one by default, higher where a jurisdiction or an agency's own policy requires it — into a `TOIL` leave type that behaves like any other: it has a balance, an expiry, and it is requested and approved through [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] like annual leave.

Approved overtime also exempts that week from re-flagging, so the same hours are not queried twice.

**Why it works this way.** Overtime approval and leave are the same shape of decision — a manager confirming that a departure from the normal working pattern is authorized — and building a second request workflow, a second approval queue and a second balance mechanism for the inverse of leave would have produced two systems that disagree at the edges. Using the surface that already exists means the mechanism ships with the feature that generates the signal.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Leave policies | Content + Panel | List and manage. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Policy editor | Panel | Leave types, accrual, blackouts, overtime |
| Overtime outcome | Within [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s flag clearance | The approval moment |

### Layout and components

**Leave policies** is a Table: name, jurisdiction Badge, employment scope, leave type count, employees matched, version. `Employees matched` is a live traversal and the most useful column — a policy matching zero people is either newly created or misconfigured, and both are worth seeing.

**The policy editor** is a stack of Sections. *Scope* holds jurisdiction and employment type. *Leave types* is a Table with one row per type, each expanding to accrual method, entitlement, carry-over cap and expiry, minimum notice, and the encashable Switch. *Blackout periods* is a small Table of ranges. *Overtime* holds the pre-approval Switch, the TOIL accrual rate, expiry and cap.

Saving opens a Modal confirming that existing accrual is unaffected and the change applies forward — the same confirmation [[VRS-F006_Rate_Card_Engine|VRS-F006]] uses, for the same reason.

**The overtime outcome** appears inside [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s flag clearance Panel as a Toggle Group of three: **Corrected**, **Normal for this person**, **Approved overtime**. Selecting the third shows the TOIL that will accrue, in `mono`, before confirmation. A manager approving overtime should see what it costs in future absence at the moment they approve it.

### Keyboard

Standard list and form bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Every role reads policies; only Owner and HR Admin write, per the workspace-configuration pattern |
| Conflict | Two matching policies render an Inline Alert on both, naming the other and the employees affected |
| Empty | Never empty. [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup creates a policy per entity from a jurisdiction template |
| Error | Deleting a policy with matched employees is refused, naming the count |

### Responsive

Drops `version`, then `employment scope`, below 1280px.

---

## Technical Architecture

### The LeavePolicy schema

```
policy_id:             UUID v4
workspace_id:          UUID
name:                  string, required
jurisdiction:          enum per VRS-F003
employment_type_scope: enum: FullTime, PartTime, Contractor, Intern, All

leave_types:           JSON array of {
                         leave_type: enum: Annual, Sick, Casual, Unpaid,
                           Parental, Bereavement, TOIL, Other,
                         accrual_method: enum: Immediate, Monthly, Annual, Earned,
                         annual_entitlement_days: decimal,
                         carryover_max_days: decimal, default 0,
                         carryover_expiry_days: integer, default 90,
                         minimum_notice_days: integer, default 0,
                         requires_approval: boolean, default true,
                         is_encashable: boolean, default false
                       }

overtime_policy:       JSON object of {
                         requires_pre_approval: boolean, default false,
                         toil_accrual_rate: decimal, default 1.0,
                         toil_expiry_days: integer, default 90,
                         toil_max_accrued_days: decimal, default 10
                       }

blackout_periods:      JSON array of {
                         start_date, end_date, reason,
                         applies_to_leave_types: array or 'All'
                       }

version:               integer, starts at 1
supersedes_id:         UUID, nullable
is_active:             boolean, default true

— Universal Node Conventions per VPS-A002 —
```

`accrual_method: Earned` exists for TOIL specifically: the balance is not granted on a schedule but accumulated from approved overtime.

### Accrual, computed live

Balance is computed at query time, never cached — matching [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation philosophy. Caching accrual correctly across mid-year joins, policy versions and carry-over expiry is meaningfully more failure-prone than computing it correctly each time.

| Method | Behavior |
|---|---|
| **Immediate** | The full entitlement is available from `start_date` |
| **Monthly** | Entitlement ÷ 12, accrued per complete month since `start_date` within the policy year, prorated for a partial first month |
| **Annual** | The full entitlement grants once per policy year |
| **Earned** | Accumulated from approved overtime at `toil_accrual_rate`, expiring `toil_expiry_days` after accrual, capped at `toil_max_accrued_days` |

**Carry-over:** unused days at policy-year end, up to the cap, roll forward with an expiry. Anything beyond the cap is forfeited, not silently retained.

### Every day count resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]

Entitlement is expressed in days and consumed in working days. A five-day request spanning a public holiday consumes four. A part-time employee's day is their day, not a notional eight hours. **No calculation in this feature counts a calendar day.**

### TOIL accrual

When [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s flag clearance records `ApprovedOvertime`, TOIL accrues:

```
toil_days = (logged_hours − expected_hours) / standard_daily_hours × toil_accrual_rate
```

`standard_daily_hours` comes from the employee's working calendar per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Accrual is capped at `toil_max_accrued_days`; overtime beyond the cap is approved and exempts the week from re-flagging, but accrues nothing further, and the manager is told so at the point of approval rather than discovering it later.

### API contracts

```
leavePolicy.create(name, jurisdiction, employmentTypeScope, leaveTypes,
                   overtimePolicy?, blackoutPeriods?)     -> { policyId }
leavePolicy.update(policyId, leaveTypes, overtimePolicy?, blackoutPeriods?)
                                                          -> { newPolicyId }
  // Creates a superseding version; never mutates
leavePolicy.getApplicable(employeeId)                     -> LeavePolicy
leavePolicy.listConflicts(workspaceId)                    -> { employeeId, policyIds }[]

leaveBalance.compute(employeeId, leaveType, asOfDate?) -> {
  entitledYtd, carriedOver, used, remaining, expiringSoon
}
  // Computed live from policy and approved request history. Never cached

overtime.approve(flagId, loggedHours, expectedHours) -> {
  toilDaysAccrued, cappedAt?
}
  // Called from VRS-F010's flag clearance when the outcome is ApprovedOvertime
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | LeavePolicy carries the schema above |
| G02 | Updating creates a new version through `supersedes`. The prior version is never edited in place |
| G03 | Exactly one active policy should match an employee. More than one is a configuration issue surfaced to HR Admin, resolved in the interim by the most recently created |
| G04 | Leave balance is never stored. It is computed at query time from the policy and approved request history |
| G05 | Every entitlement, accrual and deduction counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. No calendar-day arithmetic occurs in this feature |
| G06 | TOIL is a leave type with `accrual_method: Earned`, accruing from [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] flag clearances recorded as ApprovedOvertime |
| G07 | Approved overtime exempts that week from re-flagging by [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s `HoursExceedExpected` rule |
| G08 | TOIL accrual is capped. Overtime beyond the cap is approved and exempting, but accrues nothing, and the cap is disclosed at approval |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F018-S01 | LeavePolicy schema and versioning | Data |
| VRS-F018-S02 | Policy configuration surface | UI |
| VRS-F018-S03 | Accrual and carry-over engine | Logic |
| VRS-F018-S04 | Blackout period configuration | Data |
| VRS-F018-S05 | Overtime approval and TOIL accrual | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a Pakistan full-time policy with 14 days annual leave on monthly accrual
**WHEN** an employee six complete months in has their balance computed
**THEN** entitled-to-date is 7 days

---

**GIVEN** an employee carried over 5 days with a 90-day expiry
**WHEN** the balance is computed 91 days into the new policy year
**THEN** those 5 days no longer count toward remaining

---

**GIVEN** a policy is updated to a new entitlement
**WHEN** an employee's balance from before the update is viewed
**THEN** prior accrual is unaffected and the new figure applies forward only

---

**GIVEN** two active policies both match an employee
**WHEN** their applicable policy is resolved
**THEN** the most recently created is used, and both render a conflict alert naming the other and the employees affected

---

**GIVEN** a manager clears a `HoursExceedExpected` flag with the outcome ApprovedOvertime, for a week of 48 logged hours against 40 expected, at an 8-hour standard day and a 1.0 accrual rate
**WHEN** the clearance saves
**THEN** 1 day of TOIL accrues, the week is exempt from re-flagging, and the manager saw the figure before confirming

---

**GIVEN** an employee already holds 10 days of TOIL against a 10-day cap
**WHEN** further overtime is approved
**THEN** the week is exempt from re-flagging, no further TOIL accrues, and the manager is told the cap was reached at the point of approval

---

**GIVEN** a UAE employee requests five days spanning a Friday and Saturday weekend
**WHEN** the deduction is computed
**THEN** it counts only working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and no Saturday-Sunday assumption appears anywhere

---

## Non-Functional Requirements

- `leaveBalance.compute` returns within 200ms from the local graph
- Full functionality offline
- Accrual and carry-over never silently produce a negative remaining balance without a clear explanation of why
- Policy resolution completes within 20ms, since it is called on every leave surface and every payroll line

---

## Security Considerations

- **LeavePolicy is workspace configuration, not individually sensitive.** Every role reads it — an employee needs to see the rules governing their own entitlement — and only Owner and HR Admin write, per the workspace-configuration pattern in [[VPS-A004_Graph_Permission_Layer|VPS-A004]].
- **A TOIL balance implies a history of overtime**, which is a fact about a person's working pattern. It is Tier 0 and visible on the same terms as any other leave balance, which is correct: an employee must see what they have earned, and their manager must see what they may take.
- **The overtime approval is audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]]. A manager authorizing sustained overtime is a fact that matters later, both to [[VRS-F052_Workload_Strain_Signal|VRS-F052]]'s burnout signal and to any dispute about hours.

---

## Out of Scope

- **Leave encashment payment.** This feature owns which types are encashable and the balance; [[VRS-F062_Payroll_Engine_Core|VRS-F062]] owns the payment as part of final settlement
- **Integration with government leave-reporting systems**
- **The overtime detection rule itself** — [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] owns `HoursExceedExpected`. This feature owns what happens when a manager approves it
- **Pre-approved overtime requested in advance.** `requires_pre_approval` is carried on the policy for a later phase; at MVP overtime is approved retrospectively at flag clearance, which is when the hours are actually known
- **Statutory leave templates per jurisdiction.** [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup seeds a starting policy; keeping those figures legally current is not something this product warrants

---

## Decisions Recorded

**TOIL and overtime approval are resolved here, closing the open item both this document and [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] carried while pointing at each other.**

The decision: overtime is approved through the flag clearance that already exists in [[VRS-F010_Timesheet_Speed-Run|VRS-F010]], and TOIL becomes a leave type with `accrual_method: Earned` rather than a parallel balance mechanism. No new node type, no second approval queue, no second request workflow.

The alternative considered was a distinct OvertimeRequest node with its own submission and approval flow, mirroring leave. It was rejected because it would duplicate a workflow the product already has for the inverse operation, and because overtime is discovered rather than planned — an employee knows they worked 48 hours when the week ends, not when it begins. Approving at the moment the hours are known is both simpler and more honest than a request submitted in advance for hours nobody has worked yet.

**[[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s TimesheetAnomalyFlag gains a `clearance_outcome` field** taking Corrected, AcceptedAsNormal or ApprovedOvertime. That is a small addition to that document, made by this one.

**Jurisdiction resolves through [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]]**, using the enum defined there. The previous specification used a five-value enum duplicated across three documents and referenced a jurisdiction field on Employee that was never implemented.

**Every day count resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** Entitlement in days consumed against calendar days would give a Gulf employee more leave than their contract grants and a six-day-week employee less.

**The TOIL cap is disclosed at approval.** A manager approving overtime that accrues nothing should know that at the moment they approve it, not when the employee asks why their balance did not move.

---

## Related Notes

- [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] — the request portal built on this policy
- [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] — the flag whose clearance approves overtime
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days every count resolves through
- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the jurisdiction this policy matches on
- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — encashment at final settlement

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F038
---

# VRS-F038 — Promotion and Compensation Change Workflow

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee — the compensation and role fields this feature is the only sanctioned path to changing), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days, for effective-date arithmetic), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where approvals arrive), [[VPS-F004_Silent_Audit_Log|VPS-F004]] (every step audited), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (CompensationChange and the generalized ApprovalStage), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 1 encryption)
**Blocks:** [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (payroll reads approved changes as an input it currently assumes exists), [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] (band analysis reads the change history)

This document is the single source of truth for this feature.

---

## What It Is

The controlled path by which someone's role or compensation changes: a proposal, a multi-stakeholder approval, an effective date, and a permanent record of who approved what and when.

[[Vulto Roster]]'s own product note describes it — *structured multi-stakeholder approval for salary and role changes, ensuring that finance, the relevant project manager, and HR admin all sign off before changes take effect* — and no feature in the previous set implemented it.

---

## Problem It Solves

A raise happens in a conversation. Somebody agrees it, somebody else needs to know about it, and the person whose salary it is expects to see it in a specific month's payslip.

Without a workflow, three things go wrong routinely.

**The change reaches payroll late or not at all.** [[VRS-F062_Payroll_Engine_Core|VRS-F062]] reads promotion-driven salary changes as an input and assumes they exist. Nothing writes them, which means every raise is a manual payroll adjustment somebody has to remember.

**Nobody agreed who approves.** In a firm where a founder wants sight of every compensation change — which is most firms below a hundred people — that control exists as a convention rather than a mechanism, and conventions fail exactly when the founder is busy.

**There is no history.** *When did she last get a raise, and who signed it off* is a question with real consequences at review time, in a pay equity analysis, and in a dispute, and an overwritten field on the employee record cannot answer it.

---

## User-Facing Flows

### Proposing a change

A Manager, HR Admin or Owner proposes a change for an employee: a new role title, a new seniority level, a new compensation amount, or any combination, with an effective date and a rationale.

Where [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] exists, the proposed figure is shown against the band for that role and level, and a figure outside the band requires a stated reason — the same disclosure-not-block pattern used for over-plan requisitions and out-of-range offers.

**The rationale is required.** A compensation change with no stated reason is one that cannot be evaluated, defended, or learned from.

### Approval

The change routes through an ApprovalStage chain — the fourth consumer of that node type, alongside payroll, requisitions and offers.

The default chain is HR Admin, then Finance Admin, then Owner, configurable per workspace in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]. **An approver without Tier 1 access does not receive a compensation change**, per the rule established in [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]].

Each approver sees the current figure, the proposed figure, the difference in absolute and percentage terms, the band position where available, and the rationale. The percentage matters: a founder approving four changes should be able to see instantly that one of them is 22% and the others are 4%.

### Effective dating

A change carries an effective date, which may be in the future. **The employee record is not modified until that date arrives.**

A raise agreed in February effective 1 April shows on the employee record as a pending change until April, at which point the Tier 1 compensation field is updated and the change is recorded as applied.

### Payroll

[[VRS-F062_Payroll_Engine_Core|VRS-F062]] reads applied changes as an input. A change effective mid-period is prorated by that feature using working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].

**No manual payroll adjustment is required for a raise.** That is the specific failure this feature removes.

### The employee is told

An applied change notifies the employee. Not the approval chain, not who said what — the outcome: their new role, their new compensation, and from when.

A person should not learn about their own raise from a payslip.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Propose change | Modal, from the employee profile | The proposal |
| Compensation history | Section on the employee profile | Every change, applied and pending |
| Approvals | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox | Decision in place |
| Pending changes | Content | HR and Finance view across the workspace |

### Layout and components

**Propose change** collects the changed fields, an effective DatePicker and a rationale Textarea. Only fields being changed are filled; unchanged fields render grayed with their current value, so the proposal reads as a diff rather than a form.

Beneath the compensation field, where a band exists, a horizontal position indicator: the band range, the current figure, and the proposed figure, with the movement shown. A figure outside the band renders `attention` and reveals a required reason.

**Compensation history** is the surface that matters most. A vertical list, newest first: effective date, what changed, from and to, who approved, and the rationale. Compensation figures render in `mono` and are structurally absent for a viewer without Tier 1 access — for whom the entry still shows that a change occurred, its date and its role component, since a promotion is not a secret even where its figure is.

Pending changes render dashed per [[VPS-D001_Design_Foundations|VPS-D001]]'s rule, being expected rather than in effect.

**The approval card** shows current, proposed, the delta in both absolute and percentage terms in `mono-lg`, the band position, and the rationale in full. Two actions inline. The percentage is the largest element after the figures themselves, because it is what makes a change legible in context.

**Pending changes** is a Table across the workspace: employee, change type, effective date, current approval stage, days pending. Sorted by effective date ascending — a change effective next Monday that has not cleared approval is the urgent one, not the oldest.

### Keyboard

Standard form and Inbox bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Compensation figures absent without Tier 1. Role changes and dates remain visible |
| Pending | Dashed on the employee profile, with the effective date stated |
| Overdue | An effective date passed while still pending renders `attention` in the workspace list and notifies the approval chain |
| Empty | *No compensation changes recorded.* |
| Error | A second pending change for the same employee and effective date is refused |

### Responsive

The workspace list drops `change type`, then `days pending`, below 1280px. Effective date is never dropped.

---

## Technical Architecture

### The CompensationChange schema

Finance-restricted, Tier 1 in full. Unlike Requisition and Offer, there is no meaningful Tier 0 half: the entire record is a statement about one person's pay.

```
change_id:              UUID v4
workspace_id:           UUID
employee_id:            UUID, FK to Employee
change_type:            enum: Promotion, CompensationOnly, RoleOnly, Adjustment
effective_date:         date, required

previous_role_title:    string, nullable
new_role_title:         string, nullable
previous_seniority:     enum per VRS-F002, nullable
new_seniority:          enum, nullable
previous_compensation:  decimal, nullable — snapshotted at proposal
new_compensation:       decimal, nullable
compensation_currency:  ISO 4217

rationale:              text, required
out_of_band_reason:     text, nullable — required where outside VRS-F070's band
status:                 enum: Draft, PendingApproval, Approved, Applied,
                        Rejected, Withdrawn
applied_at:             timestamp, nullable
rejected_reason:        text, nullable, required when Rejected

— Universal Node Conventions per VPS-A002 —
```

`previous_compensation` is snapshotted at proposal rather than read live at application. Between proposal and effective date the figure could change through another route, and a history that reports a delta computed against a different starting point than the approver saw is a history that misleads.

### The application job

A scheduled job per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] runs daily, finds Approved changes whose effective date has arrived, and applies them: the Employee's Tier 1 compensation fields, `job_title` and `seniority_level` are updated, and status becomes Applied.

**It runs on an authorized device**, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the compensation figures are Tier 1 and a server-side job cannot read or write them. The job's server-side role is to identify which changes are due; an authorized session applies them.

Where no authorized device connects for several days, changes queue and apply on next connection, with the effective date preserved so payroll proration remains correct. A change overdue by more than three days notifies Owner and Finance Admin, because an unapplied raise is a person being underpaid.

### Approval routing

The default chain is HR Admin → Finance Admin → Owner, sequential. Configurable per workspace, with two constraints: **the chain may not be empty**, and every stage must hold Tier 1 access.

A self-approval is refused. A Manager who is also an Owner cannot approve their own report's raise through the Owner stage, and the chain skips them with the reason recorded rather than silently accepting it.

### The single sanctioned path

**Once this feature exists, it is the only path by which `base_compensation_amount`, `job_title` and `seniority_level` change on an existing employee.** Direct edits to those fields through [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] are refused for an employee whose record is not newly created.

This is a real constraint on an earlier feature and it is deliberate. A workflow that can be bypassed by editing the field directly is a workflow that documents what people did rather than governing it.

The exceptions are narrow and enumerated: initial values at hire, values set by [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s import, and a correction of a data-entry error, which is itself an Adjustment record with a rationale.

### API contracts

```
compensationChange.propose(employeeId, changes, effectiveDate, rationale,
                           outOfBandReason?) -> { changeId, withinBand? }
compensationChange.submitForApproval(changeId)  -> { success }
compensationChange.approve(changeId)            -> { success, nextStage? }
compensationChange.reject(changeId, reason)     -> { success }
compensationChange.withdraw(changeId)           -> { success }

compensationChange.applyDue(workspaceId) -> { applied: changeId[] }
  // Runs on an authorized device. Applies Approved changes whose
  // effective date has arrived

compensationChange.historyForEmployee(employeeId) -> CompensationChange[]
  // Tier 1 fields absent for a caller without access; the fact, date and
  // role component remain

compensationChange.listPending(workspaceId) -> CompensationChange[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | CompensationChange carries the schema above, Tier 1 in full |
| G02 | `changes_compensation_for` connects it to Employee. `gated_by` connects it to its ApprovalStage chain |
| G03 | This feature is the only path by which compensation, job title and seniority change on an existing employee. Direct edits are refused, excepting hire, import and a rationale-bearing correction |
| G04 | `previous_compensation` is snapshotted at proposal, never read live at application |
| G05 | A change applies on its effective date, not on approval. The employee record is unmodified until then |
| G06 | Application runs on an authorized device. No server-side path reads or writes Tier 1 compensation |
| G07 | The approval chain may not be empty and every stage must hold Tier 1 access. Self-approval is refused and the skip is recorded |
| G08 | An applied change notifies the employee with the outcome only, never the approval chain |
| G09 | A change overdue by more than three days notifies Owner and Finance Admin |
| G10 | Uses the generalized ApprovalStage, not a bespoke mechanism |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F038-S01 | CompensationChange schema | Data |
| VRS-F038-S02 | Proposal with band positioning | UI |
| VRS-F038-S03 | Approval routing | Logic |
| VRS-F038-S04 | Effective-date application | Logic |
| VRS-F038-S05 | Compensation history | UI |

---

## Feature Acceptance Criteria

**GIVEN** a Manager proposes a promotion with a new title and a 12% raise effective 1 April
**WHEN** it is submitted
**THEN** a change exists at PendingApproval, the employee record is unmodified, and the first approver sees current, proposed, the absolute and percentage delta, and the rationale

---

**GIVEN** an approver without Tier 1 access sits in the configured chain
**WHEN** routing runs
**THEN** they do not receive the change, and the configuration is flagged as invalid

---

**GIVEN** an approver is the proposing manager and also holds Owner
**WHEN** the chain reaches the Owner stage
**THEN** self-approval is refused, the stage is skipped with the reason recorded, and the change routes onward

---

**GIVEN** an approved change with an effective date of 1 April
**WHEN** 1 April arrives and an authorized device connects
**THEN** the Employee's compensation, title and seniority update, status becomes Applied, and the employee is notified with the outcome

---

**GIVEN** the same change before 1 April
**WHEN** the employee profile is viewed
**THEN** the current compensation is unchanged and a pending change is shown dashed with its effective date

---

**GIVEN** an approved change whose effective date passed four days ago with no authorized device connecting
**WHEN** the overdue check runs
**THEN** Owner and Finance Admin are notified, and the change applies on next connection with its original effective date preserved

---

**GIVEN** an HR Admin attempts to edit an existing employee's compensation directly through [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]
**WHEN** the write is attempted
**THEN** it is refused, directing them to propose a change

---

**GIVEN** a Manager without Tier 1 access views a report's compensation history
**WHEN** it renders
**THEN** they see that a promotion occurred, its date and its role change, and no figure

---

**GIVEN** a change is applied mid-payroll-period
**WHEN** [[VRS-F062_Payroll_Engine_Core|VRS-F062]] runs
**THEN** it prorates using working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and no manual adjustment is required

---

## Non-Functional Requirements

- Proposal and approval surfaces resolve within 200ms from the local graph
- The due-change job identifies changes within 5 minutes of an effective date beginning
- Application completes within 5 seconds of an authorized device connecting
- Full functionality offline for proposal and viewing. Approval and application follow standard sync

---

## Security Considerations

- **CompensationChange is Tier 1 in full**, with no Tier 0 half. Unlike a requisition or an offer, there is no operational component worth exposing — the entire record is a statement about one person's pay, and the fact that a change occurred is visible on the employee's history without the record itself being readable.
- **This feature being the only sanctioned path is a security property, not only a process one.** A compensation field that can be edited directly has an approval workflow that documents what people did rather than governing it, and the audit trail of a bypassed workflow is worse than none because it looks complete.
- **Every step is audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]]: proposal, each approval, rejection, and application. A raise is among the most disputed facts in an employment relationship.
- **Self-approval is refused structurally.** The role combination that makes it possible — a founder who also manages people — is the normal case in this product's target market, not an edge case.
- **The employee is told the outcome, never the deliberation.** Who approved and who hesitated is not information that improves anyone's employment relationship.

---

## Out of Scope

- **Compensation bands themselves** — [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]]. This feature reads them where they exist and functions without them
- **Payroll calculation and proration** — [[VRS-F062_Payroll_Engine_Core|VRS-F062]]
- **Performance review outcomes driving a proposal** — [[VRS-F039_Performance_Review_Cycle|VRS-F039]] informs a person, who proposes
- **Bulk or across-the-board adjustments.** A cost-of-living increase applied to forty people is forty records, which is correct: each is a change to one person's pay with its own effective date and its own history
- **Equity, options or non-cash compensation** — this feature covers cash compensation and role
- **Retroactive changes.** An effective date in the past is permitted for a correction, but the resulting payroll adjustment is [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s to handle, not this feature's to compute

---

## Decisions Recorded

**This feature is new**, and it closes a gap where [[Vulto Roster]]'s own product note described a capability and [[VRS-F062_Payroll_Engine_Core|VRS-F062]] assumed an input that nothing wrote.

**A change applies on its effective date, not on approval.** The alternative — applying immediately and letting payroll work out the timing — produces an employee record that disagrees with the employee's own understanding of when their raise starts.

**This feature is the only sanctioned path to changing compensation, title and seniority.** That is a real constraint imposed on [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], and without it the workflow is optional and therefore decorative.

**`previous_compensation` is snapshotted at proposal.** A history reporting a delta computed against a different starting point than the approver saw is a history that misleads at exactly the moment it is being relied on.

**Self-approval is refused with the skip recorded.** A founder who manages people is the normal case here, and silently accepting their approval of their own report's raise would make the chain meaningless in the firms most likely to want it.

**The employee is notified of the outcome only.** A person should not learn about their own raise from a payslip, and should not learn who hesitated over it at all.

---

## Related Notes

- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the fields this feature is the only path to changing
- [[VRS-F070_Compensation_Bands_and_Pay_Equity|VRS-F070]] — the bands a proposal is positioned against
- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — payroll, which reads applied changes
- [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] — the org chart a promotion changes

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F065
---

# VRS-F065 — Payroll Approval Workflow

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (PayRun, the object this feature gates, and its void action), [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] (**deduction source tagging, without which manual-adjustment detection misfires**), [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] and [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] (disbursement, gated on this feature's approval), [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] (the deliberate-override-with-justification pattern, reused rather than reinvented), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (ApprovalStage, generalized across four consumers)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Why this is not a rubber stamp

A gate that only checks whether someone clicked finalize is not a control. It is theater with a button.

Two things make the review worth having.

**Genuine segregation of duty**, reusing [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s deliberate-override pattern rather than inventing a parallel one. Whoever finalized a run cannot approve it without an explicit, logged justification.

**Flagged changes with revenue context, not a blank ledger.** Every manual adjustment, every employee whose pay moved beyond a threshold since their last period, and anyone who quietly stopped appearing — each surfaced alongside the same revenue figure [[VRS-F062_Payroll_Engine_Core|VRS-F062]] already computes for that person and period.

**A 20% pay increase next to a 20% jump in billed revenue is a five-second confirmation. The same increase with nothing beside it is exactly what this feature exists to make someone actually look at.**

---

## What It Is

A single-stage review gate, created automatically the moment a run reaches finalized, which must reach approved before that run is eligible for disbursement.

---

## Problem It Solves

[[VRS-F062_Payroll_Engine_Core|VRS-F062]] ensures a run's numbers are calculated correctly. It never claimed to ensure they are **the numbers that were intended** — a bonus entered wrong, an employee left on the run after they should have been removed, a correction applied twice.

Without a second set of eyes and something concrete to look at, those are caught after the money has moved, if ever.

---

## User-Facing Flows

### A review appears

The moment a run is finalized, an approval stage is created at Pending. No separate action starts it.

### What the reviewer sees

Three things, never a blank total.

Every manually entered bonus or deduction, attributed to the employee. Every employee whose net pay moved beyond the configured variance threshold since their prior period, **shown alongside both periods' revenue**. And anyone present in the prior run with no payslip in this one and no offboarding on record.

### Approving

A Finance Admin or Owner other than whoever finalized approves directly. **The exact review context is captured permanently at that moment** — the same reason a signed contract's content is frozen at signing rather than reconstructed later from data that may have changed.

### The one deliberate exception

If the only available reviewer is the person who finalized — a genuine small-team reality this feature does not pretend away — they may approve with an explicit stated reason, stored and visible to anyone who can see the run.

### Rejecting

Voids the run and **releases every hour finalization had locked**, so a corrected run is built from scratch rather than fighting an already-consumed calculation.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Pending approvals | Content | Runs awaiting review |
| Review | Content, full width | The three flag sets |

Also surfaced in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox as an action item.

### Layout and components

**The review screen** leads with the run's identity and totals, then three Sections in order of consequence: **missing employees**, **variance flags**, **manual adjustments**.

Missing leads deliberately. A person who has silently dropped off a run is the most expensive error here and the least visible — a wrong bonus is a number someone will query; an unpaid colleague is a relationship.

**Variance rows are the design-critical element.** Each is a single row carrying: the employee, previous net pay, current net pay, the percentage change, and **previous and current revenue side by side in `numeric`**. The revenue pair sits immediately beside the pay pair, not in a separate column group, so the comparison is one glance rather than two.

Where revenue moved in the same direction and rough proportion, the row renders neutral. Where pay rose and revenue did not, it renders `attention`. That is not a judgment — plenty of legitimate raises have nothing to do with billing — but it is the row worth looking at twice.

**The two actions sit at the foot**, and **Approve** is disabled until every Section has been scrolled through. The same reasoning as [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]]'s acknowledgment gate: an approval is an assertion that someone reviewed something, and a button available before the flags have been seen makes that assertion false.

Where the reviewer is the finalizer, Approve reveals a required reason field with plain copy: *You finalized this run. Approving your own run requires a stated reason, which will be visible to anyone who can see this payroll.*

### Keyboard

`J`/`K` through flagged rows. No shortcut for approve or reject.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Finance-restricted. Owner, HR Admin and Finance Admin |
| Self-approval | Reason field revealed, with the consequence stated |
| Empty | *No flags. 34 payslips, no manual adjustments, no significant variance.* Stated positively — a clean run is a real outcome, not an absence |
| Error | Approving without scrolling, or self-approving without a reason, is refused |

### Responsive

Desktop only below 1024px, and it says so. Releasing payroll is not a phone task.

---

## Technical Architecture

### The ApprovalStage schema

Finance-restricted, Tier 1. **Generalized in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] across four consumers** — this feature, [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]], [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]] and [[VRS-F032_Offer_Management|VRS-F032]] — inheriting the tier of whatever it gates.

```
approval_stage_id:             UUID v4
workspace_id:                  UUID
gated_node_id:                 UUID — the PayRun here; a CompensationChange,
                               Requisition or Offer for the other consumers
gated_node_type:               string
status:                        enum: Pending, Approved, Rejected
finalized_by:                  user_id — snapshotted at creation, the
                               reference the segregation check compares against
reviewed_by / reviewed_at:     user_id / timestamp, nullable
self_approval_override_reason: text, nullable — required when reviewer
                               equals finalizer
rejection_reason:              text, nullable, required when Rejected
flagged_items_snapshot:        JSON, nullable — exactly what the review
                               context returned at the moment of decision,
                               captured once and never recomputed

— Universal Node Conventions per VPS-A002 —
```

### The three flags

**Manual adjustments.** Any payslip with a non-zero bonus, or a deduction tagged `source: Manual` per [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]].

**This is why [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] is built first.** The previous specification compared a payslip's deductions against the policy's own list, which would misflag every statutory line as a manual override the moment tax configuration existed — a computed tax line was never going to match a discretionary list it was not drawn from. Reading the source tag directly is correct regardless of how many deduction sources ever exist.

**Variance.** Each payslip against the same employee's payslip from the immediately preceding finalized run for the same entity, compared on net pay. A change exceeding `payroll_variance_flag_threshold`, default 15%, is flagged with both periods' revenue.

**Quietly missing.** Present in the prior run, no payslip in this one, no completed departure explaining it — flagged by name with their prior net pay.

### Segregation of duty

`approve` compares the caller against `finalized_by`. A match without a reason is rejected outright. A match with one succeeds, the reason stored and visible — **the identical shape [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] built for a capacity override**, not a second mechanism for a second domain.

### Rejection reuses the void action

`reject` calls [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s void directly rather than implementing a second voiding mechanism. That action releases every `processed_in` edge finalization wrote, freeing the underlying timesheet entries for a corrected run.

### API contracts

```
approvalStage.evaluate(payRunId) -> { approvalStageId }
  // Reactive on finalization. Creates at Pending, snapshotting finalized_by

approvalStage.getReviewContext(approvalStageId) -> {
  missingFromThisRun: { employeeId, employeeName, previousNetPay }[],
  varianceFlags: { employeeId, employeeName, previousNetPay, currentNetPay,
                   percentChange, previousRevenue, currentRevenue }[],
  manualAdjustments: { employeeId, employeeName, field, amount }[],
  summary: { paySlipCount, totalGross, totalNet, totalEmployerCost }
}
  // Computed live on every call until the moment of decision

approvalStage.approve(approvalStageId, selfApprovalOverrideReason?)
  -> { success }
  // Rejected where the caller equals finalized_by without a reason.
  // Snapshots the review context at the moment of approval

approvalStage.reject(approvalStageId, reason) -> { success }
  // Calls VRS-F062's void directly. Snapshots the same way

approvalStage.listPending(workspaceId) -> ApprovalStage[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | ApprovalStage carries the schema above and is the generalized node type serving four consumers, inheriting the tier of what it gates |
| G02 | A stage is created automatically on finalization. At most one per run, since a rejected run is voided and any correction becomes a new run with its own stage |
| G03 | Approve is rejected where the caller equals the finalizer without a stated reason, the identical override shape [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] established |
| G04 | Reject calls [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s void directly, releasing every `processed_in` edge finalization wrote |
| G05 | `flagged_items_snapshot` is captured once at decision and never recomputed |
| G06 | Manual-adjustment detection reads each deduction's `source` tag per [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]], never a comparison against the policy's own list |
| G07 | Disbursement per [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] and [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] requires an Approved stage, not finalized status alone |
| G08 | Variance and missing-employee flagging compare structured payslip records against structured payslip records. No cross-pattern reasoning; outside Standing Rule 7 |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F065-S01 | ApprovalStage schema and reactive creation | Data |
| VRS-F065-S02 | Three-flag review context | Logic |
| VRS-F065-S03 | Segregation of duty and override | Logic |
| VRS-F065-S04 | Review surface and snapshot capture | UI |

---

## Feature Acceptance Criteria

**GIVEN** a run reaches finalized
**WHEN** the transition completes
**THEN** an approval stage is created at Pending with the finalizer snapshotted

---

**GIVEN** a Finance Admin manually adjusted a bonus during preview
**WHEN** the review context is requested
**THEN** it appears under manual adjustments, attributed to the employee and figure

---

**GIVEN** a payslip carries statutory deductions computed by [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]]
**WHEN** the review context is requested
**THEN** those lines do not appear as manual adjustments, because detection reads the source tag rather than comparing against the policy list

---

**GIVEN** an employee's net pay is 30% higher than their prior period against a 15% threshold
**WHEN** the context is requested
**THEN** they appear under variance with both periods' net pay and both periods' revenue shown side by side

---

**GIVEN** an employee appeared in the prior run with no payslip in this one and no departure explaining it
**WHEN** the context is requested
**THEN** they appear under missing, first among the three sections

---

**GIVEN** the finalizer attempts to approve with no reason
**WHEN** it is attempted
**THEN** it is refused until a reason is supplied

---

**GIVEN** a different Finance Admin approves
**WHEN** it saves
**THEN** it succeeds without an override reason, and the snapshot captures exactly what the context returned at that moment

---

**GIVEN** a stage is rejected
**WHEN** it processes
**THEN** the run is voided, every `processed_in` edge is released, and the underlying timesheet entries become available for a corrected run

---

**GIVEN** a run is finalized but not yet approved
**WHEN** disbursement is attempted
**THEN** it is rejected

---

## Non-Functional Requirements

- The review context resolves within 2 seconds for a run of up to 150 payslips
- A stage appears within 5 seconds of finalization
- Reviewing, approving and rejecting function offline
- The snapshot never changes after decision, even if underlying payslip or prior-period data is later corrected

---

## Security Considerations

- **Segregation of duty is the substantive control**, and it reuses rather than reinvents. [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] built the exact shape needed — a hard default with a deliberate, logged, named-reason override — for a completely different problem. The same shape fits: a default that should hold, and a real-world exception that must never be silent when it does not.
- **HR Admin's Full access was checked against PayRun's own row rather than assumed.** That row already grants HR Admin full access to the run itself, a more consequential authority than approving one, so restricting the approval specifically would be inconsistent with a ceiling already set.
- **The scroll gate on approval is deliberate friction**, matching [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]]'s acknowledgment gate. Approving payroll is an assertion that someone reviewed the flags, and a button available before they have been seen makes that assertion false.
- **The snapshot is what makes this auditable.** Six months later, *what did the approver actually see* is the question, and recomputing the context from data that has since changed would answer a different one.

---

## Out of Scope

- **Gating invoice approval** — considered and declined. An individual contractor invoice is a materially smaller decision than a multi-employee run, and [[VRS-F067_Contractor_Invoice_Management|VRS-F067]]'s own approve and reject mechanism remains adequate
- **A multi-stage or multi-approver chain** — one review, one decision. [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]'s sequential chain exists for compensation changes because those genuinely need several roles; a payroll run needs one person who did not calculate it
- **Reminders or escalation for a stage sitting unreviewed** — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s territory, which surfaces it as an action item
- **Any change to how a run's figures are calculated** — this reviews and gates. It never recalculates or second-guesses the arithmetic

---

## Decisions Recorded

**Missing employees lead the review, ahead of variance and manual adjustments.** A person who silently dropped off a run is the most expensive error here and the least visible — a wrong bonus gets queried, an unpaid colleague is a relationship.

**Revenue sits immediately beside pay on a variance row**, not in a separate column group. The whole value of this feature's variance flag is that the comparison is one glance, and separating the two pairs would make it two.

**Approve is gated on scrolling through every section**, matching [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]]'s only other artificial friction. The record's value rests on the assertion being true.

**Manual-adjustment detection reads [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]]'s source tag**, which is why that feature is now built first. The previous ordering would have shipped a detection rule that misflagged every statutory line the moment tax configuration existed.

**A clean run is stated positively.** *No flags — 34 payslips, no manual adjustments, no significant variance* is a real outcome, and rendering it as an empty state would misrepresent a well-run payroll as an absence of data.

---

## Related Notes

- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — the run this feature gates
- [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] — the source tagging detection depends on
- [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] — the override pattern reused here
- [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] — disbursement, gated on this approval

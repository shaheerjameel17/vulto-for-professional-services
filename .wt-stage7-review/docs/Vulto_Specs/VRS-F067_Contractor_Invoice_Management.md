---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F067
---

# VRS-F067 — Contractor Invoice Management

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee with `employment_type = Contractor`, and the compensation fields read here for a second purpose), [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (TimesheetEntry, the hours source), [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] (SubVendor, the second invoice source), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (the `processed_in` edge and its double-billing safeguard, reused not reinvented), [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] (**the disbursement adapter, replacing the former [[Vulto Pay]] dependency**), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Invoice, and the Write-Ownership Handoff)
**Blocks:** [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]], which reads paid invoices alongside payroll history

This document is the single source of truth for this feature.

---

## Why this is not Bill.com with a Roster login

A standalone invoicing tool takes a contractor's word for how many hours they worked, because it has no other source of truth to check against.

**This feature does not need one.** A time-based invoice is generated directly from the same timesheet records already feeding the Bench Forecast, the utilization pulse and the bench alert. There is nothing to reconcile after the fact, because **there was never a second independent record to reconcile against.**

---

## What It Is

Invoice tracking and payment for the two external-capacity sources [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] establishes: individual **contractors**, invoiced automatically from logged hours or manually against an agreed milestone, and **sub-vendor organizations**, invoiced manually against their engagement.

Both flow through one review, approval and payment lifecycle, reusing [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s adapter for the payment step.

---

## Problem It Solves

An agency with real contractor headcount already tracks their hours in this product, and separately receives an invoice by email stating a number someone then checks against those same hours.

**That reconciliation is invented work.** It exists only because the invoice and the timesheet were never the same data.

For sub-vendors the problem is different: there is nowhere in this graph to record that an invoice exists at all, let alone whether it has been reviewed or paid.

---

## User-Facing Flows

### A time-based invoice, drafted automatically

At the start of each invoicing period, a draft is generated for every contractor with logged hours: hours summed from their entries, at their own rate, snapshotted at generation. **Nobody has to remember to create it.**

### The contractor reviews and submits

A contractor is an authenticated workspace member like any other employee. They open their draft, see hours and amount pre-filled, and submit — **or flag a discrepancy before submitting rather than after being paid the wrong amount.**

### A milestone invoice

For a fixed-fee engagement with no hourly basis, a contractor creates one directly: a description, an amount, and where relevant the project it relates to.

### A sub-vendor invoice

Created by a Finance Admin or Owner, since a sub-vendor holds no account of its own. **An HR Admin, who fully manages the underlying engagement, still cannot create the invoice** — the relationship and the financial transaction are deliberately governed by different roles.

### Review, approval, payment

A Finance Admin sees the underlying hours and rate for a time-based invoice, or the stated description for the others, and approves or rejects. Rejection requires a reason and returns it for correction.

Approval makes it eligible for [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s batch.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Invoices | Content + Panel | The queue |
| Invoice detail | Panel | The underlying basis |
| My invoices | Section in [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] | The contractor's own |

### Layout and components

**Invoices** is a Table: source, type Badge, period or description, amount, status Badge, days since submission. Sorted by days pending descending — **an invoice sitting unreviewed is somebody waiting to be paid.**

**Invoice detail** is where a time-based invoice earns its trust. It shows the hours summed **with the constituent entries listed**: date, project, hours, category. A reviewer approving a figure they cannot decompose is approving a number; one who can see the twelve days behind it is approving a fact.

The rate is shown as snapshotted, with a note where it differs from the contractor's current rate — a genuine case when a rate changed mid-period, and one a reviewer should see rather than discover.

**My invoices** shows the contractor their own history with status, and a **Flag discrepancy** action on a draft, which returns it to HR with a note rather than forcing them to submit something they believe is wrong.

### Keyboard

Standard list bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner and Finance Admin manage. HR Admin reads. Contractors see their own. Manager none |
| Rejected | Renders with the reason visible to the submitter |
| Empty | *No invoices this period.* |
| Error | An invoice whose hours are already processed elsewhere is refused, naming where |

### Responsive

Contractor-facing surfaces work at 375px. The review queue is desktop-first.

---

## Technical Architecture

### The Invoice schema

Finance-restricted, Tier 1.

```
invoice_id:             UUID v4
workspace_id:           UUID
contractor_employee_id: UUID, nullable, FK to Employee
sub_vendor_id:          UUID, nullable, FK to SubVendor
                        — exactly one of the two is set
invoice_type:           enum: TimeBased, MilestoneBased, SubVendorEngagement
project_id:             UUID, nullable
invoice_period_start / invoice_period_end: date, nullable — TimeBased only
description:            text — required for the manual types, auto-generated
                        for TimeBased
hours_invoiced:         decimal, nullable — TimeBased only
rate_used:              decimal, nullable — snapshotted at generation, never
                        re-resolved
amount:                 decimal — computed for TimeBased, entered otherwise
currency:               ISO 4217
status:                 enum: Draft, Submitted, Approved, Rejected, Paid, Voided
submitted_at:           timestamp, nullable
reviewed_by / reviewed_at: user_id / timestamp, nullable
rejection_reason:       text, nullable, required when Rejected

— Universal Node Conventions per VPS-A002 —
```

**Payment status lives on [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s instruction, not here.** The previous specification carried payment tracking fields on Invoice directly, duplicating what the disbursement layer now owns. Invoice reaches Paid when its instruction is confirmed; the tracking of send, confirm and fail belongs to the feature that does the sending.

### No new compensation field

[[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] already carries the rate fields, added for payroll. **Nothing about them is payroll-specific in shape** — a contractor's hourly rate lives in the same fields, read here for an invoice instead of a payslip.

### Generating a draft

Sums every hour logged in the period — billable, non-billable and pitch alike, the same *all logged time is paid time* philosophy [[VRS-F062_Payroll_Engine_Core|VRS-F062]] applies to an hourly employee — **excluding any entry already carrying a `processed_in` edge to an approved invoice or a finalized run.**

Period boundaries resolve through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], so an invoicing period is the contractor's actual working days rather than a calendar span.

At most one non-voided time-based invoice per contractor per period. A repeat call updates the draft rather than duplicating.

### The double-billing safeguard

`processed_in`, already anchored for timesheet-to-payrun, is extended to also target Invoice. **Edges are written at approval, never at draft or submission**, so an unconfirmed invoice never locks anyone's hours.

### Manual types are deliberately manual

Neither milestone nor sub-vendor invoices are computed from anything. Roster has no Deliverable concept — that belongs to [[Vulto Projects]] — and **this feature does not simulate one.** `description` is a plain, honest field, not a structured stand-in for a layer this graph does not own.

### API contracts

```
invoice.generateTimeBasedDraft(contractorEmployeeId, periodStart, periodEnd)
  -> { invoiceId, hoursIncluded, hoursExcludedAsProcessed }

invoice.createMilestoneBased(contractorEmployeeId, description, amount,
                             currency, projectId?) -> { invoiceId }
invoice.createSubVendorEngagement(subVendorId, description, amount,
                                  currency, projectId?) -> { invoiceId }
  // Finance Admin or Owner only. HR Admin's read access does not extend
  // to creation, despite managing the underlying engagement

invoice.submit(invoiceId)                -> { success }
invoice.flagDiscrepancy(invoiceId, note) -> { success }
  // A contractor's alternative to submitting something they believe wrong
invoice.withdraw(invoiceId)              -> { success }
invoice.approve(invoiceId)               -> { success }
  // Writes processed_in edges for TimeBased. Makes it eligible for VRS-F066
invoice.reject(invoiceId, reason)        -> { success }

invoice.getBasis(invoiceId) -> {
  entries: { date, projectName, hours, category }[],
  rateUsed, rateCurrentlyOnRecord, differs
}
  // The decomposition a reviewer needs

invoice.listForContractor(employeeId)    -> Invoice[]
invoice.listPendingReview(workspaceId)   -> Invoice[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Invoice carries the schema above. `generated_from` and `billed_by` connect it to Project and to the billing contractor or sub-vendor |
| G02 | `billed_by` targets both Employee and SubVendor |
| G03 | Exactly one of the two source fields is set. Never both, never neither |
| G04 | `processed_in` is extended to target Invoice. Edges are written at approval only, never at draft or submission |
| G05 | At most one non-voided TimeBased invoice per contractor per period. Regeneration updates rather than duplicates |
| G06 | `rate_used` is snapshotted at generation and never re-resolved, even if the contractor's rate changes before approval |
| G07 | Payment tracking lives on [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s instruction. Invoice reaches Paid when its instruction confirms |
| G08 | Invoice is a bootstrap under the Write-Ownership Handoff: Roster until [[Vulto Accounts]] is activated, Accounts thereafter |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F067-S01 | Invoice schema and both sources | Data |
| VRS-F067-S02 | Time-based generation and double-billing safeguard | Logic |
| VRS-F067-S03 | Manual invoice entry | Logic |
| VRS-F067-S04 | Review with basis decomposition | UI |
| VRS-F067-S05 | Discrepancy flagging | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a contractor logged 40 billable and 2.5 non-billable hours at a rate of 75
**WHEN** a draft generates
**THEN** hours invoiced is 42.5, rate used is 75, amount is 3187.50, status Draft

---

**GIVEN** some of those hours were already approved on a prior invoice
**WHEN** a second draft generates for an overlapping period
**THEN** those hours are excluded and the count of excluded hours is reported, never silently dropped or double-billed

---

**GIVEN** a reviewer opens a time-based invoice
**WHEN** the basis renders
**THEN** every constituent entry is listed with its date, project and hours, so the total can be decomposed rather than trusted

---

**GIVEN** the contractor's rate changed after the draft generated
**WHEN** the basis renders
**THEN** the snapshotted rate is shown alongside the current one with the difference noted

---

**GIVEN** a contractor believes their draft is wrong
**WHEN** they flag a discrepancy
**THEN** it returns to HR with their note, and they are not required to submit something they believe incorrect

---

**GIVEN** an approval is recorded
**WHEN** it saves
**THEN** every contributing entry gains a `processed_in` edge and the invoice becomes eligible for a disbursement batch

---

**GIVEN** an HR Admin who manages a sub-vendor engagement attempts to create its invoice
**WHEN** the attempt is made
**THEN** it is refused. Read access does not extend to creation

---

**GIVEN** a Manager attempts to view any invoice
**WHEN** the request is made
**THEN** it is structurally absent

---

## Non-Functional Requirements

- Draft generation resolves within 2 seconds for a contractor with up to 500 entries in the period
- The basis decomposition resolves within 200ms
- Generation, review, submission and approval function offline. Payment is [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s and requires connectivity
- `rate_used` never changes after generation

---

## Security Considerations

- **HR Admin holds Read, not Full, and this is deliberate.** Invoice review and approval sits with Finance Admin specifically. HR Admin retains visibility into the contractor relationship without gaining authority over the financial transaction — the same separation [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] applies more strictly to disbursement.
- **A contractor sees their own invoices and no other's**, per the self-service pattern.
- **The basis decomposition exposes a contractor's own timesheet detail to a reviewer**, which is correct — it is the invoice's justification — but it means a reviewer sees which projects a contractor worked on, at what cadence. Operationally necessary, and worth knowing it is a fuller picture than the amount alone.
- **`rate_used` is snapshotted for the same historical-accuracy reason** governing every other financial figure in this graph that must not silently change shape.

---

## Out of Scope

- **A project cost or margin rollup combining invoices and payslips** — permanently [[Vulto Accounts]]'
- **Multi-line-item invoices** — one amount, one description. A contractor with separate billable items submits separate invoices
- **A structured Deliverable model** — [[Vulto Projects]]'
- **Currency conversion of invoice amounts** — stated and paid in its own currency. Cross-currency comparison reuses [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]
- **Payment execution and tracking** — [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]

---

## Decisions Recorded

**Payment tracking moves to [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]].** The previous specification carried send, confirm and fail fields on Invoice directly, which duplicated what the disbursement layer owns and would have meant two places recording the same event. Invoice reaches Paid when its instruction confirms.

**The basis decomposition is added.** A reviewer approving a figure they cannot decompose is approving a number. One who can see the twelve days behind it is approving a fact, and this is the feature's entire claim over a standalone invoicing tool.

**Discrepancy flagging is added.** The previous flow gave a contractor who believed their draft wrong only two options: submit it anyway or contact someone outside the product. Neither is good, and the first produces an invoice that has to be rejected.

**Invoicing periods resolve through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** A period is the contractor's actual working days, not a calendar span, which matters for anyone on a non-standard pattern.

**The [[Vulto Pay]] dependency is removed**, replaced by [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s adapter, and the two open items it carried disappear with it.

---

## Related Notes

- [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] — the contractors and sub-vendors invoiced here
- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — the double-billing safeguard reused
- [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] — where payment actually happens
- [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] — which reads paid invoices as a cost component

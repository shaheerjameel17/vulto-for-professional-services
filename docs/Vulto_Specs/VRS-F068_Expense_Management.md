---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F068
---

# VRS-F068 — Expense Management

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (Document, for receipts), [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] (**the non-blocking warning pattern, reused rather than reinvented**), [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] (reimbursement, through the same adapter), [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] (where guideline and receipt thresholds are configured), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Expense, Standard, Tier 0)
**Blocks:** [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]], which reads reimbursed expenses as a cost component

This document is the single source of truth for this feature.

---

## The tier question, settled

[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] originally left Expense's tier open, guessing it would follow Employee's operational-versus-amount split — Tier 0 for routine fields, Tier 1 for the amount.

**Checking the permission matrix settles it outright.** Expense's row grants Manager `Read` on direct reports. A Finance-restricted, Tier 1 classification gives Manager `None` unconditionally, as RateCard, PayrollPolicy and Invoice all correctly receive. **A row granting Manager read access cannot coexist with a Tier 1 classification without contradicting itself.**

The honest resolution is not a split. **Expense is Standard, Tier 0, in full.** An amount spent on a client dinner is operational financial data, not compensation, and protecting it as though it were a salary would be the inverse mistake — and would make the approval workflow impossible for the person who actually performs it.

---

## Why this is not Expensify with a Roster login

A standalone expense tool has no idea what a project or a client is, so **it cannot distinguish an expense the agency absorbs from one that should pass straight through to the client who caused it.**

This feature can, because both already exist in this graph. A travel expense for a client site visit is flagged billable at the moment it is submitted — tracked as a fact this feature owns, recovered or not, without pretending to own client invoicing.

---

## What It Is

Expense submission, review, approval and reimbursement for any employee, with optional attribution to a project and, where relevant, an explicit flag marking it recoverable from the client that engagement serves.

---

## Problem It Solves

Two problems.

**The ordinary one:** expenses submitted by email get approved inconsistently, reimbursed late, and leave no record tied to the person or engagement that incurred them.

**The professional-services one:** an agency that does not track which expenses are client-billable *at the moment they happen* loses real recoverable revenue — discovered, if ever, in a manual review weeks later, by which point the client relationship has moved on and the money is gone.

---

## User-Facing Flows

### Submitting

Category, amount, currency, date, description, an optional receipt, and where it relates to an engagement, the project. If that project exists, the expense can be flagged billable to the client.

### A guideline, not a gate

An amount exceeding a configured per-category guideline produces a **non-blocking warning** to both submitter and reviewer — the identical *informed, not stopped* philosophy [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] establishes for leave, applied to a second domain rather than reinvented.

### A receipt, sometimes required

Above the configured threshold with no receipt attached, submission is refused. **This is the one hard rule this feature enforces** — a genuine compliance floor most agencies already hold themselves to.

### Review

A Finance Admin or Owner sees any warning plainly and approves or rejects. **A Manager sees their direct reports' expenses but cannot approve them**, which is the correct split: visibility for context, authority with finance.

### Reimbursement

Approval makes it eligible for [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s batch, alongside payroll and contractor invoices.

### Marking recovered

Once an agency has included a billable expense in whatever invoice it sends its client, a Finance Admin marks it billed. **This feature records that fact; it never generates the client's invoice**, which is outside Roster's scope.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| My expenses | Section in [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] | Submit and track |
| Expenses | Content + Panel | The review queue |
| Client-billable | Content | Recoverable, by status |

### Layout and components

**Submission** is a short form: category Toggle Group, amount and currency, date, description, receipt drop zone. The billable Switch appears **only once a project is selected**, since it is meaningless without one — a control that appears and then refuses is worse than one that appears when it applies.

A guideline warning renders as an Inline Alert in `attention` beneath the amount, stating both figures — *Meals guideline is 40; this is 65* — as the amount is typed rather than on submission.

**The review queue** is a Table: submitter, category, amount, date, project, billable indicator, warning indicator, days pending. Sorted by days pending descending.

**Client-billable** is the screen that recovers money. A Table of billable expenses grouped by client, filtered to Pending by default, with an aggregate per client stated at the group header.

That aggregate is the exception to this product's general reluctance to sum financial figures, and it is justified: **an agency needs to know it is owed 1,240 by a specific client before it sends that client an invoice**, and a list of eleven separate lines is a list somebody adds up by hand or does not.

A **Mark billed** action works across a selection, since a client's recoverable expenses are invoiced together.

### Keyboard

`N` submits a new expense. Standard list bindings elsewhere.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Standard, Tier 0. Manager reads direct reports; approval is Finance Admin and Owner |
| Warned | Inline Alert, non-blocking |
| Blocked | Missing receipt above threshold, refused at submission with the threshold stated |
| Empty | *No expenses submitted.* |
| Error | Billable without a project is refused before the write |

### Responsive

Submission works at 375px — an expense is most often logged on a phone, holding the receipt.

---

## Technical Architecture

### The Expense schema

Standard, Tier 0, per the resolution above.

```
expense_id:            UUID v4
workspace_id:          UUID
employee_id:           UUID, FK to Employee — a direct field
project_id:            UUID, nullable
category:              enum: Travel, Meals, Accommodation, Software,
                       OfficeSupplies, Other
amount:                decimal
currency:              ISO 4217 — defaults from the employee's entity
expense_date:          date — when incurred, distinct from submission
description:           text, required
receipt_document_id:   UUID, nullable, FK to Document
is_billable_to_client: boolean, default false — requires project_id
client_billing_status: enum: NotApplicable, Pending, Billed
status:                enum: Draft, Submitted, Approved, Rejected,
                       Reimbursed, Voided
submitted_at:          timestamp, nullable
reviewed_by / reviewed_at: user_id / timestamp, nullable
rejection_reason:      text, nullable, required when Rejected

— Universal Node Conventions per VPS-A002 —
```

**Reimbursement tracking lives on [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s instruction**, not here — the same correction [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] carries, for the same reason.

### The guideline mechanism, reused

Configured in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]. An amount exceeding its category's guideline produces a warning in the response — **exactly the shape [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] establishes** for insufficient balance, notice violations and blackout conflicts. No second warning mechanism.

### The one hard rule

An amount above the configured threshold with no receipt is **rejected before reaching the local store** — the same discipline [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] applies to its daily hours cap.

### Client-billable tracking

Setting billable without a project is rejected outright: recoverability is meaningless without a project, and by extension a client, to attribute it to.

**This feature never produces the client-facing invoice.** The status is a tracked fact, set manually once that external step has genuinely happened — the same honest boundary [[VRS-F062_Payroll_Engine_Core|VRS-F062]] and [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] draw around margin and client billing.

### A receipt is an ordinary document

Tier 0, filed through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] with no provenance elevation. A restaurant receipt is not a sensitive record.

### API contracts

```
expense.submit(employeeId, category, amount, currency, expenseDate,
               description, receiptDocumentId?, projectId?, isBillable?)
  -> { expenseId, warnings: { guidelineExceeded?: { guideline, submitted } } }
  // Refused before any write where the amount exceeds the receipt threshold
  // with no receipt, or where billable is set with no project

expense.approve(expenseId)          -> { success }
expense.reject(expenseId, reason)   -> { success }
expense.withdraw(expenseId)         -> { success }

expense.markBilled(expenseIds)      -> { marked }
  // Finance Admin or Owner. Operates across a selection, since a client's
  // recoverable expenses are invoiced together

expense.listForEmployee(employeeId) -> Expense[]
expense.listPendingReview(workspaceId) -> Expense[]
expense.listBillableByClient(workspaceId, status?) -> {
  clientId, clientName, expenses: Expense[], aggregateAmount, currency
}[]
  // Aggregated per client deliberately, per the reasoning above
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Expense carries the schema above. `incurred_by` and `attributed_to` connect it to Employee and Project |
| G02 | Expense is Standard, Tier 0, in full, resolved against the existing Manager Read row rather than assumed |
| G03 | Billable may only be set with a project. A write attempting otherwise is rejected before the local store |
| G04 | Client billing status is a tracked fact. No code path generates or transmits a client-facing invoice |
| G05 | A guideline warning never blocks. The receipt rule above threshold is the single blocking validation |
| G06 | Reimbursement tracking lives on [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s instruction. Expense reaches Reimbursed when its instruction confirms |
| G07 | The per-client aggregate is the one summed financial figure this feature computes, and is scoped to recoverable expenses only |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F068-S01 | Expense schema and submission | Data |
| VRS-F068-S02 | Guideline warning and receipt validation | Logic |
| VRS-F068-S03 | Review and approval | Logic |
| VRS-F068-S04 | Client-billable tracking and recovery | UI |

---

## Feature Acceptance Criteria

**GIVEN** a Meals guideline of 40 and a submission of 65
**WHEN** it is processed
**THEN** it succeeds, the warning is returned with both figures, and nothing is blocked

---

**GIVEN** a receipt threshold of 100 and a submission of 150 with no receipt
**WHEN** it is attempted
**THEN** it is rejected before reaching the local store, with the threshold stated

---

**GIVEN** billable is set with no project
**WHEN** submission is attempted
**THEN** it is rejected, since recoverability requires a project to attribute to

---

**GIVEN** a billable expense attributed to a project is approved
**WHEN** it saves
**THEN** client billing status becomes Pending and remains so until explicitly marked billed

---

**GIVEN** a client has eleven pending billable expenses
**WHEN** the client-billable screen renders
**THEN** they are grouped under that client with the aggregate stated at the header, so the recoverable total is visible without manual addition

---

**GIVEN** a Manager views a direct report's expense
**WHEN** it renders
**THEN** they can read it, and no approve or reject action is available

---

**GIVEN** an approved expense
**WHEN** a disbursement batch is created
**THEN** it appears alongside payroll and contractor instructions in [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s batch

---

## Non-Functional Requirements

- Submission validation completes within 200ms
- The client-billable aggregate resolves within 300ms
- Submission, review and approval function offline. Reimbursement is [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s
- Client billing status never transitions to Billed except through an explicit action

---

## Security Considerations

- **The tier resolution is the substantive decision.** Leaving Expense at Tier 0 rather than introducing a split nobody's permission row supported avoids over-protecting operational data — the same class of mistake, caught the same way, by checking an anchored row rather than assuming a pattern must repeat.
- **A Manager reads but cannot approve.** Visibility for context, authority with finance. A manager who could approve their own report's expenses would hold a spending authority nobody granted them.
- **Client billing status carries real business consequence if mishandled.** A Finance Admin marking something billed that was never invoiced misstates recoverable revenue. This feature records the deliberate assertion and does not verify the external fact.
- **A receipt image can disclose more than its amount** — a location, a companion, a dietary preference. It is Tier 0 and visible on the same terms as the expense, which is correct, and worth an approver knowing they are looking at something incidental as well as financial.

---

## Out of Scope

- **Generating or transmitting the client invoice for a billable expense** — [[Vulto Accounts]]' eventual territory
- **A workspace-wide recoverable-revenue total across all clients** — the per-client aggregate exists because an agency invoices per client. A single blended figure would be a revenue claim this feature has no basis for
- **Corporate card integration or transaction import** — manual submission
- **Mileage rates or per-diem automation** — the amount is entered directly
- **Multi-currency reimbursement conversion** — stated and reimbursed in its own currency, per [[VRS-F067_Contractor_Invoice_Management|VRS-F067]]'s boundary
- **Recurring expenses** — each is a discrete submission

---

## Decisions Recorded

**Expense's tier is resolved to Standard, Tier 0, in full**, closing the open item [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] carried. The existing Manager Read row is what settles it: a Tier 1 classification would contradict a permission this product already granted deliberately.

**The per-client aggregate is added**, and it is the one summed financial figure this feature computes. An agency needs to know it is owed a specific amount by a specific client before invoicing them, and a list of eleven lines is one somebody adds up by hand or does not — which is precisely how recoverable revenue is lost.

**Mark billed operates across a selection.** A client's recoverable expenses are invoiced together, and marking them one at a time is where the process stops being followed.

**The billable Switch appears only once a project is selected.** A control that appears and then refuses is worse than one that appears when it applies.

**Reimbursement tracking moves to [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]**, matching [[VRS-F067_Contractor_Invoice_Management|VRS-F067]]. Three features recording the same payment event in three places would have meant three integrations to write and three chances to disagree.

---

## Related Notes

- [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] — the warning pattern reused here
- [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] — where reimbursement happens
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where receipts are filed
- [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] — which reads reimbursed expenses as a cost component

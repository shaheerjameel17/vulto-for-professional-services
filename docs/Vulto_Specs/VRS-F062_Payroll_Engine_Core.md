---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F062
---

# VRS-F062 — Payroll Engine Core

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee's Tier 1 compensation fields), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity and its default currency), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (**working days — every proration in this feature resolves there**), [[VRS-F006_Rate_Card_Engine|VRS-F006]] (`effective_billing_rate`), [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] (time classification), [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (TimesheetEntry), [[VRS-F018_Leave_Policy_Engine|VRS-F018]] (leave policy and encashability), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (Departure, the final settlement trigger), [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] (**compensation changes, the input this feature previously assumed existed**), [[VRS-F043_Contractor_and_Sub-Vendor_Management|VRS-F043]] (the contractor exclusion boundary), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 1 encryption and time-period partitioning)
**Blocks:** [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] (which supersedes this feature's placeholder deductions), [[VRS-F064_Multi-Currency_Payroll|VRS-F064]], [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]], [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]], [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]]

This document is the single source of truth for this feature.

---

## Why this is not Gusto with a different logo

Every payroll product on the market does one job: turn compensation data into a correct payment and a compliant filing. That job is necessary and this feature does it.

But none of them has ever seen a timesheet, a rate card or a bench day. **Vulto Roster has all three, for every employee, live, in the same graph this feature reads from.** Building a payroll engine that ignores that would be building a worse version of something that already exists everywhere.

Four things a standalone payroll product structurally cannot do:

**Revenue in context.** Every payslip shows not only what someone was paid but what they billed, from the same rate resolution and time classification already enforced elsewhere. A founder reviewing a run sees cost and revenue side by side, per person, without opening a second tool.

**Bench days in context.** The same payslip shows how many days in the period this person held no covering assignment, reusing [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s own computation. Paid, billed, benched — three numbers, one screen.

**Multi-entity runs.** A run is scoped to exactly one entity. An agency with Pakistani, UK and US entities runs three payrolls for the same calendar period, each resolving its own policy and currency, rather than one blended run that was never honestly one payroll.

**Departure-aware final settlement.** An employee offboarded mid-period gets a correctly prorated final payslip with encashable leave paid out automatically, closing the loop [[VRS-F018_Leave_Policy_Engine|VRS-F018]] leaves open.

**None of these required a new privacy category, a new tier or a new architectural decision.** Every one is existing, already-classified data read a second time for a second purpose. That is the actual differentiator: not more features — the same graph, asked one more honest question.

---

## What It Is

A payroll calculation and preview engine, scoped per legal entity, turning compensation data, timesheet hours, approved leave and assignment billing into a previewable, adjustable, lockable run: one payslip per qualifying employee, each showing what they were paid, what they billed, and how much of the period they spent on the bench.

---

## Problem It Solves

Two problems.

**The ordinary one:** an agency needs an accurate, auditable way to calculate what it owes its people, currently nowhere in this graph.

**The professional services one:** a founder running payroll gets a number telling them what they spent, with no honest way — inside the same action — to see what that spend produced. Bench alerts tell them who is idle. Utilization tells them who is billable. **Neither sits next to the pay figure at the moment it is calculated**, which is exactly when a founder is already looking at cost.

---

## User-Facing Flows

### Creating a run

A Finance Admin or Owner selects an entity and a period. Nothing is calculated yet — an empty container at Draft.

### Generating the preview

Every qualifying employee scoped to that entity gets a payslip: base pay resolved from their compensation, any bonus entered, unpaid leave deducted automatically, deductions applied per policy, and alongside all of it the revenue they billed and the days they spent benched — **computed independently and never mixed into the pay figures.**

Qualifying means: real employees never Ghosts, full-time or part-time or intern never contractors, and either active or inactive with an end date inside this period.

### Reviewing and adjusting

Line by line. A bonus entered or adjusted with a note. A deduction added, removed or overridden. Every adjustment recomputes gross and net immediately.

### Finalizing

Locks every payslip, writes an edge from every contributing timesheet entry so the same hours can never be counted twice, and produces this feature's terminal state.

What happens after — an approval gate, actual disbursement — belongs to [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] and [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]].

### A final settlement, without anyone remembering it

When an offboarded employee's last working day falls inside a period, their payslip generates automatically as part of the ordinary preview. **No separate flow, no separate screen.** Base pay prorated to days actually worked; encashable leave paid out in the same payslip.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Pay runs | Content + Panel | The list, per entity |
| Run preview | Content, full width | Every payslip, line by line |
| Payslip detail | Panel | One person, adjustable |

### Layout and components

**Run preview** is the surface that matters, and it is a Table exempt from the content maximum: employee, base pay, bonus, deductions, net — and then, separated by a 2px `border-strong` vertical rule, **billed** and **bench days**.

The rule is the important detail. Everything left of it is money leaving the business; everything right of it is context. **They are never summed, never netted, and never adjacent without separation**, because a reader glancing at a row must not come away thinking the two halves relate arithmetically.

Column totals sit in a sticky footer in `mono-lg`: total gross, total net, and — separated by the same rule — total revenue generated.

A row whose payslip is a final settlement carries a `attention` Badge. A row skipped for missing compensation data appears in a distinct section beneath, **never silently omitted** — an employee absent from a payroll run because nobody noticed their record was incomplete is the worst failure this screen can produce.

**Finalize is the only `primary` action**, and it opens a Modal stating the totals and the payslip count. This is one of the few genuinely irreversible operations in the product and the confirmation says so.

### Keyboard

`J`/`K` move between payslips, `Enter` opens the detail Panel, `Cmd+Enter` saves an adjustment.

### System states

| State | Treatment |
|---|---|
| Syncing | Preview renders from local state |
| Restricted | Structurally absent for Manager and Team Member. An employee sees their own payslip through [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]], never the run |
| Aged out | Runs outside [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 window render dashed with **Fetch** |
| Pending confirmation | Finalize offline shows a pending state, never completion |
| Empty | *No qualifying employees for this entity and period.* |
| Error | A currency mismatch is flagged at generation, never silently converted |

### Responsive

Desktop only below 1280px, and it says so. Payroll is not reviewed on a phone.

---

## Technical Architecture

### PayRun

Finance-restricted, Tier 1.

```
pay_run_id:              UUID v4
workspace_id:            UUID
entity_id:               UUID, FK to Entity, required — every run is scoped to
                         exactly one legal entity
pay_period_start / end:  date
pay_date:                date — the intended disbursement date
currency:                ISO 4217 — resolved from the entity at creation
payroll_policy_id:       UUID, FK to PayrollPolicy
tax_config_id:           UUID, nullable — resolved by VRS-F063 where one exists
status:                  enum: Draft, Previewed, Finalized, Voided
total_gross:             decimal, nullable — cached at finalize
total_net:               decimal, nullable
total_employer_cost:     decimal, nullable — gross plus employer statutory cost
                         per VRS-F063. The true cost of employing this workforce
total_revenue_generated: decimal, nullable — informational, never part of any
                         pay calculation
finalized_at / by:       timestamp / user_id, nullable
void_reason:             text, nullable, required when Voided

— Universal Node Conventions per VPS-A002 —
```

### PaySlip

Self and Finance-restricted, Tier 1.

```
payslip_id:              UUID v4
workspace_id:            UUID
pay_run_id:              UUID, direct field
employee_id:             UUID, direct field
compensation_frequency:  enum — snapshotted at calculation, never re-resolved
hours_based:             boolean
hours_worked:            decimal, nullable — every logged hour regardless of
                         category. All logged time is paid time
base_pay_amount:         decimal — prorated for a final settlement
bonus_amount:            decimal, default 0
bonus_note:              text, nullable
unpaid_leave_days:       decimal, default 0 — computed from approved unpaid
                         leave overlapping the period. Never entered manually
unpaid_leave_deduction:  decimal, default 0
is_final_settlement:     boolean, default false
leave_encashment_amount: decimal, default 0
deductions:              JSON array of { label, amount, source: TaxConfig |
                         PayrollPolicy | Manual }
employer_statutory_cost: decimal, default 0 — per VRS-F063. Never subtracted
                         from gross or net, since it was never the employee's
                         money, but a real additional cost of employing them
gross_pay:               computed = base + bonus + encashment − unpaid deduction
net_pay:                 computed = gross − sum(deductions)
revenue_generated:       computed, never entered — Billable hours only
bench_days_in_period:    integer, computed — reuses VRS-F005's computation
status:                  enum, mirrors the parent run

— Universal Node Conventions per VPS-A002 —
```

### PayrollPolicy

```
payroll_policy_id:   UUID v4
workspace_id:        UUID
entity_id:           UUID, nullable — null applies as the workspace default
pay_frequency:       enum: Weekly, Biweekly, Semimonthly, Monthly
standard_deductions: JSON array of { label, calculation: FixedAmount |
                     PercentageOfGross, value } — non-statutory, discretionary
                     deductions only. Statutory belongs to VRS-F063
referral_bonus_amount: decimal, nullable — per VRS-F034
version / supersedes_id / is_active

— Universal Node Conventions per VPS-A002 —
```

### Resolving base pay

**Salaried:** the annual or monthly figure divided by periods per year implied by the policy's frequency, scaled by however many this run covers.

**Hourly:** every logged hour in the period regardless of category, multiplied by the compensation amount.

**Final settlement:** additionally prorated by actual working days from period start to last working date against the full period's working day count — **resolved entirely through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]**.

That last point is where the previous specification would have paid people incorrectly. It prorated against a weekend-and-holiday exclusion computed locally, which is wrong for a six-day week, wrong for a compressed pattern, and wrong for any period containing a moon-sighted holiday. A final settlement is the single payment most likely to be disputed, and it was the one most likely to be wrong.

### Compensation changes

`base_compensation_amount` is read as of the pay period, respecting any [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] change applied within it.

**A change effective mid-period is prorated across the two rates**, counted in working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. The previous specification assumed promotion-driven changes existed as an input and nothing wrote them; that feature now does, and this one consumes it rather than requiring a manual adjustment for every raise.

### Revenue in context

Sums, across every Billable entry logged in the period, hours times the linked assignment's `effective_billing_rate`. Bench days reuse [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s computation over the same range.

**Neither is stored elsewhere. Both are computed fresh at every preview.**

### Why revenue generated is not project margin

True margin requires cost of goods, overhead, and actual invoiced-and-collected amounts — none of which this graph owns. Building a shadow version would either mislead or quietly duplicate [[Vulto Accounts]] before it exists.

This is a per-employee, per-period figure. **It never claims to be a margin and this feature computes none.**

### Preventing double-counted hours

On finalize, every contributing entry gains a `processed_in` edge. A later run excludes any entry already carrying one to a different finalized run.

### Voiding

Voiding a finalized run **releases every `processed_in` edge it wrote**, so a corrected run can be calculated from scratch. Without this, voiding a run would permanently orphan its hours.

### Finalize requires server confirmation

Two Finance Admins finalizing the same run from different offline devices is the same race [[VRS-F007_Ghost_Resources|VRS-F007]] solves for Ghost promotion, with the same consequence: silent double-processing of a one-time financial action.

The first request received succeeds; any subsequent attempt is rejected outright. **Offline, the caller is shown pending confirmation, never completion.**

### API contracts

```
payrollPolicy.create(entityId?, payFrequency, standardDeductions) -> { policyId }
payrollPolicy.update(policyId, fields) -> { newPolicyId }
  // Creates a superseding version

payRun.create(entityId, periodStart, periodEnd, payDate) -> { payRunId }
payRun.generatePreview(payRunId) -> {
  paySlipsGenerated, skipped: { employeeId, reason }[]
}
  // An employee with no compensation on record is skipped with a flagged
  // reason, never given a silent zero payslip

paySlip.adjust(paySlipId, { bonusAmount?, bonusNote?, deductions? })
  -> { grossPay, netPay }
payRun.finalize(payRunId) -> { status: 'finalized' | 'pending_confirmation' }
payRun.void(payRunId, reason) -> { success, edgesReleased }
payRun.get(payRunId) -> PayRun & { paySlips: PaySlip[] }
paySlip.listForEmployee(employeeId) -> PaySlip[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | The three node types carry the schemas above |
| G02 | A run is scoped to exactly one entity. A multi-entity workspace requires one run per entity per period |
| G03 | Qualifying employees exclude Ghosts and contractors unconditionally |
| G04 | `revenue_generated` counts Billable hours only and is never a component of gross or net pay, and never presented as margin |
| G05 | `hours_worked` includes every category; `revenue_generated` counts Billable only. Deliberately different sums over the same data |
| G06 | `bench_days_in_period` reuses [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s computation. Not a second implementation |
| G07 | Every proration counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. No local weekend or holiday assumption exists in this feature |
| G08 | A compensation change effective mid-period is prorated across both rates in working days |
| G09 | On finalize, contributing entries gain a `processed_in` edge. A later run excludes entries already carrying one to a finalized run |
| G10 | Voiding a finalized run releases every `processed_in` edge it wrote |
| G11 | Finalize is server-confirmed. The first request succeeds; subsequent attempts are rejected outright |
| G12 | A currency mismatch between an employee's compensation currency and the run's is flagged, never silently converted |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F062-S01 | PayRun, PaySlip and PayrollPolicy schema | Data |
| VRS-F062-S02 | Entity-scoped creation and qualification | Logic |
| VRS-F062-S03 | Calculation engine | Logic |
| VRS-F062-S04 | Revenue and bench context | Logic |
| VRS-F062-S05 | Final settlement and encashment | Logic |
| VRS-F062-S06 | Preview, adjustment and server-confirmed finalize | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a workspace with employees across two entities
**WHEN** a run is created for one
**THEN** only that entity's employees are eligible, and a separate run is required for the other

---

**GIVEN** an employee logged 30 Billable hours against an assignment at 50 per hour
**WHEN** the preview generates
**THEN** `revenue_generated` is 1500, computed independently, and never contributes to their pay

---

**GIVEN** the same employee logged 5 non-billable hours and had 2 uncovered days
**WHEN** the preview generates
**THEN** `hours_worked` includes the 5, bench days reflects the 2, and neither alters `revenue_generated`

---

**GIVEN** an employee has 2 days of approved unpaid leave in the period
**WHEN** the preview generates
**THEN** the deduction reduces gross pay with no manual entry

---

**GIVEN** an employee's last working date falls in the period and their policy marks annual leave encashable
**WHEN** the run generates
**THEN** their payslip is marked final settlement, base pay is prorated by **working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]**, and encashment reflects their remaining balance

---

**GIVEN** a UAE entity whose weekend is Friday and Saturday
**WHEN** a final settlement is prorated
**THEN** the working day count excludes those days, and no Saturday-Sunday assumption appears anywhere

---

**GIVEN** a compensation change effective mid-period under [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]
**WHEN** the preview generates
**THEN** base pay is prorated across both rates in working days, with no manual adjustment

---

**GIVEN** a contractor scoped to the same entity
**WHEN** the run generates
**THEN** they never appear in the qualifying set

---

**GIVEN** a qualifying employee has no compensation on record
**WHEN** the preview generates
**THEN** they are skipped with a flagged reason, shown in the interface, and no zero payslip is created

---

**GIVEN** two Finance Admins finalize the same run from different offline devices
**WHEN** both reconnect
**THEN** exactly one succeeds and the other is rejected with an already-finalized message

---

**GIVEN** a finalized run is voided
**WHEN** the void completes
**THEN** every `processed_in` edge is released and the underlying hours are available to a corrected run

---

**GIVEN** a Manager attempts to view any run or payslip
**WHEN** the request is made
**THEN** it is structurally absent

---

## Non-Functional Requirements

- Preview generation completes within 5 seconds for up to 150 qualifying employees
- Revenue and bench figures are recomputed fresh on every preview, never cached between runs until finalize
- Creation, preview and adjustment function offline. Finalize is the deliberate exception, requiring server confirmation
- Runs inherit [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 time-period partitioning: one document per pay cycle

---

## Security Considerations

- **PayRun and PaySlip's Tier 1 treatment is not a new decision.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] named them explicitly, alongside wellness data and salary fields, as receiving true end-to-end encryption from the start. This is where that scope is realised.
- **Manager is None on PayRun, not Read.** A run is a batch container with no single owning employee. An employee reads their own payslip through [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]], which is the actually person-scoped record.
- **Revenue and bench figures are Tier 0-sourced data stored inside a Tier 1 document** — a safe one-way combination. Tier 0 data inherits stronger protection by living inside a Tier 1 node; nothing is loosened.
- **This feature performs no cross-pattern reasoning.** Both context figures are computed from raw structured records, the same category [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] and [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] established stays outside Standing Rule 7.
- **A final settlement is the single most disputed payment an agency makes.** It is prorated, it pays out a balance, and it happens when the relationship is already ending. Getting the working day count right is not a technicality — it is the difference between a clean departure and a claim.

---

## Out of Scope

- **Jurisdiction-specific tax computation** — [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] supersedes the placeholder deductions entirely
- **An approval gate before finalize** — [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]]
- **Actual fund disbursement** — [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]
- **Contractor payment** — [[VRS-F067_Contractor_Invoice_Management|VRS-F067]]. Contractors are structurally excluded here
- **Project margin or any per-project rollup** — permanently [[Vulto Accounts]]'
- **Currency conversion where an employee's currency differs from the run's** — flagged, never silently converted. [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]
- **A cost dashboard or trend across runs** — [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]]
- **Benefits administration or expense reimbursement through payroll** — [[VRS-F068_Expense_Management|VRS-F068]] owns expenses separately

---

## Decisions Recorded

**Every proration resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** The previous specification computed working days with a local weekend-and-holiday exclusion, which is wrong for a six-day week, wrong for a compressed pattern, and wrong for a moon-sighted holiday. A final settlement is the payment most likely to be disputed and was the one most likely to be wrong.

**Compensation changes are consumed from [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] and prorated across a mid-period effective date.** The previous specification assumed this input existed and nothing wrote it, which meant every raise was a manual payroll adjustment somebody had to remember.

**[[Vulto Pay]] is removed entirely.** Disbursement runs through [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s provider-agnostic adapter, whose default path requires no third-party service. This feature's responsibility ends at a finalized run regardless.

**The preview separates cost from context with a visual rule.** Everything left of it is money leaving the business; everything right is context. A reader glancing at a row must not come away thinking the two halves relate arithmetically.

**Skipped employees are shown, not omitted.** An employee absent from a payroll run because nobody noticed their record was incomplete is the worst failure this screen can produce.

**Voiding releases `processed_in` edges.** Without it, voiding a run would permanently orphan its hours — a gap invisible until [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]]'s rejection path gave it something to expose.

---

## Related Notes

- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days every proration resolves through
- [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] — the compensation changes this feature consumes
- [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] — which supersedes the placeholder deductions
- [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] — disbursement, replacing the former [[Vulto Pay]] dependency

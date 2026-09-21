---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F069
---

# VRS-F069 — Payroll and HR Cost Dashboard

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] (accumulated bench cost, read and summed, never recomputed), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (PayRun totals and per-payslip revenue), [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] (**true employer cost, without which this feature understates**), [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] (currency normalization, called directly), [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] (approval status), [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] (disbursement status), [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] and [[VRS-F068_Expense_Management|VRS-F068]] (contractor and expense cost)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Checked against [[VRS-F058_People_Analytics_Dashboard|VRS-F058]], not assumed distinct

*Dashboard* is exactly the word that makes two features worth checking against each other before either is built on faith.

[[VRS-F058_People_Analytics_Dashboard|VRS-F058]] reads utilization history and employee dates to show whether the **shape** of the workforce is trending. This feature reads payroll, invoices, expenses and bench alerts to show what that workforce **costs**, and where every entity's payroll stands in its execution lifecycle.

One is a people-strategy lens; the other a finance-operations lens. **Neither reads the other's underlying data at any point.**

---

## Why this is the first place three numbers sit together

Every financial feature since [[VRS-F062_Payroll_Engine_Core|VRS-F062]] has been building toward this and carefully refusing to finish the thought.

That feature computed revenue per person per period and declined to sum it. [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] and [[VRS-F068_Expense_Management|VRS-F068]] both deferred cross-currency comparison to whichever feature actually needed one.

**This is that feature.** For the first time a founder sees, in one currency, workspace-wide: what the whole team cost this period — employees, contractors and reimbursed expenses together; what that same team billed; and how much of the cost was time nobody could bill at all.

**Three numbers, never combined into a claimed margin**, since margin needs overhead and invoiced-and-collected revenue this graph will never own. Placed next to each other honestly for the first time anywhere in this product.

---

## What It Is

A workspace-wide, currency-normalized financial view over three computed sources: total headcount cost, bench cost, and a live payroll run status board showing every entity's position in the finalize-approve-disburse lifecycle.

---

## Problem It Solves

An Owner today opens every entity's payroll individually, adds contractor invoices separately, checks reimbursements in a third place, and **has no figure at all for what unbillable bench time cost this quarter.**

None of that data is missing. It is scattered exactly as many careful, well-scoped features left it — correctly, since none of them was the right place to combine it.

---

## User-Facing Flows

### The cost summary

A date range, and: total headcount cost broken into payroll, contractor and expense components; total revenue generated; total bench cost. All normalized into one currency using [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]'s mechanism directly.

### The trend

The same three figures plotted across months or quarters, **so a founder sees whether the gap between what the team costs and what it bills is closing or widening** — without this feature ever naming that gap a margin.

### The payroll run status board

Grouped by entity: every run, its status, its approval status, and a disbursement summary. **So a Finance Admin sees at a glance which of three entities' payrolls are still in Draft the week before payday**, without opening each.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Cost dashboard | Content | Summary and trend |
| Payroll status board | Content | Lifecycle position |

### Layout and components

**The summary** leads with three Stats side by side, deliberately equal in visual weight: **cost**, **revenue**, **bench cost**. Equal weight because ranking them would imply a relationship between them that this feature explicitly declines to assert.

Beneath cost, its three components as a horizontal stacked bar — payroll, contractor, expense — each labeled with its figure. The proportion is frequently the surprising part: an agency that thinks of itself as employing twenty people and discovers a third of its people cost is contractors has learned something.

**Bench cost renders in `attention`** — the only colored figure on the screen — because it is the one number here that represents money the business did not have to spend.

The trend is a line chart with three lines. **No fourth line showing the difference**, and no shaded area between cost and revenue. Either would be a margin claim by implication, and the whole discipline of this cluster is not making one.

Every figure states its currency and the rate date beneath, per [[VRS-F064_Multi-Currency_Payroll|VRS-F064]].

**The status board** is grouped by entity, one row per run: period, status Badge, approval Badge, and a compact disbursement bar showing confirmed against total. A run in Draft within a week of its pay date renders `attention` — the single most useful alert this screen can produce, and the reason a Finance Admin opens it.

### Keyboard

`[` and `]` shift the range.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner, HR Admin and Finance Admin. Structurally absent for Manager and Team Member |
| Unnormalized | A component with an unresolvable rate is excluded and stated, never converted at a guess |
| Empty | *No finalized payroll in this range.* |
| Error | Not applicable |

### Responsive

Stats stack below 1280px. The status board becomes a per-entity list.

---

## Technical Architecture

### No new node type

Every figure is computed live from PayRun, PaySlip, Invoice, Expense, RevenueGapAlert and ApprovalStage — the culmination of a pattern this project has used since the Bench Forecast.

### Total headcount cost

**Payroll cost sums `total_employer_cost`, not gross.** Gross omits the employer's own statutory contribution, which [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] makes computable and which is a real, additional cost of employing someone. Where no tax configuration exists for a jurisdiction, employer cost equals gross exactly, so this changes nothing for a workspace that has not configured one.

Contractor cost sums paid invoices. Expense cost sums reimbursed expenses. Each converted through [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]'s resolution, called directly.

### Revenue and bench cost, summed, never blended

Revenue sums per-payslip figures across finalized runs. Bench cost sums accumulated cost across bench alerts whose period falls in range, **read directly and never recomputed.**

Both returned alongside cost in the same response, **never added to or subtracted from it.**

### No disclosure threshold, and why

Every role permitted here already holds direct individual access to every record this feature aggregates. Unlike a sentiment or hiring aggregate, which protects a viewer who could not otherwise see the underlying data, **an aggregate here reveals nothing a permitted viewer could not see by opening each record one at a time.**

No minimum sample size is meaningful in this context, and applying one would be cargo-culting a protection that protects nobody.

### The status board

Groups runs by entity, reading status, approval status and a disbursement summary — the last computed the same way [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] computes its own, reused rather than reimplemented.

### API contracts

```
hrCostDashboard.getCostSummary(workspaceId, startDate, endDate,
                               reportingCurrency?) -> {
  totalHeadcountCost, payrollCost, contractorCost, expenseCost,
  totalRevenueGenerated, totalBenchCost,
  currency, rateDate,
  excludedUnresolvable?: { component, reason }[]
}

hrCostDashboard.getCostTrend(workspaceId, startDate, endDate,
                             granularity, reportingCurrency?) -> {
  periods: { label, headcountCost, revenueGenerated, benchCost }[]
}

hrCostDashboard.getPayRunStatusBoard(workspaceId) -> {
  entities: { entityId, entityName, payRuns: {
    payRunId, payPeriodStart, payPeriodEnd, payDate,
    status, approvalStatus, isAtRisk,
    disbursement: { confirmed, total }
  }[] }[]
}
  // isAtRisk where a run remains in Draft within a week of its pay date
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type. Every figure is computed live |
| G02 | Payroll cost sums `total_employer_cost`, never gross and never net |
| G03 | Revenue and bench cost are returned alongside headcount cost, never combined into it or presented as a margin |
| G04 | Every conversion calls [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]'s resolution. No second mechanism |
| G05 | A component with an unresolvable rate is excluded and reported, never converted at a default |
| G06 | No disclosure threshold applies. Every permitted viewer already holds individual access to the underlying records |
| G07 | The disbursement summary reuses [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s computation shape |
| G08 | Only finalized runs, paid invoices and reimbursed expenses contribute. Nothing in progress is counted |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F069-S01 | Cost aggregation across three components | Logic |
| VRS-F069-S02 | Revenue and bench cost aggregation | Logic |
| VRS-F069-S03 | Cost trend | UI |
| VRS-F069-S04 | Payroll run status board | UI |

---

## Feature Acceptance Criteria

**GIVEN** two finalized runs this quarter in different currencies, three paid invoices and four reimbursed expenses
**WHEN** the summary is requested with no reporting currency specified
**THEN** every component is normalized into the workspace primary currency, and total cost reflects all three together

---

**GIVEN** those runs carry employer statutory contributions
**WHEN** payroll cost is computed
**THEN** it sums employer cost rather than gross, so the figure reflects the true cost of employing the workforce

---

**GIVEN** the same range includes 45,000 in generated revenue and 3,200 in bench cost
**WHEN** the summary is requested
**THEN** both are returned alongside total cost, never added to or subtracted from it, and no margin figure appears anywhere in the response

---

**GIVEN** a bench alert resolved partway through the range
**WHEN** bench cost is computed
**THEN** its accumulated cost is included, read directly from the resolved record and never recomputed

---

**GIVEN** a component's currency pair has no resolvable rate
**WHEN** the summary computes
**THEN** it is excluded and reported, and no figure is converted at a default rate

---

**GIVEN** three entities each have a run at a different stage
**WHEN** the status board is requested
**THEN** all three appear grouped by entity with their own status, approval status and disbursement summary

---

**GIVEN** an entity's run is still in Draft four days before its pay date
**WHEN** the board renders
**THEN** it renders `attention` as at risk

---

**GIVEN** a Manager attempts to call any function here
**WHEN** the request is made
**THEN** it is structurally absent

---

## Non-Functional Requirements

- Summary and status board resolve within 1 second for 150 employees across five entities
- Full functionality offline. Conversion resolves against locally synced rate data
- No figure is computed from a partial or in-progress run

---

## Security Considerations

- **This performs no cross-pattern reasoning and requires no Standing Rule 7 review.** Every figure is a direct sum over structured financial records.
- **Access is enforced at the application layer**, since this feature introduces no node type for a permission row to describe — the same shape [[VRS-F051_Team_Capacity_Planner|VRS-F051]], [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] and [[VRS-F056_Proactive_Daily_Briefing|VRS-F056]] use for the same structural reason.
- **The deliberate absence of a margin figure is this document's most important decision, not an oversight.** Every financial feature drew that boundary independently. This feature, sitting where all their data converges, is **the one place it would be easiest to quietly cross**, and it does not.
- **The three Stats carry equal visual weight** for the same reason. Ranking them, or placing cost above revenue, would imply a relationship this feature declines to assert.

---

## Out of Scope

- **Any margin, profitability or per-project rollup** — permanently [[Vulto Accounts]]'
- **Industry benchmark comparison** — [[VRS-F072_Agency_Benchmarking|VRS-F072]], a different data source entirely
- **Per-team or per-manager cost breakdowns** — workspace-wide by definition
- **Forecasting future cost** — [[VRS-F051_Team_Capacity_Planner|VRS-F051]] operates on a different question
- **Any read of [[VRS-F058_People_Analytics_Dashboard|VRS-F058]]'s data** — deliberately absent. The two share no dependency in either direction

---

## Decisions Recorded

**Payroll cost sums employer cost rather than gross.** The previous specification summed gross, reasoning that gross reflects the cost of employing someone since net is only the employee's share. That reasoning was incomplete rather than wrong — gross still omits the employer's own statutory contribution, which [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] makes computable and which is a real cost.

**The trend chart has three lines and no fourth showing the difference.** A difference line, or a shaded area between cost and revenue, would be a margin claim by implication — and this cluster's entire discipline is not making one.

**Bench cost is the only colored figure.** It is the one number here representing money the business did not have to spend.

**A run at risk is flagged on the status board.** A Finance Admin opening this screen the week before payday is asking exactly one question, and answering it without them having to scan three entities is the feature's most useful behavior.

**No disclosure threshold applies, and the reason is stated.** Every permitted viewer already holds individual access to what is aggregated. Applying a threshold here would be copying a protection that protects nobody.

---

## Related Notes

- [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] — the employer cost this feature depends on
- [[VRS-F064_Multi-Currency_Payroll|VRS-F064]] — the normalization called directly
- [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] — the people-strategy counterpart this shares no data with
- [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] — the bench cost summed here

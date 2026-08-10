---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Financial
aliases:
  - VRS-F064
---

# VRS-F064 — Multi-Currency Payroll

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (PayRun and PaySlip, this feature's entire foundation), [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (compensation currency), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity default currency), [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] (**the disbursement adapter this feature hands a payload to, replacing the former [[Vulto Pay]] dependency**), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (ExchangeRate, and Workspace's primary currency)
**Blocks:** [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]], which consumes this feature's normalization for its cross-entity view

This document is the single source of truth for this feature.

---

## What this is, and what it is not

Cross-currency disbursement is done well by Deel and Remote, and this document does not try to out-build them at actually moving money across borders. **That is [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s adapter and whichever provider sits behind it.**

What none of those platforms can do, because none has ever seen a timesheet or a rate card, is put a payment figure next to the revenue that same person generated, **in the same currency, on the same screen.**

A Pakistan-based employee paid in PKR, billing a US client at a USD rate, has always produced two numbers a founder could never honestly compare. This feature normalizes both into one reporting currency on request, without altering either figure's permanently locked original-currency record.

---

## What It Is

A currency-resolution layer on top of [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s runs: for every payslip whose employee needs paying in a currency different from the run's calculation currency, this resolves, snapshots and tracks the conversion — and at workspace level, normalizes spend across entities into one comparable figure.

---

## Problem It Solves

[[VRS-F062_Payroll_Engine_Core|VRS-F062]] calculates a correct figure in the correct entity's currency. It does not answer what a distributed team's founder needs next: **exactly how much of which currency has to leave the business and land in whose account**, and whether a UK engineer's pay and an equivalent Pakistan engineer's pay are actually comparable once currency stops hiding the difference.

Without this, both are answered in a spreadsheet, by hand, every pay period, using whatever rate someone checked that morning.

---

## User-Facing Flows

### A mismatch appearing automatically

When a preview generates a payslip for someone whose compensation currency differs from the run's, this resolves the rate and shows an estimated disbursement figure directly on that payslip. No separate screen.

### Finalizing locks the rate

Finalizing resolves and permanently snapshots the rate effective on the run's pay date. **Never twice for the same payslip** — a rate entered later, even for the same date, never reaches an already-finalized record.

### What actually needs sending

A finalized run shows a disbursement breakdown: three lines if three currencies are involved, rather than one blended total that answers nothing operationally.

### Handing off

Initiating disbursement sends each payslip's instruction to [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s adapter. This feature tracks the reported result and executes nothing itself.

### Comparing across entities

An Owner or Finance Admin sees consolidated spend across every finalized run in a range, normalized into the workspace's primary currency or any other requested. **A read-only, live-computed comparison** — every run's own figures remain exactly as calculated.

---

## Interface Specification

### Screens

| Surface | Location | Purpose |
|---|---|---|
| Exchange rates | Content, from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] | The rate series |
| Disbursement breakdown | Section on a finalized run | What to send |
| Consolidated summary | Content | Cross-entity comparison |

### Layout and components

**Exchange rates** is a Table: pair, rate, effective date, entered by. Grouped by pair, newest first. Entering a rate for a date that already has one shows the existing value before replacing it — a correction should be a deliberate act, not an accidental overwrite.

**The disbursement breakdown** is the operationally important surface: one row per currency, each showing the total and the recipient count, with the run's own calculation currency marked. Totals render in `numeric-lg`.

Payslips with an unresolved rate render in a separate section headed plainly — *2 payslips cannot be converted* — with the missing pair named and a **Record rate** action. **They are not merged into the breakdown with a zero**, which would understate what needs sending.

**The consolidated summary** shows each entity's contribution and the normalized total, with the reporting currency and the rate date used stated beneath. A normalized figure whose rate date is unstated is a figure nobody can reproduce.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Finance-restricted throughout. Structurally absent for Manager |
| Unresolved | A separate labeled section, never a zero in the breakdown |
| Estimated | A preview figure carries an `attention` Badge reading *Estimate* until finalization locks it |
| Empty | *No currency conversions needed.* where every employee is paid in their entity's currency |
| Error | A rate of zero or a negative rate is refused |

### Responsive

The breakdown stacks below 1280px.

---

## Technical Architecture

### The ExchangeRate schema

Finance-restricted, Tier 1.

```
exchange_rate_id: UUID v4
workspace_id:     UUID
from_currency:    ISO 4217
to_currency:      ISO 4217
rate:             decimal — units of to_currency per one of from_currency
effective_date:   date
entered_by:       user_id

— Universal Node Conventions per VPS-A002 —
```

### Why this is a time series, not a superseded definition

RateCard and LeavePolicy represent a single current definition replaced wholesale, correctly modeled with `supersedes`. **An exchange rate is a different shape**: every historical date's rate remains independently meaningful, not superseded by tomorrow's.

ExchangeRate is append-only, one record per pair per date. Correcting a mistaken entry soft-deletes that one record and creates a new one at the same date. It touches no other date, and **never retroactively alters a payslip that already snapshotted the wrong value.**

### Resolution

Returns the most recent non-deleted rate with an effective date on or before the target for that pair. **No match returns nothing explicitly, never a rate of 1 or any other guess** — a fabricated exchange rate is actively wrong in a way a fabricated zero elsewhere in this product is not.

### PaySlip extension

```
disbursement_currency:       ISO 4217 — from the employee's compensation
                             currency; equal to the run's own where no
                             conversion is needed
exchange_rate_used:          decimal, nullable — resolved once at finalization,
                             never recomputed
exchange_rate_date:          date, nullable
disbursement_amount:         decimal, nullable — net pay converted. Null while
                             unresolved, never a placeholder figure
disbursement_status:         enum: Pending, Sent, Confirmed, Failed
disbursement_reference:      string, nullable — opaque, from the adapter
disbursement_failure_reason: text, nullable
```

### Why the rate resolves twice

At preview, an **estimate** using the most current rate, clearly marked, since it will move before finalization. At finalization, re-resolved against the run's **pay date specifically** — not the moment finalize happens to be clicked — and that second resolution is permanently snapshotted.

Nothing recomputes a finalized conversion afterwards, the same principle governing `effective_billing_rate` and a contract's rendered content.

### A missing rate never blocks a run

An employee needing conversion for a pair with no resolvable rate still gets a fully calculated payslip — their pay figure in the run's own currency is unaffected by a missing FX rate. Only the disbursement amount stays null, and they surface as a currency issue rather than blocking every other employee.

### Both aggregations are computed, never stored

The breakdown groups payslips by disbursement currency at query time. The consolidated summary converts each run's totals into a requested reporting currency live. **Neither is cached, and neither ever alters a run's own figures.**

### API contracts

```
exchangeRate.record(fromCurrency, toCurrency, rate, effectiveDate)
  -> { exchangeRateId, replacedExisting? }
exchangeRate.resolve(fromCurrency, toCurrency, targetDate)
  -> { rate, effectiveDate } | { unresolved: true }

payRun.getDisbursementBreakdown(payRunId) -> {
  breakdown: { currency, totalAmount, paySlipCount }[],
  unresolved: { paySlipId, employeeName, requiredPair }[]
}

payroll.getConsolidatedSummary(workspaceId, startDate, endDate,
                               reportingCurrency?) -> {
  byEntity: { entityId, entityName, originalCurrency, originalTotal,
              normalizedTotal }[],
  totalGross, totalNet, totalRevenueGenerated,
  currency, rateDate, payRunsIncluded
}
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | ExchangeRate carries the schema above. At most one non-deleted record per pair per date. A correction soft-deletes and recreates |
| G02 | Resolution returns the most recent applicable rate or explicitly nothing. It never defaults to 1 or any fabricated value |
| G03 | Disbursement fields resolve twice: an estimate at preview, a permanent snapshot at finalization against the run's pay date. The snapshot never recomputes |
| G04 | A missing rate never blocks another employee's payslip. Only that employee's disbursement amount remains null |
| G05 | The breakdown and consolidated summary are computed live and never alter a run's figures |
| G06 | Disbursement status, reference and failure reason reflect only what [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s adapter reports. This feature never infers an outcome |
| G07 | An unresolved payslip is reported separately from the breakdown, never folded in as a zero |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F064-S01 | ExchangeRate schema and time-series resolution | Data |
| VRS-F064-S02 | Disbursement fields and rate locking | Logic |
| VRS-F064-S03 | Disbursement breakdown | UI |
| VRS-F064-S04 | Cross-entity normalized summary | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a run calculated in PKR includes an employee whose compensation currency is USD
**WHEN** the preview generates
**THEN** disbursement currency is USD and the amount is an estimate, clearly badged as such

---

**GIVEN** that run is finalized with a pay date of the 30th
**WHEN** finalization completes
**THEN** the rate effective on or nearest before the 30th is snapshotted, and a different rate entered afterwards for that same date never changes this payslip

---

**GIVEN** no rate exists for a required pair
**WHEN** the preview generates
**THEN** the payslip is still fully calculated in the run's currency, the disbursement amount stays null, and the employee appears as a currency issue rather than blocking the run

---

**GIVEN** a finalized run needs disbursement in three currencies
**WHEN** the breakdown is requested
**THEN** three grouped lines are returned, each with its total and recipient count, computed fresh

---

**GIVEN** two of that run's payslips have unresolved rates
**WHEN** the breakdown renders
**THEN** they appear in a separate labeled section with the missing pair named, and are not included in any currency's total

---

**GIVEN** a workspace ran finalized payroll across a PKR entity and a GBP entity
**WHEN** the consolidated summary is requested with no reporting currency specified
**THEN** both are normalized into the workspace primary currency and summed, each run's original figures unchanged, with the rate date used stated

---

**GIVEN** a Manager attempts to view rate data or a disbursement breakdown
**WHEN** the request is made
**THEN** it is structurally absent

---

## Non-Functional Requirements

- Resolution and the breakdown both resolve within 200ms from the local graph
- A finalized payslip's rate, rate date and disbursement amount never change afterwards, including after a correction to the rate record they resolved from
- Rate entry, preview and viewing the breakdown function offline. Initiating disbursement requires connectivity per [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]
- No code path computes or displays a disbursement figure using a fabricated or defaulted rate

---

## Security Considerations

- **ExchangeRate carries no new privacy category.** Finance-restricted, Tier 1, the same class RateCard and PayrollPolicy occupy.
- **The disbursement fields inherit PaySlip's existing Tier 1 and self-and-finance protection automatically.** More fields on an already-correctly-protected record.
- **`disbursement_reference` is opaque and is never a bank account number, routing detail or payment credential.** This feature stores what the adapter hands back for tracking. The credentials themselves are [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s concern and never this feature's schema.
- **A normalized cross-entity figure can imply individual compensation in a small entity.** An entity with two employees whose normalized total is visible alongside its headcount is close to a disclosure, which is why the consolidated summary is Finance-restricted rather than merely aggregate-safe.

---

## Out of Scope

- **A live exchange rate data feed** — manual entry only. Which provider this eventually integrates with is a commercial decision, made behind the same abstraction [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] establishes
- **The mechanics of cross-border payment execution, banking compliance or KYC** — [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s adapter and its provider
- **Hedging, FX risk management or rate forecasting** — this resolves a rate for a specific date and makes no claim about future movement
- **Multi-currency billing rates or client quoting** — [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s and [[Vulto Accounts]]' territory. This concerns employee disbursement only
- **Cross-border withholding tax** — [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]]'s permanent exclusion, and the same reasoning applies here

---

## Decisions Recorded

**The [[Vulto Pay]] dependency is removed entirely**, per founder decision, and replaced by [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s provider-agnostic adapter. The previous specification carried two open items, both of which existed only because it depended on infrastructure that does not exist: the integration contract, and cross-border withholding. The first is closed by the adapter. The second is [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]]'s stated permanent exclusion.

**Unresolved payslips are reported separately from the breakdown**, never folded in as a zero. A breakdown that silently understates what needs sending is worse than one that names what it cannot compute.

**The consolidated summary states its rate date.** A normalized figure whose rate date is unstated cannot be reproduced by anyone checking it later.

**Recording a rate for a date that already has one shows the existing value first.** A correction should be deliberate rather than an accidental overwrite of a rate a finalized run may have used.

---

## Related Notes

- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — the runs this feature converts
- [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] — the disbursement adapter replacing [[Vulto Pay]]
- [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] — the withholding exclusion applying here too
- [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] — which consumes this normalization

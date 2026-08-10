---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Compliance
aliases:
  - VRS-F063
---

# VRS-F063 — Tax and Compliance Configuration

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity and the jurisdiction enum, reused rather than redefined), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (PayRun and PaySlip — **this feature supersedes that document's placeholder deduction mechanism rather than extending it**), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days, for effective-window arithmetic), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (TaxConfig, and the `supersedes` and `governed_by` edges)
**Blocks:** [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] (whose manual-adjustment detection depends on this feature's deduction source tagging), [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] (whose cost figure depends on employer contributions existing)

This document is the single source of truth for this feature.

---

## Why entity scoping is the answer, not a global tax engine

A single global tax engine bolted onto one payroll run would need to guess which rules apply to which employee — exactly the manual, error-prone step this product has spent five features removing.

**It does not need to guess.** [[VRS-F062_Payroll_Engine_Core|VRS-F062]] already scopes every PayRun to exactly one Entity, and [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] already resolves every employee's jurisdiction through that same Entity.

This feature gives that structural scoping something real to resolve to: a jurisdiction's tax rules, versioned by tax year, applied automatically to every payslip in a run the moment they exist. **A Pakistan entity's payroll cannot accidentally apply UK rates, because the two were never in the same run to begin with.**

**This feature is built before [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]**, correcting the previous ordering. [[VRS-F062_Payroll_Engine_Core|VRS-F062]] shipped a placeholder deduction mechanism it always said would be superseded here; building the real one first avoids writing that placeholder at all.

---

## What It Is

Jurisdiction-specific, tax-year-versioned rules — income tax brackets and social security rates, employee and employer sides both — applied automatically to every payslip, resolved through the same Entity mechanism [[VRS-F018_Leave_Policy_Engine|VRS-F018]] and [[VRS-F020_Universal_Contract_Builder|VRS-F020]] already use.

---

## Problem It Solves

An agency operating across Pakistan, the UK and the US cannot honestly run payroll on a single flat deduction table for everyone, and calculating each jurisdiction's withholding by hand outside the product defeats the entire premise of a payroll engine built into the same graph as everything else.

---

## User-Facing Flows

### Configuring a jurisdiction

An Owner or Finance Admin defines a config for a jurisdiction and tax year: progressive brackets, an employee-side social security rate, an employer-side rate, and where the jurisdiction caps it, a wage base ceiling.

### What changes automatically

The next run for an entity whose jurisdiction has an active config covering its pay date computes real statutory deductions — income tax and employee social security withheld from the employee, **employer social security tracked as a distinct cost never deducted from anyone's pay.**

Nothing about [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s generation flow changes shape. It simply has a real rule to apply where before it had none.

### Where no config exists

The run behaves exactly as [[VRS-F062_Payroll_Engine_Core|VRS-F062]] specifies without one: discretionary policy deductions apply, no statutory line is computed. **Additive, never a breaking change to a workspace that has not configured it.**

### Updating rates

A new tax year, or a mid-year legislative change, creates a new version. A run already finalized under a prior version keeps its computed figures — the same historical-accuracy principle governing every versioned financial record in this graph.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Tax configuration | Content + Panel | Per jurisdiction |
| Config editor | Panel | Brackets and rates |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

### Layout and components

**Tax configuration** is a Table: jurisdiction, tax year, effective window, version, entities using it, status. The entities column is the useful one — a config nothing uses is either newly created or scoped to a jurisdiction the workspace does not employ in.

**The editor** is three Sections. *Brackets* is a Table with one row per band: from, to, rate. A **live worked example** sits beneath — a gross figure the user can type, showing the resulting tax broken down by band. Progressive brackets are the single most commonly misconfigured thing in payroll, and an editor that cannot show its own arithmetic invites a wrong rate that surfaces on a payslip.

*Social security* holds the two rates and the optional cap, with the cap's effect shown against the same worked example.

*Effective window* holds the tax year and the date range, with a warning where it overlaps an existing config for the same jurisdiction.

Saving opens a Modal stating that finalized runs are unaffected and the change applies to future runs only.

### Keyboard

Standard form bindings. `Tab` through bracket rows.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner and Finance Admin. Structurally absent for Manager and Team Member |
| Overlapping | An Inline Alert on both configs naming the conflict |
| Empty | *No tax configuration.* with a line stating that runs will use discretionary deductions only until one exists |
| Error | A bracket with a lower bound below the previous band's upper bound is refused |

### Responsive

The editor stacks below 1280px.

---

## Technical Architecture

### The TaxConfig schema

Finance-restricted, Tier 1.

```
tax_config_id:                 UUID v4
workspace_id:                  UUID
jurisdiction:                  enum per VRS-F003 — the same enum, reused
tax_year:                      integer
effective_from / effective_to: date — the window within the tax year these
                               rules are in force, since a jurisdiction can
                               revise rates mid-year
income_tax_brackets:           JSON array of { threshold_from, threshold_to
                               (nullable for the top band), rate } —
                               progressive, applied to gross pay
employee_social_security_rate: decimal — withheld from the employee
employer_social_security_rate: decimal — the employer's own additional
                               contribution, never withheld from anyone
social_security_wage_cap:      decimal, nullable
version:                       integer, starts at 1
supersedes_id:                 UUID, nullable
is_active:                     boolean, default true

— Universal Node Conventions per VPS-A002 —
```

### Resolution

`taxConfig.resolve(jurisdiction, payDate)` finds the active config whose effective window contains the pay date. More than one match falls back to the most recently created, **flagged as a configuration issue** — the identical tie-break [[VRS-F018_Leave_Policy_Engine|VRS-F018]] establishes for an ambiguous leave policy.

No match returns nothing explicitly, and [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s calculation proceeds as it does for an unconfigured jurisdiction.

### The computation

Brackets apply progressively against gross pay. Employee social security is its rate against the lesser of gross pay and the wage cap. Both become deduction lines tagged `TaxConfig`.

Separately, employer social security against the same capped base becomes `employer_statutory_cost` — **added to the payslip, never subtracted from gross or net pay, since it was never the employee's money.**

### Corrections to [[VRS-F062_Payroll_Engine_Core|VRS-F062]]

`deductions` on PaySlip gains a `source` field — `TaxConfig`, `PayrollPolicy` or `Manual` — so a statutory line, a discretionary policy line and a genuine ad hoc adjustment are never confused. PaySlip gains `employer_statutory_cost`. PayRun gains `tax_config_id`, resolved at generation, and `total_employer_cost`, cached at finalization as gross plus every payslip's employer contribution.

PayrollPolicy's `standard_deductions` is narrowed by description to **discretionary, non-statutory deductions only** — a voluntary benefits contribution, a loan repayment. Tax and social security are this feature's domain now that a real mechanism exists to own them.

### API contracts

```
taxConfig.create(jurisdiction, taxYear, effectiveFrom, effectiveTo,
                 incomeTaxBrackets, employeeRate, employerRate, wageCap?)
  -> { taxConfigId }
taxConfig.update(taxConfigId, fields) -> { newTaxConfigId }
  // Creates a superseding version; never mutates

taxConfig.resolve(jurisdiction, payDate) -> TaxConfig | { unresolved: true }

taxConfig.previewComputation(taxConfigId, grossPay) -> {
  byBracket: { from, to, rate, amount }[],
  incomeTaxTotal, employeeSocialSecurity, employerStatutoryCost
}
  // The editor's worked example. No side effect

payrollTax.computeStatutoryDeductions(grossPay, taxConfigId) -> {
  incomeTaxAmount, employeeSocialSecurityAmount, employerStatutoryCost
}
  // Called by VRS-F062's preview generation
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | TaxConfig carries the schema above. `supersedes` connects each version to the one it replaces |
| G02 | Resolution matches jurisdiction and a pay date within the effective window. Ambiguity falls back to most recently created, flagged |
| G03 | A jurisdiction with no resolvable config produces no statutory deduction. [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s unconfigured behavior is preserved exactly |
| G04 | `employer_statutory_cost` is never subtracted from gross or net pay. It is a cost to the business, never a deduction from the employee |
| G05 | `tax_config_id` is recorded at generation and never re-resolved retroactively if a newer version supersedes it |
| G06 | Each deduction entry carries a `source`, distinguishing statutory from discretionary from manual |
| G07 | Brackets must be contiguous and non-overlapping. A gap or overlap is refused at write |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F063-S01 | TaxConfig schema and versioning | Data |
| VRS-F063-S02 | Jurisdiction and tax-year resolution | Logic |
| VRS-F063-S03 | Statutory and employer cost computation | Logic |
| VRS-F063-S04 | Configuration editor with worked example | UI |

---

## Feature Acceptance Criteria

**GIVEN** an active config exists for a run's jurisdiction covering its pay date
**WHEN** the preview generates
**THEN** each payslip's deductions include an income tax line and an employee social security line, both tagged `TaxConfig`, and `employer_statutory_cost` is set

---

**GIVEN** gross pay exceeds the wage cap
**WHEN** deductions compute
**THEN** both social security figures are capped at the wage base, not computed against full gross

---

**GIVEN** no config exists for the jurisdiction
**WHEN** the preview generates
**THEN** no statutory line appears, discretionary deductions apply exactly as [[VRS-F062_Payroll_Engine_Core|VRS-F062]] specifies, and nothing errors

---

**GIVEN** a config is superseded by a new tax-year version
**WHEN** a run finalized under the prior version is viewed
**THEN** its figures remain exactly as computed

---

**GIVEN** a Finance Admin types a gross figure into the editor's worked example
**WHEN** it computes
**THEN** the tax is shown broken down by band, so a misconfigured bracket is visible before it reaches a payslip

---

**GIVEN** brackets are entered with a gap between two bands
**WHEN** saved
**THEN** it is refused, naming the gap

---

**GIVEN** a run's gross is 100,000 and its payslips carry 8,000 in employer contributions
**WHEN** it finalizes
**THEN** `total_employer_cost` is 108,000, and [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]]'s cost figure reflects that complete total rather than gross alone

---

## Non-Functional Requirements

- Resolution and computation add no more than 100ms per employee to preview generation
- The worked example computes within 100ms of a keystroke
- Full functionality offline
- A finalized payslip's statutory figures never change, even if the config used is later superseded

---

## Security Considerations

- **TaxConfig follows the Finance-restricted default with no override**, confirmed against RateCard's and PayrollPolicy's precedent rather than assumed.
- **`employer_statutory_cost` carries no elevated sensitivity** beyond PaySlip's existing Tier 1 protection. Another field on an already-correctly-protected record.
- **This feature computes what is owed and never files it.** The distinction matters: a workspace using this must still remit through its own accountant, and a product that implied otherwise would create a compliance failure with no visible symptom until an authority asked.

---

## Out of Scope

- **Cross-border withholding on international payments** — a considered, permanent exclusion. Tax-treaty interaction between two jurisdictions is a genuinely harder problem than one jurisdiction's bracket table, and encoding it responsibly requires tax counsel this document cannot substitute for. A confidently wrong withholding calculation carries real legal consequence
- **Automatic filing, remittance or reporting to any authority** — this computes what is owed. Filing it is outside this graph entirely
- **Statutory categories beyond income tax and social security** — a real future extension requiring the same scrutiny these two received, not assumed to fit the same shape
- **Detecting a legislative rate change** — a config update is a deliberate human action. This feature monitors no external data feed
- **Tax equalization for internationally mobile employees** — materially more complex than domestic withholding, not attempted

---

## Decisions Recorded

**This feature is built before [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]**, reordered from the previous set. [[VRS-F062_Payroll_Engine_Core|VRS-F062]] shipped a placeholder it always said would be superseded here, and building the real mechanism first avoids writing the placeholder at all.

**The worked example is added to the editor.** Progressive brackets are the most commonly misconfigured thing in payroll, and an editor that cannot show its own arithmetic invites a wrong rate that surfaces on a payslip — where it is discovered by an employee rather than by its author.

**Bracket contiguity is enforced at write.** A gap between bands produces income that is taxed at no rate, which is silent and wrong.

**Cross-border withholding remains permanently excluded**, and the reasoning is stated rather than deferred: a wrong tax-treaty calculation has legal consequence in a way a domestic bracket table kept current by whoever configures it does not.

**This feature computes and never files**, and says so. A product that implied it handled remittance would create a compliance failure with no visible symptom.

---

## Related Notes

- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — the payroll engine this feature completes
- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the jurisdiction resolution reused here
- [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] — whose manual-adjustment detection depends on deduction source tagging
- [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] — the true employment cost this feature makes computable

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F003
---

# VRS-F003 — Multi-Entity and Jurisdiction Foundation

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee, the node scoped to an Entity), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Entity's registry entry and the `scoped_to_entity` edge), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the workspace-configuration permission pattern)
**Blocks:** [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (calendars are defined per Entity), [[VRS-F018_Leave_Policy_Engine|VRS-F018]] (leave policy resolves jurisdiction here), [[VRS-F020_Universal_Contract_Builder|VRS-F020]] (contracts resolve jurisdiction and entity name here), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] and [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] (payroll is scoped per Entity)

This document is the single source of truth for this feature and owns Entity's complete schema.

---

## What It Is

A permanent, Roster-owned concept: **which legal entity's employment law, leave policy, working calendar and payroll jurisdiction applies to a given person.**

An agency with a Delaware C-Corp, a UK Ltd and a Pakistan private limited company employs people under different entities. Which one governs a specific employee is a fact this feature makes structural, rather than something reconstructed ad hoc every time a contract, a leave balance or a payroll run needs to know.

---

## Problem It Solves

Jurisdiction is the input to four genuinely different calculations — which contract clauses apply, which leave entitlement accrues, which days are working days, and which tax rules run — and every one of them needs the same answer.

The previous specification set demonstrated exactly what happens without a structural source. Two features each independently needed *which jurisdiction applies to this person*, each solved it with a manual per-record selection, and one of them referenced a field on Employee that had never actually been added. A single structural source means every feature asks the same question the same way and gets a real answer rather than a re-typed guess.

**This feature is positioned early in the build order for that reason.** It was previously scheduled twenty-three features after the contract builder that already declared a dependency on it.

---

## User-Facing Flows

### Defining an entity

An Owner or HR Admin defines an Entity: a name, a jurisdiction, a default currency, and a registered address. Every workspace has at least one, created automatically during [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup wizard from the founder's own answers, so that a single-entity agency never encounters this concept as an obstacle.

**A single-entity workspace should never see entity selection anywhere in the product.** Where exactly one Entity exists, it is applied silently and the field is hidden. A UK agency with eight people should not be asked which of its one legal entities employs someone.

### Scoping an employee

An employee is scoped to exactly one Entity at a time, set at hire. Changing it is an intercompany transfer — a deliberate, recorded action, never inferred from location or nationality.

### What follows automatically

Contract generation in [[VRS-F020_Universal_Contract_Builder|VRS-F020]] pre-fills jurisdiction and entity name. Leave policy resolution in [[VRS-F018_Leave_Policy_Engine|VRS-F018]] matches against the same source. Working days in [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] resolve through the Entity's calendar. Payroll in [[VRS-F062_Payroll_Engine_Core|VRS-F062]] is scoped and denominated per Entity. None of those features carries its own jurisdiction concept.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Entities | Content + Panel | Define and manage. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Entity selector | Inline field | On the Employee profile, hidden where only one Entity exists |

### Layout and components

**Entities** is a Table: name, jurisdiction Badge, default currency, employee count, status. The Panel holds the full record and the list of scoped employees. Primary action is **Add entity**.

Employee count is a live traversal of `scoped_to_entity`, and it is the most useful column on the screen — an entity with zero employees is either newly created or a mistake, and both are worth seeing at a glance.

**The entity selector on the Employee profile is conditional.** With one Entity it does not render. With two or more it is a Select in the employment Section, required at creation. Changing it opens a Modal confirming the transfer, because it silently changes which employment law, leave entitlement and tax rules apply to a person — one of the few state changes in this product with legal consequence that is not otherwise obvious from the interface.

### Keyboard

Standard list bindings from [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]. No feature-specific shortcuts; this is a configuration surface visited rarely.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Team Members and Managers see entity names and jurisdictions read-only, per the workspace-configuration pattern in [[VPS-A004_Graph_Permission_Layer|VPS-A004]] |
| Empty | Never empty. Setup creates the first Entity |
| Error | Deactivating an Entity with scoped employees is refused, naming the count and linking to them |

### Responsive

Drops `default currency`, then `status`, below 1280px.

---

## Technical Architecture

### The full Entity schema

```
entity_id:           UUID v4
workspace_id:        UUID, FK to Workspace
name:                string, required — "Vulto Pakistan Pvt Ltd"
legal_name:          string, nullable — where the registered name differs from
                     the name people use day to day
jurisdiction:        enum: PK, UK, US, AE, SA, IN, SG, Global — the single
                     jurisdiction enum for the whole product, defined here
registered_address:  text, nullable — appears on generated contracts per VRS-F020
registration_number: string, nullable — company number, NTN, EIN
default_currency:    ISO 4217, required — every PayRun scoped to this Entity is
                     calculated in it, and it is the default for an employee's
                     compensation_currency where unset
is_active:           boolean, default true
lifecycle_status:    enum: Active, Dissolved

— Universal Node Conventions per VPS-A002 —
```

### The jurisdiction enum

Defined here and used unchanged by [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], [[VRS-F018_Leave_Policy_Engine|VRS-F018]], [[VRS-F020_Universal_Contract_Builder|VRS-F020]], [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]] and [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]]. The initial set covers Vulto's stated markets and the jurisdictions professional services firms in those markets most commonly employ across. Adding one is an additive schema change per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], requiring a corresponding calendar template in [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] and, where payroll is active, a tax configuration in [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]].

`Global` exists for a contractor engaged under no specific employment jurisdiction. It resolves to the workspace's own default calendar and carries no statutory leave entitlement, and features consuming it must handle that rather than assuming a jurisdiction is always specific.

### scoped_to_entity

At most one active edge per Employee, following the single-active-edge-with-history pattern. Changing an employee's entity closes the prior edge with `effective_to` and creates a new one. Full history is preserved and traversable, which is what makes it possible to answer *which entity employed this person in March* two years later — a question that arises in every cross-border payroll audit.

### Historical accuracy

Changing an employee's Entity never retroactively alters an already-generated Contract, an already-resolved leave entitlement, or a closed PayRun. Each was resolved correctly at its own moment. This is a general principle across the product, and it is the reason `effective_from` and `effective_to` are first-class edge fields in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] rather than metadata.

### API contracts

```
entity.create(name, jurisdiction, defaultCurrency, fields?) -> { entityId }
entity.update(entityId, fields)                             -> { success }
entity.list(workspaceId)                                    -> Entity[]
entity.deactivate(entityId)                                 -> { success }
  // Refused where any Active employee remains scoped to it

employee.setEntity(employeeId, entityId, effectiveFrom)     -> { edgeId }
  // Closes the prior active edge, creates a new one

entity.resolveForEmployee(employeeId, asOf?)                -> Entity
  // The single call every consuming feature makes.
  // asOf defaults to now; supplying a date returns the Entity in
  // effect then, which is what payroll and contract history require
```

`entity.resolveForEmployee` is the contract that matters. No feature reads `scoped_to_entity` directly, so that temporal resolution is implemented once rather than five times with four subtly different interpretations of *as of when*.

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Entity carries the full schema above |
| G02 | `scoped_to_entity` follows the single-active-edge-with-history pattern. At most one active edge per Employee; history preserved on change |
| G03 | Changing an employee's Entity never retroactively alters an already-generated Contract, resolved leave entitlement, or closed PayRun |
| G04 | Every workspace has at least one Entity. It cannot be reduced to zero |
| G05 | An Entity with Active scoped employees cannot be deactivated. The refusal names the count |
| G06 | Consuming features MUST call `entity.resolveForEmployee` rather than traversing `scoped_to_entity` directly, so temporal resolution is implemented once |
| G07 | Where exactly one Entity exists in a workspace, it is applied automatically at employee creation and the selector is not rendered |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F003-S01 | Entity schema and management | Data |
| VRS-F003-S02 | Employee entity scoping and transfer | Logic |
| VRS-F003-S03 | Temporal jurisdiction resolution | Logic |
| VRS-F003-S04 | Single-entity transparency | UI |

---

## Feature Acceptance Criteria

**GIVEN** a workspace with exactly one Entity
**WHEN** an HR Admin creates an employee
**THEN** the Entity is applied automatically, the selector does not render, and the person never encounters the concept

---

**GIVEN** an employee scoped to a Pakistan entity
**WHEN** a Contract is generated via [[VRS-F020_Universal_Contract_Builder|VRS-F020]]
**THEN** jurisdiction, entity name and registered address pre-fill from that Entity, remaining editable before the contract is finalized

---

**GIVEN** the same employee's applicable leave policy is resolved via [[VRS-F018_Leave_Policy_Engine|VRS-F018]]
**WHEN** the match runs
**THEN** it resolves against the Pakistan jurisdiction from their scoped Entity

---

**GIVEN** an employee transfers from the UK entity to the Pakistan entity effective 1 March
**WHEN** `entity.resolveForEmployee` is called with an `asOf` of 1 February
**THEN** it returns the UK entity, and with an `asOf` of 1 April it returns the Pakistan entity

---

**GIVEN** a Contract was generated before an employee's Entity changed
**WHEN** it is viewed afterwards
**THEN** its jurisdiction and entity name remain exactly as generated, unaffected by the later change

---

**GIVEN** an Entity with three Active scoped employees
**WHEN** an Owner attempts to deactivate it
**THEN** the action is refused, the error names the three employees, and links to them

---

## Non-Functional Requirements

- `entity.resolveForEmployee` completes within 20ms from the local graph. It is called on every contract generation, leave calculation, working-day computation and payroll line, and a slow implementation compounds across all four
- Full functionality offline from local cache
- Entity list renders within 100ms

---

## Security Considerations

- **Entity carries no sensitive information.** Standard, Tier 0. A legal entity's name and jurisdiction are basic operational facts, and every employee should be able to see which entity employs them.
- **Registration numbers are Tier 0 but not casually useful.** A company registration number is public record in every jurisdiction in the enum, so no elevated tier is warranted, but it is displayed only on the Entity record and generated contracts rather than surfaced in search results.
- **Entity transfer is an audited event** per [[VPS-F004_Silent_Audit_Log|VPS-F004]], because it changes which employment law governs a person and is exactly the sort of change that gets questioned after the fact.

---

## Out of Scope

- **Financial consolidation across entities** — [[Vulto Accounts]]' permanent territory
- **Intercompany contract structuring** — [[Vulto Legal]]'s permanent territory
- **Automatic entity assignment from location or nationality** — entity scoping is a deliberate HR decision, never inferred
- **Entity-level billing or subscription splitting** — a workspace is the billing unit
- Working calendars and holidays, which are defined per Entity but owned by [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]
- Tax rules per jurisdiction — [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]]

---

## Decisions Recorded

**This feature moves from Post-MVP to MVP**, position three in the build order. [[VRS-F020_Universal_Contract_Builder|VRS-F020]] already declared a dependency on it while it sat twenty-three features later, and [[VRS-F018_Leave_Policy_Engine|VRS-F018]] referenced a jurisdiction field on Employee that was never implemented because this feature was meant to supply it. Both are consequences of the same scheduling error.

**The jurisdiction enum is defined here and expanded.** The previous set used `PK, UK, US, UAE, Global` in three documents without a single owner. `UAE` is corrected to `AE` for ISO 3166 consistency, and `SA`, `IN` and `SG` are added, covering the jurisdictions professional services firms in Vulto's markets most commonly employ across.

**`entity.resolveForEmployee` with temporal resolution is introduced**, and direct traversal of `scoped_to_entity` is prohibited by G06. Without it, five features would each implement *which entity applied at the time* independently, and payroll would eventually disagree with contract history about a transfer date.

**Single-entity transparency is specified.** Most workspaces will have exactly one Entity forever, and a multi-entity feature that makes single-entity firms select from a list of one has added a concept to their product for no benefit.

**`legal_name`, `registered_address` and `registration_number` are added**, because [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s generated contracts require all three and were previously pre-filling from a node that held none of them.

---

## Related Notes

- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the employees scoped to these entities
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working calendars defined per entity
- [[VRS-F018_Leave_Policy_Engine|VRS-F018]] — leave policy, which resolves jurisdiction here
- [[VRS-F020_Universal_Contract_Builder|VRS-F020]] — contract generation, which pre-fills from here
- [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]] — tax configuration, scoped per jurisdiction

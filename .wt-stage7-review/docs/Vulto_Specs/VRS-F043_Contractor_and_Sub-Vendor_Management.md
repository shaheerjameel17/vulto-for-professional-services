---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F043
---

# VRS-F043 — Contractor and Sub-Vendor Management

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee with `employment_type = Contractor`, and its `contract_end_date` and `contract_renewal_status` fields), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days, for term-end arithmetic), [[VRS-F006_Rate_Card_Engine|VRS-F006]] (the rate mechanism for a contractor's Assignment, not duplicated here), [[VRS-F020_Universal_Contract_Builder|VRS-F020]] (the Contract Builder, which already generates contractor agreements), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (the tracked-date pattern reused for term renewal), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (SubVendor and the `contracted_with` edge)
**Blocks:** Nothing structurally. [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] invoices against both node types this feature manages.

This document is the single source of truth for this feature.

---

## What It Is

Two genuinely different things managed together, because an agency's real question — *who is doing our work who is not a direct hire* — spans both.

**Individual contractors** are Employee nodes with `employment_type = Contractor`, per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]. **Sub-vendor organizations** — an agency, a collective, a firm subcontracted as a block of capacity — are SubVendor nodes.

The two are never conflated. A SubVendor is an organization and never an individual, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s standing decision.

---

## Problem It Solves

**A contractor's engagement has a term**, and a term that lapses with nobody deciding whether to renew, convert or end it cleanly is an administrative gap that becomes an awkward conversation later — and in several jurisdictions a misclassification risk, since a contractor engaged continuously for two years on an expired agreement starts to look like an employee to a tribunal.

**A sub-vendor relationship has no natural home** in a system built around individual employee records. Without one it lives in a spreadsheet, or more often nowhere at all until an invoice question arises.

---

## User-Facing Flows

### Tracking a contractor's term

As `contract_end_date` approaches, an HR Admin or Manager is prompted to record a decision: **Renewed** with a new end date, **Converted** toward a permanent classification, or **Ended**, routing to [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]'s offboarding.

Same shape as [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s probation and notice tracking — a tracked date, a surfaced reminder, a required human decision — followed as a pattern rather than shared code, since a contract term and a departure are different subjects.

### Managing a sub-vendor

An HR Admin or Owner adds a SubVendor and engages it against a project with a date range and a capacity commitment.

### The unified view

One view lists every contractor and every sub-vendor engagement together, because the underlying question is single even though it spans two node types.

### Converting a contractor

Recording **Converted** does not by itself change `employment_type`. It flags that a new contract is appropriate, since a contractor agreement and an employment contract are different documents entirely.

The actual conversion runs through [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] once that feature exists, since changing employment type alters compensation structure and belongs in the workflow that governs compensation changes.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| External capacity | Content + Panel | Contractors and sub-vendors together |
| Sub-vendors | Content + Panel | The organizations |
| Renewal decision | Panel | The tracked decision |

### Layout and components

**External capacity** is two Sections rather than one merged table, because a contractor and a sub-vendor engagement are answering the same question with different shapes.

*Contractors* is a Table: name, role, current assignment, term end, days remaining. Within the warning window, `days remaining` renders `attention`. Past the term end with no decision recorded renders `danger` — a contractor working past an expired agreement is the one state here with real legal consequence.

*Sub-vendor engagements* is a Table: organization, project, capacity units, start, end, days remaining.

A summary strip above states the combined figure: *4 contractors · 2 sub-vendors · 9 people equivalent.* That last number is what a founder actually wants — how much of the delivery capacity is external — and neither table alone gives it.

**The renewal decision Panel** shows the contractor, their term dates, their current assignments and their engagement history — how many times this term has already been renewed. A contractor on their fifth consecutive renewal is a fact worth seeing at the moment of the sixth.

Three actions as separate Cards: **Renew** with a DatePicker, **Convert to permanent**, **End engagement**. The last carries a Modal confirmation and routes to [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]].

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Manager reads contractors and engagements on their own projects. Owner, HR Admin and Finance Admin manage |
| Expired | A contractor past term with no decision renders `danger` and notifies HR Admin daily until resolved |
| Empty | *No external capacity engaged.* |
| Error | A renewal without a new end date is refused |

### Responsive

Drops `current assignment`, then `capacity units`, below 1280px.

---

## Technical Architecture

### SubVendor

Standard, Tier 0.

```
sub_vendor_id:   UUID v4
workspace_id:    UUID
name:            string, required
contact_name:    string, nullable
contact_email:   string, nullable
status:          enum: Active, Inactive

— Universal Node Conventions per VPS-A002 —
```

`capacity_units`, `start_date` and `end_date` for a specific engagement live on the `contracted_with` edge, not duplicated here. **A SubVendor node is the organization's identity; an edge is each engagement.**

### Contractor term fields

`contract_end_date` and `contract_renewal_status` on Employee, per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]. Meaningful only for `employment_type = Contractor`; null otherwise.

`contract_end_date` is distinct from `end_date`, which is set only at offboarding. A contractor whose term ends and is renewed has a new `contract_end_date` and no `end_date` at all.

### Sub-vendor capacity never counts toward internal supply

**An absolute exclusion.** A SubVendor's engaged capacity never contributes to [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s internal supply calculation.

Subcontracting and hiring are different strategic decisions with different cost structures, different commitments and different risks. A capacity forecast that counted a subcontracted collective as internal supply would tell a founder they have coverage they do not own, and the moment that matters is precisely when the sub-vendor is unavailable.

Sub-vendor capacity does appear in [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s Bench Forecast as a distinct row type, because a delivery view should show everyone delivering. The distinction is between *what is being delivered now* and *what we can count on planning forward*.

### Working days

Term end dates validate against [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and `days remaining` counts working days. A term ending on a Friday in a UAE entity ends on a day nobody is there to hand over on.

### API contracts

```
subVendor.create(name, contactName?, contactEmail?) -> { subVendorId }
subVendor.engageForProject(subVendorId, projectId, startDate, endDate,
                           capacityUnits) -> { edgeId }
subVendor.listActiveEngagements(subVendorId) -> {
  projectId, projectName, startDate, endDate, capacityUnits
}[]

contractor.recordRenewalDecision(employeeId, decision, newContractEndDate?)
  -> { success }
  // Renewed requires a new end date. Ended routes to VRS-F002's offboarding.
  // Converted flags a new contract without changing employment_type

contractor.engagementHistory(employeeId) -> {
  renewalCount, firstEngagedAt, terms: { start, end, decision }[]
}

externalCapacity.getOverview(workspaceId) -> {
  contractors: { employeeId, name, contractEndDate, isExpired }[],
  subVendors: { subVendorId, name, activeEngagementCount }[],
  totalPeopleEquivalent: number
}

externalCapacity.listUpcomingRenewals(workspaceId, windowDays?) -> {
  contractorRenewals: { employeeId, name, contractEndDate, workingDaysRemaining }[],
  subVendorEndings: { subVendorId, name, projectName, endDate }[]
}
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | SubVendor carries the schema above. `contracted_with` carries start, end and capacity units per engagement |
| G02 | A SubVendor is always an organization, never an individual. An individual freelancer is an Employee with `employment_type = Contractor` |
| G03 | `contract_end_date` and `contract_renewal_status` apply only to contractors and remain null otherwise |
| G04 | A Converted decision does not alter `employment_type`. It flags that a new contract is appropriate and routes the change through [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] |
| G05 | Sub-vendor capacity never contributes to [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s internal supply figure |
| G06 | Sub-vendor engagements appear in [[VRS-F005_The_Bench_Forecast|VRS-F005]] as a distinct row type, visually separable from internal headcount |
| G07 | Term dates and days remaining resolve through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| G08 | A contractor past their term with no recorded decision is surfaced daily until resolved |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F043-S01 | SubVendor schema and engagements | Data |
| VRS-F043-S02 | Contractor term tracking and renewal | Logic |
| VRS-F043-S03 | Engagement history | Logic |
| VRS-F043-S04 | Unified external capacity view | UI |

---

## Feature Acceptance Criteria

**GIVEN** a SubVendor is engaged for a project with a capacity commitment
**WHEN** it is saved
**THEN** a `contracted_with` edge exists carrying start, end and capacity units, and appears in that organization's active list

---

**GIVEN** a contractor's term end falls within the warning window
**WHEN** the renewals view opens
**THEN** they appear with working days remaining, alongside any ending sub-vendor engagements

---

**GIVEN** a contractor is three working days past their term with no decision
**WHEN** the view renders
**THEN** they render `danger`, and HR Admin has been notified daily since the term ended

---

**GIVEN** a Converted decision is recorded
**WHEN** it is saved
**THEN** `employment_type` is unchanged, a new contract is flagged as appropriate, and the change routes through [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]]

---

**GIVEN** a contractor has been renewed four times
**WHEN** the renewal panel opens
**THEN** the renewal count and full term history are shown before the fifth decision is made

---

**GIVEN** [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s capacity forecast is computed
**WHEN** sub-vendor engagements are checked against it
**THEN** no sub-vendor capacity contributes to the internal supply figure

---

**GIVEN** the same engagements
**WHEN** [[VRS-F005_The_Bench_Forecast|VRS-F005]] renders
**THEN** they appear as distinct rows, visually separable from internal headcount

---

## Non-Functional Requirements

- Overview and renewals views resolve within 200ms from the local graph
- Full functionality offline

---

## Security Considerations

- **SubVendor is Standard, Tier 0.** Finance Admin holds Full ahead of [[VRS-F067_Contractor_Invoice_Management|VRS-F067]]'s invoicing needs; Manager holds Read — visibility without management authority over an organizational relationship that is not theirs to manage.
- **A contractor is an Employee node and inherits every protection that carries**, including the Tier 1 compensation split. A contractor's day rate is compensation and is protected identically to a salary.
- **Engagement history is operationally useful and legally relevant.** A contractor on their fifth consecutive renewal is, in several jurisdictions, approaching the point where the arrangement may be reclassified. This feature surfaces the count and does not offer legal advice about it.

---

## Out of Scope

- **Contractor invoicing and payment** — [[VRS-F067_Contractor_Invoice_Management|VRS-F067]]
- **Automatic contract generation on conversion** — flagged, not executed
- **Sub-vendor capacity counting toward internal hiring decisions** — an absolute exclusion
- **Individual people within a sub-vendor organization.** The engagement is with the organization; who they staff it with is their business. An agency needing named individuals should engage them as contractors
- **Misclassification risk assessment.** The renewal count is surfaced as a fact. Whether a given arrangement crosses a legal line is a question for counsel, not a product feature
- **Sub-vendor performance ratings or a preferred-supplier list** — a procurement concern

---

## Decisions Recorded

**The numbering contradiction is resolved by the renumbering itself.** SubVendor was cited against two different feature numbers in the old architecture document, neither of which was the feature it belonged to. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] now cites this document, and the archeology is unnecessary.

**Conversion routes through [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]].** The previous specification left `employment_type` as a manual edit on the employee record. That feature now owns every change to compensation, title and seniority, and converting a contractor to permanent changes all three.

**Engagement history is added.** A contractor's renewal count is the single most useful fact at the moment of a renewal decision, and it is also the fact that matters in a misclassification question. The previous specification tracked the current term and forgot every prior one.

**An expired term is escalated rather than merely listed.** A contractor working past an expired agreement is the one state in this feature with real legal consequence, and a quiet row in a table is not proportionate.

**The combined people-equivalent figure is added.** How much of delivery capacity is external is a question neither table answers alone, and it is the one a founder actually asks.

---

## Related Notes

- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the Employee node a contractor is
- [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] — the workflow a conversion routes through
- [[VRS-F051_Team_Capacity_Planner|VRS-F051]] — the forecast sub-vendor capacity is excluded from
- [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] — contractor and sub-vendor invoicing

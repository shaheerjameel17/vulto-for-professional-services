---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F042
---

# VRS-F042 — Asset and Gear Tracker

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee, and the offboarding flow that already flags an outstanding asset), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days, for return-date arithmetic), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (the departure whose date drives a return), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where an outstanding asset surfaces), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Asset and the `allocated_to` edge)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A record of company equipment and licenses — laptops, monitors, phones, software seats, badges — allocated to employees, with allocation and return tracked as first-class facts on the graph rather than a spreadsheet somebody updates when they remember.

---

## Problem It Solves

Equipment tracked outside the system that already tracks people reliably goes missing at the moment it matters most: an employee leaves and nobody can say with confidence whether their laptop came back, whether their badge was deactivated, or whether a software seat is still being paid for months after the person who used it has gone.

That last one is a recurring and invisible cost. An agency paying for eleven design seats and using seven has been doing so since the third person left, and nothing surfaces it.

---

## User-Facing Flows

### Adding an asset

An HR Admin adds an asset: a name, a type, a serial or license identifier where applicable, and optionally a purchase date and value.

### Allocating

An available asset is allocated to an employee with an optional expected return date, writing the `allocated_to` edge and setting status Allocated.

### Returning

Marking it returned closes the edge with an actual return date and the asset becomes Available.

### Writing off

An asset that will not come back — lost, stolen, beyond recovery — is written off with a required reason. Status becomes Lost and the edge closes.

### Offboarding

When an employee is offboarded per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], any asset still allocated to them is **flagged, not blocked.**

This follows that feature's own precedent, and the consistency matters: a hard gate on assets and a soft flag on assignments would make offboarding behave differently depending on which loose end happened to be open, which is exactly how a process becomes something people work around.

An admin view lists every asset allocated to an inactive employee, so nothing has to be remembered — only checked.

### Ahead of a departure

Where a Departure exists per [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]], allocated assets surface **before** the last working day rather than after. Chasing a laptop from someone who has already left is materially harder than asking them to bring it in on Thursday.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Assets | Content + Panel | Inventory |
| Employee assets | Section on the profile | What one person holds |
| Outstanding | Content | Allocated to inactive or departing employees |

### Layout and components

**Assets** is a Table: name, type Badge, serial, status Badge, allocated to, expected return. Filters as a Toggle Group for status and a Select for type.

A **utilization strip** sits above for License-type assets specifically: total seats, allocated, available, in `mono`. Where available seats exceed a threshold the figure renders `attention`, because unused paid seats are the cost this feature is most likely to actually recover.

**Employee assets** on the profile is a compact list: name, type, allocated date, expected return. Overdue against an expected return renders `attention`.

**Outstanding** is a Table: asset, employee, employment status, last working day where a departure exists, days since. Sorted by last working day ascending — a person leaving Friday outranks someone who left last month, because one is still reachable.

Departing employees render `attention` and appear above already-inactive ones. **This is the ordering that recovers equipment**, and it is the reverse of what a naive sort by age would produce.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Standard, Tier 0. Finance Admin reads purchase values; every role sees allocations |
| Overdue | Past an expected return renders `attention` |
| Empty | *No assets recorded.* with **Add asset** |
| Error | Allocating an asset that is not Available is refused, naming the current holder |

### Responsive

Drops `serial`, then `purchase value`, below 1280px.

---

## Technical Architecture

### The Asset schema

Standard, Tier 0.

```
asset_id:          UUID v4
workspace_id:      UUID
name:              string, required
asset_type:        enum: Laptop, Monitor, Phone, License, Badge, Other
serial_number:     string, nullable — a license key or seat identifier for a
                   License-type asset, a physical serial otherwise
status:            enum: Available, Allocated, Retired, Lost
purchase_date:     date, nullable
purchase_value:    decimal, nullable
currency:          ISO 4217, nullable — defaults from the Entity per VRS-F003
write_off_reason:  text, nullable, required when status becomes Lost
notes:             text, nullable

— Universal Node Conventions per VPS-A002 —
```

### Physical and digital treated identically

A software seat is modeled exactly as a laptop is: one `allocated_to` edge, at most one active, following single-active-with-history.

*Returning* a license means deallocating a seat rather than shipping anything, but the graph shape is identical — one asset, one employee, one active edge, full history preserved on change. **No separate handling for a digital asset type**, which is what makes the outstanding view catch a forgotten seat as readily as a forgotten laptop.

### Working days

`expected_return_date` is validated against [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] and snapped forward to a working day where it falls on a non-working one, the same treatment [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] applies to a last working date. Asking someone to return equipment on a day the office is closed is a return that will not happen.

### The outstanding query

A read query joining `allocated_to` against Employee's `employment_status` and any Active Departure. It stores nothing and introduces no alert node type — the same pattern [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s overcommitment sweep uses.

Where a Departure exists, the query includes the last working date, which is what drives the ordering and the pre-departure surfacing.

### API contracts

```
asset.create(name, assetType, serialNumber?, purchaseDate?, purchaseValue?)
  -> { assetId }

asset.allocate(assetId, employeeId, expectedReturnDate?)
  -> { success, returnDateAdjusted }
  // Requires status Available. Snaps the return date to a working day

asset.markReturned(assetId)          -> { success }
asset.writeOff(assetId, reason)      -> { success }
asset.retire(assetId)                -> { success }
  // End of life while unallocated. Distinct from Lost

asset.listForEmployee(employeeId)    -> Asset[]
asset.listOutstanding(workspaceId)   -> {
  assetId, assetName, employeeId, employeeName, employmentStatus,
  lastWorkingDate?, daysSince
}[]
  // Covers inactive employees and those with an Active Departure

asset.licenseUtilization(workspaceId) -> {
  assetName, totalSeats, allocated, available
}[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Asset carries the schema above |
| G02 | `allocated_to` follows single-active-with-history. At most one active edge per Asset; a reallocation closes the prior edge, full history preserved |
| G03 | `actual_return_date` is set only through `asset.markReturned`. Never backfilled or inferred |
| G04 | The outstanding query stores nothing and introduces no alert node type |
| G05 | Offboarding flags an outstanding asset. It never blocks the status change, matching [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]'s treatment of an open Assignment |
| G06 | Allocated assets surface before a last working date where a Departure exists, not only after offboarding completes |
| G07 | `expected_return_date` snaps to a working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| G08 | A License-type asset follows the identical allocation model. No separate handling exists |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F042-S01 | Asset schema and inventory | Data |
| VRS-F042-S02 | Allocation and return | Logic |
| VRS-F042-S03 | Write-off | Logic |
| VRS-F042-S04 | Outstanding and pre-departure surfacing | UI |
| VRS-F042-S05 | License seat utilization | UI |

---

## Feature Acceptance Criteria

**GIVEN** an available asset is allocated with an expected return date
**WHEN** it is saved
**THEN** the edge exists carrying allocation and expected return dates, and status is Allocated

---

**GIVEN** an expected return date falling on a Friday in a UAE entity
**WHEN** the allocation is saved
**THEN** the date snaps forward to a working day and the adjustment is stated

---

**GIVEN** an allocated asset is marked returned
**WHEN** the return is recorded
**THEN** the edge closes with an actual return date and the asset becomes Available

---

**GIVEN** a write-off without a reason
**WHEN** it is submitted
**THEN** it is refused until a reason is given

---

**GIVEN** an employee with two allocated assets is offboarded
**WHEN** offboarding completes
**THEN** their status becomes Inactive as normal and both assets appear in the outstanding view — the identical treatment their open assignments receive

---

**GIVEN** an employee has a Departure with a last working day next Friday
**WHEN** the outstanding view is checked today
**THEN** their allocated assets appear now, above already-inactive employees, while the person is still reachable

---

**GIVEN** a software seat is allocated to someone later offboarded
**WHEN** the outstanding view is checked
**THEN** the license appears exactly as a physical asset would, with no separate handling

---

**GIVEN** eleven design seats exist with seven allocated
**WHEN** the utilization strip renders
**THEN** it states eleven total, seven allocated, four available

---

## Non-Functional Requirements

- Asset list and allocation views resolve within 200ms from the local graph
- The outstanding query resolves within 300ms across 150 employees
- Full functionality offline

---

## Security Considerations

- **Asset carries no elevated privacy concern.** Standard, Tier 0 — equipment allocation is operational data.
- **`purchase_value` follows Asset's Standard default** and is not treated as sensitive financial data requiring a tier split. A laptop's purchase price carries no comparable confidentiality concern to a billing rate or a contract's content.
- **Who holds which equipment is visible workspace-wide**, which is correct and worth naming: it means a colleague can see that someone has a newer laptop. That is an ordinary fact about an office, and restricting it would break the practical uses of the record.
- **Writing off an asset is audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]]. An asset marked lost is occasionally a fact someone asks about later.

---

## Out of Scope

- **Depreciation or amortisation** — `purchase_value` is recorded as a fact. Computing depreciation is [[Vulto Accounts]]' territory
- **Barcode or QR scanning** — manual entry
- **A proactive overdue sweep independent of departure.** The outstanding view and the expected-return indicator cover it; a separate alerting engine for overdue monitors would be noise
- **Insurance claims for a lost asset** — the reason is recorded, not a claims workflow
- **Procurement or purchase approval** — this feature tracks what exists, not how it was bought
- **Automatic license deprovisioning on offboarding** — deliberately excluded. Deallocating a seat in this graph does not revoke access in the vendor's system, and a feature that implied otherwise would be worse than one that flags it for a person to action

---

## Decisions Recorded

**Assets surface before a departure, not only after offboarding.** The previous specification caught an outstanding asset once the employee was already Inactive, which is the point at which recovering a laptop becomes materially harder. Where a Departure exists, the asset surfaces while the person is still in the building.

**The outstanding view sorts by last working day ascending**, so someone leaving Friday outranks someone who left last month. A naive sort by age would put the unrecoverable cases first.

**License seat utilization is added.** An agency paying for eleven seats and using seven has been doing so since the third person left, and nothing in the previous specification would have surfaced it. It is likely the most direct cost recovery this feature offers.

**`expected_return_date` snaps to a working day**, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Asking for equipment back on a day the office is closed produces a return that does not happen.

**Automatic license deprovisioning is excluded deliberately.** Deallocating a seat here does not revoke access in the vendor's system, and a feature implying otherwise would leave an agency believing access was removed when it was not — worse than a flag that requires a person to act.

---

## Related Notes

- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the offboarding flow this feature's flags appear in
- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — the departure whose date drives pre-emptive surfacing
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days return dates snap to

---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Mature
Feature Type:
  - Platform
aliases:
  - VPS-F010
---

# VPS-F010 — Custom Fields and Workspace Extensibility

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (CustomFieldDefinition and CustomFieldValue, and the lightweight scalar-FK pattern reused for NodeReference), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (the tier model this feature deliberately stays clear of), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the workspace-configuration permission shape), [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (`start_date`, the one named exception the formula engine may touch), [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] (where fields are configured)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Opinionated, not infinite

Vulto's philosophy is opinionated software with best practice already embedded. **A feature with no limit is the opposite of that philosophy wearing this feature's name** — it lets a workspace quietly rebuild, one field at a time, exactly the ungoverned mess this graph exists to replace.

Two mechanisms hold the line, and neither is advisory.

**A hard cap: ten active definitions per workspace, total.** Counted across every node type **and every application** combined, never per type, never per application, **never scaled by plan or headcount.** Nine applications at ten fields each is ninety, which is precisely the sprawl this cap exists to prevent. A four-hundred-person agency and a twelve-person one draw from the identical budget. This is the actual enforcement of *regardless of company size*, and it forces the same question this project forces everywhere: is this genuinely among the handful of things this workspace needs that nothing else anticipated.

**A reserved-concept check at creation.** The likelier risk is not running out of slots — it is a workspace reinventing something this product already has a strong opinion about. A custom *Performance Rating* competing with [[VRS-F039_Performance_Review_Cycle|VRS-F039]]'s review cycle; a custom *Leave Type* re-deriving [[VRS-F018_Leave_Policy_Engine|VRS-F018]] from scratch. A proposed label and key are checked, by whole word, against a curated list of terms this product owns a real feature for, and a match is **rejected with that feature named.**

That is a heuristic and it is stated as one — someone determined can word around it. But a mechanism that actively redirects toward the built-in answer is a different posture from a blank text box beside which a shadow system grows quietly.

---

## The wall this feature draws around itself

A custom field is by definition one nobody thought through the way every other field in this graph was thought through.

Letting an Owner add an arbitrary field to WellnessTriggerEvent or PayRun would mean **a founder with no visibility into what Tier 1 and Tier 3 protect against could quietly create a field that never receives envelope encryption**, never gets excluded from a push payload, never gets the disclosure treatment a Tier 3-adjacent aggregate needs.

Custom fields are available on a curated allowlist of **Tier 0 node types only** — Employee, Project, Client, Candidate, Assignment, OpenRole, SubVendor. Tier 1 and Tier 3 are excluded absolutely; Tier 2 is excluded as hygiene rather than necessity.

---

## Formulas: primitive enough to be useful, deliberately no further

Two sibling fields on one record — a rate and a count, a start date and today — is a real need, and forcing a workspace outside the product for it would be its own failure.

**What a formula may do.** Exactly one operation from a fixed set — Add, Subtract, Multiply, Divide, Percentage Of, Days Between — on exactly two operands. Each operand is a sibling custom field, a constant, or for Days Between the current date. No nesting, no formula referencing another, no conditional logic.

**The one named exception.** A Days Between formula on Employee may reference the real `start_date`. Tenure is common enough to earn a narrow carve-out rather than forcing every workspace to duplicate a field the graph already has. **It is the only real system field this engine may ever touch**, and not a precedent for widening that.

**What a formula may never do, permanently.** Count or sum across related records is **structurally excluded, not deferred.** This product already has deliberate opinions about workforce reporting — [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] for utilization, [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] for bench cost, [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] for trends, [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] for cost. Letting a workspace hand-build a parallel version through a generic mechanism would construct an ungoverned copy of exactly what an opinionated product exists to build once, correctly, for everyone.

**Custom field values are never read by those four features' computations.** Custom data stays at the record it lives on.

---

## What It Is

A small, hard-capped set of workspace-configured field definitions on a curated Tier 0 allowlist, with a reserved-concept check steering toward the built-in answer, and a deliberately primitive same-record formula type.

---

## Problem It Solves

Ninety-odd node types were each considered carefully, and none of that consideration anticipates every agency's reality — a compliance attestation one jurisdiction requires, an internal project coding convention, a vendor field nothing here tracks.

Without this, those needs go unmet or get stuffed into a free-text field never meant to hold them. **With no discipline on top, the same mechanism becomes the opposite problem** — a pile of fields nobody remembers the purpose of eighteen months later.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Custom fields | Content + Panel | Definition. From [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Field section | On each allowed node's detail view | Values |

### Layout and components

**Custom fields** is a Table: label, node type, field type Badge, fill rate, active. Above it, the budget stated plainly in `numeric`: **7 of 10 used.**

That counter is the feature's most important element. A cap discovered at the moment of rejection is a cap that feels arbitrary; a cap visible from the first field created is a budget somebody spends deliberately.

**The definition Panel** carries the type selector, and for Formula a small builder: operation, operand A, operand B, with a **live worked example** against a sample record beneath. A formula whose arithmetic is wrong is discovered by whoever reads a record, not by its author, unless the author can see it compute.

**A reserved-concept rejection renders inline, not as an error toast** — the proposed label, the matched term, and the feature to use instead, with a link. *Performance is tracked in the Performance Review Cycle.*

**Fill rate** is a column rather than an annual report. The previous specification surfaced usage once a year; a column visible whenever someone opens this screen fights accumulation continuously and costs nothing.

**On a node's detail view**, custom fields sit in their own Section headed plainly, beneath the record's real fields. Formula fields render read-only in `text-secondary`, since there is nothing to enter.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner and HR Admin write. Every role reads, per the workspace-configuration pattern |
| Cap reached | The counter renders `attention` and creation is refused with the count stated |
| Reserved | Inline rejection naming the feature to use |
| Deactivated | Existing values remain visible on every record; the field is no longer offered on new ones |
| Broken formula | Renders as unavailable, never a stale or fabricated figure |
| Empty | *No custom fields.* with a line noting the budget of ten |

### Responsive

The definition Panel stacks. Node-level field sections are unchanged.

---

## Technical Architecture

### CustomFieldDefinition

Standard, Tier 0.

```
custom_field_definition_id: UUID v4
workspace_id:               UUID
node_type:                  enum: Employee, Project, Client, Candidate,
                            Assignment, OpenRole, SubVendor — the allowlist.
                            No Tier 1, 2 or 3 type is ever selectable
field_key / label:          string, required — both checked against the
                            reserved-concept list
field_type:                 enum: Text, Number, Date, SingleSelect,
                            MultiSelect, Boolean, URL, NodeReference, Formula
select_options:             JSON array, nullable
reference_target_node_type: string, nullable — must itself be on the allowlist
formula_operation:          enum: Add, Subtract, Multiply, Divide,
                            PercentageOf, DaysBetween — nullable
formula_operand_a_source / _b_source: enum: CustomField, Constant, Today,
                            EmployeeStartDate — EmployeeStartDate valid only
                            on Employee with DaysBetween
formula_operand_a_value / _b_value: string, nullable
is_required:                boolean — forced false for Formula
display_order:              integer
is_active:                  boolean, default true

— Universal Node Conventions per VPS-A002 —
```

### CustomFieldValue

Tier inherited from its parent node.

```
custom_field_value_id:      UUID v4
workspace_id:               UUID
custom_field_definition_id: UUID — never set for a Formula field
node_id:                    UUID
node_type:                  string — denormalized for query convenience
value:                      JSON, matching the definition's type
referenced_node_id:         UUID, nullable — NodeReference only

— Universal Node Conventions per VPS-A002 —
```

At most one value per node and definition pair.

### A Formula never has a value record

Computed live from its operands at every read, never persisted — consistent with gross pay, leave balance and bench time. **Nothing to keep in sync, because nothing was written down to fall out of sync.**

### Both checks run before any write

The reserved-concept match is checked **first**, so a rejection names the feature to use rather than the cap. Then the active count.

### Not a second Reference Protocol

A NodeReference value is a plain scalar, not a GraphReference edge, and **deliberately does not appear in [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]]'s Referenced In panel** — that is the record of `@` mentions in rich text, and conflating them would blur a distinction worth keeping.

### Permission, entirely inherited

A value is visible if and only if the viewer has Read on its parent node. **No independent check, no permission row for CustomFieldValue.**

### API contracts

```
customFieldDefinition.create(nodeType, fieldKey, label, fieldType, ...) -> {
  customFieldDefinitionId
} | { rejected: 'ReservedConcept', redirectFeature } | { rejected: 'CapReached', activeCount }
  // Reserved-concept checked first, with the redirect named

customFieldDefinition.deactivate(id) -> { success }
  // Frees a slot. Existing values are never deleted or hidden

customFieldDefinition.listForNodeType(nodeType) -> CustomFieldDefinition[]
customFieldDefinition.budget(workspaceId) -> { active, cap, fillRates }

customFieldValue.set(nodeId, definitionId, value) -> { customFieldValueId }
  // Refused for a Formula field

customFieldValue.listForNode(nodeId) -> {
  fieldKey, label, fieldType, value, isComputed
}[]
  // Stored values and live formula results together. Filtered per the
  // caller's existing access to nodeId. No independent check
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Both node types carry the schemas above. `has_custom_value` and `defined_by` connect them |
| G02 | `node_type` is restricted to the Tier 0 allowlist. No Tier 1, 2 or 3 type is ever selectable, structurally |
| G03 | At most 10 active definitions per workspace across every node type combined, enforced at write |
| G04 | A label or key matching a reserved concept is rejected with the existing feature named, checked before the cap |
| G05 | A Formula field never has a value record. Its result is computed live at every read |
| G06 | Formula operands are restricted to a sibling field, a constant, Today, or `start_date` on Employee for DaysBetween only. No formula references another formula |
| G07 | No custom field of any type ever aggregates across related records. A permanent structural exclusion |
| G08 | Custom field data is never read by [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]], [[VRS-F012_Revenue_Gap_Alert|VRS-F012]], [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] or [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]]'s computations |
| G09 | A NodeReference is a scalar, never a GraphReference edge, and never appears in [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]]'s panel |
| G10 | CustomFieldValue carries no independent permission check. Visibility is inherited from its parent node |
| G11 | `node_type` and `field_type` are immutable after creation. Changing what a field means is a new field |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F010-S01 | Definition schema, allowlist and cap | Data |
| VPS-F010-S02 | Reserved-concept check and redirect | Logic |
| VPS-F010-S03 | Value schema and type validation | Data |
| VPS-F010-S04 | NodeReference | Logic |
| VPS-F010-S05 | Formula, live computation | Logic |
| VPS-F010-S06 | Field sections and budget surface | UI |

---

## Feature Acceptance Criteria

**GIVEN** a workspace has 10 active definitions
**WHEN** an eleventh is attempted on any node type
**THEN** it is rejected with the limit stated and deactivation suggested

---

**GIVEN** a field labeled *Performance Notes* is attempted on Employee
**WHEN** creation runs
**THEN** it is rejected naming [[VRS-F039_Performance_Review_Cycle|VRS-F039]] as the intended mechanism, before the cap is checked

---

**GIVEN** a Days Between formula with Today and a Date-type sibling
**WHEN** a record is viewed
**THEN** the value computes correctly and no value record exists for that field on any record

---

**GIVEN** that formula's operand field is later deactivated
**WHEN** the formula is next read
**THEN** it renders as unavailable, never a stale or fabricated figure

---

**GIVEN** an HR Admin attempts to configure a formula summing across timesheet entries
**WHEN** the configuration is attempted
**THEN** no such option exists to select. Cross-record aggregation is not a capability this feature offers

---

**GIVEN** heavily used custom fields on Employee
**WHEN** [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]], [[VRS-F012_Revenue_Gap_Alert|VRS-F012]], [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] or [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] compute
**THEN** none of their outputs is influenced by any custom value

---

**GIVEN** a definition is deactivated
**WHEN** the budget is next checked
**THEN** it no longer counts, a new field may be created, and its existing values remain visible

---

**GIVEN** a Finance Admin attempts to create a definition
**WHEN** the attempt is made
**THEN** it is refused per the workspace-configuration permission shape

---

## Non-Functional Requirements

- Values, including formula computation, resolve within 100ms alongside a node's detail view, no separate round trip
- Defining, setting, computing and reviewing all function offline
- `node_type` and `field_type` are immutable after creation

---

## Security Considerations

- **The cap and the reserved-concept check are product-philosophy decisions with security-adjacent consequences.** An unbounded extensibility mechanism is exactly how a carefully tiered graph accumulates an untiered shadow copy of itself, one convenient field at a time.
- **The permanent exclusion of cross-record aggregation is the same class of decision as the Tier 0 allowlist.** Both exist so this feature can never become the ungoverned backdoor around a boundary — cryptographic in one case, curatorial in the other — built deliberately elsewhere.
- **A NodeReference can never leak the existence of a node the viewer cannot already see**, the same discipline applied throughout.
- **Custom values are excluded from [[VPS-F002_Local-First_Search|VPS-F002]]'s search index.** A field nobody classified should not become findable by content nobody reviewed.

---

## Out of Scope

- **Custom fields on any Tier 1, Tier 2 or Tier 3 node type** — an absolute exclusion
- **Any formula operation beyond the six** — a genuinely common seventh is a separate decision
- **Cross-record count or sum, in any mechanism** — permanently excluded
- **Referencing any real system field beyond `start_date`** — a narrow named exception, not a precedent
- **Raising the cap, per workspace, per plan, or by any dimension** — ten is the number. Reconsidering it is a product decision, not a configuration or a support request
- **Rich-text custom fields participating in the Reference Protocol** — deliberately separate
- **Conditional fields scoped to a subset of a node type** — fields apply uniformly across their type

---

## Decisions Recorded

**Fill rate becomes a visible column rather than an annual report.** The previous specification surfaced usage once a year; a column present whenever someone opens the screen fights accumulation continuously and costs nothing to render.

**The budget counter is displayed from the first field created.** A cap discovered at the moment of rejection feels arbitrary; a cap visible throughout is a budget somebody spends deliberately.

**A live worked example is added to the formula builder**, matching [[VRS-F063_Tax_and_Compliance_Configuration|VRS-F063]]'s tax bracket editor. A formula whose arithmetic is wrong is otherwise discovered by whoever reads a record rather than by its author.

**Custom values are excluded from search.** Not previously stated, and a real consideration — a field nobody classified should not become findable by content nobody reviewed.

---

## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the registry entries this document completes
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the Reference Protocol this feature is deliberately not
- [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] — where fields are configured
- [[VPS-F002_Local-First_Search|VPS-F002]] — the index custom values are excluded from

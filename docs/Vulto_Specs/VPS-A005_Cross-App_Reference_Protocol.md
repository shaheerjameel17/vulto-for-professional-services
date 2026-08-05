---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-A005
---

# VPS-A005 — Cross-App Reference Protocol

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (node registry and privacy classes), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (tier model), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission matrix)
**Blocks:** Every feature with a rich text field, in every application

This document is the single source of truth for how `@` mentions work, what they may point at, and what they create in the graph.

**Mentions cross applications.** A note on a Projects deliverable can mention a Roster employee, and the reference appears on that person's profile — which is the whole reason this protocol is named for cross-application use rather than in-application linking.

---

## Decision

Every rich text field supports `@` as a trigger for the Reference Protocol. Typing `@` opens a typeahead picker searching the graph nodes the current user may access. Selecting a result inserts a mention token and creates a persistent, bidirectional GraphReference edge.

**Text fields are not dead ends. Every mention is a graph edge.**

---

## Context

In conventional software, a manager typing an employee's name in a project note creates a string with no structural meaning. The Reference Protocol converts that missed opportunity into a graph edge. Over time the graph accumulates connections passively, through the natural act of writing, without anyone manually tagging anything.

This is a primary mechanism by which [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] gains traversal surface, and it must be active from MVP rather than deferred to the intelligence phase — a reasoning layer switched on three years in has no accumulated references to reason over.

The mention token lives inside a Loro Rich Text CRDT container, which is one of the specific reasons Loro was selected over Automerge and Yjs in [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]. The GraphReference edge is a separate graph object created synchronously alongside the text edit, never derived from the text content after the fact.

---

## Protocol specification

### Trigger

The `@` character in any field whose type is `rich_text` opens the picker. Supported: notes, descriptions, comments, assessments, briefs, case narratives. Plain text fields — names, short inputs — do not support the protocol.

### Reference picker

A typeahead search against the local SQLite-WASM index defined in [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]. Never a remote API, never the raw Loro documents. Results return within the 30ms budget in [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]], rendered per the Command Palette specification in [[VPS-D002_Component_Library|VPS-D002]].

Results are grouped by node type in this display order:

1. People — Employee
2. Projects
3. Clients
4. Skills
5. Documents
6. Open Roles
7. Policies

**Eligibility is a rule, not a fixed list.** Only node types classed **Tier 0** in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] are eligible as mentionable targets by default. As new Tier 0 node types are registered, they become mentionable automatically, without amending this document.

**Tier 2 node types may be made mentionable case by case** — Contract is a plausible example — but the resulting edge inherits the more restrictive tier of its endpoints for sync purposes. This is a deliberate per-node-type decision made when the relevant feature is specified, never a default.

**Tier 1 and Tier 3 node types are never eligible, under any circumstance.** This closes a real gap. A reference a viewer cannot decrypt still reveals that *something* was mentioned, and for wellness data the mere existence of a reference to Employee X's WellnessTriggerEvent would violate [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s absolute rule that no indication of its existence may surface for anyone but the owner. A GraphReference is metadata, and metadata about a Tier 1 or Tier 3 node is precisely the leak the tier model exists to prevent.

This is a permanent architectural constraint, not a deferral. The picker must not surface these node types regardless of how tier assignments evolve elsewhere.

### Selection

Selecting a result performs two operations:

1. Inserts a formatted mention token at the cursor.
2. Creates a GraphReference edge immediately and synchronously.

### GraphReference schema

```
source_node_id:      UUID — the node containing the text field
source_node_type:    string
source_field_name:   string — the specific field the mention appears in
target_node_id:      UUID — the referenced node
target_node_type:    string
context_excerpt:     string — 100 characters surrounding the token
excerpt_is_stale:    boolean — set if surrounding text has since changed
created_by:          UUID
created_at:          ISO 8601, UTC
is_soft_deleted:     boolean
soft_deleted_at:     ISO 8601, null if not deleted
soft_deleted_by:     UUID, null if not deleted
```

### Tier-aware sync

Edges inherit the more restrictive tier of the nodes they connect — a general rule stated in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], not specific to this protocol, though this is where it matters most in practice.

A mention created inside a broadly synced Tier 0 project note, pointing at a Tier 2 Contract, produces an edge that syncs only to devices that would also receive the Contract. Without that rule, a Tier 0 document carrying an edge referencing a Tier 2 node by ID would leak the existence of that reference to devices never meant to see it, even with the target's own content properly restricted.

### Referenced In panel

Every node type automatically exposes a Referenced In section in its detail view — a single shared component requiring zero feature-specific implementation, rendered in the Panel specified by [[VPS-D002_Component_Library|VPS-D002]]. It reads all GraphReference edges pointing at the current node and displays, for each: the source node's name and type, the context excerpt, the creation date, and who created it.

The panel is **structurally incapable** of showing anything for a Tier 1 or Tier 3 node, because no GraphReference can target one — rather than relying on the panel's own display logic to filter something out. A guarantee enforced by what cannot be created is stronger than one enforced by what is not displayed.

### Permission inheritance

A GraphReference is visible only where the user holds at minimum `Read` on **both** the source and the target, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]. Read access to one but not the other means the reference appears in neither node's Referenced In panel for that user.

### Deletion

Deleting a mention token soft-deletes the corresponding edge, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Universal Edge Conventions. The mention disappears from the Referenced In panel. The edge record is preserved with its deletion timestamp and acting user. Hard deletion is prohibited.

---

## Technical specifications

| ID | Specification |
|---|---|
| A005-T01 | The picker MUST return results within 30ms from the local index, per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]. Remote API calls for picker results are prohibited |
| A005-T02 | GraphReference edges MUST be created synchronously at selection, never deferred to a background job |
| A005-T03 | Deleting a mention token MUST soft-delete the edge. Hard deletion is prohibited |
| A005-T04 | The Referenced In panel MUST be a single shared component, reusable on any node detail view with zero node-type-specific implementation |
| A005-T05 | The picker MUST respect [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s rules at query time, through the same interceptor every other query passes |
| A005-T06 | `context_excerpt` MUST reflect the text at creation time, with `excerpt_is_stale` set if surrounding text has since been modified |
| A005-T07 | The picker MUST NOT surface any Tier 1 or Tier 3 node type as a selectable result, under any configuration, for any role including Owner |
| A005-T08 | A GraphReference MUST sync per the edge-tier-inheritance rule in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], taking the more restrictive tier of its endpoints, not its source's tier alone |
| A005-T09 | A node type newly registered as Tier 0 in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] becomes mentionable automatically, without a change to this document |
| A005-T10 | Where a mention's target is later erased under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]], the token MUST render as an inert label retaining no identifying content, and the edge MUST remain soft-deleted rather than dangling |

---

## Acceptance criteria

**GIVEN** a manager types `@` in a project note and selects an Employee
**WHEN** the selection is confirmed
**THEN** a GraphReference is created immediately, the mention renders as a formatted link, and the note appears in the Referenced In panel on that Employee's profile within 1 second without a refresh

---

**GIVEN** a GraphReference exists from Project Note A to Employee X
**WHEN** a user without Read on Note A opens Employee X's profile
**THEN** the reference does not appear — neither the mention nor the note is visible or indicated

---

**GIVEN** a user deletes a mention token
**WHEN** the deletion saves
**THEN** the edge is soft-deleted, the mention disappears from the panel within 1 second, and [[VPS-F004_Silent_Audit_Log|VPS-F004]] contains an entry with acting user, edge ID, timestamp and action type

---

**GIVEN** a user types `@` and three or more characters
**WHEN** results appear
**THEN** they render within 30ms, measured on a device with no network connection

---

**GIVEN** a user searches for an employee's wellness record or salary
**WHEN** the picker returns results
**THEN** no Tier 1 or Tier 3 node type appears, regardless of the searching user's role, including Owner

---

**GIVEN** a Tier 0 project note mentions a Tier 2 Contract
**WHEN** a device not authorized for that Contract syncs
**THEN** the GraphReference does not sync to that device, and the note's other content syncs normally without indicating a reference was made

---

**GIVEN** a mention's target Employee is erased under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]
**WHEN** the containing note is opened
**THEN** the token renders as an inert label with no identifying content, the surrounding text is intact, and no dangling reference error occurs

---

## Out of scope

- Mentions to nodes outside the Vulto graph. The protocol is internal; cross-suite references to [[Vulto Network]] and other products are a Mature-phase concern
- Bidirectional rich embeds. A mention renders as a formatted link, not an embedded preview
- Mentions in plain text fields
- Making Tier 1 or Tier 3 node types mentionable under any future configuration. This is a permanent constraint, not a phase deferral

---

## Decisions recorded

**Erasure interaction is specified.** [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] can erase a node that existing mentions point at, and no previous version of this document said what happens to those mentions. A dangling reference in a case narrative or a performance note would either error or, worse, retain the erased person's name in the token label — defeating the erasure at the exact point it is most visible. A005-T10 resolves it.

**Policy is added as a mentionable category**, following the automatic-eligibility rule for newly registered Tier 0 node types. It is listed explicitly because [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] makes referencing a specific policy version from a case narrative a routine operation.

**The picker's latency budget is aligned with [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]** at 30ms, tightened from the previous 50ms, matching the search budget the same local index already serves.

---

## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the registry defining which node types are Tier 0 and therefore mentionable
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the edge-tier-inheritance rule this protocol depends on
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission rules governing reference visibility
- [[VPS-D002_Component_Library|VPS-D002]] — the picker and panel components
- [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] — the reasoning layer these accumulated references feed

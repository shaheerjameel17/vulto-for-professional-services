---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Platform
aliases:
  - VPS-F002
---

# VPS-F002 — Local-First Search

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the SQLite-WASM index and its Web Worker boundary), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission-filtered results through the shared interceptor), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (the skill-match engine this palette routes to), [[VPS-D002_Component_Library|VPS-D002]] (the Command Palette component)
**Blocks:** Nothing structurally, though it becomes the primary navigation surface for every feature that follows.

This document is the single source of truth for this feature.

---

## What It Is

A single command palette, `Cmd+K` from anywhere, searching every nameable **Tier 0** entity in the graph entirely from the local index with no network round-trip. An entity whose name is itself Tier 1, Tier 2 or Tier 3 is not on the device, cannot be in the local index, and is searched on the server instead — see *Search beyond Tier 0* below.

When a query matches a Skill by name, the palette also shows [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s ranked-by-availability matches for that skill alongside any direct name matches. **Two kinds of result, one box, one keystroke.**

This feature owns the keystroke and the palette. [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] owns the skill-matching logic beneath one kind of result within it. There is exactly one `Cmd+K` in this product.

---

## Problem It Solves

Finding one specific thing — a particular person, a project by name, a document filed against a profile — otherwise means knowing which section of the product it lives in and navigating there through a list. Tolerable occasionally, genuinely slow as a daily habit.

One instant, always-available search collapses that to a keystroke and a few characters. And because the Tier 0 half is local-first it works exactly as fast offline as connected: no spinner, no *searching* state, no difference the user can perceive between the two. That guarantee is scoped to what the device holds; the server-backed half is slower, online-only and is described in its own section rather than pretended away.

---

## User-Facing Flows

### Opening

`Cmd+K` from anywhere, over any screen, without navigating away. Typing returns results immediately with no submit action.

### General entity search

Typing a name returns matching entities grouped by type, each with a type indicator and a line of context — a person's job title, a project's client, a document's category. Selecting navigates directly.

### A skill-shaped query

Where the text matches a Skill's name, a distinct section shows people holding that skill ranked by availability — [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s ad-hoc match, called rather than reimplemented.

This section appears **alongside**, not instead of, direct name matches for the same text. A skill can coincidentally share text with an entity name, and both are legitimate answers to what was typed.

### Commands

Typing a verb rather than a noun surfaces actions: *create employee*, *add assignment*, *go to bench forecast*. The palette is one surface with several capabilities, not several palettes sharing a shortcut.

### No results

A plain, honest empty state. Not an error, and not a suggestion to search external tools this product has no connection to.

---

## Interface Specification

### Screen

The Command Palette component from [[VPS-D002_Component_Library|VPS-D002]] — `overlay` elevation, 640px, top-anchored at 15% viewport height. This feature specifies its content and behavior; the component owns its appearance.

### Layout

Results are grouped with `micro` uppercase headers in a fixed order: **Commands**, **People**, **Skill matches**, **Projects**, **Clients**, **Documents**, **Policies**. Commands lead because a user who typed a verb wants them first, and a user who typed a name will not have matched any.

Each row shows the entity name at `body-medium`, its type as a `subtle` Badge, and one line of the most decision-relevant context available at `small` in `text-secondary`.

**For a person, that context line is their availability and next rolloff date**, not their email or department. The question behind almost every search in this product is *can they take this work*, and answering it in the result row means the palette often ends the task rather than beginning it.

Skill-match rows show name, matched skill with proficiency, and availability, visually distinguished from a direct name match by their group header alone. Ghost results carry the dashed treatment from [[VPS-D001_Design_Foundations|VPS-D001]].

There is no result count, no *searching* state, and no shimmer on the local results. At a 30ms budget they are simply present. Server-backed results (below) are a separate group that arrives when the server answers, and never delay or reorder what is already on screen.

### Keyboard

| Key | Action |
|---|---|
| `Cmd/Ctrl + K` | Open |
| `↑` `↓` | Move between results, crossing group boundaries |
| `Enter` | Open the selected result |
| `Cmd + Enter` | Open in the Panel without leaving the current screen |
| `Escape` | Close |

The palette is entirely keyboard-operable and never requires a mouse to reach any result.

### System states

| State | Treatment |
|---|---|
| Syncing | Results render from whatever is indexed. The palette never blocks on sync |
| Restricted | A restricted entity does not appear. There is no indication it exists |
| Empty | *No matches for "{query}".* Nothing more |
| Error | Not applicable to local results — a local index query does not fail in a way a user can act on |
| Server-backed group, offline or unreachable | The `requires-connection` state from [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], with its **Retry** action, in place of that group only. The local results are unaffected |

### Responsive

Below 768px the palette is full-screen with the input pinned to the top, and results are single-column with the context line wrapping to two lines.

---

## Technical Architecture

### The index

SQLite FTS5 virtual tables, one per searchable node type, indexing **identifying fields only**.

**The table below is a registry, not a fixed list.** Each application registers its own searchable node types here, per [[VPS-000_Documentation_Standard|VPS-000]]'s Standing Rule 7. Roster's registration is the initial one; [[Vulto Projects]] adds Project, Deliverable and Client when it ships.

| Node type | Indexed fields | Registered by |
|---|---|
| Employee | `full_name`, `preferred_name`, `job_title` | Vulto Roster |
| Skill | `name`, `category` | Vulto Roster |
| Document | `file_name` | Vulto Roster |
| Policy | `title` | Vulto Roster |
| Client | `name` | [[Vulto Projects]] |
| Project | `name` | [[Vulto Projects]] |
| Deliverable | `title` | [[Vulto Projects]] |

These tables are maintained by triggers on the same content tables [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s materialization already populates — part of that existing pipeline, not a separate reindex job on its own schedule.

**As new Tier 0 node types are registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], they become indexable by adding a row above.** The set is open by design, and an application extends it here rather than building a second index.

**One search surface, every application.** `Cmd+K` from anywhere in the suite searches everything the user may see, regardless of which application registered it. A person who half-remembers a name should not have to know which application owns it.

### What is never indexed

Tier 1 and Tier 3 fields are **never written to an FTS table at all** — not filtered at query time, never present.

Two reasons stack. Tier 1, Tier 2 and Tier 3 data is never on a device at all ([[VPS-A003_Unified_Sync_Architecture|VPS-A003]]): the device cache holds only the Tier 0 rows the person's sync audience names, so there is nothing to index regardless of the person's role. And even on the server, indexing document or contract body content is a materially harder problem than this feature takes on. Name and title search is what is built.

This is a stronger guarantee than permission filtering: there is no code path in which a Tier 1 plaintext value reaches a search index.

### Permission filtering

The local index covers Tier 0 identifying fields only, which is all a device holds. They reach the device already filtered by the person's sync audience and are filtered again by role at query time.

Results pass through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor — the same discipline [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s intelligence panel states for itself. **This feature constructs no permission logic of its own.** An engineer adding a searchable node type registers it here and relies on the interceptor, rather than writing a bespoke visibility check for search.

### Search beyond Tier 0

A query that could match an entity whose identifying fields are Tier 1, Tier 2 or Tier 3 cannot be answered from the device, because that entity is not there. Those matches come from a **server-backed search call**:

- **It is slower and online-only.** It is a network round-trip, not a 30ms local query, and it has no offline answer.
- **It is itself an access.** The server runs it through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor like any other read, so a person sees only matches they may read, and where a matched type is Tier 1 or Tier 3 the access is recorded by [[VPS-F004_Silent_Audit_Log|VPS-F004]] the way a direct read of that record would be.
- **It degrades, it does not block.** Offline, the server-backed group renders [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s `requires-connection` state with **Retry**; the local results are unaffected.
- **The empty-state rule still holds.** A restricted match is indistinguishable from no match, whether the answer came from the device or the server.
- **`AuditEntry` is still never searched, by either path** (VPS-F004 G07).

### Skill delegation

A query is checked against the Skill table in parallel with the entity tables. A match calls `skillMatcher.adHocSearch` per [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]], unmodified. Proficiency ordering, availability filtering and Ghost inclusion are that feature's logic and are not duplicated.

### API contracts

```
search.query(text, limit?) -> {
  commandMatches: [{ commandId, label, shortcut? }],
  entityMatches:  [{ nodeType, nodeId, label, secondaryLabel, isGhost? }],
  skillMatches?:  [{ employeeId, isGhost, availabilityStatus, matchedSkills }]
    // Present only when text matches a Skill name. Exactly
    // skillMatcher.adHocSearch's return shape, passed through unmodified
}
  // Entirely from the local index. No network request.
  // Tier 0 entities only: what the device cache holds.

search.queryProtected(text, limit?) -> {
  entityMatches: [{ nodeType, nodeId, label, secondaryLabel }]
}
  // A server call. Online only. Runs through the interceptor; audited per
  // VPS-F004 where the matched type is Tier 1 or Tier 3
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | FTS5 tables are maintained by triggers on the content tables [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s materialization populates. Index staleness beyond normal materialization lag is never expected |
| G02 | Only identifying fields are indexed. No Tier 1 or Tier 3 field is ever written to an FTS table, regardless of the querying device's own access |
| G03 | Results are filtered through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor, identical to every other read. No separate permission mechanism exists |
| G04 | A skill-shaped query delegates to [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] unmodified. Ghost inclusion and availability ranking are not duplicated here |
| G05 | A newly registered Tier 0 node type becomes searchable by adding an FTS table. The indexed list is open, not closed |
| G06 | A person's context line shows availability and next rolloff, resolved from [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s computation |
| G07 | The local index holds Tier 0 identifying fields only. A match on an entity whose identifying fields are Tier 1, 2 or 3 is a server-backed call, online only, run through the interceptor and audited under VPS-F004 where the matched type is Tier 1 or Tier 3 |
| G08 | `AuditEntry` is excluded from both the local index and the server-backed search |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F002-S01 | FTS5 index schema and trigger maintenance | Data |
| VPS-F002-S02 | Command palette behavior and keyboard trigger | UI |
| VPS-F002-S03 | Permission-filtered entity search | Logic |
| VPS-F002-S04 | Skill query delegation | Logic |
| VPS-F002-S05 | Command execution | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a workspace with 150 employees, 50 projects and assorted clients, skills and documents
**WHEN** a user types three characters of a name
**THEN** matching results appear within 30ms grouped by type, entirely from the local index

---

**GIVEN** the typed text matches a Skill's name
**WHEN** results return
**THEN** a distinct skill-match section appears, identical in content and ranking to [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s own result for the same query, alongside any direct name matches for the same text

---

**GIVEN** a result row for a person
**WHEN** it renders
**THEN** the context line shows their availability and next rolloff date, so the common question is answered without opening the profile

---

**GIVEN** a user types a verb such as *create employee*
**WHEN** results return
**THEN** the matching command appears in the Commands group above entity results

---

**GIVEN** a user searches for a term matching a restricted entity
**WHEN** results return
**THEN** it does not appear, and nothing indicates that a hidden result exists

---

**GIVEN** a Ghost's role title matches the query
**WHEN** results return
**THEN** it appears with the dashed treatment established in [[VPS-D001_Design_Foundations|VPS-D001]]

---

**GIVEN** the device is offline
**WHEN** the palette is used
**THEN** Tier 0 entity search, skill delegation and commands all resolve from the local index with no degradation and no network attempt, and any server-backed group shows the `requires-connection` state with **Retry**

---

**GIVEN** a query that could match an entity whose name is Tier 1, 2 or 3, and the device is online
**WHEN** the server answers
**THEN** the matches the person may read appear in their own group after the local results, none they may not appear, and the access is audited where the matched type is Tier 1 or Tier 3

---

**GIVEN** a query matches nothing
**WHEN** results display
**THEN** a plain empty state appears, not an error and not an external search suggestion

---

## Non-Functional Requirements

- Results return within 30ms of the third character typed, per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]
- The palette opens, focuses and is ready within 50ms
- Full functionality offline for Tier 0 entity search, skill delegation and commands; server-backed results require a connection and degrade to `requires-connection`
- No perceptible lag between a node's creation or rename and its appearance in results, since FTS maintenance rides the same materialization pipeline as every other read

---

## Security Considerations

- **This feature constructs no permission logic of its own.** An engineer adding a searchable node type registers it here and relies on [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor.
- **Tier 1 and Tier 3 content is structurally never indexed**, not filtered post-query. There is no code path where a Tier 1 plaintext value is written into a search index at all.
- **The server-backed path is an access, not a lookup table.** It is governed by the interceptor and audited like a direct read, so searching cannot be used to learn what reading would refuse.
- **Search is a common exfiltration surface and is audited accordingly.** Query text is not logged per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s redaction policy, but a permission denial encountered during a search writes to [[VPS-F004_Silent_Audit_Log|VPS-F004]] like any other, so a pattern of probing for restricted records is visible after the fact.
- **The empty state must be identical whether a result was filtered or genuinely absent.** A different message for *nothing matched* and *matches exist but you may not see them* would turn the palette into an oracle for restricted data.

---

## Out of Scope

- Full-text search inside document bodies or contract content — materially harder, and would need to reckon with encrypted content specifically. Not attempted
- Typo-tolerant fuzzy matching beyond prefix and substring — a reasonable later enhancement
- Search history, recent searches or personalized ranking — stateless per query
- Cross-workspace search — each workspace's index is separate and there is no cross-tenant query surface
- Saved searches or alerts on a query — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] handles anything that needs to reach a person

---

## Decisions Recorded

**The palette-ownership collision is settled and the archeology retired.** Two features previously claimed `Cmd+K`. This one owns the keystroke and the surface; [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] owns the matching logic behind one kind of result. Both documents now state it as behavior rather than as a resolved conflict.

**The latency budget tightens from 10ms to 30ms**, matching [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]. The previous 10ms figure was inherited from [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s ad-hoc match, which is a single-table query. A palette running FTS across seven tables plus command matching plus a delegated skill query is a different operation, and specifying an unachievable budget invites an implementer to either miss it or cut the scope that makes the feature useful.

**Commands are added as a result group.** [[VPS-D002_Component_Library|VPS-D002]] already describes the palette as one surface with several capabilities. The previous specification covered only entity search, which would have produced a second palette for actions within a year.

**A person's context line shows availability**, not email or department. It is the question behind nearly every search in this product, and answering it in the row often ends the task.

**Policy is added to the indexed set**, following the open-list rule now stated in G05, so that a future Tier 0 node type does not require amending this document to become findable.

**Search is local for Tier 0 and server-backed beyond it (F199, 22 September 2026).** The body previously claimed every nameable entity was searched entirely from a local index with no network round-trip, and framed the whole feature as indistinguishable offline and online. Under [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s server-authoritative revision a device holds Tier 0 rows only, so that guarantee is true of Tier 0 and not of anything else. It is scoped accordingly wherever it appears (the opening, the problem statement, the layout and system states, the index and permission-filtering sections, the API contract, the acceptance criteria and the non-functional requirements). A query that could match a Tier 1, 2 or 3 entity is a server-backed call: slower, online-only, itself an interceptor-governed and audited access, and degrading to `requires-connection` ([[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]) when offline. Tier 2 is also no longer described as syncing broadly; it does not reach a device. The total exclusion of `AuditEntry` (VPS-F004 G07) is unchanged. Recorded as part of the FDN-104 priority slice.

---

## Related Notes

- [[VPS-D002_Component_Library|VPS-D002]] — the Command Palette component
- [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] — the latency budget
- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the skill engine this palette delegates to
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the interceptor filtering every result

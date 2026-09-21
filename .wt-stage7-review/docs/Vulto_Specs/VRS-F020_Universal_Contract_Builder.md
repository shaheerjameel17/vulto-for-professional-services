---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F020
---

# VRS-F020 — Universal Contract Builder

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee — `employment_type`, the matching key), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity — jurisdiction, legal name and registered address, all auto-populated from it), [[VRS-F006_Rate_Card_Engine|VRS-F006]] (RateCard, optionally referenced for contractor agreements), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Contract's registry entry and its Tier 2 / Tier 1 split), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (the Tier 1 model protecting rendered content), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (client-side rendering for Tier 1 documents)
**Blocks:** [[VRS-F021_E-Signature_Native|VRS-F021]] (nothing to send for signature without this), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (no generated documents to file)

This document is the single source of truth for this feature.

---

## Scope

[[Vulto Legal]] is a separate application built in a future year. This feature is Roster's bootstrap, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Write-Ownership Handoff Principle — the same pattern as [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s rate card.

**It generates employment and contractor agreements only.** Statements of work, NDAs and change orders are [[Vulto Legal]]'s permanent territory and are never built here, not even thinly, because there is no bootstrap need for them the way there is for an employment contract at hire time.

The e-signature flow is [[VRS-F021_E-Signature_Native|VRS-F021]]. Where this document references sending for signature, it describes the handoff point, not the mechanism.

---

## What It Is

A structured document generator. An HR Admin selects an employee, a contract type and a jurisdiction, and the system assembles a legally-appropriate document from a library of pre-written clauses — Smart Blocks — filling variable fields as it goes.

No lawyer is consulted for a routine hire. Each generated contract creates a Contract node connected to its employee, carrying the fully rendered text **frozen at the moment of generation**.

---

## Problem It Solves

Agencies hiring across borders need materially different contract structures per jurisdiction. A probation clause satisfying Pakistani labor law is not the clause a UK contract needs, and an independent contractor in the US needs 1099 language a full-time employee does not.

Most small agencies handle this with one generic template that offers inadequate protection in most of the jurisdictions it is actually used in, or pay several hundred dollars per routine hire for something that should take minutes.

This standardizes the routine case without requiring legal expertise at the point of execution, **while remaining honest that it is not a substitute for counsel on anything genuinely unusual.**

---

## User-Facing Flows

### Generating

An HR Admin opens the builder from an employee's profile and selects a contract type matching their `employment_type`, with jurisdiction pre-filled from their scoped Entity.

Applicable Smart Blocks load automatically: a probation clause and Factories Act leave entitlement for Pakistan, an IR35 status declaration for a UK contractor, 1099 language for a US freelancer.

A split view shows the structured form on the left and a live preview on the right, updating as fields are filled.

### Filling and previewing

Auto-inserted clauses are visually distinguished in the preview, so it is clear what came from the library and what was typed. **An unfilled variable is highlighted rather than silently blank**, so nothing is generated with a gap nobody noticed.

### Generating the document

On confirmation a Contract node is created. `rendered_content` is the fully assembled document as **actual stored text**, not a set of live references to a library that could change later. Status is Draft.

### Handing off

**Send for signature** is the boundary of this feature. Pressing it calls `contract.markSent`, which hands off to [[VRS-F021_E-Signature_Native|VRS-F021]].

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Contract builder | Content, split | Form and live preview |
| Contracts | Section on the Employee profile | History and status |

### Layout and components

**The builder** is a two-column split at 40/60 — form left, preview right — with no shell Panel, since the preview is the working surface rather than a detail view.

The form is a stack of Sections: *Type and jurisdiction*, pre-filled and editable; *Variables*, one Input per placeholder; *Optional clauses*, a set of Checkboxes for clauses the jurisdiction permits but does not require.

The preview renders the document at reading width in the same typefaces the generated PDF will use. Library-sourced clauses carry a 2px `border-default` left rule and a `micro` uppercase label naming the block. Typed values render in `text-primary`; **unfilled placeholders render as an `attention`-filled inline chip reading the variable name.** A document with three amber chips in it is unmistakably not ready, which is the point.

**The primary action is Generate**, disabled while any required variable is unfilled, with the count of remaining fields as its helper text.

**Contracts on the employee profile** is a Table: type, jurisdiction, status Badge, generated date, signed date. For a viewer without Tier 1 access the rows render with the content column structurally absent per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — the existence of a contract is unremarkable, its terms are not.

### Keyboard

`Tab` through variables. `Cmd+Enter` generates when the form is complete.

### System states

| State | Treatment |
|---|---|
| Syncing | The Smart Block library is locally cached; the builder never waits on network |
| Restricted | A Manager sees no contract at all for their report — structurally absent, per Contract's HR-restricted class |
| Aged out | Contracts outside [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 window render dashed with **Fetch** |
| Empty | *No contracts generated.* with **Generate contract** |
| Error | Generation with an unfilled required variable is refused, naming the field |

### Responsive

Below 1280px the preview collapses behind a **Preview** toggle rather than shrinking. A contract preview at half width is unreadable and misrepresents the document's real layout.

---

## Technical Architecture

### The Contract schema

Contract is split across Tier 2 and Tier 1 per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]].

```
contract_id:       UUID v4
workspace_id:      UUID
employee_id:       UUID, FK to Employee, required
contract_type:     enum: FullTimeEmployment, PartTimeEmployment,
                   ContractorAgreement, InternshipAgreement
jurisdiction:      enum per VRS-F003 — auto-populated from the employee's
                   scoped Entity at generation, editable per contract since
                   an occasional arrangement may genuinely differ
entity_name:       string — from the Entity's legal_name
entity_address:    text — from the Entity's registered_address
rate_card_id:      UUID, nullable, FK to RateCard
status:            enum: Draft, Sent, Signed, Expired, Voided
sent_at / signed_at / expires_at: timestamps, nullable

— Tier 1, end-to-end encrypted —
variable_values:   JSON map — start_date, salary, currency,
                   notice_period_days, probation_weeks, role_title, reporting_to
rendered_content:  rich_text — the fully assembled document, frozen at generation

— Universal Node Conventions per VPS-A002 —
```

### The Smart Block library is versioned reference content, not a graph node

Clause text per jurisdiction and contract type ships and versions with the product, synced on install and update, the same way any static reference dataset would be. It is not created per workspace and requires no node registration under [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 6.

Read-only to every workspace at MVP. Admin-level editing of the library is a later decision.

This keeps the graph concerned only with what varies per workspace — the generated contract — rather than clause text every workspace shares identically.

### Why rendered_content is frozen

If a contract stored only references to the blocks used and re-rendered on view, a later library update would silently rewrite the text of a document someone signed months ago.

Same historical-accuracy principle [[VRS-F006_Rate_Card_Engine|VRS-F006]] applies to rate cards, for the same reason: **a past legal document must never change shape under its own feet.** It is computed once and stored.

### Tier 1 rendering

Per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], a document containing Tier 1 content is rendered **client-side**, in an authorized session. A contract PDF assembled on Vulto's servers would defeat the encryption that made the salary field unreadable in the first place.

This constrains generation: it happens on an authorized device, not in a background job.

### The variable set

`{{employee_name}}`, `{{start_date}}`, `{{salary}}`, `{{currency}}`, `{{notice_period_days}}`, `{{probation_weeks}}`, `{{role_title}}`, `{{reporting_to}}`, `{{entity_name}}`, `{{entity_address}}`.

Each resolves from `variable_values` or the linked Employee at generation. An unresolved variable renders as a highlighted placeholder, never silently blank.

### API contracts

```
contractBuilder.getApplicableBlocks(jurisdiction, contractType) -> SmartBlock[]
  // Reads the versioned reference library, not the graph

contractBuilder.previewRender(jurisdiction, contractType, variableValues)
  -> { renderedHtml }
  // No side effect. Client-side. No Contract node created

contractBuilder.generate(employeeId, contractType, jurisdiction,
                         variableValues, rateCardId?) -> { contractId }
  // Creates the node with status Draft and frozen rendered_content

contract.markSent(contractId)          -> { success }   // called by VRS-F021
contract.markSigned(contractId)        -> { success }   // called by VRS-F021
contract.void(contractId, reason)      -> { success }
contract.listForEmployee(employeeId)   -> Contract[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Contract carries the schema above. `employed_under` connects Employee to Contract |
| G02 | `rendered_content` and `variable_values` are frozen at generation. A later library update never alters an already-generated contract |
| G03 | `rate_card_id` is a direct scalar field, the same lightweight pattern Assignment uses, not a first-class edge |
| G04 | The `has_document` edge from Contract to Document is created by [[VRS-F021_E-Signature_Native|VRS-F021]] on signature, not here. This feature's output is `rendered_content`, which exists before any signed PDF does |
| G05 | Jurisdiction, entity legal name and registered address auto-populate from the employee's scoped Entity through `entity.resolveForEmployee`, and remain editable per contract |
| G06 | Generation renders client-side per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. No server-side path assembles a Tier 1 document |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F020-S01 | Smart Block library and selection engine | Data |
| VRS-F020-S02 | Split-view builder with live preview | UI |
| VRS-F020-S03 | Contract generation and content snapshotting | Logic |
| VRS-F020-S04 | Status lifecycle and signature handoff | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin selects Pakistan and Full-Time Employment
**WHEN** the builder loads
**THEN** the Pakistan-specific probation clause and statutory leave entitlement appear automatically, and switching to UK replaces them within 200ms

---

**GIVEN** an employee scoped to a UK entity
**WHEN** the builder opens
**THEN** jurisdiction, entity legal name and registered address are pre-filled from that Entity, and remain editable

---

**GIVEN** the salary variable is empty
**WHEN** the preview renders
**THEN** the placeholder renders as a highlighted chip, Generate is disabled, and the helper text names the remaining field

---

**GIVEN** a contract is generated
**WHEN** the node is created
**THEN** `rendered_content` holds the fully assembled text, status is Draft, and no `has_document` edge exists

---

**GIVEN** the Smart Block library is updated in a later release
**WHEN** a contract generated before the update is viewed
**THEN** its `rendered_content` is unchanged, exactly as generated, regardless of what the library now holds

---

**GIVEN** a Manager views their report's profile
**WHEN** they look for a contract
**THEN** it is structurally absent, not hidden in the interface

---

**GIVEN** the employee views their own contract
**WHEN** it loads
**THEN** both identifying fields and the salary-bearing content are visible, per the Tier 1 self-access rule

---

**GIVEN** a generated contract is inspected directly in server storage
**WHEN** the raw value is read
**THEN** `rendered_content` and `variable_values` are unreadable ciphertext

---

## Non-Functional Requirements

- Live preview updates within 200ms of any field change or jurisdiction switch
- `rendered_content` and `variable_values` are end-to-end encrypted per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. Vulto's servers cannot read a generated contract
- Generation and preview function fully offline from the locally cached library; only the initial library sync requires connectivity

---

## Security Considerations

- **The Tier split is the substantive security decision.** A generated contract states an exact salary. Leaving the whole node at Tier 2 — server-readable — would protect that figure less than the same figure enjoys on the Employee node itself.
- **Finance Admin holds Full on the content specifically**, mirroring why they hold Full on Employee's salary fields. The same role needs the same access for the same figure, wherever it appears.
- **The Smart Block library carries no employee data.** Pure template content, requiring no tier of its own.
- **Client-side rendering is a hard constraint, not a preference.** A background job generating contract PDFs would put Tier 1 plaintext on Vulto's infrastructure, defeating the entire model.
- **This feature is explicit that it is not legal advice.** The generated document is a competent starting point for a routine case. The interface says so, once, at generation — not as a disclaimer nobody reads, but because an HR Admin generating a contract for an unusual arrangement should be prompted to think about it.

---

## Out of Scope

- **Statements of work, NDAs and change orders** — permanently [[Vulto Legal]]'s territory
- **The e-signature mechanism** — [[VRS-F021_E-Signature_Native|VRS-F021]]
- **Offer letters before employment begins** — permanently out of scope by design. [[VRS-F032_Offer_Management|VRS-F032]]'s offer stage records terms as structured data, not a generated document; the contract generates here, unmodified, after the candidate converts to an employee
- **Workspace-level Smart Block customization** — read-only, shared and versioned with the product at MVP
- **Bulk generation** — one contract at a time
- **Keeping clause text legally current.** The library ships with competent starting points; warranting their ongoing legal accuracy in seven jurisdictions is not something this product does, and the interface says so

---

## Decisions Recorded

**Jurisdiction and entity details now auto-populate from [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] as a dependency rather than a correction.** That feature is built before this one in the corrected order, so what was previously an open item resolved retrospectively is now simply how the feature works.

**`entity_address` is added** alongside `entity_name`. A generated contract requires a registered address, and the previous specification pre-filled from a node that held neither field — [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] now carries both.

**Client-side rendering is stated as a constraint**, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. The previous specification did not say where generation happened, which would have led an implementer to the obvious and wrong answer of a server-side render job.

**The preview collapses rather than shrinks below 1280px.** A contract preview at half width misrepresents the document's real layout, which is the one thing a preview exists to show accurately.

---

## Related Notes

- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the entity supplying jurisdiction and legal details
- [[VRS-F021_E-Signature_Native|VRS-F021]] — the signature flow this feature hands off to
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where signed documents are filed
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the client-side rendering requirement

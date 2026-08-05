---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-000
---

# VPS-000 — Documentation Standard

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Applies to:** Every document in this project — the suite foundations, Vulto Roster, Vulto Projects, and every future application in [[Vulto for Professional Services]].

This document governs how every other document in this project is structured, numbered, propertied, and linked. It is the only document permitted to define these conventions. Where any other document contradicts this one, this one is correct and the other is a defect.

---

## Why this exists

The Vulto Roster specification set is intended to be handed directly to Claude Code and built without the conversations that produced it. That imposes a requirement most product documentation never has to meet: an implementer with no memory of the discussion must be able to open any document and find a decision rather than a deliberation. Consistency of structure is what makes that possible. A specification set where each document invents its own shape forces the implementer to re-learn the format sixty times, and every re-learning is an opportunity to miss something load-bearing.

The conventions below are deliberately rigid. That is the point.

---

## Prefixes and series

Every document in this project carries a prefix identifying **which body of work owns it**, and a series letter identifying **what kind of document it is.**

### Prefixes

| Prefix | Owns | Governs |
|---|---|---|
| **`VPS-`** Vulto Professional Services | The suite. Foundations every application inherits without rewriting | The stack, the graph, sync, permissions, the design system, the pipeline, and the platform features every application shares |
| **`VRS-`** Vulto Roster | One application | Roster's own features |
| **`VPJ-`** Vulto Projects | One application | Projects' own features |

**A new suite application adds a prefix and nothing else.** [[Vulto Accounts]] becomes `VAC-`, [[Vulto Legal]] becomes `VLG-`, and each inherits the entire `VPS-` body by reference rather than restating any part of it.

**The test for which prefix a document takes** is one question: *would this exist, unchanged, if this application had never been built?* Authentication would. The Bench Forecast would not.

There is a second, sharper articulation for the boundary that matters most today: **Roster owns people; the suite owns the platform.** Employee, Entity, Assignment and the working calendar are Roster's permanently — every other application reads them. Identity, search, notifications, audit, configuration, import, retention, the API and the mobile shell are the suite's, because none is about a person.

### Series

Four series, within any prefix. No fifth may be introduced without amending this document.

| Series | Range | Purpose |
|---|---|---|
| **Meta** | `000` – `099` | Governance of the specification set itself. This document, each application's Feature Register, the Implementation Handoff, the Commercial Model |
| **Architecture** | `A001` – `A999` | Cross-cutting technical foundations every feature inherits: the stack, the graph schema, sync, permissions, platform services, the pipeline |
| **Design** | `D001` – `D999` | The visual and interaction system |
| **Feature** | `F001` – `F999` | A single, buildable feature. One document, one feature, no exceptions |

**The Architecture and Design series exist only under `VPS-`.** An application never writes its own architecture or design document. Where an application genuinely needs a structural addition — a set of new node types, say — it extends the suite document that owns that fact rather than creating a parallel one, because *what node types exist* must have exactly one answer.

**The Meta series exists under every prefix**, since each application needs its own Feature Register recording its own features and build order.

Three digits throughout. Nine hundred and ninety-nine slots per series per prefix is future-proofing; more would be optimism.

---

## Identifier and filename convention

**Identifier:** `VRS-` + series letter (omitted for Meta) + three-digit zero-padded number.
Correct: `VRS-F003`, `VPS-A001`, `VPS-D002`, `VPS-000`.
Incorrect: `VRS-F3`, `VRS-F0003`, `VRS-F03`.

**Filename:** identifier, underscore, title in Title Case with underscores replacing spaces, `.md` extension.

```
VRS-F005_The_Bench_Forecast.md
VPS-A002_Master_Graph_Schema_Definition.md
VPS-D001_Design_Foundations.md
```

Punctuation in a title is dropped from the filename rather than transliterated. `Case Management: Disciplinary and Grievance` becomes `VRS-F046_Case_Management_Disciplinary_and_Grievance.md`.

**Numbers are permanent once implementation begins.** Until then, renumbering to preserve dependency order is permitted and expected. After the first feature is built, a retired feature's number is retired with it and never reissued; a new feature takes the next free number regardless of where it belongs conceptually.

**A number promoted to another prefix is retired in the same way.** Eleven Roster features moved to `VPS-` when the suite foundations were separated, and Roster's `F001`, `F015`, `F016`, `F017`, `F025`, `F026`, `F047`, `F073`, `F074`, `F075` and `F076` are permanently vacant. [[VRS-001_Feature_Register|VRS-001]]'s crosswalk records where each went. **Closing a cosmetic gap by renumbering is never worth the risk of moving three thousand cross-references.** Conceptual grouping is what the Feature Register and the two frontmatter properties are for. Sequence is not asked to carry that weight twice.

---

## Frontmatter schema

Every document carries exactly these five properties, in this order, with no additions.

```yaml
---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F005
---
```

The example above is a Roster feature, so its `Type` is `Vulto Roster Specs`. A suite document carries `Vulto for Professional Services Specs`; a Projects document carries `Vulto Projects Specs`. **`Type` always matches the prefix.**

**Type** identifies the owning body of work, and takes exactly one of three values today: `Vulto Professional Services Specs`, `Vulto Roster Specs`, or `Vulto Projects Specs`. **It always matches the document's prefix.** A new application adds a fourth value alongside its prefix.

This is what makes each body queryable independently in Obsidian, and the whole project queryable together.

**Date** is the revision date, written as an Obsidian daily-note link. It records when the document was last materially changed, not when it was first drafted. Authorship and revision history live in the Feature Register, not here.

**Product Phase** takes exactly one value from the closed enum below.

**Feature Type** takes exactly one value from the closed enum below. Where a feature genuinely spans two types, the one that determines *how it is built* wins over the one that describes what it is about. A payroll dashboard is `Financial`, not `Experience`, because its difficulty is financial.

**aliases** takes exactly one value: the document's own identifier. This is what makes `[[VRS-F005_The_Bench_Forecast|VRS-F005]]` resolve in prose without embedding filenames in body text. Additional aliases are not permitted; a document with three names has no name.

---

## Product Phase — closed enum

Five values. Product Phase answers *when this is built*, and nothing else. It is a lifecycle position, which is why the values are deliberately generic enough to apply unchanged to [[Vulto Projects]], [[Vulto Accounts]] and every subsequent application in the suite.

| Value | Meaning |
|---|---|
| **Architecture** | Foundational technical or design decisions that constrain everything downstream. Not shippable, not user-visible, and never optional. The A and D series live here exclusively. |
| **MVP** | Required for the product to be honestly sellable to its first paying customer. The test is not "would this be nice" but "would a professional services firm be unable to run on this without it". |
| **Post-MVP** | Depth on a product that already works. Features a customer would miss within their first quarter, but whose absence does not prevent adoption. |
| **Scale** | Features that earn their keep once a workspace has accumulated real history: intelligence derived from months of data, and the financial layer that only matters at genuine headcount. |
| **Mature** | Ecosystem, extensibility and platform reach. Justified by demonstrated demand from an established customer base, not by anticipated demand from a hypothetical one. |

The earlier taxonomy — Phase 1 through Phase 5, with two phases named `Intelligence` and `Finance` — is retired. Those two were never lifecycle stages; they were categories of feature that happened to cluster late. They are now expressed correctly through Feature Type, which is where they always belonged, and which allows an intelligence feature to sit in MVP if it genuinely must.

---

## Feature Type — closed enum

Six values. Feature Type answers *what kind of engineering problem this is*, which is the property that actually predicts who builds it, what it can go wrong at, and what review it needs.

| Value | Meaning | Representative |
|---|---|---|
| **Core** | The primary operational surface. Records the facts the business runs on and presents them. If Core is broken, the product is broken. | [[VRS-F005_The_Bench_Forecast|VRS-F005]], [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] |
| **Intelligence** | Derives a signal, prediction, correlation or aggregate from data another feature already recorded. Owns no primary facts. Its failure mode is being wrong quietly rather than breaking loudly. | [[VRS-F052_Workload_Strain_Signal|VRS-F052]], [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]], [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] |
| **Financial** | Touches money: rates, cost, payroll, invoices, expenses, disbursement. Subject to the strictest correctness, audit and encryption requirements in the product. | [[VRS-F062_Payroll_Engine_Core|VRS-F062]], [[VRS-F067_Contractor_Invoice_Management|VRS-F067]], [[VRS-F006_Rate_Card_Engine|VRS-F006]] |
| **Compliance** | Exists because a law, a contract or an audit requires it. Correctness is defined externally rather than by product judgement, and "we thought this was reasonable" is never a defense. | [[VRS-F020_Universal_Contract_Builder|VRS-F020]], [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]], [[VPS-F004_Silent_Audit_Log|VPS-F004]] |
| **Platform** | Infrastructure the product is built on or extended through, rather than a surface a user visits. Search, sync, notifications, APIs, extensibility, import. | [[VPS-F002_Local-First_Search|VPS-F002]], [[VPS-F009_Vulto_Sync_API|VPS-F009]], [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] |
| **Experience** | A composed surface over facts other features own, existing to serve one specific person exceptionally well. Adds little to the graph and everything to whether the product is loved. | [[VRS-F049_Manager_Dashboard|VRS-F049]], [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]], [[VPS-F011_Mobile-Native_Experience|VPS-F011]] |

---

## Linking convention

Obsidian's link graph is treated as a first-class part of this specification set, not a formatting nicety. An implementer or a future engineer should be able to open any feature and traverse outward to everything it touches without a search.

**Every reference to another document is a wikilink to that document's filename, displaying its identifier.** Never a bare code.

- Correct: `permission enforcement per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]`
- Correct with prose display: `the amber state defers to [[VRS-F012_Revenue_Gap_Alert|the Revenue Gap Alert]]`
- Incorrect: `permission enforcement per VPS-A004`

**Why the filename rather than the alias.** Every document carries its identifier as an alias, and `[[VPS-A004]]` resolves through it correctly in a healthy vault. It is nonetheless the fragile form: alias resolution depends on Obsidian's metadata index, which is rebuilt asynchronously and is routinely incomplete after a bulk import of a hundred files. A filename link resolves from the file system and never depends on an index having caught up.

**The alias is retained** on every document and remains the way a human searches for one — typing `VPS-A004` in the quick switcher finds it. It is simply not what the links depend on.

**The consequence for renaming:** a file cannot be renamed outside Obsidian. Renamed inside it, Obsidian rewrites every inbound link automatically. Renamed in Finder, every inbound link breaks. That trade is accepted deliberately, since filenames are fixed by the convention above and are not expected to change.

**Every reference to another Vulto application is a wikilink to its note.** `[[Vulto Accounts]]`, `[[Vulto Projects]]`, `[[Vulto Legal]]`, `[[Vulto Comms]]`, `[[Vulto Network]]`. These notes already exist in the vault and this is what connects the specification set to the product vision above it.

**Node types, field names and API methods are code-formatted, never linked.** `Employee`, `billable_percentage`, `assignment.create`. Linking these would produce thousands of unresolvable links and drown the graph in noise. The document that owns a node type is linked instead: `the Employee node, owned by [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]`.

**Dates are daily-note links,** per the Date property.

---

## Standard document structure

Every Feature document follows this exact section order. Sections are never reordered, never renamed, and never omitted — a section with nothing to say says so in one line rather than disappearing, because a missing section is indistinguishable from an oversight.

1. **Frontmatter** — per the schema above
2. **Title** — `# VRS-Fxxx — Feature Name`
3. **Header block** — Status, Owner, Depends On, Blocks, and the single-source-of-truth declaration
4. **What It Is** — the feature in plain terms, then in graph terms
5. **Problem It Solves** — the specific operational failure this prevents, stated concretely
6. **User-Facing Flows** — functional behavior, what a person does and what happens
7. **Interface Specification** — layout, component inventory against [[VPS-D002_Component_Library|VPS-D002]], keyboard map, and the mandatory system states
8. **Technical Architecture** — full schema where this feature owns one, API contracts as real tRPC-style signatures
9. **Graph Specifications** — nodes created, edges written, traversals performed, tier and privacy class
10. **Sub-features** — the discrete pieces, individually identified
11. **Feature Acceptance Criteria** — GIVEN/WHEN/THEN, individually coded
12. **Non-Functional Requirements** — performance, offline behavior, scale limits
13. **Security Considerations** — what could leak, and what prevents it
14. **Out of Scope** — with the feature or application that owns each excluded thing
15. **Decisions Recorded** — where this document resolved something an earlier one left open

Architecture and Design documents follow the same shape with sections 6, 7 and 10 replaced by content appropriate to their series.

**Section 7 is new to this pass** and applies to every feature document. It is what makes this set genuinely sufficient for implementation rather than sufficient for a backend. Its contents are governed by [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]; a feature specifies which components it composes and how, and never redefines a component the design system already owns.

**Section 15 replaces the former "Open Items".** The distinction matters and is the central working rule of this pass, so it is stated plainly below.

---

## The no-open-items rule

**No document in this set may contain an unresolved question.**

This specification set exists to be implemented by an agent that cannot ask a follow-up question, cannot weigh a commercial trade-off, and will, if handed an ambiguity, resolve it silently and plausibly in a direction nobody chose. An open item in a document that reaches implementation is not an honest acknowledgement of uncertainty. It is a decision delegated to whoever reads it last, made without the context to make it well.

Every question previously carried as an Open Item is therefore now answered. Where the answer is a genuine product judgement, the judgement is recorded along with its reasoning, so that a future reader can disagree with it deliberately rather than discover it by accident. Where the answer is "deliberately excluded", it appears in Out of Scope with the feature or application that owns it instead.

This does not forbid recording uncertainty. It forbids recording it as a gap. A decision made under uncertainty is written as a decision, with the uncertainty named:

> **Decided:** contractor invoices are approved through this feature's own Approve action rather than routed through [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]]'s payroll gate. The two workflows have different reviewers, different cadences and different failure consequences, and forcing them into one surface would slow both. Revisit if contractor spend exceeds employee payroll in a typical workspace, which is not the case in any agency profile this product targets.

That is a decision. This is not:

> Whether this should route through the payroll approval workflow is unresolved.

---

## Standing documentation rules

1. **Every document is the single source of truth for exactly one thing.** Where a fact appears in two documents, one of them is a defect. Reference, never duplicate.
2. **Writing a later document routinely corrects an earlier one.** This is expected, not a failure. The correction is made in the earlier document, and noted in the later document's Decisions Recorded section so the trail is visible.
3. **A node type is defined once, in the feature that operationalises it,** with its lifecycle, privacy class and tier anchored in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] is a registry, not a schema dump.
4. **Every new node type is registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] before it is implemented,** and every new node type's permission behavior is confirmed against [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s default mapping explicitly rather than assumed.
5. **Governance language is uniform.** Status is always `Decided at Founder Level`. The Owner block is identical in every document. When a CTO function is engaged, that language changes in one pass across the whole set rather than drifting document by document.
6. **British English throughout,** matching the existing set: *utilization*, *organization*, *behavior*, *prioritize*.
7. **An application never restates a suite document.** Where an application needs to extend one — registering a node type, a search index entry, a notification rule, a settings group — it does so *in* the suite document, which is built as an open registry for exactly that purpose. A parallel copy is the drift this rule exists to prevent.
8. **No document assumes the conversation that produced it.** If a reason matters, it is written down. If it is not written down, it does not exist.

---

## Related Notes

- [[VRS-001_Feature_Register|VRS-001]] — Vulto Roster's Feature Register
- [[VPJ-001_Feature_Register|VPJ-001]] — Vulto Projects' Feature Register
- [[VPS-002_Implementation_Handoff|VPS-002]] — the Implementation Handoff
- [[VPS-003_Commercial_Model|VPS-003]] — the Commercial Model
- [[Vulto Roster]] — the product this set specifies
- [[Vulto for Professional Services]] — the suite this product founds
- [[Vulto Product Philosophy]] — the design principles governing every opinionated decision recorded in this set

---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-002
---

# VPS-002 — Implementation Handoff

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Audience:** Claude Code, and any engineer joining afterwards.
**Scope:** The whole project — the suite foundations and every application built on them.

This is the entry point to every specification set in this project. **Read this first, then stop and read what it tells you to.**

---

## What this set is, and what that means for you

Ninety-four documents across three prefixes. **They are not a product requirements document.**

| Prefix | What it is |
|---|---|
| **`VPS-`** | The suite. Foundations every application inherits — the stack, the graph, sync, permissions, the design system, the pipeline, and eleven platform features every application shares |
| **`VRS-`** | Vulto Roster's own features |
| **`VPJ-`** | Vulto Projects' own features |

**You read `VPS-` once and it governs everything you build afterward.** An application's own set is only the features unique to it. A PRD describes what to build and leaves an engineer to decide how; these documents contain the full graph schema, API contracts, permission behavior, encryption boundaries, interface specifications and acceptance criteria for every feature.

**You will not be able to ask a follow-up question.** These documents were written for that condition. Where a decision could have been left open, it was made and the reasoning recorded, so that you can disagree with it deliberately rather than discover it by accident.

**Every open item in this set has been closed.** If you find something that reads as an unresolved question, it is a defect in the document, not an invitation to decide. Report it.

---

## Read these four, in this order, before writing anything

Not skim. Read.

1. **[[VPS-000_Documentation_Standard|VPS-000]]** — how these documents work. Prefixes, numbering, frontmatter, the two enums, the linking convention, and the rule that no document may contain an unresolved question.
2. **[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]** — the graph. Ninety-odd node types, their edges, their privacy classes, their tiers, and the standing rules that govern everything downstream.
3. **[[VPS-A003_Unified_Sync_Architecture|VPS-A003]]** — the encryption model. Four tiers, what each protects against, and the two that Vulto's own servers cannot read.
4. **The Feature Register for whatever you are building** — [[VRS-001_Feature_Register|VRS-001]] for Roster, [[VPJ-001_Feature_Register|VPJ-001]] for Projects. Each holds its own build order and the reasoning behind it.

**Those four are the whole mental model.** Everything else is an application of them.

---

## The five rules that are easiest to break by accident

Each of these was violated somewhere in an earlier draft of this specification set, by people who had read the rule. They are the ones to hold consciously.

**Never compute a working day.** No weekend, no holiday, no calendar arithmetic anywhere. Call [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. A hardcoded Saturday-Sunday produced wrong bench costs, wrong leave balances and wrong final settlements across four documents before it was caught, and it is wrong for the Gulf, for a six-day Pakistani week, and for anyone part-time. [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]]'s working-day suite will fail you, but understand why before it does.

**Never write a permission check in a feature.** [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor is the only place access is decided. A feature that constructs its own visibility logic has created a boundary nobody reviewed.

**Never let Tier 1 or Tier 3 plaintext reach a server.** Payroll generation, contract rendering, document assembly, workspace export and bulk import all run client-side for this reason. If you find yourself writing a server-side job that decrypts something, stop — the answer is always that it runs on an authorized device instead.

**Never store what can be derived.** Bench time, leave balance, utilization, compa-ratio, skill coverage, plan entitlement — all computed at read. A stored derivation is a derivation that will disagree with its source.

**Never widen a node's reach without checking its tier.** Documents, insights, custom field values and report runs all inherit their tier from provenance, per Standing Rule 8. Defaulting one to Tier 0 re-exposes something an earlier feature deliberately protected.

---

## Build the prototype first

**Do not begin with [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]].**

The design system — [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — is four documents of careful prose that nobody has seen rendered. The signature element of this entire product is specified precisely and has never existed on a screen: **a flat amber region on the Bench Forecast with the accumulated cost of someone's idle time counting up in monospace.**

A 14px base with 32px rows is either obviously right or obviously wrong within thirty seconds of looking at it, and no amount of careful writing substitutes for those thirty seconds.

**The economics decide this.** A static prototype is cheap. The sync engine is not. Discovering the type scale is wrong after building a CRDT layer against it is the expensive failure, and building the prototype first is how it is avoided.

### Scope

Static. Mock data. No backend, no state persistence, no authentication.

- The application shell per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — sidebar, page header, contextual panel
- Both themes at the one information-preserving product density settled by [[VPS-D001_Design_Foundations|VPS-D001]]
- **The Bench Forecast**, with real-shaped data: fifteen people, assignment bars, ghost rows, bench regions with cost figures, the today line
- **An employee profile**, showing the tab structure and the restricted compensation section — asked for as "structurally-absent" at prototype scope; [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s later rule for `None` versus `Restricted` denials revised the specific rendering to visibly-restricted, since every Employee node guarantees a compensation half
- **The timesheet grid**, with the keyboard model working — `Tab`, natural language entry, `Cmd+Enter`
- **The command palette**, opening on `Cmd+K` with grouped results
- **The manager queue** per [[VRS-F049_Manager_Dashboard|VRS-F049]], showing age-ordered items

That is enough to feel the density, the keyboard model, the restraint, and the amber.

### What you are testing

Not whether it works. **Whether the amber lands.** Whether 220px is enough for a name and a role. Whether the palette feels instant. Whether dark mode is genuinely first-class or quietly an inversion. Whether a hundred-row table with no row separators is elegant or unreadable.

**Expect the design documents to be wrong in two or three places.** That is the point of building this, and the corrections go back into [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] before real work begins.

---

## Then build in this order

[[VRS-001_Feature_Register|VRS-001]] holds the full ordering with reasoning. The shape of it:

**Foundation, in strict sequence.** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s monorepo and the sync engine, then [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]]'s pipeline before the first feature — **the gates are how the rules above stay true**, and retrofitting them after thirty features is considerably harder than starting with them.

**Then MVP, [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] through [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]], in order.** The ordering is dependency-derived and it is not decorative. [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] before anything that counts a day. [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] before contracts need a jurisdiction. [[VRS-F006_Rate_Card_Engine|VRS-F006]] before bench cost is calculated from a rate. [[VPS-F004_Silent_Audit_Log|VPS-F004]] alongside the first Tier 1 field rather than after it.

**Post-MVP, Scale and Mature follow.** Each phase is genuinely optional in a way MVP is not: a workspace can run on twenty-six features.

---

## The four things most likely to go wrong

**The sync engine will take longer than estimated.** It is one Rust service building three ways, and it is the only Rust in the repository by deliberate decision. Budget accordingly rather than discovering it.

**The permission matrix test suite is large and non-optional.** Every role against every privacy class, every role against every node type. [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s A004-T07 forbids reducing that coverage, and it is the single test suite that keeps ninety documents' worth of access decisions honest.

**Client-side rendering constrains more than it appears to.** Payroll cannot be generated by a scheduled job. Contracts cannot be assembled server-side. Export runs on one device and is slow. Each is a consequence of [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] rather than a limitation to engineer around.

**The working-day index must be materialized, not computed.** [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]'s resolution order evaluated per cell would be 13,500 traversals for one Bench Forecast render. It will not meet the budget, and the Forecast's entire proposition is that it appears instantly.

---

## Where to look things up

| Question | Document |
|---|---|
| What node types exist, and what tier | [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] |
| Who can read or write this | [[VPS-A004_Graph_Permission_Layer|VPS-A004]] |
| What does this color, size or spacing mean | [[VPS-D001_Design_Foundations|VPS-D001]] |
| What component is this, and does it exist | [[VPS-D002_Component_Library|VPS-D002]] |
| How fast must this be | [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] |
| What does absent, restricted or loading look like | [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] |
| Which provider, and how is it reached | [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] |
| What must the pipeline check | [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]] |
| Which plan includes this | [[VPS-003_Commercial_Model|VPS-003]] |
| Which plan includes this | [[VPS-003_Commercial_Model|VPS-003]] |
| What order do I build in | [[VRS-001_Feature_Register|VRS-001]] or [[VPJ-001_Feature_Register|VPJ-001]] |

---

## When a document is wrong

It will happen. Ninety-four documents written against each other will contain errors that only surface when code is written.

**Report it. Do not work around it.**

A workaround produces a codebase that disagrees with its own specification, and the specification is what the next person reads. The correction goes into the document that owns the fact, and every document that cited it is checked — which is precisely how the defects this set has already corrected were found.

**Three signals that you have found one:**

- A field referenced by one document and defined by none
- A rule stated in two documents that cannot both be true
- A dependency on a feature that has not been built and is not marked as a bootstrap

### Where building shows the instruction itself is wrong

The three signals above are contradictions you can find by reading. There is a fourth kind, and it can only be found by building: **an instruction that is internally consistent, followable, and produces the wrong result on screen.**

**Where implementation reveals that a specification's instruction is wrong, the implementation stands and the specification is corrected.** Founder decision, and it is not a licence to improvise — it applies where building produced the evidence, and the evidence goes in the findings log and the owning document together.

This is what the design prototype is for. Its stated deliverable is a corrected [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], and *"if it ends with polished screens and no changes to the design documents, it has failed."* **A build that obeys a defective instruction has produced no finding**, which is the one outcome that project cannot afford.

Two worked examples, both recorded in `docs/Prototype_Findings.md`:

* **Brand and cost as one hue.** [[VPS-D001_Design_Foundations|VPS-D001]] argued that in a product about money, the brand hue and the money hue being identical was the thesis rather than a collision. The argument was sound. Rendered, `border-focus` and the bench fill resolved to the *same value* in dark mode, so the ring marking where you were typing and the field marking unrecovered cost were indistinguishable. Brand moved to its own orange.
* **Empty states on unbuilt destinations.** An issue specified that placeholder destinations compose [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s Empty treatment. Building it showed Empty means *the query returned none* — so applying it would make an unbuilt destination look like a working feature with no data, contradicting the same issue's own acceptance criterion. The instruction was withdrawn as defective and D004 gained the distinction.

**What this does not permit:** disagreeing with a decision because you would have made a different one. These specifications closed every open question deliberately. The bar is evidence from a rendered, working build that the specified thing does not do what the document says it will.

---

## What this set will not tell you

Stated so you do not search for it.

- **Which specific vendor** sits behind a provider abstraction — background checks, disbursement, payments. Commercial decisions made behind an interface
- **Legal text.** Contract clauses, policy content, crisis resources, jurisdiction-specific wording. The mechanism is specified; the content is not
- **Whether a tax rate or retention period is correct.** Defaults are provided with a stated basis; keeping them current is the customer's
- **Applications with no specification set yet.** [[Vulto Accounts]], [[Vulto Legal]], [[Vulto Sales]] and the rest are referenced in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s ownership table as future write-authority holders and are not specified anywhere

---

## Related Notes

- [[VPS-000_Documentation_Standard|VPS-000]] — how these documents are written
- [[VRS-001_Feature_Register|VRS-001]] — the full register and build order
- [[VPS-003_Commercial_Model|VPS-003]] — the commercial model
- [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]] — the pipeline that enforces the rules above
- [[Vulto Roster]] — the product
- [[Vulto for Professional Services]] — the suite this founds

---
Type:
  - Vulto Projects Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPJ-001
---

# VPJ-001 — Feature Register

**Status:** Proposed at Founder Level — Awaiting Approval
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.

This document is the authoritative index of every document in the Vulto Projects specification set. It is the second application in [[Vulto for Professional Services]] and the first to be specified against an existing suite rather than from nothing.

---

## What this set inherits, and what that saves

**Eleven documents are inherited unchanged**, not rewritten. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] through [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]] and [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] were written as suite-level foundations, and [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] says so explicitly: the sync engine, schema package, tokens and component library are built with the discipline of published packages precisely because a second application was coming.

| Inherited | What Projects gets |
|---|---|
| [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | The stack, the monorepo, the two-language boundary, the local-first substrate |
| [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | The graph, the universal conventions, the ten standing rules |
| [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] | Sync, tiers, encryption |
| [[VPS-A004_Graph_Permission_Layer|VPS-A004]] | The permission interceptor and every role definition |
| [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] | The reference protocol — every rich text field in Projects gets `@` mentions for free |
| [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] | Email, storage, jobs, rendering, analytics |
| [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]] | The pipeline, and every gate that keeps the rules above true |
| [[VPS-D001_Design_Foundations|VPS-D001]]–[[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] | The entire design system |
| [[VPS-000_Documentation_Standard|VPS-000]] | The documentation standard, both enums, the no-open-items rule |

**One consequence worth stating plainly: Projects introduces no new architecture document beyond a schema extension.** Everything structural was decided once. This is the payoff for having written the architecture as suite-level rather than as Roster's.

**A naming note.** The A and D series carry a `VRS-` prefix for historical reasons — they were written while Roster was the only application. Their content is suite-level and they govern every application. [[VPS-000_Documentation_Standard|VPS-000]] should gain one line stating this, rather than eleven documents being renumbered.

---

## What Projects consumes from Roster

Not architecture — **operational data that already exists.** This is the reason Projects is the correct second application rather than Accounts or Sales.

| From | What |
|---|---|
| [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] | Employee. Every person on a project team |
| [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] | Working days. **Every deadline, duration and lag calculation resolves here** |
| [[VRS-F005_The_Bench_Forecast|VRS-F005]] | Assignment and the 100% capacity constraint |
| [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] | Capacity conflict resolution, surfaced in the assignment panel |
| [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | TimesheetEntry. Projects becomes the primary entry surface, additively |
| [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] | The skill matcher. Staffing a deliverable asks the same question |
| [[VPJ-F002]] | Search. Projects registers its node types into the same index |
| [[VPJ-F003]] | Notifications. Projects registers subscription rules, never a second mechanism |
| [[VPJ-F004]] | Audit |
| [[VRS-F006_Rate_Card_Engine|VRS-F006]] | RateCard, for project pricing |

**Ten features Projects does not build.** An agency that has run Roster for a quarter has employees, calendars, skills, assignments and timesheet history already in the graph — and Projects becomes useful on day one rather than after a month of data entry.

---

## The opinionated spine

Roster's philosophy produced concrete mechanisms — a hard cap of ten custom fields, a fixed five-value time category set, a closed pipeline stage enum. **Projects needs its own, and they are what stop the opinion softening feature by feature under customer pressure.**

Seven structural decisions, each permanent.

### 1. The Deliverable is the atomic unit, and it is defined by three properties

**A Deliverable is a thing promised to a client, carrying a client-facing deadline, a client approval gate, and a billing milestone.**

If a piece of work has none of those, **it is a Task, not a Deliverable.** That is the definitional test, and it is what makes this product structurally different from every general-purpose tool. Linear's atomic unit is the Issue — a thing an engineer does. Asana's is the Task. Neither has a concept of *the client has to say yes.*

### 2. The hierarchy is exactly three levels, permanently

**Project → Deliverable → Task.** No epics, no sub-projects, no sub-tasks, no nesting below Task.

Every project tool that permits arbitrary nesting acquires six-level hierarchies that nobody can navigate, and the sixth level is always somebody's personal checklist. A Task that needs breaking down is two Tasks.

### 3. Deliverable status is a fixed enum. There are no custom workflows.

**This is the single most important decision in the product**, and it is the one customers will push hardest against.

Jira's configurability is why Jira administration is a job. Linear refused it and became the default for a generation of software teams. **Projects refuses it for agencies**, and the refusal has to be absolute, because a per-project custom status set makes every cross-project view meaningless and every benchmark incomparable.

### 4. Deadline-driven, never sprint-driven

**No sprints, no velocity, no story points, no burndown.** An agency's timeline is set by a client's deadline, not by a two-week cadence a team chose. Estimation is in hours against a deliverable, because hours are what get billed.

### 5. Revision rounds are finite and contracted

**A project specifies how many revision rounds a deliverable includes.** Rounds are counted. **Exceeding the contracted number automatically opens a Change Order** rather than being absorbed silently.

Unlimited revisions is the single largest source of unbilled margin erosion in agency work, and it is invisible in every existing tool because no tool counts.

### 6. Custom fields are capped per workspace, not per application

[[VPJ-F010]] caps custom fields at ten active definitions per workspace. **Projects does not get its own ten.** It shares Roster's.

A per-application cap erodes the discipline as applications ship — nine apps at ten fields each is ninety, which is exactly the ungoverned sprawl the cap exists to prevent.

### 7. One approval model, not a configurable one

**Submit → client reviews → approve or request revision.** No multi-stage client approval chains, no conditional routing, no approval matrices. An agency needing more has a governance problem that software should not smooth over.

---

## Document series

**`VPJ-` — Vulto Projects Specs.** The same four-series structure [[VPS-000_Documentation_Standard|VPS-000]] defines, with Meta and Design omitted because both are inherited.

| Series | Range | Purpose |
|---|---|---|
| **Meta** | `VPJ-001` | This register. [[VPS-000_Documentation_Standard|VPS-000]] governs everything else |

| **Feature** | `VPJ-F001`–`VPJ-F051` | Fifty-one features |

Frontmatter `Type` is `Vulto Projects Specs`. Both enums, the linking convention, the section template and the no-open-items rule are inherited unchanged.

---

## Architecture

| Code | Document | Phase | Type |
|---|---|---|---|
| [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] | Projects Graph Schema Extension | Architecture | Platform |

**One document.** It registers Projects' new node types into [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s existing graph — Client, Project's full schema, Deliverable, Task, Brief, ChangeOrder, RevisionRound, Approval, ProjectTemplate — with their privacy classes, tiers and edges, and extends the Cross-Suite Node Ownership table.

Not a second graph. **The same graph, the same `workspace_id` scoping, the same interceptor.**

---

## Features

### MVP — an agency can run delivery

Seventeen features. The test: could a twenty-person agency move their client delivery off Asana and be better off on day one.

| Code | Feature | Type | Note |
|---|---|---|---|
| [[VPJ-F001]] | Client Foundation | Core | Bootstraps [[Vulto Sales]]' Client node |
| [[VPJ-F002]] | Project Foundation | Core | The container, and the Project/Retainer mode toggle |
| [[VPJ-F003]] | Deliverable Architecture | Core | **The atomic unit.** Deadline, approval gate, billing milestone |
| [[VPJ-F004]] | Task Layer | Core | Inside a Deliverable. Assigned to a person. Never nested |
| [[VPJ-F005]] | Brief Builder | Core | The structured north star every task references |
| [[VPJ-F006]] | Project Team and Staffing | Core | Reads [[VRS-F005_The_Bench_Forecast|VRS-F005]], [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] and [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] |
| [[VPJ-F007]] | Deliverable Timeline | Core | Deadline-anchored, never sprint-anchored |
| [[VPJ-F008]] | My Work | Experience | One person's tasks across every project |
| [[VPJ-F009]] | Deliverable Time Logging | Core | Extends [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] to log against a Deliverable |
| [[VPJ-F010]] | Deliverable Status and Approval Gate | Core | The fixed enum, and the gate |
| [[VPJ-F011]] | Client Review Surface | Experience | Bootstraps [[Vulto Comms]]' portal |
| [[VPJ-F012]] | Revision Rounds | Financial | Contracted, counted, and the trigger for F013 |
| [[VPJ-F013]] | Change Order | Financial | The scope creep mechanism |
| [[VPJ-F014]] | Project Budget and Burn | Financial | Bootstraps [[Vulto Accounts]] |
| [[VPJ-F015]] | Deadline Lag Alert | Intelligence | Velocity against deadline, early enough to act |
| [[VPJ-F016]] | Project Templates | Platform | Recurring engagement types |
| [[VPJ-F017]] | Project Closure | Core | Including case study marking for [[Vulto Pitch]] |

### Post-MVP — depth on a working product

Sixteen features.

| Code | Feature | Type |
|---|---|---|
| [[VPJ-F018]] | Client Stakeholder Map | Core |
| [[VPJ-F019]] | Deliverable Dependencies | Core |
| [[VPJ-F020]] | Retainer Mode | Financial |
| [[VPJ-F021]] | Retainer Consumption Alert | Financial |
| [[VPJ-F022]] | Annotation and Markup | Experience |
| [[VPJ-F023]] | Client Responsiveness Tracking | Intelligence |
| [[VPJ-F024]] | Project Health Score | Intelligence |
| [[VPJ-F025]] | Estimate vs Actual | Intelligence |
| [[VPJ-F026]] | Definition of Done | Compliance |
| [[VPJ-F027]] | Project Document Layer | Platform |
| [[VPJ-F028]] | Client Communication Log | Core |
| [[VPJ-F029]] | Projects Notification Rules | Platform |
| [[VPJ-F030]] | Projects Search Registration | Platform |
| [[VPJ-F031]] | Portfolio View | Experience |
| [[VPJ-F032]] | Workload Balance View | Experience |
| [[VPJ-F033]] | Project Archive | Core |

### Scale — intelligence and the financial layer

Twelve features.

| Code | Feature | Type |
|---|---|---|
| [[VPJ-F034]] | Scope Creep Analytics | Intelligence |
| [[VPJ-F035]] | Cycle Time Analytics | Intelligence |
| [[VPJ-F036]] | Estimate Accuracy Engine | Intelligence |
| [[VPJ-F037]] | Deadline Risk Forecaster | Intelligence |
| [[VPJ-F038]] | Client Profitability | Financial |
| [[VPJ-F039]] | Project Margin Forecast | Financial |
| [[VPJ-F040]] | Delivery Capacity Planning | Intelligence |
| [[VPJ-F041]] | Project Utilization View | Intelligence |
| [[VPJ-F042]] | Billing Milestone Engine | Financial |
| [[VPJ-F043]] | Project Pricing and Rate Application | Financial |
| [[VPJ-F044]] | Projects Intelligence Contribution | Intelligence |
| [[VPJ-F045]] | Projects Reporting and Export | Platform |

### Mature — ecosystem and reach

Six features.

| Code | Feature | Type |
|---|---|---|
| [[VPJ-F046]] | Vulto Proof Full Annotation Layer | Experience |
| [[VPJ-F047]] | Client Portal Handoff | Platform |
| [[VPJ-F048]] | Projects API Surface | Platform |
| [[VPJ-F049]] | Project Custom Fields | Platform |
| [[VPJ-F050]] | Mobile Delivery Experience | Experience |
| [[VPJ-F051]] | Cross-Project Dependency View | Experience |

---

## The features worth arguing about

Most of the fifty-one are unsurprising. Six are the reason this product wins.

**[[VPJ-F012]] Revision Rounds.** No project tool counts revisions, and unlimited revisions is where agency margin actually dies. A deliverable includes three rounds; the fourth automatically opens a Change Order. **The agency stops having the awkward conversation, because the system has it structurally.**

**[[VPJ-F013]] Change Order.** The scope change that generates a task and an email thread and no commercial document. Change Orders make every moved boundary a priced, documented, client-accepted record — and their history reveals which clients routinely expand scope without expecting to pay, which is renewal-negotiation intelligence no standalone tool can produce.

**[[VPJ-F023]] Client Responsiveness Tracking.** Genuinely novel, and only possible in an integrated system. **A client who historically takes six working days to approve should make your timeline six days longer.** Every agency knows which clients are slow; no tool has ever made the timeline know it. This feeds [[VPJ-F037]]'s risk forecast and the Client Health Score.

**[[VPJ-F025]] Estimate vs Actual.** Every agency estimates deliverables and almost none checks afterward. Feeding actual hours back against original estimates, by deliverable type and by client, is how quoting improves — and it flows to [[Vulto Quotations]] when that exists.

**[[VPJ-F015]] Deadline Lag Alert.** Calculating required velocity from logged hours against the client-facing deadline, surfacing risk early enough to renegotiate rather than apologize. Not a Friday-before-Monday discovery.

**[[VPJ-F011]] Client Review Surface.** A bootstrap for [[Vulto Comms]], and the feature that closes the loop. Without a place for a client to actually approve, the approval gate is a status somebody sets on the client's behalf — which is exactly the fiction this product exists to remove.

---

## Cross-suite ownership additions

[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s table gains these rows. [[VPJ-F008]]'s write-authority interceptor enforces them.

| Node Type | Authoritative Owner | Transfer shape |
|---|---|---|
| Deliverable, Task, Brief, ChangeOrder, RevisionRound, Approval, ProjectTemplate | **Vulto Projects, permanent** | No other application ever writes these |
| Client | [[Vulto Sales]] | **Projects bootstraps.** Exclusive transfer on Sales activation |
| Project | **Vulto Projects** | Already in the table. Field-split: Roster keeps capacity fields |
| TimesheetEntry | Roster bootstrap | Already in the table. **Additive, never exclusive** |
| BillingMilestone | [[Vulto Accounts]] | **Projects bootstraps.** Exclusive transfer on Accounts activation |

**The Client Health Score is deliberately partial at this stage**, and [[VPJ-F024]] must say so. The composite draws on approval speed from Projects, payment behavior from Accounts, interaction frequency from Comms and profitability from Accounts. **Only the first exists.** A score presented as complete when three of its four inputs are absent would be a number nobody should act on.

---

## Build order

**Strictly sequential through MVP**, for the same dependency reasons Roster's was.

[[VPJ-F001]] and [[VPJ-F002]] before anything, since Client and Project contain everything else. [[VPJ-F003]] before [[VPJ-F004]], because a Task exists inside a Deliverable. [[VPJ-F010]]'s approval gate before [[VPJ-F011]]'s review surface, since one is the mechanism and the other is where a client operates it. [[VPJ-F012]] before [[VPJ-F013]], because exceeding rounds is what opens a Change Order.

**[[VPJ-F009]] deserves a note.** Projects becomes the primary time entry surface and [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s Speed-Run remains available permanently, per the additive ownership rule. This feature adds deliverable attribution to entries; it does not replace or deprecate anything.

---

## When to start

**After Roster's MVP — [[VPJ-F001]] through [[VPJ-F006]] — not after all seventy-eight.**

At that point every one of the ten consumed features exists. Post-MVP and Scale are recruitment, payroll and analytics, none of which Projects depends on, and payroll's profitability figures become *more* useful once deliverable-level cost attribution exists.

There is also a data argument. Every hour logged in Roster before Projects exists has no deliverable to attach to. **Starting earlier means less timesheet history written under a shape it will eventually want.**

---

## Decisions recorded

**Eleven architecture and design documents are inherited, not rewritten.** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] anticipated this explicitly. Projects introduces exactly one architecture document.

**The custom field cap is per workspace, shared across applications.** A per-application cap would multiply to ninety fields across the suite, which is the sprawl the cap exists to prevent.

**Deliverable status is a fixed enum, permanently.** This is the decision customers will push hardest against and the one that must not move. Configurable workflows are why Jira administration is a job.

**Revision rounds are counted and finite.** No existing tool counts them, and unlimited revisions is the largest source of unbilled margin erosion in agency work.

**The hierarchy is capped at three levels.** Every tool permitting arbitrary nesting acquires six-level hierarchies whose deepest level is somebody's personal checklist.

**Client is bootstrapped, not owned.** [[Vulto Sales]] takes exclusive write authority on activation, per [[VPJ-F008]]'s existing mechanism. No new handoff pattern is invented.

**The Client Health Score ships partial and says so.** Three of its four inputs do not exist yet, and presenting a composite as complete would produce a number that misleads at exactly the moment it is relied on.

---

## Related Notes

- [[VPS-000_Documentation_Standard|VPS-000]] — the documentation standard this set inherits
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the graph this set extends
- [[VRS-001_Feature_Register|VRS-001]] — Roster's register, and the features consumed here
- [[Vulto Projects]] — the product vision
- [[Vulto for Professional Services]] — the suite

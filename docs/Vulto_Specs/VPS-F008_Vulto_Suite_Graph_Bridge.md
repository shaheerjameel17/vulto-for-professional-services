---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Mature
Feature Type:
  - Platform
aliases:
  - VPS-F008
---

# VPS-F008 — Vulto Suite Graph Bridge

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the sync engine and shared packages, built with this reuse in mind), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (**the Cross-Suite Node Ownership table, already fully specified with every nuance this feature enforces**), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the query interceptor this feature extends, and its write-authority principle), [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] (Device's `application` field), [[VPS-F004_Silent_Audit_Log|VPS-F004]] (AuditEntry's `actor_application`)
**Blocks:** Nothing structurally. This is the mechanism five bootstrap features have depended on since the set was first drafted.

This document is the single source of truth for this feature. It is the mechanism by which [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Cross-Suite Node Ownership table becomes enforceable rather than descriptive.

---

## A promise made in five documents, made real here

[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Cross-Suite Node Ownership table has said it plainly since before this feature existed: the table states which application is authoritative for a node type's lifecycle, **so that the discipline has something concrete to enforce.**

That sentence was always a forward reference to this document.

[[VRS-F006_Rate_Card_Engine|VRS-F006]] called the Rate Card Engine a bootstrap. [[VRS-F020_Universal_Contract_Builder|VRS-F020]] called the Contract Builder one. [[VRS-F062_Payroll_Engine_Core|VRS-F062]] called the Payroll Engine one. [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] called Contractor Invoicing one and corrected the ownership table to say so consistently.

**Every one of those trusted that "bootstrap" meant something real** — that the moment a workspace activated [[Vulto Accounts]], Roster's own Rate Card Engine would stop being able to write a new rate card, not merely be asked nicely to defer.

Nothing built so far enforces that. **This feature is what turns five features' worth of stated trust into a structural fact.**

---

## What It Is

Two things.

**ApplicationActivation** — a per-workspace record of which suite applications have been switched on.

**An extension to the query interceptor** — checking, before any write to a bootstrap-eligible node type, not only whether the calling role has permission but whether **the calling application currently holds write authority** for that node type in that workspace.

---

## Problem It Solves

Without this, the Write-Ownership Handoff Principle is a paragraph of prose and a table nothing reads.

A workspace could activate [[Vulto Accounts]], and Roster's Rate Card Engine — having no idea anything changed — would happily keep writing new rate cards indefinitely. **Two systems both believing they are the source of truth for the same node type**, which is the exact data-integrity failure the principle exists to prevent.

This is the difference between a design intention documented carefully and one a careless engineer cannot violate by accident.

---

## User-Facing Flows

### Activating an application

When a workspace's Owner sets up [[Vulto Accounts]], [[Vulto Legal]], [[Vulto Projects]] or [[Vulto Payroll]], that application's own onboarding calls this feature's activation API against the same authenticated session.

**Write authority transfers immediately and without any data migration**, since the graph never changes shape — only which application may write to parts of it.

### What a Roster user sees

An HR Admin who previously generated contracts through Roster's own builder, after [[Vulto Legal]] is activated, sees that action replaced with **a clear message directing them to Legal** — not a generic permission error leaving them to guess why something that worked yesterday no longer does.

### What never transfers

**Employee, Assignment and Entity remain Roster's permanently**, regardless of what is activated. This feature guards that boundary in both directions: **exactly as much a guard against [[Vulto Accounts]] ever writing to Employee** as against Roster continuing to write RateCard after Accounts takes over.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Connected applications | Section in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] | What is activated |

### Layout and components

A list of the four applications, each with its status, activation date, and **the node types whose write authority it holds** — stated plainly rather than implied. *Vulto Accounts — active since March. Rate cards and invoices are now created in Accounts.*

An unactivated application shows what would transfer if it were, which is the information an Owner considering activation actually needs.

**There is no activation control here.** Activation happens through the activating application's own onboarding, and a button in Roster that switches off Roster's own capabilities is a button somebody presses to see what it does.

**The redirection message is the design-critical element**, and it lives wherever the superseded action used to be — the contract builder's own screen, the rate card editor. It names the application, states that existing records remain fully visible, and links onward. A person whose tool changed under them deserves a sentence, not an error code.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Restricted | Every role reads which applications are active. Only Owner may trigger activation, through the other application |
| Superseded | The action's own surface renders the redirection message in place of the control |
| Historical | Records written before activation remain fully visible and editable per their own rules |
| Empty | *No suite applications connected.* with a line noting that Roster owns every capability until one is |

### Responsive

Unchanged.

---

## Technical Architecture

### ApplicationActivation

Standard, Tier 0 — workspace configuration, the same shape as Entity, except **Owner alone may write it.**

```
application_activation_id: UUID v4
workspace_id:              UUID
application:               enum: VultoProjects, VultoAccounts, VultoLegal,
                           VultoPayroll — the four that own a node type Roster
                           bootstraps. Vulto Sales is deliberately absent:
                           Client was never Roster's to hand off
activated_at:              timestamp
activated_by:              user_id — the Owner who confirmed it
status:                    enum: Active

— Universal Node Conventions per VPS-A002 —
```

At most one Active record per workspace and application. **Activation is one-time and permanent per pair.**

### The write-authority policy

**Read directly from [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s table, never re-decided here.**

| Node type | Owner | Transfer shape |
|---|---|---|
| RateCard | [[Vulto Accounts]] | **Exclusive.** Roster until activation, Accounts thereafter |
| Contract | [[Vulto Legal]] | **Exclusive** |
| Invoice | [[Vulto Accounts]] | **Exclusive** |
| PayRun | [[Vulto Payroll]] | **Exclusive** |
| Project | [[Vulto Projects]] | **Field-split.** Status-lifecycle fields transfer; capacity-planning fields, which [[VRS-F005_The_Bench_Forecast|VRS-F005]] writes, remain Roster's regardless |
| TimesheetEntry | [[Vulto Projects]] | **Additive, never exclusive.** Both may always write. [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s Speed-Run remains available regardless |
| Employee, Assignment, Entity | Vulto Roster | **Permanent.** No other application may ever write these |
| Client | [[Vulto Sales]] | **Not applicable.** Roster was never authorized to write it, so there is no authority to hand off |

### The interceptor extension

`writeAuthority.check` runs inside the same interceptor [[VPS-A004_Graph_Permission_Layer|VPS-A004]] establishes, **immediately after role permission passes, never instead of it.**

For an exclusive node type it checks whether an Active activation exists for the owning application. For Project's field-split it additionally reads which field group the write touches. For additive and permanent types the check always resolves in the expected direction, included for consistency rather than because those cases are ambiguous.

### Why the ownership table needed no correction

**It was already correct in every nuance before this feature existed.** Writing the enforcement only confirmed it — a genuinely unusual outcome in a set where most documents found something to fix in an earlier one.

### API contracts

```
suiteApplication.activate(workspaceId, application)
  -> { applicationActivationId, activatedAt, transferredNodeTypes }
  // Owner only. Rejected if an Active record already exists for the pair.
  // Returns what transferred, so the activating application can tell the user

suiteApplication.listActive(workspaceId) -> ApplicationActivation[]

writeAuthority.check(workspaceId, nodeType, fieldGroup?, callingApplication)
  -> { authorized, authoritativeApplication }
  // Called internally by the interceptor before any write to a
  // bootstrap-eligible node type. Not user-facing
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | ApplicationActivation carries the schema above |
| G02 | At most one Active record per workspace and application |
| G03 | `writeAuthority.check` runs inside [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor as an additional check after role permission, never a replacement |
| G04 | The policy table is read from [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s own. This feature introduces no second source of truth for node ownership |
| G05 | Employee, Assignment and Entity are permanently write-protected to Roster regardless of any activation. Enforced in both directions |
| G06 | No historical data is migrated, rewritten or re-pointed on activation. The graph's shape never changes |
| G07 | A superseded action renders a redirection naming the owning application, never a generic permission error |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F008-S01 | ApplicationActivation and one-time activation | Data |
| VPS-F008-S02 | Write-authority interceptor extension | Security |
| VPS-F008-S03 | Field-split handling for Project | Logic |
| VPS-F008-S04 | Permanent node protection, both directions | Security |
| VPS-F008-S05 | Redirection surfaces | UI |

---

## Feature Acceptance Criteria

**GIVEN** a workspace has never activated [[Vulto Accounts]]
**WHEN** a Finance Admin creates a rate card in Roster
**THEN** it succeeds exactly as [[VRS-F006_Rate_Card_Engine|VRS-F006]] specifies

---

**GIVEN** an Owner activates [[Vulto Accounts]]
**WHEN** a subsequent rate card creation is attempted in Roster
**THEN** it is rejected with a message naming Accounts, requiring no change to [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s own code — only this feature's interceptor extension

---

**GIVEN** the same activation
**WHEN** a rate card written before it is read in Roster
**THEN** it remains fully visible and correct. Activation affects future writes only

---

**GIVEN** [[Vulto Projects]] is activated
**WHEN** [[VRS-F005_The_Bench_Forecast|VRS-F005]] writes a capacity-planning field on a Project
**THEN** it succeeds, since those fields remain Roster's regardless

---

**GIVEN** the same Project's status-lifecycle field is written from Roster afterwards
**WHEN** the write is attempted
**THEN** it is rejected, since that field group transferred

---

**GIVEN** no application is ever activated
**WHEN** a workspace uses [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s Speed-Run indefinitely
**THEN** it functions exactly as specified, since timesheet write authority is additive and never exclusive

---

**GIVEN** [[Vulto Accounts]] attempts to write directly to an Employee node
**WHEN** the write is attempted
**THEN** it is rejected. Employee is permanently Roster-only regardless of activation

---

**GIVEN** an Owner attempts to activate the same application twice
**WHEN** the second attempt is made
**THEN** it is rejected

---

## Non-Functional Requirements

- `writeAuthority.check` adds no more than 20ms to any write it governs — the same budget [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s logging holds itself to inside the same interceptor
- Activation is immediate and permanent. No write through a superseded path is permitted afterwards, with no grace period
- No historical node is migrated, copied or rewritten as a consequence of activation

---

## Security Considerations

- **This is as much a protection for Roster's permanent data as a mechanism for handing bootstrap data away.** Employee, Assignment and Entity are protected from ever being written by another application, with the same rigor applied in both directions rather than only the more visible one.
- **The policy is read from [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s table and never redefined.** A second competing source of truth for node ownership would be exactly the drift this whole pass exists to eliminate.
- **The check runs after role permission, never before or instead.** A user without role-based write permission is stopped by [[VPS-A004_Graph_Permission_Layer|VPS-A004]] regardless of which application holds authority. **This feature narrows an already-permitted write; it never widens one.**
- **Activation is a one-way door and the interface should say so.** An Owner activating [[Vulto Legal]] is permanently moving contract generation out of Roster for that workspace, and the activating application's onboarding is responsible for making that clear before it happens.

---

## Out of Scope

- **Deactivating an application** — a one-way transition per workspace per application. What happens to write authority on reversal is a real question, deferred until a demonstrated need exists rather than guessed at
- **Any UI for the applications being activated** — those are not built or specified in this project. This defines the API contract their onboarding calls
- **Read-side restriction by calling application** — reads remain governed entirely by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s role rules. Only write authority is new here
- **Field-level policies beyond Project's split** — the one node type the table specifies at field granularity. A future bootstrap needing the same gets it when that feature exists

---

## Decisions Recorded

**The redirection surface is specified**, and it is the difference between a handoff that reads as a product decision and one that reads as a bug. The previous specification stated that a user sees a clear message and left it there; a person whose tool changed under them deserves a sentence naming where the capability went, confirming their existing records are intact, and linking onward.

**`transferredNodeTypes` is returned from activation**, so the activating application can tell its own user what just moved. Without it, [[Vulto Accounts]]' onboarding has no way to explain the consequence of a step it just took.

**Roster carries no activation control.** A button in Roster that switches off Roster's own capabilities is a button somebody presses to see what it does.

**The unactivated state shows what would transfer.** An Owner considering activation needs to know the consequence before committing to a one-way door.

---

## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the ownership table this feature enforces
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the interceptor this feature extends
- [[VRS-F006_Rate_Card_Engine|VRS-F006]], [[VRS-F020_Universal_Contract_Builder|VRS-F020]], [[VRS-F062_Payroll_Engine_Core|VRS-F062]], [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] — the bootstraps this makes real

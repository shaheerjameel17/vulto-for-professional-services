---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Mature
Feature Type:
  - Experience
aliases:
  - VRS-F078
---

# VRS-F078 — Mental Health and Wellness Layer

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (WellnessTriggerEvent, foundational since this set's first draft), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (the envelope encryption built for exactly this node type), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (**the absolute wellness rule, already fully specified there and requiring no correction**), [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] (**the anonymization mechanism reused directly, not reinvented for this harder case**), [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] (where a workspace configures its own resource)
**Blocks:** Nothing. This is the last feature in the set.

This document is the single source of truth for this feature.

---

## The question this project carried from its first architecture draft

[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] registered the wellness aggregate with its tier deliberately unassigned, and [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] named the same question from the start: **how does an aggregate get computed across individually Tier 3-encrypted records without decrypting a single one.**

That sat open through seventy-seven other features, honestly, rather than guessed at — because it deserved to wait for the feature that actually needed the answer.

**It did not need a new answer.** [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] solved the identical shape of problem for a lighter case: a client that already holds the sensitive answer writes a second, genuinely disconnected record alongside it, in the same action, **with no edge, no permission rule, and nothing a future compromise could ever trace back.**

This feature applies that exact mechanism a second time, to its hardest case.

---

## What this refuses to be, stated before anything else

**Not a diagnostic tool. Not a counselor. Not a substitute for a real crisis resource or a real professional.**

Every category an employee selects is self-chosen and descriptive, **never a clinical label this product assigns to them.** Every self-rating is a personal, subjective scale, **never a score this product interprets or acts on.**

This feature's entire value is a private space that is genuinely, structurally private, and a pointer toward real help — **never a claim to be that help.**

---

## What It Is

A fully private, self-only logging space, end-to-end encrypted so that **no one — including Owner, HR Admin, or Vulto's own infrastructure — can ever read an individual entry**, alongside a genuinely anonymous aggregate trend visible to HR Admin.

---

## Problem It Solves

An employee going through something difficult has nowhere in this product to note it privately, and **every wellness feature in software generally carries the same quiet asterisk** — technically, someone at the company or the vendor could read it if they chose.

**This feature is built so that asterisk does not exist.**

Separately, an HR Admin genuinely responsible for a team's wellbeing has no way to know whether something is happening at all — a spike in personal-circumstance entries this quarter — **without this feature's second half telling them a pattern exists without ever telling them whose.**

---

## User-Facing Flows

### A private space, clearly its own

This lives in **its own clearly labeled area**, deliberately not folded into [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]]'s portal alongside payslips and leave requests. Wellness deserves a calm, unambiguous entry point, not a tab beside an expense report.

### Logging an entry

A category describing what is going on — Workload, Personal Circumstance, Health, Relationship, Financial, Other — **entirely their own characterisation** — an optional private note, and optionally an intensity on their own scale.

**Nothing here is reviewed, approved, or seen by anyone else, ever.**

### A resource, offered, never forced

At the moment of logging, whatever confidential resource the workspace configured, **alongside this product's own baseline crisis reference, present regardless of whether the workspace configured anything at all.**

Viewing it is optional and changes nothing about the entry.

### Their own history

Their own past entries over time. If they choose, their own [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] pulse responses alongside them — **a connection entirely within their own Tier 3 domain**, since both are already visible to nobody but them. This feature simply puts two things they can each already see side by side.

### Resolving

The employee, and only the employee, marks their own entry resolved. **No one else can do this, request it, or see that it happened.**

### An HR Admin's view

A trend by team grouping and month — how many contributions fall into each category — **only once the disclosure threshold is met.** Below it, the response says so honestly.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Wellness | Content, own navigation entry | The private space |
| Team trend | Content | HR Admin's aggregate |

### Layout and components

**The logging surface is the calmest screen in this product**, and that is a design requirement rather than a preference. Generous spacing, no density, no counters, no progress indicators. A person opening this is not scanning a dashboard.

A category selector as large Cards. A Textarea with no character count. An optional intensity selector with **no labels beyond numbers** — a scale reading *Mild* to *Severe* is a clinical framing this feature has no standing to impose.

**The resource sits at the foot, always visible, never modal.** Present before, during and after logging. A resource that appears only on submission is a resource offered at the wrong moment.

**A privacy line appears on every visit**, not once at setup: *Only you can see what you write here. Not your manager, not HR, not the founder, not Vulto.* The claim is the feature, and a person deciding whether to write something honestly is deciding in that moment.

**The team trend** is a simple bar chart by category, with the contribution count and the threshold both stated. Below threshold, the reason renders in place of the chart. **No trend line, no comparison across teams, no period-over-period delta** — each would invite a reader to draw a conclusion about a specific group of people from data that exists to say only that a pattern is present.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton. A draft entry is never lost |
| Restricted | An individual entry is structurally absent to every role including Owner |
| Suppressed | The reason stated in place of the chart |
| Empty | *Nothing logged.* Stated neutrally, with no encouragement to log something |
| Error | A failed write preserves the text locally and retries |

### Responsive

Works unchanged to 375px, and this is the surface most likely to be opened on a phone, privately, away from a desk.

---

## Technical Architecture

### WellnessTriggerEvent

**Self-only absolute, Tier 3.**

```
wellness_trigger_event_id: UUID v4
workspace_id:              UUID
employee_id:               UUID, FK to Employee — Tier 3 already means no
                           device but this employee's own ever decrypts it
trigger_category:          enum: Workload, PersonalCircumstance, Health,
                           Relationship, Financial, Other — self-chosen.
                           This feature never assigns or infers one
notes:                     text, nullable — private, free-form
self_rating:               integer 1–5, nullable — personal and subjective,
                           never a clinical assessment
viewed_resource:           boolean, default false
lifecycle_status:          enum: Active, Resolved
resolved_at:               timestamp, nullable

— Universal Node Conventions per VPS-A002 —
```

### WellnessAggregateContribution

Standard, Tier 0 — **deliberately, since it carries no identifying link to anyone.**

```
wellness_aggregate_contribution_id: UUID v4
workspace_id:       UUID
team_grouping:      string, nullable — a snapshot of the contributor's team at
                    submission, captured as a plain value, never an edge back
                    to any Employee or Manager node
trigger_category:   string
contribution_month: "YYYY-MM" — month precision only

— Universal Node Conventions per VPS-A002, excepting created_by —
```

**`created_by` is omitted deliberately**, the same exemption [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s contribution carries. Recording who created it would reintroduce exactly the identifying link the node exists to avoid.

**No field on this node, and no edge from it, ever resolves back to a specific Employee.** This is the entire mechanism; there is no second layer standing behind it.

### The dual write

`wellness.log` writes both records in **one client-side action** — the private event, and a separate contribution snapshotting team and category with no link back.

**This is not a summary computed later from the private record.** It is authored fresh, at the same moment, by the same client that already holds the plaintext.

### The threshold, set higher

Disclosure control per [[VPS-A004_Graph_Permission_Layer|VPS-A004]], using `k_anonymity_minimum_sensitive` — default eight, **higher than the general threshold** — because these contributions describe personal distress rather than general sentiment.

### The baseline resource

`wellness_resource_text` and `wellness_resource_contact` on Workspace let an Owner configure their own EAP or counseling service, per [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

**This feature additionally maintains a baseline crisis reference shown regardless of whether a workspace configured anything**, so an employee is never left with nothing. The specific wording, numbers and jurisdiction-appropriate resources are a content and localisation decision at implementation; **this document specifies only that a baseline must exist and must never depend on workspace configuration to appear.**

### The one connection, and nothing else

`wellness.getMyFullPicture` reads the caller's own pulse history per [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], unmodified, alongside their own entries. **Both are already visible to nobody but this one person.**

**No other feature's data is ever read here, and this feature reads nothing from [[VRS-F052_Workload_Strain_Signal|VRS-F052]] or [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] in either direction** — keeping the boundary those two state from their side equally clean from this one.

### API contracts

```
wellness.log(employeeId, triggerCategory, notes?, selfRating?) -> { success }
  // Writes the private event and a separate contribution in one client-side
  // action

wellness.resolve(wellnessTriggerEventId) -> { success }
  // The owning employee only. No other caller can ever succeed

wellness.getMyHistory(employeeId) -> WellnessTriggerEvent[]

wellness.getMyFullPicture(employeeId) -> {
  wellnessTriggerEvents, myPulseHistory
}
  // myPulseHistory calls VRS-F048's own getMyHistory directly

wellnessAggregate.getTeamTrend(teamGrouping, month) -> {
  totalContributions, byCategory: { category, count }[]
} | Suppressed
  // Owner Read, HR Admin Full. Withheld below the sensitive threshold,
  // checked before any count is computed
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Both node types carry the schemas above. `logged_by` connects the private event to Employee |
| G02 | WellnessAggregateContribution carries no edge to Employee, ever, and omits `created_by`. Enforced as a schema-level absence |
| G03 | `wellness.log` writes both records in one client-side action. The contribution is never derived from the private record afterwards |
| G04 | The trend is withheld below `k_anonymity_minimum_sensitive`, checked before any count is computed |
| G05 | This feature never reads [[VRS-F052_Workload_Strain_Signal|VRS-F052]] or [[VRS-F053_Retention_Risk_Indicator|VRS-F053]]. The boundary is kept equally clean from this side |
| G06 | `getMyFullPicture` reads [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s own call unmodified, for the caller's own data only |
| G07 | The wellness aggregate is a computed view over contributions, Standard Tier 0. It is not a stored node |
| G08 | `contribution_month` carries month precision only |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F078-S01 | Private logging schema | Security |
| VRS-F078-S02 | Dual-write anonymous contribution | Security |
| VRS-F078-S03 | Personal history and the pulse connection | UI |
| VRS-F078-S04 | HR Admin aggregate trend | UI |
| VRS-F078-S05 | Resource configuration and baseline fallback | Data |

---

## Feature Acceptance Criteria

**GIVEN** an employee logs an entry
**WHEN** it completes
**THEN** a private event exists visible only to them, and a separate contribution exists with no edge to any Employee node, both in one action

---

**GIVEN** the contribution table is exported in full from the database
**WHEN** it is inspected
**THEN** no row contains any field or edge resolving to an Employee, including `created_by`

---

**GIVEN** an Owner attempts to view any employee's individual entry
**WHEN** the request is made
**THEN** it is structurally absent — the same absolute rule this project has stated from every other feature's side and now confirms from its own

---

**GIVEN** a team has 5 contributions against a threshold of 8
**WHEN** an HR Admin requests the trend
**THEN** it is suppressed with the reason stated, not a computed breakdown

---

**GIVEN** a workspace has not configured its own resource
**WHEN** an employee opens the logging surface
**THEN** the baseline crisis reference is still shown, never dependent on configuration

---

**GIVEN** an employee views their own full picture
**WHEN** it loads
**THEN** their own entries and their own pulse history both appear, and no other employee's data of either kind ever does

---

**GIVEN** a code review checks whether this feature reads [[VRS-F052_Workload_Strain_Signal|VRS-F052]] or [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] anywhere
**WHEN** the check runs
**THEN** no such reference exists

---

## Non-Functional Requirements

- The contribution schema contains no field capable of resolving to an Employee, verified as a schema-level property rather than a runtime check
- Logging and personal history resolve within 200ms
- Logging, viewing and resolving all function offline. The trend requires contributing devices to have synced

---

## Security Considerations

- **The anonymization is structural, not procedural.** A contribution cannot be traced to an individual because no field or edge makes that traversal possible — by design, not by a policy a future change could loosen.
- **The threshold is higher than the general one, deliberately.** Personal distress data warrants at least the protection compensation receives, arguably more.
- **This feature makes no diagnostic or clinical claim anywhere in its design.** Categories are self-chosen, ratings are personal, and the product's role is a private space and a pointer toward real help — never a substitute for either.
- **The baseline crisis resource is a structural requirement, not a configurable default that could be left unset.** An employee must never encounter this feature with genuinely nothing offered, regardless of whether their workspace thought to configure something.
- **This is the one rule in the entire graph with no override path.** Not for Owner, not for a workspace configuration, not for a support request, not for a court order — the last of those being the reason it is cryptographic rather than a permission row.

---

## Out of Scope

- **Any integration with [[VRS-F056_Proactive_Daily_Briefing|VRS-F056]]'s daily briefing** — a deliberate boundary. An absolute privacy layer does not surface through a cross-cutting briefing, even as a self-only nudge
- **Folding this into [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]]'s portal** — wellness earns its own entry point, not a tab beside a payslip
- **Any machine-derived interpretation, scoring or pattern detection over an individual's entries** — this stores what an employee chooses to record; it does not analyze it on their behalf
- **Specific crisis-resource content or jurisdiction-specific text** — a content and localisation decision at implementation. This document specifies only that a baseline must always exist
- **Any counseling, therapy or treatment functionality** — a private log and a pointer, never the resource itself
- **Narrowing the absolute Tier 3 rule under any configuration, for any role, including Owner** — permanently non-configurable

---

## Decisions Recorded

**The architecture question this project carried from its first draft is resolved by recognizing [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] had already answered it.** No new mechanism was invented for the harder case; the proven one was applied to it.

**`created_by` is omitted from the contribution**, matching [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s exemption. The Universal Node Conventions require it, and requiring it here would reintroduce the exact link the node exists to avoid.

**The threshold moves to [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s unified mechanism** at the sensitive level, rather than this feature carrying its own configuration key.

**The intensity scale carries no labels beyond numbers.** *Mild* to *Severe* is a clinical framing this feature has no standing to impose on someone describing their own experience.

**The team trend shows no period-over-period comparison.** A delta invites a reader to draw a conclusion about a specific group of people from data that exists only to say a pattern is present.

**The privacy statement appears on every visit.** The claim is the feature, and a person deciding whether to write something honestly is deciding in that moment rather than at onboarding.

---

## Related Notes

- [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] — the mechanism reused here
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the absolute rule, and the disclosure threshold
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the encryption that makes this structural rather than policy
- [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] — where a workspace configures its own resource

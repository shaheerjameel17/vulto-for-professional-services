---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Mature
Feature Type:
  - Experience
aliases:
  - VRS-F077
---

# VRS-F077 — Monthly Coffee Pulse

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] (**the private-entry pattern reused for the Tier 3 half; the boundary confirmed from this side**), [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (CoffeePulseEntry and SharedCoffeeMoment), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 3 encryption)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## The boundary with [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], confirmed from this side

That feature stated the distinction when it was written: this one is separate, deliberately lighter, sharing the same privacy shape but not the cadence, structure or purpose.

**Confirmed from here: this feature attempts no team-level sentiment aggregation at all.** That is [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s entire reason to exist, and duplicating it at a smaller scale would have made this *[[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], but less* rather than a genuinely different thing.

This feature's job is individual reflection and, only if the employee chooses, **a small voluntary moment of team connection** — never an organizational metric.

---

## What It Is

A monthly, casual prompt, **private by default** under the same absolute Tier 3 protection [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s entries carry, meant for an employee's own reflection more than for any insight.

An employee may optionally share something with the workspace **in their own words** — a small voluntary act of visibility, never an exposure of the private entry itself.

---

## Problem It Solves

**Not every check-in needs to produce an organizational metric.**

A lightweight, low-stakes monthly prompt — closer to a coffee-break conversation than a survey — gives people a moment to reflect without the weight of *this feeds a report somewhere*, and gives a team a small entirely optional way to share something human, without ever requiring it.

---

## User-Facing Flows

### The monthly prompt

A casual prompt from a fixed rotating set — *what's one thing that made this month better*, *coffee, tea, or something else keeping you going* — **not the same question every cycle** the way [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s structured pulse deliberately is.

### Responding privately

A free-form response, optionally with a mood indicator. Tier 3, visible only to them. **Nobody, including Owner, ever sees another employee's private entry.**

### Choosing to share

At the moment of responding, an employee may **also** share something with the workspace — **separate text they write for that purpose**, not their private answer republished. The private response can be reused if that is genuinely what they want to say publicly, but that is a choice made in the moment rather than a default.

Not sharing means nothing beyond the private entry ever exists.

### Viewing shared moments

A small casual bulletin of whoever chose to post something that month, alongside their own private history, visible only to themselves.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Coffee pulse | Content | The prompt, the bulletin, own history |

### Layout and components

**The prompt** is a Card with the month's question at `h2`, a Textarea, an optional mood selector as a small Toggle Group, and a **Share with the team** Switch.

Enabling the Switch reveals a second Textarea, pre-filled with nothing, and a line: *This is what your colleagues will see. Your private response stays private.* **Pre-filling it with the private response would make republishing the default and sharing an act of omission**, which is exactly backward for a feature whose entire premise is that privacy is the default.

**The bulletin** is a simple list of that month's shared moments — avatar, name, the shared text, the mood. Deliberately plain: no reactions, no comments, no count. **A bulletin with engagement metrics is a bulletin people perform for**, and the point is a small human moment rather than a small social platform.

**Own history** sits beneath, collapsed by default, showing past private entries by month. Never any comparison to anyone.

### Keyboard

Standard bindings. `Cmd+Enter` submits.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | A private entry is structurally absent to everyone but its author, including Owner |
| Already responded | The prompt renders answered, with an edit path for the private entry only |
| Empty bulletin | *Nobody has shared this month.* Stated plainly, without encouragement to be first |
| Error | Not applicable |

### Responsive

Works unchanged to 375px. Most likely opened on a phone.

---

## Technical Architecture

### CoffeePulseEntry

Sensitive, Tier 3.

```
coffee_pulse_entry_id: UUID v4
workspace_id:          UUID
employee_id:           UUID, FK to Employee
month:                 "YYYY-MM"
prompt_text:           string — the specific prompt shown that month
response_text:         text
mood_emoji:            string, nullable
shared_with_team:      boolean, default false — a flag recording that a share
                       was made, never the shared content itself
submitted_at:          timestamp

— Universal Node Conventions per VPS-A002 —
```

### SharedCoffeeMoment

Standard, Tier 0 — **genuinely public by the employee's own explicit choice.**

```
shared_coffee_moment_id: UUID v4
workspace_id:            UUID
employee_id:             UUID — the sharer, visible, since this record exists
                         only because they chose to be visible with it
month:                   "YYYY-MM"
shared_text:             text — authored at share time, may differ entirely
mood_emoji:              string, nullable

— Universal Node Conventions per VPS-A002 —
```

### Why sharing creates a second record

Making the private entry's Tier 3 flag conditionally public would mean **a single node type behaving differently depending on a runtime setting** — exactly the ambiguity the tier model exists to prevent.

Sharing is authored as a distinct act, a separate node, at the moment the employee chooses it. **The private entry's Tier 3 status never changes under any circumstance, including the employee's own choice to share something separately.**

### The rotating prompt set

Fixed and product-defined, **not workspace-configurable** the way [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s cycle is. A lightweight monthly check-in does not need per-workspace configuration to do its job, and making it configurable would invite it to become a survey instrument — which is the other feature.

### API contracts

```
coffeePulse.getMonthlyPrompt(month) -> { promptText }

coffeePulseEntry.submit(employeeId, responseText, moodEmoji?,
                        shareWithTeam, sharedText?) -> { success }
  // Always creates a private entry. Where shareWithTeam is true, also
  // creates a separate SharedCoffeeMoment using sharedText

coffeePulseEntry.getMyHistory(employeeId) -> CoffeePulseEntry[]
  // The caller's own only

sharedCoffeeMoment.listForMonth(workspaceId, month) -> SharedCoffeeMoment[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Both node types carry the schemas above |
| G02 | A SharedCoffeeMoment is created only through an explicit choice at submission. No code path creates one from a private entry without that choice |
| G03 | CoffeePulseEntry's Tier 3 status is absolute and unaffected by whether the same employee also shares |
| G04 | This feature computes no team-level aggregate of any kind. That remains [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s territory |
| G05 | The shared text field is never pre-filled from the private response |
| G06 | Prompts are product-defined and not workspace-configurable |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F077-S01 | Private entry schema and submission | Data |
| VRS-F077-S02 | Optional shared moment authoring | Logic |
| VRS-F077-S03 | Prompt rotation | Data |
| VRS-F077-S04 | Bulletin and own history | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee responds without sharing
**WHEN** it completes
**THEN** only a private entry exists, Tier 3, and no shared moment is created

---

**GIVEN** they respond and choose to share, writing different text
**WHEN** it completes
**THEN** both records exist — the private entry with the original text, and a shared moment with the distinct text

---

**GIVEN** they enable the share Switch
**WHEN** the second field appears
**THEN** it is empty, not pre-filled with their private response

---

**GIVEN** an Owner attempts to view another employee's private entry
**WHEN** the request is made
**THEN** it is structurally absent

---

**GIVEN** a workspace requests a team sentiment aggregate from this feature
**WHEN** the request is made
**THEN** no such capability exists

---

**GIVEN** nobody has shared this month
**WHEN** the bulletin renders
**THEN** it says so plainly, without prompting anyone to be first

---

## Non-Functional Requirements

- Submission and the bulletin resolve within 200ms from the local graph
- Full functionality offline — responding, sharing and viewing

---

## Security Considerations

- **The private entry's Tier 3 status has no exception**, including for the same employee's own choice to share. Sharing is authored fresh as a separate act, never a visibility change to the private record.
- **The shared field is never pre-filled**, which is a privacy decision rather than a UI preference. Pre-filling would make republishing the default and privacy an act of omission, inverting the premise.
- **This feature introduces no aggregation surface, no disclosure threshold and no cross-pattern concern.** Its privacy shape is either [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s proven Tier 3 pattern reused directly, or Tier 0 for content an employee explicitly chose to make public.
- **The bulletin carries no engagement mechanics** — no reactions, no counts. A bulletin people perform for is a different feature with a different effect on the culture it claims to support.

---

## Out of Scope

- **Any team-level or workspace-level sentiment aggregation** — [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s territory entirely
- **Reactions, comments or engagement counts on a shared moment** — deliberately excluded
- **Editing or deleting a shared moment after the fact** — once shared it stands for that month
- **Workspace-configurable prompts** — fixed and product-defined
- **Participation tracking of any kind** — no response rate, workspace-wide or otherwise. This is the lightest surface in the product and measuring it would make it something else

---

## Decisions Recorded

**The shared text field is never pre-filled from the private response.** The previous specification permitted reusing it, which is fine as a choice and wrong as a default — pre-filling makes republishing the path of least resistance and privacy an act of omission.

**The bulletin carries no engagement mechanics.** Reactions and counts turn a small human moment into a small social platform, and people perform for the second in a way that defeats the first.

**No participation tracking of any kind**, unlike [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] which reports a workspace-wide response rate. This is the lightest surface in the product, and measuring participation would make it an instrument rather than an invitation.

---

## Related Notes

- [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] — the structured counterpart this feature deliberately is not
- [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] — which shares the same absolute Tier 3 privacy shape

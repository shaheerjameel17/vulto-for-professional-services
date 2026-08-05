---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Intelligence
aliases:
  - VRS-F048
---

# VRS-F048 — Employee Pulse Surveys

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (PulseCycle, PulseEntry and PulseAggregateContribution), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 3 encryption), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (**the unified k-anonymity mechanism, which this feature no longer implements for itself**), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the job scheduling a cycle)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Two boundaries, stated before the design

**With [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]].** This is the structured, recurring pulse mechanism. That is a deliberately lighter, more informal check-in. They share a privacy shape — Tier 3, `submitted_by` to Employee — and are two different surveys with two different purposes, not one feature wearing two names.

**With [[VRS-F052_Workload_Strain_Signal|VRS-F052]].** That feature states as an absolute constraint that it never reads anything self-reported or subjective. This feature's entire output is exactly that category. The boundary exists from both sides: **this feature never writes to, triggers, or otherwise feeds that signal.** Team-level anonymized trend data could be legitimate context for something someday; an individual response never can be, regardless of who is asking.

---

## What It Is

A recurring, single-question sentiment survey. Every individual response is Tier 3 — as private as wellness data, visible only to the person who submitted it, not to Owner.

Team-level insight is still produced, but through **genuine anonymization**: a separate, unlinked contribution with no edge back to the individual at all, rather than through permission rules a role change could someday loosen.

---

## Problem It Solves

Sentiment data is only honest if people believe answering truthfully carries no risk.

A survey that is technically anonymous because of a permission setting invites justified suspicion — permissions change, an Owner could be granted access, a database can be queried directly. **Every employee who has been told a survey is anonymous and did not quite believe it has answered it differently**, and the resulting data is worse than none, because it looks like signal.

This feature is built so that suspicion has no basis. The individual response and the team aggregate are two structurally different records from the moment they are created, with no path connecting them.

---

## User-Facing Flows

### A cycle opens

A cycle activates on its cadence — weekly, biweekly or monthly — presenting the same single question to every active employee.

### Responding

A sentiment score from one to five, and an optional comment. **Voluntary, with no visible consequence anywhere in the product for not responding** — no completion rate against a person's name, no reminder escalation, nothing.

### What happens on submission

Two records, in one action, deliberately unlinked.

A **PulseEntry**, Tier 3, carrying the score, the comment and an edge to the employee, visible only to them.

A **PulseAggregateContribution**, Tier 0, carrying only the score and a team grouping snapshot, with **no edge to any Employee node at all.**

### Viewing your own history

The submitter sees their own history over time. Tier 3 means visible to that one person, not invisible to everyone including themselves.

### Team-level insight

A manager sees their team's aggregate trend; an Owner or HR Admin sees a broader breakdown — but only once the cohort meets [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s threshold. Below it the result is withheld entirely with the reason named, never a number a small team's own headcount could be used to reverse-engineer.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Pulse prompt | Inbox item, per [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] | The response |
| My pulse history | Section in [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] | The submitter's own |
| Team sentiment | Content | The aggregate |
| Cycles | Content | Configuration. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |

### Layout and components

**The pulse prompt** is one question and five options, answerable in the Inbox without navigation. The comment field is present, optional and clearly marked so.

Beneath, one line, always: *Your individual response is visible only to you. Not to your manager, not to HR, not to the founder.* Stated every time rather than once at setup, because the claim is the feature and a person deciding how honestly to answer is deciding in that moment.

**My pulse history** is a simple line Chart of the submitter's own scores over time, with comments listed beneath. No comparison to any team average — a person seeing that they are consistently below their team's mean has learned something unkind about themselves from a survey that promised them privacy.

**Team sentiment** is a line Chart of the aggregate over cycles, with the response count stated for each point. Where a cycle falls below threshold, the point is absent and the gap is labeled *not enough responses*, rather than the line interpolating across it.

That last detail matters: a line drawn through a suppressed point implies a value that was withheld.

**Cycles** is a Table: title, question, frequency, active, response rate. **Response rate is workspace-wide only and never per team or per person.** A per-team response rate in a team of four identifies who did not answer.

### Keyboard

Standard Inbox bindings. `1`–`5` select a score.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | An individual entry is structurally absent to everyone but its author, including Owner |
| Suppressed | Below threshold, the aggregate is withheld with the reason named, and charts show a labeled gap |
| Empty | *No pulse cycles running.* |
| Error | A second response to the same cycle updates the existing one rather than creating a second pair |

### Responsive

Works unchanged to 375px. The prompt is most often answered on a phone.

---

## Technical Architecture

### PulseCycle

Standard, Tier 0.

```
cycle_id:          UUID v4
workspace_id:      UUID
title:             string, required
question_text:     string, required
frequency:         enum: Weekly, Biweekly, Monthly
cycle_start_date:  date
cycle_end_date:    date
is_active:         boolean, default true

— Universal Node Conventions per VPS-A002 —
```

### PulseEntry

Sensitive, Tier 3.

```
entry_id:         UUID v4
workspace_id:     UUID
employee_id:      UUID, FK to Employee
cycle_id:         UUID, FK to PulseCycle
sentiment_score:  integer, 1–5
comments:         text, nullable
submitted_at:     timestamp

— Universal Node Conventions per VPS-A002 —
```

### PulseAggregateContribution

Standard, Tier 0 — deliberately, since it carries no identifying link.

```
contribution_id:  UUID v4
workspace_id:     UUID
cycle_id:         UUID, FK to PulseCycle
team_grouping:    string, nullable — a SNAPSHOT of the submitter's team or
                  department at submission, captured as a plain value, never
                  as an edge back to any Employee or Manager node
sentiment_score:  integer, 1–5
submitted_at:     timestamp — DATE PRECISION ONLY, see below

— Universal Node Conventions per VPS-A002, excepting created_by —
```

**`created_by` is deliberately omitted from this node type**, the only such omission in the product besides [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s. The Universal Node Conventions record who created a node; recording it here would reintroduce exactly the identifying link the node's design exists to avoid.

**`submitted_at` carries date precision only.** A full timestamp on an anonymous contribution, correlated against a Tier 0 audit trail or a device sync time, narrows the submitter substantially in a small team. Rounding to the day is what keeps the anonymization genuine rather than nominal.

### The anonymization mechanism

At submission the client — which holds the plaintext input — writes both records. `team_grouping` is a snapshot string, not a resolvable edge.

**A full database export of every contribution row contains no path back to any Employee node.** Anonymization by the absence of a link, not by a permission rule governing a link that exists.

### Disclosure control is [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s

**This feature no longer implements its own threshold.** The previous specification carried `pulse_minimum_responses_threshold`, one of four independent implementations of the same idea. [[VPS-A004_Graph_Permission_Layer|VPS-A004]] now owns one mechanism, and this feature calls it.

The practical gain is not only consistency. That mechanism includes **differencing protection**, which none of the four independent implementations had: a query for a department of twelve and one for the same department excluding contractors, eleven, would otherwise reveal the twelfth person's score by subtraction with both queries individually compliant.

Because these contributions derive from Tier 3 data, `k_anonymity_minimum_sensitive` applies — default eight, higher than the general threshold.

### API contracts

```
pulseCycle.create(title, questionText, frequency) -> { cycleId }

pulseEntry.submit(cycleId, sentimentScore, comments?) -> { success }
  // Writes both records in one client-side action

pulseEntry.getMyHistory(employeeId) -> PulseEntry[]
  // The caller's own entries only

pulseAggregate.getTeamResult(cycleId, teamGrouping) -> {
  averageSentiment, responseCount
} | Suppressed
  // Passes through VPS-A004's disclosure control, including differencing
  // protection. This feature defines no threshold of its own

pulseAggregate.getTrend(teamGrouping?, cycleCount?) -> {
  cycleId, averageSentiment, responseCount
}[] | { suppressedCycles: cycleId[] }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | The three node types carry the schemas above |
| G02 | PulseAggregateContribution carries no edge to Employee, ever, and omits `created_by`. Enforced as a schema-level absence, not a permission rule |
| G03 | `submitted_at` on a contribution carries date precision only |
| G04 | Aggregates pass through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s disclosure control at `k_anonymity_minimum_sensitive`. This feature defines no threshold |
| G05 | This feature never writes to, reads from, or interacts with any node type in [[VRS-F052_Workload_Strain_Signal|VRS-F052]]'s or [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]'s domain |
| G06 | Response rate is reported workspace-wide only, never per team or per person |
| G07 | A repeat submission for the same cycle updates the existing pair rather than creating a second |
| G08 | A suppressed cycle renders as a labeled gap in any trend, never interpolated across |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F048-S01 | PulseCycle configuration | Data |
| VRS-F048-S02 | Dual-write submission with structural anonymization | Security |
| VRS-F048-S03 | Personal history | UI |
| VRS-F048-S04 | Team aggregate with disclosure control | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee submits a response
**WHEN** it completes
**THEN** a PulseEntry exists tied to them and a separate contribution exists with no edge to any Employee node, both in one action

---

**GIVEN** the contribution table is exported in full from the database
**WHEN** it is inspected
**THEN** no row contains any field or edge resolving to an Employee, including `created_by`

---

**GIVEN** a team has six responses against a sensitive threshold of eight
**WHEN** the aggregate is requested
**THEN** it is suppressed with the reason named, and no average is computed

---

**GIVEN** a department of twelve whose aggregate displays, and a filter reducing it to eleven
**WHEN** the filter is applied
**THEN** [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s differencing protection returns the unfiltered aggregate with an indication, rather than allowing the twelfth score to be recovered by subtraction

---

**GIVEN** an employee views their own history
**THEN** every past entry of theirs is visible, with no comparison to any team average

---

**GIVEN** an Owner attempts to view another employee's entry
**WHEN** the request is made
**THEN** it is structurally absent, per Tier 3

---

**GIVEN** a trend spanning six cycles of which two were suppressed
**WHEN** the chart renders
**THEN** the two appear as labeled gaps and the line does not interpolate across them

---

**GIVEN** a codebase review checks whether this feature's data reaches [[VRS-F052_Workload_Strain_Signal|VRS-F052]]
**WHEN** the check runs
**THEN** no such path exists

---

## Non-Functional Requirements

- Team results resolve within 200ms from the local graph
- The contribution schema contains no field capable of resolving to an Employee, verified as a schema-level property
- Submission, personal history and cached aggregates function offline

---

## Security Considerations

- **The anonymization is structural, not procedural.** Most systems claiming anonymous surveys restrict who may query a link that still exists. There is no such link here to restrict.
- **`created_by`'s omission and date-only precision are both deliberate.** Each would otherwise be a residual identifying channel — the first directly, the second by correlation against sync times in a small team. An anonymization defeated by a timestamp is not an anonymization.
- **The privacy statement appears on every prompt, not once at setup.** A person deciding how honestly to answer is deciding at that moment, and a promise made during onboarding is not present when it matters.
- **Response rate is workspace-wide only.** A per-team rate in a team of four identifies who did not answer, which turns a voluntary survey into a compulsory one.
- **The boundary with [[VRS-F052_Workload_Strain_Signal|VRS-F052]] is architectural.** Sentiment feeding a burnout signal would mean an honest answer producing a manager-visible alert about the person who gave it, which is the precise betrayal this feature's whole design prevents.

---

## Out of Scope

- **[[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]]'s informal Coffee Pulse** — a separate feature
- **Feeding [[VRS-F052_Workload_Strain_Signal|VRS-F052]] in any form** — an absolute exclusion
- **Breakdowns below the disclosure threshold** — impossible by construction
- **Per-person or per-team response tracking** — deliberately excluded
- **Multi-question surveys or custom question banks.** One question per cycle. A ten-question survey is a different instrument with a different response rate and a different honesty profile
- **Comparing a person's own score to their team's** — never shown, in either direction

---

## Decisions Recorded

**The threshold moves to [[VPS-A004_Graph_Permission_Layer|VPS-A004]].** This feature previously carried one of four independent k-anonymity implementations. The unified mechanism additionally provides differencing protection, which none of the four had, and which is what actually defeats a determined query against a small team.

**`created_by` is omitted from the contribution node.** The Universal Node Conventions require it; requiring it here would reintroduce the exact link the node's design exists to avoid. One of two deliberate exemptions in the product, alongside [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s.

**`submitted_at` carries date precision only.** A full timestamp is a correlation channel against device sync times in a small team.

**Response rate is workspace-wide only.** The previous specification did not say, and a per-team rate is the most obvious way this feature could quietly become compulsory.

**The privacy statement appears on every prompt.** The claim is the feature, and it needs to be present at the moment a person decides how honestly to answer.

**Suppressed cycles render as labeled gaps.** A line interpolating across a suppressed point implies a value that was withheld, which is a subtler version of disclosing it.

---

## Related Notes

- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the disclosure control this feature calls
- [[VRS-F052_Workload_Strain_Signal|VRS-F052]] — the boundary this feature never crosses
- [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]] — the informal counterpart
- [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] — the wellness layer sharing this privacy shape

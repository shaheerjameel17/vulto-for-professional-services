---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Intelligence
aliases:
  - VRS-F055
---

# VRS-F055 — Vulto Roster Intelligence Engine

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F010_Timesheet_Speed-Run|VRS-F010]], [[VRS-F012_Revenue_Gap_Alert|VRS-F012]], [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]], [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]], [[VRS-F039_Performance_Review_Cycle|VRS-F039]], [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]], [[VRS-F051_Team_Capacity_Planner|VRS-F051]], [[VRS-F052_Workload_Strain_Signal|VRS-F052]], [[VRS-F053_Retention_Risk_Indicator|VRS-F053]], [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]], [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] (every source this feature may reason across, read not written, none corrected by this document), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Insight, the `affects` edge, and Standing Rule 7 itself), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (Insight's inherited permission behavior)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## The one permission this project grants nowhere else

Standing Rule 7 exists because every other feature was deliberately, repeatedly forbidden from reasoning across patterns. [[VRS-F052_Workload_Strain_Signal|VRS-F052]] cannot read [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]. [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] cannot feed [[VRS-F052_Workload_Strain_Signal|VRS-F052]]. [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] cannot touch either. [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] reads exactly one source and says so.

**This feature is the sanctioned exception, and being the exception is precisely why it carries the most careful privacy obligations of anything in this set, not the fewest.**

A single misjudged combination here would not leak one feature's data. It would demonstrate that the entire discipline of separating signals by sensitivity was theater the moment something was finally permitted to combine them.

**Cross-pattern is not cross-tier**, and this feature's permission is only ever the first. Standing Rule 7 authorizes combining already-surfaced objective signals into a richer explanation. It does not authorize reading anything placed behind an absolute boundary. [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] remains exactly as untouchable here as everywhere else, and this document carries no exemption, because the rule never granted one.

---

## What It Is

A reasoning layer combining already-existing, already-permissioned signals into a small number of well-defined, explainable Insight types.

**Every Insight cites exactly which records it drew from, and its visibility is set by the single most restrictive one among them.**

---

## Problem It Solves

An Owner looking at a workload strain signal and a retention signal for the same person, on two different screens, has to do the connecting themselves — and might not, since nothing tells them these two facts are about the same person at the same time.

A manager seeing an employee's bench time has no way to know, without being told, that the same person also has an active strain signal. That context changes how the bench time reads entirely: **an idle person and an exhausted person on the bench are two different situations requiring opposite responses**, and a manager who cannot tell them apart will get one of them wrong.

---

## Interface Specification

### Screens

| Surface | Location | Purpose |
|---|---|---|
| Insight card | Inline, on the surface it concerns | Where the reader already is |
| Insights | Content | All active, for a role that has any |

### Layout and components

**An Insight appears inline on the surface it concerns**, not only in a list. A BenchTimeContext insight renders as an Inline Alert on the employee's row in [[VRS-F005_The_Bench_Forecast|VRS-F005]]; a ProbationConcernPattern renders within [[VRS-F057_Probation_Review_Intelligence|VRS-F057]]'s context view.

An insight in a list nobody opens is an insight that changed no decision, and the entire justification for this feature is putting two facts next to each other at the moment one of them is being read.

**Every card states its constituent records explicitly.** Not *compounding retention concern*, but the two named signals, each with its own date, each opening its own source. The narrative sentence sits above them and the records below, so a reader can check the claim rather than take it.

Styling is `attention` at most, never `danger`. An insight is a connection between facts, not a failure.

**A dismiss action carries an optional note**, and dismissing does not suppress regeneration — if the underlying combination persists, so does the insight.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Cards render from local state |
| Restricted | An insight above the reader's clearance is structurally absent, not summarized |
| Empty | The section does not render rather than showing zero |
| Error | Not applicable |

### Responsive

Inline cards work unchanged. The list stacks below 1024px.

---

## Technical Architecture

### The Insight schema

Inherited, with no fixed tier, resolved from what it references.

```
insight_id:      UUID v4
workspace_id:    UUID
insight_type:    enum: CompoundingRetentionRisk, BenchTimeContext,
                 PersistentSkillShortfall, ProbationConcernPattern
                 — a deliberately closed set
narrative:       text — a plain factual statement of what was combined and
                 why. Never a predictive or diagnostic claim
effective_tier:  enum: Tier0, Tier1, Tier2 — computed at generation as the
                 single most restrictive tier among every referenced node.
                 Tier 3 can never appear, per the architectural exclusion
status:          enum: Active, Resolved
resolved_at:     timestamp, nullable
resolved_by:     user_id, nullable — null when auto-resolved

— Universal Node Conventions per VPS-A002; created_by is 'system' —
```

`affects` connects each Insight to every node it reasoned over. **An Insight with no `affects` edges is malformed and is never generated.**

### The central rule: effective_tier is the maximum

An Insight referencing a Tier 0 bench alert and a Tier 2 strain signal has `effective_tier` Tier 2 — the more restrictive.

If it also referenced a retention signal, Owner and HR Admin only, `effective_tier` becomes that instead, and **the Insight is now invisible to the same manager who could see two of its three inputs individually.**

This is the same principle [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] applies to edges generally, applied to a node whose entire purpose is combining several at once.

**Never an average, never a minimum, never a default.**

### The absolute exclusion

This feature has no code path, no query and no reasoning rule that reads [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]'s data, [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s individual entries, or any Tier 3 node type.

**Not a promise this feature makes and could break** — the same structural absence [[VRS-F052_Workload_Strain_Signal|VRS-F052]] and [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] each state, extended to the one feature that might otherwise have seemed exempt by virtue of being permitted to combine things others cannot.

### The four Insight types

**CompoundingRetentionRisk.** An active retention signal per [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] and an active strain signal per [[VRS-F052_Workload_Strain_Signal|VRS-F052]] for the same employee. `effective_tier` is always the retention signal's — Owner and HR Admin only. **This can never reach a manager.**

**BenchTimeContext.** An active bench alert per [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] and an active strain signal for the same employee. Both inputs are manager-visible; `effective_tier` is Tier 2, matching both.

This is the most operationally useful of the four, for the reason stated above: a person on the bench who is also showing sustained strain is not idle, they are recovering or overextended, and the response is the opposite of assigning them more work.

**PersistentSkillShortfall.** A SkillGap per [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] and [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s forecast for the same category across at least two consecutive quarters.

Where that forecast figure is the confirmed-demand number, `effective_tier` matches it. **Where it is the pipeline-weighted figure, `effective_tier` matches that instead** — Owner, Finance Admin and HR Admin only — exactly as [[VRS-F051_Team_Capacity_Planner|VRS-F051]] restricts it.

Where [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]]'s trend for the same category shows Worsening, its recurrence rate, average resolution and **resolution mode distribution** are included in the narrative and referenced through `affects`. That feature's data is Tier 0, so this never raises `effective_tier`.

The resolution mode is what makes this Insight actionable rather than descriptive: *shortfall forecast for two consecutive quarters, and the last five gaps in this category were each closed by a contractor rather than a hire* is a hiring argument. The forecast alone is a number.

**ProbationConcernPattern.** At least two of: an overdue onboarding task per [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]], an active timesheet anomaly during the probation window per [[VRS-F010_Timesheet_Speed-Run|VRS-F010]], or a check-in flagged as a concern per [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] — all for the same still-pending probationary employee. Every input is manager-visible; `effective_tier` is Tier 2.

### Evaluation

CompoundingRetentionRisk, BenchTimeContext and ProbationConcernPattern evaluate reactively on a relevant input change. PersistentSkillShortfall, spanning quarters, runs on a periodic sweep, idempotent per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]].

### Resolution

An Insight resolves automatically the moment any referenced input resolves or clears, since its premise no longer holds. It can also be manually dismissed by whoever already has access.

### API contracts

```
intelligenceEngine.evaluateEmployee(employeeId) -> { insightIds: string[] }
intelligenceEngine.evaluateSkillCategory(skillCategory) -> { insightId? }

insight.listForUser(userId) -> Insight[]
  // Filtered by role against each Insight's effective_tier and referenced
  // nodes, through VPS-A004's standard interceptor

insight.listForNode(nodeId) -> Insight[]
  // Insights whose affects edges reach this node, for inline display

insight.dismiss(insightId, note?) -> { success }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Insight carries the schema above. `affects` connects it to every node reasoned over. An Insight with no such edge is never generated |
| G02 | `effective_tier` equals the single most restrictive tier among every referenced node, computed at generation. Never an average, a minimum or a default |
| G03 | This feature has no query or reasoning path reading any Tier 3 node type. Structural, not conventional |
| G04 | An Insight auto-resolves when any referenced input resolves. It is never left Active referencing a cleared signal |
| G05 | This feature reads its sources' existing unmodified data. None required a correction to support it |
| G06 | The Insight type set is closed at four. A fifth requires an amendment to this document with the same scrutiny, not a configuration change |
| G07 | Every Insight is displayed inline on the surface it concerns, in addition to any list |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F055-S01 | Insight schema and tier-inheritance enforcement | Security |
| VRS-F055-S02 | Reactive evaluation | Logic |
| VRS-F055-S03 | PersistentSkillShortfall sweep | Logic |
| VRS-F055-S04 | Inline and list display | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee has both an active retention signal and an active strain signal
**WHEN** evaluation runs
**THEN** a CompoundingRetentionRisk Insight is created with `effective_tier` set to the retention signal's Owner-and-HR-Admin-only class

---

**GIVEN** that Insight exists
**WHEN** the employee's own manager requests their insights
**THEN** it is structurally absent, the same as the retention signal itself already is to them

---

**GIVEN** an employee has an active bench alert and an active strain signal, and no retention signal
**WHEN** evaluation runs
**THEN** a BenchTimeContext Insight is created at Tier 2 and renders inline on that employee's row in [[VRS-F005_The_Bench_Forecast|VRS-F005]]

---

**GIVEN** a PersistentSkillShortfall references [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s pipeline-weighted figure
**WHEN** a manager requests their insights
**THEN** it is absent, matching that feature's own restriction on that figure exactly

---

**GIVEN** the same category has a Worsening trend where four of five past gaps were closed by contractors
**WHEN** the Insight generates
**THEN** the resolution mode distribution appears in the narrative, and `effective_tier` is unchanged by that Tier 0 addition

---

**GIVEN** a referenced signal is cleared
**WHEN** the clearance processes
**THEN** the Insight auto-resolves, since its premise no longer holds

---

**GIVEN** a reader opens an Insight card
**WHEN** it renders
**THEN** each constituent record is named with its date and opens its own source, so the claim can be checked rather than taken

---

**GIVEN** a code review checks whether this feature's reasoning ever queries a Tier 3 node type
**WHEN** the check runs
**THEN** no such path exists anywhere

---

## Non-Functional Requirements

- Reactive evaluation completes within 30 seconds of a relevant input change
- The skill shortfall sweep covers all categories within 2 minutes
- Inline Insight lookup for a node resolves within 100ms, since it renders alongside a surface with its own budget
- Reviewing and dismissing function offline

---

## Security Considerations

- **Every Insight type is a security decision, not a feature idea.** Each was checked against its inputs' actual tiers before inclusion, and the deliberately closed set exists specifically so every Insight this feature can produce has already been reasoned about here rather than decided ad hoc by whoever implements the next one.
- **The most important guarantee is G03, not G02.** Tier inheritance protects against under-restricting an Insight that combines things correctly. The Tier 3 exclusion protects against this feature being the quiet exception that undoes three other features' careful, repeated refusals to go near wellness data. Standing Rule 7 granted reasoning breadth; it was never a privacy exemption.
- **No Insight is a black-box score.** Narrative and `affects` together mean every Insight is fully explainable — exactly which records, exactly why — to anyone who can see it. This feature never produces a number or a label with no inspectable basis.
- **Inline display widens nothing.** An Insight rendered on a surface still passes through the same interceptor. A reader who cannot see the Insight sees the surface without it, not a placeholder indicating something was withheld.

---

## Out of Scope

- **Any Insight type beyond the four defined here** — a fifth requires an amendment with the same scrutiny, not a setting
- **Any reasoning touching [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] or [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s individual entries** — an absolute, permanent exclusion
- **Machine learning, prediction or scoring** — every Insight is a rules-based combination of existing explainable facts
- **Recommending an action.** An Insight states a connection. What to do about it is a human decision, and a recommendation would turn an explainable combination into an unexplainable instruction

---

## Decisions Recorded

**Standing Rule 7's citation error is corrected by the renumbering.** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] previously cited the wrong feature number in the rule, contradicting its own registry row for Insight. Both now cite this document.

**Insights render inline on the surface they concern**, not only in a list. An insight in a list nobody opens changed no decision, and the entire justification for this feature is putting two facts next to each other at the moment one is being read.

**Every card names its constituent records with dates and links.** A narrative sentence alone asks the reader to trust a combination they cannot check.

**PersistentSkillShortfall now includes [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]]'s resolution mode distribution.** That feature's addition is what converts this Insight from a forecast restatement into a hiring argument: *five past gaps, each closed by a contractor* is the sentence that justifies a headcount request.

**The four types remain closed.** ProbationConcernPattern was added with the same scrutiny as the original three rather than treated as a lesser addition for arriving later, and a fifth requires the same.

---

## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — Standing Rule 7, and Insight's registry entry
- [[VRS-F052_Workload_Strain_Signal|VRS-F052]] and [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] — the two signals CompoundingRetentionRisk combines
- [[VRS-F054_Skill_Gap_Trend_Analysis|VRS-F054]] — the trend strengthening PersistentSkillShortfall
- [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] — the boundary this feature never crosses

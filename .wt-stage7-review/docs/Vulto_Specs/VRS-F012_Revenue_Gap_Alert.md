---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Intelligence
aliases:
  - VRS-F012
---

# VRS-F012 — Revenue Gap Alert

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F005_The_Bench_Forecast|VRS-F005]] (**the bench computation this feature consumes** — it does not implement its own), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days), [[VRS-F006_Rate_Card_Engine|VRS-F006]] (`effective_billing_rate`, the preferred cost source), [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]] (the Pitch classification the bench computation already applies), [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the Web Worker the engine runs inside), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (RevenueGapAlert and the `triggered_by` edge), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the job scheduler running the sweep)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

An automated bench-monitoring engine that watches every active employee and writes a RevenueGapAlert the moment a configured threshold is crossed, surfaced on the Bench Forecast row and in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox. The alert carries a daily cost and the accumulated cost of the bench period, making the financial consequence of inaction explicit rather than something a founder calculates themselves.

**The relationship to [[VRS-F005_The_Bench_Forecast|VRS-F005]] is the important structural fact about this feature.** That feature owns the bench computation — which days are uncovered, and what they cost. This feature owns the judgment layered on top: whether an uncovered period has gone on long enough to warrant escalation, and whose attention it needs.

The distinction is the difference between a statement of fact and an opinion about it. The Bench Forecast states the fact continuously. This feature raises its voice when the fact stops being tolerable.

---

## Problem It Solves

Bench time that accumulates silently is the single most common avoidable cost in a professional services agency. A senior developer at a £400 daily rate sitting unassigned for ten working days is £4,000 of salary against zero revenue.

This is almost always a visibility failure rather than a planning one — the founder did not see it happening, or saw it too late to act before payroll processed. The Bench Forecast removes the failure for anyone who opens it with the right intent. **This feature removes the dependency on intent.** The alert comes to them.

---

## User-Facing Flows

### An alert appearing

When bench duration crosses the first threshold — five working days by default — a RevenueGapAlert is written. The employee's Bench Forecast row gains an alert badge alongside the amber region that was already there, and a card appears in the Inbox showing name, daily cost and accumulated cost.

The amber region itself is not created by this alert; it has been visible since the bench period began. What the alert adds is the badge, the escalation and the demand for attention.

### Escalation

At twice the threshold the alert escalates to Medium, at three times to High. **No new alert is ever created for the same bench period** — the existing node's severity and escalation timestamp update in place, so the Inbox never shows duplicate cards for one person.

### Dismissing

A manager can dismiss the current card, which removes it and records the timestamp, while the underlying alert remains Active. If the person is still on bench at the next threshold, a new notification fires regardless of the earlier dismissal.

**Dismiss silences the current cycle. Only an assignment resolves the alert.** This is deliberate: the alternative — a dismiss that permanently silences — turns the most expensive recurring cost in the business into something that can be clicked away.

### Resolution

The moment an Assignment is created with a start date at or before today, the alert resolves automatically: status Resolved, the triggering assignment recorded, the badge removed, the card gone.

---

## Interface Specification

### Screens

| Surface | Location | Purpose |
|---|---|---|
| Alert badge | On the Bench Forecast row, per [[VRS-F005_The_Bench_Forecast|VRS-F005]] | Presence and severity at a glance |
| Alert card | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox | The actionable item |
| Bench alerts list | Content | All active alerts, sorted by cost |

### Layout and components

**The alert badge** sits in the Bench Forecast's left column beside the employee name: a Badge in `attention` reading the bench day count. Severity is expressed by weight rather than by a third color — Low is `subtle`, Medium and High are `solid`. Introducing red for High would break [[VPS-D001_Design_Foundations|VPS-D001]]'s reservation of `danger` for failure, and a long bench is expensive rather than broken.

**The alert card** in the Inbox is actionable in place per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]: employee name and role, days on bench, daily cost and accumulated cost in `numeric`, and two actions — **Find work** which opens [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matcher pre-filtered to this person, and **Dismiss**.

The accumulated cost is the largest element on the card, in `numeric-lg`. It is the only number on it that changes the reader's behavior.

**The bench alerts list** is a Table sorted by accumulated cost descending, not by date. A founder with six alerts should look at the expensive one first, and sorting by recency buries it beneath three junior developers who went on bench yesterday.

### Keyboard

Standard Inbox bindings from [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]. `A` from a focused card opens the matcher; `D` dismisses.

### System states

| State | Treatment |
|---|---|
| Syncing | Cards render from local state; alerts are computed locally and do not wait on sync |
| Restricted | Cost figures follow [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s rule — a viewer without compensation access sees days on bench without the currency figure |
| Empty | *Nobody is on the bench beyond five days.* Stated plainly as the good news it is |
| Error | Not applicable — an unresolvable cost source yields zero and surfaces normally |

### Responsive

The alerts list drops `role`, then `daily cost`, below 1280px. Accumulated cost is never dropped.

---

## Technical Architecture

### The RevenueGapAlert schema

RevenueGapAlert is Standard, Tier 0 — the same visibility as the Bench Forecast it appears on.

```
alert_id:                  UUID v4
workspace_id:              UUID
employee_id:               UUID
bench_start_date:          date — from VRS-F005's bench computation
bench_days:                integer — working days elapsed, from VRS-F004.
                           Recomputed on every evaluation, never stored between
daily_cost:                decimal — resolved per the order below. 0 if no
                           source is available, never an error
accumulated_cost:          decimal — daily_cost × bench_days at last update
severity:                  enum: Low, Medium, High
lifecycle_status:          enum: Active, Resolved
escalated_at:              timestamp, nullable
dismissed_at:              timestamp, nullable
resolved_at:               timestamp, nullable
resolved_by:               user_id or 'system', nullable
resolved_by_assignment_id: UUID, nullable

— Universal Node Conventions per VPS-A002 —
```

### The monitoring engine

Two triggers. **Reactively**, any Assignment change for an employee causes immediate re-evaluation. **Periodically**, a four-hourly sweep across active employees catches cases where calendar time has passed with no event to react to, scheduled per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] and idempotent per that document's requirement — a repeated sweep must not produce a second alert.

Both run inside the Web Worker boundary [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] establishes. This engine is a consumer of the materialized index, not a second thread with its own connection.

**The engine does not determine bench status itself.** It calls [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation, which already accounts for Assignment coverage, working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and the Pitch exclusion per [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]. The engine's own logic is exactly three questions: how many bench working days has this computation returned, does that exceed a threshold, and has severity changed since the last evaluation.

That inversion is the substantive change from the previous specification, in which this feature implemented its own bench query and the Bench Forecast deferred its visual state to the resulting alert. Two features each held half of one computation, and the half that determined what a user *saw* lived in the feature that determined what a user was *told*.

### Cost source

`bench_start_date` is the `end_date` of the most recently ended Assignment, where one exists. The same Assignment supplies the rate — no second traversal:

1. Its `effective_billing_rate` per [[VRS-F006_Rate_Card_Engine|VRS-F006]], converted at 8 hours per day
2. Else `Employee.billing_rate_default`, already a daily figure
3. Else zero, written and surfaced normally rather than treated as an error

Using the most recent assignment's rate is a genuine improvement over a flat default: it reflects what this person was actually billed at, client-specific and rate-card-informed, rather than a figure that may never have applied to their real work. It degrades to exactly the previous behavior for anyone without assignment history.

### Uniqueness

Only one Active alert may exist per employee. Before writing, the engine checks for an existing Active one and updates it. The `triggered_by` edge connects RevenueGapAlert to Employee, extending the existing edge rather than introducing a new type.

### Ghost Resources are out of scope

Per [[VRS-F007_Ghost_Resources|VRS-F007]], a Ghost represents planned capacity, not salary cost. This engine evaluates only employees with `employee_type = Employee`.

### API contracts

```
revenueGapAlert.evaluate(employeeId) -> { alertId? }
  // Internal. Reactive on Assignment change and by the four-hourly sweep.
  // Exposed as a callable procedure for testability
  // Calls benchForecast.computeBench(employeeId) — never its own bench query

revenueGapAlert.dismiss(alertId)        -> { success }
revenueGapAlert.listActive(workspaceId) -> RevenueGapAlert[]
  // Sorted by accumulated_cost descending. Resolves entirely from the local graph
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | RevenueGapAlert carries the schema above |
| G02 | Bench status is determined by calling [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation. This feature MUST NOT implement its own query for Assignment coverage or Pitch exclusion |
| G03 | `bench_days` counts working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], recomputed on every evaluation |
| G04 | `daily_cost` resolves from the most recently ended Assignment's `effective_billing_rate` at 8 hours per day, falling back to `billing_rate_default`, then to zero |
| G05 | Only one Active alert may exist per employee. Escalation updates the existing node; it never creates a second |
| G06 | `triggered_by` connects RevenueGapAlert to Employee, extending the existing edge definition |
| G07 | Dismissal sets `dismissed_at` and leaves `lifecycle_status` unchanged. Only a new Assignment resolves an alert |
| G08 | The sweep is idempotent per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. A repeated run against the same state produces no additional alert and no duplicate notification |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F012-S01 | Alert schema and monitoring engine | Data |
| VRS-F012-S02 | Bench Forecast alert badge | UI |
| VRS-F012-S03 | Inbox card and bench alerts list | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee's last assignment ended five working days ago with no new assignment and no pitch time
**WHEN** the engine evaluates
**THEN** an alert is written at Low severity with `bench_days` of 5, the row gains an alert badge, and a card appears in the Inbox

---

**GIVEN** the same employee's most recent assignment had an `effective_billing_rate` of 15 per hour
**WHEN** the alert is written
**THEN** `daily_cost` is 120, not their `billing_rate_default`, even where one is set

---

**GIVEN** an employee has logged pitch hours every day this week and holds no assignment
**WHEN** the engine evaluates
**THEN** [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation returns zero bench days, no alert is written, and the engine performs no Pitch check of its own

---

**GIVEN** a UAE entity whose weekend is Friday and Saturday
**WHEN** `bench_days` is counted across a fortnight
**THEN** four non-working days are excluded per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]

---

**GIVEN** an Active alert at Low severity with 5 bench days
**WHEN** it reaches 10
**THEN** the existing alert updates to Medium with `escalated_at` set, no second node is created, and the card reflects the change

---

**GIVEN** an Active alert
**WHEN** an Assignment is created starting at or before today
**THEN** the alert resolves within 60 seconds, `resolved_at` and `resolved_by_assignment_id` are recorded, the badge clears and the card is removed

---

**GIVEN** a manager dismisses a card
**WHEN** dismissal is confirmed
**THEN** `dismissed_at` is set, the card is removed, status remains Active, and a new notification fires at the next threshold if the person is still on bench

---

**GIVEN** the four-hourly sweep runs twice against unchanged state
**WHEN** the second run completes
**THEN** no additional alert exists and no duplicate notification was sent

---

**GIVEN** an employee with no assignment history and no default rate
**WHEN** an alert is written
**THEN** `daily_cost` and `accumulated_cost` are both zero, the alert surfaces normally, and no error occurs

---

## Non-Functional Requirements

- Evaluation fires within 30 seconds of any Assignment change for the affected employee
- The sweep covers all active employees within 2 minutes for workspaces up to 150 people, entirely from the local graph
- Alerts written offline sync within 1 second of reconnection
- The badge renders or clears within 1 second of the alert being written or resolved
- Inbox cards appear within 1 second

---

## Security Considerations

- **No elevated privacy concern.** RevenueGapAlert is Tier 0, the same visibility as the Bench Forecast it appears on.
- **Cost figures derive from billing rates, not compensation.** `effective_billing_rate` and `billing_rate_default` are both Tier 0. This feature never reads a salary.
- **Cost visibility follows [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s rule.** A viewer without compensation access sees days on bench and not the currency figure, so the two surfaces cannot disagree about what a person may see.
- **An alert is about a person and is visible workspace-wide.** That is a deliberate consequence of Tier 0, and it is correct — bench time is an operational fact, not a private one — but it means the copy must stay neutral. The card names a cost and a person; it never characterizes the person.

---

## Out of Scope

- The bench computation itself — [[VRS-F005_The_Bench_Forecast|VRS-F005]]
- Assignment suggestions. **Find work** opens [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matcher; the recommendation engine is not this feature's job
- External-channel alerting — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]
- Per-employee configurable thresholds — workspace-wide at MVP; individual overrides are a Scale-phase concern
- Alerting for Ghost Resources — placeholders are not salary cost
- Historical bench cost reporting across periods — [[VRS-F058_People_Analytics_Dashboard|VRS-F058]]

---

## Decisions Recorded

**This feature now consumes [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation rather than supplying it.** Previously it implemented its own bench query including the Pitch exclusion, and the Bench Forecast deferred its amber state to the resulting alert. That split one computation across two features and made the product's signature visual dependent on an alerting engine seven features downstream. The computation now lives with the view that renders it, and this feature owns only the judgment about escalation.

**`bench_days` resolves through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].** The previous specification excluded Saturday, Sunday and a workspace holiday list — wrong for the Gulf, wrong for a six-day week, and wrong in exactly the figure this alert exists to make credible.

**The alerts list sorts by accumulated cost, not date.** A founder with six alerts should see the expensive one first.

**Severity uses weight rather than a third color.** Escalating to `danger` would break [[VPS-D001_Design_Foundations|VPS-D001]]'s reservation of red for failure. A long bench is expensive, not broken.

**Sweep idempotency is stated explicitly**, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. A scheduled evaluation that double-alerts on a repeated run is the most common failure mode of this pattern, and the previous specification did not require otherwise.

---

## Related Notes

- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the bench computation this feature consumes
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days `bench_days` counts
- [[VRS-F006_Rate_Card_Engine|VRS-F006]] — the rate resolution supplying daily cost
- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the matcher the Find work action opens
- [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] — the Inbox these cards appear in

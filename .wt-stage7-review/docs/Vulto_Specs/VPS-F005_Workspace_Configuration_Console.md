---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Platform
aliases:
  - VPS-F005
---

# VPS-F005 — Workspace Configuration Console

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] (Workspace and the role model), [[VPS-F004_Silent_Audit_Log|VPS-F004]] (every change is audited), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (the Workspace Configuration Registry this feature owns the surface for), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission, and the k-anonymity thresholds configured here)
**Blocks:** Nothing structurally, though roughly twenty features write a setting that has no home without it.

This document is the single source of truth for this feature.

---

## What It Is

The single surface where a workspace is configured: every scalar setting on the Workspace node, the navigation into every feature-owned configuration surface, and each user's own preferences.

**It owns the settings registry. It does not own the things the settings point at.** Leave policies belong to [[VRS-F018_Leave_Policy_Engine|VRS-F018]], calendars to [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], rate cards to [[VRS-F006_Rate_Card_Engine|VRS-F006]], entities to [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]], onboarding templates to [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]]. This feature is where a person goes to find them, and where the twenty-odd scalar values that belong to no feature in particular actually live.

---

## Problem It Solves

The Workspace node accumulated twenty-two configuration keys — overtime thresholds, capacity warnings, signature expiry, k-anonymity minimums, currency, expense guidelines, wellness resources, retention window — each added by whichever feature first needed one.

**No document owned the surface where an Owner edits any of them.** Without this, they are either hardcoded, or exposed through twenty-two different screens, or, most likely, half of each.

There is a second problem this feature exists to solve, and it is the more interesting one. **Several of these settings have consequences a person changing them will not anticipate.** Raising `k_anonymity_minimum` from 5 to 8 silently removes aggregates that were visible yesterday. Raising `bench_alert_threshold_days` from 5 to 15 turns off alerting on the most expensive problem in the business. Changing `billability_target` re-colors every pulse bar in the product. A settings screen that presents these as a flat list of numbers is a settings screen that will be changed carelessly.

---

## User-Facing Flows

### Finding a setting

Settings are grouped by the question a person is trying to answer, not by which feature happens to own the value: **Workspace**, **People and time**, **Alerts and thresholds**, **Privacy and data**, **Money**, and **Configuration** — the last being navigation into the feature-owned surfaces.

Every setting is also reachable through [[VPS-F002_Local-First_Search|VPS-F002]]'s command palette by name, because a person who knows they want to change the bench alert threshold should not have to guess which group it is in.

### Changing a setting with consequences

Certain settings carry a **blast radius**: a plain statement of what changes, computed against the workspace's actual current data, shown before the change is saved.

*Raising the minimum cohort size from 5 to 8 will hide utilization figures for 4 teams that currently show them.* *Raising the bench alert threshold from 5 to 15 days will resolve 3 active alerts and stop 2 more from firing this week.*

Not a warning dialog and not a confirmation checkbox. A sentence, computed from real data, above the save button.

### Reviewing what changed

Every setting change is audited per [[VPS-F004_Silent_Audit_Log|VPS-F004]] and surfaced in a change history on the console itself: setting, old value, new value, who and when. Someone who quietly raised the bench threshold to silence a problem should be visible.

### My preferences

Each user's own settings — density, theme, notification muting per [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] — live in the same console under their own area, clearly separated from workspace settings by heading and position, since a user with no admin role sees only this part.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Settings | Content, with a settings-local sidebar | The console |
| My preferences | Within Settings | Per-user, visible to everyone |

### Layout and components

Settings uses a **secondary sidebar inside the content region**, 200px, listing the six groups. The application sidebar remains visible; this is a nested navigation rather than a mode the user has entered and must escape.

Each group is a stack of Sections, one per related cluster. A setting row is: label at `body-medium`, a single line of plain-language description at `small` in `text-secondary`, and the control right-aligned.

**The description is mandatory on every setting, and it states what the number does rather than restating the label.** `bench_alert_threshold_days` reads *How many working days someone can be unassigned before an alert fires*, not *Bench alert threshold in days*. A settings screen whose descriptions restate their labels has no descriptions.

**Numeric settings show their default beneath the control** as `micro` text — *Default: 5* — with a **Reset** ghost action appearing only when the current value differs. A person who has changed six thresholds over a year should be able to see at a glance which ones they changed.

**Blast radius** renders as an Inline Alert in `attention` between the control and the save action, appearing the moment a value changes and recomputing as it is adjusted. Settings with no meaningful blast radius show nothing rather than a reassuring message.

**Save is per Section, not per setting and not per page.** Per-setting saves make a coherent adjustment of three related thresholds into three separate audited events; a single page-level save makes it unclear what is pending.

**Change history** is a Table at the foot of each group: setting, from, to, who, when. Values render in `numeric`.

### Keyboard

`Cmd+K` reaches any setting by name. Within the console, `Tab` ordering follows visual order; `Cmd+Enter` saves the focused Section.

### System states

| State | Treatment |
|---|---|
| Syncing | Controls render from local state and remain editable; a settings write is optimistic like any other |
| Restricted | A non-admin sees only My preferences. The six workspace groups do not render, and the settings sidebar shows one entry |
| Owner-only | Billing, subscription and deletion controls render only for Owner, absent for HR Admin, per their Tier 2 class |
| Empty | Not applicable — every setting has a default |
| Error | An out-of-range value is refused inline, naming the permitted range and why it exists |

### Responsive

The settings sidebar collapses to a Select above the content below 1280px.

---

## Technical Architecture

### The settings registry

This feature owns the surface, not the schema. Every key is registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Workspace Configuration Registry, which remains the single source of truth for names, types and defaults.

Settings are grouped for presentation as follows. **The table is a registry**: each application registers its own keys into the appropriate group, and a new group is added only where an application's settings genuinely fit none of the existing ones.

| Group | Contains |
|---|---|
| **Workspace** | name, logo, timezone, default density, vocabulary_profile |
| **People and time** | billability_target, overtime_flag_threshold, near_capacity_warning_threshold |
| **Alerts and thresholds** | bench_alert_threshold_days, transition_warning_days, certification_expiry_warning_days, signature_link_expiry_days, burnout_no_leave_threshold_days, flight_risk_stagnation_months, capacity_planner_horizon_quarters |
| **Privacy and data** | k_anonymity_minimum, k_anonymity_minimum_sensitive, tier1_retention_window_months, max_file_size_mb, wellness_resource_text, wellness_resource_contact |
| **Money** | primary_currency, category_guideline_amounts, receipt_required_above_amount, payroll_variance_flag_threshold |
| **Configuration** | Navigation into [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]], [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], [[VRS-F006_Rate_Card_Engine|VRS-F006]], [[VRS-F018_Leave_Policy_Engine|VRS-F018]], [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]], [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]'s own audit history |
| **Billing** | Subscription, plan, deletion controls. **Owner only** |

**A new setting is added to [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s registry and to a group here, in the same change.** A setting registered without a group is a setting nobody can edit, which is indistinguishable from a hardcoded constant.

**One console, every application.** A workspace configures itself once. Splitting configuration per application would mean an Owner hunting across four settings screens for a threshold they can only half-remember the name of — and [[VPS-F002_Local-First_Search|VPS-F002]]'s palette already makes every setting reachable by name regardless of its group.

### Blast radius computation

Implemented per setting, not generically, because a meaningful statement requires knowing what the number does. Settings carrying one:

| Setting | Statement |
|---|---|
| `k_anonymity_minimum` | Count of currently-visible aggregates that would be suppressed |
| `k_anonymity_minimum_sensitive` | As above, for Tier 3-derived aggregates |
| `bench_alert_threshold_days` | Count of active alerts resolved, and pending alerts prevented |
| `near_capacity_warning_threshold` | Count of employees currently between the new and old value |
| `billability_target` | Count of employees moving above or below target |
| `overtime_flag_threshold` | Count of flags in the last 90 days that would not have fired |
| `tier1_retention_window_months` | Volume of Tier 1 history that will stop being held locally |
| `payroll_variance_flag_threshold` | Count of payslips in the last run that would newly flag, or stop flagging |
| `vocabulary_profile` | The terms that change across the product, listed explicitly |

Each is a local query against the materialized index, computed within 200ms. **Where a computation cannot complete quickly, no statement is shown** — a delayed or approximate blast radius is worse than none, because it invites the user to wait for a number they will then not trust.

### Restricted settings

`wellness_resource_text` and `wellness_resource_contact` are workspace configuration and therefore editable here, but they are the only settings in the console that touch [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] in any way. **Editing them grants no visibility into wellness data**, and the interface says so plainly at that Section, because a configuration screen adjacent to a Tier 3 feature is exactly where someone might reasonably wonder.

### API contracts

```
workspaceSettings.get(workspaceId)            -> Record<string, unknown>
  // Filtered to the caller's readable settings. Owner-only keys are
  // structurally absent for HR Admin

workspaceSettings.update(workspaceId, changes) -> { success, applied }
  // Section-scoped. Validates ranges, writes one audit entry per changed key

workspaceSettings.blastRadius(workspaceId, key, proposedValue)
  -> { statement } | null
  // Local, read-only, within 200ms. Returns null where no statement applies

workspaceSettings.resetToDefault(workspaceId, key) -> { success }
workspaceSettings.changeHistory(workspaceId, group?) -> AuditEntry[]
  // Reads VPS-F004, filtered to settings changes

userPreferences.get(userId)                    -> UserPreferences
userPreferences.update(userId, changes)        -> { success }
  // Density, muted notification types. Theme is per-device and never syncs
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature owns no node type. It writes to Workspace and WorkspaceMembership |
| G02 | Every setting key is registered in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Workspace Configuration Registry, which remains the source of truth for name, type and default |
| G03 | Every setting change writes an [[VPS-F004_Silent_Audit_Log|VPS-F004]] audit entry recording key, previous value, new value, actor and timestamp |
| G04 | Owner-only settings are structurally absent from `workspaceSettings.get` for any other role, never returned and disabled |
| G05 | Blast radius is a read-only local computation. It never writes and never blocks a save |
| G06 | User preferences are stored on WorkspaceMembership. Theme is per-device and is never synced |
| G07 | Setting values are Tier 0 except billing, subscription and deletion controls, which are Tier 2 and Owner-only |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F005-S01 | Settings registry surface and grouping | UI |
| VPS-F005-S02 | Validation and range enforcement | Logic |
| VPS-F005-S03 | Blast radius computation | Logic |
| VPS-F005-S04 | Change history | UI |
| VPS-F005-S05 | User preferences | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an Owner raises `k_anonymity_minimum` from 5 to 8
**WHEN** the value changes
**THEN** a statement appears naming how many currently-visible aggregates would be suppressed, computed from actual workspace data, within 200ms

---

**GIVEN** an Owner raises `bench_alert_threshold_days` from 5 to 15
**WHEN** the change is saved
**THEN** the statement named the active alerts affected, the change is applied, and an audit entry records the previous and new value with the actor

---

**GIVEN** an HR Admin opens Settings
**WHEN** the console renders
**THEN** the Billing group is structurally absent, not disabled, and `workspaceSettings.get` did not return its keys

---

**GIVEN** a Team Member opens Settings
**WHEN** the console renders
**THEN** only My preferences appears, and no workspace group is shown or indicated

---

**GIVEN** a setting has been changed from its default
**WHEN** the row renders
**THEN** the default is stated beneath the control and a Reset action is available

---

**GIVEN** a value outside the permitted range is entered
**WHEN** save is attempted
**THEN** it is refused inline with the permitted range named and the reason stated

---

**GIVEN** a person searches the command palette for a setting by name
**WHEN** results return
**THEN** the setting appears and selecting it opens the console scrolled to that row

---

**GIVEN** a blast radius computation exceeds 200ms
**WHEN** the value changes
**THEN** no statement is shown, and the save proceeds normally

---

## Non-Functional Requirements

- The console renders within 200ms from the local graph
- Blast radius computes within 200ms or is omitted
- Settings changes apply immediately across the product, with no session restart, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]
- Full functionality offline. Settings are Tier 0 and write optimistically like any other record

---

## Security Considerations

- **Every setting change is audited.** Several of these values govern how much the product tells people about problems — bench thresholds, overtime flags, k-anonymity minimums — and a change made to make a metric look better should leave a record.
- **The k-anonymity thresholds are the most consequential settings in the console.** Lowering them widens disclosure across every aggregate in the product simultaneously. They carry a blast radius statement, an audit entry, and a hard floor: the minimum permitted value is 3, below which the mechanism is not meaningfully protecting anyone.
- **Owner-only settings are structurally absent for HR Admin**, not disabled. A disabled billing section tells an HR Admin what the workspace pays and merely stops them changing it.
- **Editing the wellness resource text grants no wellness visibility**, and the interface states it at that Section. Tier 3's guarantee is absolute, and a configuration surface adjacent to it is the most plausible place for someone to assume otherwise.

---

## Out of Scope

- **The feature-owned configuration surfaces themselves** — entities, calendars, rate cards, leave policies, onboarding templates. This feature navigates to them
- **Role assignment and member management** — [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]
- **Per-employee overrides of workspace settings.** Where an override exists, such as `billability_target_override`, it lives on the employee record in [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], not here
- **Import and setup** — [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]
- **Custom fields** — [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]]
- **Settings versioning or scheduled changes.** A setting change applies immediately; there is no path to schedule one for a future date

---

## Decisions Recorded

**This feature is new.** Twenty-two settings had accumulated on the Workspace node with no owning surface, each added ad hoc by whichever feature first required it.

**Blast radius is the reason this feature is more than a form.** A settings screen presenting `k_anonymity_minimum` and `bench_alert_threshold_days` as bare numbers will have both changed carelessly, and the second consequence — alerting quietly disabled on the most expensive problem in the business — is invisible until a quarter later.

**Statements are computed per setting rather than generically**, because a generic mechanism can only say *this affects other parts of the product*, which is true, useless, and would train people to ignore it.

**Grouping is by the question being asked, not by owning feature.** A person changing the overtime threshold does not know or care that [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] owns it.

**A hard floor of 3 is placed on the k-anonymity minimums.** Making them configurable without a floor makes the entire disclosure-control mechanism optional, which is not a setting a workspace should have.

**Three keys were added in the final consistency pass** — `vocabulary_profile`, `payroll_variance_flag_threshold` and `tier1_retention_window_months` — each introduced by a feature written after this console and each described in prose without being registered. Per G02, a key with no group here is a key nobody can edit, which is indistinguishable from a hardcoded constant.

`vocabulary_profile` carries a blast radius because changing it renames concepts across every screen in the product, and a person should see which terms change before they change them.

**Descriptions are mandatory and must explain rather than restate.** This is stated as a requirement because it is the difference between a settings screen people use correctly and one they guess at.

---

## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the Workspace Configuration Registry this feature surfaces
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the k-anonymity mechanism whose thresholds live here
- [[VPS-F004_Silent_Audit_Log|VPS-F004]] — where every change is recorded
- [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] — setup, which writes the initial values

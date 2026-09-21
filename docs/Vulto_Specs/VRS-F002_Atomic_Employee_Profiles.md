---
Type:
  - Vulto Roster Specs
Date: "[[2026-08-10]]"
Product Phase:
  - MVP
Feature Type:
  - Core
aliases:
  - VRS-F002
---

# VRS-F002 — Atomic Employee Profiles

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] (User, Workspace, WorkspaceMembership must exist), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Employee's lifecycle, tier split and the Conversion Event Protocol), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (tier-based sync and encryption), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission enforcement), [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] (the Referenced In panel), [[VPS-D002_Component_Library|VPS-D002]] (components)
**Blocks:** [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]], [[VRS-F005_The_Bench_Forecast|VRS-F005]] and effectively every feature after it. There are no Employee nodes to reference, assign or forecast against without this.

This document is the single source of truth for this feature and owns Employee's complete field-level schema.

---

## What It Is

The Atomic Employee Profile is the canonical record for every person at the agency. It establishes Employee's full property schema and the edges that make it traversable — `has_skill`, `holds_certification`, `managed_by` — and it is the entity every other feature reads from and writes edges against.

It is called Atomic because it is the minimal complete unit: nothing built after it can exist without it, and no feature defines a competing model of a person.

[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] is the registry entry. This document is where that entry becomes a complete schema.

---

## Problem It Solves

Without this, [[VRS-F005_The_Bench_Forecast|VRS-F005]] has no rows to render, [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] has no skill edges to traverse, [[VRS-F006_Rate_Card_Engine|VRS-F006]] has no one to price, and every feature downstream depends on an entity that does not exist.

The specific moment this feature exists for: an HR Admin or founder sits down on day one and enters the agency's people, before anything else in the product can be useful. For firms with existing records, [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] performs that entry in bulk instead.

---

## User-Facing Flows

### Creating a profile

An HR Admin or Owner creates an Employee from the People directory. Required: full name, email, job title, employment type, start date, entity. Optional and addable later: seniority, department, phone, timezone, location, billing rate, working pattern, notes.

On save a named server mutation creates the node, and its Tier 0 fields reach the device cache of every person who may read them through the ordinary shape sync, within a second. **The node exists whether or not the person has ever logged in** — employment and system access are two separate facts, and a product that conflates them cannot represent a person hired next month.

### Linking to a user account

When an invitation is sent per [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]], it carries the `employee_id`. On acceptance the User node is linked via `user_id`. The employee gains an authenticated identity attached to their existing employment record, never the reverse.

### Viewing and editing

The profile is a single page: identity, employment, reporting line, skills, certifications, and a Referenced In panel per [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]]. Fields are editable inline by a user with sufficient permission. Status transitions are available from an actions menu, never by editing a status field directly — offboarding a colleague should not be reachable by mis-clicking a dropdown.

### Offboarding

Setting an end date and confirming offboarding is one deliberate action. It sets status Inactive, records the end date, and flags rather than silently closes every loose end: active Assignments for manual resolution, allocated Assets for return, any active Departure record marked Completed, and the linked person's access ended through [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]'s revocation mechanism: their membership is revoked, their devices are revoked for the workspace, and their sync audience is recomputed, so the next connection removes every row they held. Nothing is wiped by the profile itself; Tier 1 never reached a device, so there is nothing of it to wipe.

**Nothing is auto-closed.** An unresolved assignment and an outstanding laptop are the same shape of problem, and both deserve a person's attention rather than a silent state change.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| People directory | Content + Panel | The list, and the fastest path to any person |
| Employee profile | Content | The full record |
| Create employee | Modal | Required fields only |

### Layout and components

**People directory** is a Table per [[VPS-D002_Component_Library|VPS-D002]]: avatar, name, job title, department, employment type Badge, status Badge, entity. Row selection opens the Panel with a profile summary; `Enter` opens the full profile. Filters sit above the table as a Toggle Group for status and Selects for department and entity. Primary action is **Add person**.

The directory must render 150 employees within 200ms from the device cache, which holds the Tier 0 half of every profile the reader may see and therefore needs no network, and which requires virtualization above 100 rows per [[VPS-D002_Component_Library|VPS-D002]].

**Employee profile** uses Tabs — Overview, Skills, Documents, Activity — with identity fixed above them: avatar at 48px, name at `h1`, job title and department at `small` in `text-secondary`, status Badge, and the actions menu right-aligned. The avatar height matches the combined identity block so the two read as one unit.

Overview is a two-column Section layout. Employment fields left, reporting line and working pattern right. **Fields render as contained read surfaces, not as permanent Inputs.** The read surface and editing control reserve identical padding and border geometry, so entering edit mode changes paint without reflow. `E` on the focused field, or a click, opens it for editing; blur or `Cmd+Enter` commits; `Escape` discards. There is no explicit save button at any point in this cycle — an operational record edited dozens of times a day should not require a save action, and [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s optimistic write model makes a committed change appear instantly.

Compensation fields render as a distinct Section with a lock affordance, visible only to authorized roles. For everyone else the Section is **structurally absent**, not disabled — per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s sensitive-restricted treatment, since the existence of a compensation figure is unremarkable but its value is not.

`J` and `K` move between profiles without returning to the directory, per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]], which is what makes reviewing a team of thirty a scan rather than a navigation exercise.

**The profile is Content-only, and deliberately has no Panel.** A Panel is the contextual detail of a record selected in a collection; the profile is already that detail surface, so a Panel over it would be the detail of a detail. The Skills, Documents and Activity tabs do contain collections, but opening a Panel from one would put a third level of nesting inside a screen a person reaches by selecting from the directory Panel already. Where a document needs previewing, [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] owns that surface and it is a Modal. This is recorded because an earlier revision listed the profile as *Content + Panel* without ever saying what the Panel would show, and the prototype confirmed nothing was missing without one.

**Create employee** is a Modal rather than a Panel, deliberately: it is a short flow that should not be abandoned halfway, and a half-created person is worse than none.

### Keyboard

| Key | Action |
|---|---|
| `J` / `K` | Previous / next profile, from within a profile |
| `E` | Edit the focused field |
| `Cmd+Enter` | Commit an open edit |
| `Escape` | Discard an open edit |

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows in the directory; skeleton Sections in the profile |
| Restricted, sensitive | Compensation Section absent entirely for unauthorized roles |
| Restricted, visible | Not used on this surface |
| Requires connection | Compensation values, current or superseded, render dashed with **Retry** whenever their `protected.read` is pending or has failed for lack of a connection, per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] |
| Empty | *No one here yet.* with **Add person**, or **Import your team** where [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] is available |
| Error | Duplicate email states the conflict and links to the existing person |

### Responsive

Directory drops `entity`, then `department`, then `employment type` below 1280px. Profile columns stack below 1280px with reporting line first, since it is the field most often checked on a narrow screen.

---

## Technical Architecture

### The full Employee schema

```
employee_id:                 UUID v4
employee_code:               string, required, unique within workspace — short
                             human-readable operational identifier; never a UUID
workspace_id:                UUID, FK to Workspace
user_id:                     UUID, nullable — null until invitation accepted
employee_type:               enum: Employee, Ghost — default Employee; Ghost per VRS-F007
full_name:                   string, required
preferred_name:              string, nullable
email:                       string, required, unique within workspace
phone:                       string, nullable
avatar_url:                  string, nullable
job_title:                   string, required
department:                  string, nullable
employment_type:             enum: FullTime, PartTime, Contractor, Intern — required
employment_status:           enum: Active, Inactive, Converted
seniority_level:             enum: Junior, Mid, Senior, Lead, Principal, Director, CLevel — nullable
start_date:                  date, required
end_date:                    date, nullable
probation_end_date:          date, nullable
probation_status:            enum: Pending, Confirmed, Extended, Terminated — nullable
probation_extension_reason:  text, nullable
contract_end_date:           date, nullable — engagement term for Contractors,
                             distinct from end_date which is set only at offboarding
contract_renewal_status:     enum: Pending, Renewed, Converted, Ended — nullable
billing_rate_default:        decimal, nullable — DAILY. What the agency charges
contracted_hours:            decimal, required, default 40 — weekly. Zero is valid
                             and deliberate: a non-billable director or advisor
billability_target_override: decimal, nullable — null follows the workspace default
working_pattern_id:          UUID, nullable, FK to WorkingPattern — null follows
                             the Entity's calendar, per VRS-F004
timezone:                    IANA string, nullable
location:                    string, nullable
notes:                       rich_text, nullable

— Tier 1, field-encrypted on the server, per VPS-A003; never on a device —
base_compensation_amount:    decimal, nullable
compensation_frequency:      enum: Annual, Monthly, Hourly — nullable
compensation_currency:       ISO 4217, nullable — defaults to the scoped Entity's
                             default_currency, overridable for genuine cross-border cases

— Universal Node Conventions per VPS-A002 —
```

### Billing rate versus compensation

This distinction is the one most easily broken in either direction, so it is stated explicitly.

`billing_rate_default` is **what the agency charges a client** for this person's time. It is operational data a Manager needs to calculate margin, and it is Tier 0. It is a **daily** figure. It is explicitly not the compensation record.

`base_compensation_amount` is **what the agency pays**. It is Tier 1, field-encrypted on the server and never stored on a device, readable by Owner, Finance Admin, HR Admin and the employee themselves.

Where the two are used together, [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s hourly rates convert at 8 hours per day. Locking down billing rate as though it were salary breaks margin calculation; treating salary as casually as billing rate breaks confidentiality. Both failures have shipped in real HR products.

### Edges

`has_skill`, `holds_certification` and `managed_by` are specified in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. The detail specific to this feature: attaching a skill or certification through the profile is what creates these edges. There is no separate edge-creation surface at MVP.

`scoped_to_entity` is set at creation and managed by [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]].

### Conversion handling

Candidate-to-Employee and GhostResource-to-Employee follow [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Conversion Event Protocol without exception. This feature implements no conversion logic of its own.

### API contracts

```
// Every write is a named server mutation (VPS-A002, VPS-A003); the server is
// the only writer and validates before it commits.
employee.create(fields)                          -> { employeeId }
employee.update(employeeId, fields)              -> { success }
employee.get(employeeId)                         -> Employee
  // Tier 1 fields absent entirely for an unauthorized caller,
  // per VPS-A004's structural-absence rule — never null, never redacted
employee.list(workspaceId, filters?)             -> Employee[]
employee.attachSkill(employeeId, skillId, proficiencyLevel)   -> { edgeId }
employee.attachCertification(employeeId, certificationId, issueDate, expiryDate, issuingBody) -> { edgeId }
employee.setManager(employeeId, managerId)       -> { edgeId }
employee.transitionStatus(employeeId, newStatus) -> { success }
```

### The offboarding sequence

1. `employment_status` set Inactive, `end_date` recorded
2. Every active Assignment flagged `pending manual resolution`, never silently closed
3. Every allocated Asset flagged for return
4. Any Active Departure record marked Completed
5. The linked User's access ended via [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]: membership revoked, the person's devices revoked for the workspace (`device_workspace_revocation`) and their sync audience recomputed, in the same transaction
6. Tier 1 access held by this person ends with that revocation: `protected.read` denies from the next request, and nothing protected was ever on a device to remove
7. The Tier 0 change reaches the device cache of every person who may read it within 1 second

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Employee carries the full schema above. Passwords and session material are never part of it |
| G02 | Employee nodes are never hard-deleted. Offboarding sets status Inactive. Type transitions follow the Conversion Event Protocol exactly |
| G03 | `has_skill` carries proficiency_level, verified, verified_by, verified_at. At most one edge per Skill; a duplicate attachment replaces proficiency rather than creating a second edge |
| G04 | `holds_certification` carries issue_date, expiry_date, issuing_body. Expiry is computed at query time, never stored |
| G05 | `managed_by` follows the single-active-edge-with-history pattern. Changing a reporting line closes the prior edge with `effective_to` and creates a new one, full history preserved |
| G06 | Valid status transitions: Active→Inactive, Inactive→Active, Active→Converted. Invalid transitions are rejected by the server before the mutation commits, not caught after; the device's optimistic copy is reverted and surfaced if the server refuses |
| G07 | `contracted_hours` defaults to 40 for FullTime; other employment types are prompted rather than defaulted. Zero is valid and excludes the employee from [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]]'s agency aggregate |
| G08 | `working_pattern_id` null means the employee follows their Entity's WorkingCalendar per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. No feature MUST infer working days from `employment_type` |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F002-S01 | Employee node schema and data model | Data |
| VRS-F002-S02 | Directory and creation workflow | Logic |
| VRS-F002-S03 | Profile detail view and inline editing | UI |
| VRS-F002-S04 | Lifecycle state machine and offboarding sequence | Logic |
| VRS-F002-S05 | Skills and certifications attachment | Data |
| VRS-F002-S06 | Reporting line management | Data |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin creates an Employee with all required fields
**WHEN** it is saved
**THEN** the node exists with status Active, appears in the directory immediately (optimistically on the creating device, authoritatively once the server commits), and reaches all other connected devices within 1 second

---

**GIVEN** an Employee exists and an invitation is accepted per [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]
**WHEN** acceptance completes
**THEN** `user_id` is populated, and the employee accesses their own profile scoped to their role on their first authenticated query

---

**GIVEN** a directory of 150 active employees on a device with no network connection
**WHEN** the directory loads
**THEN** it renders its Tier 0 fields within 200ms from the device cache, no network request is made, and nothing is degraded relative to the online state

---

**GIVEN** a Team Member views another employee's profile
**WHEN** it loads
**THEN** `billing_rate_default` and notes are visible as Tier 0 operational fields, and the compensation Section is structurally absent — not disabled, not empty, not present

---

**GIVEN** an HR Admin sets a `managed_by` edge naming an employee as manager
**WHEN** that employee next queries
**THEN** [[VPS-A004_Graph_Permission_Layer|VPS-A004]] grants them Manager permissions over those reports, with no membership role change, per [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] G06

---

**GIVEN** an HR Admin initiates offboarding
**WHEN** it is confirmed
**THEN** status becomes Inactive, end date is recorded, every active Assignment and allocated Asset is flagged for resolution rather than closed, the person's access is revoked (membership, devices for the workspace, audience), Tier 1 access ends with it, and the Tier 0 change reaches connected devices within 1 second

---

**GIVEN** an employee has no `working_pattern_id`
**WHEN** any feature computes their working days
**THEN** it resolves through their Entity's WorkingCalendar per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]], and never infers a schedule from `employment_type`

---

## Non-Functional Requirements

- Directory renders under 200ms for 150 active employees from the device cache
- Profile detail renders under 200ms for any permitted role
- `J`/`K` navigation between profiles completes within 100ms
- Tier 0 changes reach all connected devices within 1 second
- The Tier 0 half of the profile and the directory are readable offline with no degradation; Tier 0 writes queue and upload on reconnection. Compensation (Tier 1) needs a connection, both to read and to write, and degrades to `requires-connection`
- Status transitions are validated on the server before the mutation commits
- Conflicts are decided by the server: a mutation carries the version it was decided against, and a stale one is rejected (`stale-state`) rather than overwriting. `billing_rate_default` is Tier 0 and follows the same rule

---

## Security Considerations

- **Wellness data is structurally absent from every surface this feature renders**, enforced by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor and [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 encryption, not by conditional rendering here. This feature must never attempt to display it, even behind a permission check. A permanent constraint, not a phase deferral.
- **Compensation is fetched, never cached.** Tier 1 values are held in memory for the session and are never written to the device; every read is an audited `protected.read`.
- **Compensation access failing correctly matters as much as succeeding.** An unauthorized query must receive a response structurally identical to the field not existing — never an error that confirms the field's presence while denying its value.
- **Email uniqueness is workspace-scoped, not global.** A contractor working with two agencies on Vulto is one User with two Employee records, and enforcing global uniqueness would prevent that entirely.

---

## Out of Scope

- Self-service profile editing — [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]], which gates a narrow five-field self-edit at the application layer rather than widening this document's permission row
- Bulk import — [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]
- Payroll calculation and anything computed from compensation — [[VRS-F062_Payroll_Engine_Core|VRS-F062]]. This document owns the raw fields, not what is derived from them
- Performance history — [[VRS-F039_Performance_Review_Cycle|VRS-F039]]
- Background check results — [[VRS-F035_Background_Check_Integration|VRS-F035]]
- Org chart visualization — [[VRS-F037_Dynamic_Org_Chart|VRS-F037]]. The `managed_by` edge is established here; the chart is not
- Custom fields — [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]]
- Ghost Resource creation — [[VRS-F007_Ghost_Resources|VRS-F007]]. The `employee_type` field is defined here; the creation flow is not
- Working calendar and pattern definition — [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]

---

## Decisions Recorded

**`working_pattern_id` is added**, connecting Employee to [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Without it, every feature computing working days would infer a schedule from `employment_type`, which is exactly the assumption that made the previous specification set wrong for the UAE and for six-day weeks. G08 prohibits the inference explicitly.

**Email uniqueness is scoped to the workspace.** Previously stated as *unique within workspace* without reasoning, which risked being tightened to global by an implementer. A contractor engaged by two agencies on the platform requires it to stay scoped.

**Bulk import is no longer out of scope by omission.** It is out of scope for this document because [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] owns it — a meaningful difference from the previous *manual entry only*, which described a limitation rather than a boundary.

**Tier 1 revocation is added to the offboarding sequence.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] requires revocation on any Tier 1 access change; offboarding is the most consequential instance, and the sequence previously stopped at the device wipe.

**The Overview layout sentence is corrected to match this document's own keyboard table.** It previously read *"every field is an inline-editable Input that commits on blur,"* which describes a permanent Input with no read state — and the same document's keyboard table assigns `E` to open an edit and `Escape` to discard one, both of which presuppose a state to open and close. The two could not both be true. The keyboard model is kept: it is consistent with [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s model everywhere else in the product, and it is also the one that avoids thirty permanently bordered boxes on a screen that should read as a record.

**The write path and the offboarding wipe describe the retired architecture, and are corrected (F199, 22 September 2026).** The body was written throughout as if the local store were canonical: a profile saved locally then synced outward, status transitions rejected by client-side validation before reaching the local store, Tier 1 end-to-end encrypted on the device, and a Tier 1 local wipe on offboarding. Under [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s server-authoritative revision, and per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s rule that a named mutation is the only writer: a named server mutation writes and validates status transitions before it commits (G06); Tier 0 fields then reach devices through the shape sync, which is why the 200ms offline directory claim survives, scoped explicitly to the Tier 0 half; Tier 1 (`base_compensation_amount` and the rest) is field-encrypted on the server and was never on a device, so offboarding's "Tier 1 access revoked" step is the `device_workspace_revocation` and audience-recompute machinery, not a wipe. The "aged out" system state is now `requires-connection` ([[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]), and last-write-wins conflict resolution is replaced by the server's stale-state rejection. The original clauses are corrected in place above; this entry is the record of what they said and why they changed. Recorded as part of the FDN-104 priority slice.

---

## Related Notes

- [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] — identity and the invitation this profile links to
- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the Entity every employee is scoped to
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working calendar governing this employee's days
- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the Bench Forecast these profiles populate
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the registry entry this document completes

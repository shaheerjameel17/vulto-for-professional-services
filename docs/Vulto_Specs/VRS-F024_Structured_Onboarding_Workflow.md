---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Experience
aliases:
  - VRS-F024
---

# VRS-F024 — Structured Onboarding Workflow

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee — `employment_type` for template matching, `managed_by` for assignee resolution), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — due offsets are counted in them), [[VRS-F018_Leave_Policy_Engine|VRS-F018]] (the matching and tie-breaking pattern reused here rather than reinvented), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (where due tasks surface), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (OnboardingTemplate, OnboardingPlan and OnboardingTask registry entries), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the participant-scoped grant)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A checklist-driven onboarding plan, created automatically the moment a new employee exists, instantiated from a reusable template matched to their employment type.

Each task carries a due date, an assignee — new hire, manager or HR Admin — and where relevant a link into [[Vulto Learn - Team Knowledge]], so training surfaces exactly when it is needed rather than sitting in a document nobody opens on day one.

---

## Problem It Solves

Onboarding without structure means every new hire's experience depends entirely on how organized their particular manager happens to be that week. Some get a thorough first month; others get a laptop and a chat invite and work the rest out themselves.

Neither is a deliberate choice. It is what happens without a checklist applying the same baseline to everyone, however good or overwhelmed their specific manager is.

**It is in MVP because it is the first impression every employee forms of this product.** A new hire's first week is when they decide whether the system their employer chose is competent, and a product that appears at that moment as a well-organized sequence rather than an empty profile has already made its case.

---

## User-Facing Flows

### A plan begins automatically

The moment a new Employee exists — created directly, imported by [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]], or converted from a candidate — this feature matches an active template by `employment_type`.

The matching pattern is [[VRS-F018_Leave_Policy_Engine|VRS-F018]]'s exactly, including its tie-break: the most recently created active template wins where more than one matches, **and the ambiguity is flagged to HR Admin** rather than silently arbitrated forever.

An OnboardingPlan is created and its tasks instantiated.

### Working through tasks

Each task appears on the relevant person's own list and in their Inbox per [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] as it comes due. A task due soon and not complete is visible without anyone going looking for it.

### A learning task

A task carrying a learning link surfaces it directly — *Complete your security training* — with the content one click away, rather than a task that merely says to go and find it.

### Completing

Whoever a task is assigned to marks it complete themselves. This is a **participant-scoped action**: a manager assigned a task on a report they do not otherwise have elevated access to still completes their own assigned task normally.

### Configuring a template

An HR Admin builds a reusable template: an ordered list of tasks, each with a due offset from the start date, an assignee role and an optional learning link. Templates target a specific employment type or apply to all.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| My onboarding | Content | The new hire's own sequence |
| Onboarding plans | Content + Panel | HR Admin's view across everyone |
| Templates | Content + Panel | Configuration. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Task items | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox | Completion in place |

### Layout and components

**My onboarding** is the surface that matters most, and it is deliberately not a table.

A single vertical sequence of task Cards grouped by week, each showing the title, description, due date, and where present the learning link as a `secondary` action. Completed tasks collapse to a single line with a `success` check and move no further — a completed sequence should read as visible progress rather than disappear.

A Progress bar sits at the top: *4 of 11 complete*. Tasks assigned to someone else appear in the same sequence, grayed, labeled with who holds them — *Manager: laptop and access provisioning*. A new hire waiting on something should be able to see what and who, rather than wondering whether they have missed a step.

**Onboarding plans** is a Table: employee, start date, template, progress as a compact bar, overdue count. Sorted by overdue descending — the plan needing attention is the one where something has slipped.

**Templates** is a Table with a Panel editor. The editor is an ordered list of task definitions with drag-to-reorder, each row holding title, due offset in working days, assignee role Select and an optional link. A live preview beside it shows the resulting dates against a sample start date, so an HR Admin building a template sees what a real hire will actually receive.

### Keyboard

`J`/`K` through tasks. `Space` toggles completion on a focused task assigned to the current user.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton cards |
| Restricted | A Team Member sees their own plan and any task assigned to them. Nothing else |
| Empty | *No template matches this employment type.* with **Create template** for an HR Admin, and for a new hire nothing at all — an employee should never see a message about a misconfiguration |
| Conflict | Two matching templates render an Inline Alert on both, naming the other |
| Error | Completing a task not assigned to the caller is refused |

### Responsive

My onboarding is single-column throughout and works unchanged to 375px. It is the surface most likely to be opened on a phone during someone's first week.

---

## Technical Architecture

### OnboardingTemplate

```
template_id:                UUID v4
workspace_id:               UUID
name:                       string, required
applicable_employment_type: enum matching Employee.employment_type, or 'All'
task_definitions:           JSON array of {
                              task_order, title, description,
                              due_offset_working_days: integer,
                              assigned_role: enum: NewHire, Manager, HRAdmin,
                              learn_article_url: string, nullable
                            }
is_active:                  boolean, default true

— Universal Node Conventions per VPS-A002 —
```

`assigned_role` uses roles [[VPS-A004_Graph_Permission_Layer|VPS-A004]] already recognizes. No role is invented here.

### OnboardingPlan

```
plan_id:          UUID v4
workspace_id:     UUID
employee_id:      UUID, FK to Employee — a direct field, not solely reachable
                  through enrolled_in
template_id:      UUID, the source instantiated from
start_date:       date, normally the employee's own start date
status:           enum: InProgress, Completed, Canceled

— Universal Node Conventions per VPS-A002 —
```

### OnboardingTask

```
task_id:              UUID v4
workspace_id:         UUID
plan_id:              UUID
title:                string — snapshotted from the template at instantiation
description:          text, nullable, snapshotted
learn_article_url:    string, nullable, snapshotted
due_date:             date — the plan's start date plus the definition's
                      due_offset_working_days, counted through VRS-F004
assigned_role:        enum: NewHire, Manager, HRAdmin
assigned_employee_id: UUID, nullable — resolved at instantiation.
                      NewHire resolves to the plan's employee.
                      Manager resolves through their managed_by edge.
                      HRAdmin resolves to no individual and surfaces on
                      every HR Admin's shared list instead
status:               enum: Pending, Completed, Skipped
completed_at:         timestamp, nullable
completed_by:         user_id, nullable

— Universal Node Conventions per VPS-A002 —
```

### Due dates count working days

`due_offset_working_days` is counted through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]'s `addWorkingDays`, not by adding calendar days.

An onboarding task due *on day three* means the third day the person actually works. Counted as calendar days, a Wednesday start puts day three on a Saturday, and a new hire's first experience of the product is a task that was overdue before they arrived.

### Snapshotting, not live reference

Title, description and learning link are copied from the template at instantiation, never read live afterwards.

Same historical-accuracy principle as [[VRS-F006_Rate_Card_Engine|VRS-F006]]'s rate card versioning and [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s frozen contract content: **a template edited after a plan exists must never silently rewrite what a specific person sees partway through their own onboarding.**

### The learning link

A plain URL. [[Vulto Learn - Team Knowledge]] is a separate application this project does not build, and inventing a structured integration against an API that does not exist would be guessing.

A plain link is a complete solution here, not a placeholder apologizing for itself. If that application later exposes a content API, this field is a natural place to evolve from.

### API contracts

```
onboardingTemplate.create(name, applicableEmploymentType, taskDefinitions)
  -> { templateId }
onboardingTemplate.preview(templateId, sampleStartDate)
  -> { title, dueDate, assignedRole }[]

onboardingPlan.createForEmployee(employeeId) -> { planId }
  // Reactive on any new Employee. Matches by employment_type per VRS-F018's
  // pattern and instantiates every task

onboardingTask.complete(taskId)        -> { success }
  // Restricted to the task's assigned_employee_id, any HR Admin for an
  // HRAdmin-assigned task, or Owner
onboardingTask.skip(taskId, reason)    -> { success }
onboarding.listMyTasks(employeeId)     -> OnboardingTask[]
onboarding.listPlans(workspaceId)      -> { planId, employeeId, progress, overdueCount }[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | The three node types carry the schemas above |
| G02 | `enrolled_in` connects Employee to OnboardingPlan |
| G03 | Task fields are snapshotted at instantiation. A later template edit never alters an already-instantiated task |
| G04 | Template matching reuses [[VRS-F018_Leave_Policy_Engine|VRS-F018]]'s pattern: match by employment type, tie-break by most recently created, flag the ambiguity to HR Admin |
| G05 | `onboardingTask.complete` is a participant-scoped action, reusing the grant shape [[VPS-A004_Graph_Permission_Layer|VPS-A004]] establishes, not a new permission concept |
| G06 | `due_date` is computed through [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]'s working-day arithmetic, never by adding calendar days |
| G07 | A plan is created for every new Employee including those created by [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s bulk import, where a template matches |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F024-S01 | Template configuration and preview | Data |
| VRS-F024-S02 | Automatic plan instantiation | Logic |
| VRS-F024-S03 | New hire sequence surface | UI |
| VRS-F024-S04 | Task completion and assignee resolution | Logic |
| VRS-F024-S05 | HR Admin plan overview | UI |

---

## Feature Acceptance Criteria

**GIVEN** an active template matches a new employee's employment type
**WHEN** the Employee node is created
**THEN** a plan is created with every task instantiated and due dates computed from their start date

---

**GIVEN** a task with a due offset of three working days and a Wednesday start in a Monday-to-Friday workspace
**WHEN** the due date is computed
**THEN** it falls on the following Monday, not the Saturday a calendar count would produce

---

**GIVEN** a task's assigned role is Manager
**WHEN** the plan is instantiated
**THEN** the assignee resolves to the new hire's actual manager through `managed_by`

---

**GIVEN** a template is edited after a plan exists from it
**WHEN** that employee's tasks are viewed
**THEN** they remain exactly as snapshotted, unaffected

---

**GIVEN** a manager is assigned a task on a report's plan
**WHEN** they mark it complete
**THEN** it succeeds per the participant-scoped grant, regardless of whether role columns alone would have permitted it

---

**GIVEN** a new hire opens their own sequence
**WHEN** it renders
**THEN** tasks assigned to others appear grayed with the holder named, so they can see what they are waiting on

---

**GIVEN** two active templates match a new hire
**WHEN** the plan is instantiated
**THEN** the most recently created is used and the ambiguity is flagged to HR Admin — the identical resolution [[VRS-F018_Leave_Policy_Engine|VRS-F018]] establishes for the same shape of conflict

---

**GIVEN** no template matches
**WHEN** the employee is created
**THEN** no plan is created, HR Admin is notified, and the new hire sees nothing about the misconfiguration

---

## Non-Functional Requirements

- Plan instantiation completes within 5 seconds of a new Employee existing
- Task list views resolve within 200ms from the local graph
- Full functionality offline for viewing and completing
- Bulk import creating fifty employees instantiates fifty plans without blocking the import

---

## Security Considerations

- **No new permission concept was invented for task completion.** The participant-scoped grant in [[VPS-A004_Graph_Permission_Layer|VPS-A004]] is reused directly: whoever is assigned a task needs to complete it, regardless of organizational role.
- **OnboardingTemplate is workspace configuration**, the same shape as LeavePolicy, since a checklist definition is not a record about any specific person.
- **A task title can disclose more than intended.** *Complete visa documentation* on a shared plan view tells colleagues something about a person's immigration status. Task titles are visible to the assignee, the plan's employee, their manager and HR Admin — not workspace-wide — and an HR Admin writing templates should be aware that a title is read by more people than the one it concerns.

---

## Out of Scope

- **A structured integration with [[Vulto Learn - Team Knowledge]]'s content API** — that application does not exist; a plain URL is the complete solution here
- **Automatic reassignment if a manager changes mid-onboarding.** The assignee resolves once at instantiation; a reporting-line change during onboarding is a manual correction
- **Onboarding analytics across the workspace** — this feature tracks individual plans; aggregate effectiveness reporting is [[VRS-F058_People_Analytics_Dashboard|VRS-F058]]'s territory
- **Offboarding checklists** — [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] flags loose ends and [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] tracks the countdown. A structured offboarding sequence mirroring this feature is a reasonable later addition and is not built here

---

## Decisions Recorded

**This feature moves from Post-MVP to MVP**, alongside [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]. The two are counterparts at either end of the employment lifecycle, and a product that tracks departures but not arrivals is oddly shaped.

**Due offsets count working days**, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. The previous specification used calendar-day offsets, which puts a day-three task on a Saturday for a Wednesday start — meaning a new hire's first interaction with the product is a task that was overdue before they arrived.

**Tasks assigned to others appear in the new hire's sequence, grayed.** The previous specification showed each person only their own tasks, which leaves a new hire unable to distinguish *waiting on IT* from *I have missed something*.

**A missing template notifies HR Admin and shows the new hire nothing.** The previous specification did not say what happens when no template matches. An employee seeing an error about workspace configuration on their first day is the worst possible first impression this feature could produce.

**A template preview against a sample start date is added.** An HR Admin building a sequence of eleven tasks with working-day offsets cannot compute the resulting dates in their head, and a template whose dates are wrong is discovered by a new hire rather than by its author.

---

## Related Notes

- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — the counterpart at the other end of the lifecycle
- [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] — the working days due offsets are counted in
- [[VRS-F018_Leave_Policy_Engine|VRS-F018]] — the matching pattern reused here
- [[Vulto Learn - Team Knowledge]] — the learning content tasks link to

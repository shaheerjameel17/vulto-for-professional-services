---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F027
---

# VRS-F027 — Headcount Plan and Requisition Approval

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity — plans are budgeted per entity), [[VRS-F007_Ghost_Resources|VRS-F007]] (Ghost Resources, which a requisition frequently originates from), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (Skill, for requirement definition), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (HeadcountPlan, Requisition and the generalized ApprovalStage), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the Finance-restricted class governing budget fields)
**Blocks:** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (an OpenRole originating from an approved requisition), [[VRS-F032_Offer_Management|VRS-F032]] (offer approval reads the requisition's budget)

This document is the single source of truth for this feature.

---

## What It Is

The step before recruiting: **a budgeted plan for how many people the business intends to hire, and an approval gate that turns an intention into an authorized open role.**

A HeadcountPlan states how many roles a period allows and what they may cost. A Requisition is a request to fill one, routed for approval, and on approval it becomes the OpenRole that [[VRS-F028_Recruitment_Pipeline|VRS-F028]] recruits against.

---

## Problem It Solves

Recruitment in most agencies begins with a conversation and ends with a surprise. Somebody decides a hire is needed, a role gets posted, candidates are interviewed, an offer is made — and at some point in that sequence, usually late, someone asks what it costs and whether it was budgeted.

The failure is not that agencies lack discipline. It is that the two facts live in different places: the capacity gap is visible in the Bench Forecast, the budget is in a spreadsheet, and nothing connects them until an offer is on the table.

**This feature closes the loop that [[VRS-F007_Ghost_Resources|VRS-F007]] opens.** A Ghost Resource already represents a hire the founder is planning against. Until now it had nowhere to go: it sat in the forecast until someone independently decided to recruit. A Ghost now becomes a Requisition, a Requisition is approved against a budget, and approval produces the role. The same planned person is traceable from the moment they were imagined to the moment they bill.

---

## User-Facing Flows

### Setting a plan

An Owner or Finance Admin creates a HeadcountPlan for a period — typically a quarter or a year — per entity: how many roles, and the total compensation budget available for them.

The plan is deliberately coarse. It states a ceiling, not a staffing model, and a firm that wants to plan by role and department can create several plans rather than one elaborate one.

### Raising a requisition

An Owner, HR Admin or Manager raises a Requisition against a plan: the role, seniority, required skills, target start date, and a proposed compensation range.

Where the requisition originates from a Ghost Resource, the role, seniority, skills and start date pre-fill from it, and the link is preserved.

### Approval

The requisition routes through an ApprovalStage chain — the same node type [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]] uses for payroll, [[VRS-F038_Promotion_and_Compensation_Change_Workflow|VRS-F038]] for compensation change and [[VRS-F032_Offer_Management|VRS-F032]] for offers. Four approval workflows, one mechanism.

The approver sees what the plan has left: roles remaining, budget remaining, and what this requisition consumes. **Approving a requisition that exceeds the plan is possible and requires a stated reason**, because a plan set in January should not prevent a hire the business genuinely needs in June — but it should make that decision visible.

### Approval creates the role

An approved requisition calls [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s `openRole.create` and links the two. Recruitment begins from an authorized position rather than an assumed one.

### Rejection and withdrawal

A rejected requisition records a reason and remains on the record. The Ghost Resource it came from, where there was one, stays in the forecast — the capacity gap has not gone away because the hire was declined, and a forecast that quietly removed it would be lying about the coming quarter.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Headcount plans | Content + Panel | Set and track plans |
| Requisitions | Content + Panel | The queue and its state |
| Raise requisition | Modal | Short, consequential |
| Approval | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox | Decision in place |

### Layout and components

**Headcount plans** is a Table: period, entity, roles planned, roles committed, budget, budget committed, and a Progress bar showing consumption. Rows over plan render the consumed figure in `attention`.

The Panel shows the plan's requisitions grouped by state, so an Owner can see what a plan has actually been spent on rather than only that it has been spent.

**Requisitions** is a Table: role, seniority, entity, plan, status Badge, raised by, days pending. Sorted by days pending descending — a requisition sitting unapproved for three weeks is the problem this screen exists to make visible.

**Raise requisition** pre-fills from a Ghost where one is selected, and shows the plan's remaining capacity live beneath the compensation field: *This plan has 3 roles and £180,000 remaining.* Where the requisition would exceed either, the figure renders `attention` and a reason field appears — not a block, a disclosure.

**Approval** in the Inbox shows the role, the requester, the plan position and the proposed range, with **Approve** and **Decline** inline. Compensation figures are structurally absent for an approver without Tier 1 access, and where that leaves them unable to evaluate the request meaningfully, the item does not route to them at all.

### Keyboard

Standard list and Inbox bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | A Manager sees requisitions they raised and their own team's. Budget fields are absent without Finance access |
| Empty | *No headcount planned.* with **Create plan** — and an explanatory line that requisitions can still be raised without one |
| Over plan | The consumed figure in `attention`, with the reason recorded and shown on the requisition |
| Error | A requisition against a closed plan is refused, naming the plan |

### Responsive

Drops `entity`, then `raised by`, below 1280px. `Days pending` is never dropped.

---

## Technical Architecture

### HeadcountPlan

Finance-restricted, Tier 1 in full — a plan states what the business intends to spend on people, which is compensation data by another name.

```
plan_id:            UUID v4
workspace_id:       UUID
entity_id:          UUID, FK to Entity
name:               string, required
period_start:       date
period_end:         date
planned_role_count: integer
planned_budget:     decimal
currency:           ISO 4217 — defaults from the Entity per VRS-F003
lifecycle_status:   enum: Active, Closed

— Universal Node Conventions per VPS-A002 —
```

Roles and budget committed are **computed live** from approved requisitions, never stored. Same discipline as [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s bench computation and [[VRS-F018_Leave_Policy_Engine|VRS-F018]]'s leave balance.

### Requisition

Split, per the pattern established for Employee, Pitch and Contract.

```
requisition_id:     UUID v4
workspace_id:       UUID
plan_id:            UUID, nullable — a requisition may exist without a plan
entity_id:          UUID, FK to Entity
ghost_resource_id:  UUID, nullable — the placeholder this originated from
role_title:         string, required
seniority_level:    enum per VRS-F002
target_start_date:  date
justification:      text, required
status:             enum: Draft, PendingApproval, Approved, Declined, Withdrawn
open_role_id:       UUID, nullable — set on approval
declined_reason:    text, nullable, required when Declined

— Tier 1, Finance-restricted —
proposed_compensation_min: decimal
proposed_compensation_max: decimal
over_plan_reason:          text, nullable, required when the requisition exceeds
                           its plan's remaining roles or budget

— Universal Node Conventions per VPS-A002 —
```

`justification` is required and Tier 0. A requisition with no stated reason is a request nobody can evaluate, and the discipline of writing one sentence is most of the value this feature provides.

### Edges

`requisition_for` connects Requisition to HeadcountPlan. `opened_from` connects the resulting OpenRole back to the Requisition. `gated_by` connects Requisition to its ApprovalStage chain.

Where a Ghost originated the requisition, `ghost_resource_id` links them and the Ghost's own `placeholder_for` edge to the eventual OpenRole is created on approval — so the chain from placeholder to hire is traversable in both directions.

### Plan consumption

```
roles_committed  = count of Approved requisitions against this plan
budget_committed = sum of proposed_compensation_max across those requisitions
```

`max` rather than `min` deliberately. A plan consumed against the optimistic end of every range will be exhausted by reality, and a headcount plan that reports capacity it does not have is worse than none.

### API contracts

```
headcountPlan.create(entityId, name, periodStart, periodEnd,
                     plannedRoleCount, plannedBudget) -> { planId }
headcountPlan.consumption(planId) -> {
  rolesPlanned, rolesCommitted, budgetPlanned, budgetCommitted
}
  // Computed live. Tier 1 fields absent for a caller without access

requisition.raise(entityId, roleTitle, seniorityLevel, justification,
                  targetStartDate, planId?, ghostResourceId?,
                  compensationRange?) -> { requisitionId, exceedsPlan }
requisition.submitForApproval(requisitionId, overPlanReason?) -> { success }
  // overPlanReason required where exceedsPlan is true

requisition.approve(requisitionId)          -> { requisitionId, openRoleId }
  // Calls VRS-F028's openRole.create and links both records
requisition.decline(requisitionId, reason)  -> { success }
requisition.withdraw(requisitionId)         -> { success }
requisition.list(workspaceId, status?)      -> Requisition[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | HeadcountPlan and Requisition carry the schemas above |
| G02 | Plan consumption is computed live from approved requisitions, never stored |
| G03 | Budget consumption uses `proposed_compensation_max`, never the minimum |
| G04 | A requisition exceeding its plan may be approved, and requires `over_plan_reason`. It is never blocked |
| G05 | Approval calls [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s `openRole.create` and sets `open_role_id`. This feature does not implement role creation |
| G06 | Where a requisition originates from a Ghost, `placeholder_for` is created from that Ghost to the resulting OpenRole on approval, making the chain traversable both ways |
| G07 | A declined requisition leaves its originating Ghost in the forecast unchanged. The capacity gap is unaffected by the hiring decision |
| G08 | Requisition uses the generalized ApprovalStage from [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], not a bespoke approval mechanism |
| G09 | `justification` is Tier 0 and required. Compensation range is Tier 1 |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F027-S01 | HeadcountPlan schema and live consumption | Data |
| VRS-F027-S02 | Requisition schema and lifecycle | Data |
| VRS-F027-S03 | Approval routing | Logic |
| VRS-F027-S04 | Ghost origination and linkage | Logic |
| VRS-F027-S05 | Plan and requisition surfaces | UI |

---

## Feature Acceptance Criteria

**GIVEN** a plan with 5 roles and £400,000, and 3 approved requisitions totalling £250,000 at their maximums
**WHEN** consumption is computed
**THEN** it reports 3 of 5 roles and £250,000 of £400,000, computed live

---

**GIVEN** a Manager raises a requisition from a Ghost Resource
**WHEN** the form opens
**THEN** role, seniority, skills and target start pre-fill from the Ghost, and the link is preserved on submission

---

**GIVEN** a requisition whose maximum exceeds the plan's remaining budget
**WHEN** it is submitted
**THEN** submission is permitted, an over-plan reason is required, and the approver sees both the excess and the reason

---

**GIVEN** a requisition is approved
**WHEN** approval completes
**THEN** an OpenRole exists through [[VRS-F028_Recruitment_Pipeline|VRS-F028]], `open_role_id` is set, and where a Ghost originated it a `placeholder_for` edge connects that Ghost to the new role

---

**GIVEN** a requisition originating from a Ghost is declined
**WHEN** the decline is recorded
**THEN** the Ghost remains in the Bench Forecast unchanged, and the forecast continues to show the capacity gap

---

**GIVEN** a Manager without Finance access views a requisition
**WHEN** it renders
**THEN** the compensation range is structurally absent, and the justification, role and status remain visible

---

**GIVEN** an approver without Tier 1 access
**WHEN** approval routing runs
**THEN** the requisition does not route to them, since an approval decision they cannot evaluate is not an approval

---

## Non-Functional Requirements

- Plan consumption computes within 200ms from the local graph
- The requisition list renders within 200ms
- Full functionality offline. Approval follows standard sync behavior
- Tier 1 fields sync only to authorized devices per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]

---

## Security Considerations

- **HeadcountPlan is Tier 1 in full**, not split. Unlike a requisition, which has a legitimate Tier 0 half that recruiters and managers need, a plan is entirely a statement of intended spend and has no operational half worth exposing.
- **A compensation range on a requisition is Tier 1 for the same reason a salary is.** A range for a role is a close approximation of what the eventual hire will earn, and in a small agency it is a close approximation of what an existing person at that level earns.
- **Approval routing respects tier.** Routing a compensation decision to someone who cannot see the compensation produces either a rubber stamp or a request for the figure through a side channel, and both are worse than not routing it.
- **Every approval and decline is audited** per [[VPS-F004_Silent_Audit_Log|VPS-F004]].

---

## Out of Scope

- **Detailed workforce modeling** — scenario planning across departments and quarters is [[VRS-F051_Team_Capacity_Planner|VRS-F051]]'s territory. This feature states a ceiling and tracks consumption against it
- **Recruitment itself** — [[VRS-F028_Recruitment_Pipeline|VRS-F028]]
- **Offer approval** — [[VRS-F032_Offer_Management|VRS-F032]], which reads a requisition's range as its constraint
- **Actual payroll cost against plan** — [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]]
- **Automatic requisition creation from a detected capacity gap** — [[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]] suggests; a person decides

---

## Decisions Recorded

**This feature is new**, and it exists because [[VRS-F007_Ghost_Resources|VRS-F007]]'s Ghost Resources had nowhere to go. A placeholder representing a planned hire sat in the forecast until somebody independently decided to recruit, with no link between the two. The chain from Ghost to Requisition to OpenRole to Candidate to Employee is now unbroken and traversable in both directions, which is what makes [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]]'s hiring analytics able to ask whether a hire the forecast predicted actually billed.

**Over-plan requisitions are permitted with a reason rather than blocked.** A plan set in January should not prevent a hire the business genuinely needs in June. Blocking produces requisitions raised outside the system; disclosing produces a record of a deliberate decision.

**Budget consumption uses the maximum of the proposed range.** A plan consumed against the optimistic end will be exhausted by reality, and a headcount plan reporting capacity it does not have is worse than having no plan.

**A declined requisition leaves its Ghost in the forecast.** The capacity gap did not disappear because the hire was refused, and a forecast that quietly removed it would misrepresent the coming quarter — which is the one thing the Bench Forecast must never do.

**Requisition reuses ApprovalStage** rather than defining a fourth approval mechanism. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] generalized that node type for exactly this.

---

## Related Notes

- [[VRS-F007_Ghost_Resources|VRS-F007]] — the Ghost Resources requisitions originate from
- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline an approved requisition opens into
- [[VRS-F032_Offer_Management|VRS-F032]] — offer approval, constrained by the requisition's range
- [[VRS-F051_Team_Capacity_Planner|VRS-F051]] — the strategic capacity layer above this one

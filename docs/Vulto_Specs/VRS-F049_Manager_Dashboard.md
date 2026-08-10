---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Experience
aliases:
  - VRS-F049
---

# VRS-F049 — Manager Dashboard

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** More features than any other document in this set — [[VRS-F005_The_Bench_Forecast|VRS-F005]], [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]], [[VRS-F010_Timesheet_Speed-Run|VRS-F010]], [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]], [[VRS-F014_Skill_Matrix|VRS-F014]], [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]], [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]], [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]], [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]], [[VRS-F039_Performance_Review_Cycle|VRS-F039]], [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]], [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], [[VRS-F052_Workload_Strain_Signal|VRS-F052]] — every one composed, none modified
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What this refuses to be

Not a status page. Not a grid of numbers copied from other screens with a new header.

**The test this document holds itself to:** would a manager who used only this screen, and never opened any of the thirteen features it draws from, still know everything they needed and be able to act on all of it without navigating away.

If the answer is no, the feature has failed at the one job justifying its existence.

---

## The problem, stated plainly

By the time this exists, a manager's job has evidence scattered across burnout alerts, timesheet anomalies, pending leave approvals, onboarding tasks assigned to them, performance assessments they owe, milestone confirmations waiting on them, interview feedback they have not submitted, and a capacity conflict on a report they may not have noticed.

**No reasonable person checks thirteen screens every morning.** In practice that means most of this signal goes unseen until it becomes a larger problem — an overdue review nobody remembered, a burnout signal uncleared for three weeks, an onboarding task blocking a new hire's laptop.

Scattering genuinely useful signals across many well-designed features is, in aggregate, the same failure as not building them, if nobody has one place to see them together.

---

## The boundary with [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]

That feature is the cross-role notification stream — ephemeral, event-driven, the same mechanism every role uses, surfaced in the Inbox specified in [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]].

**This is a manager's persistent, current-state command center**, composed specifically around what running a team requires.

The practical distinction: the Inbox tells a manager *what happened*; this tells them *what is true right now*. A burnout alert raised three weeks ago and never cleared has stopped being news and is still a fact about their team. It appears here indefinitely and left the Inbox long ago.

Where both surfaces show the same item, resolving it in either resolves it in both, because both call the same underlying mutation.

---

## What It Is

One view in two tiers.

**Needs Your Action** — a prioritized queue merging every pending action scattered across other features, each actionable directly from this screen.

**Team at a Glance** — passive current-state context a manager should be aware of without it demanding action today.

---

## Interface Specification

### Screen

Content region, no Panel. Reached at `G` then `D`.

### Layout

**Needs Your Action** is grouped sections, each with a count — not a single opaque priority score across fundamentally different items.

| Section | Source | Inline action |
|---|---|---|
| Leave requests awaiting approval | [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] | Approve, reject |
| Timesheet anomalies | [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] | Review, clear |
| Burnout signals | [[VRS-F052_Workload_Strain_Signal|VRS-F052]] | Review, clear |
| Capacity conflicts on a report | [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] | Opens the resolution panel |
| Onboarding tasks assigned to you | [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] | Complete |
| Performance assessments owed | [[VRS-F039_Performance_Review_Cycle|VRS-F039]] | Opens the assessment field |
| Milestone confirmations pending | [[VRS-F040_Career_Pathing_and_Development_Tracker|VRS-F040]] | Confirm |
| Interview feedback owed | [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] | Opens the scorecard |

**Ordering within the queue is by age, not by type.** A leave request submitted four days ago outranks a burnout alert raised this morning, because the failure this screen prevents is things sitting rather than things being important. Each row states how long it has waited.

**Every item resolvable in one action is resolved without leaving the screen.** Only the capacity conflict opens into its source, deliberately: [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s resolution panel has genuine multi-step options — adjust, reduce, end early, override — and a shrunk-down copy would be a worse version of a screen that already exists.

**Team at a Glance** is four Cards:

- **Utilization** across direct reports, per [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]], with the target marked
- **Skill coverage** scoped to the team, per [[VRS-F014_Skill_Matrix|VRS-F014]]
- **Pulse sentiment trend**, per [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], only where the threshold is met, with no exception made here
- **Upcoming probation reviews** for direct reports, per [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — **probation only, never notice-period data**

**A quiet queue reads as good news**, not an empty state: *Nothing waiting on you.* with the Team at a Glance cards rendering normally beneath. A manager whose queue is clear should feel that as an outcome rather than an absence.

### Keyboard

`G` `D` opens the dashboard. `J`/`K` move between items across section boundaries. `Enter` performs the primary action. `E` marks an item handled where it is informational.

### System states

| State | Treatment |
|---|---|
| Syncing | Sections render as they resolve rather than blocking on the slowest |
| Restricted | Every item's visibility is inherited. This feature filters nothing itself |
| Suppressed | Pulse below threshold renders the suppression, per [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] |
| Empty | *Nothing waiting on you.* |
| Error | A failed inline action states the reason and leaves the item in place |

### Responsive

The two tiers stack below 1280px. Below 1024px, Team at a Glance collapses behind a toggle, since the queue is what a manager opens this for.

---

## Technical Architecture

### No new node type. A composition layer, and nothing more

This feature **stores nothing.** Every read calls another feature's existing API; every write is a thin call to an already-permissioned mutation.

`dashboard.approveLeave` calls [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]]'s `leaveRequest.approve`. `dashboard.clearBurnoutAlert` calls [[VRS-F052_Workload_Strain_Signal|VRS-F052]]'s own clearance. **No business logic is written here for any action.**

### This feature enforces no permissions of its own

Every item shown and every action available passes through the permission check its originating feature already applies.

**This composes what a manager is already allowed to see and do. It does not widen that boundary anywhere**, and it needs no row in [[VPS-A004_Graph_Permission_Layer|VPS-A004]], because there is no node type for a row to describe.

### The one verification that mattered

Composing [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] for this dashboard is what surfaced that its transitions query returned both probation reviews and notice-period completions from one call.

A manager calling it would have received departure data their role explicitly excludes. That is now closed in [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] itself — a manager-scoped call returns an empty array for notice periods regardless of what exists — rather than worked around here by filtering after receipt.

**The distinction matters: this feature never receives the data, rather than receiving and declining to render it.**

### Delegated approval

[[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] names an unfilled gap: a manager on leave leaves their team's approvals unactioned.

This feature closes it. A manager can nominate a delegate for a date range, and during it the delegate's own dashboard shows the delegating manager's approval items, clearly labeled as delegated and separated from their own.

**Delegation covers approvals only** — leave requests, timesheet anomaly clearances, onboarding tasks. It never covers performance assessments, milestone confirmations or interview feedback, because those are judgments about a person that belong to the person who manages them.

A delegation is time-bounded, visible to the delegate and to HR Admin, and audited.

### API contracts

```
dashboard.getActionQueue(managerId, includeDelegated?) -> {
  items: {
    itemType, sourceId, subjectEmployeeId, waitingSinceDays,
    isDelegated, delegatedFrom?
  }[]
}
  // A single flat list ordered by age, grouped for display client-side

dashboard.getTeamGlance(managerId) -> {
  utilization, skillCoverage, pulseTrend, upcomingProbationReviews
}
  // probation only; VRS-F023 guarantees no notice-period data reaches here

dashboard.approveLeave(requestId)                  -> { success }
dashboard.rejectLeave(requestId, reason)           -> { success }
dashboard.clearTimesheetAnomaly(flagId, outcome, note?) -> { success }
dashboard.clearBurnoutAlert(alertId, note?)        -> { success }
dashboard.completeOnboardingTask(taskId)           -> { success }
dashboard.confirmMilestone(employeeId, milestoneId) -> { success }
  // Each a direct, unmodified call to its originating feature

delegation.create(managerId, delegateEmployeeId, startDate, endDate) -> { delegationId }
delegation.revoke(delegationId)                    -> { success }
delegation.listActive(workspaceId)                 -> Delegation[]
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no new node type or edge type, excepting the delegation record below |
| G02 | Every write is a direct, unmodified call to the originating feature's mutation. No business logic is duplicated |
| G03 | This feature performs no permission check of its own. Every item's visibility is a consequence of the calls it composes |
| G04 | `upcomingProbationReviews` never receives notice-period data, guaranteed by [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s role-scoped return rather than by filtering here |
| G05 | Delegation covers approval-type actions only. Performance assessments, milestone confirmations and interview feedback are never delegable |
| G06 | A delegation is time-bounded and stored on WorkspaceMembership rather than as a node type, consistent with how [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s preferences are held |
| G07 | Queue ordering is by age across all item types. No priority score across types is computed |
| G08 | Resolving an item here resolves it in [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox, because both call the same mutation |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F049-S01 | Action queue composition | Logic |
| VRS-F049-S02 | Inline action execution | Logic |
| VRS-F049-S03 | Team at a Glance | UI |
| VRS-F049-S04 | Approval delegation | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a manager has two pending leave requests, one timesheet anomaly and one burnout alert
**WHEN** they open the dashboard
**THEN** all four appear ordered by how long each has waited, each pulled from its own feature's manager-scoped query

---

**GIVEN** they clear a burnout alert from this screen
**WHEN** it completes
**THEN** the originating feature's own clearance fields are set exactly as if actioned from its own screen, since the same function was called

---

**GIVEN** a direct report is over 100% combined capacity
**WHEN** the queue renders
**THEN** the conflict appears and opens [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s own resolution panel rather than a duplicated one

---

**GIVEN** a manager's team has six pulse responses against a sensitive threshold of eight
**WHEN** Team at a Glance loads
**THEN** the trend is suppressed exactly as [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] would report, with no exception made here

---

**GIVEN** a direct report has an active Departure
**WHEN** the dashboard loads
**THEN** no notice-period data appears anywhere, verified by this feature never receiving it

---

**GIVEN** a manager nominates a delegate for a fortnight
**WHEN** the delegate opens their own dashboard during that period
**THEN** the delegating manager's approval items appear, labeled as delegated and separated from their own

---

**GIVEN** the same delegation
**WHEN** the delegate's queue is checked for performance assessments owed by the delegating manager
**THEN** none appear. Judgments about a person are never delegable

---

**GIVEN** a manager's queue is empty
**WHEN** the dashboard loads
**THEN** it states that nothing is waiting on them, and Team at a Glance renders normally

---

## Non-Functional Requirements

- The full composition resolves within 500ms for a manager with up to 15 direct reports
- Sections render as they resolve rather than blocking on the slowest
- Full functionality offline, including every inline action, since every composed feature supports it
- An inline action completes within its own feature's stated budget

---

## Security Considerations

- **This feature's entire security posture is inherited, not invented.** It has no permission logic of its own to get wrong, because it has none. Every guarantee proven correct in the thirteen features it composes holds here by construction.
- **The one place active verification was needed was [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]**, and composing it is exactly what surfaced that it had never guaranteed notice-period data would not reach a manager. Closed in that document, not worked around here.
- **Delegation is the one genuinely new capability**, and it is deliberately narrow. It transfers the authority to approve, never the authority to judge. A delegate approving leave is administratively sensible; a delegate writing a performance assessment about someone they do not manage is not.
- **A delegation is visible to HR Admin and audited.** Transferring approval authority for a fortnight is a fact worth being able to reconstruct.

---

## Out of Scope

- **Any new alerting or notification mechanism** — [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]. This is a pull, not a push
- **Cross-team or workspace-wide views** — a single manager's own team. An Owner equivalent is a different feature with a broader permission shape
- **A unified priority score across action types** — deliberately rejected. A burnout alert and a leave approval are not comparable on one scale, and forcing them onto one is false precision
- **Delegating judgment-type actions** — permanently excluded
- **Customizing which sections appear.** The queue is what a manager must handle; hiding a section is hiding an obligation

---

## Decisions Recorded

**Queue ordering is by age, not by type or by an assigned priority.** The failure this screen prevents is items sitting unhandled, and sorting by category buries a four-day-old leave request beneath a burnout alert raised this morning. Each row states its wait.

**Delegation is added, closing the gap [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] names.** A manager on leave for a fortnight otherwise leaves their team's approvals unactioned, with Owner and HR Admin as an awkward fallback.

**Delegation covers approvals only.** Transferring the authority to approve is administrative; transferring the authority to judge is not, and a delegate writing a performance assessment about someone they do not manage would be a worse outcome than a delayed review.

**An empty queue is stated as good news.** A manager who has handled everything should see that as an outcome rather than a blank screen.

**The boundary with [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] is stated as a difference in kind.** The Inbox reports what happened; this reports what is true. A burnout alert uncleared for three weeks is no longer news and is still a fact about the team.

---

## Related Notes

- [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] — the Inbox this composes alongside
- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — the query this feature's composition corrected
- [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] — the delegation gap closed here
- [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] — the employee-facing counterpart

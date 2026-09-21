---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Experience
aliases:
  - VRS-F034
---

# VRS-F034 — Employee Referral Program

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee, the referrer), [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (Candidate, and the pipeline a referral enters), [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] (probation confirmation, which gates the bonus), [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] (the panel a referrer must not sit on), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Referral), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (where the bonus is actually paid)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A structured path for an employee to refer someone they know, and for the agency to track that referral through to a hire and a bonus.

A Referral connects the referring employee to the candidate they introduced. It carries no money — **the bonus is a payroll adjustment**, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], which keeps a Tier 1 figure out of a node recruiters read daily.

---

## Problem It Solves

Referrals are the best source of hires most agencies have and the worst tracked. Someone mentions a former colleague in a corridor, a recruiter follows up or does not, and if a hire eventually happens the referrer's part in it is remembered informally or not at all.

**The bonus is where this fails most visibly.** An agency that announces a referral scheme and then pays someone four months late, or not at all, because nobody tracked which hire came from whom, has done more damage than having no scheme. The second referral never comes.

There is a second problem, less obvious and more corrosive. **A referrer sitting on the interview panel for their own referral is a conflict nobody in the room will name.** Most agencies handle this by hoping. This feature makes it structural.

---

## User-Facing Flows

### Making a referral

Any employee submits a referral from an open role, or unprompted: the person's name, email, a note on why, and optionally an attached CV.

**The form is short and available to everyone**, because a referral scheme reachable only through HR is a referral scheme nobody uses.

### What happens next

A Candidate is created at Applied with `source: Referral`, linked to the Referral record, and the recruiter sees where it came from and the referrer's note.

The referrer receives an acknowledgment immediately, and a status update at each meaningful stage: screening, interview, offer, hired or closed. **Not the detail** — never a scorecard, never a rejection reason — but enough that they are not left wondering whether anything happened.

### The panel exclusion

A referrer **cannot be assigned as a panelist** on an interview round for their own referral. Attempting it is refused, naming the referral.

They may still advocate, in the way people do, and they will. What they cannot do is score.

### The bonus

Where the referral results in a hire, a bonus becomes payable **on the referred employee's probation confirmation** per [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — not on their start date.

This is the standard structure and it exists for a reason: a referral bonus paid on day one rewards an introduction, and a bonus paid on confirmation rewards a good introduction. The two are different things and the agency is buying the second.

On confirmation, a payroll adjustment is raised against the referrer per [[VRS-F062_Payroll_Engine_Core|VRS-F062]], and the referrer is told.

Where the referred person leaves before confirmation, no bonus is payable and the referrer is told that too, plainly, rather than left to notice.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Refer someone | Modal, from anywhere | The submission |
| My referrals | Section in [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] | The referrer's own view |
| Referrals | Content | HR's view across the workspace |

### Layout and components

**Refer someone** is four fields — name, email, note, optional CV — in a Modal reachable from an open role, from the careers-page share action, and from the command palette. Making it reachable from three places is deliberate; a referral happens when someone thinks of a person, and that moment does not coincide with opening an HR screen.

Where the referral is against a specific role, that role is stated at the top and pre-filled.

**My referrals** is a compact list: the person's name, the role, a status Badge, and where a bonus is pending its condition — *Bonus on probation confirmation, expected March* — stated as a condition rather than a promise.

**Referrals** for HR is a Table: referred person, referrer, role, pipeline status, bonus status, referred date. Sorted by pipeline status so live referrals lead.

Bonus status is the column that matters, and it carries four values: **Not applicable**, **Pending confirmation**, **Payable**, **Paid**. Anything sitting at Payable for more than a payroll cycle renders `attention` — the failure this feature exists to prevent is a bonus everyone agreed to and nobody paid.

### Keyboard

`R` from an open role opens the referral modal. Standard list bindings elsewhere.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | An employee sees their own referrals and their status. Not the candidate record, not the feedback, not the rejection reason |
| Empty | *No referrals yet.* with **Refer someone** and a line naming the bonus condition where a policy exists |
| Blocked | Assigning a referrer to their own referral's panel is refused inline, naming the referral |
| Error | A referral for someone already in the pipeline surfaces the existing candidate and the earlier referrer, if any |

### Responsive

Works unchanged to 375px. A referral is frequently made on a phone, immediately after a conversation.

---

## Technical Architecture

### The Referral schema

Standard, Tier 0. **It carries no money.**

```
referral_id:        UUID v4
workspace_id:       UUID
referrer_employee_id: UUID, FK to Employee
candidate_id:       UUID, FK to Candidate
open_role_id:       UUID, nullable
referral_note:      text — why the referrer thinks this person is worth talking to
bonus_status:       enum: NotApplicable, PendingConfirmation, Payable, Paid
bonus_condition_met_at: timestamp, nullable — probation confirmation
payroll_adjustment_id:  UUID, nullable — set when VRS-F062 raises the adjustment
lifecycle_status:   enum: Active, Closed

— Universal Node Conventions per VPS-A002 —
```

**No bonus amount lives here.** The figure is a compensation adjustment on the referrer's payroll at Tier 1. A Referral node visible to a recruiter carrying a payment figure would be a Tier 1 leak on a Tier 0 record, and the amount is not information a recruiter needs.

The workspace's referral bonus amount, where a standard one exists, is a payroll policy value per [[VRS-F062_Payroll_Engine_Core|VRS-F062]], not a field here.

### The panel exclusion

`interviewRound.create` and any panelist addition check for a Referral connecting the proposed panelist to that candidate. A match refuses the assignment.

**Enforced at write, not in the interface.** An interface that grays out the option is an interface someone routes around; a refused write is not.

### Bonus lifecycle

```
Referral created                          -> NotApplicable
Referred candidate hired                  -> PendingConfirmation
Referred employee's probation confirmed   -> Payable
Payroll adjustment raised and disbursed   -> Paid
Referred employee departs before confirm  -> NotApplicable, referrer notified
```

The transition to Payable is reactive on [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s probation confirmation. **Where a workspace runs no probation period**, the condition falls back to ninety days from the start date, computed in working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].

### Referrer visibility

A referrer sees: their referral, its pipeline status at the coarse level, and their bonus status.

They do not see: the candidate record, interview feedback, scorecards, the rejection reason, or any other candidate.

**This is a narrow participant-scoped grant**, the same shape [[VPS-A004_Graph_Permission_Layer|VPS-A004]] establishes for panelists and onboarding assignees, not a widening of the recruitment permission row.

### API contracts

```
referral.submit(referrerEmployeeId, fullName, email, note, openRoleId?, cvFile?)
  -> { referralId, candidateId, duplicateOf? }
  // Creates the Candidate at Applied with source Referral

referral.listForEmployee(employeeId) -> {
  referralId, candidateName, roleTitle, coarseStatus, bonusStatus, bonusCondition
}[]
  // Coarse status only: Submitted, In progress, Offer, Hired, Closed

referral.listForWorkspace(workspaceId, bonusStatus?) -> Referral[]

referral.markBonusPaid(referralId, payrollAdjustmentId) -> { success }
  // Called by VRS-F062 on disbursement

interviewRound.checkReferralConflict(candidateId, panelistEmployeeIds)
  -> { conflicted: employeeId[] }
  // Called by VRS-F031 before any panelist assignment
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Referral carries the schema above and holds no monetary amount |
| G02 | `referred_by` connects Referral to the referring Employee; `referral_for` connects it to the Candidate |
| G03 | A referrer cannot be assigned as a panelist on an interview round for their own referral. Enforced at write, not in the interface |
| G04 | Bonus becomes Payable on probation confirmation per [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]], or 90 working days from start where no probation applies |
| G05 | Departure before the condition is met returns the bonus to NotApplicable and notifies the referrer |
| G06 | The bonus amount is a Tier 1 payroll adjustment per [[VRS-F062_Payroll_Engine_Core|VRS-F062]], never a field on Referral |
| G07 | A referrer's visibility is participant-scoped: their own referral, coarse pipeline status, and bonus status. Never candidate detail, feedback or rejection reasons |
| G08 | A referral for someone already in the pipeline surfaces the existing candidate through [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s duplicate detection |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F034-S01 | Referral schema and submission | Data |
| VRS-F034-S02 | Panel conflict enforcement | Security |
| VRS-F034-S03 | Bonus lifecycle and payroll handoff | Logic |
| VRS-F034-S04 | Referrer status view | UI |
| VRS-F034-S05 | HR referral overview | UI |

---

## Feature Acceptance Criteria

**GIVEN** an employee submits a referral
**WHEN** it is saved
**THEN** a Candidate exists at Applied with source Referral, linked to the Referral, and the referrer receives an immediate acknowledgment

---

**GIVEN** a referrer is proposed as a panelist for their own referral
**WHEN** the assignment is attempted
**THEN** it is refused at write, naming the referral, regardless of how the assignment was made

---

**GIVEN** a referred candidate is hired
**WHEN** the conversion completes
**THEN** bonus status becomes PendingConfirmation, and the referrer is told the condition and its expected date

---

**GIVEN** the referred employee's probation is confirmed
**WHEN** confirmation is recorded per [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]
**THEN** bonus status becomes Payable, a payroll adjustment is raised per [[VRS-F062_Payroll_Engine_Core|VRS-F062]], and the referrer is notified

---

**GIVEN** the referred employee departs before confirmation
**WHEN** the departure completes
**THEN** bonus status returns to NotApplicable and the referrer is told plainly rather than left to notice

---

**GIVEN** a referrer views their own referral
**WHEN** it renders
**THEN** they see a coarse status and their bonus condition, and no candidate record, feedback, scorecard or rejection reason

---

**GIVEN** a bonus has been Payable for longer than one payroll cycle
**WHEN** the HR referrals table renders
**THEN** it renders `attention`, since an agreed and unpaid referral bonus is the failure this feature exists to prevent

---

**GIVEN** a referral is submitted for someone already in the pipeline
**WHEN** it is saved
**THEN** [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s duplicate detection surfaces the existing candidate and any earlier referrer to the recruiter

---

## Non-Functional Requirements

- Referral submission completes within 2 seconds including CV upload
- The referrer's own view resolves within 200ms from the local graph
- Panel conflict checking completes within 100ms and never delays panel assignment perceptibly
- Full functionality offline for submission and viewing

---

## Security Considerations

- **Referral carries no monetary amount**, keeping a Tier 1 figure off a Tier 0 node that recruiters read daily.
- **A referrer's visibility is participant-scoped and coarse.** They introduced someone; they are not part of the hiring process. Showing them a rejection reason would put an employee in the position of explaining the agency's decision to a friend, which is unfair to both.
- **The panel exclusion is enforced at write.** A grayed-out option is routed around by anyone determined enough; a refused write is not.
- **A referral discloses a relationship.** That an employee knows a candidate well enough to refer them is visible to recruiters and to HR, which is unavoidable and correct. It is not visible to other employees, and the referrer's note — frequently personal — is HR-restricted.
- **A declined referral is a conversation between two people the agency is not part of.** The referrer is told the outcome and nothing more, and the candidate is never told who referred them unless the referrer chose to tell them, which is not this product's business.

---

## Out of Scope

- **Referral bonus amounts and their payment** — [[VRS-F062_Payroll_Engine_Core|VRS-F062]]. This feature owns the condition and the trigger
- **Tiered or role-varied bonus structures** — a payroll policy question, not a recruitment one
- **A public referral link an employee can share** — reasonable later; the careers page already carries a share action
- **Referral leaderboards or gamification.** Deliberately excluded: ranking colleagues by how many friends they have recruited is a culture this product should not manufacture
- **External referrals from outside the workspace** — this feature is for employees

---

## Decisions Recorded

**This feature is new.** Referrals were referenced three times across the previous set with no feature owning them.

**The bonus vests on probation confirmation, not on hire.** A bonus paid on day one rewards an introduction; a bonus paid on confirmation rewards a good one, and the agency is buying the second. Where no probation exists, ninety working days is the fallback.

**The panel exclusion is structural.** A referrer scoring their own referral is a conflict every agency handles by hoping, and it costs nothing to prevent.

**The Referral node holds no amount**, per the decision recorded in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. The figure is a payroll adjustment at Tier 1.

**Referrer visibility is coarse and participant-scoped.** Telling a referrer why their friend was rejected puts an employee in the position of explaining the agency's decision to someone they know, which is unfair to both and is not information the agency should hand over.

**Leaderboards are excluded deliberately** rather than deferred. Ranking colleagues by how many people they have recruited manufactures a competitive dynamic around personal relationships, and an agency wanting it can count the rows.

**Departure before vesting notifies the referrer.** A bonus that silently stops being payable is how a referral scheme loses the trust that made it work.

---

## Related Notes

- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline a referral enters
- [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] — the panel a referrer may not join
- [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] — the probation confirmation that vests the bonus
- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — where the bonus is paid

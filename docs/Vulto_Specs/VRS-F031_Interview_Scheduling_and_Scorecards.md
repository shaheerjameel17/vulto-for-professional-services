---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F031
---

# VRS-F031 — Interview Scheduling and Scorecards

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (Candidate), [[VRS-F030_Candidate_Portal|VRS-F030]] (the token-based access surface this feature extends rather than duplicates), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (working days — slots are not proposed on non-working ones), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (InterviewRound and FeedbackEntry), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the participant-scoped grant)
**Blocks:** Nothing structurally. [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] reads the feedback this feature accumulates.

This document is the single source of truth for this feature.

---

## What It Is

Structured, multi-panelist interview rounds. An HR Admin creates a round, assigns panelists, and proposes candidate time slots. The candidate picks one through [[VRS-F030_Candidate_Portal|VRS-F030]]'s existing portal.

**Each panelist submits their own independent scorecard afterwards** — a rating, strengths, concerns and a recommendation — rather than one person's notes standing in for the whole panel's judgement.

---

## Problem It Solves

A single interviewer's notes and a single number collapse a panel's actual judgement into one impression, and say nothing about **where panelists disagreed** — which is frequently the most useful signal a hiring decision has. A unanimous Yes and a split between StrongYes and No are entirely different situations, and averaging them produces the same number.

Scheduling by email — *does Tuesday at two work* — repeated per candidate per round, is slow and error-prone in a way a self-service picker is not. It is also where candidates are lost: a three-day exchange to find a slot is three days a competing offer has to land.

---

## User-Facing Flows

### Creating a round and proposing slots

An HR Admin creates a round for a candidate, selects panelists, and proposes several time slots.

**Slots are checked against two things before they are offered.** They must fall on a working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] for the panelists' entity — proposing a Friday slot to a Dubai panel wastes a round trip. And they are checked against every panelist's other scheduled InterviewRounds, so a slot where two of three panelists are already committed is flagged before the candidate ever sees it.

This is not calendar integration. It is the conflict check this product can perform honestly with the data it already holds.

### The candidate self-schedules

The candidate opens their existing [[VRS-F030_Candidate_Portal|VRS-F030]] link. Where a round has slots awaiting selection they appear there — same surface, no separate link, no login.

**Slots render in the candidate's own time zone**, detected from their browser and stated explicitly on screen: *Tuesday 14:00 — your time (09:00 London)*. A candidate in Karachi offered a slot in London time will either mis-read it or spend twenty minutes converting, and the first of those is how interviews get missed.

Selecting a slot sets the round's scheduled time immediately.

### Each panelist submits independently

After the round, every assigned panelist submits their own FeedbackEntry, **visible only to them until submitted**, then visible to whoever already has access to the round.

One rating never averages or overwrites another. Each stands on its own.

### Reviewing the panel

An HR Admin sees every submitted entry side by side, with disagreement visible as itself a useful fact rather than smoothed into an average that hides it.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Round setup | Panel, from the candidate record | Panelists and slots |
| My interviews | Content | A panelist's own rounds and pending scorecards |
| Scorecard | Panel | One panelist's submission |
| Panel summary | Panel, from the candidate record | Everyone's judgement, side by side |
| Slot selection | Within [[VRS-F030_Candidate_Portal|VRS-F030]]'s portal | The candidate's choice |

### Layout and components

**Round setup** collects round number, type, panelists through an employee picker, and slots through a repeated DatePicker and time input.

Each proposed slot renders with an inline conflict indicator: `success` where every panelist is free, `attention` naming who is not. A slot on a non-working day is refused with the reason. The conflict check is advisory on panelist availability and blocking on working days — the first is a scheduling preference, the second is a fact.

**My interviews** is the panelist's own surface: upcoming rounds as Cards with candidate name, role, time and location, and beneath them a **Pending scorecards** section. A pending scorecard past its round date renders `attention`, because an unsubmitted scorecard is the most common thing that stalls a hiring decision.

**The scorecard** is deliberately short: a 1–5 rating as a Toggle Group, strengths and concerns as Textareas, and a recommendation as four options — StrongYes, Yes, No, StrongNo — rendered as distinct Cards rather than a Select, because the choice deserves a moment's thought.

Submission is final and the interface says so before confirming. A scorecard is a deliberate judgement, not a draft.

**Panel summary** is a column per panelist, side by side: their rating, recommendation Badge, strengths and concerns in full. No average, no aggregate score, no consensus indicator.

**Where recommendations diverge, that divergence is stated in a line above the columns** — *Panel is split: 1 StrongYes, 1 No* — because the fact that this is a contested decision is what the reader most needs to know before reading the detail.

### Keyboard

Standard bindings. `1`–`5` set a rating on a focused scorecard.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton cards |
| Restricted | A panelist sees rounds they sit on and nothing else. Their own unsubmitted scorecard is invisible to everyone including HR Admin |
| Empty | *No interviews scheduled.* on the panelist surface |
| Conflict | Inline `attention` on the proposed slot naming the unavailable panelist |
| Error | A second scorecard submission is refused, naming the existing one |

### Responsive

The panel summary stacks to one column per panelist below 1024px. `My interviews` works unchanged to 375px — a panelist checking their next interview on a phone is the normal case.

---

## Technical Architecture

### InterviewRound

HR-restricted, Tier 2.

```
interview_round_id: UUID v4
workspace_id:       UUID
candidate_id:       UUID, FK to Candidate — a direct field
round_number:       integer
round_type:         enum: Screening, Technical, Panel, Final, Other
proposed_slots:     JSON array of { slot_id, start_time, duration_minutes }
scheduled_at:       timestamp, nullable — set on candidate selection
duration_minutes:   integer, default 60
location_or_link:   string, nullable
status:             enum: ProposingSlots, Scheduled, Completed, Canceled, NoShow

— Universal Node Conventions per VPS-A002 —
```

### FeedbackEntry

HR-restricted, Tier 2.

```
feedback_entry_id:  UUID v4
workspace_id:       UUID
interview_round_id: UUID, FK — a direct field
interviewer_id:     UUID, FK to Employee
rating:             integer, 1–5
strengths:          text, nullable
concerns:           text, nullable
recommendation:     enum: StrongYes, Yes, No, StrongNo
submitted_at:       timestamp, nullable — null until submitted

— Universal Node Conventions per VPS-A002 —
```

At most one entry per round and interviewer pair. A panelist has exactly one scorecard per round they sat on.

### Slot conflict checking

Two checks, different in kind:

**Working day** — every proposed slot must fall on a working day for the panelists' entity per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]. Blocking, because a slot on a day the office is closed is not a slot.

**Panelist availability** — each slot is checked against every panelist's other InterviewRounds in Scheduled status. Advisory, because a panelist may genuinely be free between two interviews and only they know.

**This is deliberately not calendar integration.** Reading an interviewer's actual calendar requires a third-party integration this product has not decided on. Rather than guess at that, this feature solves the tractable half — a candidate picking from a proposed set — without pretending to solve calendar sync.

### Time zones

Slots are stored as UTC timestamps. The candidate portal renders them in the browser's detected zone **and states both that zone and the workspace's**, so a mismatch is visible rather than assumed. The panelist surface renders in the panelist's own `timezone` per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], falling back to the workspace's.

### Extending [[VRS-F030_Candidate_Portal|VRS-F030]]'s surface

The candidate reaches slots through the exact JWT that feature issues, unchanged. Two endpoints are added under that token. **No second candidate authentication is introduced.**

### API contracts

```
interviewRound.create(candidateId, roundNumber, roundType, panelistEmployeeIds)
  -> { interviewRoundId }
  // Creates a participating_in edge per panelist

interviewRound.proposeSlots(interviewRoundId, slots) -> {
  accepted: SlotId[],
  rejected: { slot, reason: 'nonWorkingDay' }[],
  conflicts: { slot, unavailablePanelists }[]
}

candidatePortal.getProposedSlots(token) -> {
  slots: { slotId, startTime, durationMinutes }[],
  candidateTimezone, workspaceTimezone
} | { error: 'invalid' }

candidatePortal.selectSlot(token, slotId) -> { success }
  // Sets scheduled_at; status becomes Scheduled

feedbackEntry.submit(interviewRoundId, rating, strengths?, concerns?, recommendation)
  -> { feedbackEntryId }
  // interviewer_id is the caller's own Employee record.
  // Rejected where an entry already exists for this round from this interviewer

interviewRound.getPanelSummary(interviewRoundId) -> {
  round, feedbackEntries, divergence: { isSplit, distribution }
}
  // Owner, HR Admin, and any Employee with a participating_in edge to
  // this specific round

feedbackEntry.listPendingForInterviewer(employeeId) -> {
  interviewRoundId, candidateName, scheduledAt, isOverdue
}[]
  // Scoped entirely to the caller's own participation
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | InterviewRound and FeedbackEntry carry the schemas above |
| G02 | `interview_for`, `participating_in` and `has_feedback` connect this feature's nodes as registered. No new edge type |
| G03 | At most one FeedbackEntry per round and interviewer. Resubmission is rejected, never silently overwritten |
| G04 | The candidate-facing endpoints validate against [[VRS-F030_Candidate_Portal|VRS-F030]]'s JWT unmodified. No new candidate authentication |
| G05 | An unsubmitted FeedbackEntry is visible to its own interviewer only, including to Owner and HR Admin |
| G06 | Proposed slots must fall on a working day per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] for the panelists' entity. Panelist conflicts are advisory |
| G07 | Slots are stored UTC and rendered in the viewer's own zone, with both zones stated on the candidate surface |
| G08 | Panel summaries never compute an average rating or a consensus score |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F031-S01 | InterviewRound and FeedbackEntry schemas | Data |
| VRS-F031-S02 | Panel configuration and slot conflict checking | Logic |
| VRS-F031-S03 | Candidate self-scheduling | Logic |
| VRS-F031-S04 | Independent scorecard submission | UI |
| VRS-F031-S05 | Panel summary with divergence | UI |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin creates a round with two panelists and proposes three slots
**WHEN** the candidate opens their portal link
**THEN** the three slots appear, rendered in their own time zone with both zones stated, and selecting one sets the scheduled time

---

**GIVEN** a proposed slot falls on a Friday for a UAE-scoped panel
**WHEN** slots are proposed
**THEN** it is rejected with the reason, per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]

---

**GIVEN** two of three panelists already have a scheduled round at a proposed time
**WHEN** slots are proposed
**THEN** the conflict is shown naming both, and the slot may still be offered

---

**GIVEN** two panelists submit independently
**WHEN** both submit
**THEN** two separate entries exist, neither overwriting the other, and no average is computed anywhere

---

**GIVEN** one panelist recommends StrongYes and the other No
**WHEN** the panel summary renders
**THEN** the split is stated above the columns as a fact, with no aggregate score

---

**GIVEN** a panelist has drafted but not submitted their scorecard
**WHEN** an HR Admin opens the panel summary
**THEN** that entry is absent, not shown as pending with partial content

---

**GIVEN** a panelist attempts a second submission for the same round
**WHEN** it is attempted
**THEN** it is rejected. One panelist, one scorecard

---

**GIVEN** a Team Member with no elevated role is a panelist
**WHEN** they open that round
**THEN** access is granted per the participant-scoped grant, while every other round remains structurally absent to them

---

## Non-Functional Requirements

- Panel summary and slot selection resolve within 200ms from the local graph
- Slot conflict checking completes within 200ms across up to five panelists
- Panel configuration and internal review function offline. Candidate slot selection requires connectivity

---

## Security Considerations

- **The participant-scoped grant is narrow and deliberate.** It grants read on one round and full on one scorecard, to the exact employee assigned, regardless of role. A Team Member on one panel gains no visibility into any other candidate's process.
- **An unsubmitted scorecard is private to its author, including from Owner.** A half-written concern read by a manager before the interviewer had finished thinking would change what interviewers are willing to write, which destroys the value of the record.
- **No average is computed, anywhere.** This is a product decision with a security dimension: an average creates a single number that reads as objective, gets quoted in a rejection conversation, and obscures which specific person dissented — which is exactly the information a disagreement is worth having.
- **Feedback content is never exposed to the candidate**, per [[VRS-F030_Candidate_Portal|VRS-F030]]'s structural exclusion.

---

## Out of Scope

- **Calendar integration or automatic availability detection.** Slots are entered manually and checked against internal rounds only
- **Video conferencing integration.** `location_or_link` is a plain string
- **Averaging or aggregating ratings** — deliberately not built
- **Scorecard templates per round type.** One structure for every round, so that [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] can compare across them
- **Interviewer training or calibration** — a real practice, and not software

---

## Decisions Recorded

**Slot proposal now checks working days and panelist conflicts.** The previous specification proposed slots blind, which meant an HR Admin could offer a Friday to a Dubai panel or a time when two of three panelists were already interviewing someone else — both discovered by the candidate.

**Time zones are stated explicitly on the candidate surface.** The previous specification did not address them at all. A candidate in Karachi offered a slot in London time will either misread it or spend twenty minutes converting, and the first is how interviews get missed.

**Divergence is surfaced as a statement, not left to be read from the columns.** The single most useful fact a panel summary carries is whether the panel agreed, and it should not require comparing four Badges to discover.

**[[VRS-F028_Recruitment_Pipeline|VRS-F028]] removed `interview_notes` and `interview_rating` rather than deprecating them**, since neither feature had shipped and no workspace holds data in them. The previous specification's careful deprecation and non-migration language is therefore unnecessary and is removed.

**Scorecard templates are excluded.** A different structure per round type would make [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] unable to compare a technical round against a final round, which is one of the more useful things it could tell an agency.

---

## Related Notes

- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline these rounds sit within
- [[VRS-F030_Candidate_Portal|VRS-F030]] — the access surface this feature extends
- [[VRS-F032_Offer_Management|VRS-F032]] — the offer that follows a positive panel
- [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] — the analytics reading this feedback

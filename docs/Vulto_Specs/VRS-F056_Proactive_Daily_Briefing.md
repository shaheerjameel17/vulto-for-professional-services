---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Experience
aliases:
  - VRS-F056
---

# VRS-F056 — Proactive Daily Briefing

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** Nearly every feature built so far, read not written — [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (timezone, personalizing each user's own today), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (notification read state, reused rather than a second freshness mechanism), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (documents, for interview enrichment), [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] (**and the independence guarantee this feature must actively protect**), [[VRS-F049_Manager_Dashboard|VRS-F049]] (whose action queue this reuses rather than reimplements), [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] (Insights, displayed never re-derived)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What this refuses to be

Not a bigger version of [[VRS-F049_Manager_Dashboard|VRS-F049]]'s queue with a new name. Not a dashboard that shows everything and calls the resulting length comprehensive.

**The test held here is narrower and harder: could a person read this in under thirty seconds and know exactly what today requires of them, with the context needed to act rather than a link to go find it.** If a section does not clear that bar it does not belong, however easy it would be to add.

This is why the feature is deliberately short on sections. The temptation would have been to compose the same fourteen sources again and call it a briefing. **A briefing that takes real judgment about what to leave out is more useful than one that includes everything and asks the reader to do the prioritizing** — which is exactly the job this feature exists to do instead.

---

## The boundary with [[VRS-F049_Manager_Dashboard|VRS-F049]] and [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]

Three surfaces now show a person things needing attention, and the distinction has to be real or two of them are redundant.

**[[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox** is the cross-role, event-driven stream. It reports *what happened*.

**[[VRS-F049_Manager_Dashboard|VRS-F049]]** is a manager's persistent current-state command center, scoped to running a team. It reports *what is true right now* about their reports.

**This feature answers a question neither does: what does today, specifically, require of me.** It is the only one of the three that is date-scoped, the only one personalized by the reader's own time zone, and the only one that is a daily artifact rather than a continuously current view.

Its Needs Your Action section reuses [[VRS-F049_Manager_Dashboard|VRS-F049]]'s composition directly rather than reimplementing it, personalized to whatever role the reader actually holds.

---

## What It Is

A personalized, self-scoped view, computed fresh every time it opens, built from three things and nothing else: **what is scheduled for today**, by name and time; **what needs this person's action**, ranked by how long it has waited; and **what is new since they last looked**, as an honest count.

---

## Problem It Solves

Fourteen features each correctly decided what a person should see and when. Nobody checks fourteen things every morning, and a notification feed firing throughout the day is a different problem from *what does today look like*.

This is the answer to a question nothing else answers: not what happened, not what is pending everywhere, but **what does today require of me, and what do I need in hand to handle it.**

---

## Interface Specification

### Screen

Content region, reached at `G` then `T`, and from the single daily prompt [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] sends per the reader's own timezone.

### Layout

Three sections, in this order, deliberately. **Nothing else.**

**Today** — anything with a specific date falling on the reader's own calendar day: an interview they are on the panel for, someone on their team starting or ending leave, an onboarding task due, a review due, a contractor term or certification expiring, a probation review due.

Each item carries the context needed to act rather than a bare link. An interview shows the candidate, the role and their CV. A probation review shows the review context from [[VRS-F057_Probation_Review_Intelligence|VRS-F057]] inline.

**Needs Your Action** — every pending item, ordered by how long it has waited, with the wait stated. A strain signal uncleared for twelve days appears above one raised yesterday.

**New Since Yesterday** — a single line, collapsed: *4 new items since you last checked.* Expandable. **Never longer than one line unless the reader expands it.**

### Components

Today items are Cards with the context inline. Needs Your Action is a list of rows, each stating the item, its age in days, and its inline action. New Since Yesterday is one line.

**A genuinely quiet day renders as a quiet day.** *Nothing scheduled. Nothing waiting on you.* No padding, no filler, no unrelated content added to avoid looking sparse. A briefing that manufactures content on an empty day is a briefing nobody trusts on a full one.

### Keyboard

`J`/`K` move between items across sections. `Enter` performs an inline action.

### System states

| State | Treatment |
|---|---|
| Syncing | Sections render as they resolve |
| Restricted | Every item's visibility is inherited. This feature filters nothing itself |
| Empty | Stated plainly per section |
| Error | A failed inline action states the reason and leaves the item |

### Responsive

Works unchanged to 375px. This is a surface read on a phone before a laptop is open.

---

## Technical Architecture

### No new node type

Composed at request time from three kinds of existing data: date-scoped records already carrying a scheduled or due date, [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s notification read state, and each source feature's own pending-action queries — most of which [[VRS-F049_Manager_Dashboard|VRS-F049]] already exposes and this reuses directly.

### Today, personalized per user

A reader's *today* is computed against their own `timezone` per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], not a workspace-wide cutoff. **Two colleagues in different time zones see different boundaries for the same events, correctly** — and for a product whose target market spans Karachi, Dubai and London, that is the ordinary case rather than an edge one.

Where a reader has no timezone set, the workspace default applies.

### Why prior interview feedback is withheld until after submission

The one place this feature needed real thought rather than composition.

[[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] established that each panelist submits independently, precisely so one person's opinion does not anchor another's. **Surfacing a colleague's rating here before the reader's own interview would have quietly defeated that** — through a feature with no intention of touching that design at all.

The fix is a strict ordering rule, not a permission change: this feature checks whether the reader has already submitted their own feedback for that round before including any other panelist's content. Enforced structurally.

### Age-ordered, not scored

Needs Your Action orders by elapsed time since creation — **a plain, inspectable number, not a composite priority score with no stated basis.** The same honesty [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] applies to combination, extended to ordering.

### API contracts

```
briefing.getToday(userId) -> {
  today: {
    interviews: { candidateName, roleTitle, cvDocumentId,
                  priorFeedbackAvailable: boolean }[],
      // priorFeedbackAvailable is only ever true once the reader has
      // submitted their own for that round
    leaveEvents: { employeeName, leaveType, event: 'starting' | 'ending' }[],
    onboardingTasksDue: { title, employeeName }[],
    reviewsDue: { employeeName, type: 'self' | 'manager' }[],
    transitionsDue: { employeeName, type, contextAvailable: boolean }[]
  },
  needsYourAction: {
    itemType, description, ageInDays, sourceFeature
  }[],  // ordered by ageInDays descending
  newSinceYesterday: { count, items?: Notification[] }
}
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type. Every item is composed from existing data |
| G02 | Every item's visibility is inherited from its source feature's rule. This feature performs no independent permission check and widens nothing |
| G03 | Another panelist's feedback is included only when the reader has already submitted their own for that round. Enforced structurally, not by UI convention |
| G04 | `needsYourAction` is ordered by age computed from each item's own creation. Not a composite score |
| G05 | This feature combines no already-interpreted alerts into new meaning. It composes and orders, remaining outside Standing Rule 7 for the same reason [[VRS-F049_Manager_Dashboard|VRS-F049]] does |
| G06 | A reader's today is computed against their own `timezone`, falling back to the workspace default |
| G07 | An empty section renders as empty. No content is substituted to avoid sparseness |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F056-S01 | Personalized Today composition | Logic |
| VRS-F056-S02 | Interview enrichment with independence preservation | Logic |
| VRS-F056-S03 | Age-ordered action list | Logic |
| VRS-F056-S04 | New Since Yesterday summary | UI |

---

## Feature Acceptance Criteria

**GIVEN** a reader is on an interview panel scheduled today
**WHEN** the briefing loads
**THEN** the candidate, role and CV appear, and no other panelist's feedback appears unless the reader has already submitted their own

---

**GIVEN** they then submit their own feedback and reload
**WHEN** it renders
**THEN** other panelists' submitted content becomes available

---

**GIVEN** two colleagues in Karachi and London have events at the same UTC instant
**WHEN** each opens their briefing
**THEN** each sees it under whichever of their own local days it falls on

---

**GIVEN** a manager has one strain signal uncleared for 12 days and another raised yesterday
**WHEN** Needs Your Action renders
**THEN** the 12-day item appears first, ordered strictly by age with the wait stated

---

**GIVEN** a probation review is due today
**WHEN** Today renders
**THEN** [[VRS-F057_Probation_Review_Intelligence|VRS-F057]]'s context appears inline rather than as a link

---

**GIVEN** a Team Member with nothing scheduled and nothing pending
**WHEN** the briefing loads
**THEN** both sections are genuinely empty and shown as such, with no substituted content

---

**GIVEN** a reader has 4 unread notifications since their last visit
**WHEN** the briefing loads
**THEN** New Since Yesterday shows the count on one line, collapsed

---

## Non-Functional Requirements

- The full briefing composes within 500ms from the local graph
- Full functionality offline
- No two readers, even in the same role, ever see an identical briefing unless their underlying data is identical

---

## Security Considerations

- **This feature introduces no permission logic.** Every item's visibility is a consequence of its source feature's rule. A manager sees exactly what [[VRS-F049_Manager_Dashboard|VRS-F049]] would show; an Owner sees exactly what [[VRS-F053_Retention_Risk_Indicator|VRS-F053]] and [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] already permit.
- **The interview-independence rule is the one place this feature actively protects a guarantee rather than inheriting one**, and it is enforced structurally per G03, not left as a UI suggestion a future change could quietly ignore. It is also the exact class of failure this whole specification pass exists to catch: a feature with no intention of touching another's design, undoing it by composition.
- **[[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]]'s Insights are displayed at their own `effective_tier`.** This feature never re-derives an Insight and never displays one the reader could not see on its own surface.

---

## Out of Scope

- **Any section beyond the three** — not a widget framework. A fourth is a product decision requiring the same scrutiny, not a toggle
- **External calendar integration** — everything in Today derives from data scheduled inside this product
- **Push delivery beyond [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s single daily prompt** — this feature does not reach a reader outside the product
- **User-customizable sections or ordering** — the premise is that the right thing to show is already known, not left to configuration
- **A weekly or monthly variant.** Daily, or nothing. A weekly briefing is a report, and reports are [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]]'s

---

## Decisions Recorded

**The name drops *Intelligence*.** The feature composes and orders; it derives nothing. [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] is where intelligence happens, and two features carrying the word would blur which one carries the obligations that come with it.

**The three-way boundary with [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] and [[VRS-F049_Manager_Dashboard|VRS-F049]] is stated explicitly.** Three surfaces showing pending items needs a real distinction: what happened, what is true now, what today requires. This is the only one that is date-scoped and timezone-personalized.

**Needs Your Action reuses [[VRS-F049_Manager_Dashboard|VRS-F049]]'s composition** rather than reimplementing it, which also means a change to that queue's ordering propagates here rather than the two drifting.

**A quiet day renders quiet.** A briefing that manufactures content on an empty day is one nobody trusts on a full one.

**Probation review context renders inline** rather than as a link, per this feature's own thirty-second test: an item requiring a click to become actionable has failed it.

---

## Related Notes

- [[VRS-F049_Manager_Dashboard|VRS-F049]] — the queue this reuses
- [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] — the daily prompt and read state
- [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] — the independence guarantee this feature protects
- [[VRS-F055_Vulto_Roster_Intelligence_Engine|VRS-F055]] — the Insights displayed here

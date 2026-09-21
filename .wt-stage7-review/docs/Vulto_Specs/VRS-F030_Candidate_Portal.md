---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Experience
aliases:
  - VRS-F030
---

# VRS-F030 — Candidate Portal

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (Candidate's schema, unchanged by this feature), [[VRS-F021_E-Signature_Native|VRS-F021]] (the token-based access pattern, reused for a different purpose), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (email delivery)
**Blocks:** Nothing structurally, though [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] adds self-scheduling to this access surface rather than building a second one.

This document is the single source of truth for this feature.

---

## What It Is

A no-account status view for anyone in [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s pipeline.

A candidate receives a persistent secure link the moment they enter a pipeline, and can check their status at any time **without ever creating a Vulto account** — the same reasoning [[VRS-F021_E-Signature_Native|VRS-F021]] applies to a signatory who should not need one either.

---

## Problem It Solves

A candidate's honest experience of most hiring pipelines is silence. They applied, and then nothing, until someone eventually emails one way or the other.

Whether that silence is three days or three weeks it is the same anxious not-knowing, and it costs agencies good candidates who accept a competing offer from somewhere that at least told them what was happening.

**This replaces silence with an honest current status**, without asking a candidate to manage another account for a process that for most of them ends in a single outcome either way.

There is a second reason, and it matters to the agency more than the first. [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s bulk rejection exists so that the thirty-seven candidates an agency did not interview are formally closed rather than simply never hearing anything. **This feature is what makes that closure reach them.** Without it, bulk rejection is a database operation nobody outside the agency observes.

---

## User-Facing Flows

### Receiving access

The moment a candidate enters the pipeline — added manually, applying through [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]], or referred — they receive an email with a persistent status link. No account, no password. The link is the credential.

### Checking status

Opening it shows a friendly external status label, **never the internal pipeline terminology** a recruiter sees, alongside the role title and when it last changed.

### Being notified

A candidate does not have to remember to check. Any change to their stage or status sends an email carrying the same persistent link, so checking is a choice rather than a requirement.

### Reaching an offer

At Offer stage the portal shows the terms [[VRS-F032_Offer_Management|VRS-F032]] recorded — role, compensation, start date — because that is the candidate's own information being shown back to them.

### A closed outcome

Hired or Rejected, the link continues to resolve to a final honest status rather than breaking. A rejection shows a plain respectful message and **never the internal rejection reason or detail.** That is the agency's own record.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Status | Public, no shell | One page, one status |

### Layout

A single centered column, maximum 480px, on `bg-canvas`. The workspace's logo and name at the top, then the role title at `h2`, then the status.

**The status is the largest element on the page**, set at `display`, with the date it last changed beneath at `small`. Beneath that, one line of plain prose describing what that status means and what happens next, where anything does.

There is no progress bar and no stage tracker. A five-step tracker showing a candidate on step two tells them how far they are from an outcome they may not reach, and turns a status check into a measurement of distance from disappointment. One clear statement is kinder and more accurate.

At Offer stage the terms render in a `raised` Card beneath — role, compensation, start date — with no action. **The portal is read-only in both directions**; accepting an offer is a conversation with a person.

Where [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] has scheduling available, its action appears here as a `primary` button rather than in a second surface.

### System states

| State | Treatment |
|---|---|
| Restricted | Not applicable — a candidate sees only their own record |
| Invalid or expired | A plain page directing them to contact the agency, with the workspace name. Never a raw error |
| Closed | A final status renders normally. The link does not break |
| Error | A generic failure page. No detail that could indicate whether a candidate record exists |

### Responsive

Mobile-first, fully functional at 375px. This page is opened on a phone more often than not, frequently repeatedly, by someone who is anxious.

---

## Technical Architecture

### No new node type and no new fields

This feature reads [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s Candidate schema and adds nothing. Its access token is stateless, generated on demand, never stored in the graph.

### The access token

A JWT signed with the application's private key carrying `{ candidateId, workspaceId, exp }`.

Unlike [[VRS-F021_E-Signature_Native|VRS-F021]]'s signing link, which is short-lived and single-purpose, **this token is long-lived — 180 days — and reusable.** The same link works every time rather than a new one being issued per check, because a candidate who bookmarked it three weeks ago should find it still works.

**Validity depends on a live check against current status**, not the token alone. A technically unexpired token for a candidate hired four months ago shows Hired, not a stale in-progress state.

### External status mapping

| Internal | External |
|---|---|
| Applied | Application received |
| Screening | Under review |
| Interview | Interview stage |
| Offer | Offer extended |
| Hired | Welcome aboard |
| Rejected | A plain respectful closing message |
| Withdrawn | Application withdrawn |

Each carries one line of prose describing what it means. *Under review* alone tells a candidate nothing they did not know.

### What is never exposed

`rejection_reason`, `rejection_detail`, every FeedbackEntry per [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]], every InterviewRound score, `linked_candidate_ids` and the existence of any prior application.

**Structurally excluded, not filtered by a conditional the portal's own code could later loosen.** The response type does not contain these fields, so an engineer extending the portal cannot include one by accident.

The last of these is worth naming: a candidate must not learn from this portal that the agency has connected their current application to a rejection two years ago.

### Not governed by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]

That document governs authenticated workspace members. A candidate holds no User node and no membership.

This is a separate narrowly-scoped token-authenticated public endpoint — the same architectural category as [[VRS-F021_E-Signature_Native|VRS-F021]]'s signing link and [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]]'s careers page.

### API contracts

```
candidatePortal.generateAccessLink(candidateId) -> { url }
  // Reactive on candidate creation

candidatePortal.getStatus(token) -> {
  workspaceName, workspaceLogo,
  roleTitle,
  externalStatusLabel, statusDescription,
  lastUpdated,
  offerDetails?: { roleTitle, compensation, startDate },
  schedulingAction?: { url }
} | { error: 'invalid' }
  // Public. Validated by signature plus a live status check.
  // The error case is deliberately undifferentiated

candidatePortal.notifyStatusChange(candidateId) -> { success }
  // Reactive on any stage or lifecycle change
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type and no field. It reads [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s Candidate |
| G02 | The access token is stateless and never stored in the graph |
| G03 | Rejection reason and detail, interview feedback, scores, and linked prior applications are never included in any response. Structurally excluded from the response type, not filtered |
| G04 | Validity requires a valid signature **and** a live check against current status. An unexpired token always reflects present state |
| G05 | The error response is undifferentiated. Invalid, expired and non-existent produce an identical response |
| G06 | The portal is read-only. No action a candidate takes here changes their record, excepting [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]]'s scheduling where present |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F030-S01 | Token generation and validation | Security |
| VRS-F030-S02 | External status mapping | Logic |
| VRS-F030-S03 | Status change notification | Logic |
| VRS-F030-S04 | Portal view including offer detail | UI |

---

## Feature Acceptance Criteria

**GIVEN** a candidate enters the pipeline
**WHEN** they are created
**THEN** an access link is generated and emailed, and opening it shows *Application received* with no account required

---

**GIVEN** a candidate's stage changes from Screening to Interview
**WHEN** the change saves
**THEN** a notification is sent with the same persistent link, and opening it shows *Interview stage*

---

**GIVEN** a candidate reaches Offer
**WHEN** the portal opens
**THEN** the terms [[VRS-F032_Offer_Management|VRS-F032]] recorded are shown, with no action available

---

**GIVEN** a candidate is rejected with an internal reason and detail recorded
**WHEN** the portal opens
**THEN** a plain respectful closing message appears, and neither the structured reason nor the detail is present anywhere in the response

---

**GIVEN** a candidate whose current application is linked to a rejection from two years ago
**WHEN** the portal opens
**THEN** nothing indicates that a prior application exists or has been linked

---

**GIVEN** a token still within its 180-day expiry for a candidate hired four months ago
**WHEN** the link opens
**THEN** it shows Hired, since validity depends on a live status check

---

**GIVEN** a modified token carrying another candidate's identifier
**WHEN** it is submitted
**THEN** signature validation fails and the undifferentiated error response is returned

---

**GIVEN** thirty candidates are bulk-rejected per [[VRS-F028_Recruitment_Pipeline|VRS-F028]]
**WHEN** the rejections complete
**THEN** thirty notifications are sent, each reaching a person who would otherwise have heard nothing

---

## Non-Functional Requirements

- `getStatus` resolves within 500ms
- The page renders within 1 second on a mobile connection
- The token is scoped to exactly one candidate and cannot be modified to reach another
- The endpoint requires connectivity. There is no offline mode for someone with no local graph

---

## Security Considerations

- **This is a public endpoint by necessity**, and its security rests on the JWT's signature and scope. The payload carries only a candidate and workspace identifier — nothing damaging if the URL were seen by someone else, since it grants read-only access to deliberately limited status information.
- **The exclusions are structural**, per G03. A conditional in the portal's rendering code is something a future engineer can loosen without noticing; a response type that does not contain the field is not.
- **The error response is undifferentiated on purpose.** Distinguishing *expired* from *no such candidate* would let someone probe whether a given person had applied to a given agency, which is exactly the inference this portal must not enable.
- **Status change notifications are the delivery mechanism for rejection at scale.** That places a real obligation on the copy: a rejection message reaching thirty people simultaneously should read as though it were written for one.

---

## Out of Scope

- **Interview self-scheduling** — [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]], which extends this access surface rather than building a second
- **Two-way communication.** Status only, in this direction. A candidate replying to the notification email reaches the agency's own inbox, which is where that conversation belongs
- **Offer acceptance through the portal** — [[VRS-F032_Offer_Management|VRS-F032]]. Accepting an offer is a conversation
- **A workspace toggle to disable the portal.** Always active. An agency that would rather candidates heard nothing is not one this product should accommodate
- **Candidate-initiated withdrawal** — a reasonable later addition, requiring a write path this feature deliberately does not have

---

## Decisions Recorded

**The email provider question is resolved** by [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] rather than inherited as an open item.

**There is no progress tracker.** A five-step tracker showing someone at step two tells them how far they are from an outcome they may not reach. One clear statement of where they are is kinder and more accurate.

**Prior application linkage is added to the exclusion list.** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] introduced cross-application history, and nothing previously prevented a portal response from revealing that an agency had connected a current application to a rejection two years ago.

**The error response is undifferentiated.** The previous specification distinguished invalid from expired, which is friendlier and leaks whether a candidate record exists at all.

**The portal cannot be disabled.** The previous specification listed a workspace toggle as out of scope for the phase; it is out of scope permanently. An agency that would prefer candidates heard nothing is choosing the behavior this feature exists to eliminate.

---

## Related Notes

- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline whose status this reports
- [[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]] — the careers site where an application begins
- [[VRS-F031_Interview_Scheduling_and_Scorecards|VRS-F031]] — scheduling, which extends this surface
- [[VRS-F021_E-Signature_Native|VRS-F021]] — the token pattern reused here

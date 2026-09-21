---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Core
aliases:
  - VRS-F033
---

# VRS-F033 — Talent Pool and Candidate CRM

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (Candidate and its lifecycle), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (Skill, for matching a pooled candidate to a new role), [[VRS-F030_Candidate_Portal|VRS-F030]] (the surface where consent is given and withdrawn), [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] (retention schedules), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (TalentPool and the `pooled_in` edge)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A structured way to keep the candidates an agency did not hire but would hire, and to find them again when a matching role opens.

A TalentPool is a named group. A candidate joins one with **their consent**, and is surfaced when a new open role matches their skills.

---

## Problem It Solves

An agency hiring a senior React developer interviews six people, hires one, and rejects five — of whom two were genuinely good and lost only because there was one seat.

Four months later the same agency opens the same role. Those two candidates are somewhere in an email thread, or in a spreadsheet, or in nobody's memory at all, and the agency starts a new search that costs three weeks and an agency fee.

**For a professional services firm hiring the same five roles repeatedly, the silver medallist is the highest-yield source of hires it has**, and almost nobody works it, because working it requires remembering that someone existed.

There is a second problem this feature must solve rather than create. **Keeping a rejected candidate's personal data indefinitely, on the theory that they might be useful later, is not something an agency may simply decide to do.** Most applicant tracking systems retain everything forever and treat the legal question as somebody else's. This feature treats consent and retention as part of the mechanism rather than as a policy note.

---

## User-Facing Flows

### Creating a pool

An HR Admin creates a named pool — *Senior Backend*, *Design leads*, *Freelance illustrators* — with an optional description.

Pools are deliberately simple. They are a label, not a workflow, and an agency that wants a pipeline for its pool has confused a pool with a role.

### Adding a candidate

At rejection, or at any point afterwards, a recruiter adds a candidate to one or more pools with a note on why.

**Adding is a request, not an act.** The candidate receives an email through [[VRS-F030_Candidate_Portal|VRS-F030]] asking whether they would like to be kept in touch with, naming the agency and what it means. Only on their agreement does the pool membership become active.

A candidate who does not respond is not pooled. Silence is not consent.

### Being found again

When an open role is created, pooled candidates whose skills match its requirements surface in the recruiter's view — using [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s matching engine, not a second implementation — with their prior outcome and the note explaining why they were pooled.

The recruiter contacts them as they would any other prospect.

### Withdrawing

A pooled candidate can withdraw at any time from their [[VRS-F030_Candidate_Portal|VRS-F030]] link, in one action, without explanation and without contacting anyone.

Withdrawal removes them from every pool and triggers erasure of their record under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] unless a live application exists.

### Expiry

Pool membership carries an expiry — twenty-four months by default. On expiry the candidate is asked once whether to renew. No response means the membership lapses and the record is erased.

**Consent that never expires is consent nobody gave recently**, and a talent pool that quietly accumulates a decade of rejected applicants is a liability rather than an asset.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Talent pools | Content + Panel | The pools and their members |
| Pool matches | Section on the open role | Who is already known |
| Consent request | Within [[VRS-F030_Candidate_Portal|VRS-F030]] | The candidate's decision |

### Layout and components

**Talent pools** is a Table: name, member count, active count, pending consent count, description. The three counts are separate deliberately — a pool of forty with six consents is a pool of six, and one number would flatter it.

The Panel lists members: name, prior role applied for, outcome, added by, note, consent status Badge, expiry date. Members pending consent render dashed per [[VPS-D001_Design_Foundations|VPS-D001]]'s rule, being expected rather than present.

**Pool matches on an open role** is a Section beneath the role's requirements, appearing only where matches exist: candidate name, matching skills, prior outcome, when they were pooled, and the pooling note.

The note is the useful part. *Strong technically, lost to a stronger portfolio* tells the recruiter more than a rating, and it is what makes a four-month-old rejection re-approachable rather than awkward.

**The consent request** in the portal is one screen: the agency's name and logo, a plain statement of what is being asked and for how long, and two actions — **Yes, keep in touch** and **No thanks**. Declining erases the record and says so.

No pre-ticked box, no dark pattern, no delay before the decline action becomes available.

### Keyboard

Standard list bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Owner and HR Admin full. A Manager reads pools relevant to a role they are hiring for |
| Pending consent | Dashed, with the request date and a resend action available once |
| Expiring | Membership within 30 days of expiry renders the date in `attention` |
| Empty | *No one pooled yet.* with an explanatory line that pooling requires the candidate's agreement |
| Error | Adding a candidate who previously declined is refused, naming the prior decline |

### Responsive

Drops `added by`, then `prior outcome`, below 1280px.

---

## Technical Architecture

### TalentPool

HR-restricted, Tier 2.

```
pool_id:          UUID v4
workspace_id:     UUID
name:             string, required
description:      text, nullable
lifecycle_status: enum: Active, Archived

— Universal Node Conventions per VPS-A002 —
```

### The pooled_in edge

Membership is an edge rather than a node, carrying its own state:

```
pooled_in: Candidate -> TalentPool
  metadata:
    added_by:          user_id
    pooling_note:      text
    consent_status:    enum: Pending, Granted, Declined, Withdrawn, Expired
    consent_requested_at: timestamp
    consent_granted_at:   timestamp, nullable
  effective_from: the consent grant date
  effective_to:   the expiry date, consent_granted_at + 24 months
```

Using the edge's own `effective_from` and `effective_to` — first-class fields per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — means an expired membership is filtered by the same temporal query every other edge uses, rather than needing a status sweep.

### Consent

**A pool membership is inactive until `consent_status` is Granted.** An inactive membership never surfaces in match results, never appears in a count of pool members, and never causes the candidate to be contacted.

A request is sent once, with one resend permitted. **There is no second follow-up.** An agency chasing consent to store someone's data is an agency that has misunderstood what it is asking for.

A decline is permanent for that workspace. A candidate who declined cannot be re-added, and the attempt is refused naming the prior decline — otherwise a well-meaning recruiter re-asks every six months.

### Retention

`consent_granted_at + 24 months` sets the expiry, configurable per workspace between 6 and 36 months.

Thirty days before, one renewal request is sent. No response means the membership lapses.

**A candidate holding no active pool membership and no live application is erased under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s schedule.** This feature does not implement erasure; it supplies the condition.

### Matching

Pooled candidates are matched against a new OpenRole's `requires_skill` edges using [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s engine, unmodified. **Candidates carry `has_skill` edges** in the same way employees do, recorded during screening.

Only candidates with Granted consent are matched.

### API contracts

```
talentPool.create(name, description?)              -> { poolId }
talentPool.addCandidate(poolId, candidateId, note) -> {
  edgeId, consentRequested: true
}
  // Refused where this candidate previously declined for this workspace
talentPool.resendConsent(edgeId)                   -> { success }
  // Permitted once
talentPool.removeCandidate(edgeId)                 -> { success }
talentPool.members(poolId, consentStatus?)         -> { candidate, metadata }[]

openRole.pooledMatches(openRoleId) -> {
  candidateId, name, matchingSkills, priorOutcome, pooledAt, poolingNote
}[]
  // Granted consent only. Uses VRS-F013's matching engine

candidatePortal.getConsentRequest(token) -> {
  workspaceName, poolName, retentionMonths
} | null
candidatePortal.grantConsent(token)      -> { granted: true }
candidatePortal.declineConsent(token)    -> { declined: true, erasureScheduled: true }
candidatePortal.withdrawConsent(token)   -> { withdrawn: true }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | TalentPool carries the schema above. Membership is a `pooled_in` edge, not a node |
| G02 | A membership is inactive until `consent_status` is Granted. Inactive memberships never surface in matches or counts |
| G03 | Membership expiry uses the edge's `effective_to`, filtered by the same temporal query as every other edge |
| G04 | Consent is requested once with one permitted resend. No further follow-up is sent |
| G05 | A decline is permanent for that workspace. Re-adding is refused |
| G06 | Withdrawal removes every membership and triggers erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] unless a live application exists |
| G07 | Matching uses [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s engine unmodified and covers Granted candidates only |
| G08 | A candidate with no active membership and no live application meets [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s erasure condition. This feature supplies the condition, not the erasure |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F033-S01 | TalentPool schema and membership edge | Data |
| VRS-F033-S02 | Consent request, grant and withdrawal | Logic |
| VRS-F033-S03 | Expiry and renewal | Logic |
| VRS-F033-S04 | Skill matching against open roles | Logic |
| VRS-F033-S05 | Pool management surface | UI |

---

## Feature Acceptance Criteria

**GIVEN** a recruiter adds a rejected candidate to a pool with a note
**WHEN** the addition saves
**THEN** the membership is created with consent Pending, a request is sent, and the candidate does not appear in any match result

---

**GIVEN** the candidate grants consent
**WHEN** it is recorded
**THEN** the membership becomes active with an expiry 24 months out, and they surface in matches for roles requiring their skills

---

**GIVEN** the candidate never responds
**WHEN** matches are computed
**THEN** they never appear, and the pool's active count does not include them

---

**GIVEN** a candidate declines
**WHEN** the decline is recorded
**THEN** erasure is scheduled under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]], and a later attempt to re-add them is refused naming the prior decline

---

**GIVEN** an open role is created requiring skills two pooled candidates hold
**WHEN** the role's matches are computed
**THEN** both appear with matching skills, prior outcome and pooling note, using [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s engine

---

**GIVEN** a membership reaches 24 months with no renewal response
**WHEN** expiry passes
**THEN** the membership lapses through `effective_to`, the candidate stops appearing in matches, and with no other membership or live application they meet the erasure condition

---

**GIVEN** a pooled candidate withdraws from their portal
**WHEN** withdrawal completes
**THEN** every membership is removed in one action, with no explanation required and nobody contacted

---

## Non-Functional Requirements

- Pool matches for an open role resolve within 200ms from the local graph
- Pool membership lists render within 200ms for pools up to 500 members
- Consent requests are delivered through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] and carry no candidate assessment data
- Full functionality offline for internal surfaces. Consent actions require connectivity

---

## Security Considerations

- **This feature exists to retain personal data about people who do not work for the agency and were told no.** That is the entire reason consent, expiry and one-action withdrawal are part of the mechanism rather than a policy sitting beside it.
- **Consent is opt-in with no dark pattern.** No pre-ticked box, no delayed decline action, no second chase. The request states the agency, the purpose and the duration.
- **A decline is permanent per workspace**, which prevents the pattern where a well-meaning recruiter re-asks every six months and eventually gets a yes through attrition.
- **The pooling note is an assessment of a person, held after rejection.** It is HR-restricted, never shown to the candidate, and never included in any [[VRS-F030_Candidate_Portal|VRS-F030]] response. *Strong technically, lost to a stronger portfolio* is a fair internal note and a hurtful thing to read about yourself.
- **Only granted memberships surface anywhere.** A pending membership is invisible in matches and in counts, so a recruiter cannot work a list of people who have not agreed to be on it.

---

## Out of Scope

- **Outbound campaigns or bulk email to a pool.** This is a record, not a marketing tool. A recruiter contacts individuals
- **Automatic re-entry into a pipeline.** A match surfaces a name; a person makes contact
- **Sourcing from external databases.** This feature works with people who applied to this agency
- **Pool membership without a prior application.** A candidate must exist through [[VRS-F028_Recruitment_Pipeline|VRS-F028]] first
- **Erasure itself** — [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]. This feature supplies the condition

---

## Decisions Recorded

**This feature is new**, and it exists because the silver medallist is the highest-yield hiring source a professional services firm has and almost nobody works it.

**Consent is a prerequisite, not a setting.** Most applicant tracking systems retain rejected candidates indefinitely by default and treat the legal question as somebody else's. A membership here is inactive until the candidate agrees, and an agency that finds this restrictive is discovering the actual position it was always in.

**Silence is not consent, and there is no second chase.** One request, one permitted resend. Chasing someone for permission to keep their data misunderstands what is being asked.

**A decline is permanent per workspace**, preventing consent obtained through attrition.

**Membership expires at 24 months** and lapses without a response. Consent that never expires is consent nobody gave recently, and a pool quietly accumulating a decade of rejected applicants is a liability rather than an asset.

**Membership uses the edge's `effective_from` and `effective_to`** rather than a status field with a sweep. [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] promoted those to first-class indexed fields, and an expiring membership is exactly the temporal query they exist for.

**The pooling note is never shown to the candidate.** It is a fair internal assessment and a hurtful thing to read about oneself, and the portal's structural exclusions already prevent it.

---

## Related Notes

- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline candidates are pooled from
- [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] — the matching engine used unmodified
- [[VRS-F030_Candidate_Portal|VRS-F030]] — where consent is given and withdrawn
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — the erasure this feature supplies the condition for

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Experience
aliases:
  - VRS-F029
---

# VRS-F029 — Careers Site and Job Distribution

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F028_Recruitment_Pipeline|VRS-F028]] (OpenRole, the thing being posted, and Candidate, the thing an application creates), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (CV upload from an application), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (JobPosting), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (object storage, malware scanning, and the transactional email confirming an application)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What It Is

A hosted, branded careers page per workspace, and the distribution of an open role beyond it.

An open role becomes a **JobPosting** — a public description written for a candidate rather than the internal record written for a recruiter — rendered on the agency's careers page, syndicated to [[Vulto Jobs]] on [[Vulto Network]], and reachable by a direct link an agency can put anywhere.

An application creates a Candidate in [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s pipeline directly, with no re-entry.

---

## Problem It Solves

A small agency's careers presence is typically a page on their own website that a developer updates when someone remembers, listing roles that may or may not still be open, with a *jobs@* email address behind it.

Applications arrive in an inbox. Somebody copies them into a spreadsheet, or does not. CVs live in that inbox. A candidate who applied three weeks ago has heard nothing because nobody has opened the address since.

**The gap this closes is not marketing, it is data.** Every application that arrives by email is a candidate record somebody has to create by hand, and the ones that do not get created are the ones lost. A careers page connected to the pipeline means an application is a pipeline record the moment it is submitted.

---

## User-Facing Flows

### Publishing a role

An HR Admin opens an OpenRole and writes its public posting: a description, responsibilities, requirements, location and work arrangement, and optionally a compensation range.

The internal record and the public posting are **deliberately separate.** An open role carries a seniority enum, a hiring manager and skill edges; a posting carries prose written to attract someone. Rendering the first as the second produces the job adverts that read like a database export.

### The careers page

Every workspace has one at a Vulto-hosted address, branded with the workspace name and logo, listing every published posting with title, location, arrangement and department.

An agency with no open roles gets a page saying so with a general-interest form, rather than a broken link — which is worth more than it sounds, because a careers page that vanishes when hiring pauses is one an agency stops linking to.

### Applying

The application form asks for name, email, phone, a CV upload and an optional message. Nothing else. **Every additional field on an application form is candidates lost**, and an agency that needs more will ask at screening.

On submission a Candidate is created at Applied, the CV is filed per [[VRS-F022_Encrypted_Document_Vault|VRS-F022]], the applicant receives a confirmation with their status link per [[VRS-F030_Candidate_Portal|VRS-F030]], and the recruiter sees them on the board.

### Distribution

A published posting syndicates to [[Vulto Jobs]] where the workspace has that connection, and carries a direct link and the metadata for a link preview, so a role shared on a social platform renders as a job rather than a URL.

### Closing

Closing or filling the role unpublishes the posting. The public URL resolves to a page stating the role is closed and offering the general-interest form, rather than a 404 — someone arriving from a link shared last week should not meet an error.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Posting editor | Content, split | Write and preview |
| Careers page | Public, no shell | The agency's own page |
| Job posting | Public, no shell | One role |
| Application form | Public, no shell | Five fields |
| Careers settings | Section in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] | Branding and the page URL |

### Layout and components

**The posting editor** is a two-column split: form left, live public preview right, rendered exactly as a candidate will see it. An agency writing a job advert should see the advert.

The form is a rich text Textarea per section — description, responsibilities, requirements — plus Selects for location and arrangement, and an optional compensation range with a Switch controlling whether it is shown publicly.

**The public pages use [[VPS-D001_Design_Foundations|VPS-D001]]'s tokens with the workspace's own logo and name**, and nothing else configurable. Not a website builder. A clean, fast, legible page that loads in under a second is worth more to an agency than one they can restyle, and every configuration option is a way for it to end up worse.

The careers page is a single column, maximum 720px: workspace name and logo, one line of description, then postings as rows — title, location, arrangement — each a link. No filters until a workspace has more than ten postings, at which point a location Select appears.

**The application form is five fields on one screen** with a drop zone for the CV. No account, no multi-step, no progress bar. The submit action reads **Apply**, and afterwards the page states plainly what happens next and by when.

### Keyboard

Public pages are fully keyboard-navigable per [[VPS-D002_Component_Library|VPS-D002]]'s accessibility floor. The internal editor uses standard form bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | The editor works from local state |
| Restricted | Publishing is Owner and HR Admin only |
| Empty | A careers page with no postings states so and offers the general-interest form |
| Closed | A closed posting's URL resolves to a closed-role page, never a 404 |
| Scanning | An uploaded CV that has not cleared scanning does not block the application; the candidate is created and the document attaches when clean |
| Error | A failed submission preserves entered values and offers retry, since a candidate who loses a written message will not rewrite it |

### Responsive

The public pages are mobile-first and fully functional at 375px. A substantial share of job applications are made on a phone, frequently on a commute, and a careers page that assumes a desktop loses those people entirely.

---

## Technical Architecture

### JobPosting

Standard, Tier 0. Public content by definition.

```
posting_id:         UUID v4
workspace_id:       UUID
open_role_id:       UUID, FK to OpenRole
slug:               string — the public URL segment, generated from the title
                    and made unique within the workspace
title:              string — the public title, which may differ from the
                    internal role title
description:        rich_text
responsibilities:   rich_text, nullable
requirements:       rich_text, nullable
location:           string, nullable
work_arrangement:   enum: OnSite, Hybrid, Remote
employment_type:    enum per VRS-F002
show_compensation:  boolean, default false
compensation_range_display: string, nullable — a display string, deliberately
                    not a figure joined to any Tier 1 record
status:             enum: Draft, Published, Closed
published_at:       timestamp, nullable
syndicated_to:      string[] — e.g. ['VultoJobs']

— Universal Node Conventions per VPS-A002 —
```

`compensation_range_display` is a **display string, not a number.** A public posting saying *£45,000–£55,000* is marketing copy an HR Admin wrote, and joining it to [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]'s Tier 1 requisition range would create a path from a public page to encrypted compensation data. The two are kept unconnected deliberately.

### The public endpoint

Careers pages, postings and the application form are **public and unauthenticated**, the same architectural category as [[VRS-F030_Candidate_Portal|VRS-F030]]'s status portal and [[VRS-F021_E-Signature_Native|VRS-F021]]'s signing link — not an extension of [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s role-based system, which governs authenticated members.

The endpoint reads only Published postings for the requesting workspace. **There is no path from it to any other node type.** An OpenRole's hiring manager, skill edges and requisition are unreachable through it, by construction rather than by filtering.

### Application handling

A submission creates a Candidate at Applied with `source: CareersSite`, files the CV through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] against the new candidate, and triggers [[VRS-F030_Candidate_Portal|VRS-F030]]'s confirmation.

Duplicate detection per [[VRS-F028_Recruitment_Pipeline|VRS-F028]] runs on every application. **A duplicate is not rejected** — a person reapplying is applying, and refusing them at a public form would be both rude and inexplicable to them. The recruiter sees the flag on the board.

### Abuse protection

A public form accepting file uploads is the most exposed surface in this product.

Rate limiting per IP and per email through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s Redis. A proof-of-work or CAPTCHA challenge on submission. File type and size validated before upload, and malware scanning per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] before the document becomes retrievable. Submissions exceeding the rate limit are refused at the edge and never create a Candidate.

**A CV is never served publicly.** Uploading grants no read access; the document is retrievable only through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s authenticated path.

### API contracts

```
jobPosting.create(openRoleId, fields)   -> { postingId, slug }
jobPosting.publish(postingId)           -> { publicUrl, syndicated }
jobPosting.unpublish(postingId)         -> { success }
jobPosting.preview(postingId)           -> { renderedHtml }

careers.getPage(workspaceSlug)          -> { workspace, postings }   // public
careers.getPosting(workspaceSlug, slug) -> JobPosting | Closed       // public
careers.apply(workspaceSlug, slug, {
  fullName, email, phone?, cvFile, message?
}) -> { submitted: true, statusUrl }                                 // public
  // Creates a Candidate at Applied, files the CV, triggers VRS-F030.
  // Rate limited and challenge protected
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | JobPosting carries the schema above and connects to OpenRole through `posted_as` |
| G02 | The public endpoint reads Published postings only and has no traversal path to any other node type |
| G03 | An application creates a Candidate at Applied with `source: CareersSite` and files the CV through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] |
| G04 | Duplicate detection runs on every application. A duplicate is flagged to the recruiter, never refused to the applicant |
| G05 | `compensation_range_display` is a display string with no join to any Tier 1 record |
| G06 | Closing an OpenRole unpublishes its posting. The URL resolves to a closed-role page, never a 404 |
| G07 | An uploaded CV is never publicly retrievable. Read access is only through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s authenticated path |
| G08 | Submissions exceeding the rate limit are refused before any Candidate is created |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F029-S01 | JobPosting schema and editor | Data |
| VRS-F029-S02 | Public careers page and posting rendering | UI |
| VRS-F029-S03 | Application form and candidate creation | Logic |
| VRS-F029-S04 | Syndication to Vulto Jobs | Logic |
| VRS-F029-S05 | Abuse protection | Security |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin writes and publishes a posting
**WHEN** it is published
**THEN** it appears on the workspace's careers page, has a stable public URL, and syndicates to [[Vulto Jobs]] where connected

---

**GIVEN** someone submits an application
**WHEN** submission completes
**THEN** a Candidate exists at Applied with source CareersSite, the CV is filed against them, and they receive a confirmation carrying their status link

---

**GIVEN** an applicant's email matches a candidate rejected last year
**WHEN** they apply
**THEN** the application succeeds normally and the duplicate is flagged to the recruiter, with nothing indicated to the applicant

---

**GIVEN** an OpenRole is closed
**WHEN** its public URL is visited
**THEN** a closed-role page appears with the general-interest form, not a 404

---

**GIVEN** the public posting endpoint is called
**WHEN** the response is inspected
**THEN** it contains only posting content, and no hiring manager, skill requirement, requisition or candidate data is reachable through it

---

**GIVEN** a workspace has no published postings
**WHEN** the careers page loads
**THEN** it renders with the general-interest form rather than an empty or broken page

---

**GIVEN** an uploaded CV's URL is guessed or shared
**WHEN** it is requested without authentication
**THEN** it is refused. A CV is never publicly retrievable

---

**GIVEN** fifty submissions arrive from one IP in a minute
**WHEN** the rate limit triggers
**THEN** they are refused at the edge and no Candidate is created

---

## Non-Functional Requirements

- Public pages render within 1 second on a mobile connection, server-rendered for indexability
- The application form submits within 3 seconds including CV upload for a file up to 10MB
- The posting editor's preview updates within 200ms
- Public pages meet [[VPS-D002_Component_Library|VPS-D002]]'s accessibility floor in full, since a public careers page has a legal obligation an internal screen does not

---

## Security Considerations

- **This is the most exposed surface in the product**: public, unauthenticated, and accepting file uploads. Rate limiting, challenge protection, file validation and malware scanning are all requirements rather than hardening.
- **The endpoint's isolation is structural.** It reads published postings and writes candidates, and has no traversal path to anything else. An implementer extending it to show *meet the team* content would be opening a path from a public page into the employee graph, and should not.
- **A CV upload grants no read access.** The document is retrievable only through the authenticated path.
- **Public compensation display is a copy field, deliberately disconnected** from [[VRS-F027_Headcount_Plan_and_Requisition_Approval|VRS-F027]]'s Tier 1 range. Joining them would create a route from an unauthenticated page toward encrypted compensation data, however indirect.
- **Application data is personal data collected at scale.** [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s retention schedules govern how long an unsuccessful application is kept, and the careers page states the retention period, because a public form collecting personal data has a disclosure obligation in every jurisdiction in [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]]'s enum.

---

## Out of Scope

- **A website builder.** The careers page uses the design system with the workspace's logo and name. Restyling is not offered
- **Custom application questions per role.** Five fields, always. An agency needing more asks at screening
- **Third-party job board posting** — LinkedIn, Indeed and equivalents. [[Vulto Jobs]] is the syndication target; others are [[VPS-F009_Vulto_Sync_API|VPS-F009]]'s territory if warranted
- **CV parsing or automatic screening.** The document is stored, not read
- **A candidate account or saved applications** — [[VRS-F030_Candidate_Portal|VRS-F030]] provides status without an account, deliberately
- **Custom domains for the careers page** — a later concern

---

## Decisions Recorded

**This feature is new.** The previous specification set posted to [[Vulto Jobs]] and had no hosted presence of its own, which means an agency's own careers page remained a manually updated website page with an email address behind it — and every application arriving that way is a pipeline record somebody has to create by hand.

**The public posting is separate from the internal role**, not a rendering of it. An open role holds a seniority enum, a hiring manager and skill edges; a job advert holds prose. Rendering the former as the latter produces the job listings that read like a database export.

**The application form is five fields and will not grow.** Every additional field costs applications, and an agency that needs more information can ask at screening — where the person has already invested something and is far more likely to answer.

**A closed posting resolves to a closed page, not a 404.** A link shared last week should not produce an error, and a careers page that breaks when hiring pauses is one an agency stops linking to.

**Public compensation is a display string with no join to Tier 1 data.** The alternative — reading the requisition range — would create a path, however indirect, from an unauthenticated page toward encrypted compensation.

**The careers page is not configurable beyond logo and name.** Every configuration option is a way for a page representing the agency to end up worse, and a clean page that loads in under a second serves them better than one they can restyle.

---

## Related Notes

- [[VRS-F028_Recruitment_Pipeline|VRS-F028]] — the pipeline an application enters
- [[VRS-F030_Candidate_Portal|VRS-F030]] — the status link an applicant receives
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where CVs are filed
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — rate limiting, scanning and email

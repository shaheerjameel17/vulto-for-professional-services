---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Platform
aliases:
  - VPS-F006
---

# VPS-F006 — Workspace Setup and Data Import

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] (which hands off to this feature the moment a workspace exists), [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity), [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] (WorkingCalendar), [[VRS-F005_The_Bench_Forecast|VRS-F005]] (Assignment), [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]] (Skill), [[VRS-F018_Leave_Policy_Engine|VRS-F018]] (LeavePolicy), [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] (OnboardingTemplate), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (ImportBatch), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (client-side encryption for Tier 1 columns), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (the job queue, and the no-auto-retry rule for imports)
**Blocks:** Nothing structurally. It determines whether a customer reaches the rest of the product at all.

This document is the single source of truth for this feature.

---

## What It Is

Two things that share one purpose: **getting a real agency from an empty workspace to a working one.**

**Setup** is the first-run sequence immediately after [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] creates a workspace: four questions that configure the product's vocabulary and defaults, followed by the creation of a first entity, a working calendar, a leave policy and an onboarding template — none of which a founder should have to build from nothing before the product does anything useful.

**Import** is the bulk path for the data an existing firm already has: employees, assignments, projects, clients, skills and leave balances, from CSV.

---

## Problem It Solves

Every other feature in this specification set assumes data exists. None of them puts it there.

[[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] explicitly excludes bulk import. [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] reasons about records arriving through *a bulk import that bypassed the interactive check* — a path no feature builds. [[Vulto for Professional Services]] describes a four-question onboarding that configures the platform's vocabulary per firm type, and no Roster feature implements it.

**A resource intelligence product whose first screen requires manual entry of every employee, every assignment and every leave balance will not survive its own trial period.** A twenty-person agency evaluating this on a Tuesday afternoon has perhaps an hour of patience. Entering twenty employee records by hand consumes all of it and produces a workspace with no assignments, meaning the Bench Forecast — the reason they came — renders empty.

This feature exists so that the first thing a founder sees is their own agency, populated, with their own bench cost on the screen.

---

## User-Facing Flows

### The four questions

Immediately after workspace creation, four questions, one screen each, none skippable and none requiring thought:

1. **What kind of work do you primarily do?** — Agency, Consultancy, Engineering practice, Design studio
2. **How do you engage clients?** — Projects, Retainers, Both
3. **How large is your team?** — Under 10, 10–30, 30–100, Over 100
4. **Where is your team employed?** — one or more jurisdictions from [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]]'s enum

### What the answers do

**The four questions configure the whole suite**, not Roster alone. A firm that answers *consultancy* sees engagements rather than projects in every application it later activates, because [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] holds `vocabulary_profile` at workspace level.

**Question one selects a vocabulary profile.** A consultancy sees engagements where an agency sees projects. This is a fixed set of four profiles mapping a small closed term list — **not free-text renaming.** An opinionated product does not let a customer rename its concepts; it recognizes that four kinds of firm use four established words for the same concept and picks the right one.

**Question two sets defaults**, principally whether retainer-shaped assignments are the norm.

**Question three sets density** per [[VPS-D001_Design_Foundations|VPS-D001]] and thresholds that scale with headcount — a five-person studio and a hundred-person agency want different k-anonymity minimums, and defaulting both to 5 is wrong for one of them.

**Question four creates the entities**, and for each an entity, a working calendar seeded from that jurisdiction's template, a leave policy seeded from its statutory baseline, and a default onboarding template.

The sequence ends on a screen showing what was created and the two paths onward: **Import your team** or **Add someone manually**.

### Importing

The person downloads a CSV template, or uploads a file they already have. Columns are mapped — automatically where the header matches, manually otherwise — and mapping presets exist for the exports of the tools agencies most commonly leave.

**A validation pass runs before anything is written.** Every row is checked and the result shown: rows that will import, rows with warnings that will import anyway, and rows with errors that will not. Errors are per row and per column, stated in the terms of the source file — *Row 14, column "Start Date": could not read "next monday"* — not in the terms of the graph.

The person fixes what they want to fix, re-uploads, or proceeds and imports the valid rows.

### After importing

The result screen states what was created, what was skipped and why, and links directly into the Bench Forecast — which, if assignments were imported, now shows a real agency with real bench cost on it.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Setup questions | Full-bleed, no shell | Four screens, one question each |
| Setup summary | Full-bleed, no shell | What was created, and what next |
| Import | Content | Upload, map, validate, commit |
| Import history | Content | Past batches. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |

### Layout and components

**Setup questions** are one question per screen, centered, maximum 480px. Each is a set of large Cards rather than a Select — four options at 96px tall, selectable in one click, with a one-line description of what the choice means. Progress is four dots, not a percentage.

There is no back-out and no skip. **There is also no wrong answer**: every choice sets a default that [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] can change later, and the summary screen says so, once, plainly. A setup wizard that feels irreversible is a setup wizard people abandon.

**The summary** lists what was created as a checklist with `success` marks — *2 entities · 2 working calendars · 2 leave policies · 1 onboarding template* — and two actions: **Import your team** as `primary`, **Add someone manually** as `secondary`.

**Import** is a three-step sequence within one screen, not a wizard with pages.

*Upload* is a drop zone with a **Download template** action beside it, and a Select for the source preset.

*Map* is a Table: source column, a Select for the destination field, and a preview of the first three values. Auto-matched rows render with a `success` check and are collapsed by default; only the ambiguous ones demand attention.

*Validate* is the most important surface. Three counts in `mono-lg` — **will import**, **warnings**, **errors** — above a Table of affected rows: row number, the source values, and the specific problem. Errors are filterable to themselves, since a file with 300 rows and 11 errors should not require scrolling past 289 good ones.

The primary action reads **Import 187 rows**, stating the number, and is available even where errors exist — importing the valid rows and reporting the rest is almost always better than refusing the whole file.

**Import history** is a Table: date, type, rows imported, rows skipped, actor. Each row expands to the stored error summary.

### Keyboard

Setup questions accept `1`–`4` to select and `Enter` to advance. The import mapping table supports `Tab` between destination Selects.

### System states

| State | Treatment |
|---|---|
| Syncing | Setup writes locally and continues; it never waits on the network |
| Restricted | Import is Owner and HR Admin only. Salary columns require Tier 1 access to map at all |
| Empty | Import history empty reads *No imports yet.* |
| In progress | A running import shows a determinate progress bar with the current row count. It is not cancelable once committing — a half-canceled import is worse than a completed one |
| Error | A malformed file is rejected before mapping, naming the problem: encoding, delimiter, or no header row |

### Responsive

Setup works unchanged to 375px — a founder may well start on a phone. The import mapping table is desktop-only below 1024px, and says so rather than degrading into something unusable.

---

## Technical Architecture

### Vocabulary profiles

Four fixed profiles, each mapping a closed set of terms. Stored as a single `vocabulary_profile` value on Workspace; the mapping itself ships with the product.

| Concept | Agency | Consultancy | Engineering | Studio |
|---|---|---|---|---|
| Project | Project | Engagement | Program | Project |
| Client | Client | Client | Client | Client |
| Assignment | Assignment | Staffing | Allocation | Assignment |
| Bench | Bench | Bench | Bench | Bench |

**The table is deliberately close to identical**, and that is the point. Four kinds of firm differ in perhaps two words, and inventing differences to justify a configuration surface would be the opposite of an opinionated product. Where a term is genuinely shared, it stays shared.

**No free-text renaming exists**, at any tier, for any customer. A workspace that renames Bench to *Available Capacity* has made every conversation about this product, every support answer and every benchmark incomparable with every other workspace.

### ImportBatch

```
import_batch_id: UUID v4
workspace_id:    UUID
import_type:     enum: Employee, Assignment, Project, Client, Skill, LeaveBalance
source_preset:   string, nullable
row_count:       integer
imported_count:  integer
skipped_count:   integer
error_summary:   JSON array of { row, column, message }
status:          enum: Validating, Committing, Complete, Failed, PartiallyComplete
started_at:      timestamp
completed_at:    timestamp, nullable

— Universal Node Conventions per VPS-A002 —
```

**It records outcomes, never the payload.** An import of salary data that retained its source rows would create a Tier 1 leak inside a Tier 2 node. Error messages quote a cell's value only where that value is non-sensitive; a failed salary cell reports the column and the problem, never the figure.

### Import order

Dependencies are strict and the interface enforces the sequence:

**Entities → Skills → Clients → Employees → Projects → Assignments → Leave balances**

**The sequence is a registry, not a fixed list.** Each application registers its own import types and their position in the dependency order. Roster's registration is the initial one; [[Vulto Projects]] adds Deliverables after Projects, since a deliverable cannot reference a project that does not exist.

An assignment cannot reference a project that does not exist. Importing out of order is refused with a statement of what must come first, rather than accepted and silently producing orphans.

### Idempotency

Every template carries an optional `external_id` column. Where present, a row matching an existing record by external ID **updates rather than duplicates.** Where absent, matching falls back to email for employees and name for projects and clients.

Re-running the same file must not produce a second copy of anyone. This is the single most common way a bulk import destroys a workspace's data, and the fallback matching is stated explicitly so that an implementer does not choose their own.

### Tier 1 columns

Salary columns are encrypted client-side before any value leaves the device, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. **Import therefore runs on an authorized device**, not as a server-side job, and a user without Tier 1 access cannot map a salary column at all — the destination does not appear in the Select.

This mirrors the constraint [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] places on document rendering, and for the same reason.

### Validation against feature rules

Import validates against the same rules the interactive path enforces, with one deliberate exception.

**[[VRS-F005_The_Bench_Forecast|VRS-F005]]'s 100% capacity constraint is checked and reported as a warning, not an error.** Imported assignment data frequently overlaps in ways a real schedule did tolerate, and refusing an entire import over historical overcommitment would block the migration for a reason nobody can act on. The rows import, and [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s overcommitment sweep surfaces them afterwards — which is precisely the case that feature's safety net exists for.

Everything else — a missing required field, an unparseable date, a reference to a non-existent project, an invalid enum value — is an error.

### Failure and resumption

Per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], import jobs are **never automatically retried.** A failed or partial import is resumed deliberately from the import history, which re-runs only the rows not already committed, matched by external ID.

A blind retry of a partially committed import is how a workspace ends up with a hundred and forty duplicate employees.

### API contracts

```
setup.submitAnswers(workspaceId, answers) -> {
  entitiesCreated, calendarsCreated, policiesCreated, templatesCreated
}
  // Creates the initial configuration atomically

import.uploadFile(workspaceId, importType, file, sourcePreset?) -> {
  batchId, detectedColumns, suggestedMapping
}
import.validate(batchId, mapping) -> {
  willImport, warnings, errors: { row, column, message }[]
}
  // No side effect. Nothing is written

import.commit(batchId, mapping, includeWarningRows) -> {
  batchId, imported, skipped
}
  // Client-side encryption applied to Tier 1 columns before transmission

import.resume(batchId)                 -> { imported, skipped }
import.history(workspaceId)            -> ImportBatch[]
import.downloadTemplate(importType)    -> { csvUrl }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | ImportBatch carries the schema above and never stores the imported payload |
| G02 | Error messages never quote the value of a Tier 1 cell |
| G03 | Import order is enforced: entities, skills, clients, employees, projects, assignments, leave balances |
| G04 | A row matching an existing record by `external_id`, or by email or name where absent, updates rather than duplicates |
| G05 | Tier 1 columns are encrypted client-side before transmission. Import runs on an authorized device; a user without Tier 1 access cannot map a salary column |
| G06 | [[VRS-F005_The_Bench_Forecast|VRS-F005]]'s capacity constraint is a warning on import, not an error. [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s sweep surfaces the result |
| G07 | Imports are never automatically retried. Resumption re-runs only uncommitted rows |
| G08 | Setup creates one entity, working calendar, leave policy and onboarding template per selected jurisdiction, atomically |
| G09 | `vocabulary_profile` is one of four fixed values. No free-text term renaming exists at any tier |
| G10 | Employees created by import instantiate onboarding plans per [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] where a template matches, without blocking the import |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F006-S01 | First-run question sequence | UI |
| VPS-F006-S02 | Initial configuration generation | Logic |
| VPS-F006-S03 | Vocabulary profiles | Data |
| VPS-F006-S04 | CSV upload and column mapping | UI |
| VPS-F006-S05 | Validation pass | Logic |
| VPS-F006-S06 | Commit, idempotency and resumption | Logic |
| VPS-F006-S07 | Import history | UI |

---

## Feature Acceptance Criteria

**GIVEN** a founder completes workspace creation
**WHEN** setup begins
**THEN** four questions are presented one per screen, and on completion an entity, working calendar, leave policy and onboarding template exist for each selected jurisdiction

---

**GIVEN** a founder selects Consultancy
**WHEN** the product renders afterwards
**THEN** Project reads Engagement throughout, from the fixed profile, with no free-text renaming available anywhere

---

**GIVEN** a CSV of 200 employees with 11 unparseable start dates
**WHEN** validation runs
**THEN** 189 will-import, 0 warnings and 11 errors are reported, each naming the row, column and problem in the source file's own terms, with nothing written

---

**GIVEN** the person proceeds despite the errors
**WHEN** commit runs
**THEN** 189 employees are created, 11 are skipped, the batch records both counts, and the result links into the Bench Forecast

---

**GIVEN** the same file is uploaded again
**WHEN** commit runs
**THEN** the 189 existing employees are updated rather than duplicated, matched by external ID or email

---

**GIVEN** an assignment file references a project that does not exist
**WHEN** validation runs
**THEN** those rows are errors naming the missing project, and the interface states that projects must be imported first

---

**GIVEN** imported assignments put an employee at 130% across an overlapping period
**WHEN** validation runs
**THEN** it is reported as a warning, the rows import, and [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s sweep surfaces the overcommitment afterwards

---

**GIVEN** an HR Admin without Tier 1 access maps an employee file containing a salary column
**WHEN** the mapping Select opens
**THEN** no salary destination is offered, and the column can only be ignored

---

**GIVEN** an import fails midway with 90 of 200 rows committed
**WHEN** it is resumed from history
**THEN** only the 110 uncommitted rows are processed, and no duplicate is created among the first 90

---

**GIVEN** fifty employees are imported and a matching onboarding template exists
**WHEN** the import completes
**THEN** fifty onboarding plans exist, instantiated without having blocked the import

---

## Non-Functional Requirements

- Each setup question advances within 100ms
- Setup configuration generation completes within 5 seconds
- Validation of a 500-row file completes within 10 seconds, entirely client-side
- Commit of a 500-row file completes within 60 seconds with a determinate progress indicator
- Setup functions fully offline. Import requires connectivity only to persist; validation is local
- No import writes anything before commit

---

## Security Considerations

- **Import is the single largest data-ingress surface in the product and is restricted to Owner and HR Admin.** No other role can create records in bulk.
- **Tier 1 columns never leave the device unencrypted**, which forces import to run client-side. A server-side import job processing a CSV of salaries would put the entire compensation record of an agency in plaintext on Vulto's infrastructure at the exact moment of onboarding.
- **ImportBatch stores no payload.** A batch that retained source rows would be a Tier 2 node holding Tier 1 content, which is the same class of leak [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s provenance rule exists to prevent.
- **Every import writes an audit entry** per [[VPS-F004_Silent_Audit_Log|VPS-F004]], recording type, counts and actor. Bulk creation of employee records is exactly the operation that should be traceable.
- **A validation pass that writes nothing is a security property, not only a usability one.** It means a malformed or malicious file cannot partially mutate a workspace before being rejected.

---

## Out of Scope

- **Live API-based migration from another HR product.** CSV is the format every such product exports and every agency already has. A direct integration is [[VPS-F009_Vulto_Sync_API|VPS-F009]]'s territory if it is ever warranted
- **Import of documents, contracts or signed files** — [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] accepts uploads individually
- **Export** — [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]]
- **Ongoing scheduled sync from an external source.** This is a migration tool, not an integration
- **Undo of a committed import.** Records created by an import are ordinary records afterwards and are corrected or offboarded through their own features. A bulk undo is a destructive operation with no safe implementation against a graph that has already been edited
- **Free-text vocabulary customization** — permanently excluded by design

---

## Decisions Recorded

**This feature is new and closes the largest gap in the specification set.** Nothing put data into the product. Every other feature assumed it was there.

**Vocabulary is four fixed profiles, not renaming.** [[Vulto for Professional Services]] describes the suite as adaptive in vocabulary, which is right; free-text renaming would be the wrong implementation of it. A closed set of four keeps the product opinionated, keeps [[VRS-F072_Agency_Benchmarking|VRS-F072]]'s benchmarking comparable, and keeps support answers true for every customer.

**The capacity constraint is a warning on import, not an error.** Historical assignment data overlaps. Refusing a migration over an overcommitment in March of last year would block the import for a reason nobody can act on, and [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s sweep exists precisely for records that arrived this way.

**Idempotent matching is specified rather than left open.** External ID first, then email or name. Re-running a file is the most common bulk-import accident, and an unspecified matching rule is how a workspace acquires a hundred and forty duplicate employees.

**Import runs client-side** because of Tier 1 columns. The obvious implementation — a server-side job parsing a CSV — would put an agency's entire compensation record in plaintext on Vulto's infrastructure at the moment of onboarding, which is both the worst possible moment and the least visible.

**Validation writes nothing.** The two-phase design is a security property as much as a usability one.

**Setup is not skippable, and every answer is reversible.** A wizard that can be skipped produces a workspace with no calendar and no leave policy, which fails at the first leave request. A wizard that feels permanent is abandoned. Both are avoided by making it short, and by saying plainly that everything chosen can be changed in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

---

## Related Notes

- [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] — which hands off to this feature
- [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] — where every default set here can be changed
- [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] — the sweep catching what import warns about
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the job queue and the no-auto-retry rule
- [[Vulto for Professional Services]] — the four questions this feature implements

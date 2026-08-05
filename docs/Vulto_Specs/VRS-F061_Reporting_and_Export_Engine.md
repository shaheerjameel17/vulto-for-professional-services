---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Scale
Feature Type:
  - Platform
aliases:
  - VRS-F061
---

# VRS-F061 — Reporting and Export Engine

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (**the rendering service and the client-side constraint for Tier 1 content**), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (permission and disclosure control, applied to every report), [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]], [[VPS-F004_Silent_Audit_Log|VPS-F004]], [[VRS-F058_People_Analytics_Dashboard|VRS-F058]], [[VRS-F059_Retention_Analytics|VRS-F059]], [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]], [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] (the analyzes reports are built from), [[VPS-D001_Design_Foundations|VPS-D001]] (the design system a rendered document expresses)
**Blocks:** Nothing structurally. Several features defer their own export to this one.

This document is the single source of truth for this feature.

---

## What It Is

The one place a figure leaves this product as a document or a file.

[[Vulto Roster]] promises *one-click PDF generation of agency efficiency metrics for board and investor presentations*, and no feature produced it. Meanwhile [[VPS-F004_Silent_Audit_Log|VPS-F004]] deferred audit export here, [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] deferred org chart export here, and several analytics features have figures a founder will want in a board pack.

**Rather than each building its own export, one feature owns it** — which is also the only way export can be governed consistently, since an export is the single operation in this product that moves data outside every guarantee the graph enforces.

---

## Problem It Solves

A founder preparing a board pack currently screenshots. An accountant asking for last quarter's payroll summary gets a verbal answer. An auditor asking for six months of access logs cannot be given them at all.

**And every one of those is a permission event nobody records.** A screenshot of a utilization dashboard is a Tier 0 aggregate leaving the product with no trace; a CSV of payroll figures is a Tier 1 disclosure with no trace either. The absence of an export feature does not prevent export. It only prevents it being governed.

---

## User-Facing Flows

### Running a report

An authorized user selects a report from a fixed set, sets its parameters — a date range, an entity — and runs it. The result renders on screen first.

**Nothing is exported that was not first viewed.** A report a person has not looked at is a report they cannot vouch for, and the most common way a wrong figure reaches a board is that nobody read it before it left.

### Exporting

From a viewed report: **PDF** for a document meant to be read, **CSV** for figures meant to be worked with further.

The export is generated and downloaded. **Every export writes an audit entry** naming the report, its parameters, the actor and the format.

### Scheduling

A report can be scheduled — monthly, quarterly — delivered to the requesting user's own Inbox per [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] when ready.

**Never emailed as an attachment**, and never delivered to anyone but the person who scheduled it. An export sitting in an inbox is an export outside every control this document establishes.

### A saved definition

A configured report can be saved with its parameters, so a quarterly board pack is re-run rather than reconstructed.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Reports | Content + Panel | The library and saved definitions |
| Report view | Content | A rendered report, on screen |
| Schedule | Modal | Cadence and delivery |

### Layout and components

**Reports** is a Table of available reports grouped by domain — Utilization, Workforce, Recruitment, Payroll, Compliance — each with a one-line description of what it answers rather than what it contains.

Saved definitions appear above, with their parameters and last run date.

**Report view** renders the report at reading width in the same typefaces the PDF will use, so what is seen is what will be exported. Charts render per [[VPS-D002_Component_Library|VPS-D002]]'s three permitted types.

Every report carries a header block: title, parameters, generation timestamp, and **the name of the person who ran it**. A board pack page with no provenance is a page nobody can question later, and the header is what makes a figure traceable back to a moment and a person.

**Export actions are secondary**, positioned after the content rather than before it — a small reinforcement that the reading comes first.

Where a report contains suppressed aggregates per [[VPS-A004_Graph_Permission_Layer|VPS-A004]], the suppression carries into the export with its reason stated. **A suppressed figure never becomes a blank cell in a CSV**, which a recipient would read as zero.

### Keyboard

Standard bindings. `Cmd+P` triggers PDF export from a viewed report.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | A report is absent from the library where the reader lacks access to its underlying data |
| Rendering | A determinate indicator. PDF generation is genuinely slow and pretending otherwise produces repeated clicks |
| Suppressed | Carried into the export with the reason |
| Empty | *No data in this range.* |
| Error | A failed render states the reason and preserves the on-screen report |

### Responsive

The report view is desktop-first. Below 1024px it renders readable but export is disabled, since a document generated on a phone will be reviewed on a phone.

---

## Technical Architecture

### ReportDefinition and ReportRun

```
report_definition_id: UUID v4
workspace_id:         UUID
report_type:          enum — the fixed set below
name:                 string
parameters:           JSON — date range, entity, grouping
schedule:             enum: None, Monthly, Quarterly
scheduled_for_user_id: UUID, nullable — delivery is always to one person
lifecycle_status:     enum: Active, Archived

— Universal Node Conventions per VPS-A002 —
```

```
report_run_id:        UUID v4
workspace_id:         UUID
definition_id:        UUID, nullable — null for an ad hoc run
report_type:          enum
parameters:           JSON — snapshotted at run
run_at:               timestamp
run_by:               user_id
exported_formats:     string[] — appended on each export
document_id:          UUID, nullable — where a PDF was retained

— Universal Node Conventions per VPS-A002 —
```

**ReportRun's tier is inherited** from the content it contains, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 8. A payroll report's run record is Tier 1; a utilization report's is Tier 0.

### The fixed report set

Deliberately closed. A report generator with arbitrary field selection is a query builder, and a query builder over this graph is a way to construct a disclosure nobody reviewed.

| Domain | Report | Source |
|---|---|---|
| Utilization | Agency utilization summary | [[VRS-F011_Billable_vs_Non-Billable_Pulse|VRS-F011]] |
| Utilization | Utilization trend | [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] |
| Workforce | Headcount and composition | [[VRS-F058_People_Analytics_Dashboard|VRS-F058]] |
| Workforce | Retention and turnover | [[VRS-F059_Retention_Analytics|VRS-F059]] |
| Workforce | Org chart | [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] |
| Recruitment | Pipeline performance | [[VRS-F060_Hiring_Quality_Analytics|VRS-F060]] |
| Payroll | Payroll summary by period | [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] |
| Payroll | Cost by department and entity | [[VRS-F069_Payroll_and_HR_Cost_Dashboard|VRS-F069]] |
| Compliance | Access audit log | [[VPS-F004_Silent_Audit_Log|VPS-F004]] |
| Compliance | Policy acknowledgement status | [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] |
| Compliance | Work authorization status | [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]] |

**Adding a report is an amendment to this document**, with the same review its permission and disclosure behavior requires.

### Rendering

PDF rendering runs through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s service, using the same React components the web view renders — **so a generated document is the design system by construction** rather than a second implementation that drifts.

**A report containing Tier 1 content renders client-side**, per that document's constraint. A payroll summary assembled on Vulto's servers would defeat the encryption that made the figures unreadable in the first place.

The practical consequence: payroll reports cannot be generated by a scheduled server job. A scheduled payroll report is prepared when an authorized device next connects, and the schedule reflects that honestly rather than appearing to fail.

### Disclosure control

Every aggregate in every report passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]] before rendering — the same suppression, the same differencing protection.

**A report is the most likely place disclosure control gets bypassed**, because a report feels like a document rather than a query. It is a query, and it is treated as one.

### Audit

Every run and every export writes to [[VPS-F004_Silent_Audit_Log|VPS-F004]]: report type, parameters, actor, format, timestamp. Where a report contains Tier 1 content, the export is additionally recorded as a Tier 1 access.

### API contracts

```
report.list(workspaceId) -> { reportType, name, description, available }[]
  // available is false where the reader lacks access to the underlying data

report.run(reportType, parameters) -> { reportRunId, content }
  // Renders on screen. Passes every aggregate through VPS-A004

report.export(reportRunId, format: 'pdf' | 'csv') -> { downloadUrl }
  // Requires a prior run. Writes an audit entry.
  // Tier 1 content renders client-side

reportDefinition.save(reportType, name, parameters, schedule?) -> { definitionId }
reportDefinition.schedule(definitionId, cadence, userId) -> { success }
  // Delivery is always to the scheduling user's own Inbox
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | ReportDefinition and ReportRun carry the schemas above. ReportRun inherits its tier from its content per Standing Rule 8 |
| G02 | The report set is fixed. Adding one is an amendment to this document, never a configuration |
| G03 | An export requires a prior on-screen run. There is no path to export a report nobody viewed |
| G04 | Every aggregate passes through [[VPS-A004_Graph_Permission_Layer|VPS-A004]] before rendering. A suppressed figure is suppressed in the export with its reason, never blank |
| G05 | Every run and every export writes to [[VPS-F004_Silent_Audit_Log|VPS-F004]]. A Tier 1 export is additionally recorded as a Tier 1 access |
| G06 | A report containing Tier 1 content renders client-side per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. No server-side path assembles one |
| G07 | A scheduled report is delivered to the scheduling user's own Inbox only. Never emailed as an attachment, never delivered to another person |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F061-S01 | Report definitions and the fixed set | Data |
| VRS-F061-S02 | On-screen rendering | UI |
| VRS-F061-S03 | PDF and CSV export | Platform |
| VRS-F061-S04 | Scheduling and delivery | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an Owner runs a utilization summary
**WHEN** it renders
**THEN** it appears on screen with a header naming the parameters, timestamp and the person who ran it

---

**GIVEN** they then export it as PDF
**WHEN** export completes
**THEN** the document uses the same components as the web view, and an audit entry records the report, parameters, actor and format

---

**GIVEN** a report contains an aggregate below the disclosure threshold
**WHEN** it is exported as CSV
**THEN** the cell states the suppression rather than being blank, which a recipient would read as zero

---

**GIVEN** a Finance Admin runs a payroll summary
**WHEN** the PDF renders
**THEN** it is assembled client-side, and no server-side path received the Tier 1 figures

---

**GIVEN** the same report is scheduled quarterly
**WHEN** the quarter turns with no authorized device connected
**THEN** it is prepared when one next connects, and the delay is reported rather than presented as a failure

---

**GIVEN** an HR Admin attempts to run a payroll report
**WHEN** the library loads
**THEN** it is marked unavailable, and running it directly is refused

---

**GIVEN** someone attempts to export without a prior run
**WHEN** the attempt is made
**THEN** it is refused

---

**GIVEN** a scheduled report becomes ready
**WHEN** it is delivered
**THEN** it appears in the scheduling user's own Inbox and is not emailed as an attachment to anyone

---

## Non-Functional Requirements

- On-screen rendering resolves within 2 seconds for any report over 24 months of data
- PDF generation completes within 30 seconds per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s render timeout
- CSV export completes within 10 seconds
- On-screen rendering functions offline. Export requires connectivity for Tier 0 content, and an authorized device for Tier 1

---

## Security Considerations

- **An export is the one operation that moves data outside every guarantee this graph enforces.** Once a CSV of payroll figures is on someone's laptop, no tier, no permission row and no audit log governs what happens to it. That is why every export is recorded, why the set is fixed, and why nothing exports without first being viewed.
- **The fixed report set is a security decision, not a scoping one.** Arbitrary field selection is a query builder, and a query builder over this graph constructs disclosures nobody reviewed. Every report here has had its permission and disclosure behavior considered.
- **Suppression carries into exports**, and this matters more in CSV than on screen. A blank cell reads as zero to a spreadsheet and to a person, and a suppressed aggregate exported as blank would quietly become a false figure in a board pack.
- **Scheduled delivery goes to one person's Inbox, never to email.** An emailed report is an attachment forwarded onward, and the schedule feature would otherwise become the widest disclosure surface in the product.
- **Client-side rendering for Tier 1 is a hard constraint**, and it has a visible cost: scheduled payroll reports cannot be generated unattended. That cost is accepted, and the schedule reports the delay honestly rather than concealing it.

---

## Out of Scope

- **A custom report builder or arbitrary field selection** — permanently. See above
- **Direct delivery to a client or external recipient** — [[Vulto Comms]]' portal territory. This feature produces a file for a workspace member
- **Excel with formulas, or any live-linked format** — CSV is data; a spreadsheet with embedded logic is a second product
- **Report templating or per-workspace branding beyond the workspace logo** — the design system, applied consistently
- **Historical report reproduction.** A report re-run for the same period may differ if underlying data was corrected since. The run record states its timestamp; it does not freeze its contents

---

## Decisions Recorded

**This feature is new.** [[Vulto Roster]] promised board-ready PDF output that no feature produced, and three features deferred their own export to a feature that did not exist.

**Export requires a prior on-screen run.** The most common way a wrong figure reaches a board is that nobody read it before it left, and this is a cheap structural fix for it.

**The report set is fixed and closed.** A query builder over this graph is a way to construct a disclosure nobody reviewed, and every report in the set has had its behavior considered.

**Suppression carries into exports with its reason.** A blank cell in a CSV reads as zero, which converts a deliberate withholding into a false figure.

**Scheduled reports are delivered to one Inbox, never emailed.** An attachment is forwarded, and the convenience is not worth becoming the widest disclosure surface in the product.

**Historical reproduction is explicitly not guaranteed.** A report re-run for the same period may differ if data was corrected, and the run record's timestamp is what makes that transparent rather than confusing.

---

## Related Notes

- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the render service and the client-side constraint
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the disclosure control every report passes through
- [[VPS-F004_Silent_Audit_Log|VPS-F004]] — where every run and export is recorded
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — the workspace export, a different operation with a different purpose

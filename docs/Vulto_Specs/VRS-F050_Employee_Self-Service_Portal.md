---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Post-MVP
Feature Type:
  - Experience
aliases:
  - VRS-F050
---

# VRS-F050 — Employee Self-Service Portal

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee — gains a field-level-gated self-edit here, resolving that document's own deferral), [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] and [[VRS-F018_Leave_Policy_Engine|VRS-F018]] (leave and balance), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (documents), [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]] (certifications), [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] (policies), [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] (the employee's own pulse history), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] (payslips, once payroll exists)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## What this refuses to be

Not five links to five screens with a new header.

This feature has one seam nothing before it has closed: **an employee's own profile has been read-only to the employee since [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] was written**, deliberately deferred to here. And beyond that it is the one place someone who will never open the Bench Forecast, never approve a payroll run and never see a manager's queue goes to understand their own relationship with the agency — what they are owed, what they have been paid, what is on file about them, and who they are on record.

**Most people in a workspace will use only this screen.** That is worth stating, because it inverts the usual weighting: the surfaces this product spends most of its design effort on are the ones most employees never open.

---

## What It Is

A unified employee-facing surface across six domains: **leave**, **payslips**, **documents**, **policies**, **certifications**, and a genuine **self-edit** over a small curated set of one's own profile fields.

---

## Problem It Solves

Every domain already works and is already scoped to *my own data only* by its own permission row. What has never existed is a single place an employee goes to use any of it.

And more consequentially: **any way at all for an employee to correct their own phone number or preferred name** without filing a request with HR for a change that was always structurally theirs to make.

That last one is small and it is the one people notice. A person whose preferred name is wrong on every screen in the product, who has asked twice and been told it needs an admin, has learned something about how the agency regards them.

---

## User-Facing Flows

### Leave

Current balance per type computed live, a new request through the identical flow [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] built — Team Away overlay and all — and cancelation of a pending or future-dated approved request. Nothing reimplemented.

### Payslips

History, oldest to newest, and any individual payslip showing exactly what [[VRS-F062_Payroll_Engine_Core|VRS-F062]] computed. Nothing recomputed.

### Documents

Every document filed against them — an ID scan, a certification, a signed contract — downloadable through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s existing path. A Tier 1 document decrypts client-side exactly as that feature specifies.

### Policies

Every policy in scope, with its acknowledgement status and any outstanding acknowledgement actionable here.

### Certifications

What they hold, with expiry dates. **An expiring certification is their problem before it is the agency's**, and this is where they will see it.

### Profile, and the one new capability

Their profile as [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] renders it, with a small curated set editable directly: `preferred_name`, `phone`, `avatar_url`, `location`, `timezone`.

Every other field — job title, employment type, seniority, billing rate, every compensation field, every date governing employment status — remains exactly as read-only as it was, because none is the employee's to change unilaterally.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| My workspace | Content | The composed surface |

One screen with Tabs — Overview, Leave, Pay, Documents, Policies, Profile — rather than six navigation destinations. An employee visiting occasionally should find everything in one place rather than learning a navigation structure.

### Layout and components

**Overview** is the landing tab and answers *what do I need to know right now*: leave balance as a Stat row, any outstanding policy acknowledgement, any expiring certification, and the most recent payslip. Where none applies, it says so plainly.

**Leave** composes [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]]'s own surface unchanged.

**Pay** is a Table of payslips: period, gross, net, and a download action. Figures in `mono`. Opening one renders exactly what payroll computed, itemised.

**Documents** is a Table: name, category, date. A Tier 1 document carries a small lock glyph and decrypts on download.

**Policies** is a list with acknowledgement status. Outstanding items carry an **Acknowledge** action that opens [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]]'s reading surface, scroll gate and all — **the gate is not relaxed here.**

**Profile** renders every field, with the five editable ones as inline Inputs and everything else as read-only text. **Read-only fields are visibly so rather than merely non-interactive**, and each carries a one-line note on who to ask — *Changed by HR.* An employee who cannot edit a field should be told where the change happens rather than left clicking at it.

### Keyboard

Standard bindings. `1`–`6` switch tabs.

### System states

| State | Treatment |
|---|---|
| Syncing | Tabs render as they resolve |
| Restricted | Not applicable — every domain is already scoped to the caller |
| Aged out | Older payslips outside [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 1 window render dashed with **Fetch** |
| Empty | Each tab states its own emptiness plainly. *No payslips yet* for a new joiner, not an error |
| Error | A failed self-edit reverts the field visibly and states the reason |

### Responsive

Mobile-first and fully functional at 375px. **This is the surface most likely to be opened on a phone in the entire product**, and it is designed for that rather than adapted to it.

---

## Technical Architecture

### No new node type

Every read is a direct call into an existing function. The one write targets [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]'s existing schema — no new field, only who may write five of them, and only on their own record.

### The self-edit, gated as [[VRS-F039_Performance_Review_Cycle|VRS-F039]] gates a review entry

[[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s Employee operational row grants Team Member Read on their own and their team's records, not Full. **This feature does not correct that row.**

Widening it would grant every Team Member write access to every operational field on their own record — job title and seniority included — which is not this feature's intent and not what a self-service portal should quietly enable.

Instead `employee.updateSelfServiceFields` is a narrow purpose-built action, gated at the application layer to five fields on the caller's own record. The identical pattern [[VRS-F039_Performance_Review_Cycle|VRS-F039]] established for distinguishing self-assessment from manager assessment on one shared node, and [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] established for its capacity override. **No second permission primitive is invented; an existing one is applied a third time.**

### Why `avatar_url` is a plain upload

A profile photo is not an HR document. Routing it through [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s vault would misclassify a casual personal image alongside genuinely sensitive paperwork, and it would inherit retention schedules written for employment records.

`avatar_url` remains a plain string field, and the upload writes the resulting URL directly. No Document node, no provenance question.

### API contracts

```
selfService.getOverview(employeeId) -> {
  leaveBalances, outstandingPolicies, expiringCertifications, latestPayslip?
}

selfService.getLeaveSummary(employeeId) -> { balances, recentRequests }
  // Calls VRS-F018's balance computation and VRS-F019's request list directly

selfService.submitLeaveRequest(...)  -> // Calls VRS-F019's submit, unmodified
selfService.cancelLeaveRequest(...)  -> // Calls VRS-F019's cancel

selfService.listMyPayslips(employeeId) -> PaySlip[]
selfService.getPayslip(paySlipId)      -> PaySlip
  // Structurally absent if it does not belong to the caller

selfService.listMyDocuments(employeeId)     -> Document[]
selfService.getDocumentDownloadUrl(documentId) -> { url, requiresClientDecryption }

selfService.listMyPolicies(employeeId)      -> { policy, acknowledgedAt?, isOverdue }[]
selfService.listMyCertifications(employeeId) -> { name, expiryDate, isExpiring }[]

selfService.getMyProfile(employeeId)        -> Employee

employee.updateSelfServiceFields(employeeId, {
  preferredName?, phone?, avatarUrl?, location?, timezone?
}) -> { success }
  // Caller's own record only. Touches only these five fields, enforced at
  // the application layer. Writes atomically
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type and no field. Every read calls an existing function owned elsewhere |
| G02 | `employee.updateSelfServiceFields` writes only the five named fields, and only on the caller's own record. Every other field remains governed by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s unmodified row |
| G03 | No permission row is added or corrected. The one new capability is gated at the application layer, per the established pattern |
| G04 | Every action delegates to its originating feature's already-permissioned mutation. No business logic is duplicated |
| G05 | `avatar_url` is a plain string. No Document node is created for a profile photo |
| G06 | [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]]'s scroll gate applies unchanged when acknowledging a policy here |
| G07 | The self-edit writes atomically. A partial update where one field saves and another silently fails never occurs |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F050-S01 | Overview composition | UI |
| VRS-F050-S02 | Leave, pay and document surfaces | UI |
| VRS-F050-S03 | Policies and certifications | UI |
| VRS-F050-S04 | Profile view and field-level self-edit | Logic |

---

## Feature Acceptance Criteria

**GIVEN** an employee opens their leave summary
**WHEN** it loads
**THEN** balances and recent requests render, computed and read directly from their owning features with no figure recomputed here

---

**GIVEN** they submit a leave request through this portal
**WHEN** it completes
**THEN** it behaves identically to submitting through [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]]'s own screen, including any non-blocking policy warning

---

**GIVEN** they attempt to open another employee's payslip by altering an identifier
**WHEN** the request is made
**THEN** it is structurally absent, per that node's own permission row

---

**GIVEN** they update their preferred name and timezone
**WHEN** it saves
**THEN** both change atomically and no other field is touched

---

**GIVEN** they attempt to modify their own job title through this feature's action
**WHEN** the attempt is made
**THEN** it is refused, since the action accepts only the five whitelisted fields

---

**GIVEN** they view a read-only field such as seniority
**WHEN** it renders
**THEN** it is visibly read-only with a note naming who changes it, rather than an input that does nothing

---

**GIVEN** they acknowledge an outstanding policy here
**WHEN** the reading surface opens
**THEN** the scroll gate applies exactly as [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] specifies

---

**GIVEN** they download a Tier 1 signed contract
**WHEN** the download is requested
**THEN** it decrypts client-side per [[VRS-F022_Encrypted_Document_Vault|VRS-F022]], with no second mechanism introduced

---

**GIVEN** a manager attempts to use this feature to view a report's payslips or documents
**WHEN** the attempt is made
**THEN** every underlying permission row already excludes it, and this feature adds no exception

---

## Non-Functional Requirements

- Every composed view resolves within 300ms from the local graph
- Full functionality offline across every domain, since each composed feature supports it
- The self-edit writes atomically
- The full surface is usable at 375px without horizontal scroll

---

## Security Considerations

- **This feature's security posture is almost entirely inherited.** Five of six domains add no new access surface; every guarantee proven in their own documents holds here automatically.
- **The self-edit is the one new capability and it is deliberately narrow.** Widening Team Member's Employee row rather than gating five fields at the application layer would have granted far more than a personal-preference update needs, and created exactly the over-broad write access this project has avoided everywhere else.
- **No compensation, employment-status or organizationally-controlled field is reachable through this write path**, regardless of how the request is constructed, since the action never accepts a field name outside its whitelist.
- **This is the surface a departing or disgruntled employee is most likely to use to gather information about their own employment.** That is legitimate — it is their data — and it is worth being conscious that the document list, the payslip history and the policy acknowledgement record are exactly what someone assembles before raising a grievance. The feature should make that straightforward rather than obstructed, because obstruction would be both wrong and, under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s access rights, futile.

---

## Out of Scope

- **Self-editing beyond the five named fields** — a future widening is a separate decision requiring its own scrutiny
- **Uploading a document into [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s vault.** This feature reads and downloads; upload remains an HR Admin flow
- **Performance review or career pathing content** — those features' own territory. This surface is deliberately narrower than *everything about me*
- **Anything a manager can see about the employee.** This is what the employee's own record holds, not a mirror of what others hold about them
- **Any change to the underlying logic of what it composes** — this feature composes, it never modifies

---

## Decisions Recorded

**This feature moves from Mature to Post-MVP.** It composes MVP features and needs nothing from the ecosystem layer, and it is the surface most people in a workspace will actually use — building it last would mean most employees experienced the product as a collection of screens they had no reason to open.

**Policies and certifications are added as domains.** Both are personal, both were previously reachable only through screens designed for HR, and an expiring certification is the employee's problem before it is the agency's.

**An Overview tab is added as the landing surface.** The previous specification was four parallel domains with no answer to *what do I need to know right now*, which is the actual question someone opens this with.

**Read-only fields state who changes them.** An employee clicking at a field that does nothing, with no indication of where the change happens, is the small indignity this feature exists to remove.

**The scroll gate is not relaxed here.** [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]]'s acknowledgement gate is the only artificial friction in the product and composing it into a convenience surface would be exactly the place someone would be tempted to drop it.

---

## Related Notes

- [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] — the profile whose self-edit deferral this resolves
- [[VRS-F049_Manager_Dashboard|VRS-F049]] — the manager-facing counterpart
- [[VRS-F044_Policy_Library_and_Acknowledgement|VRS-F044]] — the acknowledgement gate applied unchanged
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — the access rights this surface partially anticipates

---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Mature
Feature Type:
  - Platform
aliases:
  - VPS-F009
---

# VPS-F009 — Vulto Sync API

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] and [[VRS-F068_Expense_Management|VRS-F068]] (the Tier 0 sources), [[VRS-F062_Payroll_Engine_Core|VRS-F062]] and [[VRS-F067_Contractor_Invoice_Management|VRS-F067]] (**the Tier 1 sources, exported by a genuinely different mechanism**), [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the API service and Web Worker boundary), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (the encryption model this design works around and never weakens), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (**webhook delivery, retry and dead-lettering, resolved there**), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (IntegrationConfig)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature. **It is a Vulto API, never a Roster API.** Each application registers its own scopes and webhook events into the registries below.

---

## Not [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]]

The two are easy to transpose and are entirely different.

**This feature is external-facing** — a documented, versioned API for third parties genuinely outside the Vulto ecosystem: an agency's existing Xero or QuickBooks, a Zapier automation, a custom webhook.

**[[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] is internal and never customer-facing** — the mechanism by which other Vulto applications write the same graph.

Nothing here builds, anticipates or assumes any part of that.

---

## The wall this feature cannot build around

A third-party accounting integration is the headline use case, and **the most useful data for it — invoice amounts, payroll totals — is Tier 1, end-to-end encrypted specifically so Vulto's servers can never read it.**

That is not a detail to work around quietly. Roster's servers genuinely cannot decrypt a payroll total to serve it over HTTP, because that capability was deliberately never built into the server at all.

Two honest paths exist, and this feature takes the one that does not compromise the guarantee.

**Tier 0 data** — employee operational fields, timesheets, expenses — is genuinely server-readable and served the ordinary way: direct requests and instant server-fired webhooks.

**Tier 1 data** can only be decrypted on a device that already holds the keys. This feature invents no new key-distribution scheme to route around that. Export for Tier 1 scopes is **client-initiated**: whenever an authorized device is online, it decrypts what is newly relevant since its last export and posts it directly to the configured webhook, signed for the receiver to verify. **Roster's server never sees the plaintext at any point.**

**The honest cost, stated plainly:** Tier 1 webhook delivery is eventually consistent — delivered by the next authorized device to come online, not instantly the way a Tier 0 event fires. **There is no pull endpoint for Tier 1 scopes at all**, since one would require the server to hold something decrypted at rest.

---

## What It Is

A read-only, scoped, key-authenticated REST surface for third-party integrations, alongside webhook delivery — instant for Tier 0, eventual for Tier 1.

---

## Problem It Solves

An agency already running Xero or QuickBooks has no way today to get Roster's operational and financial data into those tools without manual export or a bespoke integration built from nothing.

This is the documented, stable surface that makes that connection possible **without asking this project's encryption guarantees to bend for convenience.**

---

## User-Facing Flows

### Creating an integration

An Owner names it, selects scopes from a small fixed list, and provides a receiving URL where webhooks are wanted. **The key and webhook secret are displayed exactly once**, with an unmistakable warning that neither can be retrieved again.

### A Tier 0 event

An expense reaches reimbursed. The server fires the webhook within seconds. No device involvement.

### A Tier 1 event

A payroll run is finalized while every authorized device is offline. **Nothing fires yet.** The next time an Owner or Finance Admin opens the app on an authorized device, that device's background process decrypts the newly finalized totals and posts the webhook directly, signed, without the payload passing through Vulto's server in decrypted form.

### Revoking

An Owner revokes at any time. The key stops authenticating immediately.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Integrations | Content + Panel | Manage |
| Create integration | Modal | Scopes and secret display |

Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

### Layout and components

**Integrations** is a Table: name, scopes as Badges, status, last used, and **delivery health** — the count of recent webhook failures per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s dead-letter queue.

That last column is the useful one. A silently failing integration is the most common failure of this kind of feature, and an agency discovers it when their accounting is a month behind.

**The creation Modal** displays the key and secret in `mono` on a `raised` Card with a **Copy** action and a single unambiguous line: *This is the only time these will be shown.* The **Done** action is disabled until both have been copied or explicitly acknowledged.

**Tier 1 scopes are visually distinguished at selection**, with a plain note: *Delivered when an authorized device is next online, not instantly.* An integrator discovering eventual consistency after building against it has been misled by omission.

**The Panel** shows recent deliveries with status and timestamp, and for a Tier 1 scope, when the last export watermark advanced. *Last Tier 1 export: 3 hours ago* is what tells someone whether the mechanism is working.

### Keyboard

Standard bindings.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton |
| Restricted | Owner only. Structurally absent for every other role |
| Failing | Repeated failures render `attention` with the count and the last reason |
| Stale Tier 1 | An export watermark older than seven days renders `attention`, since it means no authorized device has been online |
| Empty | *No integrations.* |
| Error | A webhook URL that is not HTTPS is refused |

### Responsive

Drops `last used`, then `scopes`, below 1280px.

---

## Technical Architecture

### The IntegrationConfig schema

Owner only, Tier 2.

```
integration_config_id:  UUID v4
workspace_id:           UUID
name:                   string
api_key_hash:           string — the key is displayed once and never stored
                        in retrievable form
scopes:                 JSON array: ReadEmployeeDirectory, ReadTimesheetEntry,
                        ReadExpense, ReadInvoice, ReadPayRunTotals
                        — read-only across the board
webhook_url:            string, nullable — HTTPS required
webhook_events:         JSON array: EmployeeCreated, TimesheetEntrySubmitted,
                        ExpenseReimbursed (Tier 0, instant);
                        InvoicePaid, PayRunFinalized (Tier 1, eventual)
webhook_secret_hash:    string, nullable — for HMAC signing. Shown once
rate_limit_per_minute:  integer, default 100
last_tier1_export_at:   timestamp, nullable — the watermark a device reads to
                        determine what is newly relevant
status:                 enum: Active, Revoked
last_used_at:           timestamp, nullable

— Universal Node Conventions per VPS-A002 —
```

### The Tier 0 surface

```
GET /api/v1/employees
  -> [{ employeeId, fullName, jobTitle, department, employmentType, startDate }]
  // Operational identity only. No compensation field of any kind

GET /api/v1/timesheet-entries?since={date}
  -> [{ entryId, employeeId, date, hours, timeCategory }]

GET /api/v1/expenses?since={date}&status=Reimbursed
  -> [{ expenseId, employeeId, category, amount, currency, expenseDate }]
```

### Tier 1 scopes, webhook only

`ReadInvoice` and `ReadPayRunTotals` grant webhook eligibility only. **No GET endpoint exists for either.**

`PayRunFinalized` delivers the run's totals **in its own native currency**, deliberately not normalized — an accounting system needs the actual transaction currency for its books, not a comparison figure. `totalEmployerCost` is included as a distinct figure, since most payroll journal entries expect the employer contribution separately from gross wages.

### Client-side export

Runs in the Web Worker per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]], on an authorized device, when online. It reads `last_tier1_export_at`, decrypts what has changed since, signs with the webhook secret, posts directly to the configured URL, and advances the watermark **only on a successful delivery.**

A failed delivery leaves the watermark unmoved, so the next device retries rather than skipping. **The alternative — advancing optimistically — silently drops a payroll run from an agency's accounting.**

### Webhook delivery

Tier 0 delivery, retry, backoff and dead-lettering follow [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — five attempts, exponential backoff, dead-lettered and surfaced to the Owner. **Resolved there rather than left as this document's own open item**, as the previous version had it.

### API contracts

```
integration.create(name, scopes, webhookUrl?, webhookEvents?) -> {
  integrationConfigId, apiKey, webhookSecret
}
  // Owner only. Key and secret returned once, never retrievable again

integration.revoke(integrationConfigId) -> { success }
integration.list(workspaceId)           -> IntegrationConfig[]
integration.deliveryHistory(integrationConfigId) -> {
  recent: { event, status, attemptedAt, failureReason? }[],
  lastTier1ExportAt
}

tier1Export.run(workspaceId) -> { exported, watermarkAdvanced }
  // Client-side, on an authorized device. Not an external endpoint
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | IntegrationConfig carries the schema above, Owner only, Tier 2 |
| G02 | The key and webhook secret are stored as hashes only and are never retrievable after creation |
| G03 | No GET endpoint exists for a Tier 1 scope. Webhook push is the only delivery path |
| G04 | Tier 1 export runs client-side on an authorized device. No server-side path decrypts Tier 1 content for this feature |
| G05 | The export watermark advances only on successful delivery |
| G06 | Every scope is read-only. No write endpoint exists |
| G07 | The employee endpoint returns operational fields only. No compensation field is exposed at any tier |
| G08 | Tier 0 webhook delivery follows [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s retry and dead-letter model |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F009-S01 | IntegrationConfig and key issuance | Security |
| VPS-F009-S02 | Tier 0 REST surface | Platform |
| VPS-F009-S03 | Tier 0 webhook delivery | Platform |
| VPS-F009-S04 | Client-side Tier 1 export | Security |
| VPS-F009-S05 | Delivery health surface | UI |

---

## Feature Acceptance Criteria

**GIVEN** an Owner creates an integration
**WHEN** it is created
**THEN** the key and secret display once, and no subsequent request retrieves either

---

**GIVEN** an expense reaches reimbursed
**WHEN** the event fires
**THEN** the webhook is delivered from the server within seconds, with no device involvement

---

**GIVEN** a payroll run is finalized while every authorized device is offline
**WHEN** it is finalized
**THEN** no webhook fires, and the next authorized device online decrypts, signs and posts it directly

---

**GIVEN** that delivery fails
**WHEN** the attempt completes
**THEN** the watermark does not advance, and the next authorized device retries the same run

---

**GIVEN** an integration holds `ReadPayRunTotals`
**WHEN** a GET is attempted for payroll data
**THEN** no such endpoint exists

---

**GIVEN** the employee endpoint is called
**WHEN** the response returns
**THEN** it contains operational fields only, and no compensation figure at any tier

---

**GIVEN** a Tier 1 export watermark older than seven days
**WHEN** the integrations list renders
**THEN** it renders `attention`, since no authorized device has been online

---

**GIVEN** a webhook URL that is not HTTPS
**WHEN** the integration is created
**THEN** it is refused

---

## Non-Functional Requirements

- Tier 0 endpoints respond within 500ms at the default rate limit
- Tier 0 webhooks deliver within 10 seconds of the triggering event
- Tier 1 export completes within 30 seconds of an authorized device coming online
- Rate limiting is enforced per integration through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s Redis

---

## Security Considerations

- **The Tier 1 design is the substantive decision.** The convenient implementation — a server-side export — would require Vulto's servers to hold decrypted payroll data, defeating the guarantee [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] exists to make. Client-side export costs immediacy and preserves the guarantee, and the cost is stated to integrators rather than discovered.
- **Every scope is read-only.** A write API against this graph would need to reason about the capacity constraint, the approval gates and the write-authority rules [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] enforces, and a third party bypassing those is not a feature.
- **The key is shown once.** A retrievable key is a key that lives in a screenshot.
- **The employee endpoint exposes no compensation at any tier**, including the Tier 0 billing rate. An integration wanting operational identity does not need what the agency charges for someone's time, and the narrower surface is the correct default.
- **A failing integration is surfaced rather than silent.** The most common failure of this kind of feature is an integration that stopped working and told nobody.

---

## Out of Scope

- **Any write endpoint** — permanently. Writes bypass constraints this product enforces for good reasons
- **A pull endpoint for Tier 1 scopes** — would require the server to hold decrypted or re-encrypted data at rest
- **OAuth or per-user authorization** — a workspace-level key issued by an Owner. Per-user third-party authorization is a materially larger surface
- **GraphQL or a query language** — fixed endpoints with fixed shapes
- **Pre-built connectors for specific products** — this is the surface a connector is built against

---

## Decisions Recorded

**Webhook delivery, retry and dead-lettering are resolved by [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]** rather than carried as this document's open item. It was correctly flagged as architecture-level and now has an architecture-level answer.

**Delivery health is surfaced in the interface.** The previous specification tracked failures and showed them nowhere. An integration that stopped working a month ago, discovered when the accounting is a month behind, is this feature's characteristic failure.

**The Tier 1 export watermark advances only on success.** The previous specification did not say, and the optimistic alternative silently drops a payroll run from an agency's books.

**Tier 1 scopes are marked as eventually consistent at the point of selection.** An integrator discovering that after building against it has been misled by omission.

**The employee endpoint exposes no compensation, including the Tier 0 billing rate.** An integration wanting operational identity does not need what the agency charges for someone's time.

---

## Related Notes

- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the encryption model this design works around
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — webhook delivery and retry
- [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] — the internal counterpart this is not
- [[VRS-F062_Payroll_Engine_Core|VRS-F062]] — the payroll totals exported client-side

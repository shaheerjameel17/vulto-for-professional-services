---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-A006
---

# VPS-A006 — Platform Services and Infrastructure

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the stack these services run within), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (the tier model governing what may be sent, stored or logged)
**Blocks:** [[VRS-F021_E-Signature_Native|VRS-F021]], [[VRS-F022_Encrypted_Document_Vault|VRS-F022]], [[VPS-F003_Notification_and_Alert_Center|VPS-F003]], [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]], [[VPS-F009_Vulto_Sync_API|VPS-F009]], and every feature that sends a message, stores a file, runs on a schedule or produces a document

This document is the single source of truth for the infrastructure services [[Vulto for Professional Services]] depends on and that no feature, in any application, may choose for itself.

---

## Why this document exists

The previous specification set flagged the same category of gap four separate times, each from a different feature, each correctly identifying it as an architecture decision, and none of them having anywhere to put it.

[[VRS-F021_E-Signature_Native|VRS-F021]] observed that no document specifies how a signing email is delivered, and noted that at least five other features depend on the same unmade decision. [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] observed that no document specifies where an encrypted file blob physically lives. [[VPS-F009_Vulto_Sync_API|VPS-F009]] deferred webhook retry, dead-lettering and delivery confirmation as an implementation detail. [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]]'s board-pack PDF has no rendering mechanism anywhere in the architecture.

Each was flagged honestly. None was answered, and an unanswered infrastructure question does not stay unanswered — it gets answered six times, differently, by six features. This document answers each once.

---

## Transactional email

**Decision: Resend**, with React Email for templating.

Chosen because it is TypeScript-native and templates are authored as React components in `packages/ui`, which means a transactional email inherits [[VPS-D001_Design_Foundations|VPS-D001]]'s tokens rather than being a second, drifting implementation of the brand. It runs on Amazon SES underneath, so deliverability is mature infrastructure rather than a startup's own mail servers. Postmark is the documented fallback if deliverability to Pakistani or Gulf corporate mail servers proves inadequate in practice; the sending interface is abstracted so that substitution is a configuration change.

### The boundary with lifecycle email

**Loops is the decided provider for lifecycle and marketing email**, and it is deliberately not the provider for anything in this specification set.

The distinction is the shape of the message, not the vendor's quality. **Every message this product sends is a prompt with a link** — a signature request, an approval waiting, a certification expiring, a payslip available. Not one is a sequence, a campaign, or a message whose timing is decided by anything other than an event that just occurred.

Lifecycle email — onboarding sequences, product announcements, re-engagement — is a real need Vulto will have, and it is **the company emailing its customers rather than the product notifying its users.** It never carries workspace data, never resolves a role, and never reaches an employee who is not also a billing contact.

**The two never share a sender domain**, per the reasoning below: a marketing send that attracts spam complaints must not degrade the deliverability of a signing request.

`EmailService` in `packages/schema` is the transactional interface only. **No feature in this set calls Loops**, and a lifecycle send from feature code is a lint failure per [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]].

### Sender domain

Transactional mail sends from a dedicated subdomain — `mail.vulto.app` — never the root domain and never a domain shared with marketing. This is not fastidiousness: a marketing campaign that attracts spam complaints on a shared domain will degrade the deliverability of signing requests and payroll notifications, and the first symptom will be a contract that a client says they never received.

SPF, DKIM and DMARC are mandatory before the first production send, with DMARC at `p=quarantine` initially and `p=reject` once the reporting is clean.

### The rule that governs email in this product

> **Email is a notification channel. It is never the system of record, and it is never the only path to a required action.**

Every action reachable from an email is reachable from [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox, in whichever application raised it. Every state an email reports is visible in the product. If a workspace's mail is silently discarded by an over-aggressive corporate filter, nothing in this product becomes unreachable — it becomes less convenient. Signing links per [[VRS-F021_E-Signature_Native|VRS-F021]] are the single deliberate exception, since a signatory has no account by design, and that exception carries its own expiry and audit trail.

### Handling and content

Bounces and complaints are received by webhook and recorded against the recipient, and a hard bounce surfaces in the product rather than silently disappearing — an employee whose address is wrong should be visible as a problem to fix, not as mail that goes nowhere.

**No Tier 1, Tier 2 or Tier 3 content is ever placed in an email body.** A payroll notification says a payslip is available; it does not contain the figure. A wellness feature sends nothing at all. Email content is limited to the fact that something happened and a link to the product, which is where permission is actually enforced.

---

## Object storage

**Decision: DigitalOcean Spaces**, S3-compatible, same vendor as the backend per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]].

| Aspect | Decision |
|---|---|
| Bucket layout | One bucket per environment, keyed `{workspace_id}/{node_type}/{node_id}/{blob_id}` |
| Access | Presigned URLs exclusively, 15-minute TTL. No public objects, no CDN for private content |
| Versioning | Enabled. Overwrites are recoverable |
| Lifecycle | Governed by [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s retention schedules, never by a bucket policy invented separately |
| Upload scanning | Every upload scanned for malware before it becomes retrievable. A pending scan renders as the syncing state per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] |
| Size limits | 25MB per file default, configurable per workspace in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |

### Encryption boundary, which is the part that matters

Spaces stores ciphertext for anything above Tier 0. [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] establishes that a document's tier is inherited from its provenance, and that inheritance is enforced at the storage boundary:

- **Tier 0** blobs are stored with server-side encryption at rest. Vulto holds the keys.
- **Tier 1 and Tier 2** blobs are encrypted client-side, in the Web Worker, before upload. Spaces receives ciphertext and object metadata that reveals only workspace, size and timestamp. Vulto's infrastructure cannot read a signed employment contract or a salary letter, by construction rather than by policy.

Object keys deliberately contain no human-readable content. A key that read `.../ahmed-khan-termination-letter.pdf` would leak through bucket metadata precisely what encrypting the body was intended to protect.

---

## Job queue and scheduling

**Decision: BullMQ on DigitalOcean Managed Redis**, workers in `services/jobs`.

Postgres-based alternatives such as pg-boss were considered and would avoid a second data store. The decision went the other way because this product's recurring-job surface is substantial rather than incidental — [[VRS-F012_Revenue_Gap_Alert|VRS-F012]]'s four-hourly bench sweep, [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]]'s capacity safety-net sweep, [[VRS-F041_Certification_and_Training_Tracker|VRS-F041]]'s certification expiry checks, [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s transition warnings, [[VRS-F035_Background_Check_Integration|VRS-F035]]'s provider polling, [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]]'s survey cadence, [[VRS-F062_Payroll_Engine_Core|VRS-F062]]'s payroll scheduling, [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s digests, and [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s retention sweeps, before any webhook is delivered at all. Redis additionally serves rate limiting for [[VPS-F009_Vulto_Sync_API|VPS-F009]], which would otherwise need its own mechanism.

### Job classes

| Class | Retry | Notes |
|---|---|---|
| `scheduled` | 3, exponential from 1 minute | Recurring evaluations. Idempotent by requirement, since a repeated run must not double-alert |
| `webhook` | 5, exponential from 10 seconds to 1 hour | Per [[VPS-F009_Vulto_Sync_API|VPS-F009]]. Dead-lettered after final failure and surfaced to the workspace Owner |
| `render` | 2, no backoff | PDF generation, delegated to `services/render` |
| `email` | 3, exponential from 30 seconds | Resend delivery |
| `import` | 0 | [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]] bulk import. Never retried automatically; a partial import is resumed deliberately, not repeated blindly |

Every job carries a workspace identifier and runs under that workspace's permission context. A job is not an authority bypass, and a scheduled evaluation that can read what a user cannot is a permission hole with a cron expression attached.

**Jobs never touch Tier 1 or Tier 3 plaintext.** Server-side workers operate on ciphertext or on Tier 0 data exclusively. Where an evaluation genuinely requires Tier 1 content — payroll calculation — it runs client-side in an authorized session, and the job's only role is to notify someone that it is ready to be run.

---

## Document rendering

**Decision: headless Chromium via Playwright**, isolated in `services/render`.

The alternative — a PDF library building documents programmatically — was rejected for a specific reason. This product generates contracts ([[VRS-F020_Universal_Contract_Builder|VRS-F020]]), payslips ([[VRS-F062_Payroll_Engine_Core|VRS-F062]]), board packs ([[VRS-F061_Reporting_and_Export_Engine|VRS-F061]]) and utilization reports, and each must look like Vulto. A PDF library means implementing [[VPS-D001_Design_Foundations|VPS-D001]] a second time in a different rendering model, and the two will diverge within a quarter. Rendering the same React components the web application uses means a generated document is the design system by construction.

The cost is real and is accepted: headless Chromium is memory-hungry and must be isolated so that a rendering spike cannot degrade the API. `services/render` is separately scaled, has a hard concurrency cap, and a 30-second timeout per document.

Rendering runs server-side against a permission-scoped session. Where a document contains Tier 1 content, it is rendered client-side instead and never leaves the authorized device unencrypted — a payslip PDF assembled on Vulto's servers would defeat the encryption model that made the salary field unreadable in the first place.

---

## Product analytics

**Decision: PostHog**, self-hosted on the same DigitalOcean infrastructure as the rest of the backend.

Self-hosted rather than cloud, and the reason is the same one that governs everything else here: **an HR product cannot send its customers' usage data to a third party's servers by default**, and a self-hosted deployment means analytics never leaves infrastructure Vulto already controls and already discloses.

### The problem local-first creates, stated plainly

**Most reads in this product never reach a server.** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s materialized index means opening the Bench Forecast, searching, navigating a profile and filtering a table are all local operations. Conventional server-side analytics would see almost none of the product being used.

Client-side event capture solves that and introduces a worse problem, which is why this needs a decision rather than an integration.

### What may be captured, and what may never be

**Captured:** that a surface was opened, that an action completed, that a keyboard shortcut was used, that a flow was abandoned at a named step, and how long a rendered operation took against its [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] budget.

**Never captured, at any tier:** any field value, any node identifier, any employee or candidate name, any figure, any free-text content, and any property from which a specific person could be inferred.

**The rule: an event carries a surface and an outcome, never a subject.** *Bench Forecast filtered by skill* is a legitimate event. *Bench Forecast filtered to Priya Sharma* is not, and the distinction is not a matter of care at the call site — it is enforced by the event schema, which accepts no free-form property bag.

### Event schema is typed and reviewed

Events are declared in `packages/schema` as a closed union, exactly as node types are. **A new event is a schema change reviewed like any other**, which means an engineer cannot add one carrying a property nobody classified.

Per [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]], the encryption boundary gate tests the analytics payload alongside the log redaction allowlist. **Analytics is a disclosure surface and is treated as one.**

### Workspace-level opt-out

An Owner may disable product analytics for their workspace in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]. **Doing so disables capture entirely rather than anonymizing it further** — a customer who does not want their usage measured has said something unambiguous, and a reduced-fidelity fallback would be answering a question they did not ask.

Error tracking is separate and is not covered by this opt-out, since an error report is diagnostic rather than behavioral and the product cannot be supported without it.

---

## Support and documentation surfaces

Two external services need a product surface, and both are named here so that [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s shell accounts for them rather than each being bolted on later.

**Plain** for customer support. An in-app entry point from the sidebar foot, carrying the workspace identifier and the current user's role — **and no other context.** A support widget that captures a screenshot or the current screen's data would exfiltrate exactly what every tier boundary in this product exists to protect.

**Featurebase** for changelog, roadmap and user documentation. A documentation link from the sidebar, and a changelog surface reachable from settings. Both are outbound links to a hosted service, carrying nothing.

**Neither service ever receives workspace data.** Both are configured through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s provider abstraction like any other external service, and neither is reachable from feature code directly.

---

## Observability

| Concern | Decision |
|---|---|
| Error tracking | Sentry, backend and frontend |
| Structured logging | Pino, JSON, shipped to DigitalOcean managed logging |
| Uptime | External monitor against a health endpoint on each service |
| Metrics | Job queue depth, sync latency percentiles, API latency percentiles, render queue depth |

**What is never logged, at any level, in any environment:** Tier 1, Tier 2 and Tier 3 field values; decrypted content of any kind; authentication tokens, API keys or signing links; the contents of a wellness entry, a pulse response, a salary or a contract.

This is enforced by a field-level redaction allowlist in the logging layer rather than by developer discipline, because developer discipline fails at three in the morning during an incident. [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s audit log records that Tier 1 data was accessed; the application log records nothing about it at all. The two are deliberately different mechanisms with different guarantees.

---

## Environments, backup and recovery

Three environments: `development` local, `staging` with synthetic data only, and `production`. **Production data is never copied into staging.** Reproducing a production bug uses synthetic fixtures or a customer-authorized, redacted extract, never a database restore — an HR product whose staging environment contains real salaries and real wellness entries has one production environment with two names.

| Aspect | Target |
|---|---|
| Postgres backup | Continuous, point-in-time recovery, 30-day window |
| Spaces backup | Versioning enabled plus weekly cross-region replication |
| RPO | 5 minutes |
| RTO | 4 hours |
| Restore rehearsal | Quarterly, against staging, with the result recorded |

A backup that has never been restored is a hypothesis. The rehearsal requirement is what converts it into a fact.

**Local-first is a genuine resilience property here and worth stating.** Every device holds a materialized copy of the graph it is authorized to see. A total server outage degrades this product to read-only local operation with queued writes, rather than to a blank page. That is a consequence of [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s architecture rather than a disaster recovery feature, but it is the reason the RTO above is tolerable.

---

## Provider abstraction

Every service in this document sits behind an interface in `packages/schema`, and no feature calls a vendor SDK directly. Email is sent through `EmailService`, blobs through `BlobStore`, jobs through `JobQueue`, documents through `RenderService`.

This is not portability theater. [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] has to accommodate a payment provider that does not exist yet and may not for years; [[VRS-F035_Background_Check_Integration|VRS-F035]] connects to a background-check provider deliberately left unnamed; and Resend, Spaces and Sentry are all replaceable choices made by a founder without a CTO, which is precisely the situation in which reversibility is worth paying a small tax for.

---

## Technical specifications

| ID | Specification |
|---|---|
| A006-T01 | Transactional email MUST send from a dedicated subdomain with SPF, DKIM and DMARC configured before the first production send |
| A006-T02 | Email bodies MUST NOT contain Tier 1, Tier 2 or Tier 3 field values. Email MUST link to the product rather than reproduce protected content |
| A006-T03 | Every action initiated by email MUST also be reachable from [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s Inbox, excepting signing links for signatories without accounts |
| A006-T04 | Blobs above Tier 0 MUST be encrypted client-side before upload. The object store MUST NOT receive plaintext for those tiers |
| A006-T05 | Object keys MUST NOT contain human-readable subject matter |
| A006-T06 | All blob access MUST use presigned URLs with a TTL not exceeding 15 minutes. No object is publicly readable |
| A006-T07 | Every uploaded file MUST be malware-scanned before becoming retrievable |
| A006-T08 | Every job MUST execute under a workspace permission context and MUST NOT read data the initiating context could not |
| A006-T09 | Server-side jobs MUST NOT access Tier 1 or Tier 3 plaintext. Such work executes in an authorized client session |
| A006-T10 | Scheduled jobs MUST be idempotent. A repeated run MUST NOT produce a duplicate alert, notification or record |
| A006-T11 | Documents containing Tier 1 content MUST be rendered client-side and MUST NOT be assembled on Vulto infrastructure |
| A006-T12 | Application logs MUST NOT contain Tier 1, Tier 2 or Tier 3 values, decrypted content, tokens, keys or signing links, enforced by a redaction allowlist rather than convention |
| A006-T13 | Production data MUST NOT be copied into any non-production environment |
| A006-T14 | Backup restoration MUST be rehearsed quarterly against staging with the outcome recorded |
| A006-T15 | Every external provider MUST be accessed through an interface in `packages/schema`. No feature MUST import a vendor SDK directly |
| A006-T16 | Lifecycle and marketing email MUST NOT share a sender domain with transactional email, and MUST NOT be sent from feature code |
| A006-T17 | Product analytics events MUST be declared as a closed typed union in `packages/schema`. A free-form property bag is prohibited |
| A006-T18 | An analytics event MUST NOT carry a field value, a node identifier, a name, a figure, free-text content, or any property from which a person could be inferred |
| A006-T19 | Product analytics MUST be self-hosted. Workspace usage data MUST NOT reach a third-party analytics service |
| A006-T20 | A workspace-level analytics opt-out MUST disable capture entirely rather than reducing fidelity |
| A006-T21 | The support and documentation surfaces MUST carry a workspace identifier and role only. Screen capture, data capture and page-content transmission are prohibited |

---

## Acceptance criteria

**GIVEN** a feature needs to send an email
**WHEN** it is implemented
**THEN** it calls `EmailService` with a React Email template from `packages/ui`, and no vendor SDK appears in the feature's code

---

**GIVEN** a Tier 1 document is uploaded to [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]
**WHEN** the object is inspected directly in the object store by an operator with full infrastructure access
**THEN** the content is unreadable ciphertext and the object key reveals nothing about its subject

---

**GIVEN** a webhook endpoint is unreachable for an extended period
**WHEN** delivery is attempted
**THEN** it retries five times with exponential backoff, dead-letters, and surfaces to the workspace Owner rather than failing silently

---

**GIVEN** an incident requires investigating a failed payroll run
**WHEN** an engineer reads the application logs
**THEN** they see the run identifier, timing and error class, and no salary figure, no employee name and no decrypted content

---

**GIVEN** a developer adds an analytics event carrying an employee name
**WHEN** the encryption boundary gate runs per [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]]
**THEN** it fails, because the event schema accepts no such property

---

**GIVEN** an Owner disables product analytics for their workspace
**WHEN** any surface is subsequently used
**THEN** no event is captured at all, and error tracking continues unaffected

---

**GIVEN** the production database is lost entirely
**WHEN** recovery begins
**THEN** service is restored within 4 hours with no more than 5 minutes of data loss, and every device continues operating read-only from its local graph throughout

---

## Out of scope

- The tier model itself and what belongs in each tier — [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]
- Permission evaluation — [[VPS-A004_Graph_Permission_Layer|VPS-A004]]
- What the audit log records — [[VPS-F004_Silent_Audit_Log|VPS-F004]]
- Retention periods per record class — [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]
- Which payment provider is eventually used — [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] defines the adapter; the provider is a commercial decision made later
- CI/CD pipeline design

---

## Decisions recorded

This document resolves four items the previous specification set carried as open: the transactional email provider and sender-domain mechanism flagged by [[VRS-F021_E-Signature_Native|VRS-F021]]; the object storage decision flagged by [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]; the webhook delivery, retry and dead-lettering mechanism deferred by [[VPS-F009_Vulto_Sync_API|VPS-F009]]; and the document rendering mechanism [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]] requires and which no document previously provided.

It additionally closes three gaps nobody had flagged, and which would have been discovered during implementation: that there was no job scheduler despite ten features requiring recurring evaluation, that there was no logging redaction policy despite three encryption tiers, and that there was no backup or recovery target at all for a system intended to hold a firm's employment records for years.

**Loops is the lifecycle email provider and is deliberately outside this specification set.** Every message this product sends is a prompt with a link, not a sequence; lifecycle email is the company emailing its customers rather than the product notifying its users. Separate providers, separate sender domains, and a lint failure if feature code reaches for the wrong one.

**PostHog is added, self-hosted, and the local-first analytics problem is stated rather than glossed.** Most reads in this product never reach a server, so server-side analytics would see almost nothing — and client-side capture in an HR product is a disclosure surface. The resolution is a closed typed event union carrying a surface and an outcome, never a subject, enforced by the same gate that tests log redaction.

**Support and documentation surfaces are named here** so [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s shell accounts for them. Neither ever receives workspace data, and a support widget capturing the current screen would exfiltrate precisely what the tier model protects.

**[[Vulto Pay]] is removed from this architecture entirely**, per founder decision. It is planned years out and nothing may depend on it. [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]] replaces the dependency with a provider-agnostic disbursement adapter whose default path requires no third-party service.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the stack these services run within
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the tier model governing what may be sent, stored and logged
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer every job runs under
- [[VPS-F004_Silent_Audit_Log|VPS-F004]] — the audit log, deliberately distinct from application logging
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — the retention schedules governing storage lifecycle
- [[VPS-000_Documentation_Standard|VPS-000]] — the Documentation Standard

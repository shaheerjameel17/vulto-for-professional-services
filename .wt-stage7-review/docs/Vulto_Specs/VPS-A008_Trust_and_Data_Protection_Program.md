---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-09-20]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-A008
---

# VPS-A008 — Trust and Data Protection Program

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (tiers, key hierarchy, erasure), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the policy table), [[VPS-F004_Silent_Audit_Log|VPS-F004]] (the audit journal), [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] (export and erasure)
**Blocks:** Admission of any real customer data; [[VPS-003_Commercial_Model|VPS-003]]'s Enterprise plan; every feature that states a trust claim to a customer

This document is the single source of truth for **what Vulto promises customers about their data, and how each promise can be checked.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] owns the mechanics — tiers, encryption, keys, erasure. This document owns the controls built on them that a customer sees, buys and verifies: staff access, access transparency, customer-managed keys, tamper evidence, residency, published artifacts and external assurance.

---

## Decision

**Vulto earns trust through controls a customer can verify, not through a claim that Vulto cannot read their data.**

Eight promises, each backed by a mechanism and a way to check it:

| # | Promise | Mechanism | How a customer verifies it |
|---|---|---|---|
| **P1** | Nobody at Vulto opens your data unless you approve it | Staff access is denied by default; access requires a customer-approved, time-limited request | The Access Transparency log in Settings → Trust |
| **P2** | You see every time Vulto accessed your workspace | Every staff access, approved or emergency, is recorded in a customer-visible log | The same log, exportable |
| **P3** | Salaries, pay, contracts and HR cases are encrypted field by field | Field-level AES-256-GCM under keys held in KMS, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] | The published security whitepaper and the independent penetration test summary |
| **P4** | On Enterprise, you hold a key that can lock Vulto out | Customer-managed root key in the customer's own AWS KMS | Revoking the key in their own AWS account and watching protected data become unreadable |
| **P5** | Your audit log cannot be quietly edited | A per-workspace hash chain over the audit journal, anchored daily | Running the published open-source verifier against their export |
| **P6** | The access rules are exactly what we say they are | The permission policy table is published, and the running version's hash is shown in the product | Comparing the in-product policy hash to the published one |
| **P7** | You can leave with everything, whenever you want | A documented, open export format | The published format specification and schema |
| **P8** | On Enterprise, your data stays in the region you choose | Per-workspace residency region for storage, backups and keys | The residency statement in Settings → Trust and the subprocessor list |

**Wellness and anonymous feedback add a ninth, stronger promise when those features ship:** *your employer cannot read this, and neither can Vulto* — delivered by [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 module, with its source published.

---

## Context

**End-to-end encryption was a promise customers could not check.** In a web application the server delivers the code that holds the keys on every page load. A compromised or compelled Vulto could deliver altered code, and no customer could detect it page by page. The promise always rested on trusting Vulto, while costing lost-key data loss, server-side features that could not run, and a slower product. [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] records why it was reversed.

**What buyers in this category recognize.** Agency owners and HR buyers ask whether staff can see salaries, who at the vendor can access the data, whether access is logged, whether the data can be exported and deleted, where it is stored, and whether an independent party has tested the controls. Enterprise buyers add customer-managed keys and assurance reports. Every promise above answers one of those questions.

**Why publish selectively rather than open-source the product.** Publishing the whole application proves little, because a customer cannot verify that published code is the code running, and it hands competitors the product. Publishing the specific artifacts that encode promises — the access rules, the audit verifier, the export format, the Tier 3 module — lets a customer check the promise itself.

---

## P1 and P2 — No staff access by default, and Access Transparency

**Default.** No Vulto employee or contractor holds standing access to customer data in any tier. Production database access is limited to the infrastructure on-call role, through an audited bastion, and even that role reads only ciphertext for Tier 1 and Tier 2 fields, because the KMS decrypt permission is not granted to it.

**Customer-approved access.** Support that needs to see customer data raises an **access request** in the product: requester, reason, scope (which workspace areas, read or write), and duration — at most 72 hours. An Owner approves or declines it. An approved request grants a time-boxed support principal that the [[VPS-A004_Graph_Permission_Layer|VPS-A004]] interceptor evaluates like any other, scoped to what was approved, and that expires automatically.

**Emergency access.** Two circumstances permit access without prior approval: an active security incident affecting the workspace, and a legally binding demand. Emergency access requires two Vulto approvers, is recorded in the Access Transparency log immediately, and the Owner is notified within 24 hours — unless a legal order prohibits notification, in which case the notification is sent the moment the prohibition lapses. **Vulto does not promise to resist lawful compulsion. It promises to tell you, as soon as it lawfully can.**

**The Access Transparency log** is a per-workspace, append-only record of every staff access: who, when, why, which request or emergency authorized it, what was read or changed, and when it ended. It is visible to the Owner in Settings → Trust, exportable, and included in the hash chain under P5. It is a control-plane record, like Better Auth's rows, not a graph node type.

**Break-glass keys.** The KMS decrypt permission for a workspace is granted to the API service role and to nothing that a person can assume, except through the emergency path, which uses a separate role whose every use is logged by AWS CloudTrail and reconciled into the Access Transparency log daily.

---

## P3 — Field-level encryption

Specified entirely in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]: Tier 1 and Tier 2 content is encrypted per field with AES-256-GCM under data keys wrapped by a per-workspace key, wrapped by a KMS root key; protected data never persists on a device; every protected read is audited. This document adds only the customer-facing statement, in the security whitepaper, of what that does and does not protect against — including, plainly, that Vulto can be lawfully compelled to decrypt it.

---

## P4 — Customer-managed keys (Enterprise)

**The root key can be the customer's.** An Enterprise workspace may replace the Vulto-managed KMS root key with a key in the customer's own AWS account, granting Vulto's service role permission to use it. The workspace's KEK is re-wrapped under the customer's key; content is not re-encrypted.

**Revocation locks Vulto out.** If the customer disables the key or withdraws the grant, the API can no longer unwrap the workspace KEK. Tier 1 and Tier 2 data become unreadable to Vulto and, necessarily, to the workspace's own users, because Vulto serves them. The product shows a clear locked state rather than errors. Re-enabling the key restores access with no data loss.

**What it does not cover, stated plainly.** Tier 0 data is protected by provider encryption at rest, not by the customer's key. The customer's key protects the fields that matter most — compensation, pay, commercial terms, contracts, cases and HR-restricted records — and that boundary is written into the Enterprise agreement rather than implied to be total.

**Onboarding requires a verification step:** the Owner confirms the key's region matches the workspace's residency region, and a test wrap and unwrap succeeds before the switch.

---

## P5 — Tamper-evident audit

**Every audit event carries the hash of the previous event in its workspace.** The chain is computed at append time inside the same transaction that writes the event, per [[VPS-F004_Silent_Audit_Log|VPS-F004]]. Altering, removing or reordering any event breaks every hash after it.

**Daily anchoring.** Once a day, each workspace's latest chain head is written to an append-only object-storage bucket with object lock, and shown to the Owner in Settings → Trust. A later rewrite of the chain would have to disagree with an anchor that Vulto cannot alter within the lock period.

**The verifier is published.** A small open-source command-line tool takes a workspace's audit export and its anchors and reports whether the chain is intact.

---

## P6 — The access rules, published

**The policy table is the promise.** [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s policy table decides who can read salaries, HR cases, performance reviews and wellness data. It is exported at every release as machine-readable JSON and a human-readable table, and published.

**The running version is attested in the product.** Settings → Trust shows the SHA-256 of the policy table the API is enforcing, and the release it came from. A customer can compare it to the published artifact for that release.

---

## P7 — Open export format

**A workspace export** under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] follows a published, versioned format: every node and edge as JSON conforming to a published JSON Schema generated from `packages/schema`, documents as files, and a manifest. The format specification is published so a customer, or a competitor they move to, can read it without Vulto's software.

---

## P8 — Data residency (Enterprise)

**Each workspace has a residency region**, chosen at creation on Enterprise and defaulted for other plans. The region governs PostgreSQL, backups, object storage, the replication service and the KMS root key.

**Regions offered at launch:** United States, European Union (Frankfurt), United Kingdom (London) and Singapore, matching where [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s hosting and AWS KMS are both available. **In-country hosting for Saudi Arabia and the UAE is not offered at launch.** It is added when a signed customer requires it, because it needs a hosting provider with an in-country region and a separate deployment.

**Moving a workspace between regions** is a supported, audited operation performed by Vulto on request, not self-service.

---

## Published artifacts

A public repository, `vulto-trust`, under the Apache-2.0 license, published by the release pipeline in [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]] on every production release:

| Artifact | Source | Purpose |
|---|---|---|
| Policy table, JSON and human-readable | `packages/schema`'s policy table | P6 |
| Policy table hash per release | The release pipeline | P6 attestation |
| Audit chain verifier | A standalone TypeScript CLI | P5 |
| Export format specification and JSON Schema | Generated from `packages/schema` | P7 |
| Security whitepaper | Written; revised on every material change to [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] or this document | P3, and the honest limits of every promise |
| Subprocessor list | Maintained with [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] | P8 and contractual transparency |
| Tier 3 module source | Published when the module is built | The ninth promise |

**Nothing else in the product is published.** A proposal to publish more requires a superseding decision here.

---

## External assurance

Fixed triggers, so assurance keeps pace with customers rather than being deferred indefinitely:

| Assurance | Trigger |
|---|---|
| Independent penetration test of the API, sync path and key handling | Before the first pilot with real customer data, then annually and after any material change to [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] |
| `security.txt`, a vulnerability disclosure policy and a monitored security inbox | Before the first pilot with real customer data |
| Data processing agreement and published subprocessor list | Before the first paying customer |
| SOC 2 Type I | Readiness work begins at the first paying customer; the report is obtained when the first Enterprise prospect requires it |
| SOC 2 Type II | Twelve months after Type I |
| Paid bug bounty | When paying customers exceed fifty workspaces |

---

## Plans

Per [[VPS-003_Commercial_Model|VPS-003]]: P1, P2, P3, P5, P6 and P7 are in **every plan**, because they are the baseline a customer is trusting with salaries. P4 (customer-managed keys) and P8 (choice of residency region) are **Enterprise**.

---

## Technical specifications

| ID | Specification |
|---|---|
| A008-T01 | No Vulto person or role MAY hold standing access to customer data. Production database access MUST be through an audited bastion and MUST NOT include KMS decrypt permission for any workspace |
| A008-T02 | Staff access to a workspace MUST require an Owner-approved access request stating requester, reason, scope and duration, with a maximum duration of 72 hours, enforced by a support principal that the [[VPS-A004_Graph_Permission_Layer|VPS-A004]] interceptor evaluates and that expires automatically |
| A008-T03 | Emergency access MUST require two Vulto approvers, MUST be logged immediately, and MUST notify the Owner within 24 hours unless legally prohibited, in which case notification MUST follow as soon as the prohibition lapses |
| A008-T04 | Every staff access MUST be recorded in the workspace's append-only Access Transparency log, visible and exportable by the Owner. KMS emergency-role use MUST be reconciled from CloudTrail into that log daily |
| A008-T05 | An Enterprise workspace MUST be able to use a root key in the customer's AWS KMS. Loss of access to that key MUST render Tier 1 and Tier 2 data unreadable and MUST present a defined locked state; restoring access MUST restore data with no loss |
| A008-T06 | Every audit event MUST include the hash of the previous event in its workspace's chain, computed in the same transaction as the append. Each chain head MUST be anchored daily to object-locked storage |
| A008-T07 | The release pipeline MUST publish the policy table, its hash, the audit verifier and the export JSON Schema to `vulto-trust` on every production release. The product MUST display the hash of the policy table the API is enforcing |
| A008-T08 | Workspace export MUST conform to the published, versioned export format |
| A008-T09 | Each workspace MUST have a residency region governing its database, backups, object storage, replication service and KMS root key. No customer data MAY be stored outside it, except the subprocessors listed for that region |
| A008-T10 | Each item in External assurance MUST be completed by its stated trigger. Admission of real customer data MUST be blocked in the release checklist until the pre-pilot items are complete |

---

## Acceptance criteria

**GIVEN** a Vulto support engineer with production access
**WHEN** they query a workspace's Tier 1 fields without an approved access request
**THEN** they see only ciphertext, and no role they can assume can decrypt it

---

**GIVEN** an Owner approves a 24-hour read-only access request
**WHEN** the support engineer opens the workspace's payroll area 25 hours later
**THEN** access is denied, and the Access Transparency log shows the request, every access made within the window, and its expiry

---

**GIVEN** an Enterprise customer disables their KMS key
**WHEN** any user or job next requests a Tier 1 value
**THEN** the request fails with the defined locked state, no plaintext is served, and re-enabling the key restores access with no data loss

---

**GIVEN** a workspace's audit export and its daily anchors
**WHEN** one historical event is edited in the database and the export is regenerated
**THEN** the published verifier reports the chain broken at that event

---

**GIVEN** release 1.4.0 is deployed
**WHEN** an Owner compares Settings → Trust's policy hash with `vulto-trust`'s published hash for 1.4.0
**THEN** they match

---

**GIVEN** an Enterprise workspace with residency in the European Union
**WHEN** its database, backups, object storage and KMS key are inspected
**THEN** each is in the European Union region

---

## Out of scope

- The encryption mechanics, key hierarchy and erasure — [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]
- The permission rules themselves — [[VPS-A004_Graph_Permission_Layer|VPS-A004]]
- Customer-managed keys for Tier 0 data — decided against; see Decisions recorded
- Self-hosted deployments of Vulto — not offered; revisit only on a signed Enterprise requirement
- Open-sourcing the application — decided against; see Context
- In-country hosting in Saudi Arabia and the UAE at launch — added on a signed customer requirement

---

## Decisions recorded

**Trust is a program with verifiable promises, not a cryptographic property of the architecture — F200, 20 September 2026.** Adopted with the reversal recorded in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and F199. The founder's framing was the promise "you can trust Vulto"; this document turns that into eight checkable commitments.

**Customer-managed keys cover Tier 1 and Tier 2, not Tier 0.** Extending the customer's key to every row would put KMS on the path of every read and write of operational data, which [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s budgets cannot absorb, for data the customer's own staff already see broadly. The boundary is contractual and stated, not implied.

**AWS KMS is used although compute runs on DigitalOcean.** DigitalOcean offers no key management service with customer-managed keys. AWS KMS is the one customers' security teams already know how to operate, which is what makes P4 usable rather than theoretical.

**Emergency access is disclosed, not forbidden.** Promising that Vulto would never access data under compulsion would be false. Promising to disclose it is true and checkable.

---

## Related Notes

- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — tiers, encryption, keys and erasure
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the policy table this document publishes
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — hosting regions and subprocessors
- [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]] — the pipeline that publishes the artifacts
- [[VPS-F004_Silent_Audit_Log|VPS-F004]] — the audit journal the hash chain covers
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — export and erasure
- [[VPS-003_Commercial_Model|VPS-003]] — which plans carry which promises

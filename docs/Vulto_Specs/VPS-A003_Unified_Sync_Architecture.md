---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-A003
---

# VPS-A003 — Unified Sync Architecture

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (CRDT library and storage engine are settled facts), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (node registry, privacy classes and tier assignments)
**Blocks:** [[VPS-A004_Graph_Permission_Layer|VPS-A004]], [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]], [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], and every feature in every application

This document is the single source of truth for how data moves between devices, how it is partitioned by sensitivity, and how it is encrypted. **One sync engine serves every application**, because there is one graph.

---

## Decision

Vulto Roster uses Loro as the sole mathematical foundation for all sync. **The server is a coordination layer, never a source of truth.** The canonical graph lives on user devices. Every feature operates fully offline without degraded functionality. A bespoke CRDT implementation is prohibited.

This document answers two questions that a document-granular CRDT library makes non-trivial: how permission-filtered sync actually works, and how to distinguish access controlled by policy from access made impossible by mathematics.

---

## Context

Roster's target markets include professional services firms in Pakistan and other emerging markets where connectivity is intermittent. Offline capability is a prerequisite, not a convenience.

More consequentially: Vulto is a Delaware C-Corp, which places the company inside US jurisdiction regardless of where its servers sit. A hosting decision cannot solve that. An encryption architecture in which certain data is unreadable to Vulto's own servers under any circumstance — including legal compulsion directed at the company itself — can. That is the more important problem this document solves.

---

## Sync topology

```
Device A  (local graph — canonical)
    │  encrypted sync delta, TLS 1.3 minimum
    ▼
Sync Server  (Rust, coordination layer only)
    │  encrypted sync delta, TLS 1.3 minimum
    ▼
Device B  (local graph — canonical)
```

The server never holds a canonical copy of anything. It relays serialized Loro change blobs between authorized devices and persists them to PostgreSQL for durability and catch-up. Whether it can *read* what it relays depends on tier.

---

## Two axes of granularity

Easily conflated, and worth separating cleanly.

**Merge granularity** is Loro's concern. Changes merge at property and edge level within a document, using last-write-wins for Map fields, Fugue-based merge for Rich Text, and Loro's native algorithm for Movable Tree. This requires no design decision here.

**Access granularity** is this document's concern: which devices receive which documents at all. Because Loro syncs at whole-document granularity, permission-filtered sync cannot be achieved by withholding individual properties from a shared document. It is achieved by splitting the graph into multiple documents along sensitivity boundaries and controlling who is ever handed a copy.

---

## Document partitioning model

| Tier | Protection | Server can read? |
|---|---|---|
| **Tier 0 — Workspace Core** | Standard encryption at rest, broad sync | Yes |
| **Tier 1 — Protected** | True end-to-end encryption, envelope-wrapped per authorized reader | **No** |
| **Tier 2 — Sensitive** | Standard encryption at rest, narrow distribution | Yes |
| **Tier 3 — Private** | Single-reader end-to-end encryption | **No** |

**Tier determines the strength of protection. Privacy Class determines who receives it.** These are orthogonal, and the previous draft conflated them by listing a fixed reader set against Tier 1 — Owner, Finance Admin, HR Admin. That was accurate while Tier 1 held only financial data. It is no longer: [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]]'s case narrative and [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s contract content are both Tier 1, and neither should reach a Finance Admin. Had the tier carried its own reader set, activating case management would have distributed grievance narratives to the finance team.

The corrected rule: **a Tier 1 document's key is wrapped for exactly the roles its node type's Privacy Class grants read access, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]], and for no others.** Tier 1 means *end-to-end encrypted*. It does not mean *financial*.

The authoritative tier assignment for every node type lives in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]. The mapping from Privacy Class to default tier is mechanical, and it is **total** — every one of the thirteen classes [[VPS-A004_Graph_Permission_Layer|VPS-A004]] defines appears here, so a newly registered node type always has a default:

| Privacy Class | Default Tier |
|---|---|
| Standard | 0 |
| Recipient-only | 0 |
| Self only | 0 |
| Finance-restricted | 1 |
| Self and Finance-restricted | 1 |
| HR-restricted | 2 |
| Manager-restricted | 2 |
| Owner and HR Admin only | 2 |
| HR Admin only | 2 |
| Owner only | 2 |
| Sensitive | 3 |
| Self-only, absolute | 3 |
| Inherited | Resolved from source, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] Standing Rule 8 |

**This produces a default, not the assignment.** Because Privacy Class and Tier are orthogonal, a node may legitimately record a tier this table does not produce — HeadcountSnapshot is the one current case, and [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] marks it. A departure is registered and carries its reason; an unmarked mismatch is a defect.

**A single node may straddle tiers.** Employee is the clearest case: operational fields in a Tier 0 document, compensation fields in a separate Tier 1 document, both carrying the same `employee_id` so the local index stitches them into one record on any device authorized for both — and omits the Tier 1 fields entirely on a device that is not, producing the structural absence [[VPS-A004_Graph_Permission_Layer|VPS-A004]] requires. Pitch, Contract, Requisition, Offer and HRCase follow the same pattern.

**Edges inherit the more restrictive tier of the nodes they connect.** A Tier 0 node carrying an edge to a Tier 2 node produces an edge that syncs only to devices authorized for the Tier 2 endpoint. Without this, a broadly synced node would leak the existence of a restricted relationship even while the restricted node's content stayed protected — the edge becoming the leak instead of the node.

**AuditEntry sits outside this model deliberately.** It records that a Tier 1 or Tier 3 event occurred, who performed it and when, never the decrypted content. Because it holds only metadata about access, it follows Tier 2's standard-encryption-plus-narrow-distribution model without requiring end-to-end treatment.

---

## Conflict resolution

| Conflict | Resolution | Rationale |
|---|---|---|
| Same property edited on two devices | Last-write-wins per property, via Loro's Map semantics. Both versions remain in the audit log | Property granularity prevents whole-record conflicts |
| Node deleted on A, edited on B | Edit wins. Deletion demoted to soft-delete | Data preservation over deletion, always |
| Edge created on A, deleted on B | Creation wins. Deletion becomes soft-delete | Graph connectivity preserved by default |
| Same content created on two devices | Both preserved with distinct UUIDs. A duplicate signal surfaces to the user | UUID identity means no automatic merge of distinct creations |
| Schema migration on A while B offline | Migration queued. B applies it on reconnection before processing further deltas | Schema version must be consistent before sync proceeds |
| Tier 1 field edited by an authorized device while another authorized device is offline | Same last-write-wins once both are online | Encryption affects who can merge at all, not how merge behaves. An unauthorized device never receives the ciphertext to conflict with |

---

## Offline behavior

Every feature works without connectivity. Sync runs in the background whenever it is available. The application exposes a SyncStatus observable at all times — `Synced`, `Syncing`, `PendingChanges`, `Offline` — surfaced per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], and it never blocks or interrupts a workflow.

---

## The encryption architecture

This is the section that answers whether customer data can be made genuinely safe, and it does so by drawing a hard line between two guarantees that are easy to blur.

**Standard encryption at rest** (Tiers 0 and 2) means data is encrypted on disk on both device and server, but the server can still produce readable data through legitimate operation, because the application layer holds or can derive the keys it needs. This protects against a stolen device, a careless backup, or an attacker who breaches storage without breaching the application. It does **not** protect against Vulto being compelled to produce readable data.

**True end-to-end encryption** (Tiers 1 and 3) means the server never possesses a usable decryption key in any form. It stores and relays ciphertext exclusively. A full breach of Vulto's servers, or a court order directed at Vulto itself, yields nothing readable, because there is nothing for Vulto to decrypt with.

### Tier 3 — single reader

Only the owning employee ever reads their own Tier 3 data. A symmetric key is derived on the employee's first authenticated device via WebAuthn PRF, per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]], and never leaves their device set in a form the server can read. Loro merge for these documents happens in plaintext, but only on the owner's own devices, since those are the only devices holding the key. What crosses the network is an opaque encrypted blob.

### Tier 1 — multiple readers

Tier 1 data must be readable by several people, which rules out a device-bound key. The mechanism is **envelope encryption**: the document is encrypted once with a randomly generated document key, and that key is then wrapped separately for each authorized person's public key. Each person holds a private key that never leaves their device unencrypted. Anyone authorized unwraps the document key with their own private key, decrypts, reads, and re-encrypts on write. The server stores ciphertext and wrapped-key entries, never the private keys required to unwrap them.

**The wrapped-key recipient set is derived from Privacy Class, not from tier**, per the correction above.

### Revocation and grant are not mirror images

**Revocation is lazy.** When someone loses an authorized role, their wrapped-key entry is deleted and future writes are encrypted under a rotated key. Historical documents are re-wrapped under the new epoch only when an authorized device next opens and modifies them. Proactively re-encrypting years of history the instant one person leaves would spike bandwidth for every remaining device — a real cost on the intermittent connections this product is built for.

**This is worth being honest about.** Revocation prevents access going forward. It cannot retroactively make someone un-see data they already decrypted and could, in principle, have copied. No encryption scheme solves that, here or anywhere, and implying otherwise would be a false promise.

**Grants are immediate.** Waiting for some other device to eventually touch a historical record would leave a newly promoted HR Admin locked out of exactly the data their new role requires. Granting access wraps the current retention window immediately at grant time. Laziness is correct for revocation, where its cost is wasted bandwidth. It is wrong for grants, where its cost is a person unable to do the job they were just given.

### Cryptographic erasure

[[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] satisfies statutory erasure rights without violating [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1, and the mechanism lives here because it is a key-management operation rather than a data operation.

Erasure destroys the key material for a subject's Tier 1, Tier 2 and Tier 3 documents: every wrapped-key entry is deleted, the document key is discarded, and no copy is retained in any backup generation. The ciphertext remains. The nodes, their edges and their graph positions remain. Referential integrity is unbroken, aggregate history stays correct, and [[VPS-F004_Silent_Audit_Log|VPS-F004]] records that erasure occurred and when.

Two honest limits, stated rather than glossed:

**Tier 0 content is not protected by this mechanism**, because Tier 0 keys are held by the application. Erasure of Tier 0 personal data is performed by field-level redaction under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]], which is a weaker guarantee and is described there as such.

**A device that decrypted a document before erasure may retain a local copy** until it next synchronizes. Erasure fires a device wipe instruction for the affected documents, but a device that never reconnects cannot be reached. This is the same limitation as revocation, and it is a property of distributed systems rather than a defect in this design.

### Key recovery

**Tier 3.** Loss is personal and organizationally inconsequential — only the individual's own entries are affected, and nobody else ever had access regardless. This does not justify a user-managed recovery phrase, which people reliably mishandle: screenshotted, pasted into an untitled note, deleted later without recognition. Tier 3 key backup defaults to the device platform's secure cloud keychain. Recovery becomes *sign back into your Apple or Google account*, which people already understand and protect.

**Tier 1.** Loss here is organizationally consequential, and the design must assume the person setting it up is an agency owner trying the product for the first time, not a security professional.

- **No free-form user-managed artifact.** The product generates the recovery material, displays it once with unmistakable labeling as a downloadable card, and requires correct re-entry before setup completes. That verification step is what separates genuine capture from a screenshot taken in passing.
- **A threshold scheme across people, not devices.** Two of three trusted people by default, so a single lost device or departed person never permanently locks an organization out of its own financial history. Onboarding actively nudges toward a second Tier 1 holder, framed as business continuity — *so a lost laptop never locks your business out of its own payroll history* — rather than as a security feature requiring a security mindset to appreciate.

### Tier 1 historical data retention

A device holding Tier 1 access does not need, and must not default to holding, the organization's entire financial history. Without a bound, a lost device or a delayed revocation exposes years of data rather than a manageable window.

**The window.** Closed records — completed PayRuns, past PaySlips, paid Invoices, closed Expenses, superseded salary values — older than `tier1_retention_window_months` are not materialized on any device by default. Default twelve months, Owner-configurable between six and twenty-four in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

**Exemptions.** Active, open records — the current salary value, unpaid invoices, an in-progress PayRun — are never subject to the window. Finance operations depend on these being always available.

**On demand.** A record outside the window is fetched and decrypted on request, displays normally, and remains locally available for thirty days from its most recent access. Re-accessing resets the clock. Expiry is evaluated on-device using the device's own clock, requiring no network round-trip. This is the aged-out state [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] renders with a dashed border and a **Fetch** action.

**Implementation.** Tier 1 documents are partitioned by time period — one Loro document per pay cycle is the natural unit — in addition to sensitivity partitioning. Aging a period out is therefore a matter of no longer handing a device that period's document, not surgical deletion within an ever-growing shared one.

**Relationship to revocation.** The window operates independently of, and in addition to, device wipe on access change. Revocation remains the primary control. The window bounds worst-case exposure to a year of history rather than a complete financial record in the gap between a revocation event and it reaching a device.

### Scope by phase

MVP delivers true end-to-end encryption for Tier 3 wellness data and Tier 1 compensation fields, together with the key recovery model and the retention window. Shipping the encryption without those two would leave customers exposed to exactly the failure modes this section exists to prevent.

BurnoutAlert and FlightRiskSignal are strong candidates for end-to-end treatment and are planned for Post-MVP rather than MVP. Tier 2's standard-encryption-plus-narrow-distribution already satisfies [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s access rules correctly; what it lacks is the cryptographic guarantee, and taking on envelope encryption for every Tier 2 category on day one would delay MVP meaningfully for a marginal gain.

HRCase content ([[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]]) is Tier 1 from the moment that feature ships, not deferred. A grievance narrative is the one Post-MVP record where standard encryption is genuinely inadequate.

---

## Technical specifications

| ID | Specification |
|---|---|
| A003-T01 | The CRDT implementation MUST be Loro. A bespoke implementation is prohibited |
| A003-T02 | All sync operations MUST be idempotent. Applying the same delta twice MUST produce the same result, verified by automated test |
| A003-T03 | All sync payloads MUST be encrypted in transit using TLS 1.3 minimum, regardless of tier |
| A003-T04 | Local device storage MUST be encrypted at rest with AES-256, keyed from the authenticated session and never stored alongside the data. This is independent of, and does not substitute for, the Tier 1 and Tier 3 end-to-end scheme |
| A003-T05 | Tier 1 and Tier 3 documents MUST be encrypted client-side before transmission. The server MUST NOT possess or be able to derive any key capable of decrypting them, verified by an automated test confirming no server-side code path can decrypt a Tier 1 or Tier 3 payload |
| A003-T06 | A Tier 1 document's key MUST be wrapped for exactly the roles its node type's Privacy Class grants read access per [[VPS-A004_Graph_Permission_Layer|VPS-A004]], and for no others. Tier MUST NOT imply a reader set |
| A003-T07 | Key wrapping MUST support adding and removing readers without re-encrypting the underlying document. On revocation the key epoch MUST increment for future writes, with historical re-wrapping performed lazily on next authorized modification. On grant, the new reader's wrapped-key entry for the current retention window MUST be created immediately |
| A003-T08 | The sync engine MUST expose a SyncStatus observable any UI component may subscribe to |
| A003-T09 | Every sync delta MUST be logged to [[VPS-F004_Silent_Audit_Log|VPS-F004]], including its tier |
| A003-T10 | The sync engine MUST be a single shared core library used identically across all platforms |
| A003-T11 | Schema version mismatches MUST be handled gracefully. Older schema versions MUST NOT corrupt data written under newer ones |
| A003-T12 | Tier 3 key derivation MUST use WebAuthn PRF with backup to the platform's native secure keychain. A user-managed recovery phrase MUST NOT be the default or only Tier 3 recovery path |
| A003-T13 | Any Tier 1 recovery artifact MUST be product-generated, unmistakably labeled, and the setup flow MUST require correct re-entry before completion |
| A003-T14 | Tier 1 recovery MUST support an M-of-N threshold scheme, two of three by default, so no single device loss or departure permanently locks the organization out |
| A003-T15 | Workspace setup MUST prompt for a second Tier 1 holder, framed as business continuity, and MUST require explicit acknowledgment if declined |
| A003-T16 | Device revocation and local wipe MUST fire on any change removing Tier 1 access, not only full offboarding. A demotion or role change removing Tier 1 authorization is a revocation event in its own right |
| A003-T17 | Closed Tier 1 records older than `tier1_retention_window_months` MUST NOT be materialized on any device by default. Default twelve months, configurable six to twenty-four |
| A003-T18 | Active, open Tier 1 records MUST always be available regardless of the window |
| A003-T19 | A Tier 1 record outside the window MUST be retrievable on demand and held locally for thirty days from most recent access, with expiry computed on-device without requiring connectivity |
| A003-T20 | Tier 1 documents MUST be partitioned by time period in addition to sensitivity |
| A003-T21 | Cryptographic erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] MUST destroy every wrapped-key entry and the document key, retain no copy in any backup generation, preserve the node and its edges, and write an [[VPS-F004_Silent_Audit_Log|VPS-F004]] record. It MUST fire a device wipe instruction for the affected documents |

---

## Acceptance criteria

**GIVEN** Device A edits an Employee's phone number offline and Device B edits the same Employee's job title offline
**WHEN** both reconnect
**THEN** both changes are present on both devices with no data loss and no manual merge, within 30 seconds

---

**GIVEN** a WellnessTriggerEvent exists for Employee X
**WHEN** Device B, authenticated as X's manager, syncs
**THEN** it does not appear in Device B's local store — no ciphertext, no metadata, no indication of its existence anywhere in the delta

---

**GIVEN** a Tier 1 salary record is queried directly from the server's database, bypassing the application
**WHEN** the raw value is inspected
**THEN** it is unreadable ciphertext, and no key capable of decrypting it exists anywhere in server-side storage or memory during normal operation

---

**GIVEN** an HRCase narrative is written under [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]]
**WHEN** a Finance Admin's device syncs
**THEN** the Tier 1 content does not reach it, because the wrapped-key set derives from HRCase's HR-restricted Privacy Class rather than from its tier

---

**GIVEN** an HR Admin's access is revoked
**WHEN** a Tier 1 document they previously accessed is next modified by an authorized party
**THEN** the key has rotated, their wrapped-key entry no longer exists, and they cannot decrypt the new version even holding the old ciphertext

---

**GIVEN** a new Finance Admin is granted Tier 1 access
**WHEN** the grant is saved
**THEN** their wrapped-key entries for the current retention window are created immediately, without requiring any other device to first open those records

---

**GIVEN** an approved erasure request under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]
**WHEN** erasure executes
**THEN** every wrapped-key entry and the document key are destroyed with no backup copy retained, the ciphertext and graph structure remain intact, referential integrity is unbroken, and [[VPS-F004_Silent_Audit_Log|VPS-F004]] records the event

---

**GIVEN** the network is unavailable
**WHEN** a manager creates an Assignment on Device A
**THEN** it is immediately visible in Device A's local graph, SyncStatus shows `PendingChanges`, and it syncs to all authorized devices within 30 seconds of restoration

---

**GIVEN** two of three Tier 1 keyholders remain active
**WHEN** the third permanently loses their device
**THEN** the remaining two jointly restore full Tier 1 access with no data loss, and recovery re-wraps the document keys so the lost device's copy is no longer valid

---

**GIVEN** a workspace's retention window is the twelve-month default
**WHEN** a completed PayRun passes its thirteenth month
**THEN** it is purged from local materialization on any device that has not accessed it within thirty days, renders as the aged-out state per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], and remains fully retrievable on demand

---

## Out of scope

- Building a bespoke CRDT implementation
- A server-side source-of-truth model
- Manual conflict resolution UI for users
- End-to-end encryption for BurnoutAlert and FlightRiskSignal at MVP — planned Post-MVP
- Hardware security module infrastructure, premature at this stage
- Which infrastructure hosts the ciphertext — [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]

---

## Decisions recorded

**Tier no longer implies a reader set.** The previous draft listed fixed recipients against Tier 1, which was accurate while Tier 1 held only financial data. [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] and [[VRS-F020_Universal_Contract_Builder|VRS-F020]] both place non-financial content at Tier 1, and had the tier carried its own reader set, grievance narratives and contract content would have been distributed to the finance team. Reader sets now derive from Privacy Class, per A003-T06.

**Cryptographic erasure is specified here** rather than left as an unresolved collision between [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1 and statutory erasure rights. Its two genuine limits — Tier 0 content and unreachable devices — are stated rather than glossed.

**`tier1_retention_window_months` is registered** in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Workspace Configuration Registry and exposed in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]. The previous draft described the window in prose without registering the key that configures it.

**Tier 3 key derivation is aligned with [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]** on WebAuthn PRF, with platform keychain backup. The two documents previously described the same mechanism in incompatible terms.

**The resolved-question entry in Out of Scope is retired.** How wellness aggregates compute over Tier 3 records is answered by structural anonymization in [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] and [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]], and belongs in those documents rather than as archeology here.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the stack and CRDT choice this document builds on
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the node registry and tier assignments
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer, and the reader sets this document wraps keys for
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the reference protocol, which depends on edge tier inheritance
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the infrastructure storing the ciphertext
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — data governance, retention and erasure

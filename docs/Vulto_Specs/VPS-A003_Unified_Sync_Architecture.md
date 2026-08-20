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

Vulto Roster uses Loro as the sole mathematical foundation for all sync. **The server is a coordination layer, never a source of truth.** The canonical graph lives on user devices. After the current cold start has completed one online, session-authorized local-store unlock, every feature operates fully offline without degraded functionality until the next cold restart. A bespoke CRDT implementation is prohibited.

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

The corrected rule: **a Tier 1 document's key is wrapped for exactly the people the node type's effective grant gives read access, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]], and for no others.** Tier 1 means *end-to-end encrypted*. It does not mean *financial*.

**"Effective grant" is load-bearing and means the Privacy Class default as overridden by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s per-node matrix.** Resolving against the class default alone gets this wrong on every Tier 1 node the matrix narrows. `Finance-restricted` defaults Team Member to `Read (own only)`; the matrix overrides Team Member to `None` on HeadcountPlan, PayRun, Requisition's budget half and Offer's terms. Wrapping against the default would hand every employee in the workspace a decryption key for the headcount plan, the payroll run and every offer's compensation terms.

The permission interceptor would still refuse to return those rows, and that is exactly the point: **the key layer and the query layer must fail independently or they are not two layers.** A key wrapped for someone the interceptor denies survives the interceptor being wrong, misconfigured, or bypassed — which is the only circumstance Tier 1 exists to protect against.

**The reader set is derived once and consumed by both layers.** Key wrapping and query interception resolving it separately is how they come to disagree.

**The reader set is a set of people, not a set of roles.** Tier 1 is envelope-wrapped per authorized reader, and [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s subject exclusion removes a specific person from the readers of a record concerning them — including a person who holds a role that otherwise reads it. Resolving at role granularity cannot express that, and would hand the subject of a disciplinary case the key to their own case file.

**Becoming a subject is a revocation event.** A person who already holds a wrapped key when a record concerning them is created has their entry destroyed and a device wipe fired for that document, under A003-T16, which already covers any change removing Tier 1 access rather than only full offboarding. No new mechanism: A003-T07 requires exactly this — readers removable without re-encrypting the document.

`Read (own only)` also has no meaning on a workspace-scoped node. There is no *own* headcount plan and no *own* pay run. That grant was written for person-scoped records, and read literally against a workspace-scoped one it grants everything rather than nothing — which is the failure mode above, arriving by a second route.

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

**A single node may straddle tiers.** Employee is the clearest case: operational fields in a Tier 0 document, compensation fields in a separate Tier 1 document, both carrying the same `employee_id` so the local index can stitch authorized halves into one logical record. A device not authorized for the Tier 1 half receives and materializes none of its ciphertext or instance metadata. [[VPS-A004_Graph_Permission_Layer|VPS-A004]] then decides whether the absent half renders as `None` or as a `Restricted` placeholder derived only from type schema under A004-T19; the query layer never manufactures received instance data to draw that placeholder. Pitch, Contract, Requisition, Offer and HRCase follow the same pattern.

**Edges inherit the more restrictive tier of the nodes they connect.** A Tier 0 node carrying an edge to a Tier 2 node produces an edge that syncs only to devices authorized for the Tier 2 endpoint. Without this, a broadly synced node would leak the existence of a restricted relationship even while the restricted node's content stayed protected — the edge becoming the leak instead of the node.

**AuditEntry sits outside this model deliberately.** It records that a Tier 1 or Tier 3 event occurred, who performed it and when, never the decrypted content. Because it holds only metadata about access, it follows Tier 2's standard-encryption-plus-narrow-distribution model without requiring end-to-end treatment.

### Protected document identity

**A tier is never a document identity.** It says how strongly a document is protected, not which records may share one key. A protected document is addressed by the following logical tuple:

```
workspace_id
node_type + schema_partition
tier
reader_set_id             // SHA-256 of the canonically ordered authorized user IDs
time_bucket               // required for Tier 1 where retention applies; otherwise `current`
erasure_domain_id         // the subject whose erasure destroys this key; otherwise the node ID
```

The tuple is authenticated metadata on every protected envelope. `key_epoch` versions that logical document; it is not a replacement for the address, and increments on every forward-safe rotation.

**No document key is shared across different concrete reader sets or different erasure domains.** The first rule prevents an envelope from widening a record to the union of two audiences. The second prevents a statutory erasure from destroying another person's content merely because it happened to share a key. A document may contain several fragments only when every member has the same complete tuple above. A split node's `schema_partition` is part of the tuple, so its Tier 0 and Tier 1 halves can never cohabit by accident.

`reader_set_id` is derived once from the resolved set of people and is consumed by both the key layer and the query layer. It is not a role hash. Where the graph cannot yet resolve a concrete person — own-record, direct-report, participant, recipient, inherited or subject-exclusion behavior — it supplies no reader set and the protected write is refused or deferred rather than guessed at.

This is deliberately a stricter boundary than the earlier “one document per pay cycle” shorthand. A pay cycle is a useful Tier 1 `time_bucket`; it is never permission to combine employees, subjects or audiences that require different keys.

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

After one online, session-authorized local-store unlock in the current process, every feature works without connectivity until the next cold restart. A cold restart while offline leaves the encrypted local store locked; connectivity and a currently valid server session are required to unlock it. This qualification affects cold-start availability only: once unlocked, sync runs in the background whenever connectivity is available, and its absence never blocks or interrupts a workflow. The application exposes a SyncStatus observable at all times — `Synced`, `Syncing`, `PendingChanges`, `Offline` — surfaced per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]].

**"Current process" means the Worker instance, and a tab reload ends it.** The unlock material lives only in the Worker's memory, per A003-T04, and a new browser tab or a page reload starts a new Worker with nothing carried over. A tab reload therefore requires an online unlock exactly as a device cold restart does — the specification's own "current process" wording already implies this, and it is stated explicitly here so an implementer does not read "cold restart" as excluding it. A SharedWorker surviving tab reloads while keeping the key in-memory-only would satisfy A003-T04 and could soften this later on customer evidence; it is not built now, because it would revise the Worker topology settled for `packages/graph` without a demonstrated need. The asymmetry is the same one recorded for the cold-restart ruling itself: loosening later is additive, tightening after people rely on the looser behavior would take access away.

---

## The encryption architecture

This is the section that answers whether customer data can be made genuinely safe, and it does so by drawing a hard line between two guarantees that are easy to blur.

**Standard encryption at rest** (Tiers 0 and 2) means data is encrypted on disk on both device and server, but the server can still produce readable data through legitimate operation, because the application layer holds or can derive the keys it needs. This protects against a stolen device, a careless backup, or an attacker who breaches storage without breaching the application. It does **not** protect against Vulto being compelled to produce readable data.

**The local device store starts locked after every cold restart.** The server must validate a current authenticated session before releasing or deriving volatile unwrap material; the raw session token and plaintext storage key are never persisted with the data or exposed to application code. Once unlocked, the complete product continues to operate without connectivity until the next cold restart. A device whose user has been offboarded or centrally revoked cannot pass that restart checkpoint and therefore cannot reopen local HR data. Credential-bound offline unlock through WebAuthn PRF is not the default and is not part of the current scope.

**True end-to-end encryption** (Tiers 1 and 3) means the server never possesses a usable decryption key in any form. It stores and relays ciphertext exclusively. A full breach of Vulto's servers, or a court order directed at Vulto itself, yields nothing readable, because there is nothing for Vulto to decrypt with.

### Tier 3 — single reader, with two independent recovery paths

Only the employee who is the Tier 3 data subject and sole reader ever reads their own Tier 3 data. A company **Owner** role is **not** a fallback reader, a recovery code is **not** issued to that role, and recovery never changes the Tier 3 reader set.

On the first PRF-capable device, the Worker generates a random 256-bit Tier 3 root key. Each Tier 3 document has its own random 256-bit document key, encrypted under that root and used only for that document's content. The first device evaluates WebAuthn PRF and derives a device key-encryption key from the 32-byte PRF result; it uses that key to encrypt the root key into a **PRF envelope**. The server stores the envelope and ciphertext, never a usable root or document key.

The same setup creates a mandatory, independent **Tier 3 recovery-code envelope**. The Worker generates a random 256-bit recovery secret, renders it as thirteen groups of four Crockford-Base32 characters, and requires the employee to re-enter it before Tier 3 setup completes. It is product-generated rather than a user-chosen phrase, is never sent to the server or logged, and is not persisted by Vulto after display. A key-encryption key derived from that secret encrypts the same Tier 3 root key into the recovery-code envelope. The employee may save the generated code in their chosen durable secure store; losing both it and every usable PRF credential remains a real loss, but it is no longer the default outcome of losing one device.

Platform backup of a passkey may make an existing PRF envelope available on another device, but Vulto does not assume it will. A new device becomes a persistent Tier 3 device only after it successfully evaluates PRF and has a PRF envelope. It may obtain the root key by entering the recovery code, after which it creates its own PRF envelope. A device that cannot evaluate PRF is not eligible for persistent Tier 3 access; it must use a supported device for recovery rather than weakening the primary protection to accommodate an unsupported authenticator.

Recovery requires a current authenticated session **for that same data subject**, a PRF-capable new device, and the recovery code. This is an exact authenticated-person identity match to the Tier 3 sole-reader ID, not a role-based permission check: a company Owner cannot initiate, approve or receive another employee's recovery. That boundary holds independently of F130's currently unbuilt subject exclusion. Recovery creates a new PRF envelope, immediately replaces the recovery code and its envelope, and begins a new key epoch for future writes. Existing documents are re-encrypted lazily when an authorized recovered device next modifies them, exactly as Tier 1 revocation rotates future writes. A lost device may still hold bytes it decrypted before recovery; that historical limit is the same one this document states for every revocation. It cannot decrypt a document's new epoch once that document has been modified under the recovered key set.

Loro merge for these documents happens in plaintext, but only on the owner's devices while the Worker holds the relevant key. What crosses the network is an opaque encrypted blob.

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

**Tier 3.** Platform-backed passkey recovery remains the first path, but it is not accepted as the only path. A lost device can otherwise become permanently orphaned data merely because its credential was single-device, did not synchronize its PRF capability, or was lost before backup completed. That is an irrecoverable data-loss hole, not a reasonable simplification.

The mandatory recovery-code envelope above is the durable second path. It does not grant a company Owner, Vulto or any other employee access: only the Tier 3 data subject who presents the 256-bit generated code on a new PRF-capable device can open the root key and establish a new device envelope. The code is deliberately not a memorable phrase and is not a substitute for the online cold-start checkpoint; it is recovery material for Tier 3 keys only. Its capture-and-re-entry ceremony is mandatory because treating recovery as a best-effort reminder would recreate the very data-loss path this design closes.

**Tier 1.** Loss here is organizationally consequential, and the design must assume the person setting it up is an agency owner trying the product for the first time, not a security professional.

- **No free-form user-managed artifact.** The product generates the recovery material, displays it once with unmistakable labeling as a downloadable card, and requires correct re-entry before setup completes. That verification step is what separates genuine capture from a screenshot taken in passing.
- **A threshold scheme across people, not devices.** Two of three trusted people by default, so a single lost device or departed person never permanently locks an organization out of its own financial history. Onboarding actively nudges toward a second Tier 1 holder, framed as business continuity — *so a lost laptop never locks your business out of its own payroll history* — rather than as a security feature requiring a security mindset to appreciate.

### Cryptographic suite and recovery custody

The primitives below are fixed before implementation so neither the TypeScript Worker nor the Rust sync core invents a cryptographic format independently.

| Purpose | Construction |
|---|---|
| Protected document content | AES-256-GCM with a fresh random 96-bit nonce for every encryption under a document key |
| Tier 1 recipient envelope | P-256 ECDH with a fresh ephemeral sender key, HKDF-SHA-256, then AES-256-GCM encryption of the 256-bit document key |
| Tier 3 PRF envelope | WebAuthn PRF result, HKDF-SHA-256, then AES-256-GCM encryption of the 256-bit Tier 3 root key |
| Tier 3 recovery-code envelope | 256-bit generated recovery secret, HKDF-SHA-256, then AES-256-GCM encryption of the same Tier 3 root key |
| Tier 1 recovery envelope | A workspace recovery secret, split across trusted people under SLIP-0039's 2-of-3 default, HKDF-SHA-256, then AES-256-GCM encryption of the 256-bit document key |

Every encryption authenticates the same canonical protected-document header: format version, logical document address, key epoch, ciphertext kind and, for a recipient envelope, recipient user ID and ephemeral public key. The header is serialized with RFC 8785 JSON Canonicalization Scheme before becoming AES-GCM additional authenticated data. A changed address, reader, epoch or ciphertext kind therefore fails authentication rather than being accepted as an adjacent document.

**Tier 1 device transfer and recovery.** Each authorized person has a P-256 identity key pair. Its private half may leave an existing device only encrypted through a one-time P-256 ECDH transfer to a new device the same person is actively enrolling; it is never uploaded or stored as plaintext. If no existing device remains, two of the three trusted recovery holders reconstruct the workspace recovery secret in a recovery Worker's memory, unwrap the needed document keys, and re-wrap them to a newly generated identity key for the recovering person. The old reader entry is removed and future writes use the new epoch. The recovery secret and reconstructed document keys are never persisted or exposed to application code.

**No bespoke cryptography.** Implementations must use the browser Web Crypto API and the Rust equivalents of the exact constructions above. SLIP-0039 must come from a pinned, audited, standards-conformant implementation; a hand-written Shamir implementation is prohibited. The TypeScript and Rust implementations must share versioned test vectors for the canonical header, all envelope types, key rotation and recovery before either becomes the authoritative path.

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
| A003-T04 | Local device storage MUST be encrypted at rest with AES-256. After every cold restart it MUST remain locked until the server validates a current authenticated session and releases or derives volatile unwrap material. The raw session token, plaintext storage key and unwrap material MUST NOT be persisted alongside the data or exposed to application code. Once unlocked, the complete product MUST continue to operate without connectivity until the next cold restart. This is independent of, and does not substitute for, the Tier 1 and Tier 3 end-to-end scheme |
| A003-T05 | Tier 1 and Tier 3 documents MUST be encrypted client-side before transmission using this document's fixed cryptographic suite. The server MUST NOT possess or be able to derive any key capable of decrypting them, verified by an automated test confirming no server-side code path can decrypt a Tier 1 or Tier 3 payload |
| A003-T06 | A Tier 1 document's key MUST be wrapped for exactly the readers the node type's **effective grant** gives read access — its Privacy Class default **as overridden by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s per-node matrix, then less any subject exclusion that node type registers** — and for no others. The class default alone MUST NOT be used, and the reader set MUST NOT be resolved at role granularity where a person-level exclusion applies. Tier MUST NOT imply a reader set |
| A003-T07 | Key wrapping MUST support adding and removing readers without re-encrypting the underlying document. On revocation the key epoch MUST increment for future writes, with historical re-wrapping performed lazily on next authorized modification. On grant, the new reader's wrapped-key entry for the current retention window MUST be created immediately |
| A003-T08 | The sync engine MUST expose a SyncStatus observable any UI component may subscribe to |
| A003-T09 | Every sync delta MUST be logged to [[VPS-F004_Silent_Audit_Log|VPS-F004]], including its tier |
| A003-T10 | The sync engine MUST be a single shared core library used identically across all platforms |
| A003-T11 | Schema version mismatches MUST be handled gracefully. Older schema versions MUST NOT corrupt data written under newer ones |
| A003-T12 | Persistent Tier 3 access MUST use WebAuthn PRF to derive a device key-encryption key and create a PRF envelope for the Tier 3 root key. Platform-backed credentials are the first recovery path, but a product-generated 256-bit recovery-code envelope is mandatory as an independent second path. A user-chosen recovery phrase, Owner-held fallback or server-held recovery key is prohibited |
| A003-T13 | Any Tier 1 recovery artifact MUST be product-generated, unmistakably labeled, and the setup flow MUST require correct re-entry before completion |
| A003-T14 | Tier 1 recovery MUST support an M-of-N threshold scheme, two of three by default, using SLIP-0039 shares of a workspace recovery secret, so no single device loss or departure permanently locks the organization out |
| A003-T15 | Workspace setup MUST prompt for a second Tier 1 holder, framed as business continuity, and MUST require explicit acknowledgment if declined |
| A003-T16 | Any change removing Tier 1 access — including demotion, role change or subject exclusion — MUST remove the affected reader envelope, advance that protected document's key epoch and fire a document-scoped local wipe. Full device or membership revocation may additionally erase the whole local store; a Tier-1-only access change MUST NOT use whole-store erase as its substitute |
| A003-T17 | Closed Tier 1 records older than `tier1_retention_window_months` MUST NOT be materialized on any device by default. Default twelve months, configurable six to twenty-four |
| A003-T18 | Active, open Tier 1 records MUST always be available regardless of the window |
| A003-T19 | A Tier 1 record outside the window MUST be retrievable on demand and held locally for thirty days from most recent access, with expiry computed on-device without requiring connectivity |
| A003-T20 | Tier 1 documents MUST be partitioned by time period in addition to sensitivity |
| A003-T21 | Cryptographic erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] MUST destroy every wrapped-key entry and the document key, retain no copy in any backup generation, preserve the node and its edges, and write an [[VPS-F004_Silent_Audit_Log|VPS-F004]] record. It MUST fire a device wipe instruction for the affected documents |
| A003-T22 | A protected document's logical address MUST contain workspace, node type and schema partition, tier, concrete reader-set ID, time bucket and erasure-domain ID. A key MUST NOT span different reader sets or erasure domains |
| A003-T23 | `key_epoch` MUST version a protected document's logical address and every protected envelope MUST authenticate the canonical header defined in this document. An envelope with altered address, reader, epoch or ciphertext kind MUST fail authentication |
| A003-T24 | A Tier 3 recovery code MUST be generated from 256 random bits, canonically encoded as thirteen groups of four Crockford-Base32 characters (the first symbol is restricted to the low sixteen alphabet values) and correctly re-entered before setup completes. It MUST never be sent to the server, logged, persisted by Vulto after display or issued to an Owner |
| A003-T25 | Tier 3 recovery on a new device MUST require a current authenticated session whose canonical user ID exactly equals the Tier 3 data subject and sole-reader ID, successful WebAuthn PRF on that device and the recovery code. A company Owner role MUST NOT initiate, approve or receive recovery for another employee. Recovery MUST create a new PRF envelope, replace the recovery code and begin new document key epochs for future writes. A device without PRF MUST NOT gain persistent Tier 3 access |
| A003-T26 | P-256 ECDH, HKDF-SHA-256 and AES-256-GCM are the only Tier 1/Tier 3 envelope primitives. Protected document content uses AES-256-GCM with a fresh random 96-bit nonce per encryption. The TypeScript Worker and Rust core MUST share versioned cryptographic test vectors; a bespoke cryptographic primitive or hand-written Shamir implementation is prohibited |

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

**GIVEN** an authorized user cold-restarts Vulto while the device has no connectivity
**WHEN** the application attempts to open the encrypted local store
**THEN** the store remains locked without decrypting graph bytes; after connectivity returns and the server validates the current session, one online unlock opens it and the complete product continues offline until the next cold restart

---

**GIVEN** a user's access has been centrally revoked or the user has been offboarded
**WHEN** they cold-restart Vulto and attempt to reopen local HR data
**THEN** the server denies the unlock checkpoint and no persisted local graph bytes are decrypted

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

**GIVEN** an employee loses their only Tier 3 device and its passkey cannot recover the PRF envelope
**WHEN** they authenticate on a new PRF-capable device and correctly enter the mandatory recovery code
**THEN** the Worker opens the recovery-code envelope without sending the code or a usable key to the server, creates a new PRF envelope, requires replacement-code capture and re-entry, and starts new key epochs for future writes

---

**GIVEN** a user loses Tier 1 access through a role change but remains an active workspace member
**WHEN** the change reaches an authorized device
**THEN** only the affected protected documents lose that reader's envelopes and are purged locally; Tier 0 and Tier 2 data the member still legitimately reads remains available, and no whole-workspace erase is claimed as the operation

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

**Offline cold restart requires one online unlock.** The deciding factor is revocation, not convenience. Vulto Roster holds salaries, grievance cases, wellness records and performance reviews. A credential-bound local unlock could continue decrypting that data after central offboarding or revocation for as long as the device stayed offline. Requiring the server to validate a current session after every cold restart makes that restart a revocation checkpoint. The accepted cost is that a user who has both cold-restarted and lost connectivity cannot open Vulto until connectivity returns; once unlocked, full-day offline operation is unaffected. WebAuthn PRF is not universally available across browsers and authenticators, so the online path would remain necessary as a fallback even if credential-bound unlock were added. The restrained default also matches Vulto's product philosophy. This ruling is revisable if customer evidence shows the cold-start limit blocks real work: moving from online-only cold unlock to an optional credential-bound capability is additive, while removing an established offline unlock would take access away.

**Tier no longer implies a reader set.** The previous draft listed fixed recipients against Tier 1, which was accurate while Tier 1 held only financial data. [[VRS-F046_Case_Management_Disciplinary_and_Grievance|VRS-F046]] and [[VRS-F020_Universal_Contract_Builder|VRS-F020]] both place non-financial content at Tier 1, and had the tier carried its own reader set, grievance narratives and contract content would have been distributed to the finance team. Reader sets now derive from Privacy Class, per A003-T06.

**Cryptographic erasure is specified here** rather than left as an unresolved collision between [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1 and statutory erasure rights. Its two genuine limits — Tier 0 content and unreachable devices — are stated rather than glossed.

**`tier1_retention_window_months` is registered** in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Workspace Configuration Registry and exposed in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]. The previous draft described the window in prose without registering the key that configures it.

**Tier 3 key derivation is aligned with [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]** on WebAuthn PRF, with platform keychain backup. The two documents previously described the same mechanism in incompatible terms.

**Tier 3 has a mandatory second recovery path.** F106 accepted an availability cost — one online unlock after cold restart — because the simpler local-only path would leave a centrally revoked device able to decrypt HR data. This is the inverse shape. Treating a platform-backed passkey as the sole Tier 3 recovery mechanism would make loss of one unsynchronized or single-device credential permanently orphan a real customer's data. That irrecoverable data-loss hole is worse than the added complexity of a genuine recovery construction. The approved answer is not an Owner-issued fallback, which would widen a single-reader tier, nor a server-held key, which would defeat end-to-end protection. It is the mandatory product-generated 256-bit recovery code and its independent envelope, captured and verified at setup, usable only by the Tier 3 data subject on a new PRF-capable device under a session for that same subject. A company Owner role cannot trigger recovery, even while F130's general subject-exclusion gap remains open. Recovery rotates the code and future document epochs; it does not pretend to erase history a lost device already decrypted.

**The protected-document address and cryptographic suite are now explicit.** A tier alone could not decide which records may share a key: exact concrete readers, time retention and subject-level erasure would otherwise contradict each other. The address and no-shared-key rule above resolve that. The fixed AES-256-GCM, P-256 ECDH, HKDF-SHA-256, SLIP-0039 and canonical-header construction prevent the Worker and Rust core from separately inventing formats that merely appear compatible. FDN-52 owns this client-side document and key lifecycle; FDN-51 consumes its opaque envelope for relay, persistence and real-server ciphertext verification.

**A Tier-1-only access change is document-scoped, not whole-store revocation.** The FDN-63 implementation correctly erases the whole local store for explicit device and full membership revocation. It cannot be reused for an active member who only loses a protected reader grant: that would destroy Tier 0/2 data they are still allowed to hold. The corrected A003-T16 names the distinct operation and leaves the FDN-63/FDN-52 delivery boundary explicit.

**The resolved-question entry in Out of Scope is retired.** How wellness aggregates compute over Tier 3 records is answered by structural anonymization in [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] and [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]], and belongs in those documents rather than as archeology here.

**A tab reload requires the same online unlock as a device cold restart.** Scoping FDN-84 surfaced that "current process" was ambiguous about whether it meant the device or the Worker instance specifically. The unlock material exists only in Worker memory, so a new tab genuinely has none of it — the strict reading was already implied, and is now stated so it cannot be read the other way by accident. A SharedWorker that survived a tab reload could soften this later; it is not built now, because it would revise the Worker topology this project just settled without evidence the reload cost is worth that trade. Recorded as F119, same restrained-default asymmetry as the cold-restart ruling itself.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the stack and CRDT choice this document builds on
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the node registry and tier assignments
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer, and the reader sets this document wraps keys for
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the reference protocol, which depends on edge tier inheritance
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the infrastructure storing the ciphertext
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — data governance, retention and erasure

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

**The sealed store is also the durable commit boundary for security-sensitive client state.** FDN-84 owns an atomic compare-and-swap operation over one sealed logical record. The operation accepts the caller's expected durable generation and content digest, writes a staged next generation only if both still match, and returns the committed generation and digest. The comparison and replacement occur in one IndexedDB read-write transaction. A stale writer fails explicitly; it does not overwrite the winner.

FDN-52 must construct protected-state changes against a copy of the authoritative generation. The old live registry and its usable keys remain authoritative until the sealed compare-and-swap commits. Only then may the Worker publish the proposed registry, destroy superseded keys and report success. On rejection, abort or stale generation, it destroys the proposal and preserves the old live registry. This provides crash and concurrent-writer atomicity. It does **not** make a self-consistent historical copy of the entire device store detectable after cold restart: that stronger anti-rollback property requires a trusted monotonic anchor, owned as a future FDN-84/FDN-51 capability, and cannot be perfectly remote-anchored while a device is offline.

**True end-to-end encryption** (Tiers 1 and 3) means the server never possesses a usable decryption key in any form. It stores and relays ciphertext exclusively. A full breach of Vulto's servers, or a court order directed at Vulto itself, yields nothing readable, because there is nothing for Vulto to decrypt with.

**The browser boundary is precise rather than absolute.** Protected plaintext, Tier 1 and Tier 3 document keys, Tier 1 identity private keys, and Tier 3 roots remain inside the cryptographic Worker. WebAuthn and recovery ceremonies may transiently handle ceremony material in a narrowly scoped trusted Window path where browser APIs require it. Such material must never enter general application or React state, logs, persistence, telemetry, analytics or server APIs; transferable buffers move to the Worker immediately where possible and the sender's copy is detached or explicitly cleared. Worker isolation does not claim to defeat arbitrary same-origin code execution during an active ceremony. Recovery-code display and confirmation follow the same narrow-ceremony rule.

The production Worker protocol is typed and allowlisted. It exposes neither a caller-controlled sealed-store key nor a generic open operation. Protected manifests, root envelopes, document-key envelopes, wrapped Tier 1 identity records and sealed cryptographic internals are Worker-private. Test or diagnostic introspection capable of opening those records must be absent from the production protocol and production bundle, not merely hidden by caller convention.

### Tier 3 — single reader, with two independent recovery paths

Only the employee who is the Tier 3 data subject and sole reader ever reads their own Tier 3 data. A company **Owner** role is **not** a fallback reader, a recovery code is **not** issued to that role, and recovery never changes the Tier 3 reader set.

There is exactly one current Tier 3 root per `(workspace_id, canonical_subject_user_id)`. Its typed `Tier3RootAddress` contains exactly those two values plus construction identifier `vulto:tier3-root-address:v1`; it is a root-level address, not a protected-document address. A root never crosses either workspace or canonical-subject boundaries. Each Tier 3 document beneath it retains its own complete protected-document address and random 256-bit document key, encrypted under that root and used only for that document's content.

On the first PRF-capable device, the Worker generates root generation 0 and a random 256-bit Tier 3 root key. It also generates a fresh random 32-byte application PRF input. The browser evaluates WebAuthn PRF using that non-secret input; Vulto does not reproduce or replace the browser's specified PRF transformation. The 32-byte PRF result becomes HKDF input key material for a device key-encryption key, which encrypts the root into a **PRF envelope**. The PRF input is persisted as authenticated metadata, never treated as the PRF output or as secret. The server may store the root envelope and ciphertext, never a usable root or document key.

The same setup creates a mandatory, independent **Tier 3 recovery-code envelope**. The Worker generates a random 256-bit recovery secret, renders it as thirteen groups of four Crockford-Base32 characters, and requires the employee to re-enter it before Tier 3 setup completes. It is product-generated rather than a user-chosen phrase, is never sent to the server or logged, and is not persisted by Vulto after display. A key-encryption key derived from that secret encrypts the same Tier 3 root key into the recovery-code envelope. The employee may save the generated code in their chosen durable secure store; losing both it and every usable PRF credential remains a real loss, but it is no longer the default outcome of losing one device.

Platform backup of the same passkey credential may make its existing PRF envelope usable on another device, but Vulto does not assume it will. A new device becomes a persistent Tier 3 device only after it successfully evaluates PRF for the one current credential and opens that credential's current PRF envelope. A genuinely new credential obtains access only through the recovery/credential-replacement generation change below; it does not add a second indefinitely valid envelope to the old root. A device that cannot evaluate PRF is not eligible for persistent Tier 3 access; it must use a supported device for recovery rather than weakening the primary protection to accommodate an unsupported authenticator.

Recovery requires a current authenticated session **for that same data subject**, a PRF-capable new device, and the recovery code. This is an exact authenticated-person identity match to the Tier 3 sole-reader ID, not a role-based permission check: a company Owner cannot initiate, approve or receive another employee's recovery. That boundary holds independently of F130's currently unbuilt subject exclusion.

Successful recovery or credential retirement advances the Tier 3 **root generation**. The Worker opens the currently valid root through the authorized recovery path, generates a fresh root for the next generation, evaluates the new credential with a fresh random PRF input, wraps the new root in a fresh PRF envelope, generates and verifies a fresh mandatory recovery code, and wraps the new root in its fresh recovery envelope. It re-wraps affected Tier 3 document keys so their current and future usable state is rooted in the new generation, advances each affected document's key epoch for future writes, makes only the new root/recovery generation authoritative, and zeroes superseded raw root/document-key material as soon as it is no longer required. Historical document ciphertext is not eagerly re-encrypted solely because the root generation changed; it remains subject to the same lazy document lifecycle as Tier 1 history.

The replaced recovery code, even together with a saved prior recovery envelope, cannot yield the current root or decrypt writes made under post-recovery document epochs. A retired WebAuthn credential likewise cannot obtain the current root or future writes. This is a forward-write guarantee, not a claim that Vulto can erase plaintext or cryptographic material an old device already decrypted or copied. FDN-52 supports one current PRF credential per Tier 3 subject; intentionally simultaneous credentials require a separate future design rather than implicit extra envelopes to one long-lived root.

Loro merge for these documents happens in plaintext, but only on the Tier 3 data subject's authorized devices while the Worker holds the relevant key. A company Owner role has no access by virtue of that role. What crosses the network is an opaque encrypted blob.

### Tier 1 — multiple readers

Tier 1 data must be readable by several people, which rules out a device-bound key. The mechanism is **envelope encryption**: the document is encrypted once with a randomly generated document key, and that key is then wrapped separately for each authorized person's public key. Each person holds a private key that never leaves their device unencrypted. Anyone authorized unwraps the document key with their own private key, decrypts, reads, and re-encrypts on write. The server stores ciphertext and wrapped-key entries, never the private keys required to unwrap them.

There is one P-256 Tier 1 identity-key generation per `(workspace_id, canonical_user_id)`. It is a user/workspace identity key, not a Worker-lifetime or device identity. FDN-52 owns its versioned record and cryptographic lifecycle; FDN-84 owns sealed persistence and unlock. The private key is persisted only as a wrapped representation under the unlocked sealed-store key, using Web Crypto `wrapKey`/`unwrapKey` where supported so plaintext PKCS#8 bytes do not become application-visible data. After a genuine Worker recreation and normal FDN-84 unlock, the Worker unwraps the private key as nonextractable before materializing any Tier 1 document. A raw private key is never logged, returned through the Worker protocol or stored unencrypted.

**The wrapped-key recipient set is derived from Privacy Class, not from tier**, per the correction above.

### Revocation and grant are not mirror images

**Revocation is lazy.** When someone loses an authorized role, their wrapped-key entry is deleted and future writes are encrypted under a rotated key. Historical documents are re-wrapped under the new epoch only when an authorized device next opens and modifies them. Proactively re-encrypting years of history the instant one person leaves would spike bandwidth for every remaining device — a real cost on the intermittent connections this product is built for.

**This is worth being honest about.** Revocation prevents access going forward. It cannot retroactively make someone un-see data they already decrypted and could, in principle, have copied. No encryption scheme solves that, here or anywhere, and implying otherwise would be a false promise.

**Grants are immediate.** Waiting for some other device to eventually touch a historical record would leave a newly promoted HR Admin locked out of exactly the data their new role requires. Granting access wraps the current retention window immediately at grant time. Laziness is correct for revocation, where its cost is wasted bandwidth. It is wrong for grants, where its cost is a person unable to do the job they were just given.

### Cryptographic erasure

[[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] satisfies statutory erasure rights without violating [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1, and the mechanism lives here because it is a key-management operation rather than a data operation.

Cryptographic erasure applies to Tier 1 and Tier 3 protected documents. For the affected protected-document address or erasure domain, every usable current and historical document-key envelope is deleted across key or root generations, every loaded raw document key is destroyed, and no usable key copy is retained in any backup generation. The ciphertext remains. The nodes, their edges and their graph positions remain. Referential integrity is unbroken, aggregate history stays correct, and [[VPS-F004_Silent_Audit_Log|VPS-F004]] records that erasure occurred and when. Erasing one Tier 3 document does not destroy the subject root or unrelated Tier 3 documents that still require it.

Two honest limits, stated rather than glossed:

**Tier 0 and Tier 2 content are not protected by this mechanism**, because both use the standard-encryption architecture and have no per-document end-to-end envelope key to destroy. Their erasure is data-layer redaction or deletion plus the applicable local and server cache purge under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]. This is weaker than Tier 1 and Tier 3 cryptographic erasure. A future data class requiring mathematically irreversible subject-level erasure should ordinarily be reclassified to Tier 1 or Tier 3 rather than silently adding a second Tier 2 encryption architecture.

**A device that decrypted a document before erasure may retain a local copy** until it next synchronizes. Erasure fires a device wipe instruction for the affected documents, but a device that never reconnects cannot be reached. This is the same limitation as revocation, and it is a property of distributed systems rather than a defect in this design.

### Key recovery

**Tier 3.** Platform-backed passkey recovery remains the first path, but it is not accepted as the only path. A lost device can otherwise become permanently orphaned data merely because its credential was single-device, did not synchronize its PRF capability, or was lost before backup completed. That is an irrecoverable data-loss hole, not a reasonable simplification.

**What the first path is actually proven to do, stated so the claim is not read wider than the evidence.** Vulto's verification of the PRF path uses a Chromium CTAP2.1 virtual authenticator. That proves standards-level PRF wiring — that the construction, envelope and ceremony are correct against the WebAuthn specification. It does **not** prove native platform-authenticator interoperability, and specifically does not prove that any given operating system or password manager will synchronize a PRF-capable credential to a second device, or restore one from its own backup. Calling platform backup "the first path" is therefore a statement about intended order of use, not a verified availability guarantee, which is precisely why the recovery-code envelope below is mandatory rather than advisory. Recorded as F154.

The mandatory recovery-code envelope above is the durable second path. It does not grant a company Owner, Vulto or any other employee access: only the Tier 3 data subject who presents the 256-bit generated code on a new PRF-capable device can open the root key and establish a new device envelope. The code is deliberately not a memorable phrase and is not a substitute for the online cold-start checkpoint; it is recovery material for Tier 3 keys only. Its capture-and-re-entry ceremony is mandatory because treating recovery as a best-effort reminder would recreate the very data-loss path this design closes.

**Tier 1.** Loss here is organizationally consequential, and the design must assume the person setting it up is an agency owner trying the product for the first time, not a security professional.

- **No free-form user-managed artifact.** The product generates the recovery material, displays it once with unmistakable labeling as a downloadable card, and requires correct re-entry before setup completes. That verification step is what separates genuine capture from a screenshot taken in passing.
- **A threshold scheme across people, not devices.** Two of three trusted people by default, so a single lost device or departed person never permanently locks an organization out of its own financial history. Onboarding actively nudges toward a second Tier 1 holder, framed as business continuity — *so a lost laptop never locks your business out of its own payroll history* — rather than as a security feature requiring a security mindset to appreciate.

### Cryptographic suite and recovery custody

The primitives below are fixed before implementation so neither the TypeScript Worker nor the Rust sync core invents a cryptographic format independently.

| Purpose | Construction |
|---|---|
| Protected document content | AES-256-GCM with a fresh random 96-bit nonce for every encryption under a document key |
| Tier 1 recipient envelope | P-256 ECDH with a fresh ephemeral sender key; use `SHA-256(canonical protected-envelope header)` as HKDF salt and UTF-8 `vulto:tier1-recipient-envelope:v1` as HKDF info; then AES-256-GCM encryption of the 256-bit document key |
| Tier 1 existing-device identity transfer | One-time P-256 ECDH; use `SHA-256(RFC8785(Tier1IdentityTransferHeader))` as HKDF salt and UTF-8 `vulto:tier1-identity-transfer-kek:v1` as HKDF info; derive an AES-256-GCM KEK and wrap the identity private key with a fresh 96-bit nonce and the canonical header as AAD |
| Tier 3 PRF envelope | Fresh random 32-byte application PRF input; IKM is the browser-returned 32-byte WebAuthn PRF result; salt is `SHA-256(RFC8785(Tier3RootEnvelopeHeader))`; info is UTF-8 `vulto:tier3-prf-envelope:v1`; derive an AES-256-GCM key and encrypt the 256-bit Tier 3 root with a fresh 96-bit nonce and the canonical header as AAD |
| Tier 3 recovery-code envelope | IKM is the decoded/generated 256-bit recovery secret; salt is `SHA-256(RFC8785(Tier3RootEnvelopeHeader))`; info is UTF-8 `vulto:tier3-recovery-code-envelope:v1`; derive an AES-256-GCM key and independently encrypt the same generation's Tier 3 root with a fresh 96-bit nonce and the canonical header as AAD |
| Tier 1 recovery envelope | A workspace recovery secret, split 2-of-3 by default across trusted people using `shamir-secret-sharing` (Privy) `v0.0.3`, commit `ba50fa75758f753459280a98c19e690626317bd8`, pinned by npm SRI integrity `sha512-GPIb+QZDyjwwKSlVXEjHoOaBeevmdWz2IM2tz07nQvd0L9eMfLhzEqr7imajjjXCAO/cWgzXCCj0yFNMx6+miQ==` rather than by semver range; the reconstructed secret then feeds HKDF-SHA-256 and AES-256-GCM encryption of the 256-bit document key exactly as every other envelope in this table |

Protected-document encryption authenticates the canonical protected-document header: format version, logical document address, key epoch, ciphertext kind and, for a recipient envelope, recipient user ID and ephemeral public key. Root-key encryption instead authenticates a separate `Tier3RootEnvelopeHeader`; a protected-document header MUST NOT stand in for it. Both are serialized with RFC 8785 JSON Canonicalization Scheme before becoming AES-GCM additional authenticated data.

`Tier3RootEnvelopeHeader` binds construction identifier `vulto:tier3-root-envelope:v1`, the complete `Tier3RootAddress`, non-negative `root_generation`, and ciphertext kind. A PRF header additionally binds the WebAuthn credential ID and fresh 32-byte application PRF input. A recovery-code header additionally binds its non-negative recovery-envelope generation/identifier. That canonical header is both AES-GCM AAD and the preimage for the HKDF salt above. Altering root scope, generation, kind, credential ID, PRF input or recovery generation therefore fails authentication rather than selecting an adjacent root envelope.

**Tier 1 device transfer and recovery.** Each authorized person has the one P-256 identity key described above. Its private half may leave an existing device only wrapped through a one-time P-256 ECDH transfer to a new device the same canonical person is actively enrolling; it is never uploaded or stored as plaintext. `Tier1IdentityTransferHeader` binds construction/version, workspace ID, canonical user ID, source device ID, target device ID, one-time transfer ID, expiry, and the source identity and target transfer public-key identities. It is RFC 8785 canonicalized, authenticated as AES-GCM AAD and hashed for the transfer HKDF salt. The target rejects a wrong workspace, user, device, public-key identity, altered header, expired transfer or previously consumed transfer ID before installing the unwrapped private key as nonextractable. FDN-52 owns this format and lifecycle; FDN-63/FDN-89 authorize the enrollment and bind the canonical person/device identities; FDN-51 only delivers the opaque transfer.

If no existing device remains, two of the three trusted recovery holders reconstruct the workspace recovery secret in a recovery Worker's memory, unwrap the needed document keys, and re-wrap them to a newly generated identity key for the recovering person. The old reader entry is removed and future writes use the new epoch. The recovery secret and reconstructed document keys are never persisted or exposed to application code. This threshold-recovery fallback (A003-T14) is separately gated and is not implied by implementing existing-device transfer.

**No bespoke cryptography.** Implementations must use the browser Web Crypto API and the Rust equivalents of the exact constructions above. Tier 1 recovery's threshold secret-sharing step must come from a pinned, audited implementation of the enumerated-subset property A003-T14 states; a hand-written Shamir or secret-sharing implementation is prohibited, exactly as before — only the named artifact satisfying that rule has changed (see A003-T14's own note). The TypeScript and Rust implementations must share versioned test vectors for the canonical header, all envelope types, key rotation and recovery before either becomes the authoritative path.

### Tier 1 historical data retention

A device holding Tier 1 access does not need, and must not default to holding, the organization's entire financial history. Without a bound, a lost device or a delayed revocation exposes years of data rather than a manageable window.

**The window.** Closed Tier 1 records — completed PayRuns, past PaySlips, paid Invoices and superseded salary values — older than `tier1_retention_window_months` are not materialized on any device by default. `Expense` is Tier 0 and is therefore not governed by this Tier 1 window. Default twelve months, Owner-configurable between six and twenty-four in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]].

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
| A003-T04 | Local device storage MUST be encrypted at rest with AES-256. After every cold restart it MUST remain locked until the server validates a current authenticated session and releases or derives volatile unwrap material. The raw session token, plaintext storage key and unwrap material MUST NOT be persisted alongside the data or exposed to application code. Once unlocked, the complete product MUST continue to operate without connectivity until the next cold restart. FDN-84 MUST provide a sealed-record compare-and-swap whose expected generation and digest check plus replacement are atomic in one durable transaction. This is independent of, and does not substitute for, the Tier 1 and Tier 3 end-to-end scheme |
| A003-T05 | Tier 1 and Tier 3 documents MUST be encrypted client-side before transmission using this document's fixed cryptographic suite. The server MUST NOT possess or be able to derive any key capable of decrypting them, verified by an automated test confirming no server-side code path can decrypt a Tier 1 or Tier 3 payload |
| A003-T06 | A Tier 1 document's key MUST be wrapped for exactly the readers the node type's **effective grant** gives read access — its Privacy Class default **as overridden by [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s per-node matrix, then less any subject exclusion that node type registers** — and for no others. The class default alone MUST NOT be used, and the reader set MUST NOT be resolved at role granularity where a person-level exclusion applies. Tier MUST NOT imply a reader set |
| A003-T07 | Key wrapping MUST support adding and removing readers without re-encrypting the underlying document. On revocation the key epoch MUST increment for future writes, with historical re-wrapping performed lazily on next authorized modification. On grant, the new reader's wrapped-key entry for the current retention window MUST be created immediately |
| A003-T08 | The sync engine MUST expose a SyncStatus observable any UI component may subscribe to |
| A003-T09 | Every sync delta MUST be logged to [[VPS-F004_Silent_Audit_Log|VPS-F004]], including its tier |
| A003-T10 | The sync engine MUST be a single shared core library used identically across all platforms |
| A003-T11 | Schema version mismatches MUST be handled gracefully. Older schema versions MUST NOT corrupt data written under newer ones |
| A003-T12 | Persistent Tier 3 access MUST use WebAuthn PRF with a fresh random 32-byte application input to derive a device key-encryption key and create a PRF envelope for the Tier 3 root key. Platform-backed credentials are the first recovery path, but a product-generated 256-bit recovery-code envelope is mandatory as an independent second path. A user-chosen recovery phrase, Owner-held fallback or server-held recovery key is prohibited |
| A003-T13 | Any Tier 1 recovery artifact MUST be product-generated, unmistakably labeled, and the setup flow MUST require correct re-entry before completion. (Non-normative: the recovery artifact is scoped to the live document key only; it does not carry each historical key epoch's separately wrapped key, so it cannot cold-bootstrap a never-credentialed device from historical ciphertext — see `docs/Foundations_Findings.md` F185.) |
| A003-T14 | Tier 1 recovery MUST support an M-of-N threshold scheme, two of three by default, over a workspace recovery secret, implemented by a pinned, independently audited threshold secret-sharing library incorporating every fix from its own published security reviews. Approved implementation: `shamir-secret-sharing` (Privy) `v0.0.3`, commit `ba50fa75758f753459280a98c19e690626317bd8`, pinned by SRI integrity hash rather than semver range. Portability of a share outside Vulto's own software is explicitly not required — F183's ruling — so no vendor-neutral or hardware-wallet-interoperable share format (e.g. SLIP-0039) is mandated |
| A003-T15 | Workspace setup MUST prompt for a second Tier 1 holder, framed as business continuity, and MUST require explicit acknowledgment if declined |
| A003-T16 | Any change removing Tier 1 access — including demotion, role change or subject exclusion — MUST remove the affected reader envelope, advance that protected document's key epoch and fire a document-scoped local wipe. Full device or membership revocation may additionally erase the whole local store; a Tier-1-only access change MUST NOT use whole-store erase as its substitute |
| A003-T17 | Closed Tier 1 records older than `tier1_retention_window_months` MUST NOT be materialized on any device by default. Default twelve months, configurable six to twenty-four |
| A003-T18 | Active, open Tier 1 records MUST always be available regardless of the window |
| A003-T19 | A Tier 1 record outside the window MUST be retrievable on demand and held locally for thirty days from most recent access, with expiry computed on-device without requiring connectivity |
| A003-T20 | Tier 1 documents MUST be partitioned by time period in addition to sensitivity |
| A003-T21 | Cryptographic erasure under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] applies to Tier 1 and Tier 3. It MUST destroy every usable current and historical document-key envelope across key/root generations and every loaded raw document key, retain no usable copy in any backup generation, preserve ciphertext and graph structure, leave unrelated protected documents and any Tier 3 root they still need operational, write an [[VPS-F004_Silent_Audit_Log|VPS-F004]] record, and fire a device wipe instruction. Tier 0/2 use the weaker redaction/deletion/cache-purge semantics owned by VPS-F007 |
| A003-T22 | A protected document's logical address MUST contain workspace, node type and schema partition, tier, concrete reader-set ID, time bucket and erasure-domain ID. A key MUST NOT span different reader sets or erasure domains |
| A003-T23 | `key_epoch` MUST version a protected document's logical address and every protected-document envelope MUST authenticate its canonical protected-document header. An envelope with altered address, reader, epoch or ciphertext kind MUST fail authentication; Tier 3 root envelopes instead follow A003-T28 |
| A003-T24 | A Tier 3 recovery code MUST be generated from 256 random bits, canonically encoded as thirteen groups of four Crockford-Base32 characters (the first symbol is restricted to the low sixteen alphabet values) and correctly re-entered before setup completes. It MUST never be sent to the server, logged, persisted by Vulto after display or issued to an Owner |
| A003-T25 | Tier 3 recovery on a new device MUST require a current authenticated session whose canonical user ID exactly equals the Tier 3 data subject and sole-reader ID, successful WebAuthn PRF on that device and the recovery code. A company Owner role MUST NOT initiate, approve or receive recovery for another employee. Recovery MUST advance the root generation, generate a fresh root, PRF input, PRF envelope, recovery code and recovery envelope, transition current/future document-key state to that root generation and begin new document-key epochs. A device without PRF MUST NOT gain persistent Tier 3 access |
| A003-T26 | P-256 ECDH, HKDF-SHA-256 and AES-256-GCM are the only Tier 1/Tier 3 envelope primitives. Protected document content and every root envelope use AES-256-GCM with a fresh random 96-bit nonce per encryption. The TypeScript Worker and Rust core MUST share versioned cryptographic test vectors; a bespoke cryptographic primitive or hand-written Shamir implementation is prohibited |
| A003-T27 | A `Tier3RootAddress` MUST contain exactly workspace ID, canonical subject user ID and construction identifier `vulto:tier3-root-address:v1`. Exactly one current Tier 3 root generation exists per such address, and a root MUST NOT cross workspace or canonical-subject boundaries |
| A003-T28 | Every Tier 3 root envelope MUST authenticate the RFC 8785 `Tier3RootEnvelopeHeader` as AES-GCM AAD and use its SHA-256 digest as HKDF salt. A PRF header MUST bind credential ID and the persisted fresh 32-byte application PRF input; a recovery header MUST bind its authoritative recovery generation. A protected-document header MUST NOT substitute for this root-level header |
| A003-T29 | Successful Tier 3 recovery or credential retirement MUST advance root generation, make only the new generation authoritative, rotate current/future document-key state and zero superseded raw key material. A previous recovery code plus its saved previous envelope, or a retired credential plus its old envelope, MUST NOT recover the current root or decrypt post-rotation writes |
| A003-T30 | FDN-52 supports exactly one current PRF credential per Tier 3 subject. Multiple simultaneously valid credentials MUST NOT be introduced without a separate explicit design |
| A003-T31 | Exactly one current P-256 Tier 1 identity-key generation MUST exist per workspace ID and canonical user ID. FDN-52 MUST persist only its sealed wrapped private key through FDN-84 and MUST restore it as a nonextractable operational key after every genuine Worker recreation and normal unlock before Tier 1 materialization. Raw private-key bytes MUST NOT cross the production Worker protocol, logs, telemetry or unencrypted persistence |
| A003-T32 | Existing-device Tier 1 transfer MUST use the one-time, domain-separated P-256 ECDH/HKDF-SHA-256/AES-256-GCM construction and authenticated `Tier1IdentityTransferHeader` defined above. Wrong scope, identity, target, public-key binding, expiry, header authentication or replay state MUST fail closed. FDN-63/FDN-89 own enrollment authorization and identity binding; FDN-51 owns opaque delivery |
| A003-T33 | Every protected reader grant/removal, Tier 1 erasure, Tier 3 recovery and Tier 3 erasure MUST be staged without replacing live authoritative state, committed by FDN-84 sealed-record compare-and-swap, and published only after durable success. Rejection, abort or stale generation MUST destroy the proposal, preserve the prior live state and report failure. This guarantees crash/concurrent-writer atomicity, not detection of a complete historical device-store rollback |
| A003-T34 | Protected plaintext, document keys, Tier 1 identity private keys and Tier 3 roots MUST remain cryptographic-Worker-private. Browser-required WebAuthn/recovery ceremony material may exist only transiently in a narrow trusted Window path, MUST be transferred and detached/cleared immediately where possible, and MUST NOT enter general application state, logs, persistence, telemetry, analytics or server APIs. Arbitrary same-origin code execution during an active ceremony is outside the Worker-isolation claim |
| A003-T35 | The production Worker protocol MUST expose only typed allowlisted operations and MUST NOT expose a caller-controlled sealed logical key or generic protected-payload open operation. Protected manifests, root/document envelopes, wrapped identity records and sealed cryptographic internals MUST be structurally unreachable from the production protocol and bundle; test-only introspection MUST use a separate non-production surface |

---

## Sync transport contract (FDN-51 Stage 0)

This document settles the sync *topology* — Loro change blobs relayed through a coordination-only server, tier deciding whether that server can read them — and the *client-side* protected envelope, owned by FDN-52. It does not, until this section, define the bytes on the wire between a device and the relay. FDN-51 implements that wire format; this section is its normative contract, written before any relay code exists so the Rust shared core and the TypeScript client are built against one specification rather than two.

**This section is additive.** It changes nothing in the encryption, key-lifecycle or recovery sections above. The relay it describes stays a coordination layer that never holds a canonical copy and never possesses a Tier 1 or Tier 3 key.

**Runtime and transport are decided, not left open.** The `[[bin]]` relay server uses WebSocket over TLS 1.3 — a browser client gets genuine bidirectional push from nothing else, and HTTP/2 server-push and long-polling were both considered and rejected. The runtime is Tokio; the framework is Axum, using its built-in WebSocket upgrade. The `[lib]` shared core (A003-T10) stays transport-agnostic: it encodes and decodes framed message bytes and never opens a socket, so the same core drives the native server, the WASM client and a future mobile host identically.

**The cursor is the durability boundary.** A device learns a delta is safe — and the relay may forget that device's outbound obligation for it — only once the delta's row is transaction-committed in PostgreSQL. The relay assigns the per-device delivery cursor at that commit point, never at receipt. Reconnection replays strictly after the client's last acknowledged cursor. This is what makes "interrupted sync resumes without data loss" a property rather than a hope.

**The relay sees a tier tag and nothing else about content.** Every delta-carrying message has an explicit, unencrypted Tier 0/2-versus-Tier 1/3 tag so the relay can log (A003-T09) and route without opening ciphertext. That tag is transport metadata the relay is allowed to read. It is not FDN-52's authenticated protected-document header, and a relay or client that treated it as one would have a security bug: a Tier 1/3 payload's address and authenticity are established only by FDN-52's client-side header.

| ID | Specification |
|---|---|
| A003-T36 | The `services/sync-engine` `[[bin]]` relay MUST use WebSocket over TLS 1.3 minimum as its device transport, on the Tokio async runtime with the Axum framework and Axum's built-in WebSocket upgrade. HTTP/2 streaming and long-polling are rejected. The `[lib]` shared core MUST remain transport-agnostic — it produces and consumes framed message bytes only and MUST NOT open a socket or depend on a runtime |
| A003-T37 | Every sync message MUST be a fixed binary header — one-byte protocol version, one-byte message type — followed by its payload bytes. The message types are `Hello`, `PushDelta`, `PullSinceCursor`, `DeltaBatch`, `Ack`, `SyncStatus` and `Error`. An unknown or unexpected message type MUST fail closed with an `Error` reply and connection close; it MUST NOT be ignored |
| A003-T38 | `Hello` MUST carry the sender's protocol version and its session authentication material. A relay that does not implement the offered version MUST reject the connection with a typed `Error` (kind `unsupported-version`) and close it. Silent downgrade or best-effort cross-version compatibility is prohibited, consistent with A003-T10's single-shared-core discipline. Any wire-format change MUST increment the protocol version |
| A003-T39 | The relay MUST assign each accepted delta a durable, strictly increasing, per-device delivery cursor at the moment the delta's row is transaction-committed to PostgreSQL — not at receipt and not at enqueue. "Durably persisted" means the enclosing PostgreSQL transaction has committed. A cursor value MUST NOT be reused, skipped in a way that loses a delta, or reordered relative to commit order |
| A003-T40 | A client MUST acknowledge deliveries up to a cursor value with `Ack`. On reconnect, after `Hello`, the relay MUST replay every delta whose cursor is strictly greater than that client's last acknowledged cursor, in cursor order, before serving new live traffic. Duplicate, delayed or reordered receipt MUST be idempotent at the client (A003-T02); the relay MUST NOT rely on a client-supplied sequence number for ordering or deduplication |
| A003-T41 | Every `PushDelta` and `DeltaBatch` message MUST carry an explicit, unencrypted tier tag distinguishing Tier 0/2 (server-readable) from Tier 1/3 (opaque). The relay MAY read this tag for routing, VPS-F004 delta logging (A003-T09) and metrics. The tag is transport metadata the relay is permitted to see; it is NOT the FDN-52 protected-document authenticated header and MUST NOT be accepted in its place. A Tier 1/3 payload's address, epoch, reader set and authenticity are established only by FDN-52's client-verified header |
| A003-T42 | The wire format MUST be a minimal hand-rolled binary encoding — fixed header plus length-prefixed fields — with no schema-codegen toolchain (no protobuf, flatbuffers or equivalent). The Rust `[lib]` and the TypeScript client MUST share versioned encode/decode test vectors validated identically on both sides, following the A003-T26 shared-vector pattern |
| A003-T43 | No relay code path, PostgreSQL column, log line, metric or telemetry event may contain Tier 1/3 protected plaintext or any usable document or root key. The relay stores and forwards the opaque envelope bytes plus only the permitted transport metadata — tier tag, delivery cursor, device and workspace identifiers, timestamps. FDN-51 proves this at tier granularity on the real stack |
| A003-T44 | FDN-51 relays a tier-tagged envelope to every currently authorized device of the workspace. Filtering an individual delta's delivery so that an unauthorized recipient receives no ciphertext, no metadata and no indication the record exists — the WellnessTriggerEvent acceptance criterion — requires per-delta evaluation against FDN-89's concrete reader sets and is NOT part of FDN-51's closure. It is tracked as an open gap (`docs/Foundations_Findings.md` F186). Once concrete reader sets exist, they feed the relay's fan-out layer as a third consumer alongside the key layer and the query layer |

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
**THEN** every usable current and historical Tier 1 or Tier 3 document-key envelope and loaded raw document key in the affected erasure domain are destroyed with no usable backup copy retained, unrelated protected documents remain operational, the ciphertext and graph structure remain intact, referential integrity is unbroken, and [[VPS-F004_Silent_Audit_Log|VPS-F004]] records the event

---

**GIVEN** a Tier 1 user has previously opened protected documents on a device
**WHEN** that Worker is terminated, a genuinely new Worker completes the normal online unlock and restores the sealed identity-key record
**THEN** the identity private key is operational and nonextractable before materialization, and the authorized Tier 1 documents reopen without raw private-key bytes crossing the production protocol

---

**GIVEN** two Workers stage security-sensitive changes against the same protected-manifest generation
**WHEN** both attempt sealed persistence
**THEN** exactly one compare-and-swap commits; the loser fails explicitly without publishing or destroying the prior live state, and cold reopen reflects the single successful transition

---

**GIVEN** a production application caller can send any message accepted by the graph Worker
**WHEN** it attempts to request a Tier 1/Tier 3 manifest, root envelope, document-key envelope, wrapped identity record or other sealed cryptographic internal by logical key
**THEN** no production protocol operation can express that request

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
**THEN** the Worker opens the recovery-code envelope without sending the code or a usable key to the server, advances the root generation, creates a fresh root and PRF envelope from a fresh PRF input, requires replacement-code capture and re-entry, transitions current/future document-key state to the new root and starts new key epochs; the old code plus its saved old envelope cannot open the current root or post-recovery writes

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

**Cryptographic erasure is specified here** rather than left as an unresolved collision between [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1 and statutory erasure rights. Its genuine limits — Tier 0/2 standard-encryption content and unreachable devices — are stated rather than glossed.

**Cryptographic erasure is limited to Tier 1 and Tier 3 after F174.** Tier 0 and Tier 2 use standard encryption and therefore cannot honestly promise per-document key destruction. VPS-F007 owns their weaker redaction/deletion and cache purge. If a future class requires mathematical subject-level erasure, its protection tier should change instead of adding an undeclared Tier 2 envelope model.

**`tier1_retention_window_months` is registered** in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Workspace Configuration Registry and exposed in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]. The previous draft described the window in prose without registering the key that configures it.

**Tier 3 key derivation is aligned with [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]** on WebAuthn PRF, with platform keychain backup. The two documents previously described the same mechanism in incompatible terms.

**Tier 3 has a mandatory second recovery path.** F106 accepted an availability cost — one online unlock after cold restart — because the simpler local-only path would leave a centrally revoked device able to decrypt HR data. This is the inverse shape. Treating a platform-backed passkey as the sole Tier 3 recovery mechanism would make loss of one unsynchronized or single-device credential permanently orphan a real customer's data. That irrecoverable data-loss hole is worse than the added complexity of a genuine recovery construction. The approved answer is not an Owner-issued fallback, which would widen a single-reader tier, nor a server-held key, which would defeat end-to-end protection. It is the mandatory product-generated 256-bit recovery code and its independent envelope, captured and verified at setup, usable only by the Tier 3 data subject on a new PRF-capable device under a session for that same subject. A company Owner role cannot trigger recovery, even while F130's general subject-exclusion gap remains open. Recovery rotates the code and future document epochs; it does not pretend to erase history a lost device already decrypted.

**Amendment to that ruling — platform enumeration.** The ruling as originally written also asked this document to state which backup-eligible credentials and platforms are supported. It does not, and deliberately so: because the recovery-code envelope is mandatory and independent, Vulto never *depends* on platform backup, and a device either evaluates PRF for the current credential or is not eligible for persistent Tier 3 access. That behavioral rule covers every authenticator without enumerating any, and an enumerated list would additionally rot as platforms ship PRF support. The by-design answer is accepted as the better one and supersedes the enumeration instruction, so this is recorded as satisfied rather than outstanding. The honest limit that remains is the verification limit stated under Key recovery above, not a missing platform list.

**Tier 3 root identity and replacement are explicit after F164.** One root generation belongs to exactly one workspace and canonical subject, through a root address distinct from every protected-document address. Root envelopes have their own authenticated RFC 8785 header and exact WebAuthn-PRF/HKDF constructions. Recovery and credential retirement rotate the root generation, not merely the canonical envelope pointer: an old code plus a copied old envelope cannot follow the new root or future document epochs. The guarantee remains forward-only; copied plaintext and old-generation history are not retroactively erased.

**Tier 1's threshold secret-sharing requirement now names a specific pinned library, not SLIP-0039 — F167/F182–F184.** This document originally required SLIP-0039 shares by name for the M-of-N recovery secret. Checked directly against what the requirement was actually for: nothing else in this document asks for a transcribable mnemonic word-list share, and nothing asks for cross-vendor interoperability with hardware-wallet tooling such as Trezor's — the two properties that distinguish SLIP-0039 from generic Shamir secret sharing. SLIP-0039 had been selected as one way to satisfy the underlying M-of-N threshold property, not because either of its distinguishing properties was itself required.

Whether portability of a Tier 1 share outside Vulto's own software was nonetheless an implicit requirement was the one question that could not be settled by reading this document — it is a business-continuity question, not a cryptographic one. The founder ruled it is not: Vulto's own software may remain the only thing that can reconstruct a Tier 1 recovery secret.

With that settled, `privy-io/shamir-secret-sharing` was assessed as a direct replacement, in the same rigor previously applied to the SLIP-0039 candidates this document's own audit-and-pin requirement had already ruled out. The version initially proposed, `v0.0.4`, was found on reading its two published audit reports directly to have reverted the one fix either audit ever rated a security vulnerability — Cure53 rated it High, with the plain consequence that a set of parties one below the intended threshold could jointly recover at least one byte of the secret with certainty. That recommendation was withdrawn. `v0.0.3` — verified by direct source inspection to carry every fix from both of the library's published audits, with none reverted, and confirmed by exact commit and npm SRI integrity hash — is the version this document now names.

**Founder ruling, quoted:** *"F167 is CLOSED. shamir-secret-sharing@0.0.3, pinned by SRI hash (not semver), is the approved Tier 1 no-device recovery primitive. Portability without Vulto's own software (F183) is confirmed not required. The residual — two-firm, bounded-scope 2023 audit coverage on a narrow primitive — is accepted knowingly, not overlooked."* The full evidentiary record, including the withdrawn `v0.0.4` recommendation and the reasoning error that produced it, is kept in `docs/Foundations_Findings.md` under F182 through F184 rather than summarized away — the correction is part of why this ruling can be trusted, not something this document's own text needs to repeat.

**The protected-document address and cryptographic suite are now explicit.** A tier alone could not decide which records may share a key: exact concrete readers, time retention and subject-level erasure would otherwise contradict each other. The address and no-shared-key rule above resolve that. The fixed AES-256-GCM, P-256 ECDH, HKDF-SHA-256, pinned threshold secret-sharing (A003-T14) and canonical-header construction prevent the Worker and Rust core from separately inventing formats that merely appear compatible. FDN-52 owns this client-side document and key lifecycle; FDN-51 consumes its opaque envelope for relay, persistence and real-server ciphertext verification.

**A Tier-1-only access change is document-scoped, not whole-store revocation.** The FDN-63 implementation correctly erases the whole local store for explicit device and full membership revocation. It cannot be reused for an active member who only loses a protected reader grant: that would destroy Tier 0/2 data they are still allowed to hold. The corrected A003-T16 names the distinct operation and leaves the FDN-63/FDN-52 delivery boundary explicit.

**The resolved-question entry in Out of Scope is retired.** How wellness aggregates compute over Tier 3 records is answered by structural anonymization in [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] and [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]], and belongs in those documents rather than as archeology here.

**A tab reload requires the same online unlock as a device cold restart.** Scoping FDN-84 surfaced that "current process" was ambiguous about whether it meant the device or the Worker instance specifically. The unlock material exists only in Worker memory, so a new tab genuinely has none of it — the strict reading was already implied, and is now stated so it cannot be read the other way by accident. A SharedWorker that survived a tab reload could soften this later; it is not built now, because it would revise the Worker topology this project just settled without evidence the reload cost is worth that trade. Recorded as F119, same restrained-default asymmetry as the cold-restart ruling itself.

**F172–F175 make continuity, atomicity and the browser boundary explicit.** Tier 1 identity belongs to the user/workspace and survives ordinary Worker recreation through a sealed wrapped record; existing-device transfer has a fixed authenticated construction independent of the no-device threshold-recovery path (A003-T14). FDN-84's sealed compare-and-swap is the protected-state linearization point, while whole-store historical rollback remains an honest future limitation. The production Worker protocol cannot generically open internal sealed records, and browser-required ceremonies use a narrow trusted Window path without claiming resistance to active same-origin compromise.

**The sync transport contract is fixed before the relay is written — FDN-51 Stage 0.** This document previously defined the sync topology and the client-side protected envelope but not the wire format between a device and the relay. The "Sync transport contract" section and A003-T36–T44 close that gap: WebSocket over TLS 1.3 on Tokio/Axum for the `[[bin]]` server with a transport-agnostic `[lib]` core; a fixed binary message header with a closed set of message types; version negotiation that rejects rather than downgrades; a per-device delivery cursor assigned at PostgreSQL transaction commit, replayed on reconnect from the client's last acknowledgement; an unencrypted tier tag the relay may read for routing and logging but which is explicitly not a substitute for FDN-52's authenticated header; and a hand-rolled length-prefixed binary format with shared Rust/TypeScript vectors rather than a codegen toolchain. The founder ruled the three open questions from FDN-51's decision memo: WebSocket + Tokio + Axum (HTTP/2 streaming rejected — no genuine browser bidirectional push); FDN-51 Stage 5 closes on tier-level opacity only, with per-delta recipient filtering (the WellnessTriggerEvent criterion) recorded as open finding F186 and left to FDN-89's concrete reader sets feeding the relay fan-out layer; and cargo-chef dependency-layer caching in the Dockerfile now rather than waiting on FDN-55 registry work.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the stack and CRDT choice this document builds on
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the node registry and tier assignments
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer, and the reader sets this document wraps keys for
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the reference protocol, which depends on edge tier inheritance
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the infrastructure storing the ciphertext
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — data governance, retention and erasure

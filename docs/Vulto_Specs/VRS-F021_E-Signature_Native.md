---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F021
---

# VRS-F021 — E-Signature Native

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F020_Universal_Contract_Builder|VRS-F020]] (Contract, and the `contract.markSent` / `contract.markSigned` handoff points), [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] (where the signed document is filed), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (SignatureRequest's registry entry), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 1 envelope encryption, extended here to a one-time signing key), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (transactional email delivery)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature.

---

## Scope

This feature signs **Contracts produced by [[VRS-F020_Universal_Contract_Builder|VRS-F020]], and nothing else.**

Extending it to arbitrary documents in [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] is a natural later addition and is not built here. `document_type` is an enum of one — deliberately not pre-populated with NDA or Offer, neither of which any feature in this product generates. NDAs are [[Vulto Legal]]'s permanent territory; [[VRS-F032_Offer_Management|VRS-F032]] records offer terms as structured data rather than as a signable document.

---

## What It Is

A built-in, legally-binding signing flow entirely inside Vulto Roster. No DocuSign, no HelloSign, no third-party tab opening mid-workflow.

A sender designates signature fields, adds signatories in order, and the system generates a secure single-use signing experience for each — **requiring no account from the recipient.** On completion the Contract is marked Signed and the final document is filed.

---

## Problem It Solves

Every external signature tool adds friction to a moment that should be instant: an unfamiliar sender account, an email from a platform the recipient does not recognize, and a signed document living in a system the HR record must be reconciled against by hand afterwards.

For an agency closing a hire this routinely adds a day or two, and occasionally costs a candidate who accepts a competing offer while waiting on paperwork.

---

## User-Facing Flows

### Sending

From a Draft Contract the sender places signature fields onto the document preview by dragging from a small palette — Signature, Initials, Date, Text — each assigned to a specific signatory. They add each signatory's name, email and role, and set the signing order.

Confirming calls `contract.markSent` per [[VRS-F020_Universal_Contract_Builder|VRS-F020]] and creates the SignatureRequest.

### The recipient's experience

Each signatory receives a branded email with a secure link, sent only when it is their turn. Opening it requires no account and no password: **the link is the credential.**

The document renders full-screen with a fixed progress indicator — *1 of 2 signatures required* — and a single prominent action scrolling to the next required field. Signing is a deliberate explicit action, never a passive scroll-through.

### Sequential signing

Sequential only. A signatory at position two does not receive their link until position one has signed.

This is deliberate rather than a limitation to apologize for: simultaneous multi-party signing introduces a coordination question — whose signature is authoritative if two people sign conflicting versions concurrently — that sequential signing avoids entirely by construction.

### Completion

The moment the final signatory signs, the Contract's status becomes Signed, every party receives the completed document by email, and the signed PDF is filed to [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] at Tier 1.

### Expiry

A link unused for `signature_link_expiry_days`, default 30, expires. The recipient sees a clear message directing them to request a new link from HR, never a broken page or a silent failure.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Field placement | Content, split | Place fields, add signatories |
| Signing | Full-bleed, no shell, unauthenticated | The recipient's experience |
| Signature status | Section on the Contract | Progress and evidence |

### Layout and components

**Field placement** reuses [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s split layout: signatory setup left, document preview right. Fields are dragged from a palette onto the preview and render as 120×32px outlined rectangles tinted by signatory in `cat-n`, labeled with the signatory's name at `micro`.

Signatories are an ordered list with drag-to-reorder. Each row holds name, email, role and a color swatch matching their fields. The order is the signing order — an implicit mapping rather than a separate number field, since a list that is visually ordered and separately numbered will eventually disagree with itself.

**The signing screen** is the only unauthenticated surface in this product and is designed accordingly: no navigation, no product chrome, no marketing. A fixed header with the agency's name and the progress indicator, the document at reading width, and a single fixed `primary` action reading **Next field** until the last, then **Sign and complete**.

Required fields carry a 2px `border-focus` ring and a small `attention` dot. Completed fields render the entered value and lose the ring. **The action never says Submit**, and never appears before the recipient has reached the first field.

**Signature status** on the Contract is a compact list: each signatory, their status Badge, and once signed the timestamp in `mono`. The IP and user agent are collapsed behind a **View signing evidence** disclosure — present for legal defensibility, not something to display beside a colleague's name by default.

### Keyboard

The signing screen supports `Tab` between fields and `Enter` to advance. It is fully operable by keyboard, since a signatory may be on any device and this is the one screen in the product where a person cannot ask for help.

### System states

| State | Treatment |
|---|---|
| Syncing | Field placement works from local cache where the Draft Contract is local |
| Restricted | SignatureRequest follows Contract's HR-restricted class. A Manager sees neither |
| Expired | A full-screen message with the agency's contact, never a 404 |
| Already signed | The link renders the document as signed, with no second signature possible |
| Error | A network failure during signing preserves entered field values locally and offers retry |

### Responsive

The signing screen is designed mobile-first and is fully functional at 375px. It is the surface most likely to be opened on a phone, frequently by someone who has never used this product and never will again.

---

## Technical Architecture

### The SignatureRequest schema

HR-restricted, Tier 2 — it references a Contract but carries no salary data of its own.

```
request_id:          UUID v4
workspace_id:        UUID
document_id:         UUID, FK to Contract
document_type:       enum: Contract
sender_id:           user_id UUID
package_reference:   string — opaque pointer to the encrypted signing package
                     in object storage per VPS-A006
signatories:         JSON array, ordered, embedded rather than a separate node
                     type, per the convention for small ordered sub-structures
                     belonging to one parent:
                     [{
                       signatory_role, recipient_email, recipient_name,
                       signing_order,
                       signature_field_positions: [{ page, x, y, width, height,
                         type: Signature | Initials | Date | Text }],
                       signed_at, signed_from_ip, signed_user_agent
                     }]
status:              enum: Pending, PartiallyComplete, Complete, Expired, Voided
signed_document_hash: string, SHA-256, nullable — computed on the final signed
                     PDF at assembly, so later tampering is detectable
expires_at:          timestamp

— Universal Node Conventions per VPS-A002 —
```

### The signing package, and the problem it solves

This is the substantive architectural addition, and it resolves a hole the previous specification did not address.

A Contract's `rendered_content` is Tier 1 — end-to-end encrypted, readable only by devices holding a wrapped key. **A signatory has no account, no device registration and no key.** They must nonetheless read the document in order to sign it. And per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], Vulto's servers cannot assemble or read a Tier 1 document, so the server cannot simply render it for them.

The mechanism:

1. **At send**, the sender's authorized device — which can already decrypt the contract — renders the document and produces a **signing package**: the PDF plus field positions.
2. That package is encrypted with a freshly generated **one-time signing key**, used for this request only.
3. The one-time key is wrapped twice: once for each signatory, and once for the workspace's Tier 1 recipient set through [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s standard envelope.
4. Each signatory's wrapped key travels **in the URL fragment of their signing link** — the portion of a URL a browser never transmits to the server.
5. The server stores ciphertext and wrapped keys. It holds nothing that lets it read the package.
6. The signatory's browser extracts the fragment, decrypts locally, renders and signs.
7. **On completion**, the next authorized device to connect assembles the final signed PDF from the package and the signature evidence, computes the hash, and files it through `document.createFromSource` at Tier 1.

The Contract's status becomes Signed immediately on the final signature. The filed Document arrives when an authorized device assembles it — typically within seconds, and the status surface shows the difference honestly rather than implying the document exists before it does.

### The signing link

A JWT signed with the application's private key carrying `{ request_id, signatory_index, exp }`, **plus the wrapped one-time key as a URL fragment.** Generated on demand when a signatory's turn arrives, never stored in the graph — only `expires_at` is.

Signing is one-time and idempotent. Once `signed_at` is set, a subsequent visit shows the document as already signed rather than offering a second signature.

### Why this feature keeps its own evidence

A legally defensible signature must show who signed, when and from where **at the moment it happens**, not later once a general audit feature exists. `signed_at`, `signed_from_ip` and `signed_user_agent` are captured on each signatory's own record for exactly that reason.

This feature also writes to [[VPS-F004_Silent_Audit_Log|VPS-F004]] for the unified cross-feature view, but its own legal record does not depend on that.

### Sequential enforcement

`signatureRequest.notifyNext` fires only for the signatory at the lowest `signing_order` whose `signed_at` is null, and only once every prior signatory has signed. The first is notified on creation.

### API contracts

```
signatureRequest.create(contractId, signatories) -> { requestId }
  // Renders and encrypts the package client-side, wraps the one-time key,
  // calls contract.markSent in the same transaction

signatureRequest.getSigningLink(requestId, signatoryIndex) -> { url }
  // Generates the JWT fresh and appends the wrapped key as a fragment.
  // Never a stored, retrievable value

signatureRequest.sign(requestId, signatoryIndex, signatureData) -> {
  requestId, allComplete
}
  // Sets signed_at, signed_from_ip, signed_user_agent for that signatory only.
  // Rejects if already signed or if it is not yet their turn

signatureRequest.assembleCompleted(requestId) -> { contractId, documentId }
  // Runs on an authorized device. Assembles the final PDF, computes the hash,
  // files via document.createFromSource at Tier 1, calls contract.markSigned
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | SignatureRequest carries the schema above. `document_id` points to a Contract, the only supported type |
| G02 | Signing order is strictly enforced. A signatory receives no link, and `sign` rejects, until every lower order has signed |
| G03 | On completion the `has_document` edge from Contract to Document is created by this feature, not by [[VRS-F020_Universal_Contract_Builder|VRS-F020]] |
| G04 | `signed_document_hash` is computed once, at assembly, over the final PDF. It is never recomputed — its entire purpose is detecting whether the file changed after that moment |
| G05 | The signing package is encrypted client-side with a one-time key. The server MUST NOT hold any key capable of decrypting it |
| G06 | A signatory's wrapped key travels only in the URL fragment and MUST NOT be transmitted to or logged by the server |
| G07 | The filed Document inherits Tier 1 from the source Contract per [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s provenance rule, never Document's Tier 0 default |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F021-S01 | SignatureRequest schema and sequential logic | Data |
| VRS-F021-S02 | Signing package encryption and key wrapping | Security |
| VRS-F021-S03 | Sender field placement and signatory setup | UI |
| VRS-F021-S04 | Recipient signing experience | UI |
| VRS-F021-S05 | Completion, assembly and filing | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a sender places two fields and adds two signatories in order
**WHEN** the request is created
**THEN** `contract.markSent` is called, only signatory one receives a link, and the Contract's status is Sent

---

**GIVEN** signatory one has not signed
**WHEN** signatory two attempts to sign
**THEN** no link has been sent to them and a direct attempt is rejected

---

**GIVEN** a signatory opens their link
**WHEN** the document renders
**THEN** it decrypts in their browser using the key fragment, and no request carrying that fragment reaches the server

---

**GIVEN** the signing package is inspected directly in object storage
**WHEN** the raw bytes are read
**THEN** they are unreadable ciphertext, and no server-side key can decrypt them

---

**GIVEN** the final signatory signs
**WHEN** assembly runs on an authorized device
**THEN** the signed PDF is generated, the hash computed, a Document created at Tier 1, `has_document` created, and the Contract marked Signed

---

**GIVEN** a link unused for the configured expiry
**WHEN** it is accessed
**THEN** a clear expiry message appears directing the recipient to HR

---

**GIVEN** a signatory revisits their link after signing
**WHEN** it loads
**THEN** the document displays as signed with no second signature possible

---

## Non-Functional Requirements

- Link generation completes within 1 second
- Package encryption and upload complete within 10 seconds for a typical contract at send
- Final assembly and filing complete within 30 seconds of an authorized device connecting after the last signature
- The signing screen loads and renders within 3 seconds on a mobile connection
- Sender-side field placement functions offline where the Draft Contract is local. Link generation and delivery require connectivity, since a link must reach an external inbox

---

## Security Considerations

- **The one-time signing key is the mechanism that makes an unauthenticated signatory possible without weakening Tier 1.** Without it, either the server would need to read the contract — breaking [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s guarantee — or the signatory could not see what they were signing.
- **The URL fragment is the delivery channel precisely because browsers do not transmit it.** It appears in no server log, no access log and no referrer header. It does appear in the recipient's browser history and in the email itself, which is an accepted and stated limitation: the link is the credential, and a compromised inbox compromises the signature. This is true of every e-signature product and is not made worse here.
- **`signed_from_ip` and `signed_user_agent` are collected for legal defensibility, not tracking**, and are visible only to roles who can already see the SignatureRequest, behind a disclosure rather than displayed by default.
- **The JWT is scoped to one signatory and one request.** It cannot be replayed against a different signatory's fields or a different request, even if intercepted.
- **Email delivery is per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]**: the message carries the link and no contract content. A signing email that quoted the salary would defeat the package model entirely.

---

## Out of Scope

- **Signing arbitrary documents in [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]** — a natural extension, not built here
- **Simultaneous non-sequential multi-party signing** — a deliberate boundary, not a gap
- **Wet signatures on paper** — digital only
- **Per-workspace branded email templates** — a fixed professional default; customization is a later decision
- **Identity verification of the signatory beyond email possession** — knowledge-based authentication and document verification are a different product

---

## Decisions Recorded

**The signing package model is new and closes a real hole.** The previous specification stated that the document renders full-screen for the signatory without addressing how a Tier 1 document reaches someone with no account, no device and no key. The three available answers were to weaken Contract's tier, to let the server decrypt, or to build the package. The first two undo [[VRS-F020_Universal_Contract_Builder|VRS-F020]]'s and [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s central guarantees.

**The email provider question is resolved** by [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] rather than carried as an open item. That gap was correctly flagged here and in two other documents, and it belonged at the architecture level.

**Signing order is implicit in list position** rather than a separate numeric field. A visually ordered list with independent numbers will eventually disagree with itself, and the disagreement surfaces as a contract sent to the wrong person first.

**Final assembly happens on an authorized device**, not on completion of the last signature. The alternative would require the server to assemble a Tier 1 document, which [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] prohibits. The status surface reports the difference honestly rather than implying the filed document exists before it does.

---

## Related Notes

- [[VRS-F020_Universal_Contract_Builder|VRS-F020]] — the contract this feature signs
- [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] — where the signed document is filed, at inherited Tier 1
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the envelope encryption this feature extends
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — email delivery and object storage

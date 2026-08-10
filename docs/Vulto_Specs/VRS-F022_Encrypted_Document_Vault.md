---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Compliance
aliases:
  - VRS-F022
---

# VRS-F022 — Encrypted Document Vault

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee, the organizing principle), [[VRS-F020_Universal_Contract_Builder|VRS-F020]] (Contract, the first provenance source), [[VRS-F021_E-Signature_Native|VRS-F021]] (which files a signed contract here), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Document's registry entry and Standing Rule 8's provenance inheritance), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 1 envelope encryption, extended here to file blobs), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (object storage, presigned URLs and malware scanning)
**Blocks:** Nothing structurally, but every future feature filing a sensitive document depends on the inheritance mechanism defined here to avoid silently leaking what an earlier feature deliberately protected.

This document is the single source of truth for this feature.

---

## What It Is

Per-employee document storage: identity documents, certifications, and any document another feature files here — most concretely a signed contract's PDF from [[VRS-F021_E-Signature_Native|VRS-F021]].

Every document belongs to exactly one employee. **A document's tier is not fixed by Document being a single node type; it is determined by where the document came from.** An uploaded certification defaults to Tier 0. A signed contract inherits Tier 1. A background check report inherits Tier 2.

---

## Problem It Solves

Two problems, not one.

**The ordinary case:** an agency needs somewhere to keep ID scans, degree certificates and certification proofs against each employee's profile. Currently nowhere in this graph.

**The reason this feature's design took care:** a generic document store that does not distinguish a routine certification scan from a signed employment contract stating an exact salary is a security regression waiting to happen.

[[VRS-F020_Universal_Contract_Builder|VRS-F020]] deliberately places contract content at Tier 1 rather than Tier 2, because a generated contract states a salary. [[VRS-F021_E-Signature_Native|VRS-F021]] then produces a signed PDF of exactly that content and files it here. **Were Document a flat Tier 0 node, that PDF would land server-readable and broadly synced the moment it was filed** — re-exposing the same figure through a different door. This document closes that.

---

## User-Facing Flows

### Viewing an employee's vault

The Documents section on an employee's profile lists every document belonging to them: name, category, upload date, and for a provenance-elevated document an accurate indicator of who can actually open it.

### Uploading directly

An HR Admin uploads an ID scan or certification proof. Tier defaults to Tier 0. **An HR Admin may explicitly mark an upload as sensitive**, elevating it to Tier 2 — for a document that does not fit the default but is not financial either, such as a signed NDA scanned in from outside the system.

### A document filed by another feature

When [[VRS-F021_E-Signature_Native|VRS-F021]] completes a signature flow it calls this feature's creation path with the source Contract, and the resulting Document inherits Tier 1 **automatically**, without the filing feature or the HR Admin having to remember.

Tier correctness for a provenance-created document is this feature's responsibility, not every calling feature's to get right independently.

### Downloading

The request checks the caller's permission against the document's actual tier. A Tier 1 or Tier 2 document decrypts client-side using the same envelope mechanism [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] defines. A Tier 0 document simply downloads.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Documents | Section on the Employee profile | The vault |
| Upload | Modal | Short, complete, not abandonable |

### Layout and components

A Table: file name, category Badge, size, uploaded date, uploaded by. Rows carry a small lock glyph where tier is elevated, with the tooltip naming the role that can open it — *Visible to Finance Admin* — matching [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s visibly-restricted copy.

Primary action **Upload document**, opening a Modal with a drop zone, a category Select and a **Mark as sensitive** Switch. The Switch carries helper text stating plainly what it does: *Restricts this document to HR Admin and Owner.* A control that silently changes an access model is a control people will set wrongly in both directions.

**A Tier 1 document a viewer cannot open does not appear as a locked row.** It is structurally absent per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], because the existence of a signed contract for a specific person is itself an inference a Manager should not draw from a grayed-out entry.

**Upload progress** shows two stages: uploading, then scanning per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. The second is worth showing separately — a file that has uploaded but is not yet retrievable is a state a user will otherwise interpret as a failure.

### Keyboard

Standard list bindings. `U` opens the upload modal from the Documents section.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Scanning | The row renders with a `Scanning` Badge and no download action |
| Restricted, visible | Elevated documents the viewer may know exist show the lock and the role |
| Restricted, absent | Tier 1 documents render nothing at all for a viewer without access |
| Aged out | Tier 1 documents outside [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s window render dashed with **Fetch** |
| Empty | *No documents on file.* with **Upload document** |
| Error | A rejected upload states the reason: size, type, or a failed scan |

### Responsive

Drops `uploaded by`, then `size`, below 1280px.

---

## Technical Architecture

### The Document schema

```
document_id:       UUID v4
workspace_id:      UUID
employee_id:       UUID, nullable, FK to Employee
candidate_id:      UUID, nullable, FK to Candidate — EXACTLY ONE of this and
                   employee_id is set, never both, never neither. No vault
                   entry is ever unowned. See the ownership note below
document_category: enum: IdentityDocument, Certification, SignedContract,
                   WorkAuthorization, CV, BackgroundCheckReport, Other
content_tier:      enum: Tier0, Tier1, Tier2 — Tier0 by default. Set at creation
                   and never recomputed, since a later change to the source's
                   tier must not retroactively alter an already-filed document
source_node_type:  string, nullable — null for a direct upload
source_node_id:    UUID, nullable
file_name:         string, required
file_size_bytes:   integer
mime_type:         string
storage_reference: string — opaque pointer per VPS-A006. Never a guessable path
scan_status:       enum: Pending, Clean, Rejected
uploaded_at:       timestamp
uploaded_by:       user_id UUID
lifecycle_status:  enum: Active, Archived

— Universal Node Conventions per VPS-A002 —
```

### Two owners, exactly one set

A document belongs to a person, and in this product a person is either an Employee or a Candidate. **Exactly one of `employee_id` and `candidate_id` is set**, enforced at write.

This is [[VRS-F028_Recruitment_Pipeline|VRS-F028]]'s change, made because a candidate's CV is otherwise unstorable. The alternative — a second document mechanism for candidates — would have duplicated encryption, malware scanning, presigned access and retention for no benefit, and would have left one of the two mechanisms weaker than the other within a year.

**Where a candidate converts to an employee**, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Conversion Event Protocol, their documents are **not re-pointed.** They remain owned by the Candidate node, which itself remains traversable from the resulting Employee through `converted_from`. Rewriting ownership on conversion would break the audit trail of when a document was actually filed and against whom.

`document.listForEmployee` therefore traverses that conversion edge, so a hired candidate's CV appears on their employee profile without any field having been rewritten.

### Provenance-based tier inheritance

`document.createFromSource` is **the only path that sets a tier other than Tier 0.** It reads the source node's own tier from [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s registry at creation and applies it: Tier 1 for a Contract, Tier 2 for a BackgroundCheckRecord once [[VRS-F035_Background_Check_Integration|VRS-F035]] registers itself as one.

This is [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 8 in practice — the general principle that a provenance-derived node inherits its source's tier, which this feature was the first to require and which now governs six node types.

### File encryption

A Tier 0 blob is encrypted at rest with standard encryption. **A Tier 1 or Tier 2 blob is encrypted client-side before upload** using the same envelope, multi-recipient key-wrapping scheme [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] defines for structured Tier 1 data — extended from small JSON fields to arbitrary file blobs. The mechanism is identical; only the payload size differs.

Per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], the object store receives ciphertext and metadata revealing only workspace, size and timestamp, and object keys contain no human-readable subject matter.

### Retention

Governed by [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s schedules per document category, never by a bucket lifecycle policy invented here. An erasure request destroys the blob's key material per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s cryptographic erasure, leaving the Document node and its edges intact.

### API contracts

```
document.upload(employeeId, file, category)          -> { documentId }
  // Tier 0 by default

document.uploadSensitive(employeeId, file, category) -> { documentId }
  // Explicitly elevated to Tier 2 by an HR Admin at upload

document.createFromSource(employeeId, file, sourceNodeType, sourceNodeId)
                                                     -> { documentId }
  // Called by other features. content_tier is read from the source node's
  // registered tier, never chosen by the caller

document.getDownloadUrl(documentId) -> { url, requiresClientDecryption }
  // Presigned, 15-minute TTL per VPS-A006. Permission-checked against the
  // document's actual content_tier

document.listForEmployee(employeeId) -> Document[]
  // Filtered per the caller's access to each document's actual tier.
  // An inaccessible Tier 1 document is structurally absent, never a
  // locked placeholder

document.archive(documentId) -> { success }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Document carries the schema above. Exactly one of `employee_id` and `candidate_id` is set, enforced at write. A document is never unowned |
| G01b | A candidate's documents are not re-pointed on conversion to an employee. `document.listForEmployee` traverses `converted_from` so they surface on the employee profile without ownership being rewritten |
| G02 | `content_tier` is set once at creation — from the source's tier for a provenance-created document, Tier 0 by default for a direct upload — and never recomputed |
| G03 | A Tier 1 or Tier 2 document is structurally absent from query results for any role without matching access |
| G04 | The `has_document` edge inherits the more restrictive tier of its endpoints per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. This is additional to, not a substitute for, the node's own `content_tier` — the edge rule alone would not protect a flat Tier 0 node queried directly |
| G05 | `document.createFromSource` is the only path setting a non-default tier. A caller cannot choose one |
| G06 | A document is not retrievable until `scan_status` is Clean, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] |
| G07 | Tier 1 and Tier 2 blobs are encrypted client-side before upload. The object store never receives plaintext for those tiers |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F022-S01 | Document schema and provenance tier inheritance | Data |
| VRS-F022-S02 | Per-employee vault surface | UI |
| VRS-F022-S03 | Direct upload, standard and sensitive | Logic |
| VRS-F022-S04 | Encrypted storage and client-side decryption | Security |

---

## Feature Acceptance Criteria

**GIVEN** an HR Admin uploads a certification scan with no source node
**WHEN** the upload completes
**THEN** `content_tier` is Tier0 and the document is visible per Document's default permission

---

**GIVEN** [[VRS-F021_E-Signature_Native|VRS-F021]] files a signed contract through `createFromSource`
**WHEN** the Document is created
**THEN** `content_tier` is Tier1, matching the source Contract, not Document's Tier 0 default

---

**GIVEN** a Manager views their report's Documents
**WHEN** the list loads
**THEN** the Tier 1 signed contract is structurally absent — not a locked entry — while Tier 0 documents remain visible

---

**GIVEN** a Finance Admin requests a Tier 1 contract-sourced document
**WHEN** the request is processed
**THEN** access is granted per Contract's own content permission, and the file decrypts client-side

---

**GIVEN** a Tier 1 blob is inspected directly in object storage
**WHEN** the raw bytes are read
**THEN** they are unreadable ciphertext, and the object key reveals nothing about the subject

---

**GIVEN** an unrelated Tier 1 node is later updated
**WHEN** an already-filed contract-sourced document is viewed
**THEN** its tier remains Tier1, unaffected, since tier is set once and never recomputed

---

**GIVEN** an uploaded file has not completed scanning
**WHEN** a download is requested
**THEN** it is refused, and the row shows the scanning state rather than an error

---

**GIVEN** a candidate's CV is filed against them and that candidate is later hired
**WHEN** `document.listForEmployee` is called for the resulting employee
**THEN** the CV appears, traversed through `converted_from`, with `candidate_id` still set and `employee_id` still null

---

**GIVEN** a document write sets both `employee_id` and `candidate_id`, or neither
**WHEN** it is attempted
**THEN** it is refused at the write layer

---

**GIVEN** an approved erasure request covering an employee
**WHEN** erasure executes
**THEN** the blob's key material is destroyed, the Document node and its edges remain, and the file is permanently unreadable

---

## Non-Functional Requirements

- A Tier 1 or Tier 2 blob is never stored or transmitted in plaintext to Vulto's servers
- A Tier 0 download begins within 1 second; client-side decryption adds no more than 500ms for typical document sizes
- Tier inheritance completes atomically with document creation, never as a separate step that could be skipped
- Upload accepts files to `max_file_size_mb`, default 25, configurable in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]]

---

## Security Considerations

- **The provenance-inheritance mechanism is this document's central contribution**, not any specific feature. Every future feature filing a document derived from sensitive data inherits the protection by calling `createFromSource` correctly, rather than needing to classify its own output.
- **A direct upload's tier is chosen by the uploading HR Admin, not inferred**, since there is no source to inherit from. `uploadSensitive` exists so that a human judgment — *this scanned document is sensitive even though nothing forced it to be* — has a real path rather than being stuck at Tier 0 or requiring a workaround.
- **`storage_reference` is opaque, never a guessable path**, consistent with [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s requirement that object keys carry no human-readable subject matter.
- **The category enum is itself a small disclosure.** A document categorized WorkAuthorization implies something about a person's immigration status even where the file is unreadable. Categories are visible only to roles who can already see the document exists, which for an elevated-tier document is the same set who can open it.

---

## Out of Scope

- **Signing arbitrary vault documents** — [[VRS-F021_E-Signature_Native|VRS-F021]] extension, buildable now that Document has a real schema, not built here
- **Document versioning.** A re-upload is a new Document and the old one is archived, rather than superseded through a version chain the way a rate card is
- **OCR, automatic expiry detection, or any content-aware processing** — this feature stores and protects files; it does not read them
- **A document owned by neither an Employee nor a Candidate** — a workspace-level document store with no person attached is a different feature. Every entry here belongs to someone
- **Retention schedules** — [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]

---

## Decisions Recorded

**The object storage question is resolved** by [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] rather than carried as an open item. This document correctly flagged it as an architecture-level decision; it now has an architecture-level answer, including presigned URLs, malware scanning and the object-key naming constraint.

**`scan_status` is added.** [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] requires every upload be scanned before becoming retrievable, and a document with no representation of that state would either block silently or appear broken during the window.

**`WorkAuthorization` is added to the category enum**, since [[VRS-F045_Right_to_Work_and_Immigration_Compliance|VRS-F045]] files documents here and an immigration document filed as `Other` loses the categorization that makes a vault searchable.

**Document gains `candidate_id` as an alternative owner**, per [[VRS-F028_Recruitment_Pipeline|VRS-F028]]. `CV` and `BackgroundCheckReport` are added to the category enum alongside it, since a candidate document filed as `Other` loses the categorization that makes a vault searchable. Ownership is deliberately not rewritten on conversion — the record of when a document was filed and against whom survives the person's change of status.

**Standing Rule 8 in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] generalizes this feature's mechanism.** The inheritance principle originated here and now governs six node types, which is why this document references the rule rather than restating the reasoning a second time.

---

## Related Notes

- [[VRS-F021_E-Signature_Native|VRS-F021]] — which files signed contracts here
- [[VRS-F020_Universal_Contract_Builder|VRS-F020]] — the source whose tier a signed contract inherits
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — object storage, scanning and presigned access
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — retention and erasure

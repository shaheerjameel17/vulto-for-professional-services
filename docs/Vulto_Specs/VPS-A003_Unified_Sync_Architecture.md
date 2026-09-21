---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-09-20]]"
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
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the sync client, server persistence and API layer are settled facts), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (node registry, privacy classes and tier assignments)
**Blocks:** [[VPS-A004_Graph_Permission_Layer|VPS-A004]], [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]], [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]], and every feature in every application

This document is the single source of truth for how data moves between the server and devices, what a device is allowed to hold, and how data is encrypted. **One sync architecture serves every application**, because there is one graph. [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] owns the customer-facing trust controls built on top of it — staff access, customer-managed keys, residency, published artifacts — and does not restate the mechanics here.

**This document was rewritten on 20 September 2026 and supersedes the local-first, device-canonical architecture it previously specified.** The reasoning is in Context and in Decisions recorded, and the change is recorded as F199 in `docs/Foundations_Findings.md`.

---

## Decision

**PostgreSQL is the single source of truth. Devices hold a fast, permission-filtered cache of it.**

- **Reads** are local and instant for operational data. The server replicates each person's authorized slice of Tier 0 data into a SQLite database on their device, which the typed query layer reads directly. Protected data (Tiers 1 and 2) is fetched on demand through the API and held in memory only.
- **Writes** are optimistic. A mutation applies to the local cache immediately, is queued, and is uploaded to the API, which validates it through [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor and commits it to PostgreSQL in one transaction. The committed result replicates back. The server's answer is final.
- **Offline**, the product boots from the local cache, reads every Tier 0 surface, and queues Tier 0 writes until connectivity returns. Tier 1 and Tier 2 data require a connection.
- **Encryption** is standard encryption at rest everywhere, plus **field-level encryption under keys held in a key management service** for Tiers 1 and 2. The server can read protected data inside an authorized, audited request, which is what lets it run payroll, reports, alerts, exports and support. [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] governs who at Vulto can ever cause that to happen.
- **True end-to-end encryption survives only as Tier 3**, a self-contained module for data a person's employer must never read, built with the first feature that needs it.

A bespoke CRDT, a device-canonical graph, and a custom sync relay are prohibited.

---

## Context

The previous architecture made every device a canonical copy of the graph, merged changes with a CRDT, and encrypted compensation, payroll, rate cards, contracts and HR cases end to end so that Vulto's servers could never read them. It was coherent and carefully built. It was reversed for five reasons, each of which surfaced in building it rather than in theory.

**Every feature paid for it, not only the foundation.** Forty-six of seventy-eight feature specifications depended on Tier 1 or Tier 3 behavior, or on work running "on an authorized device". Workflows with state — approvals, payroll sign-off, leave decisions — needed bespoke conflict designs because two offline devices could reach contradictory states. The projected cost was roughly double the effort per feature, and more for the financial features that carry the product's margin intelligence.

**The server could not do server work.** Rate cards and pay data were unreadable to the server, so margin alerts, scheduled payroll reports, exports, integrations, the Sync API and the intelligence engine could run only when an authorized person's device happened to be online. Some could never behave the way a customer expects.

**Lost keys were unrecoverable business data.** In a twenty-person agency the Owner is usually the only finance holder. A lost laptop without two of three recovery holders would have made payroll history, rate cards and contracts permanently unreadable, and Vulto's support could not have helped.

**The offline benefit had already been given up.** A cold restart or tab reload required an online unlock, and only one tab synchronized. The product carried the full cost of local-first without its main availability benefit.

**Customers were not buying it.** [[VPS-003_Commercial_Model|VPS-003]] did not mention privacy, encryption or local-first once. Buyers in this category ask for access control, audit, encryption at rest, residency and assurance reports; the stronger promise that Vulto *cannot* read salaries was an untested hypothesis carrying most of the engineering cost. End-to-end encryption in a web application is also weaker than it sounds, because the server delivers the code that holds the keys on every page load, so the promise always rested on trusting Vulto.

**What the reversal does not give up.** Speed: a Linear-grade feel comes from a local cache, optimistic writes and pushed updates, none of which require the device to be canonical. Permission rigor: [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor remains the single decision point and becomes stronger for running on the server. Offline: cached reads and queued writes cover the intermittent connectivity of the target markets, and the product now boots offline where the previous design could not. Trust: [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] replaces an unverifiable mathematical claim with controls a customer can check and that survive a lost laptop.

---

## Sync topology

```
                       ┌───────────────────────────────┐
  Device (browser/app) │  SQLite cache  (Tier 0 only)  │◄── shape streams over HTTP
                       │  Outbox        (Tier 0 writes)│──► graph.applyMutations (tRPC)
                       │  Memory cache  (Tier 1/2)     │◄── protected.read (tRPC, audited)
                       └───────────────────────────────┘
                                        │
                                        ▼
         services/api (Fastify + tRPC) — VPS-A004 interceptor — the only writer
                                        │
                                        ▼
         PostgreSQL — canonical graph, protected field store, audit journal
                                        │  logical replication
                                        ▼
         Electric sync service — serves each person's two fixed shapes, filtered by the sync audience
```

**There is exactly one writer to the canonical graph: `services/api`.** The replication service reads from PostgreSQL and never writes to it. Jobs write through the same mutation path as people do.

---

## Data protection tiers

**Tier determines where data may live and how it is encrypted. Privacy Class determines who may read it.** These remain orthogonal: [[VPS-A004_Graph_Permission_Layer|VPS-A004]] resolves readers from Privacy Class and its per-node matrix, and the tier decides what the storage, sync and key layers do with a record once readers are known.

| Tier | Name | Canonical storage | On a device | Server can read? | Erasure |
|---|---|---|---|---|---|
| **Tier 0** | Workspace | PostgreSQL, encrypted at rest | Replicated to the device cache of each person permitted to read it; available offline | Yes | Redaction or deletion |
| **Tier 1** | Protected | Protected field store, field-level AES-256-GCM under a per-erasure-domain data key | Memory only, fetched on demand; never persisted to device storage | Only inside an authorized, audited API request or job | **Cryptographic**: destroy the data key |
| **Tier 2** | Sensitive | Protected field store, field-level AES-256-GCM under the workspace's Tier 2 data key | Memory only, fetched on demand; never persisted to device storage | Only inside an authorized, audited API request or job | Redaction or deletion |
| **Tier 3** | Private | End-to-end encrypted to the data subject alone, per the Tier 3 module below | Only the data subject's own devices | **No** | Cryptographic |

The Privacy Class to default Tier mapping is unchanged, and it is **total** — every class [[VPS-A004_Graph_Permission_Layer|VPS-A004]] defines appears:

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

**This produces a default, not the assignment.** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] holds the authoritative tier of every node type and marks each deliberate departure.

**A single node may still straddle tiers.** Employee's operational fields are Tier 0 and its compensation fields are Tier 1, sharing one `employee_id`. The Tier 0 half replicates; the Tier 1 half lives in the protected field store and is joined in by the query layer when an authorized reader fetches it. A reader not authorized for the protected half receives nothing about it, and [[VPS-A004_Graph_Permission_Layer|VPS-A004]] decides whether it renders as `None` or as a schema-derived `Restricted` placeholder. Pitch, Contract, Requisition, Offer and HRCase follow the same pattern.

**Edges inherit the more restrictive tier of their endpoints.** An edge between a Tier 0 node and a Tier 2 node is stored and served as Tier 2. Without this, a replicated edge would reveal a protected relationship even while the protected node stayed on the server.

**Why Tier 1 and Tier 2 remain distinct.** Both are field-encrypted, server-held and memory-only on devices. The difference is erasure: Tier 1 content is keyed per erasure domain, so a subject's protected content can be destroyed mathematically; Tier 2 uses one workspace data key and is erased by deletion. Compensation figures, commercial terms, contracts and case narratives earn the stronger guarantee.

---

## The canonical store

The graph's shape is unchanged — typed nodes and first-class edges per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — and is persisted in PostgreSQL as:

| Table | Holds | Replicated? |
|---|---|---|
| `graph_nodes` | One row per node: identity, `workspace_id`, `node_type`, `lifecycle_status`, `schema_version`, universal conventions, and Tier 0 properties as `jsonb` | Yes, filtered |
| `graph_edges` | One row per edge: identity, triple, endpoints, `effective_from`, `effective_to` as indexed columns, Tier 0 metadata | Yes, filtered, when both endpoints are Tier 0 |
| `graph_protected_fragments` | One row per protected partition of a node or edge: `tier`, `schema_partition`, `erasure_domain_id`, `data_key_id`, ciphertext, nonce, authenticated header | **Never** |
| `protected_data_keys` | Data keys, each wrapped by the workspace key-encryption key | **Never** |
| `graph_mutations` | The accepted mutation log: client mutation ID, actor, base versions, outcome | **Never** |
| `sync_node_audience`, `sync_edge_audience` | The **sync audience**: which person may hold which Tier 0 node or edge on a device. Identifiers only — `workspace_id`, `user_id`, `node_id` or `edge_id` — never content | Yes, as the subquery source of each person's shapes |

**The replication publication is an allowlist.** Only `graph_nodes`, `graph_edges`, `sync_node_audience` and `sync_edge_audience` are published to the replication service, and a CI gate (A003-T58) fails the build if any other table, or any column holding protected content, becomes reachable from a sync shape.

**`managed_by` is a server-validated temporal edge.** The reporting hierarchy was previously a CRDT Movable Tree so that concurrent offline moves could not create a cycle. With one writer, a move is a single mutation, `org.moveEmployee`, executed in a serializable transaction that rejects a cycle and closes the prior edge's `effective_to` while opening the new one's `effective_from`. The effective date is supplied by the caller and never defaulted to the wall clock.

**Rich text** — every field [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]]'s reference protocol applies to — is stored as a structured JSON document and written whole under last-write-wins. Real-time character-level co-editing is out of scope.

---

## Reads

**Tier 0 reads are local.** The device cache is a SQLite database maintained by the sync client. `packages/graph`'s typed query layer runs against it inside the sync client's worker, never on the main thread, and meets [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s budgets because no read waits for the network.

**What reaches a device is decided by the sync audience, materialized from [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s policy table, never written by hand.** The audience materializer in `services/api` evaluates the interceptor for every member of a workspace and writes one row into `sync_node_audience` or `sync_edge_audience` for each Tier 0 node or edge that member may read. It runs inside the transaction of every mutation for the rows that mutation touched, and recomputes a whole workspace's audience whenever a membership, role or `managed_by` edge changes, because those change scope for many rows at once.

**Every device subscribes to exactly two fixed shapes**, through the API's authenticated shape proxy: `graph_nodes` where `workspace_id` is the session's workspace and `node_id` is in the person's `sync_node_audience` rows, and the same for `graph_edges`. The proxy sets the table, the where clause and its parameters from the verified session; a client supplies none of them. Electric tracks the subquery, so a row entering or leaving a person's audience appears on or disappears from their device without any further mechanism. One source — the interceptor — decides both what a person may query and what their device holds, and a conformance test (A003-T57) asserts, for every role and privacy class, that every audience row is one the interceptor permits.

**Tier 1 and Tier 2 reads are fetched.** `protected.read` returns the decrypted protected partitions the interceptor permits for the requested nodes, writes an audit event before responding, and marks the response uncacheable. The client holds the result in memory for the session and discards it on sign-out, workspace switch, role change or tab close. Screens that need protected values — the Bench Forecast's cost figures for an Owner, a profile's compensation tab — **prefetch** them when the session starts, so an authorized person rarely sees them load.

**Three kinds of absence remain distinguishable,** carried as an availability outcome separate from rows, per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]: `permission-absence` (never available to this person), `requires-connection` (protected data the person may read but the device is offline), and `mid-sync` (the cache has not caught up). `requires-connection` replaces the former retention-window state; [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] renders it with the aged-out treatment and a **Retry** action.

---

## Writes

**Every write is a named mutation.** Feature code calls a typed mutator — `assignment.create`, `timesheet.submit`, `leave.approve` — that is implemented twice from one definition in `packages/schema`: an optimistic client version that updates the local cache, and an authoritative server version that runs in `services/api`. They share validation and may differ in effect; the server's result replaces the optimistic one when it replicates back.

**The server pipeline is fixed:** authenticate, resolve roles, run [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s write gates, validate against [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s registry, apply domain rules, write the audit event, and commit — all in one PostgreSQL transaction. Anything that fails rolls the whole mutation back.

**Idempotency.** Every mutation carries a client-generated `mutation_id`. The server records it in `graph_mutations`; replaying the same ID returns the original outcome and never applies twice. This is what makes a queued offline write safe to retry.

**Rejection is visible.** A rejected mutation reverts its optimistic effect and appears in the SyncStatus surface with the reason. It is never silently dropped.

---

## Offline behavior

| Capability | Offline |
|---|---|
| Boot the product, including after a cold restart or tab reload | **Yes**, from the device cache, with a previously established session |
| Read every Tier 0 surface | **Yes** |
| Read Tier 1 or Tier 2 values | No — `requires-connection` |
| Tier 0 writes | **Queued**, applied optimistically, uploaded in order on reconnect |
| Tier 1 or Tier 2 writes, and mutations the registry marks `online-only` | No — the action is disabled with the reason stated |
| Sign in for the first time on a device | No |

The application exposes a SyncStatus observable at all times — `Synced`, `Syncing`, `PendingChanges`, `Offline`, and `NeedsAttention` when a queued mutation was rejected — surfaced per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]].

**All browser tabs of one application share one sync connection and one cache.** A second tab never shows data the first has already superseded.

---

## Conflict resolution

With one writer, a conflict is a mutation whose assumptions no longer hold when it reaches the server.

| Situation | Resolution | Rationale |
|---|---|---|
| Two people edit different fields of one node | Both apply | Mutations write only the fields they name |
| Two people edit the same field | The later commit wins; both are in the audit journal | Field-level last-write-wins, as before, now ordered by the server |
| A state transition — approve, reject, submit, sign — against a record whose `version` has moved since the client read it | **Rejected** with `stale-state`; the person sees the current state and decides again | A workflow must never end both approved and rejected. Every state-transition mutation carries the base `version` it was decided against |
| A queued offline write whose target was deleted or archived meanwhile | Rejected with the reason; nothing is resurrected | The server's current state is authoritative |
| An edit to a node whose reader has since lost permission | Rejected by the interceptor | Permission is evaluated at commit time, not at the time the person typed |
| Schema version mismatch | A client below the server's minimum version is asked to reload before it may upload | A stale client must not write a shape the registry no longer accepts |

---

## Server-side processing

**The server may process every tier except Tier 3.** Payroll calculation, contract and payslip rendering, scheduled reports, alerts, exports, imports and the intelligence engine run as jobs in `services/jobs`.

**Every job acts as a principal the interceptor can evaluate.** A job triggered by a person runs with that person's effective grant, re-evaluated when the job executes; if the grant was withdrawn meanwhile, the job stops and says why. A system job — retention sweeps, erasure, key rotation — runs as a named system principal whose permitted operations are listed in [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s policy table, and nothing else. Every protected read and write by a job is audited exactly as a person's would be.

**Plaintext never leaves the process that needed it.** Decrypted Tier 1 and Tier 2 values exist only in the memory of the API or job process handling an authorized operation. They never enter logs, metrics, traces, analytics, error reports, email bodies, caches outside that process, or any other table, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s redaction rules.

---

## The encryption architecture

**In transit.** TLS 1.3 minimum on every connection between a device, the API, the replication service and the database.

**At rest, everywhere.** PostgreSQL volumes, backups, object storage and the replication service's storage are encrypted at rest by the provider. This protects against lost disks and careless backups. It does not protect against someone with database access, which is what field-level encryption is for.

**Field-level encryption for Tiers 1 and 2.** A three-level key hierarchy:

| Level | Key | Held where | Purpose |
|---|---|---|---|
| Root | Customer master key | AWS KMS, in the workspace's residency region. Vulto-managed by default; customer-managed under [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] | Never leaves KMS. Wraps and unwraps workspace keys |
| Workspace | Key-encryption key (KEK), one per workspace | `protected_data_keys`, wrapped by the root key | Wraps that workspace's data keys |
| Data | Data key (DEK), one per Tier 1 erasure domain and one per workspace for Tier 2 | `protected_data_keys`, wrapped by the KEK | Encrypts protected fragments with AES-256-GCM and a fresh 96-bit nonce per encryption |

Every protected fragment authenticates a canonical header — format version, workspace, node ID, node type, schema partition, tier, erasure domain, data key ID — as AES-GCM additional authenticated data, serialized with RFC 8785. A fragment moved to another node, partition or workspace fails to decrypt rather than decrypting in the wrong place.

**An erasure domain** is the subject whose erasure must destroy the content: the Employee a salary or payslip concerns, the subject of an HR case, and otherwise the node itself. No data key spans two erasure domains, so erasing one person never destroys another's content.

**Unwrapped keys live briefly and only in memory.** The API and job processes may cache an unwrapped KEK or DEK for at most five minutes, per process, and never write one anywhere. A database dump, a backup or read access to PostgreSQL therefore yields ciphertext for every Tier 1 and Tier 2 field.

**Rotation.** Workspace KEKs rotate annually and on demand, which re-wraps data keys without re-encrypting content. A data key is rotated by re-encrypting its domain's fragments, performed by a system job when a key is suspected compromised.

**Local development and CI** use a `LocalKeyProvider` behind the same `KeyProvider` interface, with its root key supplied by the environment; production refuses to start with it (A003-T73).

**Standard primitives only.** AWS KMS, Web Crypto and Node's `crypto` module implementing AES-256-GCM and HKDF-SHA-256. No bespoke cryptography.

### Cryptographic erasure

[[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] satisfies statutory erasure without violating [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 1. For a Tier 1 erasure domain, the wrapped data key and every retained copy of it are destroyed, including in backups that are still within retention, because key records are backed up separately and expire on a shorter schedule than content. The ciphertext, the node, its edges and its graph position remain; the content is permanently unreadable. [[VPS-F004_Silent_Audit_Log|VPS-F004]] records that erasure occurred.

**Tier 0 and Tier 2 erasure is redaction or deletion**, which is weaker, and is described as such. A device that cached Tier 0 subject data is told to purge it on its next connection; a device that never reconnects cannot be reached, and that limit is stated rather than glossed.

### Revocation

**Revocation is immediate at the server** and needs no key rotation, because no device holds a key. When a person loses access — offboarding, a role change, becoming the subject of a record — the interceptor denies their next request, their sync audience narrows, and the replication service instructs their devices to remove rows they may no longer hold. An explicitly revoked device is told to erase its cache entirely on its next connection.

**Stated honestly:** revocation cannot make someone un-see data they already viewed, and a device offline since revocation keeps its Tier 0 cache until it reconnects. Tier 1 and Tier 2 data were never on the device, which is the point of keeping them memory-only.

---

## Tier 3 — the private module

**Tier 3 holds data a person's employer must never read**: wellness check-ins, individual pulse and coffee-pulse responses. It is the one place end-to-end encryption earns its cost, because "your employer cannot see this" is the feature itself, and losing it harms only the person who chose it.

**Tier 3 is a self-contained module, not part of the substrate.** It is built with the first feature that registers a Tier 3 node type — [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]], [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] or [[VRS-F077_Monthly_Coffee_Pulse|VRS-F077]] — and **no Tier 3 node type may be implemented before it exists.** Its source is published under [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] so the claim can be checked.

The design is fixed now so that it is not reinvented later:

- **One reader.** Only the data subject reads their Tier 3 records. No role, including Owner, is a fallback reader or recovery holder.
- **Keys.** One random 256-bit root key per `(workspace_id, subject_user_id)`, and a random 256-bit document key per record, encrypted under the root. Content uses AES-256-GCM with the authenticated header pattern above.
- **Device access** through a WebAuthn PRF envelope: the PRF output feeds HKDF-SHA-256 to derive a key-encryption key for the root. A device that cannot evaluate PRF cannot hold persistent Tier 3 access.
- **Recovery** through a mandatory product-generated 256-bit recovery code, displayed once and re-entered before setup completes, which independently wraps the same root. Recovery requires a current session for the same person, a PRF-capable device and the code; it advances the root generation so an old code or credential cannot read future records.
- **Loss** of every credential and the recovery code loses that person's Tier 3 records, and nothing else. The product says so plainly at setup.
- **Aggregates** — team wellness and pulse trends — are computed from separately submitted, structurally anonymous contribution records under [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s k-anonymity rule, never by decrypting individual entries on a server.
- **The server stores ciphertext and relays it only to the subject's devices.** Tier 3 records are the one exception to "devices hold no protected data": they sync to the subject's devices, encrypted, through a dedicated stream.

The construction previously implemented for this under FDN-52 (`tier3-root.ts`, `tier3-partitions.ts`) is preserved in the archive branch recorded in F199 and is the starting point when the module is built.

---

## Technical specifications

**A003-T01 through A003-T50 are retired** with the architecture they specified and are never reissued. Their text remains in this document's history and in the archive branch recorded in F199.

| ID | Specification |
|---|---|
| A003-T51 | PostgreSQL MUST be the single source of truth for every tier except Tier 3's plaintext. No device, cache or replication store may be treated as canonical |
| A003-T52 | `services/api` MUST be the only writer to the canonical graph. The replication service MUST have read-only database access. Jobs MUST write through the same mutation path as people |
| A003-T53 | Every write MUST be a named mutation defined once in `packages/schema`, carrying a client-generated `mutation_id`. The server MUST apply a given `mutation_id` at most once and MUST return the original outcome on replay |
| A003-T54 | Every state-transition mutation MUST carry the base `version` it was decided against, and the server MUST reject it with `stale-state` if the record's version has changed |
| A003-T55 | Tier 1 and Tier 2 content MUST be stored only in `graph_protected_fragments`, encrypted with AES-256-GCM under a data key wrapped by the workspace KEK, which is wrapped by a KMS root key. Each fragment MUST authenticate its RFC 8785 canonical header as AAD |
| A003-T56 | Tier 1 and Tier 2 content MUST NOT be persisted on any device — not in the SQLite cache, IndexedDB, OPFS, the upload queue, service-worker caches or any browser storage. It MAY be held in memory for the session and MUST be discarded on sign-out, workspace switch and role change |
| A003-T57 | The sync audience MUST be written only by the audience materializer, which MUST evaluate [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor. A conformance suite MUST assert, for every role and privacy class, that the rows each stream delivers are a subset of what the interceptor permits for that person |
| A003-T58 | The replication publication MUST contain only `graph_nodes`, `graph_edges`, `sync_node_audience` and `sync_edge_audience`, and the audience tables MUST hold identifiers only. CI MUST fail if any other table, or any Tier 1 or Tier 2 value, is reachable from a shape. The sync service MUST hold read-only database access and MUST require no datastore other than PostgreSQL |
| A003-T59 | Every `protected.read` response and every job's protected read MUST write an audit event per [[VPS-F004_Silent_Audit_Log|VPS-F004]] before the data is returned or used. A failure to write the event MUST withhold the data |
| A003-T60 | Decrypted Tier 1 and Tier 2 values MUST NOT enter logs, metrics, traces, analytics, error reports, email bodies or any storage outside the process handling the authorized operation |
| A003-T61 | Unwrapped KEKs and DEKs MAY be cached in process memory for at most five minutes and MUST NOT be written to any storage, log or response |
| A003-T62 | No data key MAY span two erasure domains. Cryptographic erasure of a Tier 1 domain MUST destroy the wrapped data key and every retained copy, including those in backups within retention |
| A003-T63 | Tier 0 writes MUST be queueable offline and uploaded in order on reconnect. Tier 1 and Tier 2 writes, and mutations marked `online-only` in the registry, MUST be refused offline with the reason stated |
| A003-T64 | A rejected mutation MUST revert its optimistic effect and surface through SyncStatus as `NeedsAttention` with its reason. A rejected mutation MUST NOT be silently discarded |
| A003-T65 | The sync client MUST expose a SyncStatus observable — `Synced`, `Syncing`, `PendingChanges`, `Offline`, `NeedsAttention` — any component may subscribe to |
| A003-T66 | All tabs of one application on one device MUST share one sync connection and one cache |
| A003-T67 | When a person's access narrows or a device is revoked, the next connection MUST remove every row the person may no longer hold; an explicitly revoked device MUST erase its entire cache |
| A003-T68 | A job MUST execute as a principal the interceptor evaluates: the triggering person's grant, re-evaluated at execution, or a named system principal whose operations are enumerated in the policy table |
| A003-T69 | `managed_by` changes MUST go through `org.moveEmployee`, which MUST run in a serializable transaction, reject a cycle, and take its effective date from the caller |
| A003-T70 | No Tier 3 node type MAY be implemented before the Tier 3 module exists. Tier 3 plaintext and usable Tier 3 keys MUST NOT reach any server |
| A003-T71 | Schema compatibility MUST be enforced at upload: a client below the server's minimum schema version MUST reload before its queued mutations are accepted |
| A003-T72 | Devices MUST reach Electric only through the API's authenticated shape proxy, which MUST set table, where clause and parameters server-side from the verified session and MUST reject any client-supplied table, where or column parameter. Exactly two shape templates exist — nodes and edges filtered by the sync audience — and no other shape MAY be served |
| A003-T73 | Local development and CI MUST use a `LocalKeyProvider` whose root key comes from the environment; production MUST use AWS KMS and MUST refuse to start with the local provider. Both implement one `KeyProvider` interface, and no other code calls KMS directly |

---

## Acceptance criteria

**GIVEN** a manager opens the Bench Forecast on a laptop that was shut down while offline
**WHEN** the laptop starts with no connectivity
**THEN** the product boots from the device cache, every Tier 0 surface renders, SyncStatus shows `Offline`, and no sign-in or unlock prompt appears

---

**GIVEN** the network is unavailable
**WHEN** a manager creates an Assignment
**THEN** it appears immediately, SyncStatus shows `PendingChanges`, and within 30 seconds of connectivity returning it is committed once and visible on every authorized device

---

**GIVEN** a leave request is approved on one device while another device, offline, rejects it
**WHEN** the second device reconnects
**THEN** the rejection is refused with `stale-state`, the request remains approved, and the second person sees the current state and the reason

---

**GIVEN** a Team Member's device is fully synced
**WHEN** its local SQLite database and browser storage are inspected
**THEN** they contain no Tier 1 or Tier 2 value and no record the member is not permitted to read

---

**GIVEN** a Finance Admin opens a profile's compensation tab
**WHEN** the values are fetched
**THEN** they arrive through `protected.read`, an audit event exists before the response is sent, and the values are gone from the device after sign-out

---

**GIVEN** a full PostgreSQL dump and its backups
**WHEN** Tier 1 and Tier 2 columns are inspected without KMS access
**THEN** every value is ciphertext, and no usable key exists in the dump

---

**GIVEN** a fragment's ciphertext is copied onto a different node's row
**WHEN** the API attempts to decrypt it
**THEN** authentication fails and no plaintext is returned

---

**GIVEN** an HR Admin is demoted to Team Member
**WHEN** their devices next connect
**THEN** every row they may no longer read is removed from their cache, `protected.read` denies them, and each denial is audited

---

**GIVEN** a scheduled payroll report created by a Finance Admin who has since been demoted
**WHEN** the job runs
**THEN** it stops without reading protected data and records why

---

**GIVEN** an approved erasure request for an employee
**WHEN** erasure executes
**THEN** the data keys for that employee's Tier 1 erasure domains are destroyed in the live store and in retained key backups, other employees' content is unaffected, the nodes and edges remain, and the audit journal records the erasure

---

**GIVEN** two moves that would make two employees each other's manager
**WHEN** both are submitted
**THEN** the first commits and the second is rejected as a cycle

---

**GIVEN** a policy change would put a Tier 2 node, or a Standard node a person may not read, into that person's sync audience
**WHEN** CI runs
**THEN** the audience conformance gate fails the build

---

## Out of scope

- A device-canonical graph, a CRDT, and a custom sync relay — retired by this document; see Decisions recorded
- Real-time character-level co-editing of rich text
- Offline access to Tier 1 and Tier 2 data
- Customer-managed keys, data residency, the staff-access policy and published trust artifacts — [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]]
- Which infrastructure hosts each service — [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]
- The permission matrix and interceptor — [[VPS-A004_Graph_Permission_Layer|VPS-A004]]

---

## Decisions recorded

**The sync audience replaces generated shapes — F202, 21 September 2026.** Electric shapes are single-table with a where clause, and Electric supports subqueries that it tracks for changes. Rather than generating a different shape per role and scope — which would mean re-expressing "direct reports" or "own record" as SQL in a second place — the interceptor writes an explicit audience of identifiers, and every device uses the same two shapes filtered by it. One evaluator decides access; the audience is its recorded output; Electric only delivers it.

**The local-first, device-canonical architecture is reversed — F199, 20 September 2026.** Founder decision after the six-week foundation build and a review of its cost to feature development, user experience and business continuity, summarized in Context. The previous text of this document, the Rust sync engine, the Loro graph, the sealed device store and the Tier 1 envelope and recovery implementation are preserved on the archive branch named in F199, not deleted, so the decision can be revisited with the evidence intact.

**Replication uses Electric; the cache, the outbox and the API are ours.** A Linear-grade feel needs a local cache, optimistic writes and pushed updates. Building a bespoke replication protocol would recreate the cost this reversal removes. Electric is Apache-2.0, needs nothing but the PostgreSQL it replicates from, and is self-hostable in any region a customer's data must stay in — [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s Sync client selection records why PowerSync was chosen first and reversed the same day (its source-available license and its MongoDB requirement, F201), and why Zero was rejected (it refuses writes while disconnected). Electric covers the read path only, which is correct here: writes pass through our named mutations, and the SQLite cache, the outbox and the queued-write lifecycle are ours in `packages/graph`. Revisit if Electric's licensing or maintenance changes materially.

**Tier 1 becomes server-readable field-level encryption rather than end-to-end.** Server readability is what makes payroll, reporting, alerts, exports, support and recovery ordinary. What protects customers instead is field-level encryption with keys in KMS, memory-only handling on devices, audited reads, and [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]]'s staff-access and customer-managed-key controls. The honest cost: Vulto can be compelled to produce readable Tier 1 data, and the product no longer claims otherwise.

**Tier 1 recovery holders, the threshold scheme and the retention window are withdrawn.** Each existed because devices held keys or history. With keys in KMS, a lost laptop loses nothing, and no device holds history to bound. `tier1_retention_window_months` is deprecated in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s configuration registry.

**Tier 3 is kept, narrowed and deferred.** It is the one case where the data subject, not the business, bears the loss, and where the privacy promise is the feature. Keeping its design here, and forbidding Tier 3 node types until the module exists, prevents a later feature from quietly storing wellness data as Tier 0.

**The cold-start online unlock is withdrawn.** It existed so a revoked device could not reopen a local copy of HR data. Devices now hold only Tier 0 data, revocation erases the cache on next connection, and protected data never reaches the disk. Booting offline is restored.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the stack this document builds on
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the node registry and tier assignments
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the interceptor and the policy table the sync audience is materialized from
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the reference protocol, which depends on edge tier inheritance
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the infrastructure hosting each service
- [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] — the customer-facing trust controls built on this architecture
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — data governance, retention and erasure

---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-09-20]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-A001
---

# VPS-A001 — Technology Stack and Engineering Foundations

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** Nothing. This is a co-root decision alongside [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]
**Blocks:** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]], and every feature in every application that touches storage, sync, authentication, rendering or the API layer

This document is the single source of truth for what [[Vulto for Professional Services]] is built with. Every application in the suite runs on this stack, in this repository, against one graph. [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] owns the infrastructure services this stack runs on top of.

---

## Decision


**One language: TypeScript, end to end.** The server is the source of truth; devices hold a fast, permission-filtered cache of it, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. No Rust, no CRDT, and no custom sync relay.

| Layer | Choice |
|---|---|
| Frontend | Next.js, App Router |
| Mobile | React Native, sharing `packages/schema`, per [[VPS-F011_Mobile-Native_Experience|VPS-F011]] |
| Styling | Tailwind CSS, consuming [[VPS-D001_Design_Foundations|VPS-D001]]'s tokens exclusively |
| Component primitives | Radix UI, wrapped in `packages/ui` per [[VPS-D002_Component_Library|VPS-D002]] |
| Read replication | Electric (Apache-2.0), self-hosted in front of PostgreSQL, streaming each person's permitted rows to their device over HTTP through two fixed shapes filtered by the sync audience |
| Device cache and outbox | Vulto's own sync client in `packages/graph`: `wa-sqlite` with its IndexedDB VFS (`IDBBatchAtomicVFS`) on the web, running in a SharedWorker shared by every tab (a dedicated Worker holding a `navigator.locks` lease where SharedWorker is unavailable); native SQLite on React Native; plus the queued-write outbox |
| Local query layer | `packages/graph`'s typed query layer over that SQLite cache, in the sync worker |
| API and business logic | Node.js and TypeScript, tRPC over Fastify — the only writer to the canonical graph |
| Server persistence | PostgreSQL via Drizzle ORM — the single source of truth |
| Key management | AWS KMS, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] and [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] |
| Job queue and scheduling | BullMQ on Redis, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] |
| Authentication | Better Auth |
| Repository | Turborepo monorepo, pnpm workspaces |

**This document was revised on 20 September 2026.** The previous stack confined Rust to a sync engine and used Loro as a device-canonical CRDT. Both are retired, per F199 and [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Decisions recorded.

---

## Context


Four constraints produced this stack, and they are recorded because they are the things a future engineer would otherwise relitigate.

**The hiring market is a first-order constraint, not an afterthought.** TypeScript engineers are plentiful in Pakistan, the primary near-term hiring market; Rust engineers and CRDT specialists are not. A stack any competent TypeScript engineer can work in end to end is the one a small team can staff.

**The product must last years.** Boring where it counts, without sacrificing the velocity a small founding team depends on to reach revenue.

**Next.js and the eventual multi-application suite are given.** Founder decisions, not open questions this document revisits.

**It must feel instant.** Every latency budget in [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] depends on reads being local queries and writes being acknowledged before the network is consulted. That requires a local cache and optimistic writes. It does not require the device to be canonical, which is the distinction the previous stack missed and this one keeps.

---

## One language


**Every surface is TypeScript.** `apps/*`, `services/api`, `services/jobs`, `services/render` and every package share one language, one toolchain and one set of Zod schemas.

**The Electric sync service is infrastructure, not code we write.** It is deployed from its published image, needs nothing but PostgreSQL with logical replication, holds read-only database access, and serves only the two shape templates the API's shape proxy requests, filtered by the sync audience. Nothing in this repository extends it. **The device cache and the outbox are ours**, in `packages/graph`, in TypeScript.

**Consequence for hiring:** every engineering hire can work anywhere in the codebase.

---

## Sync client selection

| Criterion | Requirement |
|---|---|
| Source of truth | PostgreSQL stays authoritative; the device holds a cache |
| Licensing | A permissive open-source license, free to self-host commercially, with no ambiguity about our product being a "competing use" |
| Infrastructure | No datastore beyond PostgreSQL and Redis, which [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] already runs |
| Sovereignty | Self-hostable in any region, so a customer's data never depends on a vendor's cloud |
| Partial replication | Each person's device receives only the rows they may read, defined declaratively from the policy table |
| Offline writes | Writes queue while disconnected and upload to **our** API, where [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor decides them |
| Local store | SQLite on the device, so `packages/graph`'s typed SQLite query layer carries over |
| Platforms | Web, iOS, Android |

**Electric is selected for the read path, and Vulto owns the write path and the local store.** Electric is a read-path sync engine for PostgreSQL under **Apache-2.0**: it needs only the database it already syncs from, streams filtered row sets ("shapes") to clients over HTTP, and resumes from a cursor. Writes were always going to pass through our own named mutations, so a sync engine's write path was never needed. The device cache, the outbox and the queued-write lifecycle live in `packages/graph`, where we control them.

**PowerSync was selected first and then rejected, on two grounds.** Its service is source-available under the Functional Source License rather than open source — free for our use as we read it, but the license turns on whether a use "offers substantially similar functionality", which is not a question a small company should have to argue about later. Its Open Edition also requires **MongoDB** alongside PostgreSQL for sync buckets, which adds a second datastore, a second backup and restore story and a second thing to keep alive in every region a customer's data must stay in. That is exactly the kind of invisible complexity this architecture was revised to remove. Recorded as F201.

**Zero** (Rocicorp) was rejected because it refuses writes while disconnected, which contradicts [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s offline requirement. **A fully bespoke replication protocol** was rejected because logical-replication handling, fan-out and resumable cursors are the hard, boring parts, and Electric gives them for one container and no license question.

**What Vulto builds, because Electric does not:** the SQLite cache and its schema, shape subscription and application into that cache, the outbox with idempotent retry, optimistic application and rollback, and SyncStatus. Roughly two weeks of TypeScript we own, against a dependency we cannot be surprised by. The alternative saved that work and cost a second datastore and a license argument.

**What a device holds is materialized by the interceptor, never hand-written.** Every device uses the same two shapes, filtered by the sync audience the interceptor writes, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (F202). The rows a device holds and the rows the interceptor permits therefore cannot drift apart.

**Versions are pinned exactly**, per A001-T02:

| Component | Pin |
|---|---|
| Electric service | `electricsql/electric:1.8.1@sha256:efb6fa43859d67cb8c73439e0c8bc0f7a3daa467500fb06f2a924bcb2070c139`, pinned in `docker-compose.yml` on 21 September 2026 |
| Electric client library (`@electric-sql/client`) | Pinned in the lockfile when Stage 6 first adds it, and recorded here in that commit |

**Loro is retired.** `loro-crdt@1.14.1` was pinned in `packages/schema` for the previous architecture; it is removed with that architecture. `wa-sqlite` stays: the device cache is still SQLite-WASM, now fed by replication rather than by CRDT materialization. The reporting hierarchy no longer needs a Movable Tree because [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s single writer validates moves transactionally, and [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] is corrected accordingly.

---

## Local graph query layer


**Decision:** `packages/graph`'s typed query layer runs against the Electric SQLite cache, inside the sync client's worker, never on the main thread. Recursive CTEs serve multi-hop traversal. The cache holds Tier 0 data only; Tier 1 and Tier 2 values are fetched through the API and joined in memory for authorized readers, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]].

**Permission is decided on the server.** The cache contains only what the person may read, because the sync audience is materialized by the interceptor. The client-side query layer never decides access; it may hide an action a person cannot take, but the server refuses it regardless.

**Availability is separate from row data.** The query layer reports one availability outcome for a query or subscription: `mid-sync`, `requires-connection`, `permission-absence` or `ready`. `ready` is the normal condition and may contain zero rows; zero rows means genuinely empty. A permission-absence result carries no node or edge instance metadata. When [[VPS-A004_Graph_Permission_Layer|VPS-A004]] requires a visibly restricted render, the client derives it from the node type's schema under A004-T19.

---

## Server persistence


**PostgreSQL via Drizzle ORM is the single source of truth** for the graph, the protected field store, the audit journal and the mutation log, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. Drizzle over Prisma for a lighter, more SQL-honest query layer as complexity grows, particularly for audit and reporting queries.

---

## API and business logic

**Node.js and TypeScript, tRPC over Fastify.** End-to-end type safety between frontend and backend without REST or GraphQL boilerplate. For a small team this is a velocity multiplier, and it keeps the entire business logic surface in TypeScript.

Note that tRPC is the internal contract only. [[VPS-F009_Vulto_Sync_API|VPS-F009]] exposes a documented REST surface for third parties, deliberately separate, so that the internal API can evolve without breaking external consumers.

---

## Authentication

**Better Auth.** Self-hosted, TypeScript-native, database-first. Its organization/member tables are the online admission and revocation control plane for the Workspace and WorkspaceMembership graph projection defined in [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]. Both representations share stable identifiers and one role enum; grants wait for projection confirmation, removals deny centrally first, and disagreement fails closed. Lucia, the prior standard, is in maintenance mode and no longer recommended by its author.

Passkeys are supported and offered first where the browser supports them. WebAuthn PRF is required only by [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 module, when it is built.

---

## Frontend and design implementation

Next.js App Router, confirmed by the founder.

**Styling is Tailwind CSS, and this resolves what the earlier draft left open.** [[VPS-D001_Design_Foundations|VPS-D001]] defines every reusable visual token, so the styling layer's only job is to express those tokens. Tailwind's default color, spacing, radius, typography, shadow, blur and breakpoint scales are deleted before Vulto's generated tokens are declared — the configuration does not extend the defaults. Arbitrary values in class names are prohibited by lint rule; a value not in the token set is a design system change, not a component decision.

**Component primitives are Radix UI**, wrapped and styled in `packages/ui` per [[VPS-D002_Component_Library|VPS-D002]]. Radix supplies the accessibility behavior — focus trapping, keyboard interaction, ARIA wiring — that [[VPS-D002_Component_Library|VPS-D002]]'s accessibility floor requires and that is expensive and error-prone to build correctly. Individual primitives may be started from shadcn/ui's implementations, but the library is owned and versioned in this repository, never consumed as an external dependency, because a design system that can change underneath you is not a design system.

**Inter Variable** is self-hosted via `next/font`, per [[VPS-D001_Design_Foundations|VPS-D001]]. No external font CDN, both for latency and because a font request is a third-party beacon on every page of an HR product.

---

## Application layer conventions

These were not previously specified and each would otherwise be decided inconsistently across seventy-eight features.

| Concern | Decision |
|---|---|
| Server state | tRPC with TanStack Query for protected (Tier 1 and Tier 2) reads. Tier 0 graph reads bypass both and query the local cache directly |
| Client state | React state and context. No global store library; most state is the cached graph |
| Forms | React Hook Form with Zod resolvers |
| Validation | `zod@4.4.3`, pinned exactly in `packages/schema`. Schemas are shared by client, API and jobs; a validation rule is written once and TypeScript types are inferred from it |
| Dates and time | `date-fns` v4 with IANA time zone support. All timestamps stored UTC ISO-8601. **All working-day arithmetic delegates to [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] without exception** |
| Tables | TanStack Table, headless, styled per [[VPS-D002_Component_Library|VPS-D002]] |
| Charts | Recharts, constrained to the three chart types [[VPS-D002_Component_Library|VPS-D002]] permits |
| Unit and integration testing | Vitest |
| End-to-end testing | Playwright |
| Linting and formatting | ESLint and Prettier, with a custom rule set enforcing the token and import boundaries above |

**The working-day rule deserves emphasis.** The previous specification set computed working days by excluding Saturday and Sunday as literal constants in at least four documents. That is incorrect for the UAE, incorrect for a six-day Pakistani agency, and incorrect for anyone on a compressed schedule. No feature computes a working day itself. Every one calls [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]].

---

## Repository structure

```
apps/
  roster-web/               Vulto Roster, Next.js
  projects-web/             Vulto Projects, Next.js
  mobile/                   React Native, all applications, per VPS-F011
services/
  api/                      Node.js, TypeScript, tRPC — the only writer to the graph
  jobs/                     BullMQ workers, per VPS-A006
  render/                   Headless Chromium PDF rendering, per VPS-A006
  cross-tenant-aggregation/ Isolated anonymized aggregation, per VRS-F071
packages/
  graph/                    Typed query layer and mutators over the device cache, and the sync client wiring
  schema/                   Shared types, graph schema, Zod validators
  ui/                       Design system components, per VPS-D002
  tokens/                   Design tokens, per VPS-D001, source of Tailwind config
tools/
  audit-verifier/           Open-source audit chain verifier, published per VPS-A008
```

`services/cross-tenant-aggregation` is the one deliberate exception to this stack's per-workspace model. Every other service serves one workspace's graph to its own members; this one pools anonymized, already-bucketed contributions across many workspaces for [[VRS-F071_Salary_Benchmarking|VRS-F071]] and [[VRS-F072_Agency_Benchmarking|VRS-F072]]. That is a fundamentally different data flow and does not belong inside the per-workspace trust boundary.

---

## One repository, many applications

[[Vulto Projects]], [[Vulto Sales]], [[Vulto Accounts]], [[Vulto Legal]], [[Vulto Payroll]], [[Vulto Quotations]], [[Vulto Pitch]], [[Vulto Comms]], [[Vulto Reports]], [[Vulto Vault]] and [[Vulto Learn - Team Knowledge]] all read, and several write, the same graph.

**Every one of them lives in this repository.** Not a repository per application, and the reason is [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]]: the Cross-Suite Node Ownership table in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] has Projects writing a Project's status fields while Roster keeps its capacity fields, enforced at the write layer. **Two repositories would mean two copies of `packages/schema`, and the moment they disagree, that enforcement is guarding a boundary that no longer describes reality.**

One repository also means a change to `Employee` breaks every application's build simultaneously, which is precisely what [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]]'s type-check gate exists to do.

**`packages/graph`, `packages/schema`, `packages/tokens` and `packages/ui` are shared by every application** and are built with the discipline of published packages — versioned, with stable public interfaces — even though every consumer lives beside them. `packages/graph` owns the typed query layer and mutators; the Electric client and its SQLite database remain private to the package.

**A new application adds one directory under `apps/` and nothing else.** No new service, no new database, no new sync infrastructure.

---

## Hosting and deployment

**DigitalOcean** for backend infrastructure: the API, the Electric sync service, the job workers, the render service, PostgreSQL and Redis. **Vercel** for the Next.js frontend. **AWS KMS** for key management only, because DigitalOcean offers no key management service with customer-managed keys, per [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]].

Hetzner was considered earlier for data sovereignty. That reasoning rested on a premise that does not hold: Vulto is a Delaware C-Corp, so the company already sits inside US jurisdiction regardless of which server hosts the data. A European host would have protected against a narrower risk than it appeared to — a foreign server compelled independently of the company, not the company itself being compelled.

**What this does not resolve.** Neither hosting nor encryption makes Vulto immune to lawful compulsion, and the product does not claim otherwise. [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] governs what Vulto promises instead: no staff access without customer approval, disclosure of any compelled access, customer-managed keys on Enterprise, and a residency region per workspace.

---

## Technical specifications


| ID | Specification |
|---|---|
| A001-T01 | The repository MUST contain no Rust. Introducing a second language requires a superseding decision document |
| A001-T02 | Read replication MUST be Electric, self-hosted, pinned by image digest. The device cache, outbox and queued-write lifecycle MUST live in `packages/graph` and MUST NOT depend on a third-party write path. Every sync-related version MUST be pinned and recorded in this document in the same commit |
| A001-T03 | The device cache MUST be a derived, disposable copy of PostgreSQL, never a source of truth |
| A001-T04 | Every engineer MUST be able to run the full local stack — frontend, API, jobs, PostgreSQL, Redis and the Electric sync service — with one command and no toolchain beyond Node, pnpm and Docker. No datastore other than PostgreSQL and Redis may be required |
| A001-T05 | New suite applications MUST live in this repository as a directory under `apps/`, consuming `packages/graph`, `packages/schema`, `packages/tokens` and `packages/ui` rather than reimplementing them. A separate repository per application is prohibited |
| A001-T06 | Sync processing and local queries MUST run off the main thread, in the sync client's worker |
| A001-T07 | The query layer MUST report an availability outcome separate from row data, distinguishing `mid-sync`, `requires-connection`, `permission-absence` and `ready`. A `ready` result MAY contain zero rows. Permission absence MUST disclose no node or edge instance metadata. A visibly restricted render MUST be derived from type schema per A004-T19 |
| A001-T08 | `services/cross-tenant-aggregation` MUST NOT share a database, connection pool or process boundary with per-workspace data paths, and MUST receive only anonymized, pre-bucketed contributions |
| A001-T09 | Tailwind configuration MUST be generated from `packages/tokens`; Tailwind's default visual scales MUST be deleted rather than extended, and arbitrary values in class names MUST fail lint |
| A001-T10 | No feature MUST compute working days, weekends or holidays independently. All such arithmetic MUST call [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| A001-T11 | Authentication MUST support passkeys. WebAuthn PRF MUST be supported before any Tier 3 node type is implemented, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] |
| A001-T12 | Backend infrastructure MUST run on DigitalOcean, key management on AWS KMS, and the frontend MUST deploy to Vercel unless superseded |
| A001-T13 | The sync audience MUST be materialized by the interceptor from [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s policy table; no shape other than the two templates of A003-T72 MAY exist |

---

## Acceptance criteria


**GIVEN** a new engineer joins
**WHEN** they clone the repository and follow the documented setup
**THEN** one command runs the frontend, API, jobs, PostgreSQL, Redis and the Electric sync service end to end with only Node, pnpm and Docker installed

---

**GIVEN** a feature needs new data on devices
**WHEN** it is implemented
**THEN** it registers node types and permissions in `packages/schema`, the materialized sync audience changes accordingly, and no shape is added or edited

---

**GIVEN** a component needs a color, size or spacing value
**WHEN** it is implemented
**THEN** the value resolves from `packages/tokens`, and an arbitrary value fails lint rather than reaching review

---

**GIVEN** a new suite application is started
**WHEN** it is added to the platform
**THEN** it reuses the existing API, sync client, auth layer, tokens and component library without modification to their core contracts

---

## Out of scope

- Node and edge schema — [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]
- Sync behavior, offline behavior, conflict resolution and the encryption model — [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]
- Trust controls: staff access, customer-managed keys, residency, published artifacts — [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]]
- Permission matrix — [[VPS-A004_Graph_Permission_Layer|VPS-A004]]
- Email, object storage, job queue configuration, PDF rendering, observability, backup and disaster recovery — [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]
- Visual design decisions — [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]
- CI/CD pipeline design

---

## Decisions recorded


**The two-language, local-first stack is superseded — F199, 20 September 2026.** Rust, Loro, the sealed device store and the custom relay are retired with [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s device-canonical architecture. The decisions below that concern them — Rust ownership, the Loro pin, shallow snapshots, the Movable Tree's authority, the Worker package boundary and local-storage encryption ownership — are retained as history and no longer govern. Their code is preserved on the archive branch recorded in F199.

**Electric for replication, Vulto for the write path — F201, 20 September 2026.** Recorded under Sync client selection. PowerSync was the first choice and was reversed within the day on licensing and on its MongoDB requirement. The reversal's purpose was to remove invisible complexity and keep the product self-hostable anywhere; a second datastore and a source-available license both work against that.

**Styling framework and component library are decided here** rather than deferred to a design system team that does not exist. Tailwind consuming [[VPS-D001_Design_Foundations|VPS-D001]]'s tokens, Radix primitives wrapped in `packages/ui`. The earlier draft's deferral was correct when there was no design system; there is one now.

**Rust ownership is decided as a scoped engagement, not a hiring track.** The sync engine is owned by a single specialized contract engineer under a defined statement of work, or by the CTO function directly when one is engaged. It is deliberately not a role the team recruits for, because a team that must hire Rust engineers to make progress has forfeited the reason this boundary exists.

**The Loro version is a specification requirement, not an open item.** A001-T02 requires it pinned and recorded in the same commit as implementation start. An unpinned dependency in a system meant to run for years is a defect, and describing it as an open question deferred the fix rather than scheduling it. **Settled: `loro-crdt@1.14.1`**, recorded under CRDT library selection above. The repository had already demonstrated the cost of the alternative — `typescript@^5.7.3` had drifted to `5.9.3` and `turbo@^2.3.4` to `2.10.8` before anyone intended an upgrade.

**The two-language boundary table's `services/sync-engine` row described one job for two builds that do different things.** "Receive CRDT deltas… persist to Postgres, relay to authorized devices" is the server deployment's job; a WASM build running in a browser tab cannot persist anything to Postgres. Corrected to state the shared core's job once — CRDT merge, encryption, wire protocol, identical across all three targets per A003-T10 — and the server deployment's additional relay-and-persistence responsibility separately. Found while scoping FDN-46's package boundaries, which needed to know which of the sync engine's responsibilities cross into the WASM build and which never do. Recorded as F63.

**Worker availability is not row data.** The former A001-T07 required a marker on each materialized row, but two of the conditions it needed to express are conditions in which no row may exist, and one would leak instance existence if represented as a row. The Worker therefore reports availability outside the result rows. The three exceptional outcomes correspond to [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]; `ready` names ordinary availability and is not a new interface state. Recorded as F94 and F95.

**The Worker boundary has a package home.** `packages/graph` owns the public Worker client and its runtime-validated local protocol. Its private Worker runtime is the only TypeScript browser surface that imports Loro or `wa-sqlite`; application code consumes the client without gaining raw graph access. FDN-49 owns the future automated import-boundary enforcement. Recorded as F96.

**Local-storage encryption ownership named the wrong issue.** F103 moved the sealed local device store and its cold-restart online unlock from FDN-52 to FDN-84, and reordered the chain to FDN-84 → FDN-50 → FDN-52 so canonical Loro persistence is never written unencrypted. This document's own statement of that ownership was never updated to match, leaving FDN-52 named as the owner of work F103 had already reassigned. Corrected above. Recorded as F116.

**The shallow-snapshot selection rationale did not survive implementation.** This document cited shallow snapshots as one reason Loro was chosen, alongside the Movable Tree. Building FDN-50's durable flush against the pinned `loro-crdt@1.14.1` showed the capability is unusable for this system: a document assembled from independently authored deltas has concurrent root operations, and a shallow snapshot anchored against that history exports successfully but cannot be imported back. Full snapshots ship instead, at a cost in storage rather than correctness. The rationale is withdrawn above rather than left standing as a claim the codebase contradicts — per `VPS-002`, where building shows the instruction wrong, the implementation stands and the specification is corrected. Recorded as F121.

**The Movable Tree and the `managed_by` edge had no stated authority relationship.** Both were required by name — the Tree here, the temporal edge in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — with no rule for which one is written to, or how a concurrent move on the same employee produces one converged edge history rather than two. The Tree is now the sole write target; the edge is a one-way materialization of its resolved state. Recorded as F104, blocking FDN-50 until closed.

---


## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the graph schema this stack stores
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — sync, tiers and encryption
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the cross-app reference protocol
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the platform services this stack runs on
- [[VPS-A008_Trust_and_Data_Protection_Program|VPS-A008]] — the trust controls built on this stack
- [[VPS-D001_Design_Foundations|VPS-D001]] — the design tokens the styling layer expresses
- [[VPS-000_Documentation_Standard|VPS-000]] — the Documentation Standard

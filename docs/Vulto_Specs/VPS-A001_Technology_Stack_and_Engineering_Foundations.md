---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-08-08]]"
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
**Blocks:** [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]], [[VPS-A003_Unified_Sync_Architecture|VPS-A003]], [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], and every feature in every application that touches storage, sync, authentication, rendering or the API layer

This document is the single source of truth for what [[Vulto for Professional Services]] is built with. Every application in the suite runs on this stack, in this repository, against one graph. [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] owns the infrastructure services this stack runs on top of.

---

## Decision

The stack partitions engineering responsibility across exactly two languages: **Rust**, confined to a single isolated sync engine, and **TypeScript**, used for everything else. No third backend language is introduced. No engineer outside the sync engine needs to read or write Rust.

| Layer | Choice |
|---|---|
| Frontend | Next.js, App Router |
| Mobile | React Native, sharing `packages/schema`, per [[VPS-F011_Mobile-Native_Experience|VPS-F011]] |
| Styling | Tailwind CSS, consuming [[VPS-D001_Design_Foundations|VPS-D001]]'s tokens exclusively |
| Component primitives | Radix UI, wrapped in `packages/ui` per [[VPS-D002_Component_Library|VPS-D002]] |
| CRDT engine | Loro — Rust core, WASM and native bindings |
| Local query layer | SQLite-WASM on web, native SQLite on React Native, materialized from Loro |
| Sync / relay server | Rust service, native binary |
| API and business logic | Node.js and TypeScript, tRPC over Fastify |
| Server persistence | PostgreSQL via Drizzle ORM |
| Job queue and scheduling | BullMQ on Redis, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] |
| Authentication | Better Auth |
| Repository | Turborepo monorepo, pnpm workspaces |

---

## Context

Four constraints produced this stack, and they are recorded because they are the things a future engineer would otherwise relitigate.

**The hiring market is a first-order constraint, not an afterthought.** Rust engineers are scarce in Pakistan, the primary near-term hiring market. A stack that spreads Rust across the backend creates a bottleneck TypeScript does not. A stack that uses Rust nowhere forfeits the performance and correctness guarantees a CRDT sync engine genuinely needs. Confining Rust to one bounded surface resolves that tension rather than choosing an extreme.

**The product must last years.** Boring where it counts, without sacrificing the velocity a small founding team depends on to reach revenue.

**Next.js and the eventual multi-application suite are given.** Founder decisions, not open questions this document revisits.

**Local-first is not a feature, it is the justification for the whole architecture.** Every latency budget in [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] depends on reads being local queries and writes being acknowledged before the network is consulted. A choice that compromises that compromises the product's only remaining claim to feeling exceptional.

---

## The two-language boundary

| Surface | Language | Reasoning |
|---|---|---|
| `services/sync-engine` | Rust | A single shared core — CRDT merge, encryption, wire protocol — compiled three ways from one source: native binary for the server, WASM for the client, native bindings for mobile, per A003-T10. The **server deployment** additionally relays deltas between authorized devices per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s permission filter and persists them to Postgres for durability. The **client and mobile builds** produce and apply deltas against the local graph and hold no server responsibilities. No business logic in any target |
| `apps/roster-web` and every future application under `apps/` | TypeScript | Consumes the sync engine's WASM build as an ordinary npm package. Never touches Rust |
| `services/api` | TypeScript | Auth, workspace management, billing, every feature's server-side logic |
| Every future suite application | TypeScript | Shares the same sync engine and API conventions |

**Consequence for hiring:** the entire Rust surface is one deliberately small, deliberately boring service. Every other engineering hire works entirely in TypeScript.

---

## CRDT library selection

| Criterion | Requirement |
|---|---|
| Graph support | Property graph represented as node and edge records |
| Offline-first | Fully disconnected operation, deterministic merge on reconnection |
| Performance | Node and edge level sync with negligible latency on mobile connections |
| Maturity | Production-proven, actively maintained, no beta status |
| Platform support | Web, iOS, Android, macOS, Windows |
| Audit compatibility | Change events capturable by [[VPS-F004_Silent_Audit_Log|VPS-F004]] |

**Automerge** was rejected as primary: its data model has no native tree type, so the `managed_by` reporting hierarchy would be an application-level workaround, and `automerge-repo` remains alpha.

**Yjs** was rejected for the same reason — a general document CRDT with no tree or graph primitive.

**Loro is selected.** It natively supports Map, List, Rich Text and Movable Tree, which map directly onto this schema rather than requiring workarounds: Movable Tree for the reporting hierarchy, Rich Text for every field supporting [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]]'s reference protocol, Map for node properties generally. Loro additionally supports shallow snapshots, trimming CRDT history while preserving mergeability, which addresses documented cases of unbounded tombstone accumulation in Automerge-style CRDTs. For a graph meant to run for years without a migration crisis, that matters.

Loro is MIT licensed and in active production use. Its ecosystem is younger than Automerge's; this is a defensible tradeoff, recorded rather than assumed.

**On the Movable Tree specifically.** This primitive is a material part of why Loro was chosen over two more mature alternatives, and the specification set must actually use it. [[VRS-F037_Dynamic_Org_Chart|VRS-F037]] is the feature that does, and its existence is partly a consequence of this decision. A future proposal to model the reporting hierarchy as flat parent pointers in application code would forfeit the reason this library was selected and requires a superseding decision, not an implementation shortcut.

A bespoke CRDT implementation is explicitly prohibited.

**The pinned version is `loro-crdt@1.14.1`**, declared exactly — not as a range — in `packages/schema`, and pinned transitively in `pnpm-lock.yaml`. Recorded here per A001-T02, in the commit that pinned it.

`packages/schema` declares it because that package is the first legitimate importer: [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Schema Evolution Protocol makes the schema package the enforcement point and prohibits raw untyped access to CRDT documents anywhere outside the sync engine and the materialization worker, so the Loro document shapes are defined there.

**The pin lands before anything imports it, deliberately.** A001-T02 says *implementation start*, and the monorepo and runtime foundation is implementation start; deferring until the first import would make that phrase mean whenever someone happens to feel like it. The cost is that a dependency nothing yet imports looks like dead weight to a later cleanup — which would delete this record along with it. Naming the declaring package here is the mitigation: the specification and the manifest point at each other, so removing one means confronting the other.

---

## Local graph query layer

Loro guarantees conflict-free merge. It does not provide fast multi-hop traversal, and [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s budgets require it.

**Decision:** SQLite compiled to WASM runs on the client, materialized incrementally from Loro state. Loro remains the authoritative merge layer; SQLite is a derived, rebuildable index existing purely to make graph queries fast, including recursive CTEs for traversal. This is also where [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s permission interceptor is implemented in practice — as a query-rewriting layer in front of the index, never inside the CRDT library.

**Execution boundary.** Both Loro merge processing and SQLite materialization run inside a dedicated Web Worker, never the main thread. A device rejoining after days offline processes thousands of queued deltas; doing that on the main thread would freeze the UI exactly when a founder most needs the Bench Forecast responsive. The UI layer never imports `wa-sqlite` and never processes a delta directly.

**Sync-status marker.** The worker maintains a status marker per materialized row, separate from its data columns. A `NULL` cannot distinguish not-yet-synced from permission-denied from genuinely-empty, and [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] renders those three as visually distinct states. The marker is what makes that distinction implementable rather than aspirational.

---

## Server persistence

**PostgreSQL via Drizzle ORM.** Drizzle over Prisma for a lighter, more SQL-honest query layer as complexity grows, particularly for audit and reporting queries that sit outside the CRDT-synced graph. Postgres also stores the durable copy of Loro snapshots and deltas the Rust sync engine persists.

---

## API and business logic

**Node.js and TypeScript, tRPC over Fastify.** End-to-end type safety between frontend and backend without REST or GraphQL boilerplate. For a small team this is a velocity multiplier, and it keeps the entire business logic surface in TypeScript.

Note that tRPC is the internal contract only. [[VPS-F009_Vulto_Sync_API|VPS-F009]] exposes a documented REST surface for third parties, deliberately separate, so that the internal API can evolve without breaking external consumers.

---

## Authentication

**Better Auth.** Self-hosted, TypeScript-native, database-first. Its organizations plugin maps directly onto the Workspace, WorkspaceMembership and role model in [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]. Lucia, the prior standard, is in maintenance mode and no longer recommended by its author.

Passkeys and WebAuthn PRF are required rather than optional, because [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 key recovery depends on the device's native secure keychain.

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
| Server state | tRPC with TanStack Query. Local graph reads bypass both and query the worker directly |
| Client state | React state and context. No global store library; local-first means most state is the graph |
| Forms | React Hook Form with Zod resolvers |
| Validation | `zod@4.4.3`, pinned exactly in `packages/schema`. Schemas are shared by client, API and sync engine; a validation rule is written once and TypeScript types are inferred from it |
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
  sync-engine/              Rust, native binary and WASM
  api/                      Node.js, TypeScript, tRPC
  jobs/                     BullMQ workers, per VPS-A006
  render/                   Headless Chromium PDF rendering, per VPS-A006
  cross-tenant-aggregation/ Isolated anonymized aggregation, per VRS-F071
packages/
  schema/                   Shared types, graph schema, Zod validators
  ui/                       Design system components, per VPS-D002
  tokens/                   Design tokens, per VPS-D001, source of Tailwind config
```

`services/cross-tenant-aggregation` is the one deliberate exception to this stack's per-workspace model. Every other service syncs one workspace's graph to its own authorized devices; this one pools anonymized, already-bucketed contributions across many workspaces for [[VRS-F071_Salary_Benchmarking|VRS-F071]] and [[VRS-F072_Agency_Benchmarking|VRS-F072]]. That is a fundamentally different data flow and does not belong inside the sync engine's trust boundary.

---

## One repository, many applications

[[Vulto Projects]], [[Vulto Sales]], [[Vulto Accounts]], [[Vulto Legal]], [[Vulto Payroll]], [[Vulto Quotations]], [[Vulto Pitch]], [[Vulto Comms]], [[Vulto Reports]], [[Vulto Vault]] and [[Vulto Learn - Team Knowledge]] all read, and several write, the same graph.

**Every one of them lives in this repository.** Not a repository per application, and the reason is [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]]: the Cross-Suite Node Ownership table in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] has Projects writing a Project's status fields while Roster keeps its capacity fields, enforced at the write layer. **Two repositories would mean two copies of `packages/schema`, and the moment they disagree, that enforcement is guarding a boundary that no longer describes reality.**

One repository also means a change to `Employee` breaks every application's build simultaneously, which is precisely what [[VPS-A007_Build_Test_and_Deployment_Pipeline|VPS-A007]]'s type-check gate exists to do.

**`services/sync-engine`, `packages/schema`, `packages/tokens` and `packages/ui` are shared by every application** and are built with the discipline of published packages — versioned, with stable public interfaces — even though every consumer lives beside them.

**A new application adds one directory under `apps/` and nothing else.** No new service, no new database, no new sync engine.

---

## Hosting and deployment

**DigitalOcean** for backend infrastructure: the sync engine, the API, the job workers, the render service, PostgreSQL and Redis. **Vercel** for the Next.js frontend.

Hetzner was considered earlier for data sovereignty. That reasoning rested on a premise that does not hold: Vulto is a Delaware C-Corp, so the company already sits inside US jurisdiction regardless of which server hosts the data. A European host would have protected against a narrower risk than it appeared to — a foreign server compelled independently of the company, not the company itself being compelled.

**What this does not resolve.** Genuine protection against compulsion is an encryption decision, not a hosting decision. [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] defines the tiered model: standard encryption at rest where Vulto holds keys, and true end-to-end encryption where Vulto cannot read the data under any circumstance. That is the decision worth getting right. The hosting provider was not.

---

## Sync architecture consequence

One consequence of this stack is carried into [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] rather than resolved here. Because Loro, like every document-based CRDT, syncs at document rather than field granularity, permission-filtered sync requires partitioning the graph into multiple Loro documents by sensitivity tier, and in some cases by field group within a node type. The full partitioning model belongs in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. This document records only why such partitioning is required at all: it is a direct consequence of the CRDT choice made here, not a design preference.

---

## Technical specifications

| ID | Specification |
|---|---|
| A001-T01 | The sync engine MUST be the only Rust in the repository. A second Rust service requires a superseding decision document |
| A001-T02 | The CRDT library MUST be Loro. The exact version MUST be pinned in the lockfile at implementation start and recorded in this document in the same commit |
| A001-T03 | The local query layer MUST be a materialized index derived from Loro state, never a replacement source of truth |
| A001-T04 | Every engineer not working on the sync engine MUST be able to run the full local stack without a Rust toolchain |
| A001-T05 | New suite applications MUST live in this repository as a directory under `apps/`, consuming `services/sync-engine`, `packages/schema`, `packages/tokens` and `packages/ui` rather than reimplementing them. A separate repository per application is prohibited |
| A001-T06 | Loro merge processing and SQLite materialization MUST run in a dedicated Web Worker. The main thread MUST NOT import `wa-sqlite` or process deltas directly |
| A001-T07 | The materialization worker MUST maintain a per-row sync-status marker distinguishing not-yet-synced, permission-denied and genuinely-empty as three states |
| A001-T08 | `services/cross-tenant-aggregation` MUST NOT share a database, connection pool or process boundary with per-workspace data paths, and MUST receive only anonymized, pre-bucketed contributions |
| A001-T09 | Tailwind configuration MUST be generated from `packages/tokens`; Tailwind's default visual scales MUST be deleted rather than extended, and arbitrary values in class names MUST fail lint |
| A001-T10 | No feature MUST compute working days, weekends or holidays independently. All such arithmetic MUST call [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] |
| A001-T11 | Authentication MUST support passkeys and WebAuthn PRF, required by [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s Tier 3 key recovery |
| A001-T12 | Backend infrastructure MUST run on DigitalOcean and the frontend MUST deploy to Vercel unless superseded |

---

## Acceptance criteria

**GIVEN** a new frontend or API engineer joins
**WHEN** they clone the repository and follow the documented setup
**THEN** they run the frontend, the API and a local Postgres end to end without installing Rust, and without understanding the sync engine's internals to build a feature

---

**GIVEN** the sync engine needs a change
**WHEN** the change is proposed
**THEN** it is scoped and owned within `services/sync-engine` exclusively, with no CRDT or sync logic duplicated into the API layer

---

**GIVEN** a component needs a color, size or spacing value
**WHEN** it is implemented
**THEN** the value resolves from `packages/tokens`, and an arbitrary value fails lint rather than reaching review

---

**GIVEN** a new suite application is started
**WHEN** it is added to the platform
**THEN** it reuses the existing sync engine, auth layer, tokens and component library without modification to their core contracts

---

## Out of scope

- Node and edge schema — [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]
- Sync protocol, conflict resolution, document partitioning and the encryption model — [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]
- Permission matrix — [[VPS-A004_Graph_Permission_Layer|VPS-A004]]
- Email, object storage, job queue configuration, PDF rendering, observability, backup and disaster recovery — [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]
- Visual design decisions — [[VPS-D001_Design_Foundations|VPS-D001]] through [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]
- CI/CD pipeline design

---

## Decisions recorded

**Styling framework and component library are decided here** rather than deferred to a design system team that does not exist. Tailwind consuming [[VPS-D001_Design_Foundations|VPS-D001]]'s tokens, Radix primitives wrapped in `packages/ui`. The earlier draft's deferral was correct when there was no design system; there is one now.

**Rust ownership is decided as a scoped engagement, not a hiring track.** The sync engine is owned by a single specialized contract engineer under a defined statement of work, or by the CTO function directly when one is engaged. It is deliberately not a role the team recruits for, because a team that must hire Rust engineers to make progress has forfeited the reason this boundary exists.

**The Loro version is a specification requirement, not an open item.** A001-T02 requires it pinned and recorded in the same commit as implementation start. An unpinned dependency in a system meant to run for years is a defect, and describing it as an open question deferred the fix rather than scheduling it. **Settled: `loro-crdt@1.14.1`**, recorded under CRDT library selection above. The repository had already demonstrated the cost of the alternative — `typescript@^5.7.3` had drifted to `5.9.3` and `turbo@^2.3.4` to `2.10.8` before anyone intended an upgrade.

**The two-language boundary table's `services/sync-engine` row described one job for two builds that do different things.** "Receive CRDT deltas… persist to Postgres, relay to authorized devices" is the server deployment's job; a WASM build running in a browser tab cannot persist anything to Postgres. Corrected to state the shared core's job once — CRDT merge, encryption, wire protocol, identical across all three targets per A003-T10 — and the server deployment's additional relay-and-persistence responsibility separately. Found while scoping FDN-46's package boundaries, which needed to know which of the sync engine's responsibilities cross into the WASM build and which never do. Recorded as F63.

---

## Related Notes

- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the graph schema this stack stores
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — sync, tiers and encryption
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission layer
- [[VPS-A005_Cross-App_Reference_Protocol|VPS-A005]] — the cross-app reference protocol
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — the platform services this stack runs on
- [[VPS-D001_Design_Foundations|VPS-D001]] — the design tokens the styling layer expresses
- [[VPS-000_Documentation_Standard|VPS-000]] — the Documentation Standard

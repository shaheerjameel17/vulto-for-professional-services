# Vulto — Project Instructions

You are building **Vulto**, a suite of opinionated applications for professional services firms. This file is the first thing you read in any session.

`AGENTS.md` is a symbolic link to this file. There is one set of project instructions, not two.

---

## Read this before anything else

**`docs/Vulto_Specs/VPS-002_Implementation_Handoff.md`** is the entry point to a complete specification set. Read it in full before writing code, in any session where you are implementing something.

It will tell you which other documents to read. Follow it.

---

## What the specifications are

95 documents across three prefixes, in `docs/Vulto_Specs/`:

| Prefix | Scope |
|---|---|
| **`VPS-`** | The suite. Architecture, trust program, design system, pipeline, and platform features every application shares |
| **`VRS-`** | Vulto Roster's own features |
| **`VPJ-`** | Vulto Projects' register (features not yet written) |

**These are not a PRD.** They contain full graph schemas, API contracts, permission behavior, encryption boundaries, interface specifications and acceptance criteria. Where a decision could have been left open, it was made and the reasoning recorded.

**Every open item is closed.** If something reads as an unresolved question, it is a defect in the document — report it, do not decide it yourself.

---

## Current phase: the server-authoritative re-foundation

**On 20 September 2026 the architecture changed direction** (F199 in `docs/Foundations_Findings.md`). The local-first, device-canonical graph, the Rust sync engine, and end-to-end encryption of Tier 1 data are retired. **PostgreSQL is now the single source of truth; each device holds a fast, permission-filtered cache of it**, with optimistic writes and queued offline writes. Tier 1 and Tier 2 data are field-encrypted on the server under keys in KMS and never stored on a device. Tier 3 stays end-to-end encrypted as a deferred module.

The governing specifications are **`VPS-A003`** (the data architecture), **`VPS-A001`** (the stack), **`VPS-A004`** (permissions — now enforced on the server) and **`VPS-A008`** (the trust program). Read `VPS-A003`'s Context and Decisions recorded before anything else.

### Phase scope

1. **The server graph** — `graph_nodes`, `graph_edges`, `graph_protected_fragments` in PostgreSQL via Drizzle, ported from the registry already in `packages/schema`
2. **The server interceptor** — `packages/graph`'s policy table moved to `packages/schema`, evaluated in `services/api` for every read, mutation and job
3. **Named mutations** — the typed mutator pipeline with idempotency and stale-state rejection
4. **Field-level encryption** — the KMS key hierarchy and `protected.read`, with audit-before-release
5. **The sync layer** — the Electric sync service in front of Postgres, our own device cache and outbox in `packages/graph`, the sync audience materialized by the interceptor, the authenticated shape proxy, and the audience conformance gate
6. **The audit journal on the server**, hash-chained per `VPS-A008`

Then one thin end-to-end workflow a design partner can use, before any broad feature work.

### What is deliberately not in this phase

**Tier 3.** No Tier 3 node type is built until the Tier 3 module is, with the first wellness or pulse feature.

**Customer-managed keys and residency choice.** Enterprise features under `VPS-A008`, built when an Enterprise customer needs them. The key hierarchy is designed so they slot in without rework.

### The archive

The retired implementation — `services/sync-engine`, the Loro Worker runtime, the sealed store, Tier 1 envelopes and recovery — was removed from `main` in Stage 7 (FDN-103); it is preserved on the branch `archive/local-first-e2e`. **Do not revive it without a superseding decision.**

---

## Rules that hold from day one

**Never compute a working day.** No weekend, no holiday, no calendar arithmetic. `VRS-F004` owns it. A hardcoded Saturday–Sunday weekend is wrong for the Gulf, wrong for a six-day Pakistani week, and wrong for anyone part-time.

**Never write a permission check in a feature.** `VPS-A004`'s interceptor is the only place access is decided.

**Never let Tier 1 or Tier 2 data reach device storage, and never decrypt it outside the audited path.** Protected values come from `protected.read` or an audited job principal, live in memory, and never touch the device cache, browser storage, logs or analytics. Tier 3 plaintext never reaches a server.

**Never write the sync audience outside the materializer, and never add a shape.** Devices use exactly two shapes filtered by the audience the interceptor writes. Anything else is a second answer to "who may read this".

**Never write to the graph except through a named mutation.** `services/api` is the only writer. State transitions carry the base version they were decided against.

**Never store what can be derived.** Bench time, leave balance, utilization, compa-ratio — computed at read.

**Never widen a node's reach without checking its tier.** Provenance-derived nodes inherit their source's tier, per Standing Rule 8. Defaulting one to Tier 0 re-exposes something an earlier feature deliberately protected.

**Design tokens are the only source of values.** Every color, size, space and radius comes from `packages/tokens`, generated from `VPS-D001`. No arbitrary Tailwind values, ever.

**Components live in `packages/ui`, not in an app.** Per `VPS-D002`, a feature composes components; it never defines one.

**No node type exists before it is registered.** `VPS-A002` is the registry, and A002-T09 makes registration precede implementation. A type in `packages/schema` with no row in `VPS-A002` fails the conformance gate.

**No `localStorage` or `sessionStorage`.** Anywhere.

**Read `VPS-002`'s five rules section.** It lists the mistakes that are easiest to make by accident.

---

## Stack

Per `VPS-A001`, and settled — do not evaluate alternatives:

- **Next.js**, App Router, TypeScript
- **PostgreSQL via Drizzle** as the single source of truth; **tRPC over Fastify** as the only writer; **Better Auth**
- **Electric** (Apache-2.0, self-hosted, PostgreSQL-only) replicating each person's permitted Tier 0 slice to their device; the SQLite cache, the outbox and the queued-write lifecycle are ours in `packages/graph`
- **AWS KMS** for the field-encryption key hierarchy
- **Tailwind CSS**, configured from `packages/tokens`
- **Radix UI** primitives, wrapped in `packages/ui`
- **Vitest** for unit and integration, **Playwright** for end-to-end
- **pnpm** workspaces, Turborepo
- **Inter Variable** via `next/font`, self-hosted. One face, with tabular numerals rather than a separate mono family
- **TypeScript only.** No Rust anywhere in the repository

Repository structure per `VPS-A001`:

```
apps/roster-web/     Vulto Roster
services/            api, jobs, render
packages/schema/     Graph schema, shared types, Zod validators
packages/ui/         Design system components
packages/tokens/     Design tokens
docs/Vulto_Specs/    The specification set
```

---

## How to work

**One thing at a time.** Correct the specification, then build against it. Do not scaffold five packages and fill them in.

**Show the plan before writing code** on anything substantial. The founder is not an engineer and reviews intent rather than implementation — a clear plan is more reviewable than a diff.

**When a specification is wrong, say so.** Do not work around it. A workaround produces a codebase that disagrees with its own specification, and the specification is what the next person reads. Name the document, name the problem, propose the correction, and record it in `docs/Foundations_Findings.md`.

**Where building shows the instruction itself is wrong**, per `VPS-002`: the implementation stands and the specification is corrected. The bar is evidence from a working build, not a preference for a different decision.

**Ask when genuinely ambiguous.** The specifications closed every open item deliberately so you would not have to guess. If you find yourself guessing, that is a signal something is missing — say so.

---

## Working with the founder

Not an engineer. Adjust accordingly:

- **Explain what and why, not how.**
- **State trade-offs plainly** when there is a real choice to make.
- **Do not ask which library to use.** `VPS-A001` decided. If it did not, choose and say what you chose.
- **Flag anything that will be expensive to change later**, before doing it.

Work is tracked in Linear, under the **Vulto Foundation** team.

---

## Development environment

`VPS-A007-T14` requires development in GitHub Codespaces for **any person with repository access who is not an owner of the company.**

No such person exists yet, so the founder develops locally, on a device with full-disk encryption enabled and against a private repository.

**This is a condition, not a phase.** It changes the day someone who is not an owner is given repository access — at which point development moves to Codespaces for everyone.

---

## Conventions that are not negotiable

**American English throughout.** Prose, comments, identifiers, filenames. Not *colour*, *behaviour*, *authorisation*, *utilisation*, *cancelled*, *labelled*, *programme*, or *centre*. A mixed codebase is worse than either choice made consistently.

**Links between specification documents use the filename, displaying the code:** `[[VRS-F005_The_Bench_Forecast|VRS-F005]]`. Aliases exist on every document but links do not depend on them, per `VPS-000`. **A specification file cannot be renamed** without rewriting every inbound link — if a filename needs to change, say so rather than doing it.

**Corrections to a specification go in the document that owns the fact.** Not a comment in the code, not a note elsewhere.

**Findings go in `docs/Foundations_Findings.md`.** Finding numbers continue from `docs/Prototype_Findings.md` rather than restarting, so an ID is unique across the project.

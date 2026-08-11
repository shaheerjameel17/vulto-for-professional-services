# Vulto — Project Instructions

You are building **Vulto**, a suite of opinionated applications for professional services firms. This file is the first thing you read in any session.

`AGENTS.md` is a symbolic link to this file. There is one set of project instructions, not two.

---

## Read this before anything else

**`docs/Vulto_Specs/VPS-002_Implementation_Handoff.md`** is the entry point to a complete specification set. Read it in full before writing code, in any session where you are implementing something.

It will tell you which other documents to read. Follow it.

---

## What the specifications are

94 documents across three prefixes, in `docs/Vulto_Specs/`:

| Prefix | Scope |
|---|---|
| **`VPS-`** | The suite. Architecture, design system, pipeline, and platform features every application shares |
| **`VRS-`** | Vulto Roster's own features |
| **`VPJ-`** | Vulto Projects' register (features not yet written) |

**These are not a PRD.** They contain full graph schemas, API contracts, permission behavior, encryption boundaries, interface specifications and acceptance criteria. Where a decision could have been left open, it was made and the reasoning recorded.

**Every open item is closed.** If something reads as an unresolved question, it is a defect in the document — report it, do not decide it yourself.

---

## Current phase: core engineering and graph foundations

**We are building the substrate every application runs on.** The prototype is finished and its corrections are in `VPS-D001` through `VPS-D004`.

The governing specifications are **`VPS-A001`** (the stack) and **`VPS-A002`** (the graph). `VPS-A002` is the one to get right — ninety documents depend on it, and a defect encoded here propagates into every feature built afterward.

### Phase scope

1. **Specification correction.** `VPS-A002`'s registry has defects that only surfaced on trying to implement it. They are recorded in `docs/Foundations_Findings.md` and corrected before schema code exists.
2. **The monorepo and runtime** per `VPS-A001` — package boundaries, pinned toolchains, containerized local dependencies, a bootstrap a TypeScript contributor completes without a Rust toolchain
3. **`packages/schema`** — `VPS-A002`'s node and edge registry as typed contracts
4. **Local graph persistence and the typed query layer** — Loro, SQLite-WASM, materialized, in a Worker
5. **Conformance gates** — schema, graph invariants, architecture boundaries

Nothing else. No feature work. `VPS-F001` and the MVP features follow this phase, in `VRS-001`'s order.

### What is deliberately not in this phase

**The Rust sync engine.** Its substance — sync protocol, encryption, key wrapping, permission-filtered relay — belongs to `VPS-A003` and `VPS-A004`, and neither is this phase's specification. `services/sync-engine` is stood up as a crate with its multi-target build proven and its delta contract defined. It gets its content when `VPS-A003` is implemented.

**The permission interceptor.** `VPS-A004` owns it. This phase registers the privacy metadata the interceptor will read; it does not evaluate a permission.

---

## Rules that hold from day one

**Never compute a working day.** No weekend, no holiday, no calendar arithmetic. `VRS-F004` owns it. A hardcoded Saturday–Sunday weekend is wrong for the Gulf, wrong for a six-day Pakistani week, and wrong for anyone part-time.

**Never write a permission check in a feature.** `VPS-A004`'s interceptor is the only place access is decided.

**Never let Tier 1 or Tier 3 plaintext reach a server.** If you are writing a server-side job that decrypts something, stop. The answer is always that it runs on an authorized device.

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
- **Loro** for CRDT, **SQLite-WASM** for the local query index, materialized in a dedicated Web Worker
- **tRPC over Fastify**, **PostgreSQL via Drizzle**, **Better Auth**
- **Tailwind CSS**, configured from `packages/tokens`
- **Radix UI** primitives, wrapped in `packages/ui`
- **Vitest** for unit and integration, **Playwright** for end-to-end
- **pnpm** workspaces, Turborepo
- **Inter Variable** via `next/font`, self-hosted. One face, with tabular numerals rather than a separate mono family
- **Rust**, confined to `services/sync-engine` and nowhere else

Repository structure per `VPS-A001`:

```
apps/roster-web/     Vulto Roster
services/            sync-engine (Rust), api, jobs, render
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

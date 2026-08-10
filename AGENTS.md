# Vulto — Project Instructions

You are building **Vulto**, a suite of opinionated applications for professional services firms. This file is the first thing you read in any session.

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

## Current phase: prototype

**We are building a static UI prototype. Not the product.**

- No backend, no database, no sync engine, no authentication
- Mock data, hardcoded, in the components or a local fixture file
- No state persistence

**The purpose is to find out whether the design system works on screen.** It has never been rendered. Expect `VPS-D001` through `VPS-D004` to be wrong in two or three places — finding those is the point, and corrections go back into those documents.

### Prototype scope

1. The application shell per `VPS-D004` — sidebar, page header, contextual panel
2. Both themes, both densities
3. **The Bench Forecast** per `VRS-F005` — 15 people, assignment bars, ghost rows, bench regions with cost figures, the today line
4. **An employee profile** per `VRS-F002` — tab structure, structurally-absent compensation section
5. **The timesheet grid** per `VRS-F010` — with the keyboard model working
6. **The command palette** per `VPS-F002` — `Cmd+K`, grouped results
7. **The manager queue** per `VRS-F049` — age-ordered items

Nothing else. Do not build features outside this list.

---

## Rules that hold from day one

Even in the prototype.

**Design tokens are the only source of values.** Every color, size, space and radius comes from `packages/tokens`, generated from `VPS-D001`. No arbitrary Tailwind values, ever. If a value you need is not in the token set, that is a design system question — raise it, do not invent one.

**Components live in `packages/ui`, not in the app.** Per `VPS-D002`, a feature composes components; it never defines one. If you need something the library does not have, add it to the library.

**No `localStorage` or `sessionStorage`.** Anywhere.

**Never compute a working day.** No weekend, no holiday, no calendar arithmetic. In the prototype, mock the working-day data. In the real build, `VRS-F004` owns it. A hardcoded Saturday-Sunday weekend is wrong for the Gulf, wrong for a six-day Pakistani week, and wrong for anyone part-time.

**Read `VPS-002`'s five rules section.** It lists the mistakes that are easiest to make by accident. Hold them consciously.

---

## Stack

Per `VPS-A001`, and settled — do not evaluate alternatives:

- **Next.js**, App Router, TypeScript
- **Tailwind CSS**, configured from `packages/tokens`
- **Radix UI** primitives, wrapped in `packages/ui`
- **pnpm** workspaces, Turborepo
- **Plus Jakarta Sans**, **Manrope**, **Geist Mono** via `next/font`, self-hosted

Repository structure per `VPS-A001`:

```
apps/roster-web/     Vulto Roster
packages/ui/         Design system components
packages/tokens/     Design tokens
docs/Vulto_Specs/    The specification set
```

---

## How to work

**One screen at a time.** Shell first. Do not scaffold seven screens and fill them in.

**Show the plan before writing code** on anything substantial. The founder is not an engineer and reviews intent rather than implementation — a clear plan is more reviewable than a diff.

**When a specification is wrong, say so.** Do not work around it. A workaround produces a codebase that disagrees with its own specification, and the specification is what the next person reads. Name the document, name the problem, propose the correction.

**Ask when genuinely ambiguous.** The specifications closed every open item deliberately so you would not have to guess. If you find yourself guessing, that is a signal something is missing — say so.

---

## Working with the founder

Not an engineer. Adjust accordingly:

- **Explain what and why, not how.** *This screen needs a component the library does not have yet* is useful. Implementation detail is not.
- **State trade-offs plainly** when there is a real choice to make.
- **Do not ask which library to use.** `VPS-A001` decided. If it did not, choose and say what you chose.
- **Flag anything that will be expensive to change later**, before doing it.

---

## Development environment

`VPS-A007-T14` requires development in GitHub Codespaces for **any person with repository access who is not an owner of the company.**

No such person exists yet, so the founder develops locally, on a device with full-disk encryption enabled and against a private repository.

**This is a condition, not a phase.** It does not change when the prototype ends or when real feature work begins. It changes the day someone who is not an owner is given repository access — at which point development moves to Codespaces for everyone.

---

## Conventions that are not negotiable

**American English throughout.** Prose, comments, identifiers, filenames. Not *colour*, *behaviour*, *authorisation*, *utilisation*, *cancelled*, *labelled*, *programme*, or *centre*. The specification set was converted deliberately and a mixed codebase is worse than either choice made consistently.

**Links between specification documents use the filename, displaying the code:** `[[VRS-F005_The_Bench_Forecast|VRS-F005]]`. Aliases exist on every document but links do not depend on them, per `VPS-000`. **A specification file cannot be renamed** without rewriting every inbound link — if a filename needs to change, say so rather than doing it.

**Corrections to a specification go in the document that owns the fact.** Not a comment in the code, not a note elsewhere. Name the document, name the problem, propose the correction.

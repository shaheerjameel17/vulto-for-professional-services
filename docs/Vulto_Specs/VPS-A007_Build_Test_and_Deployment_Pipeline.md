---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-A007
---

# VPS-A007 — Build, Test and Deployment Pipeline

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the monorepo, the two-language boundary, the three Loro build targets), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (the Schema Evolution Protocol this pipeline enforces), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (**the encryption guarantees this pipeline proves rather than assumes**), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (environments, and the prohibition on production data leaving production)
**Blocks:** Nothing structurally, and everything practically. No feature ships without this.

This document is the single source of truth for how code gets from a change to production, for every application in the suite. **One pipeline, one repository, one artifact promotion path.**

---

## Why this is not a generic pipeline document

Four properties of this architecture make a standard Node.js pipeline insufficient, and each produces a real requirement below.

**One Rust source builds three ways.** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] requires the sync engine as a native server binary, a WASM module for the browser, and native bindings for React Native. A change that compiles for one and breaks another must fail before merge, not on a device.

**`packages/schema` is consumed by every one of them, across every application.** A schema change touches the Rust engine, the TypeScript API, every application's web client and the mobile client simultaneously. **It must break the build everywhere before it ships anywhere** — which is the entire reason [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] keeps every application in one repository.

**Tier 1 and Tier 3 guarantees are cryptographic claims, not conventions.** [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] states that no server-side code path can decrypt a Tier 1 or Tier 3 payload. **That is a testable property**, and a pipeline that does not test it is a pipeline in which the guarantee degrades quietly with the next well-meaning refactor.

**Production data never enters any other environment**, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. Every fixture is synthetic, which means fixture generation is pipeline infrastructure rather than a developer convenience.

---

## The fifth property: this codebase is written primarily by an agent

[[VPS-002_Implementation_Handoff|VPS-002]] hands this specification set to Claude Code, and that changes what a pipeline is for.

A pipeline built for human engineers optimizes for a person who already holds the mental model and needs a fast signal. **A pipeline consumed by an agent optimizes for something different: an unambiguous, machine-legible statement of what broke and why**, because the agent's next action is determined entirely by what the failure output says.

Three consequences run through this document:

**Failures are specific, never aggregate.** A step reporting *tests failed* forces a re-run to learn anything. A step reporting the test name, the assertion and the file is directly actionable.

**Every gate has exactly one reason to fail.** A combined lint-and-typecheck-and-test step produces an output an agent has to parse ambiguously. Separate gates produce unambiguous ones.

**The pipeline is the specification's enforcement mechanism.** Rules this document set states in prose — additive-only schema, no server-side Tier 1 decryption, no arbitrary Tailwind values, no vendor SDK in feature code — are checks here. **A rule not enforced by the pipeline is a rule an agent will violate innocently**, having never read the document that stated it.

---

## Decision

**GitHub Actions**, in the same repository as the code, with **GitHub Codespaces as the only sanctioned development environment.**

**GitHub Codespaces is the sanctioned development environment**, and the requirement binds from the moment any person with repository access is not an owner of the company. Not when an engineer is hired specifically — a designer with repo access counts. Not when the team reaches a size — that is a judgment call, and judgment calls drift.

The rule protects against three things: a departing person retaining source, a lost device exposing it, and a compromised device exposing it. **For a company owner, the first does not apply and the second and third are already moot** — an owner holds GitHub administration and production credentials, so a compromised owner device exposes everything regardless of where the source sits. Codespaces would protect nothing that is not already exposed.

**Until that trigger, an owner may develop locally** on a device with full-disk encryption enabled, a device passcode set, and against a private repository. Those are the substituted controls, and they are not nothing.

The trigger is written as a condition rather than an exemption deliberately. **A rule carrying a named exception for the person who wrote it gives the next person asking for one a precedent to point at rather than a principle to argue against.**

---

## Containerization

**Docker, throughout.** Not a technology choice in the sense the rest of this set uses the term — no alternative was evaluated, because none competes. It is stated here because three requirements elsewhere depend on it and none names it.

### What it is doing for this project specifically

**It is how [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s two-language boundary actually holds.** A001-T04 requires that an engineer not working on the sync engine can run the full local stack without a Rust toolchain. The sync engine is a compiled Rust binary; without a container that ships it pre-built, every TypeScript engineer installs Rust, and the boundary that exists to avoid a Rust hiring track quietly stops meaning anything.

**It is what makes Codespaces reproducible.** A007-T14 requires development to happen in Codespaces, and a Codespace is defined by a container image. Without one, each developer gets whatever the base image happened to contain that week.

**It is what makes the production artifact promotable.** A007-T12 requires the production artifact to be byte-identical to the one tested in staging. That guarantee is only meaningful if the artifact is a sealed image rather than a build re-run against whatever the target machine has installed.

### Three image roles

| Image | Contains | Consumed by |
|---|---|---|
| **Development** | Node, pnpm, the Rust toolchain, Postgres, Redis, and every service running locally | Codespaces, per A007-T14 |
| **Service** | One built service and its runtime only. One per service in `services/` | Staging and production |
| **CI** | The toolchain each gate needs, pinned | The pipeline itself |

**The development image is the only one carrying a Rust toolchain.** Service images receive a compiled binary; a service image that could rebuild the sync engine is a service image carrying a compiler into production for no reason.

### Composition, locally

`docker compose` brings up the full stack — sync engine, API, job workers, render service, Postgres, Redis — in one command, with [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s synthetic fixtures loaded.

**A new engineer, or Claude Code in a fresh Codespace, is running the whole product within minutes of cloning.** That is the actual test of whether A001-T04 holds, and it is worth treating as one.

### Pinning

**Every base image is pinned to a digest, never a tag.** A tag moves; a digest does not. An image rebuilt six months later from `node:22` is not the image that was tested, and the promotion guarantee in A007-T12 depends on it being.

Base image updates are deliberate, reviewed changes — the same treatment [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] gives the Loro version pin, and for the same reason.

### What is not containerized

**The frontend.** It deploys to Vercel as a build output rather than an image, per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s hosting decision.

**The mobile applications.** Built through Expo EAS against its own toolchain.

---

## Environments

Per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], with the pipeline's own responsibilities named.

| Environment | Trigger | Data |
|---|---|---|
| **Preview** | Every pull request | Ephemeral, synthetic fixtures, destroyed on merge |
| **Staging** | Merge to `main` | Synthetic only. **Never production data** |
| **Production** | Manual promotion from a staging build | Real |

**Production is promoted, never built.** The artifact that reaches production is byte-identical to the one tested in staging. A separate production build is a build nobody tested.

---

## The gates, in order

Each is a separate job with one reason to fail.

### 1. Format and lint

Prettier and ESLint, including the custom rules [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] requires:

- **No arbitrary Tailwind values.** A color or spacing value outside `packages/tokens` fails here rather than reaching review, per [[VPS-D001_Design_Foundations|VPS-D001]].
- **No vendor SDK imported in feature code.** Every external service goes through an interface in `packages/schema`, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]. This is what keeps [[VRS-F066_Disbursement_and_Payment_Adapter|VRS-F066]]'s adapter and [[VRS-F035_Background_Check_Integration|VRS-F035]]'s provider abstraction real.
- **No `localStorage` or `sessionStorage`.** The local graph is the store.
- **No direct Loro access outside the sync engine and materialization worker**, per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s A001-T06.

### 2. Type check

`packages/schema` first, then every consumer. **A schema change that breaks the API, the web client or the mobile client fails here** rather than at runtime on one platform.

### 3. Schema conformance

The gate that makes [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s protocols enforceable rather than aspirational.

- **Additive-only.** A removed or renamed property fails. Deprecation with a `deprecated_at` timestamp passes.
- **Every node type is registered.** A type in `packages/schema` with no row in [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s registry fails, per Standing Rule 6.
- **Every node carries the Universal Node Conventions**, except for the closed field omissions [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] enumerates: AuditEntry omits `updated_at`, `updated_by` and all three soft-delete fields per [[VPS-F004_Silent_Audit_Log|VPS-F004]]; `PulseAggregateContribution` and `WellnessAggregateContribution` omit `created_at`, `updated_at`, `created_by`, `updated_by`, `soft_deleted_at` and `soft_deleted_by`, retaining only the non-identifying `is_soft_deleted` flag from the deletion fields. Their actor and exact-time provenance lives on the private companion record. **Every omitted field and node type is enumerated in the check**, so another omission cannot be introduced silently.
- **Every tier assignment matches the registry.**

### 4. Unit and integration tests

Vitest. Two suites are non-optional and named individually because both enforce guarantees stated elsewhere:

**The permission matrix suite**, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s A004-T07: every role against every Privacy Class in the default mapping, and every role against every node type in the matrix. **No deployment may reduce this coverage**, and the gate measures that rather than trusting it.

**The working-day suite**, per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Standing Rule 9: every calculation that counts days is tested against a Monday-to-Friday week, a Sunday-to-Thursday week, a six-day week with a half day, a week containing a public holiday, and a reduced-hours period. **A hardcoded weekend fails here.** This is the defect that ran through four documents of the previous specification set, and this suite exists specifically so it cannot recur.

### 5. Encryption boundary tests

**The gate that proves [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s central claim.**

- **No server-side path decrypts Tier 1 or Tier 3.** A static analysis over `services/api` and `services/jobs` asserting that no code path reaches a decryption primitive for those tiers, per A003-T05.
- **No Tier 1 or Tier 3 value reaches an application log**, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s A006-T12. The redaction allowlist is tested against a payload containing every protected field.
- **No push or email payload carries protected content**, per [[VPS-F011_Mobile-Native_Experience|VPS-F011]] and [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]].
- **Object keys contain no human-readable subject matter**, per A006-T05.
- **The anonymous contribution nodes resolve to nobody.** A test asserting that no field on `PulseAggregateContribution` or `WellnessAggregateContribution` carries an actor UUID or exact correlation timestamp, and that their complete edge adjacency equals the registry's explicit per-node allowlist. No wildcard or endpoint set may match an anonymity-protected node — current or future. This is the guarantee [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] and [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]] both describe as structural, verified as structural.

**These are the tests that stop a guarantee eroding through ordinary, well-intentioned refactoring.** Nobody sets out to weaken Tier 3. It happens when a convenience import makes a decryption helper reachable from a job worker, and nothing notices.

### 6. Multi-target build

`services/sync-engine` compiles three ways in parallel — native server binary, WASM, native mobile bindings — from one source. **All three must succeed.** A change that compiles for the server and breaks WASM is a broken change.

### 7. End-to-end tests

Playwright against a preview deployment, covering the journeys that would be catastrophic to break silently: sign-up through workspace creation, the timesheet week, leave request through approval, the payroll finalize-approve-disburse chain, and the offline-then-reconnect sync path.

**That last one matters most and is easiest to skip.** Local-first is this product's central claim, and a regression in offline behavior is invisible to every test that assumes connectivity.

### 8. Accessibility

Automated checks against [[VPS-D002_Component_Library|VPS-D002]]'s floor on every rendered surface: focus visibility, target size at the product geometry, contrast against both themes, and full keyboard operability. **[[VRS-F029_Careers_Site_and_Job_Distribution|VRS-F029]]'s public careers page is tested separately and to a stricter standard**, since a public page carries a legal obligation an internal screen does not.

---

## Synthetic fixtures are pipeline infrastructure

Production data never leaves production, so every test needs generated data — and generated data that exercises the cases this product actually fails on.

**The fixture generator produces a workspace containing**: multiple entities across at least three jurisdictions with different working weeks; employees on full-time, part-time, compressed and contractor arrangements; a provisional holiday awaiting confirmation; assignments that overlap only across a weekend; a payroll run mid-approval; and a Tier 1 record outside the retention window.

Each of those is a case this specification set corrected a defect in. **A fixture set containing only the happy path tests only the code that was never going to break.**

---

## Migration safety

[[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Schema Evolution Protocol is additive-only, so there are no destructive migrations to guard against. Two things still require a gate.

**Materialized index rebuilds.** A change to the SQLite index shape means every client rebuilds from Loro on next launch. That is safe and it is slow, and the pipeline flags it so it is a known consequence rather than a support surprise.

**Client version tolerance.** Per A002-T07, an older client must tolerate a node property it does not recognize. Tested by running the previous release's client against the current schema.

---

## Deployment

**Frontend** to Vercel, one deployment per application in `apps/` — preview per pull request, staging on merge, production on promotion. **Applications deploy independently**, since a Projects release should not require a Roster release.

**Backend services** to DigitalOcean as containers, deployed in dependency order: sync engine, then API, then job workers, then the render service. **Rolling, with health checks**, so a failed deploy does not take the workspace down.

**`services/cross-tenant-aggregation` deploys separately**, per [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s A001-T08. It shares no database, no connection pool and no deployment with the per-workspace path, and the pipeline enforces that separation rather than relying on someone remembering it.

**Mobile** through Expo EAS to TestFlight and Play internal testing. **Not gated on the web release**, since store review makes the two cadences genuinely different.

---

## Rollback

**Frontend and backend roll back by promoting the previous artifact.** Seconds, not a rebuild.

**Mobile cannot roll back**, which is a property of app stores rather than this pipeline. It is stated here because it means a mobile release carries a materially higher bar than a web one, and the pipeline runs the full suite against a mobile build even where nothing mobile-specific changed.

---

## Technical specifications

| ID       | Specification                                                                                                                                                                                                                                                                                                                       |                       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| A007-T01 | Every gate is a separate job with one reason to fail. Combined gates producing ambiguous output are prohibited                                                                                                                                                                                                                      |                       |
| A007-T02 | Failure output MUST name the specific rule, test or file. An aggregate failure message is a pipeline defect                                                                                                                                                                                                                         |                       |
| A007-T03 | The Rust sync engine MUST build to all three targets on every change. A partial build is a failure                                                                                                                                                                                                                                  |                       |
| A007-T04 | A schema change MUST fail the build in every consumer before it can merge                                                                                                                                                                                                                                                           |                       |
| A007-T05 | The schema conformance gate MUST enforce additive-only evolution, registry completeness, and the Universal Node Conventions with only the enumerated exemptions                                                                                                                                                                     |                       |
| A007-T06 | The permission matrix suite MUST cover every role and Privacy Class combination. Coverage MUST NOT decrease between releases                                                                                                                                                                                                        |                       |
| A007-T07 | The working-day suite MUST test at least five distinct calendar shapes. A hardcoded weekend MUST fail                                                                                                                                                                                                                               |                       |
| A007-T08 | Static analysis MUST assert that no server-side path can decrypt Tier 1 or Tier 3 content                                                                                                                                                                                                                                           |                       |
| A007-T09 | Log redaction MUST be tested against a payload containing every protected field                                                                                                                                                                                                                                                     |                       |
| A007-T10 | Every anonymity-protected node MUST be tested to confirm that it carries no identifying actor or exact correlation timestamp, that its actual adjacency equals its explicitly enumerated permitted edge triples, and that no wildcard or endpoint set matches it                                                                 |                       |
| A007-T11 | Production data MUST NOT reach any pipeline stage, fixture or environment                                                                                                                                                                                                                                                           |                       |
| A007-T12 | The production artifact MUST be the promoted staging artifact, never a separate build                                                                                                                                                                                                                                               |                       |
| A007-T13 | `services/cross-tenant-aggregation` MUST deploy separately with no shared database or connection pool                                                                                                                                                                                                                               |                       |
| A007-T14 | Development MUST occur in Codespaces for any person with repository access who is not an owner of the company. Until such a person exists, an owner MAY develop locally on a device with full-disk encryption enabled, a passcode set, and against a private repository. Source MUST NOT be cloned to any non-owner personal device |                       |
| A007-T15 | An offline-then-reconnect end-to-end test MUST run on every release                                                                                                                                                                                                                                                                 |                       |
| A007-T16 | Every base image MUST be pinned to a digest, never a tag                                                                                                                                                                                                                                                                            |                       |
| A007-T17 | A service image MUST NOT contain a compiler or build toolchain. It receives a built artifact                                                                                                                                                                                                                                        |                       |
| A007-T18 | `docker compose` MUST bring up the full local stack, with synthetic fixtures, in one command                                                                                                                                                                                                                                        |                       |
| A007-T19 | The development image MUST allow a full local run without a host-installed Rust toolchain, satisfying [[VPS-A001_Technology_Stack_and_Engineering_Foundations| VPS-A001]]'s A001-T04 |

---

## Acceptance criteria

**GIVEN** a change removes a property from a node type
**WHEN** the pipeline runs
**THEN** the schema conformance gate fails, naming the property and citing [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s additive-only rule

---

**GIVEN** a change makes a decryption helper reachable from `services/jobs`
**WHEN** the pipeline runs
**THEN** the encryption boundary gate fails, naming the reachable path

---

**GIVEN** a change computes a duration by excluding Saturday and Sunday
**WHEN** the working-day suite runs
**THEN** the Sunday-to-Thursday and six-day cases fail, naming the calculation

---

**GIVEN** a change compiles for the native server target and breaks the WASM build
**WHEN** the multi-target gate runs
**THEN** it fails, and the change cannot merge

---

**GIVEN** a new node type is added to `packages/schema` with no registry row
**WHEN** the conformance gate runs
**THEN** it fails, citing Standing Rule 6

---

**GIVEN** an engineer with no Rust toolchain installed opens a fresh Codespace
**WHEN** they run `docker compose up`
**THEN** the full stack runs locally, including the sync engine, satisfying [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]]'s A001-T04

---

**GIVEN** a service image is inspected
**WHEN** its contents are listed
**THEN** it contains a built artifact and its runtime, and no compiler or build toolchain

---

**GIVEN** a release is promoted to production
**WHEN** the artifact is compared to the staging build
**THEN** they are byte-identical

---

**GIVEN** a regression breaks offline write queuing
**WHEN** the end-to-end suite runs
**THEN** the offline-then-reconnect journey fails before release

---

## Out of scope

- **Load and performance testing** — the latency budgets in [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] are design constraints verified in review, not automated benchmarks at this stage
- **Penetration testing** — a periodic external engagement, not a pipeline gate
- **Automatic dependency updates** — reviewed deliberately, since a CRDT or crypto library update is not a routine bump
- **Multi-region deployment** — [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] establishes a single-region posture
- **Automated rollback on error-rate threshold** — rollback is a human decision at this stage

---

## Decisions recorded

**This document exists because excluding it was wrong.** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] and [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] both listed CI/CD as out of scope, which was defensible for a generic pipeline and not for this one — three build targets, a shared schema package, and two cryptographic guarantees that are testable properties rather than policies.

**The pipeline is treated as the specification's enforcement mechanism.** Roughly a dozen rules this document set states in prose are gates here. **A rule not enforced by the pipeline is a rule an agent will violate innocently**, having never read the document that stated it, and that is the single most important thing this document does.

**Every gate has one reason to fail**, because the primary consumer of a failure message is an agent deciding what to do next rather than a person who already knows.

**The working-day suite is named specifically.** The hardcoded-weekend defect ran through four documents of the previous set and would have produced wrong bench costs, wrong leave balances and wrong final settlements in the Gulf. It is now structurally unable to recur.

****Codespaces is a security decision, not a tooling preference**, and it is recorded as one so nobody works around it for convenience later.

**It binds on a trigger rather than a date or a phase.** The first person with repository access who is not an owner of the company. Written as a condition because an exemption naming the founder would be a precedent the next requester could cite, where a condition is one nobody can argue themselves out of.

**Docker is documented here rather than as its own architecture document.** It is deployment and environment mechanics, not a cross-cutting foundation every feature inherits, and giving it document weight would make it look as consequential as the CRDT choice — which it is not. It is named at all because three requirements depend on it silently: A001-T04's toolchain-free local stack, A007-T14's Codespaces reproducibility, and A007-T12's promotable artifact.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the stack and the three build targets
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the Schema Evolution Protocol this pipeline enforces
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the encryption guarantees this pipeline proves
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — environments and the production data prohibition
- [[VPS-002_Implementation_Handoff|VPS-002]] — the handoff this pipeline supports

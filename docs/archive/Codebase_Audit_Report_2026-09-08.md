# Vulto Codebase and Delivery Audit

**Date:** 8 September 2026  
**Audience:** Founder, product leadership, and project leadership  
**Scope:** The current repository, its governing specifications and findings register, the automated checks that can be run today, repository history, and the current Linear plan.

## Executive verdict

Vulto has a **good and unusually thoughtful foundation**, especially for a product that intends to protect sensitive professional-services data. The important architectural decisions are coherent, the written specifications are far stronger than those of most early products, and the graph and security work already has substantial automated proof behind it.

However, Vulto is **not yet ready for production use or real customer data**. This is not because the foundation is fundamentally wrong. It is because the project has advanced faster than its delivery safeguards: the continuous verification pipeline has not been built, the normal verification command is currently failing, one internal diagnostics tool is present in the production release, and several privacy promises remain deliberately unfinished.

My overall assessment is:

> **Continue with the current architecture. Pause new scope after the current in-progress device work, close the release and privacy gates, then move quickly to one thin end-to-end customer workflow.**

This is a healthy project with correctable control and completion problems—not a project that needs a rewrite.

## Leadership scorecard

| Area | Assessment | Leadership interpretation |
|---|---|---|
| Product architecture | Strong | The major choices fit Vulto's privacy and local-first promise. No platform rewrite is justified. |
| Security and privacy intent | Strong | The design treats privacy as a product property, not a late compliance exercise. |
| Security and privacy completion | Not ready | Important protections are tracked but unfinished. Real customer data should not be admitted yet. |
| Core data foundation | Good, with one material gap | The registry and local data engine are substantial, but the common relationship-storage mechanism is not finished. |
| Code quality | Generally good but becoming concentrated | The code shows care and strong reasoning, but several critical areas have grown too large for easy review and safe change. |
| Automated proof | Strong in the graph and security core; weak elsewhere | Hundreds of focused tests exist, but the release process does not yet enforce the full set automatically. |
| Delivery controls | Weak | There is no continuous verification pipeline, and the main local gate is both incomplete and currently red. |
| Documentation | Excellent decisions, unreliable current-status view | The source specifications are valuable; the bootstrap guide and findings summary contain stale or conflicting status. |
| Linear alignment | Needs correction | Actual work, milestone percentages, and issue statuses do not consistently describe the repository. |
| Product readiness | Early foundation | A large amount has been built, but little customer value is yet complete end to end. |

## What is working well

### 1. The product has a coherent architectural point of view

The stack is not a random collection of fashionable tools. The browser-first, local-data model supports Vulto's stated privacy and offline goals; the server boundary is intentionally narrow; and the data model is designed to support several applications without duplicating the truth. The separation between customer-facing applications, shared components, shared definitions, and synchronization services is sensible.

The addition of a second programming language for the synchronization service is also justified. It is confined to the area where portability and security matter and has not spread into the rest of the product.

### 2. Privacy decisions are being made before customer data arrives

The project explicitly classifies sensitive information, restricts what the server may see, records the reach of derived information, and treats permissions and encryption as shared platform responsibilities. This is the right direction for a product that will eventually contain compensation, HR, staffing, and performance information.

The implementation includes adversarial tests—tests that try to prove the product fails safely rather than merely proving a happy path works. That is a notable strength.

### 3. The specifications are a real operational asset

The specifications record decisions, acceptance criteria, boundaries, and known corrections at a level that can preserve founder intent as the team grows. The rule that implementation evidence can correct a specification is mature and practical.

The findings register is also valuable. Problems are being recorded instead of quietly worked around. The issue is its current usability as a status tool, not the discipline behind it.

### 4. The core graph work has meaningful proof

The graph and schema test suites are substantial. In the audit environment, 268 graph tests and 23 schema tests passed. The synchronization service's self-contained tests also passed. The code is strongly typed, ordinary quality checks passed, and the production application compiled successfully once its external font download was permitted.

### 5. The team corrects mistakes rather than concealing them

The history shows examples where a task was initially considered complete, a missing acceptance criterion was later discovered, and a follow-up task was created and completed. That is healthier than ignoring the defect. The next improvement is to make the completion gate strong enough that these omissions are caught before a task is closed.

## Priority findings and proposed solutions

### Stop before the next new area of work

| Priority | Finding | Why it matters | Proposed solution |
|---|---|---|---|
| **Critical** | There is no continuous verification pipeline. | A change can be merged without the promised checks. The current branch already demonstrates the consequence: its standard verification command fails on committed generated files. | Finish the current in-progress device stage, then make the pipeline the next delivery item. It should independently enforce formatting, quality checks, all test groups, production build, security-boundary checks, browser journeys, accessibility, and both synchronization build targets. Block merging when any gate fails. |
| **Critical** | An internal graph-sync diagnostics page is included in the production release. | The production build shows a large diagnostics route and includes an internal data-mutation capability intended for testing. A hidden or unlinked page is not the same as code being absent. This conflicts with the project's own security boundary. | Remove every diagnostics and test-only capability from the production build, not only from navigation. Add an automated release check that inspects the final package and fails if a diagnostics route, test-only entry point, or internal mutation command is present. Apply the same rule to future diagnostics tools. |
| **Critical** | The project's main verification command is incomplete and currently failing. | “Verify” implies release confidence, but today it omits the production build, browser journeys, accessibility checks, and synchronization checks. It also fails on three committed files. This can give leadership a false sense of readiness. | Repair the existing failure immediately, then redefine the command as the complete local equivalent of the continuous pipeline. If some checks require local services, the command should start them or clearly stop with one actionable instruction. |
| **High** | The common mechanism for storing graph relationships is unfinished and has no clear standalone Linear owner. | The milestone is shown as complete, yet most relationship types cannot be written through the general mechanism. This is a foundation dependency for workspace membership and many later features. | Create a dedicated issue for the relationship-storage convention, place it before workspace-membership projection, and adjust the milestone percentage until it is complete. Do not solve it separately in each feature. |

### Required before any customer pilot or real sensitive data

| Priority | Finding | Why it matters | Proposed solution |
|---|---|---|---|
| **Critical** | A person is not yet reliably excluded from sensitive cases about themselves. | Under the current unfinished identity link, an Owner or HR administrator could be allowed to see an HR case concerning them. The specifications already recognize this gap. | Complete the canonical link between a login and the corresponding employee, then enforce and test subject exclusion centrally before HR cases or similarly sensitive features can be piloted. Keep this as a hard launch gate. |
| **Critical** | Protected updates are not yet filtered separately for each recipient device. | Encryption protects the contents, but an unauthorized device may still learn that a protected update exists. The project correctly tracks this as urgent work. | Complete the recipient-specific delivery work and prove that an unauthorized device learns neither content nor meaningful existence information. Make its adversarial test mandatory in the pipeline. |
| **High** | Permission denials do not yet reach a durable audit record. | For sensitive customer data, Vulto must be able to show that denied access was detected and recorded. A local decision without a durable record is not enough for investigation or assurance. | Complete the shared audit service before a sensitive-data pilot. Define who can review denial records, how long they are retained, and what customer-facing evidence can be exported. |
| **High** | The encryption and synchronization design has not had an independent specialist review. | The internal work is careful, but this is a high-consequence, custom system. Internal tests cannot replace an experienced external review of the design and its implementation. | Schedule a focused external security and distributed-data review before production data. Review the threat model, device trust, revocation, recovery, recipient filtering, key handling, and browser/server boundary. Track every recommendation to closure or explicit founder acceptance. |
| **High** | Multi-tab behavior remains deliberately incomplete. | Only one browser tab actively synchronizes. Other open tabs may show stale information until refreshed or promoted. This can create conflicting decisions by users. | Complete the tracked multi-tab convergence work before broad use. In the meantime, display a clear “this view may be out of date” state in non-active tabs rather than silently showing stale data. |

### Important maintainability and delivery improvements

| Priority | Finding | Why it matters | Proposed solution |
|---|---|---|---|
| **High** | Several security-critical files have become very large. | Large files are harder to review, easier to misunderstand, and more likely to be changed incorrectly. The risk is concentrated in the local data worker, protected-data partitions, and synchronization tests. | After the current behavior is locked by the pipeline, split these areas by responsibility: coordination, storage, encryption, revocation, and recovery. Preserve behavior; do not combine this with a redesign. Require smaller reviewable changes in these areas. |
| **High** | Test strength is uneven. | The graph and security core are well tested, but the shared interface library, design-token package, and main web application report no unit tests. Accessibility is specified but not automatically enforced. | Add a small, high-value suite for shared components, navigation, error states, accessibility, and the most important user journeys. Avoid chasing a coverage percentage; test promises a customer would notice. |
| **High** | The production build depends on downloading the company font from the internet. | A release cannot be reproduced in a restricted or temporarily offline environment, despite the specification requiring a self-hosted font. The first build attempt failed for exactly this reason. | Store the approved Inter Variable font with the product and build from that local asset. Add a release test that succeeds with outbound internet access disabled. |
| **Medium** | Historical reasoning inside source files is obscuring the current rule. | The detailed record is valuable, but long histories inside active files make the present contract harder to see and increase onboarding time. | Keep only the current invariant and the reason it matters beside the implementation. Move historical decision trails to the findings register or short decision records, with links back from the code where useful. |
| **Medium** | Dependency versions are not governed consistently across packages. | The lock file makes today's build repeatable, but packages express versions in several different ways. Over time this creates avoidable drift and harder upgrades. | Adopt one central version policy, pin foundational tools deliberately, and let an automated updater propose small reviewed upgrades after the pipeline exists. |

## Documentation and planning audit

### The current documentation has two different truths

The governing specifications are generally strong, but the operational documents do not always reflect what now exists:

- The bootstrap guide still describes the schema, authentication, and synchronization service as placeholders even though all three now contain substantial implementations.
- The guide says the standard verification command represents the future pipeline, although the pipeline does not exist and the command omits several required checks.
- The findings register's summary table still calls two recovery questions open even though later sections and the governing synchronization specification record the founder's decision and closure.
- Comments in the application configuration still say authentication is absent.

**Proposed solution:** after the immediate release gates are fixed, run a short documentation-reconciliation task. Treat the governing specification as the source of product intent, Linear as the source of scheduled work, and an automatically produced status page as the source of current implementation state. The bootstrap guide should contain only instructions that are proven on a clean machine.

### Linear does not accurately describe current progress

The Linear portfolio gives a useful high-level structure, but its status currently overstates some milestones and understates active work:

- “Datagraph Schema & Typed Query Foundation” is shown as 100% even though the common relationship-storage gap remains open.
- The device-registration task is still marked Backlog while the repository contains three completed stages and active fourth-stage changes for it.
- The continuous-pipeline task is urgent but remains in Backlog despite feature and security work continuing.
- The permission and encryption milestone is shown as 75%, but the remaining 25% contains launch-critical privacy work; the percentage therefore understates the practical risk.
- A stray “testing” project adds noise to the portfolio.

**Proposed solution:** hold a 30-minute weekly founder delivery review using only three questions: What is actually complete and proven? What is in progress in the repository? What blocks safe customer use? Update statuses and dependencies during that review. Milestone percentages should be weighted by risk and customer readiness, not simply by issue count.

## Review of the major decisions

### Decisions to retain

- **Local-first data with end-to-end protection:** This supports Vulto's differentiating privacy promise and is consistently reflected in the architecture.
- **One shared graph across applications:** This avoids duplicated people, projects, and organizational truth. The relationship-storage gap should be completed centrally rather than weakening this decision.
- **A central permission service:** Feature-by-feature permission rules would become inconsistent and unsafe. The current central approach is correct.
- **A confined synchronization service:** Keeping the specialized language and security logic within one service limits organizational complexity.
- **Shared design tokens and components:** This is the right way to make several applications feel like one product.

### Decisions to validate with customers before they become expensive to change

1. **Strict online unlock after a complete browser restart.** This is secure, but it may conflict with the expectations of consultants working with unreliable connectivity. Test the experience with target users before the first pilot and be explicit about what “offline” does and does not mean.

2. **Device revocation across every workspace.** The present decision allows an administrator in one customer workspace to retire a person's device everywhere they use Vulto. That may be surprising in a multi-client professional-services context and gives one organization consequences beyond its own workspace. Before multi-tenant launch, decide whether “lost device globally” and “remove this device from my workspace” need to be separate actions.

3. **The cost of the privacy model.** The current approach is defensible only if target customers value private, local-first operation enough to accept a more complex product and a slower initial feature pace. Validate that proposition explicitly in sales conversations. If customers do value it, this architecture is a moat; if they do not, it is expensive invisible infrastructure.

## Is the project over-engineered?

Not in its core intent, but it is at risk of becoming so in its delivery sequence.

The graph, permission, and encryption foundations are justified by the applications Vulto intends to build. Removing them would create costly data duplication and privacy rework later. The danger is continuing to perfect the substrate without putting a small real workflow through it.

Once the release gates and known foundation gaps are closed, the next goal should be a **thin, end-to-end workflow used by a real design partner**, not another broad layer of platform capability. It should exercise identity, permissions, graph storage, synchronization, shared interface components, and one customer outcome. Evidence from that workflow should decide where the foundation needs more investment.

## Recommended order of work

### Phase 1 — Make the current foundation trustworthy

1. Complete and preserve the current device-registration/revocation work.
2. Remove the production diagnostics/test capability and add a permanent release check.
3. Repair the current verification failure.
4. Build the continuous pipeline and architecture-conformance gates before starting another product area.
5. Add the missing relationship-storage issue, dependency, and milestone correction in Linear.

### Phase 2 — Close the sensitive-data gates

1. Complete identity-to-employee projection and subject exclusion.
2. Complete protected recipient filtering.
3. Complete durable permission-denial auditing.
4. Complete multi-tab convergence or provide an explicit stale-view warning.
5. Commission the independent security review and close its findings.

### Phase 3 — Prove customer value

1. Select one narrow workflow from sign-in to a customer-visible result.
2. Add automated customer-journey and accessibility proof for that workflow.
3. Pilot with non-production or carefully controlled data first.
4. Measure setup time, offline expectations, user comprehension of device trust, and the perceived value of Vulto's privacy model.
5. Use the evidence to choose the next feature, rather than extending the foundation speculatively.

## Evidence from this audit

- The repository contains approximately 57,000 lines of application, service, schema, and test code across 425 tracked files and 148 commits.
- The graph suite passed 268 tests; the schema suite passed 23 tests; and the synchronization service's self-contained tests passed.
- Ordinary code-quality and type-consistency checks passed.
- The main verification command failed on three committed generated files.
- The web production build succeeded when internet access was allowed, but it proved that the graph-sync diagnostics route and an internal mutation command were included in the final browser package.
- Database-backed and browser-based suites could not be fully executed in this audit environment because the local container service was not running and the environment prevented local network binding. Those environmental failures are **not counted as product bugs** in this report. They reinforce the need for a self-contained pipeline that produces definitive results on every change.
- All tracked repository areas were inventoried and searched. The governing documents for the present phase, the findings register, implementation history, package boundaries, production configuration, and relevant tests were reviewed in depth. The 94-document specification library was not re-certified line by line for features that have not yet been implemented; this audit assessed those documents where they govern the work that exists today.

## Final recommendation

The work done so far is good. It shows discipline, a clear product thesis, and above-average care with sensitive data. The right response is **not** to restart or replace the architecture.

The leadership correction is to make “complete” mean “automatically proven, releasable, and accurately reflected in Linear.” Close the confirmed production-bundle issue, establish the missing pipeline, finish the known privacy gates, and then force the foundation to prove itself through one real customer workflow.

Until those steps are complete, Vulto should be described as a promising and substantial engineering foundation—not yet as a production-ready product.

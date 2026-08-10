---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Platform
aliases:
  - VPS-003
---

# VPS-003 — Commercial Model

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-000_Documentation_Standard|VPS-000]] (**the Feature Type enum, which this document uses as the plan boundary**), [[VRS-001_Feature_Register|VRS-001]] (every feature's own type assignment), [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] (Workspace's billing fields, extended here), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the interceptor this document adds a third check to), [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] (the write-authority check this one sits alongside)
**Blocks:** Nothing structurally. Every feature is buildable without knowing its plan; none is sellable without it.

This document is the single source of truth for what Vulto charges, what each plan contains, and how a feature knows whether a workspace has bought it.

---

## Why this is a specification and not a pricing page

Plan gating is a product feature. Every one of the seventy-eight features has to know whether the workspace in front of it has paid for it, and **an implementer given a pricing page has been given marketing copy rather than a rule.**

More importantly: **the plan boundary is already in the schema.** [[VPS-000_Documentation_Standard|VPS-000]] defines Feature Type as a closed six-value enum, assigned to every feature in [[VRS-001_Feature_Register|VRS-001]] on grounds that had nothing to do with pricing — it describes what kind of engineering problem a feature is.

That enum turns out to be the right commercial boundary too, and that is not a coincidence. **A feature's engineering character and its commercial value are correlated because both derive from what it does for the business.** Intelligence features exist because a workspace has accumulated history. Financial features exist because a firm is running payroll. Platform features exist because an organization has integration needs. Each of those is also the moment a customer is willing to pay more.

**The practical consequence: every feature already knows its plan.** No feature needs a new property, and no plan assignment can drift from the register, because there is only one place it is recorded.

---

## The model

**Per-employee, per-month, every application included.** One number.

Not per-application licensing. The entire proposition of [[Vulto for Professional Services]] is an opinionated, integrated operating system for a professional services firm; per-application licensing makes it a marketplace where a customer assembles their own suite, which is precisely what this product is sold against. It would also require building and maintaining a license-management console — a real product, and not the one being built.

**Which applications a given employee can open is an administrative control, not a commercial one.** An Owner decides that a designer does not need [[Vulto Accounts]] in their sidebar. That decision changes nothing about the bill, and it should not: it is a decision about clarity, not entitlement.

---

## The four plans

Each plan is the previous plan plus one or two Feature Types.

| Plan | Adds | Contains |
|---|---|---|
| **Starter** | `Core` · `Experience` | The Bench Forecast, profiles, assignments, timesheets, leave, onboarding, the org chart, the self-service portal |
| **Professional** | `Intelligence` · `Compliance` | Utilization and capacity analytics, the strain and retention signals, the reasoning layer, contracts, e-signature, policies, right to work, case management, audit |
| **Complete** | `Financial` | Payroll, tax configuration, multi-currency, disbursement, contractor invoicing, expenses, compensation bands, benchmarking |
| **Enterprise** | `Platform` | The API, suite bridge, custom fields, SSO and SCIM, configurable retention, priority support |

**Starter includes `Experience` deliberately**, and this is the one deviation from a strict type-per-plan mapping. Experience features — the self-service portal, the daily briefing, the manager dashboard — are what make the product feel finished rather than functional. A Starter workspace where employees cannot see their own leave balance is not a cheaper product; it is a worse one, and it churns.

**Compliance sits at Professional rather than Complete**, which is arguable. Contracts and e-signature are the second thing a small agency asks for after the Forecast, and placing them behind the payroll tier would put the most common upgrade trigger two plans away from the entry point.

---

## Pricing

Full list price, per employee per month, billed annually:

| Plan | Price |
|---|---|
| **Starter** | $12 |
| **Professional** | $22 |
| **Complete** | $35 |
| **Enterprise** | $50 |

Monthly billing is available at a 20% premium rather than annual carrying a discount. **The same arithmetic, framed as the annual price being the real one**, because a discount invites a negotiation and a premium does not.

**Enterprise is published.** Every competitor in this category hides it behind a form, and the reason is that they intend to charge differently depending on how the conversation goes. Publishing it is a positioning decision as much as a pricing one: **an agency of thirty people can work out what Vulto costs them without speaking to anybody**, which is the entire promise of a product that replaces a sales-led category.

Custom terms above a genuine threshold — 250 employees — remain negotiable, and the page says so plainly rather than implying that everyone above some invisible line gets a phone number.

---

## The early adopter price, and why the lock is the offer

The suite ships over years. **Charging the full price of a nine-application platform for one application would be dishonest**, and pricing at what one application is worth today would leave the eventual price unreachable.

**Every plan carries an early adopter price that rises as applications ship. Every workspace is locked, permanently, at the price in force when it subscribed.**

| Stage | Multiplier | Complete |
|---|---|---|
| Roster only | 40% | $14 |
| Roster + Projects | 55% | $19 |
| + Accounts, Sales, Legal | 75% | $26 |
| Full suite | 100% | $35 |

**The lock is not a concession, it is the product.** A workspace that subscribes during the Roster-only stage pays $14 per employee per month for as long as they remain a customer — including the day the full suite ships and a new customer pays $35 for the same thing.

That converts a taper into an acquisition argument with an honest deadline: **the price only goes up from here, and yours never will.**

### Why grandfathering rather than tapering existing customers up

The alternative — raising existing customers' prices as the suite completes — is the hardest commercial motion there is, and it lands hardest on exactly the wrong people. **The customers who signed earliest, on the least complete product, took the most risk and would face the largest increases.**

The cost of grandfathering is the discount on the smallest, earliest cohorts, permanently. That is a real cost and it is small in absolute terms, because those cohorts are small — which is the whole point.

### Framing

The published page shows the full price with the early adopter price beside it, and states the lock explicitly: **Locked for the life of your account.** Not *limited time*, not a countdown, no manufactured urgency. The deadline is real — the price genuinely rises when the next application ships — and a real deadline stated plainly is more persuasive than an invented one.

---

## Regional pricing

**A Karachi agency cannot pay $35 per employee per month**, and this product is built for Karachi agencies. A single global price would price out the market it was designed for.

**Regional tiers, resolved from the workspace's primary [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] Entity jurisdiction:**

| Tier | Jurisdictions | Multiplier |
|---|---|---|
| **Tier A** | UK, US, AE, SG | 100% |
| **Tier B** | SA, Global | 70% |
| **Tier C** | PK, IN | 45% |

Resolved once at subscription and **locked with the price**, so an agency that opens a UK entity later is not repriced for growing.

**A multi-entity workspace pays its primary entity's tier for every seat**, not a blended rate. A blended rate creates an incentive to misrepresent where people are employed, and this product holds the employment records that would make that misrepresentation visible.

---

## What counts as a billable seat

**An Active Employee node.** Nothing else.

| Not billable | Why |
|---|---|
| Ghost Resources | A placeholder is not a person |
| Candidates | Not employed, and [[VRS-F030_Candidate_Portal|VRS-F030]] gives them no account |
| Sub-vendors | An organization, not a seat |
| Inactive employees | Offboarded, and their records are retained under [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] rather than charged for |
| Client portal users | [[Vulto Comms]]' territory, never a Roster seat |

**Contractors with `employment_type = Contractor` are billable**, because they are Employee nodes with profiles, assignments, timesheets and invoices — the product does the same work for them.

**Seats are counted daily and billed on the monthly peak.** Not the average, which under-bills a firm that scaled mid-month, and not a per-day proration, which produces an invoice nobody can check. **The peak is a number a founder can verify against their own headcount**, and verifiability matters more here than precision.

A ten-seat minimum applies to Starter and Professional. Below ten people, an agency does not have the resourcing problem this product solves.

---

## Trial, and no free tier

**Fourteen days, full Complete access, no card.** [[VPS-F006_Workspace_Setup_and_Data_Import|VPS-F006]]'s setup and import exist so a real agency can have their own data on screen within an hour, and a trial that does not show a firm its own bench cost has shown them nothing.

**There is no free tier, permanently.** Two reasons, and the second matters more.

A free tier in this category attracts firms too small to have the problem, and support for them is a cost with no path to revenue.

More importantly: **this is an opinionated product, and a free tier forces the opposite discipline.** Free tiers survive by being broadly acceptable, which means they accumulate configuration, escape hatches and exceptions — the precise things [[VPS-F010_Custom_Fields_and_Workspace_Extensibility|VPS-F010]]'s cap and [[VRS-F009_Time_Classification_Taxonomy|VRS-F009]]'s fixed category set exist to refuse.

---

## How a feature knows its plan

### Workspace fields

Extending the billing fields [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] establishes as Tier 2, Owner-only:

```
plan:                  enum: Starter, Professional, Complete, Enterprise
billing_cadence:       enum: Monthly, Annual
price_locked_at:       date — the rate card version in force at subscription
regional_tier:         enum: A, B, C — resolved once, locked
subscription_status:   enum: Trialing, Active, PastDue, Canceled
trial_ends_at:         date, nullable
```

### The third check

[[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s interceptor already runs two checks: **role permission**, and where [[VPS-F008_Vulto_Suite_Graph_Bridge|VPS-F008]] applies, **write authority**.

`planEntitlement.check(workspaceId, featureType)` is a third, running **after both**, and it never widens anything. A feature the role cannot reach is refused by the first check regardless of plan.

**It resolves against Feature Type, never a feature identifier.** A per-feature entitlement list is a list that drifts from [[VRS-001_Feature_Register|VRS-001]] the first time somebody forgets to update it; a type-level check cannot drift, because the type is already in the frontmatter.

### What a gated feature looks like

**Not a permission error.** [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s restricted state means *you may not see this*, which is a statement about the person. A plan gate means *your workspace has not bought this*, which is a statement about the account and needs its own treatment.

A gated feature renders **a plain description of what it does, what plan includes it, and a single action to view plans.** Not a blurred screenshot, not a teaser, not a modal that interrupts.

**Nothing is hidden from navigation.** A Starter workspace sees Payroll in its sidebar with a `Complete` badge. Hiding it means a customer never learns the product does the thing they are about to buy elsewhere.

### Downgrade

**Data is never destroyed by a downgrade.** A workspace dropping from Complete to Professional retains every payroll record; the payroll surfaces become read-only, and export through [[VRS-F061_Reporting_and_Export_Engine|VRS-F061]] remains available regardless of plan.

**Export is never gated**, on any plan, at any subscription status including Canceled. A product holding a firm's employment records cannot make leaving conditional on paying, and [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s workspace export exists partly for this reason.

**A canceled workspace stays readable for 90 days**, then follows [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]'s retention schedules.

---

## Technical specifications

| ID | Specification |
|---|---|
| VPS-003-T01 | Plan entitlement MUST resolve against Feature Type, never a per-feature list |
| VPS-003-T02 | The entitlement check MUST run after role permission and write authority, and MUST NOT widen either |
| VPS-003-T03 | A downgrade MUST NOT destroy, hide or degrade any record. Affected surfaces become read-only |
| VPS-003-T04 | Export MUST NOT be gated by plan or subscription status, including Canceled |
| VPS-003-T05 | Billable seats MUST count Active Employee nodes only, billed on the monthly peak |
| VPS-003-T06 | `price_locked_at` MUST be set at subscription and MUST NOT change. A rate card revision applies to new subscriptions only |
| VPS-003-T07 | `regional_tier` MUST resolve once from the primary Entity's jurisdiction and MUST NOT be recomputed |
| VPS-003-T08 | A gated feature MUST render its own plan-gate state, never [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]'s permission-restricted state |
| VPS-003-T09 | Gated features MUST remain visible in navigation with their required plan named |
| VPS-003-T10 | Billing fields are Tier 2, Owner-only. HR Admin has no access, per [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] |

---

## Acceptance criteria

**GIVEN** a Starter workspace opens Payroll
**WHEN** it renders
**THEN** a plan-gate state appears naming Complete, distinct from a permission-restricted state, with the feature still visible in navigation

---

**GIVEN** a Complete workspace downgrades to Professional
**WHEN** payroll is opened afterwards
**THEN** every historical run remains fully readable, no record is destroyed, and new runs cannot be created

---

**GIVEN** a workspace cancels entirely
**WHEN** an Owner requests a full export
**THEN** it succeeds, because export is never gated

---

**GIVEN** a workspace subscribed during the Roster-only stage
**WHEN** the full suite ships and list prices reach 100%
**THEN** that workspace continues at its locked rate indefinitely

---

**GIVEN** a workspace scaled from 30 to 45 employees mid-month
**WHEN** the invoice is calculated
**THEN** it bills 45 seats, the monthly peak, verifiable against the workspace's own headcount

---

**GIVEN** a workspace with a Pakistan primary entity later opens a UK entity
**WHEN** the next invoice is calculated
**THEN** the regional tier is unchanged, having been locked at subscription

---

**GIVEN** a Manager attempts to view billing configuration
**WHEN** the request is made
**THEN** it is structurally absent, per [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]

---

## Out of scope

- **Payment collection, invoicing and dunning** — a billing provider's territory, reached through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s abstraction. This document defines what is owed, not how it is taken
- **Per-application licensing** — permanently excluded, per the reasoning above
- **Usage-based pricing on any dimension** — per employee, per month, and nothing else. Metered pricing on storage, API calls or payroll runs would make the bill unpredictable for a firm whose own margins are thin
- **A free tier** — permanently excluded
- **Partner, reseller or agency-of-agencies pricing** — a real future question, not answered here
- **Per-feature entitlement overrides** — a workspace with one Complete feature on a Professional plan is a support burden with no revenue path

---

## Decisions recorded

**The Feature Type enum is the plan boundary.** It was defined in [[VPS-000_Documentation_Standard|VPS-000]] on engineering grounds and turns out to be the right commercial boundary, because both derive from what a feature does for the business. Every feature already knows its plan, and no assignment can drift from the register.

**Experience ships with Starter**, the one deviation. A Starter workspace where employees cannot see their own leave balance is not a cheaper product, it is a worse one.

**Enterprise pricing is published.** Every competitor hides it, and the reason they hide it is that they intend to charge differently depending on the conversation.

**Cohort grandfathering rather than tapering existing customers up.** Raising prices on the customers who took the most risk on the least complete product is the hardest commercial motion there is, and it lands hardest on exactly the wrong people. The lock becomes the offer instead.

**Regional tiers resolve from entity jurisdiction and lock at subscription.** A single global price would exclude the market this product was designed for. A blended multi-entity rate would create an incentive to misrepresent where people are employed — in a product that holds the records proving otherwise.

**Seats are billed on the monthly peak.** Not the average, which under-bills growth; not a proration, which produces an invoice nobody can check. **Verifiability against a founder's own headcount matters more than precision.**

**Export is never gated, at any plan or status.** A product holding a firm's employment records cannot make leaving conditional on paying.

**No free tier, permanently**, and the second reason is the real one: free tiers survive by being broadly acceptable, which forces exactly the configuration and escape hatches this product's whole philosophy refuses.

---

## Related Notes

- [[VPS-000_Documentation_Standard|VPS-000]] — the Feature Type enum this document uses as its boundary
- [[VRS-001_Feature_Register|VRS-001]] — where every feature's type is assigned
- [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] — the billing fields extended here
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the interceptor this adds a third check to
- [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]] — the export and retention that survive cancellation

---
Type:
  - Vulto Roster Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Financial
aliases:
  - VRS-F006
---

# VRS-F006 — Rate Card Engine

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] (Employee — `billing_rate_default` and `seniority_level`, the fallback and the matching key), [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] (Entity — `default_currency`), [[VRS-F005_The_Bench_Forecast|VRS-F005]] (Assignment, which carries this feature's resolved rate), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (RateCard and RateCardLine registry entries), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (Tier 1 fetch-on-demand and encryption), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the Finance-restricted default mapping, no override required)
**Blocks:** Nothing structurally. [[VRS-F005_The_Bench_Forecast|VRS-F005]] renders without it, writing `billing_rate_default` into `effective_billing_rate` until this feature supplies resolution.

This document is the single source of truth for this feature.

---

## What It Is

A narrow, bootstrap billing-rate reference. An agency defines named rate configurations — an hourly rate per seniority level — and applies them per Assignment, so the same person can be billed differently across different clients or engagement types.

**It is explicitly not a client-facing quoting tool, and it is not the permanent rate card for the business.** Per [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]]'s Cross-Suite Node Ownership, [[Vulto Accounts]] is that, permanently, the moment a workspace activates it. This exists so that bench-cost and margin arithmetic has something better than one flat rate per person before Accounts exists. Nothing more.

---

## Problem It Solves

[[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]'s `billing_rate_default` gives every employee exactly one billing rate regardless of client or project. Real agencies do not bill that way: a retainer client gets a discounted rate, a new logo pays standard, an emergency engagement commands a premium.

Without a way to represent that, every margin and bench-cost figure that assumes a flat per-employee rate is wrong for any agency with more than one price point — which is most of them, and all of the ones large enough to need this product.

**The scope discipline is deliberate and worth stating.** An earlier draft of this feature described client-facing rate configurations, a full finance settings surface, multi-role rate tables and an implied quoting adjacency. That is [[Vulto Accounts]]' product. Where the old draft's mechanics were sound — versioning through a supersedes chain, a per-assignment override — they are kept. Where its scope exceeded the bootstrap mandate, it is cut rather than quietly absorbed, because a bootstrap that grows into a parallel implementation of another application is worse than no bootstrap at all.

---

## User-Facing Flows

### Creating a rate card

A Finance Admin or Owner creates a named configuration — *Acme Corp Standard*, *Government Framework* — and adds one rate line per seniority level, each an hourly rate. Daily and monthly figures compute automatically at 8 hours and 22 days; they are never entered separately, because two independently editable representations of one number will disagree within a quarter.

Currency defaults to the Entity's `default_currency` per [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]], overridable for a card genuinely denominated differently.

### Applying a rate card

When creating or editing an Assignment, a Finance Admin or Owner selects a rate card. The employee's `seniority_level` determines which line applies, and the resolved rate previews before saving.

### Overriding one assignment

An Assignment may carry its own hourly rate instead of the resolved figure, with a required reason. This is for the genuine exception — a specific person on a specific engagement at a specific negotiated rate — not a substitute for maintaining the card.

### Updating a rate card

Editing rates creates a new version linked by `supersedes`. **Assignments already pointing at the prior version keep their original figures.** Nothing already priced changes underfoot, and only a new or explicitly re-pointed Assignment picks up the new version.

---

## Interface Specification

### Screens

| Screen | Shell region | Purpose |
|---|---|---|
| Rate cards | Content + Panel | List and manage. Reached from [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] |
| Rate card editor | Panel | Lines, currency, version history |
| Assignment rate selector | Inline, in the Assignment form | Selection, preview, override |

### Layout and components

**Rate cards** is a Table: name, currency, line count, version, active assignment count, last updated. Active assignment count is the useful column — it tells a finance admin which cards are load-bearing before they edit one.

**Rate card editor** opens in the Panel: a name Input, a currency Select, and a Table of one row per seniority level with an hourly rate Input. Daily and monthly figures render beside each row in `numeric` `text-tertiary`, computed live and not editable.

A version history Section beneath shows the supersedes chain — version, date, who changed it, and how many assignments still point at it. Saving a change opens a Modal confirming that existing assignments retain their rates and that only new ones take the update. This is one of the few modals in the product, because the alternative — a finance admin believing they have repriced live work when they have not — is a worse outcome than an interruption.

**The Assignment rate selector** is a Select plus a live preview in `numeric`: hourly, daily and the resolved figure. An override is revealed by a `ghost` **Override rate** action, which expands an Input and a required reason Textarea. An assignment carrying an override shows a small `attention` Badge on the Bench Forecast bar's hover card, since an unexplained rate difference is exactly the thing someone later needs to trace.

### Keyboard

Standard list and form bindings from [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]. Rate inputs accept `Tab` between seniority rows, so an eight-level card is entered without touching a mouse.

### System states

| State | Treatment |
|---|---|
| Syncing | Skeleton rows |
| Restricted | Managers and Team Members never reach this screen. It does not render in the sidebar for them, rather than rendering and refusing |
| Aged out | Not applicable. Every read is fetched fresh (F244); nothing is cached on-device to age out of |
| Empty | *No rate cards yet. Assignments will use each person's default billing rate.* with **Create rate card** — naming what happens without one, rather than implying the product is incomplete |
| Error | A duplicate seniority line replaces rather than erroring |

### Responsive

Drops `version`, then `currency`, below 1280px. The editor stacks.

---

## Technical Architecture

### RateCard

```
rate_card_id:   UUID v4
workspace_id:   UUID
name:           string, required
currency:       ISO 4217, required — defaults to the Entity's default_currency
version:        integer, starts at 1
supersedes_id:  UUID, nullable, FK to the RateCard this replaces
is_active:      boolean, default true

— Universal Node Conventions per VPS-A002 —
```

### RateCardLine

```
line_id:         UUID v4-shaped, deterministic — see below (F247)
workspace_id:    UUID
rate_card_id:    UUID, FK — a direct scalar field only. Unlike Assignment's
                 parallel `governed_by` edge to RateCard (F243), RateCardLine
                 carries no edge of its own: nothing ever needs to traverse
                 backward from a RateCard to "every line under it" except
                 through the card's own lines, so no reverse query exists to
                 serve
seniority_level: enum matching Employee.seniority_level exactly — the matching key
hourly_rate:     decimal, required
daily_rate:      decimal, computed = hourly × 8, not independently editable
monthly_rate:    decimal, computed = daily × 22, not independently editable

— Universal Node Conventions per VPS-A002 —
```

At most one line per seniority level within a card. A level with no line has no rate under that card, and resolution falls through.

**`line_id` is deterministic, not a random UUID v4 (F247).** `rate_card_id`/`seniority_level` are protected Tier 1 fields with no edge and no index over their decrypted content — `readProtected` is a lookup by node id only — so `rateCard.getPreview` and `resolveAssignmentRate` (below) need a `line_id` they can compute rather than discover. `line_id = deterministicUuid(\`rate_card_line:${rateCardId}:${seniorityLevel}\`)`, the same SHA-256-derived, UUID-v4-shaped scheme `services/api/src/auth/membership-edge-ids.ts` already uses for `membership_of`/`membership_in` and F233's `initialCalendarId` already uses for `WorkingCalendar` — still UUID v4-shaped (A002-T02), never a full-workspace decrypt-and-filter scan (A002-T03). `rateCard.create`/`update` compute this id server-side, in `apply()`, for every line written. A side effect: two lines for the same seniority under the same card always compute the identical id and overwrite the same fragment, so "at most one line per seniority level" (G05) is enforced by construction, not by separate duplicate-detection code.

### Rate resolution

Run on Assignment write, in strict order:

1. `rate_override_hourly` if set
2. Else, the RateCardLine matching the employee's `seniority_level` under the Assignment's `rate_card_id` — read via the same deterministic `line_id` lookup as `rateCard.getPreview` (F247), never a scan
3. Else, the employee's `billing_rate_default` per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]], converted at 8 hours per day since that field is daily and this one is hourly

The resolved figure writes to `effective_billing_rate` on the Assignment at creation, and again whenever `rate_card_id`, `rate_override_hourly` or the employee's `seniority_level` changes. **It is never recomputed retroactively when a card is superseded.** An assignment keeps the figure that was true when it was resolved.

**Alongside the scalar field, a `governed_by` edge (F243).** `VPS-A002` registers `governed_by: Assignment → RateCard`, owned by this feature, mirroring the dual scalar-plus-edge shape Assignment already carries for `employee_id`/`assignment_of` and `project_id`/`assigned_to`. Every write that sets `rate_card_id` — `assignment.create` when the parameter is provided, and `assignment.setRateCard` — also writes this edge: the Assignment's existing active `governed_by` edge, if any, is closed (`effective_to` at the write's timestamp) and a new one opened, the same manual singularity management `services/api/src/mutations/calendar.ts` already uses for `governed_by_calendar`, since `governed_by` carries no `historyPolicy: "single-active-outgoing"`. The scalar field remains what the resolution algorithm above reads; the edge exists solely so RateCard-side queries can traverse back to their Assignments.

### Why the resolved figure sits on Assignment at Tier 0

RateCard and RateCardLine are Finance-restricted and Tier 1, correctly — the full rate structure across every client is competitively sensitive, and in a small agency it is also close to a compensation disclosure.

`effective_billing_rate` is a single resolved number for one assignment, and Assignment is Tier 0 for the same reason `billing_rate_default` is: a manager needs it to reason about their own team's margin without a finance role. Exposing the resolved number while keeping the card's other lines and structure at Tier 1 is a deliberate narrow exception, not a general weakening. It reveals what one person costs on one engagement; it never reveals another client's rates, another level's rate, or that a rate card exists at all.

### API contracts

```
rateCard.create(name, currency, lines)                       -> { rateCardId }
rateCard.update(rateCardId, expectedVersion, lines)          -> { newRateCardId }
  // expectedVersion checked first (stale-state) (F245). Creates a
  // superseding version; name and currency copy forward from the prior
  // card unchanged — update accepts neither as a parameter. The prior
  // card's is_active becomes false (a permitted lifecycle-only change,
  // not an edit to its content) — see G02, G08.
rateCard.list(workspaceId)                  -> RateCard[]
rateCard.getPreview(rateCardId, seniority)  -> { hourlyRate, dailyRate, monthlyRate }
  // Computes line_id = deterministicUuid(`rate_card_line:${rateCardId}:${seniority}`)
  // and reads that one node id (F247) — never a scan. No matching line reads
  // back nothing, matching "resolution falls through."
rateCard.usageCount(rateCardId)             -> { activeAssignments }
  // Counts incoming governed_by edges with effective_to: null (F243), never
  // an Assignment scan

assignment.setRateCard(assignmentId, rateCardId)               -> { effectiveBillingRate }
assignment.setRateOverride(assignmentId, hourly, reason)       -> { effectiveBillingRate }
assignment.clearRateOverride(assignmentId)                     -> { effectiveBillingRate }
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | RateCard and RateCardLine are Finance-restricted, Tier 1 |
| G02 | Updating rates creates a new RateCard linked by `supersedes`. The prior node's content (name, currency, lines) is never edited in place; its `is_active` lifecycle flag is the one permitted exception, set to `false` on supersession (F245) |
| G03 | Assignments retain their `rate_card_id` through an update. No bulk migration occurs; an assignment moves to a newer version only through an explicit `assignment.setRateCard` |
| G04 | `effective_billing_rate` resolves in strict order: override, matching line, `billing_rate_default`. Computed at write time, never recomputed retroactively |
| G05 | At most one line per seniority level per card. A duplicate write replaces the rate rather than creating a second line |
| G06 | A rate card's `currency` defaults from the Entity's `default_currency` per [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] and is never inferred from the workspace |
| G07 | Assignment's `governed_by` edge to RateCard is written alongside its scalar `rate_card_id` field by `assignment.setRateCard`/`assignment.create`, managed manually (close-then-open, no `historyPolicy`) the same way `governed_by_calendar` is managed. `rateCard.usageCount` and the version-history active-assignment count resolve via `incoming(..., "governed_by")`, never an Assignment scan (F243) |
| G08 | `rateCard.update` requires `expectedVersion`, checked first (`stale-state` before anything else). `name` and `currency` are never accepted by `update`; the new version copies both from the prior card (F245) |
| G09 | The `governed_by` edge (G07) is written exclusively in the mutation's server-side `apply()` step, never by an optimistic handler. `assignment.create`'s optimistic handler is unchanged from Stage 13: `rate_card_id` writes as a plain scalar, `effective_billing_rate` always defaults to `billing_rate_default` locally, corrected by the server's response once confirmed — `assignment.create` needs no conditional `onlineOnly` behavior (F246) |
| G10 | `RateCardLine.line_id` is a deterministic, UUID v4-shaped id derived from `(rate_card_id, seniority_level)`, not a random UUID v4 — computed server-side in `rateCard.create`/`update`'s `apply()`. `rateCard.getPreview` and `resolveAssignmentRate` compute the same id and read it as a single-id `readProtected` lookup; no edge and no index are added for RateCardLine (F247) |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VRS-F006-S01 | RateCard and RateCardLine schema and versioning | Data |
| VRS-F006-S02 | Rate card management surface | UI |
| VRS-F006-S03 | Assignment rate selection and override | Logic |
| VRS-F006-S04 | Resolution engine | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a rate card with a Senior line at 120 per hour
**WHEN** an Assignment for a Senior employee selects it
**THEN** `effective_billing_rate` resolves to 120 and is visible on the Assignment at Tier 0

---

**GIVEN** an Assignment with no rate card
**WHEN** it is saved
**THEN** `effective_billing_rate` falls back to the employee's `billing_rate_default`, converted from daily to hourly at 8 hours

---

**GIVEN** an Assignment carries an override of 140 with a reason
**WHEN** the rate resolves
**THEN** 140 is used regardless of card selection, and the override indicator appears on the Bench Forecast hover card

---

**GIVEN** a rate card is updated
**WHEN** the change saves
**THEN** a new RateCard exists linked by `supersedes`, existing Assignments keep their original card and resolved rate, and only new or explicitly re-pointed Assignments resolve against the new version

---

**GIVEN** a Manager with no finance role views their report's Assignment
**WHEN** the detail loads
**THEN** `effective_billing_rate` is visible as Tier 0, and the underlying RateCard, its other lines and its name are structurally absent

---

**GIVEN** a workspace with a UK entity in GBP and a Pakistan entity in PKR
**WHEN** a rate card is created against each
**THEN** each defaults to its entity's currency, with no workspace-level currency assumed

---

## Non-Functional Requirements

- Rate preview resolves within 200ms of selecting a card and seniority level
- `effective_billing_rate` recomputation completes atomically with the Assignment write, never as a separate eventually-consistent step
- RateCard and RateCardLine are Tier 1 — fetched on demand by Owner, Finance Admin and HR Admin roles through the permission interceptor, and never cached or persisted on any device (F244)
- No mechanism exists, or should exist, for a rate card update to alter an already-resolved rate on an existing Assignment

---

## Security Considerations

- **RateCard follows the Finance-restricted default with no override.** Owner, HR Admin and Finance Admin full; Manager and Team Member none. No new permission row was required.
- **`effective_billing_rate`'s Tier 0 placement is a deliberate narrow exception**, not a precedent for exposing Tier 1 data generally. It exposes one resolved number, mirroring `billing_rate_default`, and never the card's name, structure or other lines.
- **In a very small agency a billing rate approximates a compensation disclosure.** A two-person studio's rate card and its payroll are close to the same document. This is why the card itself is Tier 1 rather than Tier 0, even though its resolved output is not.

---

## Out of Scope

- **Client-facing quoting, proposals or externally presented rates** — permanently [[Vulto Accounts]]' territory
- **Multi-currency roll-up or exchange conversion** — [[VRS-F064_Multi-Currency_Payroll|VRS-F064]]. Currency is stored per card; converting across them is not solved here
- **Automatic migration of assignments to a newer version** — deliberate, per G03. Migration is explicit and visible, never silent
- **Cost rates** — this feature prices what the agency charges, not what a person costs. Cost derives from compensation per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]]

---

## Decisions Recorded

**Currency defaults from Entity, not workspace.** The previous draft defaulted to a workspace primary currency, which is wrong for exactly the multi-entity agency this product targets — a UK Ltd and a Pakistan Pvt Ltd do not bill in the same currency, and defaulting both to one guarantees a mis-denominated card on first use.

**The scope note is folded into Context.** It was previously a preamble explaining what this document chose not to build, which is reasoning that belongs in the document's own framing rather than as an apology before it.

**`rateCard.usageCount` is added.** Editing a card that prices forty live assignments and one that prices none are different decisions, and the previous interface gave a finance admin no way to tell them apart before acting.

**The resolved open item is retired.** [[VRS-F005_The_Bench_Forecast|VRS-F005]] and [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] both prefer `effective_billing_rate` where an Assignment provides it. That is now stated in those documents as behavior rather than recorded here as a resolution.

---

## Related Notes

- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the Assignment this feature prices
- [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] — the entity supplying default currency
- [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] — bench cost, which consumes the resolved rate
- [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] — the Cross-Suite Node Ownership making this a bootstrap

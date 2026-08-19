---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-08-08]]"
Product Phase:
  - Architecture
Feature Type:
  - Experience
aliases:
  - VPS-D004
---

# VPS-D004 — Application Shell, Navigation and System States

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-D001_Design_Foundations|VPS-D001]], [[VPS-D002_Component_Library|VPS-D002]], [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]], [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the permission model whose three states this document is obliged to make visible)
**Blocks:** The Interface Specification section of every feature document

This document is the single source of truth for the frame every screen in every application sits inside, the navigation between screens, and — most consequentially — the visual treatment of the three states [[VPS-A004_Graph_Permission_Layer|VPS-A004]] requires never be conflated.

**The shell is identical across applications.** Switching from Roster to Projects changes what is in the content region and nothing else, which is what makes a suite feel like one product rather than a bundle.

---

## The shell

Three regions, fixed for the life of the product.

```
┌────────────┬──────────────────────────────────────────┬─────────────┐
│            │  Page header      title · actions        │             │
│  Sidebar   ├──────────────────────────────────────────┤   Panel     │
│   200px    │                                          │   360px     │
│            │  Content                                 │  contextual │
│            │                                          │             │
│            │                                          │             │
│  ─────────  │                                          │             │
│  Status     │                                          │             │
└────────────┴──────────────────────────────────────────┴─────────────┘
```

There is no top-level global header bar. The horizontal band across the top of most business software carries a logo, a search field and an avatar, and in this product all three live elsewhere: workspace and account controls behind the workspace trigger in the sidebar, and search behind `Cmd+K`. Removing it returns vertical space to the Bench Forecast.

### Sidebar

200px, `bg-canvas`, no persistent right border, collapsible to 48px icons via `Cmd+\`.

Workspace trigger at the top, showing name and entity where [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] has more than one. It opens one popover containing the current user's identity and role, the device-local theme preference, workspace settings for Owner and Admin roles, workspace switching, and sign out. Account controls are not duplicated at the foot. Navigation sits beneath, grouped by role relevance rather than by feature taxonomy — a Team Member and an Owner see genuinely different sidebars, because a navigation listing destinations a person cannot open is a navigation that teaches them to ignore it.

Navigation items are `label`, 32px tall, `radius-md`, with a 16px Lucide icon. The active item takes `bg-active` with `text-primary`. Counts appear as a right-aligned `micro` figure in `text-tertiary`, and only where the count implies an action the person should take. Group headers use `micro`, uppercase and `text-tertiary`; they render only when the role's navigation contains at least two non-empty groups, so a small role-specific sidebar is not divided for ceremony.

At the foot: the sync status indicator only. It remains visible because sync health is workspace state rather than a menu preference.

### Navigation architecture

The sidebar contains **durable work areas, not features**. A feature earns a primary destination only when at least one role initiates work there weekly and the surface owns a multi-record collection. This prevents the feature register from becoming the navigation and gives future features an explicit placement test.

Every surface is placed through this order:

1. **Primary destination** — recurring work over a collection of records.
2. **Sub-screen or contextual panel** — scoped to a person, entity, project, or record already owned by a primary destination.
3. **Inbox** — event-driven work that begins because something needs the current user.
4. **Workspace Settings** — behavior, roles, integrations, thresholds, imports, or policy controlled by an administrator.
5. **Command palette** — rare direct lookup or navigation that does not deserve permanent space.

The complete Owner navigation is fixed in this order:

| Group | Destination | Owns |
|---|---|---|
| Overview | **Home** | The role-aware starting surface: employee self-service for Team Members, the action queue for Managers, and the relevant operational overview for administrative roles |
| Overview | **Inbox** | Every event-driven action and notification, per [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] |
| Planning | **Bench Forecast** | Named-person capacity, assignments, Ghost Resources, conflicts, revenue gaps, and contextual matching |
| Planning | **Hiring** | Headcount, requisitions, candidates, interviews, offers, talent pools, referrals, and hiring checks |
| People | **People** | Directory, employee profile, organizational chart, contractors, skills matrix, and person-scoped facts |
| People | **Development** | Reviews, career paths, goals, certifications, and training |
| People | **People Ops** | Onboarding, departures, contracts, documents, assets, policies, right-to-work records, and formal cases |
| Work | **Timesheets** | Time entry and classification. Utilization pulse remains contextual to a person and appears in Reports as an aggregate |
| Work | **Leave** | Personal requests, team approvals, balances, and policy interpretation |
| Work | **Expenses** | Personal submission and manager approval |
| Finance & insight | **Payroll** | Payroll, rate cards, compensation changes and bands, tax, currencies, contractor invoices, and disbursement |
| Finance & insight | **Reports** | Capacity planning, people analytics, intelligence, retention, hiring quality, costs, benchmarks, and exports |

Workspace Settings, reached from the workspace trigger, owns members and roles, entities and calendars, workspace configuration, setup and import, integrations and API access, custom fields, data governance, retention, and erasure. Search remains behind `Cmd/Ctrl + K`. Mobile shell behavior, sync, audit, encryption, notifications, and the suite graph bridge are platform capabilities rather than destinations.

**Sub-screen placement is stable even when a feature grows.** Billable versus non-billable pulse is a profile fact and a Reports aggregate, not a thirteenth destination. Assets are person-scoped in the profile and managed as a register within People Ops. Policies are administered in People Ops and acknowledged from Home or Inbox. The same rule applies to every future feature.

### Home's role variants

**Home is always called Home** — in the sidebar, in the route, and in the page title. No variant of it is titled after the role that sees it. A title naming a role the viewer does not hold is how a reader concludes they are on the wrong screen, and it is the specific defect FDN-41 found on the rendered prototype, where one destination carried three different names.

The variants differ in **composition**, not in the same list filtered differently:

| Role | Home leads with | Owned by |
|---|---|---|
| Team Member | Self-service: their own time, leave, documents and acknowledgements | Not yet specified; no feature document claims it |
| Manager | The action queue, with a team overview supporting it | [[VRS-F049_Manager_Dashboard\|VRS-F049]] |
| HR Admin, Finance Admin, Owner | The operational overview for their remit, with an action queue beneath it | This document |

The distinction is real rather than cosmetic. A manager's morning is a list of things waiting on them, so the queue leads. An administrative role's first question is how the business stands, so the figures lead and the queue sits below them. Putting the queue first for every role is what made the administrative Home read as a manager's screen regardless of what it was called.

**Every figure on Home is computed from the viewer's own cohort**, never a workspace-wide aggregate filtered after the fact — the same rule [[VRS-F005_The_Bench_Forecast|VRS-F005]] holds for the Manager Bench Forecast, and for the same reason: a total that was summed over people the viewer cannot see is wrong even when the rows beneath it are correct.

**Where a figure appears on both Home and its owning feature, it is derived once.** The administrative Home's utilization, bench exposure and unrecovered cost are read from the Bench Forecast's own derivation rather than recomputed here, so the two surfaces cannot state different numbers for the same fact.

### Role filtering

The Owner sees the complete map above. Every other role receives a subset in the same order; empty groups disappear. Composite roles receive the union. The navigation is permission-filtered before rendering, so it never exposes a destination only to replace it with a permission wall.

| Destination | Team Member | Manager | HR Admin | Finance Admin | Owner |
|---|:---:|:---:|:---:|:---:|:---:|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ |
| Inbox | ✓ | ✓ | ✓ | ✓ | ✓ |
| Bench Forecast | — | Direct reports | ✓ | ✓ | ✓ |
| Hiring | — | ✓ | ✓ | — | ✓ |
| People | ✓ | ✓ | ✓ | ✓ | ✓ |
| Development | Own | Direct reports | ✓ | — | ✓ |
| People Ops | — | — | ✓ | — | ✓ |
| Timesheets | Own | Direct reports | ✓ | ✓ | ✓ |
| Leave | Own | Direct reports | ✓ | Own | ✓ |
| Expenses | Own | Direct reports | ✓ | ✓ | ✓ |
| Payroll | — | — | — | ✓ | ✓ |
| Reports | — | Team scope | ✓ | ✓ | ✓ |

`Own`, `Direct reports`, and `Team scope` describe query scope, not separate screens. Permission enforcement remains exclusively in [[VPS-A004_Graph_Permission_Layer|VPS-A004]]; the sidebar consumes the resulting capabilities and never reimplements them.

### Page header

48px, containing the page title at `h2`, an optional `small` subtitle carrying the most useful context for that screen, and a right-aligned action slot with at most one `primary` button. Title and subtitle share one baseline rather than stacking; the subtitle truncates before displacing the action. Breadcrumbs appear only where a screen is genuinely nested more than one level, which in this product is rare.

### Content

Fluid width with a 1440px maximum, `6` horizontal padding. The Bench Forecast and other timeline surfaces are exempt from the maximum and run to the full viewport, because horizontal space on those screens is time, and time is the thing the user came for.

### Panel

The 360px contextual surface specified in [[VPS-D002_Component_Library|VPS-D002]]. Opens on selection, persists across selections within a screen, closes on `Escape`. Panel state is remembered per screen for the session, so a user who works with the panel open is not made to reopen it each time they navigate.

The workspace inset is `bg-subtle`; page headers, controls, assignment bars and contextual panels use `bg-surface` or `bg-raised` within it. Below the side-by-side breakpoint the Panel overlays the timeline at the highest application layer and takes `overlay` elevation, so sticky timeline dates cannot paint over it. At the wider side-by-side layout it returns to raised elevation.

---

## The Inbox

One navigation destination deserves separate specification, because it is the difference between a product with fourteen alert-generating features and a product a person can actually keep up with.

[[VPS-F003_Notification_and_Alert_Center|VPS-F003]] owns the notification model. This document owns the surface: a single Inbox, reachable at `G` then `I`, presenting every item awaiting the current user across every feature in one prioritized queue — leave approvals, payroll variance flags, conflict warnings, bench alerts, expiring certifications, probation reviews, signature requests.

Items are grouped by urgency, not by originating feature. A person does not think *I should check the leave module*; they think *what needs me today*. Grouping by source would reimpose the software's structure on a question the person asked about their own day.

Every Inbox item is actionable in place. Approving leave, dismissing a bench alert or acknowledging a variance happens from the Inbox without navigation, and only genuinely complex items route to their own screen. An inbox that is merely a list of links to elsewhere is a list of chores.

---

## The locked shell

A whole-application condition, distinct from the three region-level states below. Those describe a piece of content inside an already-rendered shell; this describes the shell being unable to render anything yet, because the local store [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s F106 ruling requires stays sealed until a server-authorized online unlock succeeds.

**When it renders.** Immediately on cold start — including a Worker restart from a tab reload, per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]'s current-process clarification — before the sidebar, page header, panel or any content mounts, whenever that unlock has not yet succeeded in this process. Nothing else on screen: no skeleton, no Empty state, no Restricted placeholder, because nothing has been fetched yet to be empty or restricted.

**What it shows.** Full-bleed, centered, no illustration, `body` text stating plainly what is happening and why — *"Reconnect to continue. Vulto needs to verify your session before opening your workspace."* Not a spinner: a spinner implies imminent completion, and the wait is indefinite while offline. A `primary` **Retry** action, and, only when the device is offline, that fact named directly rather than implied by the retry failing silently.

**Locked and Offline are different conditions.** A device can be Offline while already unlocked — full product, the `Offline` SyncStatus state, no interruption. An already-unlocked device that later loses connectivity never shows Locked.

**Locked has two entries, not one.** *Cold-start locked* is the case above: no unlock has completed in this process yet, and nothing has mounted. *Mid-session locked* is a store that was unlocked in this process and has since been sealed again — which happens when the role-refresh checkpoint returns an authoritative denial, per F127. This document originally defined Locked as "no unlock has completed in this process yet," which excluded the second case by wording rather than by decision: when this section was written nothing could seal a live store, and F127's live role refresh introduced that afterwards. Recorded as F146.

**What mid-session locked shows.** The same full-bleed treatment, and deliberately not a variant of it — the store is sealed, so every region behind it is unreadable and there is nothing legitimate left to render around. Two differences from cold start, both because content was already on screen:

- **Unsaved work in progress is not silently discarded by the transition.** Anything the shell holds that has not reached the local store is the shell's to preserve or to tell the user about; the locked shell must not be the first thing a user learns about losing it.
- **The copy names the transition rather than implying a fresh start.** *"Vulto has locked. Your session needs to be verified again before your workspace reopens."* The cold-start wording — *"before opening your workspace"* — reads as a startup step and is wrong for a workspace the user already had open.

**Only an authoritative denial produces this.** A server that cannot answer — a timeout, a 500-series response, a rate limit, an unreachable network — is not a lock and must not render as one, per F148. Those keep the shell exactly as it is and resolve on the next answer the server can give. Rendering an outage as Locked would tell a user their access had been withdrawn every time a server had a bad minute.

**A denied revocation and an unreachable server render identically.** The workspace-session guard's failure is non-enumerating by design — telling a specifically revoked user that they were revoked, rather than showing the same retry state as any other failure, would leak exactly the fact non-enumeration exists to protect.

**Non-enumeration governs what is rendered, never what the client concludes.** These are different questions, and conflating them produced a real defect (F148): the client treated every unreachable-server answer as a revocation because both render the same. A device may distinguish a denial from a failure precisely enough to decide whether to seal its own store, while still rendering both identically when it does show Locked.

**A denied revocation and an unreachable server render identically.** The workspace-session guard's failure is non-enumerating by design — telling a specifically revoked user that they were revoked, rather than showing the same retry state as any other failure, would leak exactly the fact non-enumeration exists to protect.

**No feature may invent a fifth state, or use this treatment for anything but this exact condition.** This section governs the shell before content mounts; the three system states that follow continue to govern regions once content is streaming in.

---

## The three system states

[[VPS-A004_Graph_Permission_Layer|VPS-A004]] establishes that three conditions must never be conflated, and specifies no visual treatment for any of them. That gap sits directly on top of a security requirement: a user who cannot distinguish *you may not see this* from *this has not arrived yet* will either assume a permission problem is a bug and escalate, or assume a sync delay is a permission wall and stop asking. This document closes it.

The three are distinguished by border treatment, which makes them identifiable at a glance without reading, and each carries a different affordance because each has a different remedy.

### Syncing — no border, filled, temporary

Data that exists but has not yet materialized on this device.

Rendered as a Skeleton per [[VPS-D002_Component_Library|VPS-D002]]: a static `bg-subtle` block in the shape of the incoming content, no border, no animation. It resolves on its own, typically within the sync budget, and requires nothing from the user. The sidebar sync indicator shows the workspace-level state; individual skeletons do not repeat that information.

**Never accompanied by explanatory text.** Text implies a condition worth understanding. This one resolves before it is read.

### Aged out — dashed border, actionable

Data outside the local retention window: real, readable, present on the server, and simply not cached here. Most commonly Tier 1 financial records beyond the rolling window defined in [[VPS-A003_Unified_Sync_Architecture|VPS-A003]].

Rendered with a 1px dashed `border-strong`, `bg-subtle`, and a `secondary` button reading **Fetch**. Copy states the fact plainly: *"Outside your local history window."* On fetch, the content replaces the container and remains locally cached for the retention period.

This uses the dashed-border rule from [[VPS-D001_Design_Foundations|VPS-D001]] — a placeholder for something not present — which is the same convention Ghost Resources use, and correctly so: both mean *expected, not here yet*.

### Restricted — solid border, static, or structurally absent

Data the current user's role does not permit.

Two treatments, and the choice between them is a security decision rather than a stylistic one.

**Structurally absent** where the existence of the data is itself sensitive. Tier 3 wellness content per [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]], and individual pulse responses per [[VRS-F048_Employee_Pulse_Surveys|VRS-F048]], render as nothing at all: no container, no label, no gap. A redaction marker would leak precisely what the tier exists to hide.

**Visibly restricted** where the existence of the data is unremarkable but its content is not — a salary field, a Requisition's budget line, a Contract's own commercial terms once its identifying half is already visible. Rendered with a solid 1px `border-default`, `bg-subtle`, a 16px lock icon and `small` `text-tertiary` copy naming the role that would have access: *"Visible to Finance Admin."* Naming the role tells the person who to ask, which converts a dead end into a next step.

**A document in the vault is a different case, and stays structurally absent** even though this section's examples sound adjacent to it. A Contract *node* is guaranteed — every active employee has at least one, by definition of being employed — so a lock on its commercial terms discloses nothing. A specific uploaded *Document* in [[VRS-F022_Encrypted_Document_Vault|VRS-F022]]'s vault is not guaranteed the same way: which document types exist for a given person is itself informative, and [[VRS-F022_Encrypted_Document_Vault|VRS-F022]] already reasons through why a grayed-out vault row is the wrong treatment — *"the existence of a signed contract for a specific person is itself an inference a Manager should not draw."* Two different objects, correctly opposite treatments; not a contradiction between this section and that one, per [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s rule for which is which.

**Where the reader is excluded as a person rather than by role, the copy names the exclusion instead of a role.** [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s subject exclusion removes the person a record concerns from its readers, including where they hold a role that otherwise reads it. *"Visible to Owner and HR Admin"* rendered to an Owner is not a next step, it is a contradiction. The copy states the reason: *"Restricted — this record concerns you."*

Naming the reason rather than a role is right for the same purpose the role-naming convention serves. There is no one to ask, and implying otherwise would send someone to request access to a case about themselves.

**No action is offered.** There is no request-access button anywhere in this product. Access is granted by role, roles are managed in [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]], and a button implying otherwise would manufacture a workflow that does not exist.

Every restricted render, of either kind, writes to [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s audit log as a permission denial. The user is not told this, because telling them would be noise; the record exists for the audit, not the interface.

### The rule

| State | Border | Fill | Text | Action | Resolves by |
|---|---|---|---|---|---|
| Syncing | none | `bg-subtle` | none | none | Waiting |
| Aged out | 1px dashed `border-strong` | `bg-subtle` | *"Outside your local history window."* | **Fetch** | Fetching |
| Restricted | 1px solid `border-default` | `bg-subtle` | *"Visible to {role}."* | none | Role change |
| Restricted, subject-excluded | 1px solid `border-default` | `bg-subtle` | *"Restricted — this record concerns you."* | none | Never, while they are the subject |
| Restricted, sensitive | — | — | — | — | Nothing rendered |

No feature may invent a fourth state, and no feature may substitute one of these for another. A feature that renders a permission denial as a skeleton has told the user to wait for something that will never arrive.

---

## Empty states

Distinct from all three above, and the most commonly mishandled screen in business software.

An empty state means the query succeeded and the answer is none. It is rendered as `body` text naming what would appear here, plus a `secondary` button that creates the first one. No illustration, no icon, no centered box, no encouraging exclamation.

The copy names the thing and the action: *"No one is on the bench in this window."* *"No leave requests waiting on you."* Where empty is genuinely good news — nobody on the bench, nothing awaiting approval — the copy says so plainly rather than treating absence as a deficiency to be corrected.

**Empty is a statement about data, and it is only ever that.** A feature the viewer's plan does not include, a destination not yet built, a surface awaiting a permission — none of these are empty. They are not the answer *none*; they are the absence of a question. Rendering them as Empty tells the viewer a working feature is sitting idle, which is false and, for anything a customer might be sold, misleading.

This is recorded because the prototype's placeholder destinations were specified to compose the Empty treatment, and building it showed that doing so would contradict the same issue's own requirement that no placeholder be mistakable for a built-but-empty feature. **The correct treatment for "this does not exist yet" is the dashed placeholder language** — the one this design system already uses for a Ghost Resource, a dashed Avatar and a dashed Badge, applied at the scale of a screen. A dashed outline around the region says the area is reserved; a paragraph of body text says a query returned nothing.

---

## Error states

Errors do not apologize and are never vague. Every error names what happened, why, and what to do. They are written in the interface's voice, not a person's: *"Assignment overlaps an existing commitment"*, never *"Sorry, we couldn't save that"*.

Where an error has a remedy the user can take, the remedy is a button beside the message. Where it does not, the error says so and gives whatever the user needs in order to ask someone who can — a record identifier, a role name, a timestamp.

---

## Related Notes

- [[VPS-D001_Design_Foundations|VPS-D001]] — the tokens this shell is built from
- [[VPS-D002_Component_Library|VPS-D002]] — the components arranged within it
- [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] — how it responds to keyboard and motion
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the permission model whose three states this document makes visible
- [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] — the notification model behind the Inbox

---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-08-07]]"
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
│   240px    │                                          │   360px     │
│            │  Content                                 │  contextual │
│            │                                          │             │
│            │                                          │             │
│  ─────────  │                                          │             │
│  Status     │                                          │             │
└────────────┴──────────────────────────────────────────┴─────────────┘
```

There is no top-level global header bar. The horizontal band across the top of most business software carries a logo, a search field and an avatar, and in this product all three live elsewhere: workspace and account controls behind the workspace trigger in the sidebar, and search behind `Cmd+K`. Removing it returns vertical space to the Bench Forecast.

### Sidebar

240px, `bg-canvas`, 1px right border, collapsible to 48px icons via `Cmd+\`.

Workspace trigger at the top, showing name and entity where [[VRS-F003_Multi-Entity_and_Jurisdiction_Foundation|VRS-F003]] has more than one. It opens one popover containing the current user's identity and role, the device-local theme preference, workspace settings for Owner and Admin roles, workspace switching, and sign out. Account controls are not duplicated at the foot. Navigation sits beneath, grouped by role relevance rather than by feature taxonomy — a Team Member and an Owner see genuinely different sidebars, because a navigation listing eleven sections a person cannot open is a navigation that teaches them to ignore it.

Navigation items are `body-medium`, 32px tall, `radius-md`, with a 16px Lucide icon. The active item takes `bg-selected` with `text-brand`. Counts appear as a right-aligned `micro` figure in `text-tertiary`, and only where the count implies an action the person should take.

At the foot: the sync status indicator only. It remains visible because sync health is workspace state rather than a menu preference.

### Page header

48px, containing the page title at `h2`, an optional `small` subtitle carrying the most useful context for that screen, and a right-aligned action slot with at most one `primary` button. Breadcrumbs appear only where a screen is genuinely nested more than one level, which in this product is rare.

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

**Visibly restricted** where the existence of the data is unremarkable but its content is not — a salary field, an HR-restricted contract. Rendered with a solid 1px `border-default`, `bg-subtle`, a 16px lock icon and `small` `text-tertiary` copy naming the role that would have access: *"Visible to Finance Admin."* Naming the role tells the person who to ask, which converts a dead end into a next step.

**No action is offered.** There is no request-access button anywhere in this product. Access is granted by role, roles are managed in [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]], and a button implying otherwise would manufacture a workflow that does not exist.

Every restricted render, of either kind, writes to [[VPS-F004_Silent_Audit_Log|VPS-F004]]'s audit log as a permission denial. The user is not told this, because telling them would be noise; the record exists for the audit, not the interface.

### The rule

| State | Border | Fill | Text | Action | Resolves by |
|---|---|---|---|---|---|
| Syncing | none | `bg-subtle` | none | none | Waiting |
| Aged out | 1px dashed `border-strong` | `bg-subtle` | *"Outside your local history window."* | **Fetch** | Fetching |
| Restricted | 1px solid `border-default` | `bg-subtle` | *"Visible to {role}."* | none | Role change |
| Restricted, sensitive | — | — | — | — | Nothing rendered |

No feature may invent a fourth state, and no feature may substitute one of these for another. A feature that renders a permission denial as a skeleton has told the user to wait for something that will never arrive.

---

## Empty states

Distinct from all three above, and the most commonly mishandled screen in business software.

An empty state means the query succeeded and the answer is none. It is rendered as `body` text naming what would appear here, plus a `secondary` button that creates the first one. No illustration, no icon, no centered box, no encouraging exclamation.

The copy names the thing and the action: *"No one is on the bench in this window."* *"No leave requests waiting on you."* Where empty is genuinely good news — nobody on the bench, nothing awaiting approval — the copy says so plainly rather than treating absence as a deficiency to be corrected.

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

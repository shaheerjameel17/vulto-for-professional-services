---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - MVP
Feature Type:
  - Platform
aliases:
  - VPS-F003
---

# VPS-F003 — Notification and Alert Center

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] (User), [[VPS-A002_Master_Graph_Schema_Definition|VPS-A002]] (Notification and the `delivered_to` edge), [[VPS-A004_Graph_Permission_Layer|VPS-A004]] (the recipient-only access shape), [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] (email delivery and the job queue), [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] (the Inbox surface)
**Blocks:** Nothing structurally. Every subsequent alert-producing feature registers a subscription rule here rather than building its own delivery mechanism.

This document is the single source of truth for this feature.

---

## What this feature is not

It is not a place where any watched feature gets re-decided or re-permissioned.

Every boundary this project has built carefully — [[VRS-F053_Retention_Risk_Indicator|VRS-F053]]'s Owner-and-HR-Admin-only retention signal, [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]]'s Manager-excluded departure data, [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s k-anonymity threshold — has to survive being pushed through a unified feed exactly as strictly as it survives being read from its own source.

**A notification that says the wrong thing to the wrong person is the same leak as a wrong permission row, delivered with worse timing.** Every subscription rule below is a security decision, not a copy-editing one.

---

## What It Is

A single, cross-role, in-app notification feed, surfaced through the Inbox specified in [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]. Every feature's alerts, approvals and reminders continue to work exactly as specified on their own screens; this adds a second surface alongside each, never instead of it.

---

## Problem It Solves

A dozen features each correctly decide who should see what, and several compose that into a view. But a view requires opening something.

A useful notification system tells a person the moment something needs them — a leave request awaiting their decision, an approaching burnout signal, a certification about to expire — without them remembering to look. Without this feature that immediacy either does not exist, or, worse, **every alert-producing feature quietly builds its own small inconsistent version of it.**

That second outcome is why this feature moved into MVP. Twelve MVP features fire alerts. Building their common surface last means building twelve bespoke ones first.

---

## The subscription registry

Each rule is this feature's own reactive trigger, watching the same write event the source feature's logic already reacts to. **No source feature is corrected to call into this one.** Each continues exactly as documented, and this feature independently produces a Notification alongside whatever that feature already does.

**The registry is open, and it spans applications.** It ships with rules for the features that exist at MVP, and every subsequent alert-producing feature — in any application — adds its own rule here as part of its own implementation. Adding a rule is not a change to this document's design; it is the intended way to extend it, per [[VPS-000_Documentation_Standard|VPS-000]]'s Standing Rule 7.

**One Inbox, every application.** A leave approval from Roster and a deliverable awaiting client review from [[Vulto Projects]] arrive in the same queue, grouped by urgency rather than by source. A person does not think *I should check the projects module*; they think *what needs me today*, and an Inbox per application would reimpose the software's structure on that question.

### Rules registered at MVP — Vulto Roster

| Source event | Recipient | Boundary respected |
|---|---|---|
| [[VRS-F012_Revenue_Gap_Alert|VRS-F012]] RevenueGapAlert created or escalated | The employee's manager | Tier 0, already manager-visible |
| [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] TimesheetAnomalyFlag created | The employee's manager | Matches the Manager-Full override |
| [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] timesheet not submitted, end of week | The employee themselves | Their own record |
| [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] LeaveRequest created | The employee's manager | Matches the manager-scoped approval role |
| [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] LeaveRequest approved or rejected | The requesting employee | Full on their own request |
| [[VRS-F021_E-Signature_Native|VRS-F021]] signature requested | The signatory | Participant-scoped |
| [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] probation review due | The employee's manager and HR Admin | Probation only, never a notice-period event |
| [[VRS-F023_Probation_and_Notice_Period_Tracker|VRS-F023]] Departure created or completed | **Owner and HR Admin only** | Never a manager or a peer, matching Departure's Tier 2 class precisely |
| [[VRS-F024_Structured_Onboarding_Workflow|VRS-F024]] onboarding task nearing due | The assigned person | Uses the task's own assignee |
| [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] provisional holiday entering its confirmation window | HR Admin | Configuration, not personal data |
| [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]] weekly overcommitment sweep result | Owner and HR Admin | Matches the admin list's own scope |

### Rules registered by later features

Each is added by the feature that produces it, with the boundary it must respect stated at that time. The three worth naming now, because they are the ones most likely to be widened by an implementer reaching for convenience:

**[[VRS-F053_Retention_Risk_Indicator|VRS-F053]] FlightRiskSignal** — Owner and HR Admin only. Never a manager, regardless of reporting line, and never the employee. This is the single boundary this document is most careful not to widen.

**[[VRS-F051_Team_Capacity_Planner|VRS-F051]] capacity shortfall** — Owner, Finance Admin and HR Admin. The message carries the skill category and quarter only, never a pipeline-weighted figure, because that figure is never computed outside those roles anywhere in this product.

**[[VRS-F048_Employee_Pulse_Surveys|VRS-F048]] and [[VRS-F078_Mental_Health_and_Wellness_Layer|VRS-F078]]** — a survey opening is a broadcast carrying no individual response. **No Tier 3 record ever produces a notification to anyone but its owner**, and no aggregate below [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s threshold produces one at all.

---

## Interface Specification

### Screens

| Surface | Location | Purpose |
|---|---|---|
| Inbox | Content, per [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] | The prioritized queue |
| Unread indicator | Sidebar | Count of items awaiting action |
| Preferences | Section in [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] | Per-category muting |

### Layout and components

[[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] owns the Inbox surface; this feature owns what appears in it.

Items are grouped by **urgency, not by originating feature**. A person does not think *I should check the leave module*; they think *what needs me today*. Grouping by source would reimpose the software's structure on a question about the person's day.

Three groups: **Needs you** (ActionNeeded, undismissed), **Today**, and **Earlier**. Within each, ordered by created time descending.

Each item is a row: an icon indicating the source type, the message at `body`, the relative time at `small` in `text-tertiary`, and inline actions where the item is actionable. **Approving leave, dismissing a bench alert or clearing a flag happens from the Inbox without navigation.** Only genuinely complex items route to their own screen. An inbox that is a list of links to elsewhere is a list of chores.

The unread indicator counts **ActionNeeded items only**. Counting informational items produces a number that never reaches zero, and a badge that never clears is a badge people stop reading.

### Keyboard

| Key | Action |
|---|---|
| `G` `I` | Go to Inbox |
| `J` / `K` | Move between items |
| `Enter` | Perform the item's primary action |
| `E` | Mark read and archive |
| `Escape` | Return to the previous screen |

### System states

| State | Treatment |
|---|---|
| Syncing | Items render from local state. New arrivals appear without a reload |
| Restricted | Not applicable — a user only ever sees their own notifications |
| Empty | *Nothing needs you right now.* Stated as the good news it is, with no illustration |
| Error | An action failing from the Inbox states the reason and leaves the item in place |

### Responsive

Full functionality to 768px. Below that, [[VPS-F011_Mobile-Native_Experience|VPS-F011]] is the intended experience, and the web view collapses inline actions to a single primary action per item.

---

## Technical Architecture

### The Notification schema

```
notification_id:  UUID v4
workspace_id:     UUID — the workspace the event occurred in. A User may hold
                  membership in more than one, so this scoping matters
recipient_user_id: UUID, FK to User. `delivered_to` connects the same
                  relationship as a first-class edge
source_node_type: string — the node type whose creation or change produced this
source_node_id:   UUID — for deep-linking
category:         enum: ActionNeeded, Informational
message:          string — a short human-readable summary
read_at:          timestamp, nullable
dismissed_at:     timestamp, nullable

— Universal Node Conventions per VPS-A002 —
```

`category` is deliberately a two-value enum. Finer categorization comes from `source_node_type`, not from a second growing enum that needs editing every time an alert-producing feature is added.

### Preferences

A minimal model, held on WorkspaceMembership rather than as its own node:

```
muted_source_types: string[] — source_node_types this user has muted
```

**Only `Informational` notifications may be muted.** An `ActionNeeded` item represents something waiting on this person, and allowing it to be silenced produces a workspace where a leave request sits unapproved for a fortnight because someone muted a category in their first week.

This is a smaller preference model than most products ship, and deliberately so. With a dozen sources at MVP and thirty by Mature, no preferences at all produces noise; full per-source frequency control produces a settings screen nobody configures correctly.

### Delivery channels

**In-app is the canonical channel.** Every notification appears in the Inbox.

**Email** is delivered through [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]]'s `EmailService` for `ActionNeeded` items only, and carries no Tier 1, Tier 2 or Tier 3 content — a subject, a one-line summary and a link into the product, where permission is actually enforced. Per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]], every action reachable from an email is reachable from the Inbox.

**Push** is registered by [[VPS-F011_Mobile-Native_Experience|VPS-F011]] with deliberately content-free payloads. A lock-screen preview naming an employee and a burnout signal is a disclosure to anyone standing behind the recipient.

### API contracts

```
notification.listForUser(userId, filter?) -> Notification[]
  // Always scoped to the calling user's own recipient_user_id.
  // No parameter and no role broadens this

notification.markRead(notificationId)     -> { success }
notification.markAllRead(userId)          -> { success }
notification.getUnreadActionCount(userId) -> { count }
notification.mute(userId, sourceNodeType) -> { success }
  // Rejected where the source type produces ActionNeeded notifications
```

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | Notification carries the schema above. `delivered_to` connects it to its recipient |
| G02 | Every rule's recipient resolution matches its source feature's own established boundary exactly. No rule widens access beyond what that feature grants |
| G03 | This feature introduces no correction to any source feature. Each is watched through its existing write events, independently |
| G04 | `notification.listForUser` never accepts a parameter returning another user's notifications, for any role including Owner |
| G05 | Only `Informational` notifications may be muted. An `ActionNeeded` mute request is rejected |
| G06 | The unread indicator counts `ActionNeeded` items only |
| G07 | No Tier 3 record produces a notification to anyone but its owner. No aggregate below [[VPS-A004_Graph_Permission_Layer|VPS-A004]]'s threshold produces one at all |
| G08 | Email and push payloads carry no Tier 1, Tier 2 or Tier 3 content, per [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F003-S01 | Notification schema | Data |
| VPS-F003-S02 | Reactive subscription registry | Logic |
| VPS-F003-S03 | Inbox content and read state | UI |
| VPS-F003-S04 | Muting preferences | Logic |
| VPS-F003-S05 | Email delivery for action items | Logic |

---

## Feature Acceptance Criteria

**GIVEN** a RevenueGapAlert is created
**WHEN** the rule fires
**THEN** a Notification is created for the employee's manager and nobody else, including the employee

---

**GIVEN** a Departure is created for an employee
**WHEN** the rule fires
**THEN** notifications reach Owner and HR Admin only. That employee's manager receives none, matching Departure's Tier 2 class

---

**GIVEN** a user requests another user's notifications by ID
**WHEN** the request is made
**THEN** it is rejected. No role, including Owner, lists another user's feed

---

**GIVEN** a user attempts to mute a source type producing ActionNeeded items
**WHEN** the request is made
**THEN** it is rejected, and the reason states that items waiting on them cannot be silenced

---

**GIVEN** a user has three unread action items and eleven unread informational ones
**WHEN** the sidebar renders
**THEN** the indicator reads 3

---

**GIVEN** an ActionNeeded notification is delivered by email
**WHEN** the message is inspected
**THEN** it contains a summary and a link, and no salary figure, no wellness content, no contract detail and no signal about a named individual beyond what the Inbox row itself shows

---

**GIVEN** a leave request appears in the Inbox
**WHEN** the manager approves it inline
**THEN** the approval completes without navigation, the item clears, and [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] records it exactly as though approved from its own screen

---

**GIVEN** the device is offline
**WHEN** the Inbox is opened
**THEN** viewing and marking read function from local cache, and new notifications sync in on reconnection like any other write

---

## Non-Functional Requirements

- A notification appears within 10 seconds of its triggering event
- `notification.listForUser` resolves within 200ms from the local graph
- Full functionality offline for viewing, marking read and dismissing
- Inline actions complete within the same budget as their own feature's surface

---

## Security Considerations

- **Notification's access shape is genuinely new in this project.** Every other node type's permission row describes who by organizational role may see it. This one is recipient-only: a notification belongs to exactly the user it was generated for, and no role, including Owner, sees another feed. Closer in spirit to Tier 3's self-only shape than to Standard's, though the content itself is not sensitive — the scoping is about ownership of an inbox, not classification of data.
- **Every rule was written by checking its source feature's actual boundary**, not by assuming broad visibility is acceptable by default. Departure, FlightRiskSignal and the capacity shortfall figure are the three most worth a second look before implementation, and all three are reproduced with the identical restriction rather than a looser one made for convenience of delivery.
- **Message text is a disclosure surface in its own right.** A message reading *A retention signal was raised for Priya* is correct for an HR Admin and would be a serious breach delivered to a manager. Rules specify the recipient and the message together, never the recipient alone.
- **Email and push leave the product's permission boundary entirely.** Both carry a prompt and a link, never content. A push preview naming a person and a burnout signal discloses to anyone who can see the lock screen.

---

## Out of Scope

- Per-source frequency control or digest scheduling beyond the muting model above — [[VRS-F056_Proactive_Daily_Briefing|VRS-F056]] is the natural home for a curated daily digest; this is the real-time feed underneath it
- Notification batching into a single summary — as above
- Third-party channel delivery such as Slack — [[VPS-F009_Vulto_Sync_API|VPS-F009]]
- Read receipts or delivery confirmation visible to a sender — notifications have no sender
- Retention and archival of old notifications — [[VPS-F007_Data_Governance_Retention_and_Erasure|VPS-F007]]

---

## Decisions Recorded

**This feature moves from Scale to MVP**, position sixteen. Twelve MVP features fire alerts, and building their common surface last guarantees twelve bespoke inconsistent surfaces first — each with its own read state, its own visual treatment and its own opportunity to leak.

**The subscription table becomes an open registry.** Previously it enumerated fourteen rules for features that, in the corrected build order, mostly do not exist yet. Each later feature now registers its own rule as part of its own implementation, with the boundary stated at that time. The three most sensitive are named in advance so that nobody has to rediscover why they are narrow.

**A minimal muting model is added.** The previous specification had no preferences at all, which was defensible at Scale with a mature feed and is not defensible at MVP with a dozen sources and no way to quiet any of them. `ActionNeeded` cannot be muted, because an item waiting on a person is not noise.

**The unread indicator counts action items only.** A badge including informational items never reaches zero, and a badge that never clears is a badge people stop reading — at which point the feature has failed at its only job.

**Email delivery is resolved** by [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] rather than inherited as an open question. Push is resolved by [[VPS-F011_Mobile-Native_Experience|VPS-F011]]. Both carry prompts, never content.

---

## Related Notes

- [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — the Inbox surface this feature fills
- [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] — email delivery and the job queue
- [[VPS-A004_Graph_Permission_Layer|VPS-A004]] — the recipient-only access shape
- [[VPS-F005_Workspace_Configuration_Console|VPS-F005]] — where muting preferences are configured
- [[VRS-F056_Proactive_Daily_Briefing|VRS-F056]] — the daily digest built on this feed

---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Mature
Feature Type:
  - Experience
aliases:
  - VPS-F011
---

# VPS-F011 — Mobile-Native Experience

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (**React Native, Loro's native bindings and native SQLite are already recorded there**), [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] (the platform keychain this feature is where Tier 3 key backup actually runs), [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] (passkey authentication, already required there), [[VRS-F005_The_Bench_Forecast|VRS-F005]] and [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] (the two surfaces designed for this platform before it existed), [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] (**push delivery, whose content-free constraint is stated there**), [[VRS-F049_Manager_Dashboard|VRS-F049]] (the queue that becomes a manager's home screen)
**Blocks:** Nothing structurally.

This document is the single source of truth for this feature. **One application on a device, every Vulto surface inside it** — a person does not install Roster and Projects separately, any more than they install two Google Workspace apps to read one inbox.

---

## What most B2B mobile gets wrong

The usual failure is not a missing app. It is **an app built as a shrunk copy of the desktop screens**, with the same density and the same assumption that whoever is looking has both hands free and ninety seconds.

Nobody lives that way on a phone.

This feature is built around **four people who each open it for a different reason at a different moment**, and each moment gets its own design rather than one layout wearing four login screens.

---

## The wall push notifications cannot cross

A notification's content **transits through Apple's or Google's infrastructure** before reaching a device.

Every tier boundary this project built would mean nothing the moment a payload put *Sarah Ahmed: workload strain signal raised* through a third party's servers on its way to a lock screen.

**Every push this feature sends is content-free, for every tier including Tier 0.** A generic category and an opaque reference. The real content is fetched only after the device is unlocked and the app authenticates through the same interceptor every other read passes.

This is the same reasoning [[VPS-A006_Platform_Services_and_Infrastructure|VPS-A006]] applies to email: **respect a boundary this product does not control rather than asking it to bend.**

---

## What It Is

Native applications for iOS and Android sharing the same local-first architecture, the same graph and the same permission model as the web product, with role-specific experiences for four people who use this product for genuinely different reasons.

---

## Problem It Solves

[[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] names Pakistan and emerging markets, **where mobile is frequently the primary or only computing device**, as this product's target market, and its local-first architecture was built for intermittent connectivity.

Without this feature, that architecture's clearest use case has no app to run in.

---

## The four people, and what each actually needs

### The Owner: checked like a bank balance

[[VRS-F005_The_Bench_Forecast|VRS-F005]] describes the Bench Forecast as something checked the way a founder checks a bank balance. **A bank balance is checked from a home-screen widget, without opening an app.**

This ships exactly that: a widget showing current bench headcount and today's unrecovered cost per [[VRS-F012_Revenue_Gap_Alert|VRS-F012]], refreshed in the background. Opening it goes straight to the Forecast, not a menu.

### The Manager: clearing a queue between meetings

[[VRS-F049_Manager_Dashboard|VRS-F049]]'s action queue is the natural home screen. Leave approvals, strain-signal clearances and onboarding completions are **one-tap actionable from an interactive notification** — an Approve button on the notification itself.

The tap still requires the device unlocked. **Nothing about the convenience weakens the access control underneath it.**

### The Finance Admin: honest about what a small screen serves badly

[[VRS-F065_Payroll_Approval_Workflow|VRS-F065]]'s review context — manual adjustments, variance flags with revenue beside them, missing employees — is genuinely dense information a phone serves badly if forced.

**This feature does not force it.** A summary — *this run has 2 flagged items* — and a fast path to approve where nothing is flagged and segregation of duty is satisfied. **The moment anything is flagged, the app says so and offers to finish on a larger screen**, rather than quietly compressing a financial review into a scroll of tiny cards and calling that equivalent.

[[VRS-F067_Contractor_Invoice_Management|VRS-F067]]'s and [[VRS-F068_Expense_Management|VRS-F068]]'s approvals, structurally simpler single-item decisions, get the full one-tap treatment without the caveat.

### The Employee: the fifteen-second week, actually fifteen seconds

[[VRS-F010_Timesheet_Speed-Run|VRS-F010]] designed a swipeable day view before this feature existed to ship it. **A same-as-yesterday quick-fill sits beside the numeric input**, since retyping identical hours on a phone keyboard is real friction a physical keyboard does not have.

Leave, payslips and documents per [[VRS-F050_Employee_Self-Service_Portal|VRS-F050]] are one tab away, biometrics standing in for a password.

---

## Interface Specification

### Surfaces

| Surface | Platform | Purpose |
|---|---|---|
| Home widget | iOS WidgetKit, Android App Widget | Bench headcount and cost |
| Role home | In-app | Different per role |
| Interactive notification | System | One-tap approval |

### Layout and components

**The design system applies unchanged**, per [[VPS-D001_Design_Foundations|VPS-D001]]. Same tokens, same typefaces, same amber reserved for money going wrong. A phone app that looks like a different product is a phone app people trust differently.

**Density defaults to comfortable on mobile** regardless of the workspace setting, since a 32px control at compact density is below the 44px touch target both platforms require.

**The home screen differs by role and is not configurable.** An Owner opens to the Forecast; a Manager to their queue; an employee to this week's timesheet. The premise is that the right landing surface is known, not left to a preference nobody sets.

**The widget carries two numbers and nothing else** — bench headcount and accumulated cost, in `mono`, on `bg-surface`. A widget with six figures is a widget nobody reads at a glance, and the glance is the entire point.

**Timeline surfaces do not render as timelines.** The Bench Forecast becomes a vertical per-person list per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]]'s responsive rule: current assignment, next rolloff, bench cost. A Gantt chart on a phone is a Gantt chart nobody reads.

### System states

| State | Treatment |
|---|---|
| Offline | Full local functionality. The indicator shows; nothing is blocked |
| Syncing | Skeletons at correct dimensions |
| Restricted | Identical to web. This feature widens nothing |
| Too dense | Named plainly, with a path to a larger screen, rather than compressed |
| Error | Standard treatment |

---

## Technical Architecture

### The three platform adapters

Recorded in [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] rather than decided here.

**React Native**, sharing TypeScript fluency and `packages/schema` types directly. A separate Swift and Kotlin codebase would recreate exactly the hiring problem the two-language boundary exists to avoid.

**Loro's native Rust bindings** through a native module — the third platform adapter alongside WASM and the server binary, not a fourth CRDT library.

**Native SQLite**, not WASM. The platform's own engine is present and faster; schema and query logic in `packages/schema` remain identical, only the engine differs.

### The Web Worker equivalent

[[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] requires merge processing off the main thread. React Native's equivalent is a JSI background context. **The requirement is identical — a large catch-up sync never freezes the UI — only the mechanism differs by platform.**

### Push, content-free

Device gains `push_token` per [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]]. [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s subscription rules are unchanged; **this feature adds a delivery mechanism beneath them, never a new rule about who receives what.**

Every payload carries a fixed generic message and an opaque reference. The app fetches content after authentication through [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s existing call, unmodified.

### Biometric unlock

Layered on top of passkey authentication per [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]], never replacing it. Biometrics unlock a session the passkey established; **they are not an authentication method of their own.**

### Where Tier 3 key backup actually runs

[[VPS-A003_Unified_Sync_Architecture|VPS-A003]] specifies that Tier 3 key backup defaults to the device platform's secure cloud keychain — **and until this feature exists there is no such keychain to run in.** This is where that provision becomes real.

### Local storage

The local graph is encrypted at rest with the platform's own secure storage, keyed from the session per [[VPS-A003_Unified_Sync_Architecture|VPS-A003]]. **A revocation wipes it within 60 seconds of the signal**, identical to web.

---

## Graph Specifications

| ID | Specification |
|---|---|
| G01 | This feature introduces no node type. Device's `push_token` is added by [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]] |
| G02 | Every push payload is content-free — a generic category and an opaque reference — for every tier including Tier 0 |
| G03 | [[VPS-F003_Notification_and_Alert_Center|VPS-F003]]'s subscription rules are unchanged. This feature adds delivery, never a rule about recipients |
| G04 | Biometric unlock layers on passkey authentication and is never an authentication method of its own |
| G05 | The permission model is identical to web. No mobile-specific path exists |
| G06 | Tier 1 and Tier 3 operations require an authorized device exactly as on web. Mobile is not a lesser tier of trust |
| G07 | Density defaults to comfortable regardless of the workspace setting, meeting platform touch-target requirements |

---

## Sub-features

| ID | Name | Type |
|---|---|---|
| VPS-F011-S01 | React Native shell and platform adapters | Platform |
| VPS-F011-S02 | Content-free push delivery | Security |
| VPS-F011-S03 | Home widget | UI |
| VPS-F011-S04 | Four role-specific home surfaces | UI |
| VPS-F011-S05 | Biometric unlock and keychain key backup | Security |

---

## Feature Acceptance Criteria

**GIVEN** a workload strain signal is raised
**WHEN** the push is delivered
**THEN** the payload contains a generic category and an opaque reference, and no employee name, no signal type and no figure

---

**GIVEN** a manager taps Approve on a leave notification
**WHEN** the device is unlocked and the action fires
**THEN** it calls [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]]'s approval unmodified, exactly as the web queue would

---

**GIVEN** an Owner glances at the home widget
**WHEN** it renders
**THEN** bench headcount and today's unrecovered cost appear, refreshed in the background, without the app being opened

---

**GIVEN** a payroll run has 2 flagged items
**WHEN** a Finance Admin opens it on mobile
**THEN** the count is stated and a path to a larger screen is offered, rather than the review being compressed

---

**GIVEN** the same run has no flags and the reviewer did not finalize it
**WHEN** they approve on mobile
**THEN** it succeeds, with [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]]'s segregation rule unchanged

---

**GIVEN** an employee opens the timesheet with identical hours to yesterday
**WHEN** they use the quick-fill
**THEN** the day fills in one tap, and the full week completes within [[VRS-F010_Timesheet_Speed-Run|VRS-F010]]'s thirty-second mobile budget

---

**GIVEN** the device is offline for two days
**WHEN** the app is opened
**THEN** every local surface functions, writes queue, and a catch-up sync on reconnection never freezes the UI

---

**GIVEN** a device is revoked
**WHEN** the signal is received
**THEN** the local store is wiped within 60 seconds, identical to web

---

## Non-Functional Requirements

- Cold start to an interactive home surface within 2 seconds on a mid-range device
- A catch-up sync of thousands of deltas never blocks the UI thread
- The widget refreshes within the platform's own background budget without draining battery noticeably
- Full offline functionality for every surface the web product supports offline

---

## Security Considerations

- **Content-free push is the substantive decision**, and it applies at every tier rather than only the sensitive ones. A lock-screen preview naming a person and a signal discloses to anyone standing behind the recipient, and Tier 0 data is not exempt from that.
- **Biometrics unlock a session, they do not establish one.** A device where a passkey was never registered cannot be biometrically unlocked into an authenticated state.
- **Mobile is not a lesser tier of trust.** A Tier 1 operation requires an authorized device on a phone exactly as on a laptop, and this feature creates no mobile-specific relaxation.
- **A phone is lost more often than a laptop**, which is why local encryption, session-derived keys and the 60-second revocation wipe matter more here — and why they are identical rather than weakened.

---

## Out of Scope

- **A tablet-specific layout** — tablets receive the phone layout at larger dimensions. A third layout is a real decision requiring its own scrutiny
- **Offline-first push** — a notification requires connectivity by definition
- **Any feature not present on web** — this is a platform, not a product line
- **Compressing [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]]'s flagged review onto a phone** — deliberately declined
- **A mobile web app as an alternative** — the responsive web product exists per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] and is not this feature

---

## Decisions Recorded

**The platform decisions move to [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]].** React Native, Loro's native bindings and native SQLite are stack decisions, and this document consumes them rather than making them — which is also why the passkey gap the previous version found is already closed in [[VPS-F001_Authentication_and_Workspace_Foundation|VPS-F001]].

**Density defaults to comfortable on mobile regardless of the workspace setting.** A 32px control at compact density is below both platforms' minimum touch target, and inheriting a desktop preference would ship a control people cannot reliably hit.

**The widget carries two numbers.** A widget with six figures is one nobody reads at a glance, and the glance is the entire point of a widget.

**The home surface differs by role and is not configurable.** The right landing surface is known; leaving it to a preference nobody sets produces four people opening a menu.

**Content-free push applies to Tier 0 as well.** The previous specification said every tier and the reasoning is worth restating: a lock-screen preview is visible to whoever is standing behind the recipient, and an employee's name beside a notification category is a disclosure regardless of what tier the underlying record sits at.

---

## Related Notes

- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — where the platform decisions are recorded
- [[VPS-A003_Unified_Sync_Architecture|VPS-A003]] — the keychain this feature is where key backup runs
- [[VPS-F003_Notification_and_Alert_Center|VPS-F003]] — the subscription rules push delivers beneath
- [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] — the mobile day view designed before this shipped

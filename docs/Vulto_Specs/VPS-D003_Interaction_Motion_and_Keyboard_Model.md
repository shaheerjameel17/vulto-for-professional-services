---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Experience
aliases:
  - VPS-D003
---

# VPS-D003 — Interaction, Motion and Keyboard Model

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-D001_Design_Foundations|VPS-D001]], [[VPS-D002_Component_Library|VPS-D002]], [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] (the local-first substrate that makes these budgets achievable)
**Blocks:** The Interface Specification section of every feature document

This document is the single source of truth for how every application in the suite responds to input: its keyboard model, its latency budgets, its optimistic write behavior, and the small amount of motion it is permitted.

**The keyboard model in particular is suite-wide.** A person who learns `J`/`K` in Roster expects it in Projects, and an application that rebinds it has broken something more valuable than whatever it gained.

---

## Speed is the aesthetic

The visual system in [[VPS-D001_Design_Foundations|VPS-D001]] is quiet by design, which leaves this product one remaining way to feel exceptional, and it is the way that actually matters to someone using it for six hours a day: it must be faster than the person operating it.

[[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] already bought this. A local-first architecture with a materialized SQLite index means almost every read in this product is a local query, and almost every write can be acknowledged before the network is consulted. The architecture's entire justification is responsiveness. This document exists to make sure the interface actually spends what the architecture paid for, because a local-first product with a loading spinner has wasted its own foundation.

---

## Latency budgets

These are requirements, not aspirations. A feature that cannot meet its budget is redesigned rather than shipped slow.

| Interaction | Budget | Notes |
|---|---|---|
| Keystroke to character | 16ms | One frame |
| Command palette open | 50ms | Rendered, focused, ready |
| Search results as you type | 30ms | From the local index, per [[VPS-F002_Local-First_Search|VPS-F002]] |
| Skill match results | 10ms | Per [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]]'s own requirement |
| Row selection to panel open | 100ms | Including the two-hop traversal |
| Navigate between profiles | 100ms | Per [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] |
| Bench Forecast full render | 200ms | 150 employees, mid-range device, per [[VRS-F005_The_Bench_Forecast|VRS-F005]] |
| Filter application | 50ms | Recomputed aggregate included |
| Write acknowledgement | 16ms | Optimistic, before any network call |
| Scroll | 60fps | Never degrades under virtualisation |

**Nothing in this product shows a loading spinner for an operation under 300ms.** Below that threshold the correct treatment is no treatment: the result simply appears. A spinner on a 40ms operation manufactures the impression of slowness the architecture was built to avoid.

---

## Optimistic writes

Every write is applied to the local graph and rendered immediately, then synchronized. The user is never made to wait for a server to agree.

**The success path is silent.** No toast, no confirmation, no acknowledgement. The change appearing *is* the confirmation. A product that congratulates itself on every save is a product that expected to fail.

**The failure path is honest and specific.** Where a write is rejected — by a permission check, a schema constraint, or a merge conflict — the local state is reverted with the change visibly returning to its prior value, and an Inline Alert states what happened and what to do. Failure is rare enough in this architecture that when it occurs it deserves a full explanation rather than a generic message.

**Validation that can run locally, runs before the write.** The 100% capacity constraint in [[VRS-F005_The_Bench_Forecast|VRS-F005]], leave balance checks in [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]], and policy warnings in [[VRS-F018_Leave_Policy_Engine|VRS-F018]] are all evaluable against the local graph. They surface as the user types, not after they submit. A form that accepts input and then rejects it has wasted the person's time twice.

---

## The keyboard model

This product is operated by keyboard by the people who use it most. Mouse operation is fully supported and never second-class, but every primary action has a keyboard path, and the keyboard path is the faster one.

### Global

| Key | Action |
|---|---|
| `Cmd/Ctrl + K` | Command palette |
| `Cmd/Ctrl + /` | Keyboard shortcut reference |
| `Escape` | Dismiss the topmost layer: panel, then modal, then palette |
| `Cmd/Ctrl + \` | Toggle sidebar |
| `Cmd/Ctrl + Enter` | Submit the current form |
| `G` then `B` | Go to Bench Forecast |
| `G` then `P` | Go to People |
| `G` then `T` | Go to Timesheets |
| `G` then `I` | Go to Inbox |

Sequential `G` navigation is used rather than modifier combinations because the destinations are memorable by initial and the shortcuts remain available without conflicting with browser and operating system bindings.

### Lists and tables

| Key | Action |
|---|---|
| `J` / `↓` | Next row |
| `K` / `↑` | Previous row |
| `Enter` | Open the selected row |
| `X` | Toggle selection |
| `E` | Edit selected |
| `Cmd/Ctrl + A` | Select all in view |

`J` and `K` are specified in [[VRS-F002_Atomic_Employee_Profiles|VRS-F002]] for profile navigation and are generalized here to every list surface in the product, so the muscle memory transfers rather than being relearned per screen.

### Timesheet entry

Owned by [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] and stated here because it is the highest-frequency interaction in the product and its budget is the tightest in the specification set — an entire working week in fifteen seconds.

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Next / previous cell |
| `↑ ↓ ← →` | Move between cells |
| `Cmd/Ctrl + Enter` | Submit week |
| `Cmd/Ctrl + D` | Fill remaining cells in row from the cell above |

Natural language input is accepted in every cell — `fd` for a full day, `8-1` for seven hours, a bare `8` for eight — parsed on blur and displayed as hours. No dropdown appears anywhere in the critical path, because a dropdown is a mouse instrument wearing a keyboard costume.

### Rules

Shortcuts never fire while a text input has focus, except `Escape` and `Cmd`-modified combinations. Single-letter shortcuts are documented on hover of the control they trigger, which is how they are discovered without a manual. Nothing destructive is bound to a single key.

---

## Motion

Motion in this product is functional exclusively. It exists to explain where something came from or where it went, and for no other reason. There is no ambient animation, no scroll-triggered reveal, no page transition, and no hover effect that moves an element.

### Duration and easing

| Token | Duration | Easing | Use |
|---|---|---|---|
| `motion-instant` | 0ms | — | State changes: hover, focus, selection |
| `motion-fast` | 120ms | `cubic-bezier(0.2, 0, 0, 1)` | Popovers, tooltips, dropdowns |
| `motion-base` | 180ms | `cubic-bezier(0.2, 0, 0, 1)` | Panels, modals, toasts |

Three durations. Nothing exceeds 180ms, because beyond roughly 200ms an interface transition stops reading as responsiveness and starts reading as a wait. Easing is a single decelerating curve throughout: fast departure, soft arrival. There is no spring, no bounce, and no overshoot anywhere in this product.

### What may move

- Panels slide 16px horizontally while fading in, at `motion-base`.
- Modals and the command palette fade in and scale from 98%, at `motion-base`.
- Popovers, dropdowns and tooltips fade in at `motion-fast` with no movement.
- Toasts slide 8px upward while fading in, at `motion-base`.
- Timeline bars transition their position and width at `motion-base` when the window changes, so the eye can follow a bar rather than relocating it.

### What may not move

Hover states, focus rings, selection, table rows, page content on load, numbers as they change, and the bench cost figure. The signature element in [[VPS-D001_Design_Foundations|VPS-D001]] counts up without animating; the value simply becomes the new value. An animated counter would turn the most serious number in the product into a toy.

### Reduced motion

`prefers-reduced-motion: reduce` sets every duration to 0ms and removes every transform. Nothing else changes — no functionality is lost, no layout differs, and no alternative animation is substituted. The product is entirely usable, and arguably faster, with motion switched off, which is a reasonable test of whether the motion was necessary.

---

## Responsive behavior

The web product targets 1280px and above as its design center and remains fully functional to 1024px. Below that, [[VPS-F011_Mobile-Native_Experience|VPS-F011]]'s native mobile applications are the intended experience, and the responsive web behavior below exists so the product is not broken on a tablet rather than to serve as a mobile strategy.

| Breakpoint | Behavior |
|---|---|
| `≥ 1536px` | Panel opens alongside content without displacing it |
| `1280–1535px` | Design center. Panel overlays the right edge of content |
| `1024–1279px` | Sidebar collapses to icons. Tables drop secondary columns in a defined priority order |
| `< 1024px` | Sidebar becomes a drawer. Timeline switches to a vertical per-person list. Timesheet entry switches to the single-day swipe view from [[VRS-F010_Timesheet_Speed-Run|VRS-F010]] |

Column drop order is declared per table in the feature that owns it, so degradation is a decision rather than whatever the layout engine happens to do.

---

## Related Notes

- [[VPS-D001_Design_Foundations|VPS-D001]] — the visual foundations these interactions operate within
- [[VPS-D002_Component_Library|VPS-D002]] — the components these rules apply to
- [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — the shell, and the three system states
- [[VPS-A001_Technology_Stack_and_Engineering_Foundations|VPS-A001]] — the local-first architecture these budgets depend on

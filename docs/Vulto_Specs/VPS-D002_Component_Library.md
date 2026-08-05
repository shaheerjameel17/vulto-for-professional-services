---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-07-31]]"
Product Phase:
  - Architecture
Feature Type:
  - Experience
aliases:
  - VPS-D002
---

# VPS-D002 — Component Library

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-D001_Design_Foundations|VPS-D001]] (every value used here is defined there)
**Blocks:** The Interface Specification section of every feature document

This document is the single source of truth for the components every application in [[Vulto for Professional Services]] is built from. A feature document specifies which components it composes and how; it never defines a component, and never overrides one.

---

## The rule that governs this document

**A feature may not introduce a new component, in any application.** If a feature needs something this library does not provide, the library gains it here first, and every other feature in every application becomes able to use it. This is the difference between a design system and a folder of styles, and it is the only thing that will keep nine applications in [[Vulto for Professional Services]] looking like one product.

The library is deliberately small. Twenty-two components cover every screen Roster and Projects need between them. A larger library would mean the same problem had been solved twice under different names.

---

## Foundational

### Button

Four variants, three sizes. There is exactly one `primary` button on any screen at any time — the single most likely action. A screen with two primary buttons has not decided what it is for.

| Variant | Fill | Border | Text | Use |
|---|---|---|---|---|
| `primary` | `brand-600` | none | `text-inverse` | The one action |
| `secondary` | `bg-surface` | `border-default` | `text-primary` | Everything else |
| `ghost` | none | none | `text-secondary` | Toolbar and inline actions |
| `danger` | `bg-surface` | `danger` | `danger` | Destructive; fills solid only on confirmation |

Sizes `sm` 24px, `md` 28px, `lg` 32px, matching control heights in [[VPS-D001_Design_Foundations|VPS-D001]]. Hover is `bg-hover`; there is no elevation change. Disabled is 40% opacity with `cursor: not-allowed`, never a color change. Loading replaces the label with a spinner at the same width, so the button never resizes.

Every button label is an active verb naming what happens: **Assign**, **Approve**, **Send for signature**. Never **Submit**, never **OK**. The label persists through the flow — a button reading **Publish** produces a toast reading **Published**.

### Input, Select, Textarea, DatePicker

28px height at compact, 32px comfortable. 1px `border-default`, `radius-md`, `bg-surface`. Focus is a 2px `border-focus` ring at 2px offset, never an inner glow.

Labels sit above, `label` token, `text-secondary`. Helper text sits below at `small`. Error state turns the border `danger` and replaces helper text with the error, which states what is wrong and how to fix it: *"Start date must fall before the assignment ends"*, not *"Invalid date"*.

`DatePicker` respects the workspace working calendar from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]: non-working days render at `text-tertiary` and are visually distinct from disabled days, because a Friday that is a weekend in Dubai and a working day in Karachi is a fact the picker must express.

### Checkbox, Radio, Switch, Toggle Group

16px controls. `Switch` is reserved for settings that take effect immediately; anything requiring a save uses `Checkbox`. `Toggle Group` handles small mutually exclusive sets — density mode, timeline zoom — and replaces a select where there are three or fewer options.

### Badge

`radius-sm`, `label` token, `2` horizontal padding, 20px height. Two intensities: `subtle`, a tinted background at 10% of the hue with text at full strength, used for status; and `solid`, used only for counts.

Status badges take their color from the semantic tokens exclusively. A badge is never `brand`.

### Avatar

`radius-full`, sizes 20/24/32/40. Falls back to initials on `neutral-200` / `neutral-800` when no image exists, never to a generic silhouette. `AvatarGroup` overlaps at -8px and truncates to a `+n` chip after four.

### Icon

One icon set throughout: **Lucide**, 16px default, 1.5px stroke, `currentColor`. Icons never carry color independently of their text. Decorative icons are not permitted — every icon in this product either replaces a word or clarifies one.

---

## Data

### Table

The most-used component in the product and the one most worth getting right.

Row heights per density from [[VPS-D001_Design_Foundations|VPS-D001]]. Header row uses `micro`, uppercase, `text-tertiary`, with a 1px bottom `border-default`. Rows have no separators — separation comes from row hover and alignment alone, which keeps a hundred-row table from reading as a grid of cages.

Numeric columns are right-aligned and set in `mono`. Text columns are left-aligned. There is no center alignment anywhere in this product.

Behavior: sticky header, column sort on header click, keyboard row navigation per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]], row selection via checkbox column, and virtualised rendering above 100 rows. Sorting and filtering run against the local SQLite index and never round-trip.

**Empty state** is an invitation, not an apology: a single line of `body` text naming what would appear here and a `secondary` button that creates the first one. No illustration, no icon, no empty box.

### Timeline

The Bench Forecast canvas, owned in behavior by [[VRS-F005_The_Bench_Forecast|VRS-F005]] and in appearance here. Also used by [[VRS-F051_Team_Capacity_Planner|VRS-F051]] and [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]].

- Fixed left column, 220px, holding avatar, name and role, with its own right border.
- Scrollable right region, horizontally virtualised, showing the configured window.
- Day columns; non-working days per [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] render with `bg-subtle`.
- **Assignment bar:** filled `cat-n` by project hash, `radius-md`, height 20px compact / 24px comfortable, label inside at `small` `text-inverse` truncating with ellipsis.
- **Ghost bar:** same geometry, 1px dashed border in `cat-n`, 12% fill, per the dashed-border rule.
- **Bench region:** flat `attention` at 12% fill, no border, with the accumulated cost in `mono-lg`. The signature element defined in [[VPS-D001_Design_Foundations|VPS-D001]].
- **Today line:** 1px `brand-500`, full height, above bars, with a 6px dot at the top edge. The only brand-colored element on the canvas.

### Chart

Three types only: line for trends over time, bar for comparison across categories, and a single horizontal stacked bar for a part-to-whole split such as the billable pulse. No pie charts, no donuts, no area fills, no dual axes.

Charts inherit the categorical palette. Gridlines are `border-default` at 50% opacity on the value axis only. Axis labels are `micro`. Every chart states its own date range and its own denominator in a `small` caption beneath, because a percentage without a denominator is a rumor.

### Stat

A single figure with a label. `display` or `mono-lg` for the value, `micro` uppercase for the label, and an optional delta in `small` with `success` or `attention`. Deltas always state the comparison period explicitly — *"+4% vs last week"*, never a bare arrow.

### Progress and Pulse Bar

A horizontal bar showing consumption against a target. Fill is `success` below target, `attention` above. Used for retainer consumption, leave balance and the billable pulse. The target is marked with a 1px `border-strong` tick so that "over" is visible without reading the number.

---

## Layout

### Card

`raised` elevation. `4` padding. Optional header with `h3` title and a right-aligned action slot. Cards do not nest — a card inside a card means the outer one should have been a section.

### Panel

The right-hand contextual surface, 360px, full height, `raised`, with a 1px left border. Opens on row selection. Contains the Contextual Intelligence Panel in [[VRS-F005_The_Bench_Forecast|VRS-F005]] and the detail view in most list screens. Dismissible with `Escape` and by clicking the canvas.

### Modal

`overlay` elevation, `radius-lg`, max-width 480px standard or 640px for forms, centered, with a `neutral-950` scrim at 40%. Reserved for destructive confirmation and for flows that must not be abandoned halfway. Everything else is a Panel, because a modal that can be dismissed without consequence should not have been a modal.

### Tabs

Underline style: 2px `brand-500` on the active tab, `text-secondary` on the rest. Tabs switch views of the same object. They never carry unsaved state between them.

### Section

A titled region on a page. `h2` heading, `6` space above, `4` below. The only permitted structural divider is space; horizontal rules are not used to separate sections.

---

## Feedback

### Toast

`overlay` elevation, bottom-right, 4 second dismissal, stacking to three. Confirms an action in the past tense using the verb from the button that caused it. Carries an **Undo** action wherever the operation is reversible, which is preferable to a confirmation dialog for everything short of deletion.

### Inline Alert

A bordered region inside content, not floating. Left border 2px in the semantic color, `bg-subtle` fill, `radius-md`. Used for the conflict warning in [[VRS-F008_Capacity_Conflict_Resolution|VRS-F008]], the policy warning in [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]] and the payroll variance flag in [[VRS-F065_Payroll_Approval_Workflow|VRS-F065]].

The distinction from Toast is strict: **Toast reports what happened, Inline Alert reports what is true.** A toast disappears; an inline alert persists while the condition does.

### Skeleton

Static `bg-subtle` blocks matching the shape of incoming content. **No shimmer, no pulse, no animation.** Movement on a screen that is not yet readable is noise, and this product's local-first architecture means skeletons are usually visible for under 100ms in any case.

### Tooltip

`overlay`, 200ms delay, `small` text, max-width 280px. Tooltips explain; they never contain the only copy of a piece of information, and never contain an action.

---

## Navigation

### Command Palette

`Cmd+K` from anywhere, and the single most important interaction in the product. `overlay`, 640px wide, top-anchored at 15% viewport height.

It is one surface with several capabilities rather than several palettes: entity search from [[VPS-F002_Local-First_Search|VPS-F002]], skill matching from [[VRS-F013_Skill-to-Project_Matcher|VRS-F013]], and command execution all resolve in the same input. Results are grouped with `micro` uppercase group headers, keyboard-navigated, and rendered from the local index within the latency budget in [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]].

Every result row shows the entity, its type, and one line of the most decision-relevant context available — for a person, their availability and next rolloff date, because the question behind almost every search in this product is *can they take this work*.

### Sidebar, Breadcrumb, Pagination

Specified in [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], which owns the application shell.

---

## Accessibility floor

Non-negotiable and applied at component level so that no feature has to remember it.

- Every interactive element is reachable and operable by keyboard, with a visible 2px `border-focus` ring at 2px offset. Focus is never suppressed.
- Every icon-only control carries an accessible label.
- Color is never the sole carrier of meaning; every semantic state pairs a hue with a word or a number.
- `prefers-reduced-motion` removes all transitions, per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]].
- Modals and panels trap focus and restore it to the trigger on close.
- Tables use real table semantics with scope on headers, not a grid of divs.
- Minimum target size 24px at compact density, which is why no control is smaller.

---

## Related Notes

- [[VPS-D001_Design_Foundations|VPS-D001]] — the tokens every component here consumes
- [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] — how these components behave under keyboard and motion
- [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — the shell these components are arranged within

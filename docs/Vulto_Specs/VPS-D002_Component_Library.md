---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-08-08]]"
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

Sizes `sm` 24px, `md` 28px, `lg` 32px, matching control heights in [[VPS-D001_Design_Foundations|VPS-D001]]. Buttons are `radius-full`; icon-only Buttons are circular. Fields, cards, panels and dialogs retain their documented radii. Hover is variant-specific: `primary` strengthens to `brand-700`, while `secondary`, `ghost` and the pre-confirmation `danger` treatment take `bg-hover`. A confirming `danger` action is already solid and does not change fill on hover. There is no elevation change. Disabled is 40% opacity with `cursor: not-allowed`, never a color change. Loading replaces the label with a spinner at the same width, so the button never resizes.

Every button label is an active verb naming what happens: **Assign**, **Approve**, **Send for signature**. Never **Submit**, never **OK**. The label persists through the flow — a button reading **Publish** produces a toast reading **Published**.

### Input, Select, Textarea, DatePicker

28px height. 1px `border-default`, `radius-md`, `bg-surface`. Focus is a 2px `border-focus` ring at 2px offset, never an inner glow.

Labels sit above, `label` token, `text-secondary`. Helper text sits below at `small`. Error state turns the border `danger` and replaces helper text with the error, which states what is wrong and how to fix it: *"Start date must fall before the assignment ends"*, not *"Invalid date"*.

`DatePicker` respects the workspace working calendar from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]]: non-working days render at `text-tertiary` and are visually distinct from disabled days, because a Friday that is a weekend in Dubai and a working day in Karachi is a fact the picker must express.

The picker accepts typed ISO dates and exposes month and year Selects, previous/next month controls, and a calendar grid. Phone entry uses the same field shell with a country-and-dial-code Select followed by a national-number input; the person enters no country code twice. Currency selection shows the currency symbol and ISO code. It does not show a country flag because a currency is not owned by one country.

**The affix contract.** A currency symbol, a unit or a percentage sign is a prefix or suffix, never freehand text inside the value. It is laid out as a sibling of the field's own input element within the same bordered container — never positioned over it — so reserving its space is a property of the layout, not a padding value chosen to dodge whatever the browser happens to render in that corner. `small`, `text-tertiary`. A numeric input carrying an affix suppresses the browser's native step spinner; an unaffixed numeric input keeps it. This exists because Roster prices almost everything — rates, hours, percentages, currency, across the payroll cluster alone — and every one of those fields needs this contract to hold.

### Checkbox, Radio, Switch, Toggle Group

16px controls. `Switch` is reserved for settings that take effect immediately; anything requiring a save uses `Checkbox`. `Toggle Group` handles small mutually exclusive sets — timeline zoom, appearance theme, and Tabs, below — and replaces a select where there are three or fewer options.

**Segmented controls, as a class.** A track at `bg-subtle`-equivalent depth with `1` internal padding; the active segment raised onto its own fill at `bg-raised`-equivalent depth, `radius-full`, with a weight change from `body` to `body-medium` alongside the fill. Neutral throughout — brand marks selection only where [[VPS-D001_Design_Foundations|VPS-D001]] says it does, and which segment is currently set is not that. `Toggle Group` and `Tabs` are two components from this one treatment, not two treatments that happen to coincide: a `Toggle Group` sets a value; `Tabs` switches which view of an object is shown; both are a small mutually exclusive set sharing a track, and a screen that shows one as pills and the other underlined has one inconsistency where the rule was meant to prevent it.

### Badge

`radius-sm`, `label` token, `2` horizontal padding, 20px height. Statuses and skill tags take `radius-full`; compact metadata badges retain `radius-sm`. Two intensities: `subtle`, used for status, and `solid`, used only for counts. The label supplies the meaning while the tint supplies a redundant cue.

**`subtle` is a per-theme tint with hue-derived ink — the `tag-*` tokens — not one alpha with `text-primary`.** It was the semantic hue at 10% in both themes, and it failed in each for a different reason. Over white, 10% of a hue is a wash that reads as no color at all. And `neutral` resolved to `bg-active`, which in dark was the identical value to `bg-surface`, so an employment-type tag on a Card was literally invisible until a row hover moved the surface out from under it.

The tint is stated per theme and the ink is mixed from the same hue, so no new color enters the system and a tag reads as a status rather than as a gray chip that happens to be tinted. See [[VPS-D001_Design_Foundations|VPS-D001]]'s contrast floor for the pairings.

Status badges take their color from the semantic tokens exclusively. A badge is never `brand`. Neutral metadata — employment type, skill, category, source — takes `tag-neutral`, which is its own value rather than a reuse of a state token, because it has no hue to tint and must clear every surface a tag can land on.

### Avatar

`radius-full`, sizes **24/28/32/40**, plus a 48px identity size reserved for the employee profile header. Falls back to initials on `avatar-fallback` — `neutral-200` in light, `#2A2A2B` in dark — when no image exists, never to a generic silhouette. The dark value is deliberately off-ramp: `neutral-800` sits between `bg-surface` and `bg-hover` and disappeared against a hovered row. `AvatarGroup` overlaps at -8px and truncates to a `+n` chip after four.

**The two small steps were 20 and 24 and were raised, and the type token changed with them.** This scale was written before initials were rendered. Two uppercase glyphs at the only type token that fits a 20px circle span about 14px, leaving under 3px of clearance to a curved edge — and `micro`'s +0.04em uppercase tracking spent part of that on a *trailing* space, pushing the pair visibly left of center and running the second letter into the edge.

**Initials are set in `label`, not `micro`, at every size below 32px.** `micro` is this system's uppercase treatment and carries tracking for that job; initials are already uppercase by construction, so the tracking has nothing to do but decenter them. The general rule: **letter-spacing applies to the last glyph as well as between them, so any centered box of tracked text is off-center by half the tracking.**

### Icon

One icon set throughout: **Lucide**, 16px default, 1.5px stroke, `currentColor`. Icons never carry color independently of their text. Decorative icons are not permitted — every icon in this product either replaces a word or clarifies one.

---

## Data

### Table

The most-used component in the product and the one most worth getting right.

Row height is 32px per [[VPS-D001_Design_Foundations|VPS-D001]]; **a row carrying two stacked facts is 52px**, which is the People directory's row, the Timeline's, and the timesheet's work column. Two stacked facts in a 32px row is 30px of type in 32px of space, and it reads as text pressed against the cell border.

The header row is a rounded **`bg-column-header`** strip using `micro`, uppercase and **`text-primary`**; it has no bottom divider. It was `bg-active` with `text-secondary` — the fill because a state token was standing in for a structural surface and disappeared entirely on a Card, the ink because a column header is a load-bearing label. Both are covered by rules in [[VPS-D001_Design_Foundations|VPS-D001]].

Rows have no separators — separation comes from row hover, spacing and alignment alone, which keeps a hundred-row table from reading as a grid of cages.

**A row's fill lives on its cells, not on the row.** A `<tr>` accepts `border-radius` and does nothing with it: the background is painted by the cells, so the corners a row appears to have are its first and last cell's. Any table wanting a rounded hover or selection carries the fill down to the cells, rounds the outer two, and uses a group hover so the gesture stays whole-row. This also requires `border-separate` — under `border-collapse`, cell backgrounds are painted into one shared grid that no radius can clip. At zero spacing the rows still tile with no gap, so density is unaffected.

**Row hover is `bg-hover`; the Timeline applies that fill only to its frozen identity group.** A Timeline row spans a frozen person column and a horizontally scrolling track, and a whole-row fill leaves those halves reading as separate objects at exactly the join that matters. The identity target therefore carries hover and selection while the track remains quiet.

The People directory is the intentional sparse variant: it sits directly on an inset `bg-subtle` workspace, has no container or row dividers, 52px rows, and a `bg-hover` row hover. Its filter and visible-column controls are raised pills; an active filter shows a brand dot and an explicit clear affordance rather than repeating selected values in the toolbar. The filter band and table header both remain sticky, with one token step of space between their surfaces.

Numeric columns are right-aligned and use Inter tabular numerals. Text columns are left-aligned. There is no center alignment anywhere in this product.

Behavior: sticky header, column sort on header click, keyboard row navigation per [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]], row selection via checkbox column, and virtualized rendering above 100 rows. Sorting and filtering run against the local SQLite index and never round-trip.

**Column order is a setting where a table exposes one, and it is edited by two gestures onto one piece of state** — dragging a header, or dragging a row in the visible-column control. The two must never be separate orders. Identity columns are `pinned`: they cannot be dragged and nothing can be inserted ahead of them, because a directory whose name column can be pushed into the middle has stopped being a directory.

**Empty state** is an invitation, not an apology: a single line of `body` text naming what would appear here and a `secondary` button that creates the first one. No illustration, no icon, no empty box.

### Timeline

The Bench Forecast canvas, owned in behavior by [[VRS-F005_The_Bench_Forecast|VRS-F005]] and in appearance here. Also used by [[VRS-F051_Team_Capacity_Planner|VRS-F051]] and [[VRS-F019_Self-Service_Leave_Portal|VRS-F019]].

- Fixed left column, 220px, holding avatar, name, human-readable employee code and role. All three text facts remain present at every timeline width. It has no persistent boundary; the identity group is a rounded `bg-hover` target on hover and `bg-selected` on selection.
- Scrollable right region, horizontally virtualized, showing the configured window. Where it passes beneath the left column it fades over roughly 24px, per the scroll-boundary exception in [[VPS-D001_Design_Foundations|VPS-D001]].
- Per-person non-working-day columns resolve from [[VRS-F004_Working_Calendar_and_Working_Patterns|VRS-F004]] and appear only while that row is hovered, because a workspace can contain divergent calendars.
- Date labels are adaptive in exactly two visual rows: a month band above daily labels at 30 days, every seventh day at 90, and every fourteenth at 180. **Each label is a single date, not the range it opens.** Corrected by FDN-44: the ranges existed because, with no way to ask about a specific day, a label had to describe the span it stood for. The pointer marker below answers that directly, so a range restated the interaction at twice the width, and at 180 days the header read as arithmetic rather than as a scale. Persistent daily gridlines and header/row dividers are absent; the Today line carries the scan structure.
- Non-working-day shading is drawn as **runs of consecutive days, not per day**, each at `radius-md` — a Saturday and a Sunday are one stretch of not-working, and shading them as two adjacent cells puts a seam down the middle of a single period.
- **Assignment bar:** neutral `bg-raised` with `border-default`, `radius-md`, 20px height, project name inside at `small` `text-primary` truncating with ellipsis. A 6px `cat-n` dot assigned by project hash carries project identity.
- **Ghost bar:** same neutral geometry with a 1px dashed `border-strong`, per the dashed-border rule; its project dot follows the same hash.
- **Bench region:** `amber-500` at rest, `amber-400` when its row is hovered, **identical in both themes** per FDN-40 — a pale rest color that reads muted on white reads bright against a near-black canvas, so this element does not vary by theme, only by state. `radius-md`, 20px height, with the accumulated cost in `numeric-medium` at **`bench-figure` (`neutral-950`), in both themes — not `text-primary`.** The bench fill does not vary by theme, so its figure cannot either: `text-primary` resolves to `neutral-50` in dark, which is white on amber and unreadable. This is the one place in the product where a figure's colour is fixed rather than semantic, and it follows directly from the fill being fixed. It deliberately matches the Assignment bar rather than filling the 52px row: the remaining vertical space separates people without making bench time visually heavier than assigned time. Hovering a region highlights its exact range in the sticky date header, in a bordered pill, and shows the start/end dates there. The signature element defined in [[VPS-D001_Design_Foundations|VPS-D001]].
- **Date marker — Today and the pointer, one mechanism.** A pill naming the day, centered in the date row so it nests inside the bench range pill, and a 1px stem running from the pill's top edge to the header's bottom, continuing as a full-height line through every row. The pill paints over the stem, so no stroke shows above it. The header carries **no bottom padding**: its bottom edge is the first row's top edge, which is what makes the marker one unbroken element. Today is `brand-600` throughout with white text; the pointer marker is `border-strong` throughout with `text-primary`. **A marker's pill and its line are always one token** — FDN-44 found them set to two, which in dark mode read as two unrelated marks.
- The pointer marker takes the pointer's **raw pixel position**, not a snapped column center; only its *label* snaps, changing the instant the pointer crosses into the next day. The label is a fact about the date, the position is a fact about the pointer, and pinning them to the same value made one object visibly come apart.
- **The marker must never be painted outside the header's border box.** The header carries the scroll-boundary mask, and a mask brings `mask-clip: border-box` with it — anything drawn outside is silently removed. This is not a style preference; it is the constraint that a pill positioned to overhang the header will lose whatever overhangs.
- **Scrollbar:** 8px, `border-strong` thumb at `radius-full` resolving to `text-tertiary` on hover, transparent track. Applies to every scrolling surface this design system owns, not as a global reset. Both engines are styled — `scrollbar-width` and `scrollbar-color` for Gecko, the `::-webkit-scrollbar` pseudo-elements for Blink and WebKit — because styling one and not the other looks correct only on the machine it was written on. `thin` is Gecko's only expressible narrow width, so the two agree in intent rather than to the pixel; that is a platform limit, recorded rather than worked around. This dimension lives here rather than in [[VPS-D001_Design_Foundations|VPS-D001]] under the structural-dimensions delegation: it is the size of a piece of chrome, not spacing.

### Chart

Three types only: line for trends over time, bar for comparison across categories, and a single horizontal stacked bar for a part-to-whole split such as the billable pulse. No pie charts, no donuts, no area fills, no dual axes.

Charts inherit the categorical palette. Gridlines are `border-default` at 50% opacity on the value axis only. Axis labels are `micro`. Every chart states its own date range and its own denominator in a `small` caption beneath, because a percentage without a denominator is a rumor.

### Stat

A single figure with a label. `display` or `numeric-lg` for the value, `micro` uppercase for the label, and an optional delta in `small` with `success` or `attention`. Deltas always state the comparison period explicitly — *"+4% vs last week"*, never a bare arrow.

### Progress and Pulse Bar

A horizontal bar showing consumption against a target. Fill is `success` below target, `attention` above. Used for retainer consumption, leave balance and the billable pulse. The target is marked with a 1px `border-strong` tick so that "over" is visible without reading the number.

---

## Layout

### Card

`raised` elevation. `4` padding. Optional header with `h3` title and a right-aligned action slot. Cards do not nest — a card inside a card means the outer one should have been a section.

### Panel

The right-hand contextual surface, 360px, full height, `raised`, with a 1px left border. Opens on row selection. Contains the Contextual Intelligence Panel in [[VRS-F005_The_Bench_Forecast|VRS-F005]] and the detail view in most list screens. Dismissible with `Escape` and by clicking the canvas. A Panel is contextual and non-modal: it does not trap focus, but closing it restores focus to the row or control that opened it.

### Modal

`overlay` elevation, `radius-lg`, max-width 480px standard or 640px for forms, centered, over a `bg-scrim` backdrop — `neutral-950` at 36% in light, 64% in dark. **The scrim is stated per theme**: one alpha cannot both dim a white page enough to recede and avoid turning a near-black one into an unreadable void. Reserved for destructive confirmation and for flows that must not be abandoned halfway. Everything else is a Panel, because a modal that can be dismissed without consequence should not have been a modal.

### Tabs

The segmented-control treatment defined under Toggle Group above, not an underline. Tabs switch views of the same object. They never carry unsaved state between them.

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

**Composed primitives may not share a styling attribute.** Wrapping one interactive primitive's trigger around another's own element — Tooltip's `asChild` around a Toggle Group item, say — merges the wrapper's props onto the wrapped element, and where both write the same DOM attribute for their own state, the wrapper's value wins silently. A Toggle Group item that reads `data-state="on"`/`"off"` for its active fill, wrapped in a Tooltip whose own `data-state` means `"open"`/`"closed"`, loses its active state to a tooltip that isn't open — correct in every other respect, wrong on screen, and wrong for a reason neither component's own documentation would lead an implementer to expect. Any component wrapped in Tooltip derives its own visual state from a value it already holds — a prop, not a shared attribute a second primitive might also be writing.

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
- Modals trap focus. Panels remain non-modal and restore focus to the trigger on close.
- Tables use real table semantics with scope on headers, not a grid of divs.
- Minimum target size 24px at the product density, which is why no control is smaller.

---

## Related Notes

- [[VPS-D001_Design_Foundations|VPS-D001]] — the tokens every component here consumes
- [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] — how these components behave under keyboard and motion
- [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — the shell these components are arranged within

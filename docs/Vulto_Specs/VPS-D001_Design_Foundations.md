---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-08-10]]"
Product Phase:
  - Architecture
Feature Type:
  - Experience
aliases:
  - VPS-D001
---

# VPS-D001 — Design Foundations

**Status:** Decided at Founder Level
**Owner:** Founder (Shaheer Jameel), decided with AI advisory. No dedicated CTO function is currently engaged on this project; formal engineering review will occur whenever that changes.
**Depends On:** [[VPS-000_Documentation_Standard|VPS-000]] (documentation conventions)
**Blocks:** [[VPS-D002_Component_Library|VPS-D002]], [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]], [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]], and the Interface Specification section of every feature document

This document is the single source of truth for every reusable color, typeface, type size, spacing step, radius and elevation token in [[Vulto for Professional Services]]. Component and shell dimensions are owned by [[VPS-D002_Component_Library|VPS-D002]] and [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] respectively; a feature may consume those dimensions but may not invent a parallel token.

An operating system for professional services firms that looks like nine different products is not an operating system.

---

## The thesis

A founder opens these products before they open their email, the way they check a bank balance. That single sentence determines the entire visual system.

A bank balance is not designed to be admired. It is designed to be read in two seconds, trusted completely, and to make you feel something specific when the number is wrong. Every interface in [[Vulto for Professional Services]] has the same job: it must be so quiet that a bad number is impossible to miss.

This produces the governing rule of the whole system, which every other decision in this document serves:

> **The interface is deliberately color-starved so that money is the only thing on screen with a hue.**

Ninety percent of any Roster screen is neutral. Amber is the product brand and the signature color for cost and idleness; red remains reserved for failure. The cool half is available for small categorical markers such as project dots, never large fills. Every amber element on a screen has a job — the cost it states, the action it offers, or the day it marks — and the rationing rule under **Brand** below governs which. There are no decorative gradients anywhere in this product, no glass, no blur, no decorative depth, and no color used because a surface looked empty. A gradient used only to communicate a horizontal scroll boundary is the sole exception and carries no decorative color.

When a designer or an engineer wants to add color, the question is not "does this look better" but "is this about money going wrong". If it is not, it is neutral.

---

## Color

### Neutral ramp

Zinc, cool-neutral, chosen because its near-black and near-white values stay quiet beneath amber without drifting warm and competing with the product signal.

| Token | Hex | Token | Hex |
|---|---|---|---|
| `neutral-0` | `#FFFFFF` | `neutral-600` | `#52525B` |
| `neutral-50` | `#FAFAFA` | `neutral-700` | `#3F3F46` |
| `neutral-100` | `#F4F4F5` | `neutral-800` | `#27272A` |
| `neutral-200` | `#E4E4E7` | `neutral-900` | `#18181B` |
| `neutral-300` | `#D4D4D8` | `neutral-950` | `#09090B` |
| `neutral-400` | `#A1A1AA` | | |
| `neutral-500` | `#71717A` | | |

### Brand

Orange. `brand-500` `#FF8000` is the anchor.

| Token | Hex | Token | Hex |
|---|---|---|---|
| `brand-50` | `#FEF7F0` | `brand-500` | `#FF8000` |
| `brand-100` | `#FEEBD7` | `brand-600` | `#FF8000` |
| `brand-200` | `#FFD4A8` | `brand-700` | `#CC6600` |
| `brand-300` | `#FFB366` | `brand-800` | `#7A3D00` |
| `brand-400` | `#FF9933` | `brand-900` | `#5E3102` |

**`brand-500` and `brand-600` are deliberately the same value.** One orange, whichever step a component asks for. `brand-700` is a genuine darker step and exists for one purpose only: the hover-darken on a filled button. It is never used to make resting text pass a contrast check — see the exception below.

#### Brand and cost were the same hue, and that was wrong

This document previously specified amber as the brand, on the reasoning that in a product whose subject is money, the brand hue and the money hue being the same color was the thesis rather than a collision.

**Rendered, it was a collision.** The two were never distinguishable in practice — in dark mode `border-focus` and the bench fill resolved to the *identical value*, so the ring marking where you were typing and the field marking unrecovered cost were the same color on the same screen. The reasoning had been sound and the result was not, which is the class of finding this prototype exists to produce.

**The fix is separation, not neutrality.** Brand moved to its own orange at roughly 30° while amber stayed at 38–45°, giving 8–13° of hue separation and leaving amber reserved for cost alone. The alternative considered — making focus neutral on cost surfaces — would have solved the collision by removing a signal rather than by distinguishing two.

#### The ration

**Brand color is rationed, and the ration counts signals rather than pixels.** Brand marks exactly three *signals*: the primary action on a screen, the current selection or focus, and **now** — the today line on the Bench Forecast, and today's column on the timesheet grid, which are one signal in two geometries rather than two signals.

A signal points. It says where to act, what is selected, or where the viewer is in time. A signal is never a heading color and never indicates status, and a screen carrying a fourth kind of brand signal has one too many.

**Which page a person is on is not one of the three.** Location is not selection, so navigation items and segmented controls take a neutral active treatment. A neutral active state needs more than a fill to carry what a brand fill carried alone — separation from its own background, plus a change of label weight or color.

**The workspace mark is exempt.** A mark is not a signal; it is an identity, and rendering the workspace's own initial in the brand color is what a logo is for. Stated so that an audit does not keep reopening it.

**So an audit of brand on any screen sorts every instance into exactly one of three buckets:** a signal (at most three kinds), the workspace mark, or a defect.

**Amber is not in that audit at all.** Cost and idleness are amber — the bench region and the unrecovered figure — and they are not brand and not signals. They do not point at something elsewhere; they *are* the thing this product exists to surface. That is why the ration above no longer needs a clause exempting them.

#### The contrast exception, recorded because it is deliberate

**Brand pairs with white text everywhere it is filled** — buttons, badges, the today pill, the workspace mark. White on `#FF8000` measures **2.52:1**, below the 4.5:1 body and 3:1 large-text floor this document states below.

This was measured, flagged with the numbers, and **accepted by the founder in favor of one consistent orange**. It is not an oversight and must not be "corrected" to a darker step without asking. The alternative — a darker `brand-700` at rest — was rejected because it produces two different brand oranges on one screen depending on whether text sits on top.

**Where the exception does not apply:** brand as *text on a neutral surface* (`text-brand`, used for the unrecovered figure and today's date label) is not covered by it and is not a filled pairing. Brand as a 1px ring (`border-focus`) is a non-text control boundary reinforced by an offset, and is never the sole indicator of focus.

### Semantic

Three semantic hues. There is deliberately no fourth.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `success` | `#059669` | `#10B981` | Completed, approved, paid, resolved |
| `attention` | `#D97706` | `#F59E0B` | **Money not being recovered.** Bench time, capacity overcommitment, budget overrun, retainer overage, expiring credential |
| `danger` | `#DC2626` | `#EF4444` | Failed, rejected, blocked, destructive |

`attention` is the most important token in this product and the reason the palette is otherwise starved. Its canonical use is bench time on [[VRS-F005_The_Bench_Forecast|VRS-F005]]; every other use inherits that meaning. A designer applying `attention` to something that does not cost the business money is misusing it, and the resulting dilution is a product defect rather than a stylistic disagreement.

**A semantic color present in the resting state is not a signal.** The timesheet's remaining-hours figure was `attention` whenever anything at all was outstanding, so an untouched Monday — where nothing has happened and nothing is wrong — rendered in the color reserved for cost. A hue that appears by default has stopped carrying information. Any surface applying a semantic color must be able to state the condition under which it does *not*.

**The bench fill is its own token pair and does not vary by theme:** `bench-rest` `#F59E0B` and `bench-fill` `#FBBF24` on row hover, identical in light and dark. It is the `attention` hue in substance, but it is stated separately because a pale value that reads muted on white reads *bright* against a near-black canvas — the same failure this document already records for tinted composites. The bench is the one element where state, not theme, is what changes the color.

There is no separate "warning" hue. Soft, non-financial cautions — a probation date approaching, a certification nearing renewal — are expressed through weight and position, not color. They earn a place in a queue; they do not earn a hue.

### Categorical

Projects on the Bench Forecast and the Capacity Planner need distinguishable markers that carry no semantic weight. Assignment bars stay neutral; a 6px project dot inside each bar carries the categorical token. The tokens are drawn exclusively from the cool half of the wheel, which keeps them from ever being mistaken for a cost signal while preserving amber as the only large field of color.

| Token | Hex | Token | Hex |
|---|---|---|---|
| `cat-1` | `#3B82F6` | `cat-5` | `#0EA5E9` |
| `cat-2` | `#8B5CF6` | `cat-6` | `#A855F7` |
| `cat-3` | `#06B6D4` | `cat-7` | `#64748B` |
| `cat-4` | `#D946EF` | `cat-8` | `#EC4899` |

Assigned deterministically by hashing the Project's UUID, so a project is the same color on every device and for every user without storing a color on the node.

**Two exclusions, and the palette is what remains.**

| Excluded | Protects |
|---|---|
| The warm arc — red through yellow | `attention`, which is to say money |
| Green and teal | `success` |

The brand now sits inside the already-excluded warm arc. That makes the old separate brand-hue exclusion redundant while preserving its purpose: a project marker still cannot be confused with product identity or a cost signal.

**The consequence is that eight tokens cannot come from hue alone.** What survives the exclusions is about four distinguishable hue families — cyan, sky, blue and fuchsia — plus a hue-neutral slate. The remaining tokens are lightness steps within those families, and that is a deliberate consequence of the exclusions rather than a shortage of imagination.

**Categorical values may differ per theme,** like the semantic hues above and for the same reason: the same small dot must remain distinguishable against both neutral surfaces. A 600-level value in light and a 400-level value in dark holds a consistent weight in both.

### Semantic surface tokens

Components reference these, never raw ramp values. This is what makes theming a single switch.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `bg-canvas` | `#EFEFF0` | `#09090A` | The window. The sidebar sits directly on it |
| `bg-surface` | `neutral-0` | `#1A1A1B` | |
| `bg-raised` | `neutral-0` | `#1A1A1B` | |
| `bg-subtle` | `#F9F9FA` | `#111112` | The workspace inset |
| `bg-hover` | `#EFEFF1` | `#222223` | Calibrated against `bg-surface` |
| `bg-canvas-hover` | `#E8E8EB` | `#141416` | Hover for anything sitting on the canvas |
| `bg-active` | `#E6E6E9` | `#2A2A2E` | Selection. The strongest resting state |
| `bg-selected` | `#FEF2E7` | `#33210F` | Brand-tinted, per theme |
| `bg-column-header` | `#EBEBEE` | `#242427` | The Table's inset header strip |
| `bg-today` | brand @ 5% | brand @ 6% | Today's column body, mixed onto `bg-surface` |
| `bg-today-header` | brand @ 16% | brand @ 20% | Today's column header |
| `nonworking` | `#E9E9EB` | `#1E1E21` | Non-working-day shading, on row hover only |
| `border-default` | `#E7E7E9` | `#2A2A2B` | |
| `border-strong` | `neutral-300` | `#3F3F42` | Also the scrollbar thumb |
| `border-focus` | `brand-500` | `brand-500` | One orange, both themes |
| `text-primary` | `neutral-900` | `neutral-50` | |
| `text-secondary` | `neutral-600` | `neutral-400` | |
| `text-tertiary` | `neutral-400` | `neutral-500` | Also the scrollbar thumb on hover |
| `text-inverse` | `neutral-0` | `neutral-0` | |
| `text-brand` | `brand-500` | `brand-500` | One orange, both themes |
| `tag-*` | hue @ 16% | hue @ 22% | Badge fills — see Contrast floor |
| `tag-neutral` | `#EAEAED` | `#2E2E33` | Neutral tags carry no hue to tint |

Dark mode is a first-class theme, not an inversion. It is likely the majority mode for this audience and is specified with the same care as light. Theme preference is stored per user per device, defaults to system, and never syncs — a founder on a laptop at night and a phone at breakfast should not have to agree with themselves.

### Two rules about surface tokens, both learned by rendering

These are stated as rules because each was violated in more than one place before anyone noticed, and in both cases the symptom looked like a styling mistake rather than a systemic one.

**A hover state must never out-weigh the active state it previews.** Hover says *this is what selecting would do*; active says *this is selected*. Dark mode had this inverted — `bg-hover` was lighter than `bg-active`, so hovering an inactive row shouted louder than the row you were actually on. Any pair of these tokens must be orderable: canvas, then hover, then active, monotonically, in both themes.

**A token calibrated against one surface cannot be reused on another without being re-measured there.** `bg-active` was doing five jobs — the sidebar's active item, the Table's column-header strip, the Table's selected row, the Timeline's date pill and Badge's neutral tone. Four worked. On a Card the fifth was invisible, because dark `bg-active` and dark `bg-surface` were the same value, so the selected row was painted in exactly the color of the card beneath it.

The corollary is why `bg-canvas-hover` and `bg-column-header` exist as their own tokens rather than as reuses: **a state token may not stand in for a structural surface.** When a value needs to read on every surface a component can be placed on, it is structural, and it gets its own name.

### Elevation

Three levels. Only `overlay` casts a shadow; nothing else in this product does.

**The light recipe is a contact layer plus progressively wider, fainter layers**, each pulled in by a negative spread. Alpha *falls* as blur grows, because occlusion is strongest where two surfaces nearly touch. The first version raised alpha as blur grew — 0.04 at 4px rising to 0.12 at 48px — which is the inverse of how a shadow behaves and is most of what makes one read as cheap. Shadows are tinted `neutral-950` rather than pure black; a true-black shadow over a cool-neutral ramp reads muddy.

**Dark elevation is carried by the edge, not by the shadow.** A shadow cannot separate a near-black surface from a near-black canvas — there is no darker to fall back on. An overlay in dark is separated by its border plus an inset top rim catching the implied light, which is what gives a raised surface its lit leading edge. The dark layers beneath are for grounding and direction, not separation.

### Scrollbar

The scrolling surfaces this design system owns carry a token-driven scrollbar: **8px, `border-strong` thumb at `radius-full` resolving to `text-tertiary` on hover, transparent track.** The 8px is a structural dimension delegating to [[VPS-D002_Component_Library|VPS-D002]] rather than an addition to the space set below — it is the size of a piece of chrome, not spacing.

Both engines are styled, and that is a requirement rather than a detail: `scrollbar-width` / `scrollbar-color` for Gecko, the `::-webkit-scrollbar` pseudo-elements for Blink and WebKit. **Styling one and not the other looks correct only on the machine it was written on.** `thin` is Gecko's only expressible narrow width, so the two agree in intent rather than to the pixel; that is a platform limit, recorded rather than worked around.

Applied per surface, never as a global reset — a product decides which surfaces are its own.

### Contrast floor

All text meets WCAG AA — 4.5:1 for body, 3:1 for text above 18px and for interface controls — **with one recorded exception, stated below.** `text-tertiary` is permitted only for non-essential text that is never the sole carrier of meaning. Color is never the only channel for a state: every amber region carries a number, every red state carries a word.

**Table headers use `text-primary`.** They were `text-tertiary`, then `text-secondary`; at 11px, uppercase and tracked, on a filled strip, `text-secondary` still read as supporting text rather than as the label of a column. A column header is a load-bearing label.

A related defect worth stating as a rule: **an unsortable column header is not a disabled button, it is not a button.** Rendering it as one meant this document's own `:disabled` rule — 40% opacity — applied to it, so unsortable columns were drawn at 40% of the weight of the columns beside them. It read as a contrast failure in the type and was a control state leaking onto a label. **A control state must never be applied to something that is not a control.**

**Badge's subtle intensity is a per-theme tint with hue-derived ink**, not one alpha with `text-primary`. It was the hue at 10% in both themes and failed in each for a different reason: over white, 10% of a hue is a wash reading as no color at all; and `neutral` resolved to `bg-active`, which in dark was the same value as `bg-surface`, so a tag on a Card was invisible until a row hover moved the surface out from under it. The tint is now stated per theme and the ink is mixed from the same hue, so no new color enters the system and a tag reads as a status rather than as a gray chip that happens to be tinted.

**The exception: white on filled brand, at 2.52:1.** Buttons, badges, the today pill and the workspace mark all pair white text with `#FF8000`. This is below the floor, was measured and flagged before implementation, and was **accepted by the founder in favor of one consistent orange**. It is recorded here — in the section stating the rule — rather than only in the Brand section, so that no future audit finds the rule without finding its one sanctioned breach. Every other pairing in this product meets the floor.

---

## Typography

One product face, with two figure modes.

**Inter Variable** carries headings, interface, body and figures. It is compact enough for a professional operational tool without giving numbers a terminal voice. Numeric tokens enable tabular figures, so aligned data keeps stable digit widths without introducing a separate mono family.

### Scale

Base is 13px, not 16. The prototype showed the earlier 14px scale spending too much vertical and visual weight on repeated interface chrome. The denser scale keeps every operational fact visible without creating a second product density.

| Token | Size / Line | Face | Weight | Use |
|---|---|---|---|---|
| `display` | 32 / 40 | Inter | 640 | The single leading figure on a dashboard |
| `h1` | 22 / 28 | Inter | 600 | Page title |
| `h2` | 18 / 24 | Inter | 600 | Section heading |
| `h3` | 15 / 20 | Inter | 600 | Card and panel heading |
| `body` | 13 / 18 | Inter | 400 | Default |
| `body-medium` | 13 / 18 | Inter | 500 | Emphasis within body, table primary cell |
| `small` | 12 / 16 | Inter | 400 | Table secondary cell, helper text |
| `label` | 11 / 14 | Inter | 500 | Form labels, badges |
| `micro` | 11 / 14 | Inter | 560 | Column headers, eyebrows. Uppercase, `letter-spacing: 0.04em` |
| `numeric` | 12 / 16 | Inter tabular | 400 | Figures and IDs |
| `numeric-medium` | 12 / 16 | Inter tabular | 500 | A figure that must outweigh a label beside it at the same size |
| `numeric-md` | 15 / 20 | Inter tabular | 500 | A supporting figure in a group |
| `numeric-lg` | 18 / 24 | Inter tabular | 600 | The leading figure in a summary group |

Letter-spacing is `-0.01em` at `h2` and above, `0` at body sizes. Uppercase is permitted at `micro` only.

---

## Space

Four-pixel base unit. The full permitted set, and nothing between:

`0` · `1`=4 · `2`=8 · `3`=12 · `4`=16 · `5`=20 · `6`=24 · `8`=32 · `10`=40 · `12`=48 · `16`=64 · `20`=80

Component padding uses `2` and `3`. Space between related elements uses `2`. Space between groups uses `4` or `6`. Space between page sections uses `8`. A value of `5` or above inside a component is almost always a sign that something should be a separate component.

### Product geometry

One information-preserving density, and it is the product default everywhere. Product density is not an appearance preference: a second mode made the same interface expose different facts, while browser zoom already provides a device-level scale control. No screen may hide a role, identifier or other useful field to become denser.

| Element | Value |
|---|---|
| Table row height | 32px |
| Bench Forecast row height | 48px |
| Control height | 28px |
| Cell padding | `2` |

### Structural dimensions

The spacing scale governs gaps and padding; it is not a catalog of every legitimate layout dimension. Dimensions intrinsic to a reusable component are defined with that component in [[VPS-D002_Component_Library|VPS-D002]], and dimensions intrinsic to the shell are defined in [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]. This is an explicit delegation, not permission for feature-local values.

The current structural registry is: 200px expanded and 48px collapsed sidebar; 48px page header; 360px contextual panel; 220px Timeline identity column; 20px Timeline bars; 6px categorical dots; 24/28/32px Button heights; 20/24/32/40/48px Avatar sizes; and the Command Palette and Modal widths in [[VPS-D002_Component_Library|VPS-D002]]. Changes belong in the owning suite document before implementation.

---

## Border, radius and elevation

This is a flat product. That is an instruction about execution, not a license for laziness: with no shadows to lean on, separation must be achieved by border, spacing and contrast alone, which is harder and reads better.

**Borders are the primary structural device.** 1px, `border-default`. Every surface that needs to be distinguished from its container gets a border rather than a shadow or a fill.

**Radius** is small and consistent. Larger radii read as consumer software; zero radius reads as brutalist, which is a different aesthetic wearing the same clothes.

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 4px | Badges, chips, inline elements |
| `radius-md` | 6px | **Default.** Inputs, cards, bars |
| `radius-lg` | 8px | Modals, popovers, the contextual panel |
| `radius-xl` | 12px | The inset workspace panel |
| `radius-full` | 9999px | Avatars, pills, status dots, and Buttons |

### The concentric rule

> **A nested radius equals the outer radius minus the gap between them.**

Two rounded rectangles sharing a center are only concentric when this holds. Where it does not, the inner corner either bulges toward the outer one or floats inside it, and the result reads as an alignment error that nobody can name.

The scale above is 4 / 6 / 8 / 12 for this reason rather than by preference: each step is a legitimate nesting of the step above it at a `1` or `2` gap. The inset workspace panel is `radius-xl`; the contextual panel sits `1` inside it and therefore takes `12 − 4 = 8`, which is `radius-lg`.

**This governs nesting, not every pairing.** An element inset from its container by more than the container's radius has no concentric obligation — the arithmetic would give a negative value — and takes the radius its own component specifies. A Card inside a content region padded by `6` is the ordinary case.

**Elevation** has exactly three levels and only the third uses a shadow.

| Level | Treatment | Use |
|---|---|---|
| `flat` | No border, no shadow | Content directly on canvas |
| `raised` | 1px `border-default`, `bg-surface` | Cards, tables, panels, the Bench Forecast canvas |
| `overlay` | 1px `border-default`, `bg-raised`, `0 8px 24px rgb(0 0 0 / 0.08)` light, `0 8px 24px rgb(0 0 0 / 0.40)` dark | Only things that float above the page: command palette, modal, popover, dropdown, toast |

Nothing else in this product casts a shadow. There is no `hover` elevation change, no lifted card, no glow. Hover is expressed as `bg-hover`, and that is the whole vocabulary.

**Explicitly forbidden:** gradients of any kind, backdrop blur, glassmorphism, translucent panels over content, inner shadows, colored shadows, more than one border width, and decorative iconography. Each of these was available and each was declined.

### The one exception, scoped narrowly

> **A gradient may be used as an alpha mask at a scroll boundary, and nowhere else.**

Where a horizontally scrolling region passes beneath a frozen column — the Timeline's person column in [[VRS-F005_The_Bench_Forecast|VRS-F005]] is the only instance at present — the scrolling content fades out over roughly 24px rather than being cut off at the column's edge.

**This is information, not decoration.** A hard cut says the content ends. A fade says it continues, which is the fact the user needs in order to know there is more timeline behind the column.

Three conditions bound it, and all three are load-bearing:

1. **It is a `mask-image`, never a painted fill.** An alpha mask makes existing content transparent. A gradient *fill* would be a new colored surface, which is what the rule above forbids.
2. **It is never `backdrop-filter`.** A blur behind content is the glassmorphism this system declined, and it would be the same effect this exception exists to avoid needing.
3. **It applies at a scroll boundary only, never to a surface.** No panel, card, header, bar, region or background may carry a mask or a gradient of any kind. A surface that fades has no scroll boundary to explain and is decoration.

This exception may not be cited as general permission for gradients. It authorizes one treatment, at one kind of edge, for one stated reason.

---

## The dashed-border rule

One system-wide convention, worth stating separately because it unifies four otherwise unrelated features and prevents each inventing its own visual language:

> **A dashed border means "a placeholder for something that is not present."**

It applies to Ghost Resources on the Bench Forecast, which stand in for a person not yet hired ([[VRS-F007_Ghost_Resources|VRS-F007]]); to records aged out of the local retention window, which stand in for data that exists on the server but not on this device ([[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]]); to draft hiring records ([[VRS-F036_Opportunity-to-Draft_Hiring_Trigger|VRS-F036]]); and to any future concept that means the same thing. Solid means present. Dashed means expected. Nothing else is permitted to use a dashed border, because the moment it decorates, it stops informing.

---

## The signature principle

**Every application in this suite should have one moment people describe to other people, and it should be a number rather than a screen.**

That is the principle. What follows is Roster's instance of it, recorded here because it is the one this system was built around and because it shows what the principle means in practice.

### Roster's instance

On the Bench Forecast, an employee's bench period renders as a flat `attention`-tinted region with no border and no pattern. Left-aligned inside it, in `numeric-medium`, is the accumulated unrecovered salary cost for that gap. That figure is live: it recalculates as the working day advances, and it is one of very few elements in the suite permitted to change without user input.

It is not animated, it does not pulse, and it does not draw attention to itself in any conventional sense. It simply sits there, in the calmest interface the team could build, quietly counting up. **The restraint of everything around it is what makes it land.**

### What this asks of every other application

An application whose signature is a screen rather than a number has not found it yet. [[Vulto Projects]]' candidate is the margin figure on a live project, moving as timesheets arrive. [[Vulto Accounts]]' is the cash position.

**The color discipline exists to make these possible.** A suite where every application tints its own surfaces is a suite where none of these numbers can be found. Amber means money going wrong, in every application, or it means nothing anywhere.

That is this design system's entire purpose, and every rule above exists to protect it.

---

## Related Notes

- [[VPS-D002_Component_Library|VPS-D002]] — the components built from these tokens
- [[VPS-D003_Interaction_Motion_and_Keyboard_Model|VPS-D003]] — interaction, motion and the keyboard model
- [[VPS-D004_Application_Shell_Navigation_and_System_States|VPS-D004]] — application shell, navigation and system states
- [[VRS-F005_The_Bench_Forecast|VRS-F005]] — the Bench Forecast, whose amber gap this system is built around
- [[VPS-000_Documentation_Standard|VPS-000]] — the Documentation Standard

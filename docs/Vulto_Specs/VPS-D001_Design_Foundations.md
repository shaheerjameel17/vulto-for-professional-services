---
Type:
  - Vulto for Professional Services Specs
Date: "[[2026-08-07]]"
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

This document is the single source of truth for every color, typeface, size, space and border in [[Vulto for Professional Services]]. **No feature document, in any application, may introduce a value not defined here.**

An operating system for professional services firms that looks like nine different products is not an operating system.

---

## The thesis

A founder opens these products before they open their email, the way they check a bank balance. That single sentence determines the entire visual system.

A bank balance is not designed to be admired. It is designed to be read in two seconds, trusted completely, and to make you feel something specific when the number is wrong. Every interface in [[Vulto for Professional Services]] has the same job: it must be so quiet that a bad number is impossible to miss.

This produces the governing rule of the whole system, which every other decision in this document serves:

> **The interface is deliberately color-starved so that money is the only thing on screen with a hue.**

Ninety percent of any Roster screen is neutral. The warm half of the color wheel — amber and red — is reserved exclusively for cost, idleness and failure. The cool half is available for small categorical markers such as project dots, never large fills. The brand color appears at most twice per screen. There are no decorative gradients anywhere in this product, no glass, no blur, no decorative depth, and no color used because a surface looked empty. A gradient used only to communicate a horizontal scroll boundary is the sole exception and carries no decorative color.

When a designer or an engineer wants to add color, the question is not "does this look better" but "is this about money going wrong". If it is not, it is neutral.

---

## Color

### Neutral ramp

Zinc, cool-neutral, chosen because it sits under Indigo without the palette drifting toward navy, and because a warm gray would compete with amber at exactly the moment amber needs to win.

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

Indigo. `brand-500` `#6366F1` is the anchor, per founder decision.

| Token | Hex | Token | Hex |
|---|---|---|---|
| `brand-50` | `#EEF2FF` | `brand-500` | `#6366F1` |
| `brand-100` | `#E0E7FF` | `brand-600` | `#4F46E5` |
| `brand-200` | `#C7D2FE` | `brand-700` | `#4338CA` |
| `brand-300` | `#A5B4FC` | `brand-800` | `#3730A3` |
| `brand-400` | `#818CF8` | `brand-900` | `#312E81` |

**Brand color is rationed.** It marks exactly three things: the primary action on a screen, the current selection or focus, and the today line on the Bench Forecast. It is never a background fill for a large region, never a heading color, and never used to indicate status. A screen showing brand color in four places has three too many.

**Which page a person is on is not one of the three.** Location is not selection, so navigation items and segmented controls take a neutral active treatment. A neutral active state needs more than a fill to carry what a brand fill carried alone — separation from its own background, plus a change of label weight or color.

**The workspace mark is exempt.** The three uses above are *signals*: they tell a person where the action is, what is selected, and where today falls. A mark is not a signal, it is an identity, and rendering the workspace's own initial in the brand color is what a logo is for. This exemption is stated so that an audit of brand usage does not keep reopening it — the rule is about signals, and the mark is not competing with them.

### Semantic

Three semantic hues. There is deliberately no fourth.

| Token | Light | Dark | Meaning |
|---|---|---|---|
| `success` | `#059669` | `#10B981` | Completed, approved, paid, resolved |
| `attention` | `#D97706` | `#F59E0B` | **Money not being recovered.** Bench time, capacity overcommitment, budget overrun, retainer overage, expiring credential |
| `danger` | `#DC2626` | `#EF4444` | Failed, rejected, blocked, destructive |

`attention` is the most important token in this product and the reason the palette is otherwise starved. Its canonical use is bench time on [[VRS-F005_The_Bench_Forecast|VRS-F005]]; every other use inherits that meaning. A designer applying `attention` to something that does not cost the business money is misusing it, and the resulting dilution is a product defect rather than a stylistic disagreement.

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

**Three exclusions, and the palette is what remains.**

| Excluded | Protects |
|---|---|
| The warm arc — red through yellow | `attention`, which is to say money |
| Green and teal | `success` |
| **The brand's own hue band** | The brand. A project marker must never read as a brand element |

The third exclusion is the one that took rendering to find. Indigo 500 sits at hue 239°, and two categorical tokens sat inside its band — one at 258° and one at 271°. On screen they did not read as arbitrary project colors; they read as though the interface were trying to say something. Excluding roughly 225°–280° is what closes that.

**The consequence is that eight tokens cannot come from hue alone.** What survives all three exclusions is about four distinguishable hue families — cyan, sky, blue and fuchsia — plus a hue-neutral slate. The remaining tokens are lightness steps within those families, and that is a deliberate consequence of the exclusions rather than a shortage of imagination.

**Categorical values may differ per theme,** like the semantic hues above and for the same reason: the same small dot must remain distinguishable against both neutral surfaces. A 600-level value in light and a 400-level value in dark holds a consistent weight in both.

### Semantic surface tokens

Components reference these, never raw ramp values. This is what makes theming a single switch.

| Token | Light | Dark |
|---|---|---|
| `bg-canvas` | `#EFEFF0` | `neutral-950` |
| `bg-surface` | `neutral-0` | `neutral-900` |
| `bg-raised` | `neutral-0` | `neutral-800` |
| `bg-subtle` | `#F9F9FA` | `neutral-800` |
| `bg-hover` | `neutral-100` | `neutral-800` |
| `bg-selected` | `brand-50` | `brand-900` |
| `border-default` | `neutral-200` | `neutral-800` |
| `border-strong` | `neutral-300` | `neutral-700` |
| `border-focus` | `brand-500` | `brand-400` |
| `text-primary` | `neutral-900` | `neutral-50` |
| `text-secondary` | `neutral-600` | `neutral-400` |
| `text-tertiary` | `neutral-400` | `neutral-500` |
| `text-inverse` | `neutral-0` | `neutral-950` |
| `text-brand` | `brand-600` | `brand-400` |

Dark mode is a first-class theme, not an inversion. It is likely the majority mode for this audience and is specified with the same care as light. Theme preference is stored per user per device, defaults to system, and never syncs — a founder on a laptop at night and a phone at breakfast should not have to agree with themselves.

### Contrast floor

All text meets WCAG AA — 4.5:1 for body, 3:1 for text above 18px and for interface controls. `text-tertiary` is permitted only for non-essential text that is never the sole carrier of meaning. Color is never the only channel for a state: every amber region carries a number, every red state carries a word.

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

One information-preserving density. Product density is not an appearance preference: a second mode made the same interface expose different facts, while browser zoom already provides a device-level scale control. No screen may hide a role, identifier or other useful field to become denser.

| Element | Value |
|---|---|
| Table row height | 32px |
| Bench Forecast row height | 48px |
| Control height | 28px |
| Cell padding | `2` |

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

On the Bench Forecast, an employee's bench period renders as a flat `attention`-tinted region with no border and no pattern. Left-aligned inside it, in `mono-lg`, is the accumulated unrecovered salary cost for that gap. That figure is live: it recalculates as the working day advances, and it is one of very few elements in the suite permitted to change without user input.

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

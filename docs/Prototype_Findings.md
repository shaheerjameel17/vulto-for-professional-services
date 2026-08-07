# Prototype Findings

**Status:** Open log, maintained during the prototype build.
**Purpose:** Record every defect, ambiguity and contradiction found in the specification set by rendering it, so corrections go back into the document that owns the fact.

This file is not a specification and is deliberately outside `docs/Vulto_Specs/`. It is a worklist. A finding leaves this log when the owning document is corrected, and it names that document rather than describing a workaround.

**Nothing here has been fixed in the specifications.** Two exceptions were closed by founder decision during the build and are recorded at the bottom.

---

## Status of each finding

| | Finding | Owner document | State |
|---|---|---|---|
| F1 | Sidebar navigation is not specified | `VPS-D004` | **Closed by decision** — five destinations, two groups |
| F2 | No day-column width for the Timeline | `VPS-D002` | Provisional in build |
| F3 | Bench cost figure has no specified color | `VPS-D001` | Provisional in build |
| F4 | "Counting up" contradicts the stated formula | `VPS-D001` | **Closed by decision** — prose changes |
| F5 | Restricted bench region: three overlapping treatments | `VRS-F005` | Provisional in build |
| F6 | `billing_rate_default` cost fallback contradicts itself | `VRS-F005` | Provisional in build |
| F7 | Timeline row separators unspecified | `VPS-D002` | Provisional in build |
| F8 | Summary row vs. 56px page header | `VRS-F005` | Provisional in build |
| F9 | Specified color pairings fail the contrast floor | `VPS-D001`, `VPS-D002` | Open, visible on screen |
| F10 | Three dark surface tokens are the same color | `VPS-D001` | Open, visible on screen |
| F11 | Timesheet responsive breakpoint contradiction | `VPS-D003`, `VRS-F010` | Open |
| F12 | `Cmd+D` fill semantics ambiguous | `VPS-D003`, `VRS-F010` | Open |
| F13 | `G` `D` missing from the global shortcut table | `VPS-D003` | Open |
| F14 | Ghost "reduced-opacity" is not a defined treatment | `VRS-F007` | Open |
| F15 | Ghost bar cites the wrong shared treatment | `VRS-F007` | Open |
| F16 | Standing Rule 6 mislabels the language convention | `VPS-000` | **Closed by decision** — American English |
| F17 | App directory named two ways | `VPS-A001` | **Closed by decision** — `apps/roster-web` |
| F18 | `VPS-F002` indexed-fields table is malformed | `VPS-F002` | Open |
| F19 | `VPS-D001` cannot express the structural dimensions other documents use | `VPS-D001` | **New** |
| F20 | No document names the default density | `VPS-D001` | **New** |
| F21 | `VPS-D002`'s blanket hover rule cannot apply to `primary` | `VPS-D002` | **New** |
| F22 | Badge has no neutral tone, but two features need one | `VPS-D002` | **New** |
| F23 | Two groups for five items may be worse than none | `VPS-D004` | **New**, look-at-it |
| F24 | 56px page header cannot stack an `h1` and a subtitle | `VPS-D004` | **New** |
| F25 | Panels cannot trap focus and also be dismissed by the canvas | `VPS-D002` | **New** |
| F26 | Window position relative to today is unspecified | `VRS-F005` | **New** |
| F27 | Bench cost has no annual denominator | `VRS-F005` | **New** |
| F28 | Left column content does not fit its own row at compact density | `VRS-F005`, `VPS-D001` | **Closed by FDN-11/12**, provisional |
| F29 | Bench region has no specified height | `VPS-D002` | **New** |
| F30 | Aggregate utilization has no formula on the screen that displays it | `VRS-F005` | **New** |
| F31 | The bench region is specified as patternless and is drawn over a pattern | `VPS-D001`, `VPS-D002` | **Closed by FDN-12**, verified |
| F32 | The amber is weak in light mode and strong in dark | `VPS-D001` | **Closed by FDN-12**, pending candidate |
| F33 | Categorical bars outshout the amber in dark mode | `VPS-D001` | **Closed by FDN-12** |
| F34 | The categorical palette's exclusions were understated | `VPS-D001` | **Rule restated in `VPS-D001`**; palette pending a choice |
| F35 | Bar labels at `text-inverse` fail on mid-tone categorical fills | `VPS-D002` | **Closed by FDN-12**, verified |
| F36 | The amber saturates at the 180-day horizon | `VRS-F005` | **Half closed**, see below |
| F37 | A quiet bar's opaque fill does not follow its own row's backdrop | `VPS-D002` | **Closed by FDN-16**, verified |
| F38 | In light mode the canvas and the surface are 1.04:1 apart | `VPS-D001` | **Corrected in `VPS-D001`** |
| F39 | Non-working shading may now be below the threshold of perception | `VPS-D001` | **Closed**, middle value |
| F40 | The type scale has twelve tokens; `VPS-D001` said eleven | `VPS-D001` | **Settled at twelve, `VPS-D001` amended** |
| F41 | Table and Timeline disagree about what row hover looks like | `VPS-D002` | **Stated in `VPS-D002`** as a Timeline affordance |
| F42 | At the design center the Panel hides a third of the canvas either way | `VPS-D003`, `VRS-F005` | **New**, measured |
| F43 | Brand appears on the workspace mark, a fourth use | `VPS-D001` | **Exempted in `VPS-D001`** |
| F44 | The mono family's suffixes mean two different things | `VPS-D001` | **New**, introduced by FDN-20 |
| F45 | The Employee profile's Screens table names a Panel with nothing for it to show | `VRS-F002` | **New** |
| F46 | Tabs.Trigger's label, wrapped in Text as a nested span, gave the tab an empty accessible name | `VPS-D002` | **Closed**, fixed in Tabs |
| F47 | `VRS-F002` contradicted itself: permanent Inputs in prose, open/close-an-edit in the keyboard table | `VRS-F002` | **Closed**, keyboard model kept |
| F48 | `VPS-D002`'s Input has no affix contract; suffixed number fields overlap their own spinner | `VPS-D002` | **Closed**, affix contract added |
| F49 | `InputProps`' own `prefix` collided with `HTMLAttributes`' RDFa `prefix?: string` | — | **Closed**, `prefix` omitted alongside `className` |
| F50 | People was a name-and-role list, not `VRS-F002`'s Table directory | `VRS-F002` | **Closed**, built as `VPS-D002`'s Table |
| F51 | F9 at Table scale: a directory is nothing but column headers doing load-bearing work at 2.6:1 | `VPS-D002` | **Recorded, not patched** — resolves with FDN-9 |
| F52 | Profile tabs were underlined beside pill segmented controls on the same screen | `VPS-D002` | **Closed**, Tabs and Toggle Group unified as one treatment |

---

## New findings, in detail

Findings F1–F18 were reported before the build and are recorded above. What follows is what rendering the documents produced.

### F19 — `VPS-D001` cannot express the structural dimensions other documents use

`VPS-D001` declares itself "the single source of truth for every color, typeface, size, space and border" and states that "no feature document, in any application, may introduce a value not defined here." Its space set is the twelve four-pixel steps.

`VPS-D002` and `VPS-D004` then introduce, directly and necessarily: 240px and 48px sidebar widths, 360px panel, 56px page header, 220px and 160px timeline label columns, 200px timesheet label column, 640px palette, 480px and 640px modals, 20px and 24px bar heights, 20/24/32/40 avatar sizes, 24/28/32 button heights, 20px badge height, 16px controls, and a 6px dot. Most are not expressible in `VPS-D001`'s set, and 6px is not a multiple of the four-pixel base at all.

These are layout dimensions, not spacing, and they are legitimate. But `VPS-D001`'s authority claim is currently false as written, which means an implementer either violates it or invents a second home for these values.

**Proposed correction:** `VPS-D001` gains a Structural dimensions section that either enumerates them or explicitly delegates them to `VPS-D002` and `VPS-D004`, and its authority sentence is narrowed accordingly. In the build they live in `packages/tokens` with a per-value citation.

### F20 — No document names the default density

`VPS-D001` says density is a "workspace default with a per-user override" and never says which mode is the default. `VPS-002` names "a 14px base with 32px rows" as the thing to look at, which is compact.

The prototype defaults to compact on that basis.

### F21 — `VPS-D002`'s blanket hover rule cannot apply to `primary`

`VPS-D002`'s Button section gives four variants and then one hover rule for all of them: "Hover is `bg-hover`; there is no elevation change." `bg-hover` is `neutral-100` in light and `neutral-800` in dark. Applying it to `primary`, which is filled `brand-600`, turns an indigo button gray on hover. The same problem applies to a confirming `danger` button.

`VPS-D001` separately states that hover "is expressed as `bg-hover`, and that is the whole vocabulary," so there is no sanctioned alternative.

**Proposed correction:** `VPS-D002` states a hover treatment per variant. The build uses `brand-700` for `primary` provisionally.

### F22 — Badge has no neutral tone, but two features need one

`VPS-D002` gives Badge two intensities and requires that "status badges take their color from the semantic tokens exclusively" and that "a badge is never `brand`." Three semantic tokens exist.

`VRS-F002` badges employment type and status in the People directory. `VRS-F007` specifies a `Ghost` Badge in subtle intensity. None of those is a semantic state — an employment type of Contractor is not a success, an attention or a danger — and there is no fourth tone to use.

**Proposed correction:** `VPS-D002` adds a neutral tone for non-semantic categorization, and says plainly that the semantic-only rule governs status badges specifically. The build uses `bg-subtle` with `text-secondary`.

### F23 — Two groups for five items may be worse than none

`VPS-D004` requires navigation be "grouped by role relevance rather than by feature taxonomy" and gives no group-header treatment and no threshold below which grouping stops earning its keep.

Rendered with the five agreed destinations under **Work** and **Waiting**, the two `micro` uppercase headers occupy vertical space and visual weight comparable to the items they organize. At five items the grouping is arguably taxonomy for its own sake — the exact failure the rule was written to prevent, arrived at from the other direction.

**This is a look-at-it question, not a defect.** Recorded rather than resolved, per the founder's instruction.

### F24 — 56px page header cannot stack an `h1` and a subtitle

`VPS-D004` specifies a 56px page header "containing the page title at `h1`, an optional `small` subtitle carrying the most useful context for that screen." An `h1` at 24/30 above a `small` at 13/18 is 48px of text in a 56px band, leaving 4px above and below.

`VPS-D004` does not say the two are stacked. The build sets them inline on a shared baseline, which fits.

**Proposed correction:** `VPS-D004` states the arrangement explicitly, or raises the header height.

### F25 — Panels cannot trap focus and also be dismissed by the canvas

`VPS-D002`'s accessibility floor states that "modals and panels trap focus and restore it to the trigger on close." For the Panel this cannot be implemented as written, and should not be:

- `VPS-D004` requires the Panel be dismissible "by clicking the canvas," which presumes the canvas is reachable.
- `VPS-D004` requires Panel state persist across selections within a screen.
- `VRS-F005` requires `J`/`K` row navigation, and the Panel exists precisely so a user can move down the rows with it open.

A focus trap makes the surface the Panel annotates unreachable by keyboard. The Panel is non-modal; the rule is correct for Modal only.

**Proposed correction:** `VPS-D002` scopes the focus trap to Modal, and specifies focus restoration alone for Panel. The build implements restoration and no trap.

### F26 — Window position relative to today is unspecified

`VRS-F005` gives three horizons and a `T` shortcut to "scroll today into view," which implies today can be off-screen and therefore that the window extends before it. Nothing says by how much.

The build carries a 14-day lead-in.

### F27 — Bench cost has no annual denominator

`VRS-F005` requires accumulated cost be `bench working days × daily cost`, "where daily cost derives from the employee's compensation." `VRS-F002`'s `base_compensation_amount` is annual, monthly or hourly per `compensation_frequency`.

Converting an annual figure to a daily one needs a count of working days in a year. No document provides one. `VRS-F004` provides `standard_daily_hours` for hour-level proration and no annual day count. `VRS-F062` owns payroll proration and is thirty features later, so MVP feature five cannot defer to it.

This matters more than its size suggests: it is the denominator of the number the product is most trusted to get right, and an implementer will otherwise reach for 260.

**Proposed correction:** `VRS-F004` exposes an annual working-day count per employee, since it is the only feature permitted to know. The build counts it from the mocked index, which yields about 252 for the London calendar and 278 for Karachi.

### F28 — Left column content does not fit its own row at compact density

Measured in the browser, not inferred.

`VRS-F005` specifies the left column as "avatar, name at `body-medium`, role at `small` in `text-secondary`." `VPS-D001` sets the Bench Forecast row to 36px at compact density.

`body-medium` is 14/20 and `small` is 13/18. Stacked, that is **38px of text in a 36px row.** Measured: `rowHeight: 36, labelStackHeight: 38`. The role line bleeds into the neighboring row and the whole left column reads as vertically misaligned against the bars, which is visible immediately at compact density and absent at comfortable.

This is the closest thing in the set to the failure `VPS-002` predicted: a density decision and a content decision made in two documents that do not survive each other.

**Proposed correction:** one of — the compact Bench Forecast row rises to 40px; the role line drops at compact density as it already does below 1280px; or the two lines share a line-height budget. This is a founder decision about what compact density is for.

### F29 — Bench region has no specified height

`VPS-D002` gives the assignment bar a height (20px compact, 24px comfortable) and the bench region none. The build fills the row height, so the region reads as a region rather than as an object sitting in a lane, but nothing in the documents says so.

### F30 — Aggregate utilization has no formula on the screen that displays it

`VRS-F005` puts agency-wide utilization on the Forecast as "a single `display` figure" — the largest number on the canvas — and never states how it is computed. `VRS-F011` owns utilization computation and is a later feature, so there is nothing to call.

`VRS-F007` G08 additionally requires the Ghost contribution be reported separately, which constrains the shape of the answer without supplying it.

**Proposed correction:** `VRS-F005` either states the formula or defers the figure until `VRS-F011` exists. The build uses covered working days weighted by `billable_percentage` over total working days, with the Ghost contribution shown beside it.

### F31 — The bench region is specified as patternless and is drawn over a pattern

`VPS-D001`: the bench period renders as "a flat `attention`-tinted region with no border and no pattern." `VPS-D002`: "flat `attention` at 12% fill, no border."

`VRS-F005` separately requires non-working days render `bg-subtle`. Those columns sit underneath the bench region, and a 12% fill is transparent, so the weekend shading shows through and produces a repeating vertical stripe across every amber region — exactly the pattern both documents forbid.

Measured composite in light mode: `rgb(250, 239, 225)` over a working column against `rgb(241, 229, 216)` over a non-working one. The step repeats every five days in London and every six in Karachi, and at the 180-day horizon, where a day column is 12px, it reads as dense hatching.

**Proposed correction:** state which layer wins. Either the bench region is opaque and occludes the working-day shading, or the shading is suppressed inside a bench region, or the region's fill is composited against `bg-surface` regardless of what is beneath it. This is a real decision, not a rendering detail — the signature element's flatness is the thing being protected.

### F32 — The amber is weak in light mode and strong in dark

A look-at-it finding, and the most important one.

`attention` at 12% over white composites to `rgb(250, 239, 225)` — a pale peach that reads as an absence of color rather than a warning. In dark mode the same 12% of `#F59E0B` over `neutral-900` produces a distinctly warm band that carries real weight.

The signature element currently lands in dark mode and does not land in light. `VPS-D001` says dark is "likely the majority mode for this audience," so this may be acceptable — but it is the opposite of what a founder checking a bank balance in a bright office would experience, and the fill percentage was specified once for both themes.

**Proposed correction:** a per-theme fill percentage, in the same way the hue itself is per-theme. Candidate: 12% dark, 20–24% light. Worth deciding by looking rather than by arithmetic.

### F33 — Categorical bars outshout the amber in dark mode

`VPS-D001`'s governing rule: "The interface is deliberately color-starved so that money is the only thing on screen with a hue," and "ninety percent of any Roster screen is neutral."

In dark mode the categorical bars are full-saturation `cat-n` on a near-black canvas, and they are by a wide margin the loudest thing on screen — louder than the amber they exist not to compete with. The Forecast in dark mode reads as a chart of colorful projects with some warm patches, which inverts the intended hierarchy.

Light mode holds the hierarchy better, because a saturated bar on white is less dominant than the same bar on `neutral-950`.

**Proposed correction:** consider a per-theme treatment for `cat-n` fills — a reduced opacity or a darkened ramp in dark mode — so the categorical layer sits below the amber in both themes. This is the same shape of problem as F32 and probably has the same answer.

### F34 — `cat-4` and `cat-8` do not read as cool

`VPS-D001` states the categorical palette is "drawn exclusively from the cool half of the wheel, which is the system rule that keeps them from ever being mistaken for a cost signal," and that "everything warm is excluded to protect `attention`."

`cat-4` is `#D946EF` and `cat-8` is `#EC4899`. Both are magenta-to-pink and read as warm on screen. `cat-4` in particular, rendered as a wide assignment bar, is the most aggressive color on the canvas.

They will not be mistaken for amber specifically. But the stated rule is not what the palette does.

**Proposed correction:** either replace the two with genuinely cool hues, or restate the rule as excluding the amber-to-red arc rather than the whole warm half.

### F35 — Bar labels at `text-inverse` fail on mid-tone categorical fills

`VPS-D002` specifies the assignment bar's label as "inside at `small` `text-inverse`." `text-inverse` is `neutral-0` in light and `neutral-950` in dark — that is, it flips with the theme while the `cat-n` fill beneath it does not.

On `cat-7` (`#64748B`, slate) the result is white on mid-gray in light mode and near-black on mid-gray in dark mode. Both are marginal, and the dark case is the worse of the two — visible on screen on the Tandem Discovery bars.

**Proposed correction:** the bar label color is chosen per categorical token against its own fill, not inherited from the theme. `VPS-A007`'s contrast gate will fail this on every rendered surface that draws a bar.

### F36 — The amber saturates at the 180-day horizon

`VRS-F005` added the 180-day horizon because "the hiring decisions this forecast is meant to inform have a lead time longer than ninety days."

At 180 days almost nobody has confirmed assignments covering the back half of the window, so almost every row carries a large bench region and the screen is mostly amber. In the prototype's data, 15 of 15 people show bench time at 180 days against 13 of 15 at 90, and the total accumulated figure moves from £59,170 to £245,916.

The number is arithmetically correct and operationally misleading. Being unassigned five months out is the normal state of a professional services firm, not £245,916 of unrecovered cost. A screen that is mostly amber has lost the thing amber is for, which is the concern `VPS-D001` raises about dilution — arriving here not from misuse but from a horizon change.

**This is a look-at-it question.** Options include suppressing the cost figure beyond a confidence boundary, showing bench days without cost at the 180-day horizon, or accepting it because the user chose that horizon deliberately.

---

## FDN-11 and FDN-12 — what changed, and what the changes closed

Both were token-layer changes only. No screen logic was touched beyond the two
items explicitly in scope, F28 and F36.

### FDN-11 — two faces

Inter Variable replaces both Plus Jakarta Sans and Manrope. Geist Mono stays for
figures. `VPS-D001` goes from three faces to two, and its typography section
needs rewriting accordingly.

**Loaded as a variable font, and it matters.** The scale now asks for weight 560
at `micro` and 640 at `display` and `h1`. Verified in the browser as 560 and 640
rather than rounded to 500 and 600, which is what a static build would have done
silently.

**The line-height re-derivation produced exactly one change, and that is the
finding.** Inter's content box is 1.21em, against Manrope's 1.29em and Plus
Jakarta Sans' 1.28em — Inter is the tighter face vertically despite the taller
x-height, so every line height in the old scale already cleared it. The single
exception was `display`, where 32/36 was 1.125 and had been sitting inside Plus
Jakarta Sans' own content box too. It moves to 32/40.

That is worth recording because the expectation going in was that a face swap
would ripple through the vertical rhythm, and it did not. The real change was
horizontal.

**Tracking was re-derived from Inter's own dynamic-metrics curve,**
`-0.0223 + 0.185 · e^(-0.1745 · size)`, which yields −0.022em at 32px, −0.020em
at 24px and −0.017em at 20px, crossing zero at about 12px. Applied above 20px
only, per the decision to tighten the display sizes and leave the body sizes
alone. The old scale used a flat −0.01em at `h2` and above, which was roughly
half of what Inter wants at display sizes.

**One exception carried forward:** `micro` keeps +0.04em. That is `VPS-D001`'s
uppercase treatment rather than a metric inherited from Manrope, and uppercase
needs the tracking at 11px.

### FDN-12 — the color weight, inverted

The assignment bar's hue moved to a 2px `cat-n` left edge, its fill went quiet
and opaque, and its label became `text-primary`. The bench region became a solid
color chosen per theme.

**Three candidates each, chosen by looking.** Switchers at the sidebar foot, and
a side-by-side strip at the top of `/foundations`. Bench: `restrained`,
`present`, `assertive`. Bar: `hairline` (no hue in the fill at all), `wash`,
`tint`.

**The mechanism that closed F31 was opacity, not color.** Both fills are now
opaque — the bench region is a solid token, and the bar mixes `cat-n` with the
surface via `color-mix` rather than layering an alpha. Verified: the bench region
computes to `rgb(78, 58, 28)` in dark with no alpha channel, and the bar to an
`oklab()` value with none. Nothing beneath either can show through, so the
non-working-day striping is gone.

### F34 survives, and should be recorded as surviving

`cat-4` (`#D946EF`) and `cat-8` (`#EC4899`) are unchanged, so `VPS-D001`'s claim
that the categorical palette is drawn "exclusively from the cool half of the
wheel" is still not what the palette does.

What changed is only the symptom. At a 12–30% mix behind a 2px edge, a magenta
that was the most aggressive element on the canvas is now a pale lilac wash, and
the practical risk of confusing it with a cost signal is largely gone.

**The documentation defect is untouched.** Either the two tokens are replaced
with genuinely cool hues, or the rule is restated as excluding the amber-to-red
arc rather than the whole warm half. FDN-12 removed the pressure to decide; it
did not decide.

### F36 is half closed

The cost figure now renders only for bench regions beginning within 45 days, and
the header total says which window it counts. Verified at the 180-day horizon:
regions beyond the boundary show `76d` and `80d` in quiet `mono` with no figure,
and the header reads "£59,637 unrecovered in the next 45 days".

**Two parts of the original finding are untouched.**

**The magnitude is still unbounded.** The rule as specified gates *which* regions
carry a figure, not *how much* of a region counts. Lena Petrova's assignment ends
inside the boundary, so her gap begins inside it and is costed in full — about
115 working days and £23,351 at the 180-day horizon. The workspace total also
still grows with the horizon, from £46,016 at 90 days to £59,637 at 180, because
regions that begin inside the boundary simply extend further as the window does.

Bounding the magnitude means truncating a gap's cost at the 45-day line, which
says something about that gap that is not true — the cost does not stop at day
45. This is the genuine trade-off, and it is a founder decision rather than an
implementation one.

**The visual saturation is unchanged.** At 180 days most of the canvas is still
amber, because the regions are still drawn; only their figures went away. F36 as
scoped addressed the number, not the color. If the concern was that a
mostly-amber screen has lost what amber is for, that concern still holds.

### F37 — new, introduced by FDN-12

A quiet bar's fill is an opaque mix against `bg-surface`. A row's backdrop is not
always `bg-surface`: it is `bg-hover` on hover and `bg-selected` on selection.

Measured in light mode: `--vt-bar-base` is `#ffffff` while a hovered row is
`#f4f4f5` and a selected row is `#eef2ff`. So a bar on a hovered or selected row
carries a fill mixed against the wrong backdrop and reads as slightly detached
from the row it belongs to — most visible on the selected row, where the brand
tint is furthest from the surface.

This did not exist before FDN-12 because a fully saturated bar had no backdrop
dependency. It is the cost of making the fill opaque, and opacity is what closed
F31, so it is worth paying rather than reverting.

**Proposed correction:** the mix base follows the row state rather than being
fixed to `bg-surface` — which means `VPS-D002` has to say that a quiet fill
composites against its own row, not against the canvas.

---

## FDN-15 and FDN-16 — what changed

### FDN-16 — shell architecture

One continuous `bg-canvas` across the window. The sidebar lost its surface and
its right border and now sits directly on that canvas. The workspace is an inset
panel — `radius-lg`, a 1px `border-default`, space-3 margin on all four sides —
and the page header lives inside it. The contextual Panel moved inside the inset
too, so it is clipped by the same rounded corners: it is part of the workspace
rather than a third region floating beside it.

The Timeline lost its own `raised` elevation as a direct consequence. A bordered
canvas inside a bordered inset panel is the nested card `VPS-D002` forbids, and
the workspace is now the raised surface.

Segmented controls became pills, applied once on `ToggleGroup` so it reaches the
horizon toggle, Owner/Manager, density, theme and the candidate switchers
together. Buttons keep `radius-md` — the distinction is between a control you set
and an action you take. **Note on scope:** the Filters and Today controls are
`ghost` Buttons rather than segmented controls, so they kept `radius-md`. If
those were meant to be the "filter chips", say so and they move.

Comfortable is the default density. The mechanism is unchanged — still one data
attribute on the root, still no component branching on it.

### F37 is closed by construction, and verified

Row hover and selection are now a border on the whole row rather than a
background fill. Measured: the row's own background is `rgba(0, 0, 0, 0)`, the
label column's is unconditionally `bg-surface`, and `--vt-bar-base` and
`--vt-bg-surface` resolve to the same value. A quiet bar's opaque mix is
therefore always mixing against what is actually behind it.

**Selection had to move too, and that goes beyond what was asked.** Changing
hover alone would have left `bg-selected` breaking the same bars on the selected
row, so F37 would have survived. `VPS-D001` already assigns brand to "the current
selection or focus", so a 1px `brand-500` border is the reading that follows from
the existing rule rather than a new one.

**One implementation note worth recording.** The border is an absolutely
positioned overlay inside the row, not an `outline` on the row itself. The sticky
label column paints its own background over anything the row draws beneath it,
which would have broken the border exactly where the person column meets the
timeline — the join the change exists to make visible.

### FDN-15 — the bench region became a bar

Same `radius-md` as an assignment bar, on the same plane, so a row reads as a
sequence of periods rather than as bars floating in a tinted cell.

**The amber is chosen per theme, not mixed.** `#F59E0B` (amber-500) in light,
`#FBBF24` (amber-400) in dark. The step between them follows `VPS-D001`'s own
pattern for its semantic hues — `attention` goes 600 to 500 between themes,
because a near-black field needs more luminance to carry the same perceived
weight — so the bench amber goes 500 to 400 for the same reason.

Mixing against the surface is what produced tan in light and olive in dark. It
was never going to produce amber, because the surface was in the mix.

The figure sits on the amber at 9.26:1 in light and 11.92:1 in dark, so it is
comfortably legible in both.

**Two height variants, switchable at the sidebar foot.**

| | Bench bar | Assignment bar | Row | Figure |
|---|---|---|---|---|
| `match` | 24px | 24px | 44px | `mono-medium`, 13/18/500 |
| `tall` | 32px | 24px | 44px | `mono-lg`, 20/26/600 |

`match` is the one that delivers the stated intent — one plane, one sequence of
periods — but it costs the figure its size and leans entirely on weight. `tall`
keeps `mono-lg` and stands 8px proud of the bars on either side of it.

Neither overflows its bar. `mono-lg` does not fit inside 24px, which is why
`match` drops to `mono-medium` rather than clipping.

### F40 — new, introduced by FDN-15

`mono-medium` is a twelfth type token. `VPS-D001` states eleven.

It exists because the bench figure has to be heavier than an assignment bar's
label by weight rather than hue, and at the `match` height there is no room to
also be larger. It is `mono` at 500 against the label's Inter 400, and it follows
`VPS-D001`'s existing `body` / `body-medium` naming exactly.

`mono-lg` also moved from 500 to 600 so the figure is heavier than the label at
the `tall` height too. Geist Mono is now loaded as a variable font, since the
static pair of cuts did not include 600.

**If `tall` wins, `mono-medium` can be deleted** and the scale returns to eleven.
If `match` wins, `VPS-D001` gains a token.

### F38 — new, and it undercuts the inset panel in light mode

Light mode's `bg-canvas` (`neutral-50`) and `bg-surface` (`neutral-0`) are
**1.04:1** apart. Dark mode's are 1.12:1 — nearly three times the separation.

So in light mode the inset workspace panel is carried almost entirely by its 1px
border, and the "one continuous background with a panel inset into it" reading
that FDN-16 is built on barely happens. In dark it works.

This is not a bug in FDN-16; it is a gap in `VPS-D001`'s light ramp that FDN-16
is the first thing to depend on. **Proposed correction:** light `bg-canvas` moves
from `neutral-50` to `neutral-100`, which takes the separation to roughly 1.10:1
and matches what dark already does.

### F39 — new, and possibly an overcorrection

Non-working day columns went from `bg-subtle` to a dedicated
`--vt-nonworking-fill`, because once the bench is an opaque bar the shading no
longer has to be visible through a 12% tint.

Both themes now sit at **1.07:1** against the surface, and on screen the columns
are very close to invisible — in dark they read as absent rather than quiet. The
brief was that the shading read as structure in dark mode, and it may have
travelled past quiet.

Neither value is expressible in `VPS-D001`'s ramp, which is another instance of
F19. A middle value is probably right; this needs a look rather than a
calculation.

### F41 — new, and it needs a decision rather than a fix

`VPS-D002`'s Table says rows carry no separators and that separation comes from
"row hover and alignment alone", meaning `bg-hover`. FDN-16 changed the Timeline's
row hover to a border. The two data surfaces in the product now express the same
state two different ways.

Only the Timeline was in scope, so the Table is untouched and still fills. The
question is whether the border treatment is a Timeline affordance — justified
because a Timeline row spans a frozen column and a scrolling track, which a
Table row does not — or whether it is the new row hover everywhere and `VPS-D002`
should say so.

Worth noting that the reason F37 existed at all does not apply to a Table: a
Table has no quiet opaque fills sitting inside its rows, so `bg-hover` breaks
nothing there.

---

## FDN-17, FDN-18 and FDN-19

### Settled, and their scaffolding deleted

**Bench height is `match`.** The `tall` variant, its switcher, its token and the
per-density override are gone. The bench bar and an assignment bar both measure
24px at comfortable, verified.

**Bar fill is candidate 3.** The `hairline` and `wash` candidates, the
`data-bar` attribute and the `BarFill` union are gone; one settled token remains,
raised per FDN-18.

**F40 is settled at twelve tokens, and the code decided it rather than
preference.** `mono` at 13/18/400 cannot become 500: it is load-bearing on the
bench bar, where the day count is deliberately lighter than the cost figure
beside it. That is FDN-15's "weight, not hue" distinction, and redefining `mono`
would collapse the two into the same weight. `mono-medium` stays and `VPS-D001`'s
type table carries it.

Worth noting: `VPS-D001` never stated a count in prose — "eleven" was inferred
from the table's length. Adding the row was the whole amendment.

### FDN-18 — accent and weight

**Brand is out of navigation and out of segmented controls.** Both now take a
neutral `bg-active` with `text-primary`.

`bg-active` is its own value rather than an alias of `bg-subtle`, and that is a
consequence of F38: moving light `bg-canvas` to neutral-100 made it identical to
`bg-subtle`, and the sidebar sits directly on the canvas, so an active nav item
filled with `bg-subtle` was invisible. Caught on screen, not in review.

**The assignment bars are raised** from 22%/30% to 34%/42%. Hannah Weiss's row —
fully assigned, previously reading as empty in light mode — now reads as
assigned.

**F39 is closed at a middle value.** `#F5F5F6` light and `#232327` dark, roughly
1.09:1 and 1.12:1 against the surface, between the `bg-subtle` that read as
structure and the correction that read as absent.

**The bench figure carries two variants**, and they are a pair rather than two
choices. White on amber-500 is 2.15:1, and white only clears `VPS-D001`'s floor
once the amber darkens to amber-700 — amber-600 fails at 3.19:1 — so the fill and
the figure have to move together. Variant A is amber-500 with a near-black figure
at 9.26:1; variant B is amber-700 with white at 5.05:1. Dark is identical in both.

### F43 — new, and it came out of FDN-18's own audit

Auditing every element for brand color found exactly three uses: the today line,
its dot, and **the workspace mark in the sidebar**, which is a 20px `brand-600`
square holding the workspace initial.

That mark is not the today line, not a primary action and not a focus ring, so
under FDN-18's enumeration it should be neutral. But it is plausibly a different
thing from all three — a logo rather than a signal — and `VPS-D001`'s rule
enumerates signals.

Left as brand, flagged rather than decided. The audit also cannot see the row
selection border, which is `brand-500` and only exists while a row is selected;
it is the one surviving instance of `VPS-D001`'s "current selection or focus".

### FDN-19 — panel, radius and the mask

**The contextual panel is an inset within the inset**, sitting `1` inside the
workspace on all four sides with a border on all four and `radius-lg`.

**The concentric rule is now in `VPS-D001`**, along with `radius-xl` at 12px.
Measured: the workspace is 12px radius at 12px margin, and the panel is 8px —
`12 − 4`. The rule is scoped so it governs nesting rather than every pairing, or
a Card inside a `6`-padded region would owe a negative radius.

**The scroll-boundary mask works, and `VPS-D001` carries the exception.** At a
400px scroll offset the track's computed mask is
`linear-gradient(to right, transparent 0px, transparent 400px, black 424px, black 100%)`
with `backdrop-filter: none`. The exception is written with three conditions —
mask not fill, never `backdrop-filter`, scroll boundaries never surfaces — and an
explicit statement that it is not general permission for gradients.

One implementation note: the fade's two variables must be declared on `:root` and
set on the scroll container. Declaring them inside the utility shadowed the
inherited values and froze the mask at its resting state — which is how it was
first built, and it silently did nothing.

**The Tooltip is drawn from the system.** Radix-backed, `overlay` elevation,
200ms delay, `small` text, 280px max. Zero native `title` attributes remain on
the 30 assignment bars and 25 bench bars. Nav items and toolbar buttons carry it
too, with the shortcut in `mono` `text-tertiary` alongside the label.

Segmented controls now get a tooltip **only where there is a shortcut to
document**. Nine of the twelve were repeating their own visible label, which is
what `VPS-D002` means by a tooltip that contains the only copy of nothing.

### F42 — new, and the panel question answered

**Measured: the panel does not displace content.** The Timeline's scroll
container is 966px wide at a 1280px viewport with the panel open and 966px with
it closed. `absolute` positioning is doing its job, and `VPS-D003`'s 1280–1535px
overlay rule is what is implemented.

**But the observation behind the question stands.** The panel covers the right
360px of a 966px canvas, so a bar whose left edge falls under it loses its label
— occlusion rather than truncation, and specified rather than broken.

The finding is that **neither of `VPS-D003`'s two behaviors is good here.**
Displacing costs the Forecast a third of its width; overlaying hides the same
third. On a screen whose horizontal space is time, "the panel is open" should not
mean "a third of the forecast is unreadable", and `VPS-D003`'s table has no third
option.

A third behavior probably belongs to `VRS-F005` rather than `VPS-D003`, since it
is specific to a canvas where horizontal position carries meaning: on selection,
scroll the track so the selected row's live region sits left of the panel. Not
built — it is a behavior change, not chrome.

### FDN-17 — the summary band, and F8 closed

Three figures, top right, money largest: `mono-lg` at 20px weight 600 for
**£46,016** with "unrecovered · next 45 days", then **13 of 15** and **74%** at
`mono`. Verified the money figure computes to `rgb(24, 24, 27)` — `text-primary`,
not amber. Size carries the hierarchy; the hue stays exclusive to the timeline.

The page header's subtitle is gone. It was stating the most important fact on the
screen at 13px.

**The legend is an info icon beside the band**, and its two full-width lines are
returned to rows.

**F8 is closed with a stated reason.** Two bands: `VPS-D004`'s page header is
56px, and a 20px figure with a `micro` label beneath it plus a row of pill
controls does not fit inside it alongside an `h1`. The arithmetic decided it.

**One deviation to accept or reject:** `VPS-D002` specifies a Stat's label as
`micro` in `text-tertiary`, which is F9's 2.6:1. Three of them now sit in this
screen's most important band, so `Stat` uses `text-secondary` throughout. F9
remains open and this is the second surface pushing on it.

---

## FDN-20

### Settled, and deleted

The bench figure is the bright amber with a near-black figure. Variant B —
amber-700 with white — is gone, along with its tokens, its switcher, its type and
the `data-bench-text` attribute.

### The band's hierarchy

**£46,016** at `mono-lg` 20px/600, **13 of 15** and **74%** at `mono-md`
16px/500. Verified in the browser. Money still leads by four pixels and a weight
step; the other two are figures rather than captions.

`mono-md` is a thirteenth type token on an existing size step — 16px is `h3`'s.
`VPS-D001`'s table carries it.

### F44 — new, and it is a naming problem rather than a visual one

The mono family now reads `mono` / `mono-medium` / `mono-md` / `mono-lg`, where
`-medium` denotes **weight** (matching `body-medium`) and `-md` and `-lg` denote
**size**. One suffix convention, two meanings, in one family.

Nothing renders wrong. It is a trap for whoever reads the scale next, and it
belongs in FDN-21's pass rather than a rename mid-flight.

### The segmented control, rebuilt

A brand fill carried the active state on its own, and one neutral fill could not
replace it. The control is now built the way a segmented control actually works:
the track recesses to `--vt-segment-track` and the active segment sits on top at
`--vt-segment-active`, with the label also changing weight and color. Three
channels for what one used to carry.

Those two are their own values rather than `bg-subtle` and `bg-raised`, because in
dark both of those are neutral-800 — **F10, still open** — and the inversion would
have collapsed into no change at all. F10 has now blocked two separate designs.

### The categorical palette

**The rule is restated in `VPS-D001` and F34 is closed as a documentation
defect.** The exclusions are the warm arc, green and teal, and the brand's own
hue band. Indigo 500 is at 239°; the retired `cat-2` was 258° and `cat-6` was
271°, both inside it.

**The consequence is now written down too, because it is not obvious.** After all
three exclusions the cool arc supports roughly four distinguishable hue families
— cyan 192°, sky 200°, blue 217°, fuchsia 293° — plus a hue-neutral slate. Eight
tokens cannot come from hue alone, so every candidate spends lightness to reach
eight. That is a consequence of the exclusions, not a shortage of options, and
`VPS-D001` says so rather than leaving the next reader to rediscover it.

**Categorical tokens are now per theme**, like the semantic hues, because the bar
is an opaque mix — 34% against white, 42% against near-black — and one source
value comes out pastel in one theme and saturated in the other.

Three fields on `/foundations` at fifteen rows each, with real hash assignment
from the real Project UUIDs and the amber bars included, since "does the amber
still win" is half the test. `current`, `spread` (four hues, two lightness steps),
`ladder` (two hues, three steps, one accent, one slate).

**Two things to look for that the palettes cannot settle on their own.** In
`spread` the pale cyan and pale blue sit close together at a 34% mix, so hue
separation that is obvious at full strength may not survive the tint. In `ladder`
the cyan-800 step carries a faint green cast in light mode, which is the boundary
`success` is meant to own.

### Off-days on demand

`--vt-nonworking-rest` at 1.02:1 against the surface, coming up to
`--vt-nonworking-fill` at 1.09:1 on row hover.

**It reads as one gesture, and that is structural rather than lucky.** Both the
shading and FDN-16's row border transition on `group-hover` from the same
ancestor, both at `motion-fast` — verified as 0.12s and the same
`cubic-bezier(0.2, 0, 0, 1)` on both. They cannot arrive at different times.

Worth a look nonetheless: the rest-to-hover delta is small, and it may be too
quiet to register as calendar detail appearing rather than as nothing happening.

### An implementation note that produced wrong colors silently

The hand-written `bar-cat-n` utilities referenced `var(--color-cat-n)`, the
Tailwind theme alias. An `@theme inline` alias is substituted into Tailwind's own
generated utilities and is **not** emitted as a custom property, so a
hand-written utility referencing it resolves to nothing and `color-mix` falls
back — which looked like a working bar in the wrong color. All three palette
fields rendered identically and the CSS was valid.

The utilities now reference `--vt-cat-n` directly. Caught by measuring computed
values across the three fields, not by looking: the fields looked plausible.

---

## FDN-3 — the employee profile

### What was built

The profile header, the full tab structure (Overview, Skills, Documents,
Activity) and enough per-person detail across all four to make the density
real: roughly thirty fields on Overview alone once employment, reporting and
schedule are counted together, plus skills with proficiency and verification,
certifications, a document list and an activity feed, for all fifteen real
employees. `Input` and `Tabs` are new in `packages/ui`, both per `VPS-D002`.

A minimal `/people` list exists only to reach a profile — it is explicitly not
`VRS-F002`'s own People directory, which is a full `VPS-D002` Table with
filters and a Panel summary, and stays out of scope until its own pass.

### Structural absence, verified rather than assumed

`lib/profile.ts`'s `buildEmployeeProfile` adds the `compensation` key with a
**conditional spread**, not a conditional value: `...(canSeeCompensation ? {
compensation } : {})`. An unauthorized view-model has no `compensation` key
at all, not a key holding `undefined`.

Checked in the browser rather than by reading the code back: with the
prototype's viewer toggle set to Team Member, the rendered page's HTML
contains no "Compensation" heading, no salary figure, and no occurrence of
the string "Tier 1" anywhere. The layout closes cleanly on toggle — the
two-column Employment/Reporting grid simply ends where the Compensation
Section would have started, with no gap and no rendered placeholder.

### F45 — new

`VRS-F002`'s Screens table lists "Content + Panel" for the Employee profile
but the Layout and components section never says what the Panel would show —
unlike the People directory, there is no list on this screen for a Panel to
open a summary from. Built as Content-only; logged rather than resolved by
inventing a use for the Panel.

### F46 — new, and fixed

`Tabs.Trigger`'s label was wrapped in `<Text variant="body-medium"
as="span">`, which gave every tab an empty accessible name — `read_page`'s
accessibility tree showed `tab [ref] type="button"` with no name at all,
confirmed by a `find` query for the tab's own label returning no matches.
The visible text rendered as a child `generic` node rather than contributing
to the button's name. Fixed by rendering the label directly as the
Trigger's child, with the same typography classes moved onto the Trigger
itself — a diagnostic step taken while investigating a suspected click bug in
the same component that turned out to be unrelated: stale cached element
positions in one debugging pass, not a rendering fault. Worth recording
because the same wrapping pattern appears nowhere else in this component set,
and shouldn't be reintroduced.

---

## FDN-24 and FDN-25

### FDN-24 — the profile is a form, not a record

`VRS-F002`'s layout sentence and its own keyboard table couldn't both be
true — a permanently-editable Input has nothing for `E` to open and nothing
for `Escape` to close. The keyboard model won, for the reason the ticket
gave: it's consistent with `VPS-D003` everywhere else, and thirty
permanently bordered boxes on a screen with nothing being edited reads as a
data-entry form.

`EditableField` is new in the app (not `packages/ui` — this is `VRS-F002`'s
own interaction, not a generic design-system component). Read state is
plain text, no border, no box. `E` on the focused field, or a click, opens
it as a real `Input`; blur or `Cmd+Enter` commits; `Escape` discards and
reverts to the pre-edit value.

**Verified, not assumed, and the verification found a tooling limit worth
recording.** Escape-discards is confirmed two ways: a direct `keydown`
listener shows `e.key` resolves to `"Escape"` correctly, and the field
visibly reverts. Blur-commits is confirmed by typing a change and clicking
elsewhere, watching the field close back to text carrying the new value.
Cmd+Enter-commits uses the identical `onKeyDown` handler and could not be
exercised through this session's browser-automation tool: its synthesized
`"Return"`/`"Enter"` keydown carries an empty `e.key`, with or without the
modifier, while every named key this build has relied on elsewhere —
`Escape`, `j`, `k` — resolves correctly. That is a gap in the tool, not
evidence about the code; it's recorded because a future session hitting the
same wall shouldn't re-diagnose it as a component bug.

### The affix contract, and the bug that motivated it

Contracted hours and Billing rate previously rendered their unit suffix and
the browser's native number-spinner in the same corner of the box, because
`Input`'s suffix was positioned over the field rather than beside it.
`VPS-D002` gains the contract: prefix and suffix are laid out as siblings
of the actual `<input>` inside one shared bordered container, never
positioned over it, and a numeric field carrying either suppresses the
native spinner via a new `no-spinner` token utility.

**Verified in the browser, not by reading the code back.** `getComputedStyle`
queried against `::-webkit-inner-spin-button` directly returned misleading
values (`appearance: auto`, `display: block`) — querying a vendor
pseudo-element's computed style through this automation path isn't
reliable, and is logged here so it isn't re-trusted next time. What
settled it was a real screenshot at high relative zoom: `40` with no
spinner arrows, `hrs/wk` sitting flush beside it, measured programmatically
at a 0px gap between the two, meaning adjacent siblings rather than overlap.

**F49 — new, found while building the contract.** `InputProps` declared its
own `prefix?: ReactNode` alongside `Omit<InputHTMLAttributes<...>,
"className">` — but `HTMLAttributes` already carries an RDFa `prefix?:
string`, and the two intersected silently into a type any non-string
`ReactNode` value would fail against. The fix is the same shape as
`className`'s existing exclusion: `prefix` needed omitting from the native
attributes too. Worth recording because it's a trap in React's own DOM
typings, not this codebase's design, and it will bite the next component
that names a prop `prefix`, `about`, `content`, `property`, `rel`,
`resource`, `rev`, `typeof` or `vocab` — the RDFa set `HTMLAttributes`
carries by default.

**Audited.** `Input` is used in exactly one place — inside `EditableField`
— so the audit `VPS-D002` calls for is complete by construction rather
than by checking a list.

### FDN-25 — People as a Table, tabs as pills

**People.** Built as `VPS-D002`'s `Table`: sticky header, click-to-sort,
eight columns (name, role, department, entity, type, status, reports-to,
hours/week), pill filters for entity and employment type. Verified sorting
by clicking the Name header and reading back an alphabetical list, and
verified the entity filter narrows fifteen rows to the expected ten UK
employees. Row click still opens the profile directly.

**Deliberately not built:** checkbox row selection, keyboard row
navigation, virtualisation above 100 rows. `VPS-D002` specifies all three;
no screen composing `Table` needs any of them yet, and building ahead of
that need is the premature abstraction CLAUDE.md warns against. Logged
here rather than silently absent.

**F51, at Table scale, recorded rather than patched, exactly as asked.**
The header row's `micro` `text-tertiary` computes to the same ~2.6:1 as
`Stat`'s label under F9 — except a table's headers are the *entire* text a
column carries, not one label beside a bigger number. Left exactly as
`VPS-D002` specifies; FDN-9 owns the correction.

**Tabs became pills.** Same track, same active-fill, same weight change as
`ToggleGroup` — `VPS-D002` now states the two as one treatment rather than
describing an underline separately. The active state is computed from the
known `value` rather than read off Radix's own `data-state`, matching
`ToggleGroup`'s fix from FDN-23 before this component needed it: the
moment a Tab trigger is ever wrapped in `Tooltip`, `data-state` stops being
exclusively its own, and the new composed-primitives rule in `VPS-D002`
(below) is exactly the situation that would create.

### The composed-primitives rule

`VPS-D002` now states plainly what FDN-23 found by debugging it: wrapping
one primitive's trigger around another's own styled element merges the
wrapper's DOM attributes onto the child, and where both write the same
attribute for their own state, the wrapper's silently wins. The rule going
forward — a component derives its visual state from a prop it already
holds, never from an attribute a second primitive might also be writing —
is now written down instead of left to be rediscovered per component.

---

## FDN-26 and FDN-27

### FDN-26 — the reflow had two independent causes, not one

The read state and the Input it becomes didn't occupy the same box, and
measuring in the browser (`getBoundingClientRect` on `Reporting & schedule`
and `Department`, before/after opening Job title) found the shift was two
separate bugs stacked on top of each other, not the single horizontal one
the ticket described.

**Horizontal — 13px.** `EditableField`'s read div used `px-3 -mx-3`, a
pad-in/negative-margin-out pair that nets to a 0px inset so the value text
sits flush with its label. `Input`'s box is a real 1px border with the
`<input>` itself carrying `pl-3`, an inset of `1 + 12 = 13px`. Fixed by
replacing `-mx-3` with a matching `border border-transparent` on the read
div — same padding, same border width, box model now identical, only the
paint (transparent vs. `border-border-default`) changes on transition.

**Vertical — 4px, and not where it looked.** Every field's label row grew
4px taller in edit mode, which is what actually pushed `Department` and
`Reporting & schedule` down. Traced to `Input.tsx`: it wrapped its label
`Text` in a native `<label>` element — `<label><Text variant="label">…`.
`EditableField`'s read state renders that same `Text` as a direct child of
a `flex` container, which blockifies it (a flex item is always blockified,
whatever tag it is) and lets its own `text-label` line-height (16px) govern
its box. Nested one level inside the `<label>`, the `Text` span is no
longer the flex item — the `<label>` is — so the span stays genuinely
`display: inline`, and the line box that actually renders defers to the
label's own (unstyled, ambient) font metrics, 20px, rather than the 16px
`text-label` sets. Fixed in `Input.tsx` by making the label itself the flex
item — `<Text as="label" htmlFor={inputId} variant="label">` — rather than
nesting a `Text` inside a separate `<label>` wrapper. `Text` gained an
`htmlFor` prop for this. No component wraps `Input`'s label this way
elsewhere, so this was the only call site.

**Verified by measurement, not by looking, per the ticket.** Zero delta on
both reference points, opening Job title, Contracted hours (suffixed) and
Frequency (Compensation section), in both Comfortable and Compact density.
Before/after screenshots at the same scroll position confirm it visually
too — see the round's report.

### FDN-27 — the toggle was not broken

Read the mechanism end to end — `AppearanceControls` → `setTheme` → the
`AppearanceProvider` context → the `useEffect` that writes `data-theme` on
`<html>` → `packages/tokens/src/runtime.css`'s `:root[data-theme="dark"]`
block — and every name matches across every hop. No stray `.dark` class, no
`dark:` Tailwind variant anywhere, no `localStorage` (confirmed clean
against CLAUDE.md's rule too). Clicking Light in a fresh session flips
`data-theme` to `"light"` and the whole UI repaints correctly, immediately,
every time.

**The false report traces to how the previous session drove the browser,
not to the code.** Screenshot-pixel coordinates were being passed to a
click action without being scaled to the real viewport — an 800×450
screenshot clicked against a 1280×720 page, roughly a 1.6× mismatch. A
click aimed at the Light toggle by screenshot coordinates lands on empty
space instead, the toggle never actually gets clicked, `data-theme` never
changes, and every screenshot that session took was dark — which is
indistinguishable from "the toggle does nothing" unless you check the DOM
attribute directly rather than trusting that the click landed.

**Reproduced twice this round, as a check on the theory rather than an
assumption.** A raw screenshot-coordinate click against this exact build
failed to open a field for editing on the first attempt today, for the
identical reason. Clicking by element reference, or by coordinates read
back from a fresh same-resolution screenshot, worked every time. This is
the same category of tooling caveat as F46 and the `Cmd+Enter` note below —
worth recording so the next session doesn't re-diagnose working code as
broken because of how it was driven.

**`Cmd+Enter` re-attempted, per the round's ask.** Still reproduces exactly
as FDN-24 logged it: a `keydown` listener on the field sees `key: ""`,
`code: ""`, `metaKey: false` for the synthesized Return regardless of the
modifier requested. Confirmed still a tooling gap, not new evidence about
the component — Escape and Blur remain the two paths verified directly.

No code changed for FDN-27. Shell (Bench Forecast), People and the profile
are now captured in light mode — see the round's report.

---

## FDN-28 through FDN-30 — profile containment, numeric voice, scalable People controls

### FDN-28 — contained profile fields and explicit numeric stepping

The rendered profile proved FDN-24's borderless paint too sparse even though
its edit-on-demand interaction was sound. Every fact now occupies a restrained
`bg-subtle` field surface with a hairline `border-default`; editable fields
strengthen that paint on hover and focus, while read-only facts retain the same
contained treatment without looking disabled. This supersedes only FDN-24's
paint decision. Its read/edit model and FDN-26's identical box-model contract
remain in force across every profile field.

Numeric fields now use explicit up/down controls rather than relying on a
browser-owned spinner. The controls are siblings of the value and unit, reserve
their own space, and work in both read and edit states. Arrow Up/Down changes
the value from the keyboard; the controls enforce the same step, minimum and
maximum rules. This keeps the affordance visible without allowing it to overlap
`hrs/wk` or `GBP/day`.

**Measured in the browser.** Opening Job title produced a 0px delta for the
field's x, y, width and height, the fixed `Reporting & schedule` reference
point, and the profile scroll position in both Comfortable (32px field) and
Compact (28px field) density. Compact was deliberately tested at `scrollTop:
220`, so the result also covers focus behavior away from the top of the page.
The evidence pair was captured at the same scroll position in each density.
Light and dark field paint was read from the applied theme and captured.

**Keyboard verification improved this round.** A real browser `Meta+Enter`
keypress committed both a text edit and a stepped numeric edit, closing the
input and leaving the committed read value. The earlier empty-`e.key` tooling
limitation did not reproduce through the browser's DOM keypress path. Arrow Up
also stepped the focused numeric editor before that commit.

### FDN-29 — Inter tabular numerals replace the technical monospace voice

Geist Mono made operational figures feel like code. Product figures now use
Inter with `font-variant-numeric: tabular-nums`; monospace is reserved for
genuine code or shortcut notation. The type tokens and shared `Text` variant
were renamed from `mono*` semantics to `numeric*`, and the prototype call sites
were audited so the old product-figure treatment cannot linger behind an old
class name.

**Verified from rendered output.** The Bench Forecast exposes 25 tabular-number
nodes; the sampled `£46,016` resolves to `Inter, "Inter Fallback", ui-sans-serif,
system-ui, sans-serif` with `font-variant-numeric: tabular-nums`. The People
hours column and profile numeric fields resolve to the same family and variant.
This supersedes the Geist Mono portion of FDN-11, not its scale, tracking or
weight decisions.

### FDN-30 — People filters scale, and Add person has a clear home

Entity and employment-type pills did not scale beyond the two-entity fixture.
Both are now shared multi-select popovers. Entity includes search; both show
checkbox choices, selected counts and a clear action. Selection is a union
inside each filter and an intersection between filters. The filter bar stays
compact as entities and employment types grow instead of expanding laterally.

`+ Add person` is the People page's primary header action. It opens a real
shared dialog with the minimum prototype fields, required-field validation and
an in-session success alert; it deliberately does not persist or simulate a
backend. Browser verification covered the full 15-row directory, a Karachi
search yielding one entity choice, the PK entity narrowing to five people,
PK plus Full time and Part time narrowing to four, and a successful modal
submission.

The shared component work introduces `MultiSelect`, `Select` and `Dialog` in
`packages/ui`. Two token-owned values were added for the work: the filter-list
height and semantic scrim color. No feature-local component or arbitrary visual
value was introduced.

---

## FDN-4 — Timesheet speed-run prototype

The weekly entry surface now follows `VRS-F010` rather than behaving like a
generic seven-day spreadsheet. Its columns come from the resolved calendar
fixture, its rows represent two active assignments, a staffed pitch and the
standing Non-billable category, and the current fixture deliberately uses
Karachi's six-day week. That made the special case visible in the product:
typing `fd` in Saturday's cell resolves to 4 hours while `fd` and `hd` on an
eight-hour day resolve to 8 and 4 respectively. No screen code inspects a
weekday or computes a weekend.

The natural parser accepts decimals, `fd`, `hd` and one-operation addition or
subtraction. `Tab` and `Shift+Tab` move row-major, arrows move geometrically,
`Cmd+D` copies the current cell's resolved value into the remaining cells on
that row, and brackets change week. The `Cmd+D` behavior is the founder-approved
correction recorded on FDN-9: the old specification phrase “from the cell
above” is incompatible with “fill the rest of the row.”

**The speed run used real browser keypresses.** Two billable rows were filled to
44 hours, including the four-hour Saturday, and submitted with `Cmd+Enter` in
1.395 seconds. Submission changed every entry surface to read-only, exposed the
success Badge and Unlock action, and the confirmation check was fully transparent
at 1,000ms. `Cmd+D`, `Tab`, arrows, brackets and `Cmd+Enter` were each exercised
through the same native browser keypress path. The direct `Cmd+Enter` limitation
from the earlier profile round did not recur.

The 24-hour boundary was also driven through the browser: 20 hours and 5 hours
on Monday produced “Mon would total 25h. A day cannot exceed 24h.” and disabled
submission. Light/Compact and Dark/Comfortable were read from the applied root
attributes, not inferred from the controls. Compact rows measured 33px including
their 1px separator, matching the 32px cell requirement.

Responsive verification used the real page inside temporary 900px and 700px
browsing contexts. At 900px the 200px work label and exactly three 128px day
columns are visible, with the full 968px six-day grid horizontally scrollable.
At 700px the Table is absent and the six-day Toggle Group plus four vertical
Cards with explicit numeric steppers are present. Submit week is absent at the
start of Monday and appears on the final working day as specified. The day strip
is directly interactive. The available browser driver synthesizes mouse drag
rather than touch, so swipe is verified through the touch-handler path rather
than a genuine touch event.

This screen exposed one pre-existing shared-component omission: `Button` had no
disabled treatment even though `VPS-D002` specifies 40% opacity and a
not-allowed cursor without changing variant color. The shared component now
implements that contract, so the disabled Submit week state reads correctly on
every surface.

---

## Closed by founder decision during this build

**F1 — Sidebar navigation.** Five destinations, two groups: **Work** (Bench Forecast `G B`, People `G P`, Timesheets `G T`) and **Waiting** (Inbox `G I`, Manager Dashboard `G D`). Goes into `VPS-D004`. See F23 for the question this raised.

**F4 — "Counting up."** `VRS-F005`'s formula is authoritative: whole working days. `VPS-D001`'s "quietly counting up" prose is what changes, since the formula produces a figure that steps at a working-day boundary rather than accruing through the day.

**F16 — Language convention.** `VPS-000` Standing Rule 6's label is a leftover from the conversion pass and is wrong; its examples are correct. American English throughout, in prose, comments and identifiers.

**F17 — App directory.** `apps/roster-web` is correct. `VPS-A001`'s two-language-boundary table says `apps/web` and is the defect.

---

## Provisional choices carried in the build

Each is marked in the code at the point it applies, and each is a look-at-it question rather than a resolved fact.

| Finding | Provisional choice |
|---|---|
| F2 | Minimum day width per horizon — 32px at 30 days, 20px at 90, 12px at 180 — and the region scrolls rather than compressing the window. Where a bench region is narrower than its cost figure the figure is suppressed, not truncated; below 44px the day count is dropped too |
| F3 | Cost figure is `text-primary` |
| F5 | Restricted bench region drops the figure and keeps the day count. No border, no lock icon, no "Visible to" copy — `VPS-D004`'s Restricted treatment does not apply to a region that is itself fully visible |
| F6 | No figure at all for an unauthorized viewer. The `billing_rate_default` fallback is deleted |
| F7 | Timeline rows carry no separator, matching Table |
| F8 | Two bands: the 56px page header, then a summary row beneath it |
| F21 | `primary` hover is `brand-700` |
| F22 | Badge neutral tone is `bg-subtle` with `text-secondary` |
| F24 | Page header title and subtitle are inline on a shared baseline |
| F26 | 14-day lead-in before today |
| F27 | Annual working days counted from the working-day index |
| F29 | Bench region fills the row height |
| F30 | Utilization is covered working days weighted by `billable_percentage` over total working days |
| F28 | The role line appears at comfortable density only. VRS-F005's separate rule still drops it below 1280px regardless |
| F36 | Cost horizon of 45 days. A region beginning inside it is costed in full; beyond it, days and no figure. The header total states the window |
| FDN-11 | `display` moves to 32/40; tracking −0.022 / −0.02 / −0.015em above 20px, zero below; weights 640 / 600 / 560 where the variable font is used |
| FDN-12 | Bar fill carries three candidates pending a choice |
| F20 | Comfortable is the workspace default density, per FDN-16 |
| FDN-15 | Bench amber `#F59E0B` light / `#FBBF24` dark; two height variants pending a choice; `mono-lg` weight 500 → 600 |
| FDN-16 | Workspace inset at space-3 with `radius-lg`; row hover `border-strong`, selection `brand-500`; segmented controls at `radius-full`, Buttons unchanged |

---

## Notes on the build, not findings

- **The working-day rule holds.** `apps/roster-web/src/fixtures/calendar.ts` is the only file that inspects a date's weekday, and it exists as the stand-in for `VRS-F004`'s materialization worker. Every consumer reads the index. Two divergent entity calendars — London Monday–Friday, Karachi Monday–Friday plus a four-hour Saturday — so a weekend assumption anywhere is visible on screen.
- **Off-token values do not compile.** Tailwind's default color, spacing, radius, type, shadow, blur and breakpoint scales are cleared before `VPS-D001`'s are declared. Verified: `bg-red-500`, `p-7`, `shadow-lg`, `blur-sm`, `rounded-xl`, `gap-9`, `font-bold` and `max-w-md` all produce no CSS; the token equivalents all do.
- **Tooltip, Input, Tabs, Table, Select, MultiSelect and Dialog are built.** `Table` implements sticky header, click-to-sort and hover only — checkbox row selection, keyboard row navigation and virtualisation above 100 rows are all in `VPS-D002` but unbuilt, since no screen composing it needs any of the three yet. **Chart, Toast, Progress, Textarea, DatePicker, Radio, Switch, Breadcrumb and Pagination are still not built.** Checkbox behavior exists inside `MultiSelect`, but it is not yet exposed as a standalone library component. None of the remaining components is needed by a screen built so far; each arrives with the screen that composes it. The profile's date fields still use `Input`'s own shell because the calendar affordance is not what that screen exists to test.
- **The good-news empty state is implemented but unreachable** with the current fixture, since somebody always has bench time in this data.

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
| F28 | Left column content does not fit its own row at compact density | `VRS-F005`, `VPS-D001` | **New**, measured |
| F29 | Bench region has no specified height | `VPS-D002` | **New** |
| F30 | Aggregate utilization has no formula on the screen that displays it | `VRS-F005` | **New** |
| F31 | The bench region is specified as patternless and is drawn over a pattern | `VPS-D001`, `VPS-D002` | **New**, visible on screen |
| F32 | The amber is weak in light mode and strong in dark | `VPS-D001` | **New**, look-at-it |
| F33 | Categorical bars outshout the amber in dark mode | `VPS-D001` | **New**, look-at-it |
| F34 | `cat-4` and `cat-8` do not read as cool | `VPS-D001` | **New** |
| F35 | Bar labels at `text-inverse` fail on mid-tone categorical fills | `VPS-D002` | **New** |
| F36 | The amber saturates at the 180-day horizon | `VRS-F005` | **New**, look-at-it |

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

---

## Notes on the build, not findings

- **The working-day rule holds.** `apps/roster-web/src/fixtures/calendar.ts` is the only file that inspects a date's weekday, and it exists as the stand-in for `VRS-F004`'s materialization worker. Every consumer reads the index. Two divergent entity calendars — London Monday–Friday, Karachi Monday–Friday plus a four-hour Saturday — so a weekend assumption anywhere is visible on screen.
- **Off-token values do not compile.** Tailwind's default color, spacing, radius, type, shadow, blur and breakpoint scales are cleared before `VPS-D001`'s are declared. Verified: `bg-red-500`, `p-7`, `shadow-lg`, `blur-sm`, `rounded-xl`, `gap-9`, `font-bold` and `max-w-md` all produce no CSS; the token equivalents all do.
- **`VPS-D002`'s Tooltip is not built.** Shortcut discovery on hover currently uses the native `title` attribute.
- **Table, Chart, Modal, Toast, Progress, Select, Textarea, DatePicker, Checkbox, Radio, Switch, Breadcrumb and Pagination are not built.** None is needed by the shell or the Forecast; they arrive with the screens that compose them.
- **The good-news empty state is implemented but unreachable** with the current fixture, since somebody always has bench time in this data.

"use client";

import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import type { CategoricalToken } from "@vulto/tokens";
import { cx } from "./cx";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Text } from "./Text";
import { Tooltip, TooltipProvider } from "./Tooltip";

/*
 * The Bench Forecast canvas — owned in behavior by VRS-F005 and in appearance
 * here, per VPS-D002.
 *
 * This component knows nothing about dates. Bars and bench regions are given
 * as an index and a span into the `days` array it is handed, so every calendar
 * fact stays inside VRS-F004's index and none of it leaks into rendering.
 *
 * PROVISIONAL, pending the look-at-it questions in Prototype_Findings:
 *  - F2  no document gives a day-column width. The caller passes a minimum and
 *        the region scrolls rather than compressing the window to fit.
 *  - F3  the cost figure is `text-primary`.
 *  - F5  a restricted region drops the figure and keeps the day count.
 *  - F7  rows carry no separator, matching Table.
 *  - F29 the bench region fills the row height; VPS-D002 gives the bar a
 *        height and the region none.
 */

/**
 * Below this width the cost figure cannot be shown without truncating it, so it
 * is suppressed instead. Sized for `mono-medium`, which FDN-15 settled on.
 */
const COST_MIN_WIDTH = 72;
/** Below this the day count does not fit either, and nothing is shown. */
const COUNT_MIN_WIDTH = 44;
/** FDN-19: how far the track fades before it passes under the person column. */
const SCROLL_FADE_PX = 24;

export type TimelineDay = {
  date: string;
  isWorking: boolean;
  /** Day of month, e.g. "6". */
  label: string;
  /** Set on the first day of a month, e.g. "August". */
  monthLabel?: string;
  /** Holiday name, where the index resolved one. */
  note?: string;
};

export type TimelineBar = {
  id: string;
  label: string;
  start: number;
  span: number;
  colorToken: CategoricalToken;
  /** VRS-F007: dashed border in cat-n at 12% fill, per the dashed-border rule. */
  ghost?: boolean;
  title?: string;
};

export type TimelineBenchRegion = {
  id: string;
  start: number;
  span: number;
  workingDays: number;
  /** Absent where the viewer is not authorized for compensation. */
  costLabel?: string;
  title?: string;
};

export type TimelineRow = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string;
  ghost?: boolean;
  badge?: string;
  bars: TimelineBar[];
  bench: TimelineBenchRegion[];
};

export type TimelineProps = {
  days: TimelineDay[];
  rows: TimelineRow[];
  /** Index of today within `days`, or -1 if outside the window. */
  todayIndex: number;
  dayWidth: number;
  selectedRowId?: string;
  onSelectRow?: (rowId: string) => void;
  /** Bumped by the caller to scroll today into view, per VRS-F005's `T`. */
  scrollToTodayNonce?: number;
};

/*
 * FDN-12. The bar's fill is quiet and opaque; the hue lives in a 2px left
 * edge. `bar-cat-n` mixes the categorical token with the surface at the
 * candidate percentage rather than layering an alpha, so nothing beneath a bar
 * shows through.
 */
const FILL: Record<CategoricalToken, string> = {
  "cat-1": "bar-cat-1",
  "cat-2": "bar-cat-2",
  "cat-3": "bar-cat-3",
  "cat-4": "bar-cat-4",
  "cat-5": "bar-cat-5",
  "cat-6": "bar-cat-6",
  "cat-7": "bar-cat-7",
  "cat-8": "bar-cat-8",
};

/** The 2px left edge, and the dashed border a Ghost bar carries instead. */
const EDGE: Record<CategoricalToken, string> = {
  "cat-1": "border-cat-1",
  "cat-2": "border-cat-2",
  "cat-3": "border-cat-3",
  "cat-4": "border-cat-4",
  "cat-5": "border-cat-5",
  "cat-6": "border-cat-6",
  "cat-7": "border-cat-7",
  "cat-8": "border-cat-8",
};

export function Timeline({
  days,
  rows,
  todayIndex,
  dayWidth,
  selectedRowId,
  onSelectRow,
  scrollToTodayNonce,
}: TimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const trackWidth = days.length * dayWidth;

  /*
   * FDN-19. The fade at the boundary where the track passes under the frozen
   * person column.
   *
   * The mask lives on each row's track, whose own coordinate space starts where
   * the track starts — so the boundary, in that space, is exactly the current
   * scroll offset. Both values are published as CSS variables and the mask is
   * declared once in the token layer, so this writes two custom properties per
   * scroll frame and touches no React state.
   */
  const onScroll = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const x = node.scrollLeft;
    node.style.setProperty("--vt-scroll-x", `${x}px`);
    // Clamped to the offset: at rest nothing is hidden, so there is no fade to
    // explain.
    node.style.setProperty(
      "--vt-scroll-fade",
      `${Math.min(x, SCROLL_FADE_PX)}px`,
    );
  }, []);

  useEffect(() => {
    if (todayIndex < 0 || !scroller.current) return;
    // Land today a little in from the left edge so the run-up is visible.
    const target = Math.max(0, todayIndex * dayWidth - dayWidth * 4);
    scroller.current.scrollTo({ left: target, behavior: "smooth" });
  }, [scrollToTodayNonce, todayIndex, dayWidth]);

  return (
    <TooltipProvider>
    <div
      ref={scroller}
      onScroll={onScroll}
      // FDN-16: flat. The workspace is now the raised surface, and a bordered
      // canvas inside a bordered inset panel is the nested card VPS-D002
      // forbids.
      className="min-h-0 flex-1 overflow-auto"
    >
      <div className="min-w-max">
        {/* Column header. Sticky vertically so it survives the row scroll, and
          * above the row hover outline, which is z-20. */}
        <div className="sticky top-0 z-40 flex bg-bg-surface">
          <div className="sticky left-0 z-50 flex w-timeline-label-narrow shrink-0 items-end border-r border-b border-border-default bg-bg-surface px-cell pb-1 xl:w-timeline-label">
            <Text variant="micro" className="text-text-tertiary">
              Person
            </Text>
          </div>
          <div
            className="relative shrink-0 border-b border-border-default"
            style={{ width: trackWidth }}
          >
            {/* Month labels get their own band. Positioned against the track
              * rather than inside a day cell, so a 12px column does not clip
              * "September". */}
            <div className="relative h-4">
              {days.map((day, index) =>
                day.monthLabel ? (
                  <Text
                    key={`month-${day.date}`}
                    variant="micro"
                    className="absolute top-1 whitespace-nowrap text-text-secondary"
                    style={{ left: index * dayWidth + 2 }}
                  >
                    {day.monthLabel}
                  </Text>
                ) : null,
              )}
            </div>
            <div className="flex">
              {days.map((day) => (
                <div
                  key={day.date}
                  title={day.note ?? day.date}
                  style={{ width: dayWidth }}
                  className={cx(
                    "relative flex shrink-0 flex-col items-center justify-end pb-1",
                    !day.isWorking && "bg-nonworking",
                  )}
                >
                  {dayWidth >= 18 ? (
                    <Text variant="micro" className="text-text-tertiary">
                      {day.label}
                    </Text>
                  ) : null}
                </div>
              ))}
            </div>
            {/* The 6px dot at the top edge of the today line. The only
              * brand-colored element on the canvas. VPS-D002. */}
            {todayIndex >= 0 ? (
              <span
                aria-hidden
                className="absolute bottom-0 size-dot -translate-x-1/2 translate-y-1/2 rounded-full bg-brand-500"
                style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
              />
            ) : null}
          </div>
        </div>

        {/* Rows. No separators — separation comes from hover and alignment
          * alone, matching Table. VPS-D002. */}
        {rows.map((row) => {
          const selected = row.id === selectedRowId;
          return (
            <div
              key={row.id}
              role="button"
              tabIndex={-1}
              aria-label={`${row.primaryLabel}, ${row.secondaryLabel}`}
              aria-pressed={selected}
              onClick={() => onSelectRow?.(row.id)}
              className="group relative flex h-timeline-row cursor-default"
            >
              {/*
                * FDN-16. Hover and selection are a border on the whole row
                * rather than a background fill, so the person column and the
                * timeline read as one object.
                *
                * Drawn as an overlay rather than an outline on the row itself
                * because the sticky label column paints its own background over
                * anything the row draws beneath it, which would have broken the
                * border exactly where the two halves meet.
                *
                * This is also what closes F37 by construction: no row-level
                * fill exists any more, so a quiet bar's opaque mix against
                * `bg-surface` is always mixing against what is actually behind
                * it. Selection had to move too — hover alone would have left
                * `bg-selected` breaking the same bars.
                */}
              <span
                aria-hidden
                className={cx(
                  "pointer-events-none absolute inset-0 z-20 rounded-md border",
                  "motion-fast transition-colors",
                  selected
                    ? "border-brand-500"
                    : "border-transparent group-hover:border-border-strong",
                )}
              />
              <div
                className={cx(
                  "sticky left-0 z-10 flex w-timeline-label-narrow shrink-0 items-center gap-2",
                  // The sticky column needs its own fill or the track shows
                  // through as it scrolls beneath. It is now unconditional.
                  "border-r border-border-default bg-bg-surface px-cell xl:w-timeline-label",
                )}
              >
                <Avatar
                  name={row.primaryLabel}
                  size="md"
                  dashed={row.ghost}
                />
                <span className="min-w-0 flex-1">
                  <Text
                    variant="body-medium"
                    className="truncate text-text-primary"
                  >
                    {row.primaryLabel}
                  </Text>
                  {/*
                    * F28. The role line appears at comfortable density only.
                    *
                    * At compact the Bench Forecast row is 36px and this stack
                    * was 38px — `body-medium` at 14/20 above `small` at 13/18 —
                    * so the role bled into the next row and the whole column
                    * read as misaligned against the bars.
                    *
                    * VRS-F005's separate rule still applies: the role line also
                    * drops below 1280px regardless of density.
                    */}
                  <Text
                    variant="small"
                    className="hidden truncate text-text-secondary xl:comfortable:block"
                  >
                    {row.secondaryLabel}
                  </Text>
                </span>
                {row.badge ? (
                  <Badge tone="neutral" dashed={row.ghost}>
                    {row.badge}
                  </Badge>
                ) : null}
              </div>

              {/* FDN-19: the track carries the scroll-boundary mask, so content
                * fades as it passes under the person column rather than being
                * cut by it. The person column is a sibling and is not masked. */}
              <div
                className="scroll-boundary-fade relative shrink-0"
                style={{ width: trackWidth }}
              >
                {/*
                  * Non-working days, per VRS-F004's index.
                  *
                  * FDN-20: barely there at rest, full weight on row hover. Whose
                  * Saturday is a working day is a fact about that person, and it
                  * matters while you are looking at them rather than while you
                  * are scanning fifteen rows.
                  *
                  * It transitions on the same `group-hover` and at the same
                  * `motion-fast` as the row border, so the two arrive together
                  * as one gesture.
                  */}
                <div className="absolute inset-0 flex">
                  {days.map((day) => (
                    <div
                      key={day.date}
                      style={{ width: dayWidth }}
                      className={cx(
                        "shrink-0 motion-fast transition-colors",
                        !day.isWorking &&
                          "bg-nonworking-rest group-hover:bg-nonworking",
                      )}
                    />
                  ))}
                </div>

                {/* Bench bars, on the same plane as the assignment bars. */}
                {row.bench.map((region) => (
                  <BenchRegion
                    key={region.id}
                    region={region}
                    dayWidth={dayWidth}
                  />
                ))}

                {/* Assignment bars. */}
                {row.bars.map((bar) => (
                  <Bar key={bar.id} bar={bar} dayWidth={dayWidth} />
                ))}

                {/* The today line, drawn per row so it needs no knowledge of
                  * the label column's responsive width. Above bars. */}
                {todayIndex >= 0 ? (
                  <span
                    aria-hidden
                    className="absolute top-0 bottom-0 z-10 w-px bg-brand-500"
                    style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </TooltipProvider>
  );
}

function Bar({ bar, dayWidth }: { bar: TimelineBar; dayWidth: number }) {
  const style: CSSProperties = {
    left: bar.start * dayWidth,
    width: bar.span * dayWidth,
  };

  return (
    <Tooltip content={bar.title ?? bar.label}>
      <div
        style={style}
        className={cx(
          "absolute top-1/2 flex h-bar -translate-y-1/2 items-center overflow-hidden rounded-md px-2",
          FILL[bar.colorToken],
          EDGE[bar.colorToken],
          // A Ghost carries a dashed border on all four sides, per VRS-F007's
          // dashed-border rule. A real assignment carries the 2px left edge.
          bar.ghost ? "border border-dashed" : "border-l-2",
        )}
      >
        {/* text-primary, not text-inverse. A theme-flipping label over a fill
          * that does not flip was never going to hold contrast on eight hues. */}
        <Text variant="small" className="truncate text-text-primary">
          {bar.label}
        </Text>
      </div>
    </Tooltip>
  );
}

/*
 * The signature element.
 *
 * FDN-15: a bar, not a cell. Same radius as an assignment bar and on the same
 * plane, so a row reads as a sequence of periods — assigned, bench, assigned —
 * rather than as bars floating in a tinted cell.
 *
 * The fill is a saturated amber chosen per theme, where assignment bars are
 * tinted. The figure inside is heavier than an assignment label by weight
 * rather than by hue.
 *
 * It does not animate, pulse or draw attention conventionally — the restraint
 * of everything around it is what makes it land.
 */
function BenchRegion({
  region,
  dayWidth,
}: {
  region: TimelineBenchRegion;
  dayWidth: number;
}) {
  const width = region.span * dayWidth;
  const showCost = region.costLabel !== undefined && width >= COST_MIN_WIDTH;
  const showCount = !showCost && width >= COUNT_MIN_WIDTH;

  return (
    <Tooltip content={region.title ?? `${region.workingDays} working days`}>
      <div
        style={{ left: region.start * dayWidth, width }}
        className="absolute top-1/2 flex h-bench-bar -translate-y-1/2 items-center overflow-hidden rounded-md bg-bench px-2"
      >
        {showCost ? (
          <Text variant="mono-medium" className="truncate text-bench-figure">
            {region.costLabel}
          </Text>
        ) : null}
        {/* Weight, not hue: the day count is the same color as the figure and a
          * lighter weight, because it is the same kind of fact stated smaller.
          * This is why `mono` must stay at 400 — see F40. */}
        {showCount ? (
          <Text variant="mono" className="truncate text-bench-figure">
            {region.workingDays}d
          </Text>
        ) : null}
      </div>
    </Tooltip>
  );
}

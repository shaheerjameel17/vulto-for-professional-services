"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CategoricalToken } from "@vulto/tokens";
import {
  Building2,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  FolderKanban,
} from "lucide-react";
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
 * The decisions below were provisional during the build and are now settled in
 * Prototype_Findings' "Settled prototype decisions" table:
 *  - F2  no document gave a day-column width. The caller passes a minimum and
 *        the region scrolls rather than compressing the window to fit.
 *  - F3  the cost figure is `text-primary`.
 *  - F5  a restricted region drops the figure and keeps the day count.
 *  - F7  rows carry no separator, matching Table.
 *  - F29 the bench region matches an assignment bar's height rather than
 *        filling the row.
 */

/**
 * Below this width the cost figure cannot be shown without truncating it, so it
 * is suppressed instead. Sized for `numeric-medium`, which FDN-15 settled on.
 */
const COST_MIN_WIDTH = 72;
/** Below this the day count does not fit either, and nothing is shown. */
const COUNT_MIN_WIDTH = 44;
/** FDN-19/31: how far the track fades at a horizontal scroll boundary. */
const SCROLL_FADE_PX = 24;

/*
 * The date marker's geometry — today's and the cursor's, which are one
 * mechanism differing only in color and in what drives their position.
 *
 * FDN-44 round 3 rebuilds this after measuring the round-2 version: the pill
 * sat at `-bottom-2`, eight pixels outside the track header's border box, and
 * the track header carries `scroll-boundary-fade`. A mask brings
 * `mask-clip: border-box` with it, so everything painted outside that box is
 * masked away — the pill lost its bottom eight pixels, and the header's own
 * `pb-2` then left an eight-pixel gap before the line resumed on row one. It
 * read as a cut-off tab floating above a disconnected line, which is exactly
 * what it was.
 *
 * The rule that replaces it: the marker never leaves the header's border box,
 * and the header has no bottom padding, so the header's bottom edge *is* the
 * first row's top edge. The stem runs from the pill's top edge to that
 * boundary and the pill paints over it, so nothing shows above the pill and
 * nothing interrupts the line below it.
 *
 * The pill is centered in the date row rather than flush to its bottom so it
 * nests inside the bench range pill, which spans that row's full height.
 */
const HEADER_DATE_ROW_PX = 24; /* h-6 */
const MARKER_PILL_PX = 20; /* h-badge */
const MARKER_STEM_TOP_PX = (HEADER_DATE_ROW_PX - MARKER_PILL_PX) / 2;

export type TimelineDay = {
  date: string;
  isWorking: boolean;
  /** Adaptive date label, present only at the chosen horizon's cadence. */
  headerLabel?: string;
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
  clientName?: string;
  percentage?: number;
  endDate?: string;
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
  /** Human-readable business identifier, never the graph UUID. */
  referenceLabel?: string;
  ghost?: boolean;
  badge?: string;
  /** Resolved per employee from the working-day index; never inferred here. */
  workingDayStates: boolean[];
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

/** FDN-33: project identity is a dot inside an otherwise neutral bar. */
const DOT: Record<CategoricalToken, string> = {
  "cat-1": "bg-cat-1",
  "cat-2": "bg-cat-2",
  "cat-3": "bg-cat-3",
  "cat-4": "bg-cat-4",
  "cat-5": "bg-cat-5",
  "cat-6": "bg-cat-6",
  "cat-7": "bg-cat-7",
  "cat-8": "bg-cat-8",
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
  const [hoveredBench, setHoveredBench] = useState<TimelineBenchRegion>();
  const [cursorDateIndex, setCursorDateIndex] = useState<number>();
  /** Raw pixel offset within the track — the line follows this continuously.
   * `cursorDateIndex` is the floored, snapped version the pill uses, so the
   * line moves with the pointer and the pill's date changes the instant the
   * pointer crosses into the next column, rather than both stepping together. */
  const [cursorX, setCursorX] = useState<number>();
  const trackWidth = days.length * dayWidth;

  /*
   * FDN-19/31. The fades at the boundaries of the horizontally scrolling
   * track. The left boundary is the current scroll offset; the right boundary
   * is that offset plus the visible width after the frozen person column. The
   * mask is declared once in the token layer and scrolling touches no state.
   */
  const onScroll = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const x = node.scrollLeft;
    const labelWidth =
      node.querySelector<HTMLElement>("[data-timeline-label]")?.offsetWidth ?? 0;
    const visibleTrackWidth = Math.max(0, node.clientWidth - labelWidth);
    const rightEdge = Math.min(trackWidth, x + visibleTrackWidth);
    const remaining = Math.max(0, trackWidth - rightEdge);
    const leftFade = Math.min(x, SCROLL_FADE_PX);
    const rightFade = Math.min(remaining, SCROLL_FADE_PX);
    node.style.setProperty("--vt-scroll-x", `${x}px`);
    // Clamped to the offset: at rest nothing is hidden, so there is no fade to
    // explain.
    node.style.setProperty("--vt-scroll-fade", `${leftFade}px`);
    node.style.setProperty("--vt-scroll-end", `${rightEdge}px`);
    node.style.setProperty("--vt-scroll-end-fade", `${rightFade}px`);

    /*
     * A mask prevents track paint from hard-clipping, but text needs a stronger
     * rule: "GUST" is still a word even if "AU" faded under the frozen column.
     * Keep the active month label just inside the clear part of the mask and
     * suppress any label that cannot fit completely at either boundary.
     */
    const monthLabels = Array.from(
      node.querySelectorAll<HTMLElement>("[data-timeline-month]"),
    );
    const visibleLeft = x + leftFade + 2;
    const visibleRight = rightEdge - rightFade - 2;
    monthLabels.forEach((month, index) => {
      const start = month.offsetLeft;
      const nextStart = monthLabels[index + 1]?.offsetLeft ?? trackWidth;
      let target = start;
      let visible = start >= x;
      if (start <= x && x < nextStart) {
        target = Math.min(visibleLeft, nextStart - month.offsetWidth - 2);
        visible = target >= start && target >= visibleLeft;
      }
      if (target + month.offsetWidth > visibleRight) visible = false;
      month.style.transform = target === start ? "" : `translateX(${target - start}px)`;
      month.style.visibility = visible ? "visible" : "hidden";
    });

    /*
     * A bar label follows the visible leading edge while horizontal scrolling
     * clips the bar. The transform is clamped to the bar's own width, so the
     * dot and text never escape the bar and disappear naturally with it.
     */
    node.querySelectorAll<HTMLElement>("[data-timeline-scroll-item]").forEach((bar) => {
      const label = bar.querySelector<HTMLElement>("[data-timeline-scroll-label]");
      if (!label) return;
      const start = Number(bar.dataset.timelineStart ?? 0);
      const maximum = Math.max(0, bar.clientWidth - label.offsetWidth);
      const offset = Math.min(maximum, Math.max(0, x - start));
      label.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;
    });
  }, [trackWidth]);

  const trackCursor = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const node = scroller.current;
      if (!node) return;
      const track = node.querySelector<HTMLElement>("[data-timeline-track-header]");
      if (!track) return;
      const pointerX = event.clientX - track.getBoundingClientRect().left;
      if (pointerX < 0 || pointerX > trackWidth) {
        setCursorDateIndex(undefined);
        setCursorX(undefined);
        return;
      }
      const index = Math.floor(pointerX / dayWidth);
      setCursorX(pointerX);
      setCursorDateIndex(index >= 0 && index < days.length ? index : undefined);
    },
    [dayWidth, days.length, trackWidth],
  );

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    onScroll();
    const observer = new ResizeObserver(onScroll);
    observer.observe(node);
    return () => observer.disconnect();
  }, [onScroll]);

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
        onPointerMove={trackCursor}
        onPointerLeave={() => {
          setCursorDateIndex(undefined);
          setCursorX(undefined);
        }}
        // FDN-16: flat. The workspace is now the raised surface, and a bordered
        // canvas inside a bordered inset panel is the nested card VPS-D002
        // forbids.
        /*
         * FDN-43: the scrollbar is the design system's, not the platform's. This
         * is the surface that reported it — 2308px of track in an 1182px viewport
         * put an unstyled OS scrollbar across the bottom of the one screen whose
         * premise is that every value comes from the token set.
         *
         * `-mb-2 pb-2` puts it in the gutter rather than on the canvas. A
         * horizontal scrollbar is painted at the bottom of its container's
         * padding box, so it was landing on top of the last row. The negative
         * margin extends the container down into the space the screen already
         * leaves before the workspace inset, and the matching padding keeps the
         * rows exactly where they were: net layout unchanged.
         *
         * 8px, not 16 — the scrollbar's own thickness. It then fills the strip
         * it was given exactly, sitting flush beneath the last row with the rest
         * of the gutter still clear below it. At 16px it cleared the rows but
         * drifted to the far side of the gap, reading as attached to the inset
         * edge rather than to the grid it scrolls.
         */
        className="scrollbar-slim -mb-2 min-h-0 flex-1 overflow-auto pb-2"
      >
        <div className="min-w-max">
          {/* Column header. Sticky vertically so it survives the row scroll, and
           * above the row hover outline, which is z-20.
           *
           * FDN-44: no bottom padding. The marker has to reach the rows without
           * a break, so the header's bottom edge and the first row's top edge
           * are the same line. Nothing is lost visually — a 52px row carries a
           * 20px bar, so there are already 16px of clear space under the
           * header before anything is drawn. */}
          <div className="sticky top-0 z-30 flex bg-bg-subtle">
            <div
              data-timeline-label
              className="sticky left-0 z-40 flex w-timeline-label shrink-0 items-end bg-bg-subtle px-cell pb-1"
            >
              <Text variant="micro" className="text-text-tertiary">
                Person
              </Text>
            </div>
            <div
              data-timeline-track-header
              className="scroll-boundary-fade relative shrink-0"
              style={{ width: trackWidth }}
            >
              {/* Month labels get their own band. Positioned against the track
               * rather than inside a day cell, so a 12px column does not clip
               * "September". */}
              <div className="relative h-5">
                {hoveredBench ? (
                  <Text
                    variant="micro"
                    className="absolute top-1 whitespace-nowrap text-text-secondary"
                    style={{ left: hoveredBench.start * dayWidth + 2 }}
                  >
                    {formatBenchRange(days, hoveredBench)}
                  </Text>
                ) : (
                  days.map((day, index) =>
                    day.monthLabel ? (
                      <Text
                        key={`month-${day.date}`}
                        data-timeline-month
                        variant="micro"
                        className="absolute top-1 whitespace-nowrap text-text-secondary"
                        style={{ left: index * dayWidth + 2 }}
                      >
                        {day.monthLabel}
                      </Text>
                    ) : null,
                  )
                )}
              </div>
              <div className="relative flex h-6 items-center">
                {/* FDN-44: bordered, matching the horizon toggle, the filter
                 * button and People's filter pills. A bare fill was the only
                 * pill-shaped control surface in the product without one. */}
                {hoveredBench ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 rounded-full border border-border-default bg-bg-active"
                    style={{
                      left: hoveredBench.start * dayWidth + 2,
                      width: Math.max(0, hoveredBench.span * dayWidth - 4),
                    }}
                  />
                ) : null}
                {days.map((day, index) => {
                  return (
                    <div
                      key={day.date}
                      title={day.note ?? day.date}
                      style={{ width: dayWidth }}
                      className="relative z-10 flex shrink-0 items-center justify-center"
                    >
                      {index === todayIndex ? null : day.headerLabel &&
                        !(
                          index === cursorDateIndex &&
                          hoveredBench &&
                          index >= hoveredBench.start &&
                          index < hoveredBench.start + hoveredBench.span
                        ) ? (
                        // The cursor's own date mark paints on top of this cell at
                        // z-20 regardless, but leaving this label under it reads as
                        // two overlapping numbers rather than one. Drop just this
                        // cell's own label — never the pill or the cursor's own
                        // date — for the one index where they'd actually collide.
                        <Text
                          variant="micro"
                          className="whitespace-nowrap text-text-tertiary"
                        >
                          {day.headerLabel}
                        </Text>
                      ) : null}
                    </div>
                  );
                })}

                {/* Both markers live inside the date row, so their coordinates
                 * are the same ones the bench range pill uses and nesting one
                 * inside the other needs no arithmetic. */}
                {todayIndex >= 0 ? (
                  <HeaderMarker
                    tone="today"
                    x={todayIndex * dayWidth + dayWidth / 2}
                    label={days[todayIndex]?.date.slice(8, 10) ?? ""}
                  />
                ) : null}
                {/* FDN-44: the cursor pill takes the pointer's raw pixel
                 * position, exactly as its line does, so the two are one
                 * object that cannot lag behind itself. Only the *label* is
                 * snapped — it names the column under the pointer and changes
                 * the instant that column changes, which is a fact about the
                 * date and not about where the marker is drawn. */}
                {cursorX !== undefined &&
                cursorDateIndex !== undefined &&
                cursorDateIndex !== todayIndex ? (
                  <HeaderMarker
                    tone="cursor"
                    x={cursorX}
                    label={days[cursorDateIndex]?.date.slice(8, 10) ?? ""}
                  />
                ) : null}
              </div>
            </div>
          </div>

          {/* Rows. No separators — separation comes from hover and alignment
           * alone, matching Table. VPS-D002. */}
          {rows.map((row, rowIndex) => {
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
                <div
                  className={cx(
                    "sticky left-0 z-10 flex w-timeline-label shrink-0 items-center bg-bg-subtle px-cell",
                    // The sticky column needs its own fill or the track shows
                    // through as it scrolls beneath. It is now unconditional.
                  )}
                >
                  <div
                    className={cx(
                      "flex w-full items-start gap-2 rounded-md px-2 py-1 motion-fast transition-colors",
                      selected ? "bg-bg-selected" : "group-hover:bg-bg-hover",
                    )}
                  >
                    <Avatar name={row.primaryLabel} size="sm" dashed={row.ghost} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-1">
                        <Text
                          variant="body-medium"
                          className="min-w-0 flex-1 truncate text-text-primary"
                        >
                          {row.primaryLabel}
                        </Text>
                        {row.referenceLabel ? (
                          <Text variant="micro" className="shrink-0 text-text-tertiary">
                            {row.referenceLabel}
                          </Text>
                        ) : null}
                      </span>
                      <Text
                        variant="label"
                        className="block truncate text-text-secondary"
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
                </div>

                {/* FDN-19/31: the track carries the scroll-boundary mask, so
                 * content fades under the person column and at the viewport's
                 * right edge. The person column is a sibling and is not masked. */}
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
                  {/* FDN-44: drawn as runs, not as one element per day. A
                   * Saturday and a Sunday are one stretch of not-working, and
                   * shading them as two adjacent cells meant rounding their
                   * corners would have put a seam down the middle of a single
                   * period. One block per run rounds correctly and renders far
                   * fewer nodes at the 180-day horizon besides. */}
                  <div className="absolute inset-0">
                    {nonWorkingRuns(row.workingDayStates).map((run) => (
                      <div
                        key={run.start}
                        style={{
                          left: run.start * dayWidth,
                          width: run.span * dayWidth,
                        }}
                        className="absolute inset-y-0 rounded-md motion-fast transition-colors group-hover:bg-nonworking"
                      />
                    ))}
                  </div>

                  {/* Bench bars, on the same plane as the assignment bars. */}
                  {row.bench.map((region) => (
                    <BenchRegion
                      key={region.id}
                      region={region}
                      dayWidth={dayWidth}
                      tooltipSide={rowIndex < 2 ? "bottom" : "top"}
                      onHoverChange={setHoveredBench}
                    />
                  ))}

                  {/* Assignment bars. */}
                  {row.bars.map((bar) => (
                    <Bar
                      key={bar.id}
                      bar={bar}
                      dayWidth={dayWidth}
                      tooltipSide={rowIndex < 2 ? "bottom" : "top"}
                    />
                  ))}

                  {/* The inspection line follows the pointer's raw pixel
                   * position continuously — no day-column snapping — and the
                   * pill in the header now takes the same value, so the two
                   * move as one object. `-translate-x-1/2` matches the pill's
                   * own centering, which is what keeps them on a single axis
                   * rather than one pixel apart. */}
                  {cursorX !== undefined && cursorDateIndex !== todayIndex ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-0 bottom-0 z-20 w-px -translate-x-1/2 bg-border-strong"
                      style={{ left: cursorX }}
                    />
                  ) : null}

                  {/* The today line, drawn per row so it needs no knowledge of
                   * the label column's responsive width. Above bars.
                   * FDN-44: `brand-600`, the same token the pill takes — they
                   * resolve to one value today, and a marker that can come
                   * apart under a future ramp change is a marker waiting to. */}
                  {todayIndex >= 0 ? (
                    <span
                      aria-hidden
                      className="absolute top-0 bottom-0 z-10 w-px -translate-x-1/2 bg-brand-600"
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

/*
 * One date marker: a pill naming a day, and the stem that carries it down to
 * the rows. Today and the cursor are the same object — only the fill and what
 * drives `x` differ, which is the whole reason they are one component.
 *
 * The stem starts at the pill's top edge and the pill paints over it at a
 * higher layer, so no stroke ever shows above the pill. What is visible is the
 * two pixels between the pill's bottom and the header's, meeting the per-row
 * line exactly at the boundary.
 */
function HeaderMarker({
  x,
  label,
  tone,
}: {
  x: number;
  label: string;
  tone: "today" | "cursor";
}) {
  const today = tone === "today";
  return (
    <>
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute bottom-0 z-20 w-px -translate-x-1/2",
          today ? "bg-brand-600" : "bg-border-strong",
        )}
        style={{ left: x, top: MARKER_STEM_TOP_PX }}
      />
      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute top-1/2 z-30 inline-flex h-badge -translate-x-1/2",
          "-translate-y-1/2 items-center rounded-full px-2 font-ui text-micro",
          // FDN-44: the cursor pill was `bg-active` while its line was
          // `border-strong` — two different values in both themes, and in dark
          // far apart enough to read as two unrelated marks. One token now
          // carries both.
          today ? "bg-brand-600 text-neutral-0" : "bg-border-strong text-text-primary",
        )}
        style={{ left: x }}
      >
        {label}
      </span>
    </>
  );
}

/*
 * Consecutive non-working days, as runs. VRS-F004 supplies the per-day states;
 * which of them touch is a rendering fact and belongs here.
 */
function nonWorkingRuns(states: boolean[]): { start: number; span: number }[] {
  const runs: { start: number; span: number }[] = [];
  let start: number | null = null;
  states.forEach((working, index) => {
    if (!working) {
      if (start === null) start = index;
      return;
    }
    if (start !== null) {
      runs.push({ start, span: index - start });
      start = null;
    }
  });
  if (start !== null) runs.push({ start, span: states.length - start });
  return runs;
}

function Bar({
  bar,
  dayWidth,
  tooltipSide,
}: {
  bar: TimelineBar;
  dayWidth: number;
  tooltipSide: "top" | "bottom";
}) {
  const style: CSSProperties = {
    left: bar.start * dayWidth,
    width: bar.span * dayWidth,
  };

  return (
    <Tooltip side={tooltipSide} content={<BarTooltip bar={bar} />}>
      <div
        style={style}
        data-timeline-bar
        data-timeline-scroll-item
        data-timeline-start={bar.start * dayWidth}
        className={cx(
          "absolute top-1/2 h-bar -translate-y-1/2 overflow-hidden rounded-md border bg-bg-raised",
          bar.ghost ? "border-dashed border-border-strong" : "border-border-default",
        )}
      >
        <span
          data-timeline-scroll-label
          className="absolute inset-y-0 left-0 flex w-max max-w-full items-center gap-2 px-2"
        >
          <span
            aria-hidden
            className={cx("size-dot shrink-0 rounded-full", DOT[bar.colorToken])}
          />
          <Text variant="small" className="block truncate text-text-primary">
            {bar.label}
          </Text>
        </span>
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
  tooltipSide,
  onHoverChange,
}: {
  region: TimelineBenchRegion;
  dayWidth: number;
  tooltipSide: "top" | "bottom";
  onHoverChange: (region: TimelineBenchRegion | undefined) => void;
}) {
  const width = region.span * dayWidth;
  const showCost = region.costLabel !== undefined && width >= COST_MIN_WIDTH;
  const showCount = !showCost && width >= COUNT_MIN_WIDTH;

  return (
    <Tooltip side={tooltipSide} content={<BenchTooltip region={region} />}>
      <div
        style={{ left: region.start * dayWidth, width }}
        data-timeline-scroll-item
        data-timeline-start={region.start * dayWidth}
        onMouseEnter={() => onHoverChange(region)}
        onMouseLeave={() => onHoverChange(undefined)}
        className="absolute top-1/2 h-bench-bar -translate-y-1/2 overflow-hidden rounded-md bg-bench-rest motion-fast transition-colors group-hover:bg-bench"
      >
        {showCost || showCount ? (
          <span
            data-timeline-scroll-label
            className="absolute inset-y-0 left-0 flex w-max max-w-full items-center px-2"
          >
            {showCost ? (
              <Text variant="numeric-medium" className="truncate text-bench-figure">
                {region.costLabel}
              </Text>
            ) : null}
            {/* Weight, not hue: the day count is the same color as the figure
             * and a lighter weight, because it is the same kind of fact stated
             * smaller. This is why `numeric` stays at 400 — see F40. */}
            {showCount ? (
              <Text variant="numeric" className="truncate text-bench-figure">
                {region.workingDays}d
              </Text>
            ) : null}
          </span>
        ) : null}
      </div>
    </Tooltip>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  const Icon = icon;
  return (
    <div className="flex items-start gap-2">
      <Icon className="size-icon shrink-0 text-text-tertiary" />
      <Text variant="small" className="shrink-0 text-text-secondary">
        {label}:
      </Text>
      <Text variant="small" className="min-w-0 break-words text-text-primary">
        {value}
      </Text>
    </div>
  );
}

function BarTooltip({ bar }: { bar: TimelineBar }) {
  return (
    <div className="flex flex-col gap-2">
      <DetailRow icon={FolderKanban} label="Project" value={bar.label} />
      <DetailRow
        icon={Building2}
        label="Company"
        value={bar.clientName ?? "Unassigned client"}
      />
      <DetailRow
        icon={CircleDollarSign}
        label="Allocation"
        value={`${bar.percentage ?? 100}%`}
      />
      <DetailRow icon={CalendarDays} label="Ends" value={bar.endDate ?? "—"} />
    </div>
  );
}

function BenchTooltip({ region }: { region: TimelineBenchRegion }) {
  return (
    <div className="flex flex-col gap-2">
      <DetailRow
        icon={Clock3}
        label="Bench time"
        value={`${region.workingDays} working days`}
      />
      <DetailRow
        icon={CircleDollarSign}
        label="Unrecovered"
        value={region.costLabel ?? "Outside the 45-day cost horizon"}
      />
      <DetailRow
        icon={CalendarDays}
        label="Range"
        value={region.title ?? "Bench period"}
      />
    </div>
  );
}

function formatBenchRange(days: TimelineDay[], region: TimelineBenchRegion) {
  const start = days[region.start]?.date;
  const end = days[region.start + region.span - 1]?.date;
  if (!start || !end) return "Bench range";
  const format = (date: string) => {
    const month = new Intl.DateTimeFormat("en", {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${date}T00:00:00Z`));
    return `${month} ${Number(date.slice(8, 10))}`;
  };
  return `${format(start)}–${format(end)}`;
}

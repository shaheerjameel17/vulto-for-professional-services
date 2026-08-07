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
import { Building2, CalendarDays, CircleDollarSign, Clock3, FolderKanban } from "lucide-react";
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
 * is suppressed instead. Sized for `numeric-medium`, which FDN-15 settled on.
 */
const COST_MIN_WIDTH = 72;
/** Below this the day count does not fit either, and nothing is shown. */
const COUNT_MIN_WIDTH = 44;
/** FDN-19/31: how far the track fades at a horizontal scroll boundary. */
const SCROLL_FADE_PX = 24;

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
      node.querySelector<HTMLElement>("[data-timeline-label]")?.offsetWidth ??
      0;
    const visibleTrackWidth = Math.max(0, node.clientWidth - labelWidth);
    const rightEdge = Math.min(trackWidth, x + visibleTrackWidth);
    const remaining = Math.max(0, trackWidth - rightEdge);
    const leftFade = Math.min(x, SCROLL_FADE_PX);
    const rightFade = Math.min(remaining, SCROLL_FADE_PX);
    node.style.setProperty("--vt-scroll-x", `${x}px`);
    // Clamped to the offset: at rest nothing is hidden, so there is no fade to
    // explain.
    node.style.setProperty(
      "--vt-scroll-fade",
      `${leftFade}px`,
    );
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
      const labelWidth =
        node.querySelector<HTMLElement>("[data-timeline-label]")?.offsetWidth ?? 0;
      const pointerX = event.clientX - node.getBoundingClientRect().left - labelWidth;
      if (pointerX < 0) {
        setCursorDateIndex(undefined);
        return;
      }
      const index = Math.floor((node.scrollLeft + pointerX) / dayWidth);
      setCursorDateIndex(index >= 0 && index < days.length ? index : undefined);
    },
    [dayWidth, days.length],
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
      onPointerLeave={() => setCursorDateIndex(undefined)}
      // FDN-16: flat. The workspace is now the raised surface, and a bordered
      // canvas inside a bordered inset panel is the nested card VPS-D002
      // forbids.
      className="min-h-0 flex-1 overflow-auto"
    >
      <div className="min-w-max">
        {/* Column header. Sticky vertically so it survives the row scroll, and
          * above the row hover outline, which is z-20. */}
        <div className="sticky top-0 z-30 flex bg-transparent">
          <div
            data-timeline-label
            className="sticky left-0 z-40 flex w-timeline-label shrink-0 items-end bg-bg-subtle px-cell pb-1"
          >
            <Text variant="micro" className="text-text-tertiary">
              Person
            </Text>
          </div>
          <div
            className="scroll-boundary-fade relative shrink-0"
            style={{ width: trackWidth }}
          >
            {/* Month labels get their own band. Positioned against the track
              * rather than inside a day cell, so a 12px column does not clip
              * "September". */}
            <div className="relative h-4">
              {hoveredBench ? (
                <Text
                  variant="micro"
                  className="absolute top-1 whitespace-nowrap text-text-secondary"
                  style={{ left: hoveredBench.start * dayWidth + 2 }}
                >
                  {formatBenchRange(days, hoveredBench)}
                </Text>
              ) : days.map((day, index) =>
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
              )}
            </div>
            <div className="relative flex">
              {hoveredBench ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 rounded-full bg-bg-active"
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
                  className="relative z-10 flex shrink-0 flex-col items-center justify-center"
                >
                  {day.headerLabel ? (
                    <Text variant="micro" className="whitespace-nowrap text-text-tertiary">
                      {index === todayIndex ? (
                        <span className="inline-flex h-badge items-center rounded-full bg-brand-600 px-2 text-neutral-0">
                          {day.date.slice(8, 10)}
                        </span>
                      ) : day.headerLabel}
                    </Text>
                  ) : null}
                </div>
                );
              })}
            </div>
            {/* The 6px dot at the top edge of the today line. The only
              * brand-colored element on the canvas. VPS-D002. */}
            {todayIndex >= 0 ? (
              <span
                aria-hidden
                className="absolute bottom-0 z-20 size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-brand-500"
                style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
              />
            ) : null}
            {cursorDateIndex !== undefined && cursorDateIndex !== todayIndex ? (
              <>
                <span
                  aria-hidden
                  className="absolute bottom-0 z-20 size-dot -translate-x-1/2 translate-y-1/2 rounded-full bg-border-strong"
                  style={{ left: cursorDateIndex * dayWidth + dayWidth / 2 }}
                />
                <span
                  className="pointer-events-none absolute bottom-0 z-20 inline-flex h-badge -translate-x-1/2 items-center rounded-full bg-bg-active px-2 font-ui text-micro text-text-primary"
                  style={{ left: cursorDateIndex * dayWidth + dayWidth / 2 }}
                >
                  {days[cursorDateIndex]?.date.slice(8, 10)}
                </span>
              </>
            ) : null}
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
                  <Avatar
                    name={row.primaryLabel}
                    size="sm"
                    dashed={row.ghost}
                  />
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
                <div className="absolute inset-0 flex">
                  {days.map((_, index) => (
                    <div
                      key={days[index]!.date}
                      style={{ width: dayWidth }}
                      className={cx(
                        "shrink-0 motion-fast transition-colors",
                        !row.workingDayStates[index] && "group-hover:bg-nonworking",
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

                {/* The neutral inspection line follows the pointer and exposes
                  * an exact date without adding persistent grid structure. */}
                {cursorDateIndex !== undefined && cursorDateIndex !== todayIndex ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-border-strong"
                    style={{ left: cursorDateIndex * dayWidth + dayWidth / 2 }}
                  />
                ) : null}

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
      <DetailRow icon={CalendarDays} label="Range" value={region.title ?? "Bench period"} />
    </div>
  );
}

function formatBenchRange(days: TimelineDay[], region: TimelineBenchRegion) {
  const start = days[region.start]?.date;
  const end = days[region.start + region.span - 1]?.date;
  if (!start || !end) return "Bench range";
  const format = (date: string) => {
    const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" })
      .format(new Date(`${date}T00:00:00Z`));
    return `${month} ${Number(date.slice(8, 10))}`;
  };
  return `${format(start)}–${format(end)}`;
}

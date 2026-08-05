"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { CategoricalToken } from "@vulto/tokens";
import { cx } from "./cx";
import { Avatar } from "./Avatar";
import { Badge } from "./Badge";
import { Text } from "./Text";

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

/** Below this width the cost figure cannot be shown without truncating it. */
const COST_MIN_WIDTH = 88;
/** Below this the day count does not fit either, and nothing is shown. */
const COUNT_MIN_WIDTH = 44;

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

const FILL: Record<CategoricalToken, string> = {
  "cat-1": "bg-cat-1",
  "cat-2": "bg-cat-2",
  "cat-3": "bg-cat-3",
  "cat-4": "bg-cat-4",
  "cat-5": "bg-cat-5",
  "cat-6": "bg-cat-6",
  "cat-7": "bg-cat-7",
  "cat-8": "bg-cat-8",
};

const GHOST_FILL: Record<CategoricalToken, string> = {
  "cat-1": "bg-cat-1/12 border-cat-1",
  "cat-2": "bg-cat-2/12 border-cat-2",
  "cat-3": "bg-cat-3/12 border-cat-3",
  "cat-4": "bg-cat-4/12 border-cat-4",
  "cat-5": "bg-cat-5/12 border-cat-5",
  "cat-6": "bg-cat-6/12 border-cat-6",
  "cat-7": "bg-cat-7/12 border-cat-7",
  "cat-8": "bg-cat-8/12 border-cat-8",
};

const GHOST_TEXT: Record<CategoricalToken, string> = {
  "cat-1": "text-cat-1",
  "cat-2": "text-cat-2",
  "cat-3": "text-cat-3",
  "cat-4": "text-cat-4",
  "cat-5": "text-cat-5",
  "cat-6": "text-cat-6",
  "cat-7": "text-cat-7",
  "cat-8": "text-cat-8",
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

  useEffect(() => {
    if (todayIndex < 0 || !scroller.current) return;
    // Land today a little in from the left edge so the run-up is visible.
    const target = Math.max(0, todayIndex * dayWidth - dayWidth * 4);
    scroller.current.scrollTo({ left: target, behavior: "smooth" });
  }, [scrollToTodayNonce, todayIndex, dayWidth]);

  return (
    <div
      ref={scroller}
      className="elevation-raised min-h-0 flex-1 overflow-auto rounded-md"
    >
      <div className="min-w-max">
        {/* Column header. Sticky vertically so it survives the row scroll. */}
        <div className="sticky top-0 z-20 flex bg-bg-surface">
          <div className="sticky left-0 z-30 flex w-timeline-label-narrow shrink-0 items-end border-r border-b border-border-default bg-bg-surface px-cell pb-1 xl:w-timeline-label">
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
                    !day.isWorking && "bg-bg-subtle",
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
              className={cx(
                "group flex h-timeline-row cursor-default",
                selected ? "bg-bg-selected" : "hover:bg-bg-hover",
              )}
            >
              <div
                className={cx(
                  "sticky left-0 z-10 flex w-timeline-label-narrow shrink-0 items-center gap-2",
                  "border-r border-border-default px-cell xl:w-timeline-label",
                  // The sticky column needs its own fill or the track shows
                  // through as it scrolls beneath.
                  selected
                    ? "bg-bg-selected"
                    : "bg-bg-surface group-hover:bg-bg-hover",
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
                  {/* VRS-F005: the role line drops below 1280px. */}
                  <Text
                    variant="small"
                    className="hidden truncate text-text-secondary xl:block"
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

              <div
                className="relative shrink-0"
                style={{ width: trackWidth }}
              >
                {/* Non-working days, per VRS-F004's index. */}
                <div className="absolute inset-0 flex">
                  {days.map((day) => (
                    <div
                      key={day.date}
                      style={{ width: dayWidth }}
                      className={cx(
                        "shrink-0",
                        !day.isWorking && "bg-bg-subtle",
                      )}
                    />
                  ))}
                </div>

                {/* Bench regions, beneath the bars. */}
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
  );
}

function Bar({ bar, dayWidth }: { bar: TimelineBar; dayWidth: number }) {
  const style: CSSProperties = {
    left: bar.start * dayWidth,
    width: bar.span * dayWidth,
  };

  return (
    <div
      title={bar.title ?? bar.label}
      style={style}
      className={cx(
        "absolute top-1/2 flex h-bar -translate-y-1/2 items-center overflow-hidden rounded-md px-2",
        bar.ghost
          ? cx("border border-dashed", GHOST_FILL[bar.colorToken])
          : FILL[bar.colorToken],
      )}
    >
      <Text
        variant="small"
        className={cx(
          "truncate",
          bar.ghost ? GHOST_TEXT[bar.colorToken] : "text-text-inverse",
        )}
      >
        {bar.label}
      </Text>
    </div>
  );
}

/*
 * The signature element.
 *
 * A flat `attention`-tinted region at 12% fill, no border, no pattern, with the
 * accumulated unrecovered cost left-aligned inside it in `mono-lg`. It does not
 * animate, pulse or draw attention conventionally — the restraint of everything
 * around it is what makes it land.
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
    <div
      title={region.title}
      style={{ left: region.start * dayWidth, width }}
      className="absolute inset-y-0 flex items-center overflow-hidden bg-attention/12 px-2"
    >
      {showCost ? (
        <Text variant="mono-lg" className="truncate text-text-primary">
          {region.costLabel}
        </Text>
      ) : null}
      {showCount ? (
        <Text variant="mono" className="truncate text-text-secondary">
          {region.workingDays}d
        </Text>
      ) : null}
    </div>
  );
}

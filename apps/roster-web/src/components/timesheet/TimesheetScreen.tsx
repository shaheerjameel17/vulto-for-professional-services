"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Content,
  InlineAlert,
  Input,
  PageHeader,
  Text,
  ToggleGroup,
  cx,
} from "@vulto/ui";
import { addDays, TODAY, workingWeek } from "../../fixtures/calendar";
import {
  TIMESHEET_EMPLOYEE,
  TIMESHEET_ROWS,
  type TimesheetRow,
} from "../../fixtures/timesheet";

type CellValues = Record<string, string>;
type CellErrors = Record<string, string>;

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function asDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}

function cellKey(rowId: string, date: string) {
  return `${rowId}:${date}`;
}

function displayHours(value: number) {
  return Number(value.toFixed(2)).toString();
}

function numericValue(value: string | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseHours(raw: string, fullDayHours: number) {
  const expression = raw.trim().toLowerCase();
  if (!expression) return { value: 0 };
  if (expression === "fd") return { value: fullDayHours };
  if (expression === "hd") return { value: fullDayHours / 2 };

  const match = expression.match(/^(\d+(?:\.\d+)?)\s*([+-])\s*(\d+(?:\.\d+)?)$/);
  let value: number;
  if (match) {
    const left = Number(match[1]);
    const right = Number(match[3]);
    value = match[2] === "+" ? left + right : left - right;
  } else if (/^\d+(?:\.\d+)?$/.test(expression)) {
    value = Number(expression);
  } else {
    return { error: "Use a number, fd, hd, or a simple expression such as 8-1." };
  }

  if (value < 0 || value > 24) {
    return { error: "Hours must be between 0 and 24." };
  }
  return { value };
}

export function TimesheetScreen() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [values, setValues] = useState<CellValues>({});
  const [errors, setErrors] = useState<CellErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [showSubmittedCheck, setShowSubmittedCheck] = useState(false);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const touchStartX = useRef<number | null>(null);

  const weekAnchor = addDays(TODAY, weekOffset * 7);
  const days = useMemo(
    () => workingWeek(TIMESHEET_EMPLOYEE.entityId, weekAnchor),
    [weekAnchor],
  );

  useEffect(() => {
    setValues({});
    setErrors({});
    setSubmitted(false);
    setSelectedDayIndex(0);
  }, [weekOffset]);

  const totalsByDay = days.map((day) =>
    TIMESHEET_ROWS.reduce(
      (total, row) => total + numericValue(values[cellKey(row.id, day.date)]),
      0,
    ),
  );
  const billableByDay = days.map((day) =>
    TIMESHEET_ROWS.filter((row) => row.kind === "billable").reduce(
      (total, row) => total + numericValue(values[cellKey(row.id, day.date)]),
      0,
    ),
  );
  const totalHours = totalsByDay.reduce((sum, hours) => sum + hours, 0);
  const billableHours = billableByDay.reduce((sum, hours) => sum + hours, 0);
  const remainingBillable = Math.max(
    0,
    TIMESHEET_EMPLOYEE.billableTarget - billableHours,
  );
  const mobileSubmitVisible =
    selectedDayIndex === days.length - 1 ||
    totalsByDay.every((hours) => hours > 0);
  const firstError = Object.values(errors)[0];

  const submitWeek = useCallback(() => {
    if (submitted || totalHours <= 0 || Object.keys(errors).length > 0) return;
    setSubmitted(true);
    setShowSubmittedCheck(true);
    // The motion-base fade itself takes 200ms, so start it early enough for
    // the complete confirmation to clear inside VRS-F010's one-second bound.
    window.setTimeout(() => setShowSubmittedCheck(false), 700);
  }, [errors, submitted, totalHours]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const modified = event.metaKey || event.ctrlKey;
      if (modified && event.key === "Enter") {
        event.preventDefault();
        submitWeek();
        return;
      }

      const target = event.target as HTMLElement | null;
      const inTextEntry =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (modified || inTextEntry) return;
      if (event.key === "[") {
        event.preventDefault();
        setWeekOffset((offset) => offset - 1);
      } else if (event.key === "]") {
        event.preventDefault();
        setWeekOffset((offset) => offset + 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submitWeek]);

  function setRawValue(rowId: string, date: string, value: string) {
    const key = cellKey(rowId, date);
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function commitCell(rowId: string, dayIndex: number) {
    const day = days[dayIndex];
    if (!day) return false;
    const key = cellKey(rowId, day.date);
    const result = parseHours(values[key] ?? "", day.hours);
    if (result.error !== undefined) {
      setErrors((current) => ({ ...current, [key]: result.error! }));
      return false;
    }

    const otherRowsTotal = TIMESHEET_ROWS.filter((row) => row.id !== rowId).reduce(
      (sum, row) => sum + numericValue(values[cellKey(row.id, day.date)]),
      0,
    );
    if (otherRowsTotal + result.value > 24) {
      setErrors((current) => ({
        ...current,
        [key]: `${dayFormatter.format(asDate(day.date))} would total ${displayHours(otherRowsTotal + result.value)}h. A day cannot exceed 24h.`,
      }));
      return false;
    }

    setValues((current) => ({
      ...current,
      [key]: result.value === 0 ? "" : displayHours(result.value),
    }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    return true;
  }

  function moveFocus(rowIndex: number, dayIndex: number) {
    const row = TIMESHEET_ROWS[rowIndex];
    const day = days[dayIndex];
    if (!row || !day) return;
    inputRefs.current[cellKey(row.id, day.date)]?.focus();
  }

  function fillRight(row: TimesheetRow, dayIndex: number) {
    if (submitted) return;
    const sourceDay = days[dayIndex];
    if (!sourceDay) return;
    const sourceKey = cellKey(row.id, sourceDay.date);
    const parsed = parseHours(values[sourceKey] ?? "", sourceDay.hours);
    if (parsed.error !== undefined || parsed.value <= 0) {
      setErrors((current) => ({
        ...current,
        [sourceKey]: parsed.error ?? "Enter a value before filling the row.",
      }));
      return;
    }

    const nextValues = { ...values };
    const nextErrors = { ...errors };
    for (let targetIndex = dayIndex + 1; targetIndex < days.length; targetIndex += 1) {
      const targetDay = days[targetIndex]!;
      const targetKey = cellKey(row.id, targetDay.date);
      const otherRowsTotal = TIMESHEET_ROWS.filter(
        (candidate) => candidate.id !== row.id,
      ).reduce(
        (sum, candidate) =>
          sum + numericValue(nextValues[cellKey(candidate.id, targetDay.date)]),
        0,
      );
      if (otherRowsTotal + parsed.value > 24) {
        nextErrors[targetKey] = `${dayFormatter.format(asDate(targetDay.date))} would exceed 24h.`;
      } else {
        nextValues[targetKey] = displayHours(parsed.value);
        delete nextErrors[targetKey];
      }
    }
    nextValues[sourceKey] = displayHours(parsed.value);
    delete nextErrors[sourceKey];
    setValues(nextValues);
    setErrors(nextErrors);
  }

  function handleCellKeyDown(
    event: KeyboardEvent<HTMLInputElement>,
    row: TimesheetRow,
    rowIndex: number,
    dayIndex: number,
  ) {
    if (event.key === "Tab") {
      const currentIndex = rowIndex * days.length + dayIndex;
      const targetIndex = currentIndex + (event.shiftKey ? -1 : 1);
      if (targetIndex >= 0 && targetIndex < TIMESHEET_ROWS.length * days.length) {
        event.preventDefault();
        commitCell(row.id, dayIndex);
        moveFocus(
          Math.floor(targetIndex / days.length),
          targetIndex % days.length,
        );
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      fillRight(row, dayIndex);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submitWeek();
      return;
    }

    const movement: Record<string, [number, number]> = {
      ArrowLeft: [rowIndex, dayIndex - 1],
      ArrowRight: [rowIndex, dayIndex + 1],
      ArrowUp: [rowIndex - 1, dayIndex],
      ArrowDown: [rowIndex + 1, dayIndex],
    };
    const target = movement[event.key];
    if (target) {
      event.preventDefault();
      commitCell(row.id, dayIndex);
      moveFocus(target[0], target[1]);
    }
  }

  function handleTouchStart(event: TouchEvent) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent) {
    if (touchStartX.current === null) return;
    const end = event.changedTouches[0]?.clientX;
    if (end === undefined) return;
    const delta = end - touchStartX.current;
    if (Math.abs(delta) > 40) {
      setSelectedDayIndex((current) =>
        Math.min(days.length - 1, Math.max(0, current + (delta < 0 ? 1 : -1))),
      );
    }
    touchStartX.current = null;
  }

  const rangeLabel = days.length
    ? `${dateFormatter.format(asDate(days[0]!.date))}–${dateFormatter.format(asDate(days.at(-1)!.date))}`
    : "Current week";

  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle={`${TIMESHEET_EMPLOYEE.name} · ${rangeLabel}`}
        actions={
          submitted ? (
            <div className="flex items-center gap-2">
              <Badge tone="success">Submitted</Badge>
              <Button onClick={() => setSubmitted(false)}>Unlock</Button>
            </div>
          ) : (
            <div className={mobileSubmitVisible ? "block" : "hidden md:block"}>
              <Button
                variant="primary"
                disabled={totalHours <= 0 || Object.keys(errors).length > 0}
                onClick={submitWeek}
              >
                {totalHours > 0
                  ? `Submit ${displayHours(totalHours)}h`
                  : "Submit week"}
              </Button>
            </div>
          )
        }
      />
      <Content className="relative pt-6">
        <div
          aria-live="polite"
          className={cx(
            "pointer-events-none absolute right-6 top-2 flex items-center gap-2",
            "motion-base transition-opacity text-success",
            showSubmittedCheck ? "opacity-100" : "opacity-0",
          )}
        >
          <Check className="size-icon" />
          <Text variant="small">Week submitted</Text>
        </div>

        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <Text variant="h2" className="text-text-primary">
              Weekly entry
            </Text>
            <Text variant="small" className="text-text-secondary">
              Type hours, fd, hd, or expressions such as 8-1. Tab moves across the week.
            </Text>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              icon={ChevronLeft}
              aria-label="Previous week"
              onClick={() => setWeekOffset((offset) => offset - 1)}
            />
            <Text variant="small" className="min-w-20 text-center text-text-secondary">
              {weekOffset === 0 ? "This week" : rangeLabel}
            </Text>
            <Button
              variant="ghost"
              icon={ChevronRight}
              aria-label="Next week"
              onClick={() => setWeekOffset((offset) => offset + 1)}
            />
          </div>
        </div>

        {firstError ? (
          <InlineAlert tone="danger" className="mb-4">
            {firstError}
          </InlineAlert>
        ) : null}

        <div className="hidden overflow-x-auto rounded-lg border border-border-default md:block">
          <table className="min-w-timesheet-grid table-fixed lg:min-w-full">
            <colgroup>
              <col className="w-timesheet-label" />
              {days.map((day) => (
                <col key={day.date} className="w-timesheet-day lg:w-auto" />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border-default">
                <th scope="col" className="h-12 px-cell text-left">
                  <Text variant="micro" className="text-text-tertiary">
                    Work
                  </Text>
                </th>
                {days.map((day) => (
                  <th
                    key={day.date}
                    scope="col"
                    className={cx(
                      "h-12 border-l border-border-default px-cell text-right",
                      day.date === TODAY && "border-t border-brand-500",
                    )}
                  >
                    <Text variant="micro" className="block text-text-tertiary">
                      {dayFormatter.format(asDate(day.date))}
                    </Text>
                    <Text variant="small" className="text-text-secondary">
                      {dateFormatter.format(asDate(day.date))}
                    </Text>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TIMESHEET_ROWS.map((row, rowIndex) => (
                <tr
                  key={row.id}
                  className="h-row border-b border-border-default hover:bg-bg-hover"
                >
                  <th scope="row" className="px-cell text-left font-normal">
                    <Text variant="small" className="block truncate text-text-primary">
                      {row.label}
                    </Text>
                    <Text variant="micro" className="block truncate text-text-tertiary">
                      {row.detail}
                    </Text>
                  </th>
                  {days.map((day, dayIndex) => {
                    const key = cellKey(row.id, day.date);
                    return (
                      <td
                        key={day.date}
                        className="border-l border-border-default px-1"
                      >
                        <input
                          ref={(node) => {
                            inputRefs.current[key] = node;
                          }}
                          aria-label={`${row.label}, ${dayFormatter.format(asDate(day.date))} ${dateFormatter.format(asDate(day.date))}`}
                          inputMode="decimal"
                          readOnly={submitted}
                          value={values[key] ?? ""}
                          onChange={(event) => setRawValue(row.id, day.date, event.target.value)}
                          onBlur={() => commitCell(row.id, dayIndex)}
                          onKeyDown={(event) =>
                            handleCellKeyDown(event, row, rowIndex, dayIndex)
                          }
                          className={cx(
                            "h-control w-full rounded-md bg-transparent px-2 text-right",
                            "font-ui text-numeric numeric-tabular text-text-primary",
                            "outline-none hover:bg-bg-subtle",
                            "focus-visible:outline focus-visible:outline-2",
                            "focus-visible:outline-border-focus focus-visible:outline-offset-2",
                            errors[key] && "border border-danger",
                            submitted && "cursor-default bg-bg-subtle",
                          )}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-bg-subtle">
              <tr className="h-row border-t border-border-default">
                <th scope="row" className="px-cell text-left">
                  <Text variant="body-medium" className="text-text-primary">
                    Daily total
                  </Text>
                </th>
                {totalsByDay.map((hours, index) => (
                  <td
                    key={days[index]!.date}
                    className="border-l border-border-default px-cell text-right"
                  >
                    <Text variant="numeric-lg" className="text-text-primary">
                      {displayHours(hours)}
                    </Text>
                    <Text variant="numeric" className="block text-text-secondary">
                      {displayHours(billableByDay[index] ?? 0)} billable
                    </Text>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        <div
          className="md:hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mb-4 overflow-x-auto">
            <ToggleGroup
              label="Working day"
              value={days[selectedDayIndex]?.date ?? ""}
              options={days.map((day) => ({
                value: day.date,
                label: `${dayFormatter.format(asDate(day.date))} ${dateFormatter.format(asDate(day.date))}`,
              }))}
              onChange={(date) =>
                setSelectedDayIndex(Math.max(0, days.findIndex((day) => day.date === date)))
              }
            />
          </div>
          <div className="flex flex-col gap-3">
            {TIMESHEET_ROWS.map((row) => {
              const day = days[selectedDayIndex];
              if (!day) return null;
              const key = cellKey(row.id, day.date);
              return (
                <Card key={row.id} title={row.label}>
                  <Text variant="small" className="mb-3 text-text-secondary">
                    {row.detail}
                  </Text>
                  <Input
                    label="Hours"
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    suffix="h"
                    readOnly={submitted}
                    value={values[key] ?? ""}
                    error={errors[key]}
                    onChange={(event) => setRawValue(row.id, day.date, event.target.value)}
                    onBlur={() => commitCell(row.id, selectedDayIndex)}
                    onStepValue={
                      submitted
                        ? undefined
                        : (value) => setRawValue(row.id, day.date, value)
                    }
                  />
                </Card>
              );
            })}
          </div>
          <Text variant="small" className="mt-4 text-text-secondary">
            Logged today {displayHours(totalsByDay[selectedDayIndex] ?? 0)}h · Target {displayHours(days[selectedDayIndex]?.hours ?? 0)}h
          </Text>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-border-default pt-4">
          <Text
            variant="small"
            className={remainingBillable > 0 ? "text-attention" : "text-success"}
          >
            Billable target {TIMESHEET_EMPLOYEE.billableTarget}h · Logged {displayHours(billableHours)}h · Remaining {displayHours(remainingBillable)}h
          </Text>
          <Text variant="small" className="text-text-tertiary">
            Cmd+D fills right · Cmd+Enter submits · [ ] changes week
          </Text>
        </div>
      </Content>
    </>
  );
}

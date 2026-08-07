"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import * as RadixSelect from "@radix-ui/react-select";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEventHandler, type Ref } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

export type DatePickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  onCancel?: () => void;
  helperText?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function parseIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function DatePicker({
  label,
  value,
  onChange,
  onCommit,
  onCancel,
  helperText,
  inputRef,
  onKeyDown,
}: DatePickerProps) {
  const id = useId();
  const parsed = parseIso(value);
  const today = new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(parsed?.year ?? today.getFullYear());
  const [month, setMonth] = useState(parsed?.month ?? today.getMonth());

  useEffect(() => {
    const next = parseIso(value);
    if (!next) return;
    setYear(next.year);
    setMonth(next.month);
  }, [value]);

  const years = useMemo(() => {
    const center = parsed?.year ?? today.getFullYear();
    return Array.from({ length: 41 }, (_, index) => center - 20 + index);
  }, [parsed?.year, today]);

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });

  function moveMonth(direction: -1 | 1) {
    const next = new Date(Date.UTC(year, month + direction, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
  }

  function choose(day: number) {
    const next = iso(year, month, day);
    onChange(next);
    onCommit?.(next);
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <Text as="label" htmlFor={id} variant="label" className="text-text-secondary">
        {label}
      </Text>
      <div className="flex h-control items-center rounded-md border border-border-default bg-bg-surface has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-border-focus has-[:focus-visible]:outline-offset-2">
        <input
          ref={inputRef}
          id={id}
          value={value}
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          aria-describedby={helperText ? `${id}-help` : undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            if (!open && parseIso(value)) onCommit?.(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel?.();
              return;
            }
            onKeyDown?.(event);
          }}
          className="h-full min-w-0 flex-1 rounded-md bg-transparent px-3 font-ui text-body text-text-primary outline-none"
        />
        <RadixPopover.Root open={open} onOpenChange={setOpen}>
          <RadixPopover.Trigger asChild>
            <button
              type="button"
              aria-label={`Open ${label.toLowerCase()} calendar`}
              onMouseDown={(event) => event.preventDefault()}
              className="flex size-control shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            >
              <Icon icon={CalendarDays} />
            </button>
          </RadixPopover.Trigger>
          <RadixPopover.Portal>
            <RadixPopover.Content
              align="start"
              sideOffset={4}
              collisionPadding={12}
              className="z-50 w-tooltip rounded-lg border border-border-default bg-bg-raised p-3 elevation-overlay"
            >
              <div className="mb-3 flex items-center gap-2">
                <Button size="sm" variant="ghost" icon={ChevronLeft} aria-label="Previous month" onClick={() => moveMonth(-1)} />
                <PickerSelect value={String(month)} onChange={(next) => setMonth(Number(next))} options={MONTHS.map((name, index) => ({ value: String(index), label: name }))} label="Month" />
                <PickerSelect value={String(year)} onChange={(next) => setYear(Number(next))} options={years.map((item) => ({ value: String(item), label: String(item) }))} label="Year" />
                <Button size="sm" variant="ghost" icon={ChevronRight} aria-label="Next month" onClick={() => moveMonth(1)} />
              </div>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((weekday) => (
                  <Text key={weekday} variant="micro" className="flex size-control items-center justify-center text-text-tertiary">
                    {weekday}
                  </Text>
                ))}
                {cells.map((day, index) => {
                  const selected = day !== null && parsed?.year === year && parsed.month === month && parsed.day === day;
                  return day === null ? <span key={`empty-${index}`} className="size-control" /> : (
                    <button
                      key={day}
                      type="button"
                      onClick={() => choose(day)}
                      className={cx(
                        "flex size-control items-center justify-center rounded-full font-ui text-small motion-fast transition-colors",
                        selected ? "bg-brand-600 text-text-inverse" : "text-text-primary hover:bg-bg-hover",
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </RadixPopover.Content>
          </RadixPopover.Portal>
        </RadixPopover.Root>
      </div>
      {helperText ? <Text id={`${id}-help`} variant="small" className="text-text-secondary">{helperText}</Text> : null}
    </div>
  );
}

function PickerSelect({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; label: string }) {
  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger aria-label={label} className="flex h-control min-w-0 flex-1 items-center justify-between gap-1 rounded-full bg-bg-surface px-2 font-ui text-small text-text-primary hover:bg-bg-hover">
        <RadixSelect.Value />
        <Icon icon={ChevronDown} className="text-text-tertiary" />
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content position="popper" sideOffset={4} className="z-50 max-h-filter-list min-w-20 overflow-hidden rounded-lg border border-border-default bg-bg-raised p-1 elevation-overlay">
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item key={option.value} value={option.value} className="flex h-control cursor-pointer items-center gap-2 rounded-md px-2 font-ui text-small text-text-primary outline-none data-[highlighted]:bg-bg-hover">
                <span className="flex size-icon items-center justify-center"><RadixSelect.ItemIndicator><Icon icon={Check} /></RadixSelect.ItemIndicator></span>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

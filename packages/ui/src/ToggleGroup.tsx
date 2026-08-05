"use client";

import * as RadixToggleGroup from "@radix-ui/react-toggle-group";
import { cx } from "./cx";

/*
 * VPS-D002. Handles small mutually exclusive sets — density mode, timeline
 * zoom — and replaces a Select where there are three or fewer options.
 *
 * Radix supplies the keyboard interaction and ARIA wiring that VPS-D002's
 * accessibility floor requires.
 */

export type ToggleGroupOption<T extends string> = {
  value: T;
  label: string;
  /** Shown on hover, which is how single-letter shortcuts are discovered. */
  shortcut?: string;
};

export type ToggleGroupProps<T extends string> = {
  label: string;
  value: T;
  options: ToggleGroupOption<T>[];
  onChange: (value: T) => void;
  className?: string;
};

export function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: ToggleGroupProps<T>) {
  return (
    <RadixToggleGroup.Root
      type="single"
      value={value}
      aria-label={label}
      onValueChange={(next) => {
        // Radix emits "" when the active item is pressed again. This is a
        // mutually exclusive set, so that is not a valid state.
        if (next) onChange(next as T);
      }}
      className={cx(
        "inline-flex items-center rounded-md border border-border-default",
        "bg-bg-surface p-0",
        className,
      )}
    >
      {options.map((option) => (
        <RadixToggleGroup.Item
          key={option.value}
          value={option.value}
          title={option.shortcut ? `${option.label} · ${option.shortcut}` : option.label}
          className={cx(
            "inline-flex h-control items-center rounded-md px-3",
            "font-ui text-body-medium text-text-secondary",
            "motion-fast transition-colors hover:bg-bg-hover",
            "data-[state=on]:bg-bg-selected data-[state=on]:text-text-brand",
          )}
        >
          {option.label}
        </RadixToggleGroup.Item>
      ))}
    </RadixToggleGroup.Root>
  );
}

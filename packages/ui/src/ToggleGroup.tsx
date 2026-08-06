"use client";

import * as RadixToggleGroup from "@radix-ui/react-toggle-group";
import type { ReactElement } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";

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
        // FDN-16: segmented controls are pills. Buttons keep radius-md — the
        // distinction is between a control you set and an action you take.
        //
        // FDN-20: the track recesses and the active segment sits on top of it.
        // A brand fill carried the active state alone; one neutral fill cannot,
        // so the control now separates by fill, weight and color together.
        "inline-flex items-center rounded-full border border-border-default",
        "bg-segment-track p-1",
        className,
      )}
    >
      {options.map((option) => (
        // FDN-19: a tooltip only where there is a shortcut to document. The
        // label is already visible, so a tooltip repeating it was noise — which
        // is most of what the native `title` attribute was doing here.
        <MaybeTooltip key={option.value} shortcut={option.shortcut}>
        <RadixToggleGroup.Item
          value={option.value}
          className={cx(
            "inline-flex h-control items-center rounded-full px-3",
            // Inactive: lighter weight and secondary color.
            "font-ui text-body text-text-secondary",
            "motion-fast transition-colors hover:text-text-primary",
            // Active: raised off the track, primary color, heavier weight.
            // FDN-18 took brand out of here; three neutral channels replace it.
            "data-[state=on]:bg-segment-active data-[state=on]:text-text-primary",
            "data-[state=on]:text-body-medium",
          )}
        >
          {option.label}
        </RadixToggleGroup.Item>
        </MaybeTooltip>
      ))}
    </RadixToggleGroup.Root>
  );
}

function MaybeTooltip({
  shortcut,
  children,
}: {
  shortcut?: string;
  children: ReactElement;
}) {
  if (!shortcut) return children;
  return (
    <Tooltip content="Shortcut" shortcut={shortcut}>
      {children}
    </Tooltip>
  );
}

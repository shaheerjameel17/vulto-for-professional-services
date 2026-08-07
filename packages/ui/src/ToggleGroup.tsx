"use client";

import * as RadixToggleGroup from "@radix-ui/react-toggle-group";
import type { ReactElement } from "react";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";

/*
 * VPS-D002. Handles small mutually exclusive sets — appearance theme, timeline
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
  trackClassName?: string;
  activeClassName?: string;
};

export function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  trackClassName,
  activeClassName,
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
        trackClassName,
        className,
      )}
    >
      {options.map((option) => {
        /*
         * FDN-23. The active state is computed from `value` directly rather
         * than read off Radix's own `data-state`, which is not this
         * component's to rely on: Tooltip.Trigger's `asChild` merges its own
         * `data-state` ("closed"/"open", tooltip visibility) onto whatever it
         * wraps, and when that happens to be a ToggleGroup.Item, the two
         * primitives collide on the one attribute and the wrapper wins. The
         * Horizon control below is wrapped for its shortcut hint; Viewing-as
         * never is, which is the entire reason only one of them went dark.
         *
         * A JS-known boolean sidesteps the collision rather than working
         * around this one instance, and matches how every other active state
         * in this design system is already driven (Sidebar's nav item,
         * Timeline's row selection) — neither of those reads a Radix
         * data-attribute either.
         */
        const active = option.value === value;
        return (
          // FDN-19: a tooltip only where there is a shortcut to document. The
          // label is already visible, so a tooltip repeating it was noise —
          // which is most of what the native `title` attribute was doing here.
          <MaybeTooltip key={option.value} shortcut={option.shortcut}>
            <RadixToggleGroup.Item
              value={option.value}
              className={cx(
                "inline-flex h-control items-center rounded-full px-3",
                "font-ui motion-fast transition-colors",
                // Active: raised off the track, primary color, heavier weight.
                // FDN-18 took brand out of here; three neutral channels
                // replace it. Inactive: lighter weight and secondary color.
                active
                  ? cx("bg-segment-active text-body-medium text-text-primary", activeClassName)
                  : "text-body text-text-secondary hover:text-text-primary",
              )}
            >
              {option.label}
            </RadixToggleGroup.Item>
          </MaybeTooltip>
        );
      })}
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

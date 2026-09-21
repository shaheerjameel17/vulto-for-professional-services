"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * VPS-D002, corrected by FDN-25: the segmented-control treatment, not an
 * underline. Tabs and Toggle Group are one visual language — a track with
 * `1` internal padding, the active segment raised onto its own fill with a
 * weight change, neutral throughout. Tabs switch views of the same object;
 * they never carry unsaved state between them.
 *
 * The active state is computed from `value` directly, exactly as
 * ToggleGroup's is, rather than read off Radix's own `data-state`. That is
 * FDN-23's lesson applied here before it needed to be — the moment a
 * Trigger is ever wrapped in Tooltip, `data-state` stops being this
 * component's alone, and the new rule in VPS-D002 says a component derives
 * its visual state from a value it holds rather than an attribute a second
 * primitive might also be writing.
 *
 * Radix supplies arrow-key navigation between triggers and the ARIA wiring
 * VPS-D002's accessibility floor requires.
 */

export type TabItem = {
  value: string;
  label: string;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
};

export function Tabs({ items, value, onChange, children }: TabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onChange}>
      <RadixTabs.List
        className={cx(
          "inline-flex items-center rounded-full border border-border-default",
          "bg-segment-track p-1",
        )}
      >
        {items.map((item) => {
          const active = item.value === value;
          return (
            <RadixTabs.Trigger
              key={item.value}
              value={item.value}
              className={cx(
                "inline-flex h-control items-center rounded-full px-3",
                "font-ui motion-fast transition-colors",
                active
                  ? "bg-segment-active text-body-medium text-text-primary"
                  : "text-body text-text-secondary hover:text-text-primary",
              )}
            >
              {item.label}
            </RadixTabs.Trigger>
          );
        })}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Content value={value} className="pt-6">
      {children}
    </RadixTabs.Content>
  );
}

"use client";

import * as RadixTabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * VPS-D002. Underline style: 2px brand-500 on the active tab, text-secondary
 * on the rest. Tabs switch views of the same object. They never carry
 * unsaved state between them.
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
      <RadixTabs.List className="flex gap-6 border-b border-border-default">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={cx(
              "flex h-10 items-center border-b-2 border-transparent",
              "font-ui text-body-medium text-text-secondary",
              "motion-fast transition-colors hover:text-text-primary",
              "data-[state=active]:border-brand-500 data-[state=active]:text-text-primary",
            )}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {children}
    </RadixTabs.Root>
  );
}

export function TabPanel({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return (
    <RadixTabs.Content value={value} className="pt-6">
      {children}
    </RadixTabs.Content>
  );
}

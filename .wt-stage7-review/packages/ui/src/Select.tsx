"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

export type SelectOption<T extends string> = { value: T; label: string };

export type SelectProps<T extends string> = {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
};

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: SelectProps<T>) {
  const inputId = `select-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <Text
        as="label"
        htmlFor={inputId}
        variant="label"
        className="text-text-secondary"
      >
        {label}
      </Text>
      <RadixSelect.Root value={value} onValueChange={(next) => onChange(next as T)}>
        <RadixSelect.Trigger
          id={inputId}
          className={cx(
            "flex h-control w-full items-center justify-between rounded-md border",
            "border-border-default bg-bg-surface px-3",
            "font-ui text-body text-text-primary",
            "focus-visible:outline focus-visible:outline-2",
            "focus-visible:outline-border-focus focus-visible:outline-offset-2",
          )}
        >
          <RadixSelect.Value />
          <RadixSelect.Icon>
            <Icon icon={ChevronDown} className="text-text-tertiary" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            className="z-50 min-w-tooltip overflow-hidden rounded-lg border border-border-default bg-bg-raised p-1 elevation-overlay"
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  className="flex h-control cursor-pointer select-none items-center gap-2 rounded-md px-2 font-ui text-body text-text-primary outline-none data-[highlighted]:bg-bg-hover"
                >
                  <span className="flex size-icon items-center justify-center">
                    <RadixSelect.ItemIndicator>
                      <Check className="size-3" strokeWidth={2.5} />
                    </RadixSelect.ItemIndicator>
                  </span>
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}

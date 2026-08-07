"use client";

import * as RadixCheckbox from "@radix-ui/react-checkbox";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

/*
 * FDN-30. A bounded filter trigger backed by an unbounded option list.
 * Selected values never expand into a toolbar full of chips: the trigger
 * states all, one label, or a count, while the popover owns search and the
 * complete checkbox list.
 */

export type MultiSelectOption<T extends string> = {
  value: T;
  label: string;
  keywords?: string;
};

export type MultiSelectProps<T extends string> = {
  label: string;
  allLabel: string;
  value: T[];
  options: MultiSelectOption<T>[];
  onChange: (value: T[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** A compact white filter pill that exposes state as a dot and clear action. */
  appearance?: "default" | "filter";
};

export function MultiSelect<T extends string>({
  label,
  allLabel,
  value,
  options,
  onChange,
  searchable = false,
  searchPlaceholder = "Search",
  appearance = "default",
}: MultiSelectProps<T>) {
  const [query, setQuery] = useState("");
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = useMemo(() => new Set(value), [value]);
  const allSelected = options.length > 0 && value.length === options.length;

  const filteredOptions = options.filter((option) => {
    const haystack = `${option.label} ${option.keywords ?? ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const summary = (() => {
    if (value.length === 0 || allSelected) return allLabel;
    if (value.length === 1) {
      return options.find((option) => option.value === value[0])?.label ?? allLabel;
    }
    return `${value.length} selected`;
  })();

  function toggle(option: T) {
    const next = new Set(value);
    if (next.has(option)) next.delete(option);
    else next.add(option);
    onChange(Array.from(next));
  }

  function moveFocus(index: number, direction: -1 | 1) {
    const count = filteredOptions.length;
    if (count === 0) return;
    const next = (index + direction + count) % count;
    optionRefs.current[next]?.focus();
  }

  const filterAppearance = appearance === "filter";
  const hasActiveFilter = value.length > 0 && !allSelected;

  return (
    <RadixPopover.Root onOpenChange={(open) => !open && setQuery("")}>
      <div className={cx(filterAppearance && "inline-flex h-control items-center rounded-full bg-bg-raised")}>
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${summary}`}
            className={cx(
              "inline-flex h-control items-center gap-2 font-ui text-body text-text-primary",
              filterAppearance ? "rounded-full px-3 hover:bg-bg-hover" : "rounded-md border border-border-default bg-bg-surface px-3 hover:border-border-strong hover:bg-bg-hover",
              "motion-fast transition-colors focus-visible:outline focus-visible:outline-2",
              "focus-visible:outline-border-focus focus-visible:outline-offset-2",
            )}
          >
            {filterAppearance && hasActiveFilter ? <span aria-hidden className="size-dot rounded-full bg-brand-500" /> : null}
            <span className={filterAppearance ? "text-text-primary" : "text-text-secondary"}>{label}</span>
            {!filterAppearance ? <span className="text-body-medium">{summary}</span> : null}
            <Icon icon={ChevronDown} className="text-text-tertiary" />
          </button>
        </RadixPopover.Trigger>
        {filterAppearance && hasActiveFilter ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()} filter`}
            onClick={() => onChange([])}
            className="flex size-control items-center justify-center rounded-full text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          >
            <Icon icon={X} />
          </button>
        ) : null}
      </div>

      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className={cx(
            "z-50 w-tooltip rounded-lg border border-border-default",
            "bg-bg-raised p-2 elevation-overlay",
            "motion-fast transition-opacity",
          )}
        >
          {searchable ? (
            <div className="mb-2 flex h-control items-center gap-2 rounded-md border border-border-default bg-bg-surface px-2 focus-within:border-border-strong">
              <Icon icon={Search} className="shrink-0 text-text-tertiary" />
              <input
                autoFocus
                aria-label={`Search ${label.toLowerCase()}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-full min-w-0 flex-1 bg-transparent font-ui text-body text-text-primary outline-none"
              />
            </div>
          ) : null}

          <div role="group" aria-label={label} className="max-h-filter-list overflow-y-auto">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => {
                const checked = selected.has(option.value);
                const optionId = `multi-${label}-${option.value}`
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, "-");
                return (
                  <label
                    key={option.value}
                    htmlFor={optionId}
                    className="flex h-control cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-bg-hover"
                  >
                    <RadixCheckbox.Root
                      ref={(node) => {
                        optionRefs.current[index] = node;
                      }}
                      id={optionId}
                      checked={checked}
                      onCheckedChange={() => toggle(option.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          moveFocus(index, 1);
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          moveFocus(index, -1);
                        }
                      }}
                      className={cx(
                        "flex size-icon shrink-0 items-center justify-center rounded-sm border",
                        checked
                          ? "border-brand-600 bg-brand-600 text-text-inverse"
                          : "border-border-strong bg-bg-surface",
                        "focus-visible:outline focus-visible:outline-2",
                        "focus-visible:outline-border-focus focus-visible:outline-offset-2",
                      )}
                    >
                      <RadixCheckbox.Indicator>
                        <Check className="size-3" strokeWidth={2.5} />
                      </RadixCheckbox.Indicator>
                    </RadixCheckbox.Root>
                    <Text variant="body" className="min-w-0 truncate text-text-primary">
                      {option.label}
                    </Text>
                  </label>
                );
              })
            ) : (
              <Text variant="small" className="px-2 py-3 text-text-secondary">
                No matches.
              </Text>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-border-default pt-2">
            <button
              type="button"
              onClick={() => onChange(options.map((option) => option.value))}
              className="rounded-md px-2 py-1 font-ui text-small text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={value.length === 0}
              className="rounded-md px-2 py-1 font-ui text-small text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

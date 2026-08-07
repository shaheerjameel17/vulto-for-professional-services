"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, type KeyboardEventHandler, type Ref } from "react";
import { Icon } from "./Icon";
import { Text } from "./Text";

const COUNTRIES = [
  { code: "GB", flag: "🇬🇧", name: "United Kingdom", dial: "+44", placeholder: "7700 900123" },
  { code: "PK", flag: "🇵🇰", name: "Pakistan", dial: "+92", placeholder: "300 1234567" },
  { code: "US", flag: "🇺🇸", name: "United States", dial: "+1", placeholder: "202 555 0123" },
  { code: "AE", flag: "🇦🇪", name: "United Arab Emirates", dial: "+971", placeholder: "50 123 4567" },
  { code: "SA", flag: "🇸🇦", name: "Saudi Arabia", dial: "+966", placeholder: "50 123 4567" },
] as const;

export type PhoneInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
};

export function PhoneInput({ label, value, onChange, onCommit, onCancel, inputRef, onKeyDown }: PhoneInputProps) {
  const country = useMemo(() => {
    const compact = value.replace(/\s/g, "");
    return COUNTRIES.find((item) => compact.startsWith(item.dial)) ?? COUNTRIES[0];
  }, [value]);
  const national = value.replace(/\s/g, "").slice(country.dial.length);

  function changeCountry(code: string) {
    const next = COUNTRIES.find((item) => item.code === code) ?? COUNTRIES[0];
    onChange(`${next.dial} ${national}`.trim());
  }

  return (
    <div className="flex flex-col gap-1">
      <Text variant="label" className="text-text-secondary">{label}</Text>
      <div className="flex h-control items-center rounded-md border border-border-default bg-bg-surface has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-border-focus has-[:focus-visible]:outline-offset-2">
        <RadixSelect.Root value={country.code} onValueChange={changeCountry}>
          <RadixSelect.Trigger onMouseDown={(event) => event.preventDefault()} aria-label="Country calling code" className="flex h-full shrink-0 items-center gap-1 rounded-l-md border-r border-border-default px-2 font-ui text-small text-text-primary hover:bg-bg-hover">
            <span aria-hidden>{country.flag}</span>
            <span>{country.dial}</span>
            <Icon icon={ChevronDown} className="text-text-tertiary" />
          </RadixSelect.Trigger>
          <RadixSelect.Portal>
            <RadixSelect.Content position="popper" sideOffset={4} className="z-50 min-w-tooltip overflow-hidden rounded-lg border border-border-default bg-bg-raised p-1 elevation-overlay">
              <RadixSelect.Viewport>
                {COUNTRIES.map((item) => (
                  <RadixSelect.Item key={item.code} value={item.code} className="flex h-control cursor-pointer items-center gap-2 rounded-md px-2 font-ui text-body text-text-primary outline-none data-[highlighted]:bg-bg-hover">
                    <span className="flex size-icon items-center justify-center"><RadixSelect.ItemIndicator><Icon icon={Check} /></RadixSelect.ItemIndicator></span>
                    <span aria-hidden>{item.flag}</span>
                    <RadixSelect.ItemText>{item.name} · {item.dial}</RadixSelect.ItemText>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Viewport>
            </RadixSelect.Content>
          </RadixSelect.Portal>
        </RadixSelect.Root>
        <input
          ref={inputRef}
          value={national}
          type="tel"
          inputMode="tel"
          placeholder={country.placeholder}
          aria-label={`${label} without country code`}
          onChange={(event) => onChange(`${country.dial} ${event.target.value}`)}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel?.();
              return;
            }
            onKeyDown?.(event);
          }}
          className="h-full min-w-0 flex-1 rounded-r-md bg-transparent px-3 font-ui text-body text-text-primary outline-none"
        />
      </div>
      <Text variant="small" className="text-text-tertiary">Enter the national number only; the country code is added automatically.</Text>
    </div>
  );
}

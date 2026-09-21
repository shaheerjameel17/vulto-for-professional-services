"use client";

import { Select } from "./Select";

const CURRENCIES = [
  { value: "GBP", label: "£ GBP" },
  { value: "USD", label: "$ USD" },
  { value: "EUR", label: "€ EUR" },
  { value: "PKR", label: "₨ PKR" },
  { value: "AED", label: "د.إ AED" },
  { value: "SAR", label: "ر.س SAR" },
];

export function currencyLabel(value: string) {
  return CURRENCIES.find((currency) => currency.value === value)?.label ?? value;
}

export function CurrencySelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select label={label} value={value} options={CURRENCIES} onChange={onChange} />
  );
}

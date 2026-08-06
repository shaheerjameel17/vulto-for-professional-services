import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Text } from "./Text";

/*
 * VPS-D002. 28px height at compact, 32px comfortable. 1px border-default,
 * radius-md, bg-surface. Focus is a 2px border-focus ring at 2px offset,
 * never an inner glow.
 *
 * Labels sit above at `label`, `text-secondary`. Helper text sits below at
 * `small`. Error state turns the border `danger` and replaces helper text
 * with the error, which states what is wrong and how to fix it.
 *
 * VPS-D002 groups Input, Select, Textarea and DatePicker as one visual
 * treatment — this is the shell all four share. The prototype has only this
 * one: a field whose value is a fixed set of options still renders as an
 * Input here rather than a working Select, since the dropdown affordance
 * itself is not what this screen exists to test.
 */

export type InputProps = {
  label: string;
  helperText?: string;
  error?: string;
  suffix?: ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

export function Input({
  label,
  helperText,
  error,
  suffix,
  id,
  ...rest
}: InputProps) {
  const inputId = id ?? `input-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId}>
        <Text variant="label" className="text-text-secondary">
          {label}
        </Text>
      </label>
      <div className="relative">
        <input
          id={inputId}
          className={cx(
            "h-control w-full rounded-md border bg-bg-surface px-3",
            "font-ui text-body text-text-primary",
            "motion-fast transition-colors",
            error ? "border-danger" : "border-border-default",
            suffix !== undefined && "pr-12",
          )}
          {...rest}
        />
        {suffix ? (
          <span className="absolute inset-y-0 right-3 flex items-center">
            <Text variant="small" className="text-text-tertiary">
              {suffix}
            </Text>
          </span>
        ) : null}
      </div>
      {error ? (
        <Text variant="small" className="text-danger">
          {error}
        </Text>
      ) : helperText ? (
        <Text variant="small" className="text-text-secondary">
          {helperText}
        </Text>
      ) : null}
    </div>
  );
}

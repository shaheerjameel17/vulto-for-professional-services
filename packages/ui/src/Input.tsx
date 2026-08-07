import { ChevronDown, ChevronUp } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";
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
 *
 * FDN-24, the affix contract. A prefix or suffix is a sibling of the actual
 * <input> inside one shared bordered container — never a child positioned
 * over it. The border, the focus ring and the disabled/error states all
 * belong to the container now, not to the input element, which is why the
 * container carries them and the input itself is borderless and transparent.
 *
 * This is what makes the contract hold regardless of what the browser draws
 * inside the input: a number field's native step spinner renders inside the
 * input's own box, and an affix positioned in that same box — by padding,
 * by absolute placement, any way that isn't a sibling — will eventually sit
 * on top of it. A sibling never can, because there is nothing for it to
 * overlap; the spinner has no box left to render into once the affix has
 * taken its own flex share. The `no-spinner` utility is applied on top of
 * that, since a numeric field carrying an affix has no room to gain a
 * spinner back if the browser ever reserves space for one anyway.
 *
 * FDN-28 replaces that suppressed browser spinner with explicit shared
 * controls. They are siblings of the input and its affixes, so they reserve
 * space rather than drawing over a unit. Arrow keys remain native to the
 * focused number input; pointer controls use `onStepValue`.
 */

export type InputProps = {
  label: string;
  helperText?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  onStepValue?: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
  // `HTMLAttributes` already declares an RDFa `prefix?: string`, which
  // intersects silently with the richer `ReactNode` prop above unless
  // omitted here too — the same reason `className` already was.
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "prefix">;

export function Input({
  label,
  helperText,
  error,
  prefix,
  suffix,
  onStepValue,
  id,
  type,
  ref,
  value,
  min,
  max,
  step = 1,
  ...rest
}: InputProps) {
  const inputId = id ?? `input-${label.replace(/\s+/g, "-").toLowerCase()}`;
  const hasAffix = prefix !== undefined || suffix !== undefined;
  const showStepper = type === "number";

  function stepValue(direction: -1 | 1) {
    if (!onStepValue) return;
    const amount = Number(step) || 1;
    const current = Number(value ?? 0);
    const base = Number.isFinite(current) ? current : 0;
    let next = base + direction * amount;
    if (min !== undefined) next = Math.max(next, Number(min));
    if (max !== undefined) next = Math.min(next, Number(max));
    const decimals = String(amount).split(".")[1]?.length ?? 0;
    onStepValue(String(Number(next.toFixed(decimals))));
  }

  return (
    <div className="flex flex-col gap-1">
      {/* FDN-26: the label IS the flex item, not a <label> wrapping one.
       * Nesting Text a level deeper left it non-blockified — its own
       * text-label line-height (16px) was overridden by the wrapping
       * <label>'s ambient line-height (20px), which is what produced the
       * vertical shift every EditableField reflow traced back to. */}
      <Text
        as="label"
        htmlFor={inputId}
        variant="label"
        className="text-text-secondary"
      >
        {label}
      </Text>
      <div
        className={cx(
          "flex h-control items-center rounded-md border bg-bg-surface",
          "motion-fast transition-colors",
          "has-[:focus-visible]:outline has-[:focus-visible]:outline-2",
          "has-[:focus-visible]:outline-border-focus has-[:focus-visible]:outline-offset-2",
          error ? "border-danger" : "border-border-default",
        )}
      >
        {prefix !== undefined ? (
          <span className="flex shrink-0 items-center pl-3">
            <Text variant="small" className="text-text-tertiary">
              {prefix}
            </Text>
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          type={type}
          value={value}
          min={min}
          max={max}
          step={step}
          className={cx(
            "h-full min-w-0 flex-1 rounded-md bg-transparent",
            "font-ui text-body text-text-primary",
            "outline-none",
            prefix !== undefined ? "pl-1" : "pl-3",
            suffix !== undefined ? "pr-1" : "pr-3",
            // Suppressing the native spinner is scoped to affixed number
            // inputs, per VPS-D002 — an unaffixed one keeps it.
            type === "number" &&
              (hasAffix || showStepper) &&
              "no-spinner numeric-tabular",
          )}
          {...rest}
        />
        {suffix !== undefined ? (
          <span className="flex shrink-0 items-center pr-3">
            <Text variant="small" className="text-text-tertiary">
              {suffix}
            </Text>
          </span>
        ) : null}
        {showStepper ? (
          <span className="flex h-full w-button-sm shrink-0 flex-col border-l border-border-default">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Increase ${label}`}
              disabled={!onStepValue}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => stepValue(1)}
              className="flex min-h-0 flex-1 items-center justify-center text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            >
              <ChevronUp className="size-3" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Decrease ${label}`}
              disabled={!onStepValue}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => stepValue(-1)}
              className="flex min-h-0 flex-1 items-center justify-center border-t border-border-default text-text-tertiary hover:bg-bg-hover hover:text-text-primary disabled:opacity-40"
            >
              <ChevronDown className="size-3" />
            </button>
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

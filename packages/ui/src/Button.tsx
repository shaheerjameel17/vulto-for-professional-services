import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";

/*
 * VPS-D002. Four variants, three sizes.
 *
 * There is exactly one `primary` button on any screen at any time — a screen
 * with two primary buttons has not decided what it is for. That is not
 * enforceable here; it is a review question.
 *
 * Every label is an active verb naming what happens: Assign, Approve, Send
 * for signature. Never Submit, never OK.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  // FINDING F21: VPS-D002 states "Hover is `bg-hover`" for all four variants.
  // `bg-hover` is neutral-100/neutral-800, so applying it to `primary` turns
  // an indigo button gray on hover. brand-700 is used here provisionally.
  primary: "bg-brand-600 text-text-inverse hover:bg-brand-700",
  secondary:
    "bg-bg-surface border border-border-default text-text-primary hover:bg-bg-hover",
  ghost: "bg-transparent text-text-secondary hover:bg-bg-hover",
  // Fills solid only on confirmation, per VPS-D002 — the `confirming` prop.
  danger: "bg-bg-surface border border-danger text-danger hover:bg-bg-hover",
};

const SIZE: Record<Size, string> = {
  sm: "h-button-sm px-2",
  md: "h-button-md px-3",
  lg: "h-button-lg px-3",
};

export type ButtonProps = {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** VPS-D002: `danger` fills solid only at the point of confirmation. */
  confirming?: boolean;
  loading?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  confirming = false,
  loading = false,
  children,
  disabled,
  ref,
  ...rest
}: ButtonProps) {
  const solidDanger =
    variant === "danger" && confirming
      ? "bg-danger text-text-inverse border-danger"
      : undefined;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-md",
        "font-ui text-body-medium whitespace-nowrap",
        // No elevation change on hover. VPS-D001: hover is bg-hover and that
        // is the whole vocabulary.
        "motion-fast transition-colors",
        VARIANT[variant],
        SIZE[size],
        solidDanger,
      )}
      {...rest}
    >
      {loading ? (
        // Label is replaced at the same width so the button never resizes.
        <span className="inline-flex items-center gap-2 opacity-40">
          <span className="size-2 rounded-full bg-current" />
          <span className="invisible">{children}</span>
        </span>
      ) : (
        <>
          {icon ? <Icon icon={icon} /> : null}
          {children}
        </>
      )}
    </button>
  );
}

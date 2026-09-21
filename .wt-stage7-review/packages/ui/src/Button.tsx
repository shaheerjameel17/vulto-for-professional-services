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
  primary: "bg-brand-600 text-text-inverse hover:bg-brand-700",
  secondary:
    "bg-bg-surface border border-border-default text-text-primary hover:bg-bg-hover",
  ghost: "bg-transparent text-text-secondary hover:bg-bg-hover",
  // Fills solid only on confirmation, per VPS-D002 — the `confirming` prop.
  danger: "bg-bg-surface border border-danger text-danger hover:bg-bg-hover",
};

const SIZE: Record<Size, { label: string; icon: string }> = {
  sm: { label: "h-button-sm px-2", icon: "size-button-sm" },
  md: { label: "h-button-md px-3", icon: "size-button-md" },
  lg: { label: "h-button-lg px-3", icon: "size-button-lg" },
};

export type ButtonProps = {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  /** Overrides the glyph's own size independent of the button's — an
   * icon-only circular button at `md` can want a smaller mark than a
   * label-carrying one at the same height. Leave unset everywhere else. */
  iconSize?: 14 | 16 | 20 | 24;
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
  iconSize,
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
        "inline-flex items-center justify-center gap-2 rounded-full",
        "font-ui text-body-medium whitespace-nowrap",
        // No elevation change on hover; each variant owns its fill treatment.
        "motion-fast transition-colors",
        // VPS-D002: disabled changes opacity and cursor only. Keeping the
        // original variant colors intact preserves the control's hierarchy.
        "disabled:cursor-not-allowed disabled:opacity-40",
        VARIANT[variant],
        children ? SIZE[size].label : SIZE[size].icon,
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
          {icon ? <Icon icon={icon} size={iconSize} /> : null}
          {children}
        </>
      )}
    </button>
  );
}

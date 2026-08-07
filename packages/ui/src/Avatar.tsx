import { cx } from "./cx";

/*
 * VPS-D002. radius-full, sizes 20/24/32/40.
 *
 * Falls back to initials on neutral-200 / neutral-800 when no image exists,
 * never to a generic silhouette.
 */

type Size = "sm" | "md" | "lg" | "xl" | "identity";

const SIZE: Record<Size, string> = {
  sm: "size-avatar-sm",
  md: "size-avatar-md",
  lg: "size-avatar-lg",
  xl: "size-avatar-xl",
  identity: "size-12",
};

/** `micro` below 32px, `label` at and above it, so initials stay legible. */
const TYPE: Record<Size, string> = {
  sm: "text-micro",
  md: "text-micro",
  lg: "text-label",
  xl: "text-body-medium",
  identity: "text-body-medium",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export type AvatarProps = {
  name: string;
  size?: Size;
  /** Ghost rows have no person behind them, per VRS-F007. */
  dashed?: boolean;
  className?: string;
};

export function Avatar({
  name,
  size = "md",
  dashed = false,
  className,
}: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex items-center justify-center rounded-full",
        "font-ui text-text-secondary select-none",
        dashed
          ? "border border-dashed border-border-strong"
          : "bg-avatar-fallback",
        SIZE[size],
        TYPE[size],
        className,
      )}
    >
      {dashed ? null : initials(name)}
    </span>
  );
}

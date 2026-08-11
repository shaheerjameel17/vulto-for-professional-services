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

/*
 * FDN-44. Initials are set in `label`, not `micro`, at every size below 32px.
 *
 * `micro` is VPS-D001's uppercase treatment and carries +0.04em tracking for
 * that job. Initials are already uppercase by construction, and letter-spacing
 * applies to the last glyph as well as between them — so the pair rendered
 * with a trailing space inside a centered box, sitting visibly left of the
 * circle's center and running its second letter into the edge. `label` is the
 * same 11px with no tracking, which centers because there is nothing to
 * decenter it.
 *
 * The two large sizes were also under-set: `body-medium` at 13px in a 40px
 * circle is a third of the diameter where initials want closer to a half.
 */
const TYPE: Record<Size, string> = {
  sm: "text-label",
  md: "text-label",
  lg: "text-body-medium",
  xl: "text-h3",
  identity: "text-h2",
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

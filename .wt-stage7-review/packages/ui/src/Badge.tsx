import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * VPS-D002. radius-sm, `label` token, space-2 horizontal padding, 20px height.
 *
 * Two intensities: `subtle`, a tinted background at 10% of the hue with
 * passing text-primary, used for status; and `solid`, used only for counts.
 *
 * A badge is never `brand`.
 */

type Tone = "success" | "attention" | "danger" | "neutral";

/*
 * FDN-44. The tint and its ink are tokens now, stated per theme, rather than
 * one alpha percentage of the hue and a fixed `text-primary`.
 *
 * The hue at 10% over white was a wash that read as no color; `neutral`
 * resolved to `bg-active`, which in dark is the same value as `bg-raised`, so
 * a Type tag on a Card was invisible until a row hover moved the surface out
 * from under it. Coloring the ink with the tag's own hue is what makes a tag
 * read as a status rather than as a gray chip that happens to be tinted.
 */
const SUBTLE: Record<Tone, string> = {
  success: "bg-tag-success text-tag-success-ink",
  attention: "bg-tag-attention text-tag-attention-ink",
  danger: "bg-tag-danger text-tag-danger-ink",
  neutral: "bg-tag-neutral text-tag-neutral-ink",
};

const SOLID: Record<Tone, string> = {
  success: "bg-success text-text-inverse",
  attention: "bg-attention text-text-inverse",
  danger: "bg-danger text-text-inverse",
  neutral: "bg-neutral-500 text-text-inverse",
};

export type BadgeProps = {
  tone?: Tone;
  /** `solid` is used only for counts, per VPS-D002. */
  intensity?: "subtle" | "solid";
  /** Renders the dashed treatment: a placeholder for something not present. */
  dashed?: boolean;
  /** Statuses and tags use the pill treatment; compact metadata keeps radius-sm. */
  shape?: "default" | "pill" | "circle";
  children?: ReactNode;
  className?: string;
};

export function Badge({
  tone = "neutral",
  intensity = "subtle",
  dashed = false,
  shape = "default",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex h-badge items-center",
        shape === "circle" ? "w-badge justify-center rounded-full px-0" : "px-2",
        shape === "pill" ? "rounded-full" : shape === "circle" ? null : "rounded-sm",
        "font-ui text-label whitespace-nowrap",
        intensity === "subtle" ? SUBTLE[tone] : SOLID[tone],
        dashed && "border border-dashed border-current",
        className,
      )}
    >
      {children}
    </span>
  );
}

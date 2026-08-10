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

const SUBTLE: Record<Tone, string> = {
  success: "bg-success/10 text-text-primary",
  attention: "bg-attention/10 text-text-primary",
  danger: "bg-danger/10 text-text-primary",
  neutral: "bg-bg-active text-text-secondary",
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

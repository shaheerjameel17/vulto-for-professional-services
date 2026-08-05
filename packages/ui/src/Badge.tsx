import type { ReactNode } from "react";
import { cx } from "./cx";

/*
 * VPS-D002. radius-sm, `label` token, space-2 horizontal padding, 20px height.
 *
 * Two intensities: `subtle`, a tinted background at 10% of the hue with text
 * at full strength, used for status; and `solid`, used only for counts.
 *
 * A badge is never `brand`.
 */

type Tone = "success" | "attention" | "danger" | "neutral";

const SUBTLE: Record<Tone, string> = {
  // FINDING F9 (logged, not fixed): full-strength attention and danger text
  // on their own 10% tint computes to roughly 2.9:1 in light mode, against
  // VPS-D001's 4.5:1 floor for a 12px label. Rendered as specified so it is
  // visible on screen rather than corrected silently.
  success: "bg-success/10 text-success",
  attention: "bg-attention/10 text-attention",
  danger: "bg-danger/10 text-danger",
  // FINDING F22: VPS-D002 requires status badges take their color from the
  // semantic tokens exclusively, but VRS-F002 badges employment type and
  // VRS-F007 badges `Ghost` — neither is a semantic state, and no neutral
  // tone is defined. This is provisional.
  neutral: "bg-bg-subtle text-text-secondary",
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
  children?: ReactNode;
  className?: string;
};

export function Badge({
  tone = "neutral",
  intensity = "subtle",
  dashed = false,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex h-badge items-center rounded-sm px-2",
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

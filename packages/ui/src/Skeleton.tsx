import { cx } from "./cx";

/*
 * VPS-D002 and VPS-D004's Syncing state.
 *
 * Static `bg-subtle` blocks matching the shape of incoming content.
 * No shimmer, no pulse, no animation — movement on a screen that is not yet
 * readable is noise.
 *
 * Never accompanied by explanatory text, per VPS-D004: text implies a
 * condition worth understanding, and this one resolves before it is read.
 */

export type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cx("block rounded-md bg-bg-subtle", className)}
    />
  );
}

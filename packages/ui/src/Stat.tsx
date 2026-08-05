import { cx } from "./cx";
import { Text } from "./Text";

/*
 * VPS-D002. A single figure with a label. `display` or `mono-lg` for the
 * value, `micro` uppercase for the label, and an optional delta in `small`
 * with `success` or `attention`.
 *
 * Deltas always state the comparison period explicitly — "+4% vs last week",
 * never a bare arrow. The caller supplies that string; there is no arrow
 * prop, deliberately.
 *
 * `denominator` exists because VRS-F005 requires a percentage never be shown
 * without one: a percentage without a denominator is a rumor.
 */

export type StatProps = {
  label: string;
  value: string;
  /** `display` for a dashboard's single number, `mono-lg` for a figure. */
  scale?: "display" | "mono-lg";
  denominator?: string;
  delta?: { text: string; tone: "success" | "attention" };
  /** VPS-D004's suppressed-aggregate state, per VPS-A004's k-anonymity rule. */
  suppressedReason?: string;
  className?: string;
};

export function Stat({
  label,
  value,
  scale = "display",
  denominator,
  delta,
  suppressedReason,
  className,
}: StatProps) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <Text variant="micro" className="text-text-tertiary">
        {label}
      </Text>

      {suppressedReason ? (
        <div className="rounded-md border border-border-default bg-bg-subtle px-3 py-2">
          <Text variant="small" className="text-text-tertiary">
            {suppressedReason}
          </Text>
        </div>
      ) : (
        <div className="flex items-baseline gap-2">
          <Text variant={scale} className="text-text-primary">
            {value}
          </Text>
          {denominator ? (
            <Text variant="micro" className="text-text-tertiary">
              {denominator}
            </Text>
          ) : null}
        </div>
      )}

      {delta && !suppressedReason ? (
        <Text
          variant="small"
          className={delta.tone === "success" ? "text-success" : "text-attention"}
        >
          {delta.text}
        </Text>
      ) : null}
    </div>
  );
}

import { cx } from "./cx";
import { Text } from "./Text";

/*
 * VPS-D002. A single figure with a label. `display` or `numeric-lg` for the
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
  /**
   * `display` for a dashboard's single number, `numeric-lg` for a figure.
   *
   * FDN-17 adds `numeric`, for subordinate figures in a group where one figure
   * carries the hierarchy and the others support it.
   */
  scale?: "display" | "numeric-lg" | "numeric-md" | "numeric";
  /**
   * FDN-17: the label sits below the value where the value leads a group. Above
   * remains the default, which is what every other Stat in the product does.
   */
  labelPlacement?: "above" | "below";
  denominator?: string;
  delta?: { text: string; tone: "success" | "attention" };
  /** VPS-D004's suppressed-aggregate state, per VPS-A004's k-anonymity rule. */
  suppressedReason?: string;
  className?: string;
  valueClassName?: string;
  deltaClassName?: string;
};

export function Stat({
  label,
  value,
  scale = "display",
  labelPlacement = "above",
  denominator,
  delta,
  suppressedReason,
  className,
  valueClassName,
  deltaClassName,
}: StatProps) {
  /* FDN-9: load-bearing micro labels use text-secondary. */
  const labelNode = (
    <Text variant="micro" className="text-text-secondary">
      {label}
    </Text>
  );

  const valueNode = suppressedReason ? (
    <div className="rounded-md border border-border-default bg-bg-subtle px-3 py-2">
      <Text variant="small" className="text-text-secondary">
        {suppressedReason}
      </Text>
    </div>
  ) : (
    <div className="flex items-baseline gap-2">
      <Text variant={scale} className={valueClassName ?? "text-text-primary"}>
        {value}
      </Text>
      {denominator ? (
        <Text variant="micro" className="text-text-secondary">
          {denominator}
        </Text>
      ) : null}
    </div>
  );

  const deltaNode =
    delta && !suppressedReason ? (
      <Text
        variant="small"
        className={cx(
          "font-medium",
          delta.tone === "success" ? "text-success" : "text-attention",
          deltaClassName,
        )}
      >
        {delta.text}
      </Text>
    ) : null;

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      {/* The delta stays with the value rather than being flipped with the
        * label, so it reads as a qualification of the figure either way. */}
      {labelPlacement === "above" ? (
        <>
          {labelNode}
          {valueNode}
          {deltaNode}
        </>
      ) : (
        <>
          {valueNode}
          {labelNode}
          {deltaNode}
        </>
      )}
    </div>
  );
}

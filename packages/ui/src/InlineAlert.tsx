import type { ReactNode } from "react";
import { cx } from "./cx";
import { Text } from "./Text";

/*
 * VPS-D002. A bordered region inside content, not floating. Left border 2px in
 * the semantic color, `bg-subtle` fill, radius-md.
 *
 * The distinction from Toast is strict: Toast reports what happened, Inline
 * Alert reports what is true. A toast disappears; an inline alert persists
 * while the condition does.
 */

type Tone = "success" | "attention" | "danger";

const BORDER: Record<Tone, string> = {
  success: "border-l-success",
  attention: "border-l-attention",
  danger: "border-l-danger",
};

export type InlineAlertProps = {
  tone: Tone;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function InlineAlert({
  tone,
  children,
  action,
  className,
}: InlineAlertProps) {
  return (
    <div
      className={cx(
        "flex items-start justify-between gap-4 rounded-md bg-bg-subtle",
        "border-l-2 px-3 py-2",
        BORDER[tone],
        className,
      )}
    >
      <Text variant="small" className="text-text-primary">
        {children}
      </Text>
      {action}
    </div>
  );
}

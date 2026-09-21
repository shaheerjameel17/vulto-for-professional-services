import type { ReactNode } from "react";
import { cx } from "./cx";
import { Text } from "./Text";

/*
 * VPS-D002. `raised` elevation, space-4 padding, optional header with an `h3`
 * title and a right-aligned action slot.
 *
 * Cards do not nest — a card inside a card means the outer one should have
 * been a Section.
 */

export type CardProps = {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ title, action, children, className }: CardProps) {
  return (
    <div className={cx("elevation-raised rounded-md p-4", className)}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-4">
          {title ? <Text variant="h3">{title}</Text> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

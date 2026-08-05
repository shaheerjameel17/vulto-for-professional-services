import type { ReactNode } from "react";
import { cx } from "./cx";
import { Text } from "./Text";

/*
 * VPS-D002. A titled region on a page: `h2` heading, space-6 above, space-4
 * below.
 *
 * The only permitted structural divider is space; horizontal rules are not
 * used to separate sections.
 */

export type SectionProps = {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={cx("mt-6", className)}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <Text variant="h2">{title}</Text>
        {action}
      </div>
      {children}
    </section>
  );
}

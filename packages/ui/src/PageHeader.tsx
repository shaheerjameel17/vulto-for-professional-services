import type { ReactNode } from "react";
import { cx } from "./cx";
import { Text } from "./Text";

/*
 * VPS-D004 as corrected by FDN-33. 48px, containing the page title at `h2`, an optional `small`
 * subtitle carrying the most useful context for that screen, and a
 * right-aligned action slot with at most one `primary` button.
 *
 * FINDING F24: the subtitle is rendered inline with the title rather than
 * beneath it. VPS-D004 does not say which, and stacked does not fit: an `h1`
 * at 24/30 above a `small` at 13/18 is 48px of text inside a 56px band, which
 * leaves 4px above and below.
 */

export type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  titleAccessory?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  actions,
  titleAccessory,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cx(
        "flex h-page-header shrink-0 items-center justify-between gap-4",
        "border-b border-border-default px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <Text variant="h2" className="truncate text-text-primary">
          {title}
        </Text>
        {titleAccessory}
        {subtitle ? (
          <Text variant="small" className="truncate text-text-secondary">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

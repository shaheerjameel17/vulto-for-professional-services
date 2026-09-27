"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { InlineAlert } from "./InlineAlert";
import { Text } from "./Text";
import { cx } from "./cx";

export function InboxRow({
  id,
  message,
  time,
  unread,
  selected,
  icon,
  failure,
  onRead,
  onDismiss,
  onOpen,
  onFocus,
}: {
  id: string;
  message: string;
  time: string;
  unread: boolean;
  selected: boolean;
  icon: LucideIcon;
  failure?: string;
  onRead(): void;
  onDismiss(): void;
  onOpen?: () => void;
  onFocus(): void;
}) {
  return (
    <article
      data-notification-id={id}
      data-unread={unread}
      tabIndex={0}
      onFocus={onFocus}
      aria-label={message}
      className={cx(
        "rounded-md p-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
        selected && "bg-bg-selected",
      )}
    >
      <div className="flex items-start gap-3">
        <Icon icon={icon} className="text-text-secondary" />
        <div className="min-w-0 flex-1">
          <Text variant="body" className="text-text-primary">
            {message}
          </Text>
          <div className="mt-1 flex items-center gap-2">
            {unread ? (
              <Text variant="micro" className="text-text-primary">
                Unread
              </Text>
            ) : null}
            <Text variant="small" className="text-text-tertiary">
              {time}
            </Text>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {onOpen ? (
              <Button size="sm" variant="ghost" onClick={onOpen}>
                Open
              </Button>
            ) : null}
            {unread ? (
              <Button size="sm" variant="ghost" onClick={onRead}>
                Mark read
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
          {failure ? <InlineAlert tone="danger">{failure}</InlineAlert> : null}
        </div>
      </div>
    </article>
  );
}

"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-bg-scrim" />
        <RadixDialog.Content
          className={cx(
            "fixed left-1/2 top-1/2 z-50 w-palette max-w-full",
            "-translate-x-1/2 -translate-y-1/2 rounded-xl",
            "border border-border-default bg-bg-raised elevation-overlay",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border-default px-6 py-4">
            <div className="min-w-0">
              <RadixDialog.Title asChild>
                <Text variant="h2" className="text-text-primary">
                  {title}
                </Text>
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description asChild>
                  <Text variant="small" className="mt-1 text-text-secondary">
                    {description}
                  </Text>
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Close dialog"
                className="flex size-button-md shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              >
                <Icon icon={X} />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="px-6 py-4">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-border-default px-6 py-4">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

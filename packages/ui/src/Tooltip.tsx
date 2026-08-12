"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";

/*
 * VPS-D002's Tooltip. `overlay` elevation, 200ms delay, `small` text,
 * max-width 280px.
 *
 * Tooltips explain; they never contain the only copy of a piece of information,
 * and never contain an action. There is deliberately no `interactive` prop.
 *
 * FDN-19: this replaces the native `title` attribute, which rendered as the
 * operating system's own gray box and had none of VPS-D001's tokens in it. The
 * shortcut hints and the bar detail were both going through it.
 *
 * Radix supplies the delay, the collision handling and the ARIA wiring. Content
 * mounts on open, so one of these per Timeline bar costs nothing at rest.
 */

export function TooltipProvider({ children }: { children: ReactNode }) {
  // VPS-D002's 200ms delay, set once for every tooltip beneath it.
  return (
    <RadixTooltip.Provider delayDuration={200} skipDelayDuration={0}>
      {children}
    </RadixTooltip.Provider>
  );
}

export type TooltipProps = {
  /** The explanation. Never the only copy of the information. */
  content: ReactNode;
  /** VPS-D003: single-letter shortcuts are documented on hover of the control. */
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
};

export function Tooltip({ content, shortcut, side = "top", children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          avoidCollisions
          collisionPadding={12}
          sticky="always"
          hideWhenDetached
          className={cx(
            "z-50 max-w-tooltip rounded-md px-3 py-2",
            "elevation-overlay",
            "font-ui text-small text-text-primary",
            // Popovers, dropdowns and tooltips fade in at motion-fast with no
            // movement. VPS-D003.
            "motion-fast transition-opacity",
          )}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0">{content}</div>
            {shortcut ? (
              <span className="shrink-0 font-ui text-numeric text-text-tertiary">
                {shortcut}
              </span>
            ) : null}
          </div>
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

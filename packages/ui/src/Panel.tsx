"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";
import { Button } from "./Button";
import { Text } from "./Text";

/*
 * VPS-D002 and VPS-D004. The right-hand contextual surface: 360px, full
 * height, `raised`, with a 1px left border. Opens on row selection, persists
 * across selections within a screen, closes on Escape.
 *
 * Slides 16px horizontally while fading in, at `motion-base`, per VPS-D003.
 *
 * FINDING F25: VPS-D002's accessibility floor states that "modals and panels
 * trap focus and restore it to the trigger on close." A focus trap is wrong
 * here and cannot be implemented as written. VPS-D004 requires the panel be
 * dismissible "by clicking the canvas", and VRS-F005 requires `J`/`K` row
 * navigation keep working while it is open — the panel persists across
 * selections precisely so a user can move down the rows with it open. Trapping
 * focus would make the canvas unreachable by keyboard, which is the surface
 * the panel exists to annotate. Focus restoration on close is implemented;
 * the trap is not.
 */

export type PanelProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

export function Panel({
  open,
  title,
  subtitle,
  onClose,
  children,
}: PanelProps) {
  const trigger = useRef<Element | null>(null);

  useEffect(() => {
    if (open) {
      trigger.current = document.activeElement;
      return;
    }
    // Restore focus to whatever opened the panel, per VPS-D002.
    if (trigger.current instanceof HTMLElement) {
      trigger.current.focus();
      trigger.current = null;
    }
  }, [open]);

  if (!open) return null;

  return (
    <aside
      aria-label={title}
      className={cx(
        "flex w-panel shrink-0 flex-col overflow-y-auto",
        "border-l border-border-default bg-bg-surface",
        "motion-base transition-[opacity,transform]",
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border-default px-4 py-3">
        <div className="min-w-0">
          <Text variant="h3" className="truncate text-text-primary">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="small" className="truncate text-text-secondary">
              {subtitle}
            </Text>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          onClick={onClose}
          aria-label="Close panel"
          title="Close panel · Escape"
        />
      </div>
      <div className="flex-1 p-4">{children}</div>
    </aside>
  );
}

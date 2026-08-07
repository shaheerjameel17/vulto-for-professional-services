"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./cx";
import { Avatar } from "./Avatar";
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
  avatarName?: string;
  referenceLabel?: string;
  dashedAvatar?: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function Panel({
  open,
  title,
  subtitle,
  avatarName,
  referenceLabel,
  dashedAvatar,
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
        // FDN-19: an inset within the inset. `radius-lg` is the workspace's
        // `radius-xl` minus the space-1 gap around it, per VPS-D001's concentric
        // rule. It carries a border on all four sides now that it no longer
        // meets the workspace edge.
        "rounded-lg border border-border-default bg-bg-raised",
        "motion-base transition-[opacity,transform]",
      )}
    >
      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          {avatarName ? <Avatar name={avatarName} size="sm" dashed={dashedAvatar} /> : null}
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-1">
              <Text variant="h3" className="truncate text-text-primary">
                {title}
              </Text>
              {referenceLabel ? (
                <Text variant="micro" className="shrink-0 text-text-tertiary">
                  {referenceLabel}
                </Text>
              ) : null}
            </div>
            {subtitle ? (
              <Text variant="small" className="truncate text-text-secondary">
                {subtitle}
              </Text>
            ) : null}
          </div>
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

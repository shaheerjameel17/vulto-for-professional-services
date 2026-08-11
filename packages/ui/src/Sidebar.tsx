"use client";

import type { ReactNode } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { Tooltip, TooltipProvider } from "./Tooltip";

/*
 * VPS-D004. 200px, `bg-canvas`, no right border, collapsible to 48px icons
 * via Cmd+\.
 *
 * There is no top-level global header bar in this product. The workspace
 * identity and account menu live in the workspace trigger, search lives behind
 * Cmd+K, and sync is the only persistent item at the foot.
 *
 * Navigation items are `label`, 32px tall, radius-md, with a 16px Lucide
 * icon. The active item takes `bg-active` with `text-primary`. Counts appear as
 * a right-aligned `micro` figure in `text-tertiary`, and only where the count
 * implies an action the person should take.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** VPS-D003's sequential navigation, e.g. "G B". Shown on hover. */
  shortcut?: string;
  /** Only where the count implies an action, per VPS-D004. */
  count?: number;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export type SidebarProps = {
  workspaceName: string;
  /** Shown only where VRS-F003 has more than one entity. */
  entityName?: string;
  groups: NavGroup[];
  activeHref: string;
  collapsed: boolean;
  onNavigate: (href: string) => void;
  /** Account, appearance and workspace actions shown from the top trigger. */
  workspaceMenu: ReactNode;
  syncStatus: string;
};

export function Sidebar({
  workspaceName,
  entityName,
  groups,
  activeHref,
  collapsed,
  onNavigate,
  workspaceMenu,
  syncStatus,
}: SidebarProps) {
  return (
    <TooltipProvider>
    <nav
      aria-label="Main"
      className={cx(
        // FDN-16: no surface and no right border. The sidebar sits directly on
        // the window's canvas, and the inset workspace panel beside it is what
        // creates the separation a border used to.
        "flex shrink-0 flex-col",
        "motion-base transition-[width]",
        /*
         * FDN-44. The left inset is the sidebar's own, and there is no right
         * inset by design.
         *
         * Items used to sit in a px-2 container, so a fill ran from 8px to
         * 192px — 8px of clearance on the left against 20px on the right, the
         * 8px plus the 12px of canvas AppShell's `m-3` leaves before the
         * workspace panel begins. The gap on the right is already there; what
         * was missing was matching it on the left and then letting the fill
         * run to the sidebar's own edge. 12px each side, measured the same.
         */
        collapsed ? "w-sidebar-collapsed px-2" : "w-sidebar pl-3",
      )}
    >
      {/* FDN-33: one workspace menu owns account, appearance and settings. */}
      <RadixPopover.Root>
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label={`Open ${workspaceName} menu`}
            className={cx(
              // px-2 matches the navigation items below, so the workspace
              // mark and the navigation icons share one optical left edge.
              "mt-3 flex h-page-header w-full shrink-0 items-center gap-2 rounded-md px-2",
              "text-left motion-fast transition-colors hover:bg-bg-canvas-hover",
            )}
          >
            <span
              aria-hidden
              className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-brand-600 font-ui text-micro text-text-inverse"
            >
              {workspaceName.slice(0, 1)}
            </span>
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1">
                  <Text variant="body-medium" className="truncate text-text-primary">
                    {workspaceName}
                  </Text>
                  {/* FDN-44: `block`. `label` renders a span, and an inline
                    * span takes the root's 20px line box rather than the 14px
                    * the token specifies — six stray pixels between the
                    * workspace name and its jurisdiction that no token asked
                    * for. Timeline's row label already did this correctly. */}
                  {entityName ? (
                    <Text variant="label" className="block truncate text-text-secondary">
                      {entityName}
                    </Text>
                  ) : null}
                </span>
                <Icon icon={ChevronDown} className="shrink-0 text-text-tertiary" />
              </>
            )}
          </button>
        </RadixPopover.Trigger>
        <RadixPopover.Portal>
          <RadixPopover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="z-50 w-tooltip rounded-lg border border-border-default bg-bg-raised p-2 elevation-overlay"
          >
            {workspaceMenu}
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>

      <div className="scrollbar-slim flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {/* VPS-D004: group labels share the command palette's quiet micro
              * treatment and disappear with the label column when collapsed. */}
            {collapsed ? null : (
              <Text variant="micro" className="block px-2 pb-1 text-text-tertiary">
                {group.label}
              </Text>
            )}
            <ul>
              {group.items.map((item) => {
                const active =
                  item.href === activeHref ||
                  (item.href !== "/" && activeHref.startsWith(`${item.href}/`));
                return (
                  <li key={item.href}>
                    <Tooltip
                      content={item.label}
                      shortcut={item.shortcut}
                      side="right"
                    >
                    <button
                      type="button"
                      onClick={() => onNavigate(item.href)}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex h-8 w-full items-center gap-2 rounded-md px-2",
                        "font-ui text-label motion-fast transition-colors",
                        // FDN-18: a neutral fill, not brand. Which page you are
                        // on is location, not selection, and brand is reserved
                        // to the today line, primary actions and focus rings.
                        // FDN-44: `bg-canvas-hover`, not `bg-hover`. The
                        // latter is calibrated against `bg-surface`; the
                        // sidebar is on the canvas, where light `bg-hover` is
                        // one digit off the canvas itself and invisible.
                        active
                          ? "bg-bg-active text-text-primary"
                          : "text-text-secondary hover:bg-bg-canvas-hover",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <Icon
                        icon={item.icon}
                        label={collapsed ? item.label : undefined}
                      />
                      {collapsed ? null : (
                        <>
                          <span className="min-w-0 flex-1 truncate text-left">
                            {item.label}
                          </span>
                          {item.count !== undefined ? (
                            <Text
                              variant="micro"
                              className="text-text-tertiary"
                            >
                              {item.count}
                            </Text>
                          ) : null}
                        </>
                      )}
                    </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* FDN-33: sync is the only persistent footer status.
        * FDN-44 drops the rule above it. The sidebar carries no other
        * separator — its groups are divided by space and a `micro` label —
        * and one hairline for one line of status was the only structural
        * border on a surface whose whole premise is that it has none. */}
      <div className="shrink-0 py-3">
        <div className={cx("flex items-center gap-2 px-2", collapsed && "justify-center px-0")}>
          <span aria-hidden className="size-2 rounded-full bg-success" />
          {collapsed ? null : (
            <Text variant="small" className="text-text-secondary">
              {syncStatus}
            </Text>
          )}
        </div>
      </div>
    </nav>
    </TooltipProvider>
  );
}

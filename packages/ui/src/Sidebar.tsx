"use client";

import type { ReactNode } from "react";
import * as RadixPopover from "@radix-ui/react-popover";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { Tooltip, TooltipProvider } from "./Tooltip";

/*
 * VPS-D004. 240px, `bg-canvas`, 1px right border, collapsible to 48px icons
 * via Cmd+\.
 *
 * There is no top-level global header bar in this product. The workspace
 * identity lives here, search lives behind Cmd+K, and the user menu is at this
 * sidebar's foot — which returns roughly 56 vertical pixels to the Bench
 * Forecast, worth about one and a half employee rows.
 *
 * Navigation items are `body-medium`, 32px tall, radius-md, with a 16px Lucide
 * icon. The active item takes `bg-selected` with `text-brand`. Counts appear as
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
        collapsed ? "w-sidebar-collapsed" : "w-sidebar",
      )}
    >
      {/* FDN-33: one workspace menu owns account, appearance and settings. */}
      <RadixPopover.Root>
        <RadixPopover.Trigger asChild>
          <button
            type="button"
            aria-label={`Open ${workspaceName} menu`}
            className={cx(
              "flex h-page-header shrink-0 items-center gap-2 rounded-md px-3",
              "text-left motion-fast transition-colors hover:bg-bg-hover",
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
                  {entityName ? (
                    <Text variant="label" className="truncate text-text-secondary">
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

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {/* FINDING F23: VPS-D004 requires navigation be "grouped by role
              * relevance" but specifies no group-header treatment, and does
              * not say whether five items justify grouping at all. `micro`
              * uppercase `text-tertiary` follows the convention VPS-D002 uses
              * for the command palette's group headers. */}
            {collapsed ? null : (
              <Text variant="micro" className="block px-2 pb-1 text-text-tertiary">
                {group.label}
              </Text>
            )}
            <ul>
              {group.items.map((item) => {
                const active = item.href === activeHref;
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
                        "font-ui text-body-medium motion-fast transition-colors",
                        // FDN-18: a neutral fill, not brand. Which page you are
                        // on is location, not selection, and brand is reserved
                        // to the today line, primary actions and focus rings.
                        active
                          ? "bg-bg-active text-text-primary"
                          : "text-text-secondary hover:bg-bg-hover",
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

      {/* FDN-33: sync is the only persistent footer status. */}
      <div className="shrink-0 border-t border-border-default p-2">
        <div className={cx("flex items-center gap-2 px-1", collapsed && "justify-center px-0")}>
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

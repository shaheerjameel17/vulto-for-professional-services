"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

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
  /** Density and theme controls, whose state lives in the app. */
  appearanceControls: ReactNode;
  syncStatus: string;
  userName: string;
};

export function Sidebar({
  workspaceName,
  entityName,
  groups,
  activeHref,
  collapsed,
  onNavigate,
  appearanceControls,
  syncStatus,
  userName,
}: SidebarProps) {
  return (
    <nav
      aria-label="Main"
      className={cx(
        "flex shrink-0 flex-col border-r border-border-default bg-bg-canvas",
        "motion-base transition-[width]",
        collapsed ? "w-sidebar-collapsed" : "w-sidebar",
      )}
    >
      {/* Workspace switcher */}
      <button
        type="button"
        className={cx(
          "flex h-page-header shrink-0 items-center gap-2 px-3",
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
          <span className="min-w-0 flex-1">
            <Text variant="body-medium" className="truncate text-text-primary">
              {workspaceName}
            </Text>
            {entityName ? (
              <Text variant="small" className="truncate text-text-secondary">
                {entityName}
              </Text>
            ) : null}
          </span>
        )}
      </button>

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
                    <button
                      type="button"
                      onClick={() => onNavigate(item.href)}
                      aria-current={active ? "page" : undefined}
                      title={
                        item.shortcut
                          ? `${item.label} · ${item.shortcut}`
                          : item.label
                      }
                      className={cx(
                        "flex h-8 w-full items-center gap-2 rounded-md px-2",
                        "font-ui text-body-medium motion-fast transition-colors",
                        active
                          ? "bg-bg-selected text-text-brand"
                          : "text-text-primary hover:bg-bg-hover",
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
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Foot: sync status, density and theme controls, user menu. VPS-D004. */}
      <div className="shrink-0 border-t border-border-default p-2">
        {collapsed ? null : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 px-1">
              <span
                aria-hidden
                className="size-2 rounded-full bg-success"
              />
              <Text variant="small" className="text-text-secondary">
                {syncStatus}
              </Text>
            </div>
            {appearanceControls}
          </div>
        )}
        <button
          type="button"
          className={cx(
            "mt-2 flex h-8 w-full items-center gap-2 rounded-md px-2",
            "motion-fast transition-colors hover:bg-bg-hover",
            collapsed && "justify-center px-0",
          )}
        >
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-avatar-fallback font-ui text-micro text-text-secondary"
          >
            {userName.slice(0, 1)}
          </span>
          {collapsed ? null : (
            <Text variant="body" className="truncate text-text-primary">
              {userName}
            </Text>
          )}
        </button>
      </div>
    </nav>
  );
}

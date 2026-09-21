"use client";

import { Building2, LogOut, Settings } from "lucide-react";
import { Avatar, Icon, Text, ToggleGroup } from "@vulto/ui";
import type { ThemePreference } from "@vulto/tokens";
import { useAppearance } from "../app/appearance";

/*
 * Account and workspace actions composed into Sidebar's workspace popover.
 * Theme remains a device-local preference in the prototype. Density and the
 * palette candidate switcher are deliberately absent: FDN-33 settles one
 * information-preserving density and neutral assignment bars.
 */

export function WorkspaceMenuContent({
  canManageWorkspace,
}: {
  canManageWorkspace: boolean;
}) {
  const { theme, setTheme } = useAppearance();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-2 py-1">
        <Avatar name="Shaheer Jameel" size="md" />
        <div className="min-w-0 flex-1">
          <Text variant="body-medium" className="truncate text-text-primary">
            Shaheer Jameel
          </Text>
          <Text variant="label" className="truncate text-text-secondary">
            Owner · Northgate Studio
          </Text>
        </div>
      </div>

      <div className="border-t border-border-default pt-2">
        <Text variant="micro" className="mb-1 block px-2 text-text-tertiary">
          Theme
        </Text>
        <ToggleGroup<ThemePreference>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "Auto" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-1 border-t border-border-default pt-2">
        {canManageWorkspace ? (
          <button
            type="button"
            className="flex h-control w-full items-center gap-2 rounded-md px-2 text-left font-ui text-body text-text-primary hover:bg-bg-hover"
          >
            <Icon icon={Settings} className="text-text-secondary" />
            Settings
          </button>
        ) : null}
        <button
          type="button"
          className="flex h-control w-full items-center gap-2 rounded-md px-2 text-left font-ui text-body text-text-primary hover:bg-bg-hover"
        >
          <Icon icon={Building2} className="text-text-secondary" />
          Switch workspace
        </button>
        <button
          type="button"
          className="flex h-control w-full items-center gap-2 rounded-md px-2 text-left font-ui text-body text-text-primary hover:bg-bg-hover"
        >
          <Icon icon={LogOut} className="text-text-secondary" />
          Log out
        </button>
      </div>
    </div>
  );
}

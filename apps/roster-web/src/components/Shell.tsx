"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell, Sidebar, useShortcuts } from "@vulto/ui";
import { GOTO, NAV_GROUPS } from "../nav";
import { AppearanceControls } from "./AppearanceControls";
import { PanelContext } from "./panel-context";

/*
 * The application shell per VPS-D004, wrapped around every screen.
 *
 * Panel state is held here rather than in a page, because VPS-D004 requires it
 * be remembered per screen for the session: a user who works with the panel
 * open is not made to reopen it each time they navigate.
 */

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<ReactNode>(null);

  useShortcuts({
    chords: {
      // VPS-D003: Cmd+\ toggles the sidebar.
      "\\": () => setCollapsed((value) => !value),
    },
    goto: Object.fromEntries(
      Object.entries(GOTO).map(([key, href]) => [key, () => router.push(href)]),
    ),
    // Escape dismisses the topmost layer: panel, then modal, then palette.
    onEscape: () => setPanel(null),
  });

  return (
    <PanelContext.Provider value={{ panel, setPanel }}>
      <AppShell
        panel={panel}
        sidebar={
          <Sidebar
            workspaceName="Northgate Studio"
            entityName="Northgate Ltd · UK"
            groups={NAV_GROUPS}
            activeHref={pathname}
            collapsed={collapsed}
            onNavigate={(href) => router.push(href)}
            appearanceControls={<AppearanceControls />}
            syncStatus="Synced"
            userName="Shaheer Jameel"
          />
        }
      >
        {children}
      </AppShell>
    </PanelContext.Provider>
  );
}

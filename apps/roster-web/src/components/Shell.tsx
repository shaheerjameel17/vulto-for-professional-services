"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  CommandPalette,
  Panel,
  Sidebar,
  Text,
  useShortcuts,
  type CommandPaletteResult,
} from "@vulto/ui";
import { GOTO, NAV_GROUPS } from "../nav";
import { searchCommandPalette } from "../fixtures/command-palette";
import { WorkspaceMenuContent } from "./WorkspaceMenuContent";
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const paletteResults = useMemo(
    () => searchCommandPalette(paletteQuery),
    [paletteQuery],
  );

  useShortcuts({
    chords: {
      // VPS-F002 owns the one global search surface in the suite.
      k: () => setPaletteOpen(true),
      // VPS-D003: Cmd+\ toggles the sidebar.
      "\\": () => setCollapsed((value) => !value),
    },
    goto: Object.fromEntries(
      Object.entries(GOTO).map(([key, href]) => [key, () => router.push(href)]),
    ),
    // Escape dismisses the topmost layer: panel, then modal, then palette.
    onEscape: () => setPanel(null),
    // Radix owns keyboard behavior while the palette is topmost, including
    // Escape. This prevents one keypress from also closing a panel beneath it.
    enabled: !paletteOpen,
  });

  function setCommandPaletteOpen(open: boolean) {
    setPaletteOpen(open);
    if (!open) setPaletteQuery("");
  }

  function openPaletteResult(
    result: CommandPaletteResult,
    destination: "page" | "panel",
  ) {
    setCommandPaletteOpen(false);

    if (destination === "page" && result.href) {
      setPanel(null);
      router.push(result.href);
      return;
    }

    setPanel(
      <Panel
        open
        title={result.name}
        subtitle={result.type}
        onClose={() => setPanel(null)}
      >
        <Text variant="body" className="text-text-secondary">
          {result.context}
        </Text>
      </Panel>,
    );
  }

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
            workspaceMenu={<WorkspaceMenuContent canManageWorkspace />}
            syncStatus="Synced"
          />
        }
      >
        {children}
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setCommandPaletteOpen}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        results={paletteResults}
        onSelect={openPaletteResult}
      />
    </PanelContext.Provider>
  );
}

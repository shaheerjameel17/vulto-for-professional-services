"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  notificationUnreadActionCountQuery,
  searchDeviceQuery,
  SEARCH_COMMANDS,
} from "@vulto/graph";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  CommandPalette,
  Panel,
  ReconnectState,
  Sidebar,
  Text,
  useShortcuts,
  type CommandPaletteResult,
} from "@vulto/ui";
import { GOTO, NAV_GROUPS } from "../nav";
import { fetchSkillMatches } from "../lib/skill-matches";
import { WorkspaceMenuContent } from "./WorkspaceMenuContent";
import { PanelContext } from "./panel-context";
import { useShellBootstrap } from "./shell-bootstrap";

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
  const { client, workspaceName, state, retry, reportUnauthorized } =
    useShellBootstrap();
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<ReactNode>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [localResults, setLocalResults] = useState<CommandPaletteResult[]>([]);
  const [skillResults, setSkillResults] = useState<CommandPaletteResult[]>([]);
  const [skillMatched, setSkillMatched] = useState(false);
  const [skillConnectionRequired, setSkillConnectionRequired] = useState(false);
  const [skillAttempt, setSkillAttempt] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const paletteResults = useMemo(
    () => [...localResults, ...skillResults],
    [localResults, skillResults],
  );
  const navigation = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.href === "/inbox" ? { ...item, count: unreadCount || undefined } : item,
        ),
      })),
    [unreadCount],
  );

  useEffect(
    () =>
      client.subscribe(notificationUnreadActionCountQuery(), ({ result }) => {
        if (
          result.kind === "device-query" &&
          result.name === "notification.unreadActionCount"
        )
          setUnreadCount(result.data);
      }),
    [client],
  );

  useEffect(() => {
    setSkillResults([]);
    setSkillConnectionRequired(false);
    setSkillMatched(false);
    if (!paletteOpen) {
      setLocalResults([]);
      return;
    }
    const routes: Record<string, string> = {
      "bench-forecast": "/",
      people: "/people",
      timesheets: "/timesheets",
      home: "/home",
    };
    return client.subscribe(searchDeviceQuery(paletteQuery), ({ result }) => {
      if (result.kind !== "device-query" || result.name !== "search.query") return;
      const results: CommandPaletteResult[] = [];
      for (const match of result.data.commandMatches) {
        const command = SEARCH_COMMANDS.find(
          (entry) => entry.commandId === match.commandId,
        );
        if (command?.target.kind !== "navigate") continue;
        const href = routes[command.target.destination];
        if (href)
          results.push({
            id: match.commandId,
            group: "Commands",
            name: match.label,
            type: "Command",
            context: match.shortcut ?? "Navigate",
            href,
          });
      }
      for (const match of result.data.entityMatches) {
        const group =
          match.nodeType === "Employee"
            ? "People"
            : match.nodeType === "Skill"
              ? "Skills"
              : match.nodeType === "Project"
                ? "Projects"
                : "Clients";
        results.push({
          id: match.nodeId,
          group,
          name: match.label,
          type: match.nodeType,
          dashed: match.isGhost,
          context:
            match.nodeType === "Employee"
              ? `${match.availabilityStatus}${match.nextRolloffDate ? ` · Next rolloff ${match.nextRolloffDate}` : ""}`
              : (match.secondaryLabel ?? match.lifecycleStatus),
          ...(match.nodeType === "Employee" ? { href: `/people/${match.nodeId}` } : {}),
        });
      }
      setLocalResults(results);
      setSkillMatched(result.data.skillMatched);
    });
  }, [client, paletteOpen, paletteQuery]);

  useEffect(() => {
    if (!paletteOpen || !skillMatched) return;
    const abort = new AbortController();
    setSkillConnectionRequired(false);
    void fetchSkillMatches(paletteQuery, abort.signal)
      .then(async (answer) => {
        const results: CommandPaletteResult[] = [];
        for (const skill of answer.results) {
          for (const match of skill.matches) {
            const outcome = await client.query({
              kind: "node-get",
              nodeId: match.employeeId,
              nodeType: "Employee",
              includeSoftDeleted: false,
            });
            const record =
              outcome.result.kind === "node-get"
                ? outcome.result.node?.record
                : undefined;
            results.push({
              id: `${skill.skillId}-${match.employeeId}`,
              group: "Skill matches",
              name: String(
                record?.["full_name"] ?? record?.["job_title"] ?? "Employee",
              ),
              type: "Employee",
              dashed: match.isGhost,
              context: `${String(skill.skillName)} · ${match.proficiencyLevel} · ${match.availabilityDate ? `Available ${match.availabilityDate}` : "Available now"}`,
              href: `/people/${match.employeeId}`,
            });
          }
        }
        if (!abort.signal.aborted) setSkillResults(results);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        if (
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 401
        )
          reportUnauthorized();
        else setSkillConnectionRequired(true);
      });
    return () => abort.abort();
  }, [
    client,
    paletteOpen,
    paletteQuery,
    skillMatched,
    skillAttempt,
    reportUnauthorized,
  ]);

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
    ...(panel ? { onEscape: () => setPanel(null) } : {}),
    // Radix owns keyboard behavior while the palette is topmost, including
    // Escape. This prevents one keypress from also closing a panel beneath it.
    enabled: !paletteOpen && !state.refusal,
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

  if (state.refusal)
    return (
      <>
        <div data-testid="shell-refusal" data-refusal={state.refusal} hidden />
        <ReconnectState onRetry={retry} />
      </>
    );

  return (
    <PanelContext.Provider value={{ panel, setPanel, paletteOpen }}>
      <div data-testid="shell-refusal" data-refusal={state.refusal ?? ""} hidden />
      <AppShell
        panel={panel}
        sidebar={
          <Sidebar
            workspaceName={workspaceName}
            groups={navigation}
            activeHref={pathname}
            collapsed={collapsed}
            onNavigate={(href) => router.push(href)}
            workspaceMenu={<WorkspaceMenuContent canManageWorkspace />}
            syncStatus={state.status}
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
        skillConnectionRequired={skillConnectionRequired}
        onRetrySkills={() => setSkillAttempt((value) => value + 1)}
      />
    </PanelContext.Provider>
  );
}

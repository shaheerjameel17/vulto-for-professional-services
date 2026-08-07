"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Badge } from "./Badge";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

export const COMMAND_PALETTE_GROUPS = [
  "Commands",
  "People",
  "Skill matches",
  "Projects",
  "Clients",
  "Documents",
  "Policies",
] as const;

export type CommandPaletteGroup = (typeof COMMAND_PALETTE_GROUPS)[number];

export type CommandPaletteResult = {
  id: string;
  group: CommandPaletteGroup;
  name: string;
  type: string;
  context: string;
  dashed?: boolean;
  href?: string;
};

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  results: CommandPaletteResult[];
  onSelect: (result: CommandPaletteResult, destination: "page" | "panel") => void;
};

/*
 * VPS-D002 / VPS-F002. Appearance and keyboard behavior live here; the app
 * supplies mock index results and decides what opening a result means.
 */
export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  results,
  onSelect,
}: CommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(
    () =>
      COMMAND_PALETTE_GROUPS.map((name) => ({
        name,
        results: results.filter((result) => result.group === name),
      })).filter((group) => group.results.length > 0),
    [results],
  );

  useEffect(() => setSelectedIndex(0), [query]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function moveSelection(delta: number) {
    if (results.length === 0) return;
    setSelectedIndex((current) => (current + delta + results.length) % results.length);
  }

  function choose(destination: "page" | "panel") {
    const selected = results[selectedIndex];
    if (selected) onSelect(selected, destination);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(event.metaKey || event.ctrlKey ? "panel" : "page");
    }
  }

  let flatIndex = -1;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-bg-scrim" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cx(
            "pointer-events-none fixed inset-0 z-50 flex outline-none",
            "md:inset-x-0 md:bottom-auto md:top-palette-offset md:justify-center md:px-4",
          )}
        >
          <RadixDialog.Title className="sr-only">Search and commands</RadixDialog.Title>
          <div
            data-command-palette-surface
            className={cx(
              "command-palette-enter pointer-events-auto flex h-full w-full flex-col overflow-hidden bg-bg-raised",
              "md:h-auto md:w-palette md:rounded-xl md:elevation-overlay",
            )}
          >
            <div className="flex h-page-header shrink-0 items-center gap-3 border-b border-border-default px-4">
              <Icon icon={Search} className="text-text-tertiary" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search people, skills, projects, or commands"
                aria-label="Search"
                aria-controls="command-palette-results"
                aria-activedescendant={
                  results[selectedIndex] ? `command-result-${results[selectedIndex]!.id}` : undefined
                }
                className="h-full min-w-0 flex-1 bg-transparent font-ui text-body text-text-primary outline-none placeholder:text-text-tertiary"
              />
              <kbd className="rounded-sm border border-border-default bg-bg-subtle px-2 py-1 font-ui text-micro text-text-secondary">
                ESC
              </kbd>
            </div>

            <div
              id="command-palette-results"
              role="listbox"
              aria-label="Search results"
              className="min-h-0 flex-1 overflow-y-auto py-2 md:max-h-palette-results"
            >
              {query.trim() === "" ? (
                <Text variant="body" className="px-4 py-8 text-center text-text-secondary">
                  Start typing to search the local workspace.
                </Text>
              ) : results.length === 0 ? (
                <Text variant="body" className="px-4 py-8 text-center text-text-secondary">
                  No matches for “{query.trim()}”.
                </Text>
              ) : (
                groups.map((group) => (
                  <section key={group.name} aria-labelledby={`command-group-${group.name}`}>
                    <Text
                      id={`command-group-${group.name}`}
                      variant="micro"
                      className="block px-4 pb-1 pt-3 text-text-tertiary first:pt-1"
                    >
                      {group.name}
                    </Text>
                    {group.results.map((result) => {
                      flatIndex += 1;
                      const currentIndex = flatIndex;
                      const selected = currentIndex === selectedIndex;
                      return (
                        <button
                          key={result.id}
                          ref={selected ? selectedRef : undefined}
                          id={`command-result-${result.id}`}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseMove={() => setSelectedIndex(currentIndex)}
                          onClick={() => onSelect(result, "page")}
                          className={cx(
                            "flex w-full items-center gap-3 px-4 py-2 text-left",
                            "motion-fast transition-colors",
                            selected ? "bg-bg-selected" : "hover:bg-bg-hover",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <Text variant="body-medium" className="truncate text-text-primary">
                                {result.name}
                              </Text>
                              <Badge dashed={result.dashed}>{result.type}</Badge>
                            </div>
                            <Text variant="small" className="mt-1 line-clamp-2 text-text-secondary md:truncate">
                              {result.context}
                            </Text>
                          </div>
                          {selected ? (
                            <Icon icon={CornerDownLeft} className="text-text-tertiary" />
                          ) : null}
                        </button>
                      );
                    })}
                  </section>
                ))
              )}
            </div>

            <div className="hidden shrink-0 items-center justify-between border-t border-border-default px-4 py-2 md:flex">
              <div className="flex items-center gap-2 text-text-tertiary">
                <Icon icon={ArrowUp} />
                <Icon icon={ArrowDown} />
                <Text variant="small">Navigate</Text>
              </div>
              <Text variant="small" className="text-text-tertiary">
                Enter to open · Cmd+Enter for panel
              </Text>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

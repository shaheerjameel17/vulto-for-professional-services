export type SearchCommandTarget =
  | { readonly kind: "navigate"; readonly destination: string }
  | { readonly kind: "action"; readonly actionId: string };

export interface SearchCommand {
  readonly commandId: string;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly shortcut?: string;
  readonly target: SearchCommandTarget;
}

/** Static discovery only. The shell resolves targets; the server authorizes execution. */
export const SEARCH_COMMANDS = [
  {
    commandId: "go-bench-forecast",
    label: "Go to Bench Forecast",
    keywords: ["bench", "forecast", "capacity"],
    target: { kind: "navigate", destination: "bench-forecast" },
  },
  {
    commandId: "go-people",
    label: "Go to People",
    keywords: ["employees", "team"],
    target: { kind: "navigate", destination: "people" },
  },
  {
    commandId: "go-timesheets",
    label: "Go to Timesheets",
    keywords: ["time", "hours"],
    target: { kind: "navigate", destination: "timesheets" },
  },
  {
    commandId: "go-home",
    label: "Go to Home",
    keywords: ["dashboard"],
    target: { kind: "navigate", destination: "home" },
  },
  {
    commandId: "create-employee",
    label: "Create employee",
    keywords: ["create emp", "new employee", "add person"],
    target: { kind: "action", actionId: "employee.create" },
  },
  {
    commandId: "add-assignment",
    label: "Add assignment",
    keywords: ["assign", "staff project"],
    target: { kind: "action", actionId: "assignment.create" },
  },
] as const satisfies readonly SearchCommand[];

export function matchSearchCommands(text: string): readonly {
  readonly commandId: string;
  readonly label: string;
  readonly shortcut?: string;
}[] {
  const needle = text.toLowerCase();
  return SEARCH_COMMANDS.filter(
    (command) =>
      command.label.toLowerCase().includes(needle) ||
      command.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
  )
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((command) => {
      const shortcut = (command as SearchCommand).shortcut;
      return {
        commandId: command.commandId,
        label: command.label,
        ...(shortcut === undefined ? {} : { shortcut }),
      };
    });
}

import {
  CalendarClock,
  Clock,
  Inbox,
  LayoutDashboard,
  Users,
} from "lucide-react";
import type { NavGroup } from "@vulto/ui";

/*
 * Five destinations, two groups.
 *
 * VPS-D004 requires navigation be "grouped by role relevance rather than by
 * feature taxonomy" but names no groups and no items — see Findings F1. This
 * set is the founder's decision, and whether five items justify grouping at
 * all is itself recorded as F23.
 *
 * The shortcuts are VPS-D003's sequential `G` navigation, plus `G D` from
 * VRS-F049 — which VPS-D003's own global table omits (F13).
 */

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      {
        href: "/",
        label: "Bench Forecast",
        icon: CalendarClock,
        shortcut: "G B",
      },
      { href: "/people", label: "People", icon: Users, shortcut: "G P" },
      {
        href: "/timesheets",
        label: "Timesheets",
        icon: Clock,
        shortcut: "G T",
      },
    ],
  },
  {
    label: "Waiting",
    items: [
      // Counts appear only where the count implies an action, per VPS-D004.
      { href: "/inbox", label: "Inbox", icon: Inbox, shortcut: "G I", count: 3 },
      {
        href: "/dashboard",
        label: "Manager Dashboard",
        icon: LayoutDashboard,
        shortcut: "G D",
        count: 7,
      },
    ],
  },
];

/** `G` sequences, keyed by their second letter. */
export const GOTO: Record<string, string> = {
  b: "/",
  p: "/people",
  t: "/timesheets",
  i: "/inbox",
  d: "/dashboard",
};

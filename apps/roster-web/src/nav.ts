import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  Clock,
  GraduationCap,
  HandCoins,
  House,
  Inbox,
  Landmark,
  PlaneTakeoff,
  UserRoundCog,
  Users,
} from "lucide-react";
import type { NavGroup } from "@vulto/ui";

/*
 * FDN-39: the complete Owner navigation, grouped by user intent rather than
 * by the sixty-seven-feature register. Role-filtered product builds take a
 * subset of this fixed order; the static prototype deliberately renders the
 * Owner view so the complete information architecture can be reviewed.
 *
 * Features scoped to a record remain sub-screens; event-driven work belongs
 * in Inbox; workspace behavior belongs in Settings; rare lookup belongs in
 * Cmd+K. The sidebar is therefore a map of durable work areas, not features.
 */

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      // FDN-41: `/home`. The sidebar item, the route and the page title are one
      // name now — it was Home here, `/dashboard` in the URL and "Manager
      // Dashboard" on the page, which named a role most viewers do not hold.
      { href: "/home", label: "Home", icon: House, shortcut: "G H" },
      { href: "/inbox", label: "Inbox", icon: Inbox, shortcut: "G I", count: 7 },
    ],
  },
  {
    label: "Planning",
    items: [
      {
        href: "/",
        label: "Bench Forecast",
        icon: CalendarClock,
        shortcut: "G B",
      },
      { href: "/hiring", label: "Hiring", icon: BriefcaseBusiness, shortcut: "G R" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/people", label: "People", icon: Users, shortcut: "G P" },
      {
        href: "/development",
        label: "Development",
        icon: GraduationCap,
        shortcut: "G D",
      },
      { href: "/people-ops", label: "People Ops", icon: UserRoundCog, shortcut: "G O" },
    ],
  },
  {
    label: "Work",
    items: [
      {
        href: "/timesheets",
        label: "Timesheets",
        icon: Clock,
        shortcut: "G T",
      },
      { href: "/leave", label: "Leave", icon: PlaneTakeoff, shortcut: "G L" },
      { href: "/expenses", label: "Expenses", icon: HandCoins, shortcut: "G E" },
    ],
  },
  {
    label: "Finance & insight",
    items: [
      { href: "/payroll", label: "Payroll", icon: Landmark, shortcut: "G Y" },
      { href: "/reports", label: "Reports", icon: BarChart3, shortcut: "G A" },
    ],
  },
];

/** `G` sequences, keyed by their second letter. */
export const GOTO: Record<string, string> = {
  h: "/home",
  i: "/inbox",
  b: "/",
  r: "/hiring",
  p: "/people",
  d: "/development",
  o: "/people-ops",
  t: "/timesheets",
  l: "/leave",
  e: "/expenses",
  y: "/payroll",
  a: "/reports",
};

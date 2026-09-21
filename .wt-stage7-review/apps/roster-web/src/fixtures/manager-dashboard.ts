export type ManagerQueueKind = "Approval" | "Alert" | "Request";

export type ManagerQueueItem = {
  id: string;
  kind: ManagerQueueKind;
  source: string;
  title: string;
  context: string;
  subject: string;
  waitingDays: number;
  waitingSince: string;
  actionLabel: string;
  escalated?: boolean;
  informational?: boolean;
};

/*
 * Static facts composed from notional source features. The array is already
 * oldest-first: the dashboard never computes a cross-type priority score.
 */
export const MANAGER_QUEUE: ManagerQueueItem[] = [
  {
    id: "burnout-daniel",
    kind: "Alert",
    source: "Workload strain",
    title: "Sustained workload strain",
    context: "Daniel has remained above the strain threshold for three weeks.",
    subject: "Daniel Okonkwo",
    waitingDays: 19,
    waitingSince: "since Jul 19",
    actionLabel: "Review",
    escalated: true,
    informational: true,
  },
  {
    id: "assessment-priya",
    kind: "Request",
    source: "Performance",
    title: "Quarterly assessment owed",
    context: "Priya's Q3 manager assessment is ready for your input.",
    subject: "Priya Sharma",
    waitingDays: 12,
    waitingSince: "since Jul 26",
    actionLabel: "Open",
  },
  {
    id: "leave-ayesha",
    kind: "Approval",
    source: "Leave",
    title: "Annual leave request",
    context: "Five working days, Sep 14–18. Team coverage is available.",
    subject: "Ayesha Malik",
    waitingDays: 8,
    waitingSince: "since Jul 30",
    actionLabel: "Approve",
  },
  {
    id: "onboarding-zara",
    kind: "Approval",
    source: "Onboarding",
    title: "Confirm 90-day check-in",
    context: "Manager check-in completed; confirmation is waiting on you.",
    subject: "Zara Hussain",
    waitingDays: 6,
    waitingSince: "since Aug 1",
    actionLabel: "Complete",
  },
  {
    id: "timesheet-omar",
    kind: "Alert",
    source: "Timesheets",
    title: "Unusual weekly total",
    context: "52 hours submitted against a 48-hour working pattern.",
    subject: "Omar Farooq",
    waitingDays: 4,
    waitingSince: "since Aug 3",
    actionLabel: "Clear",
    informational: true,
  },
  {
    id: "capacity-grace",
    kind: "Request",
    source: "Capacity",
    title: "Allocation conflict",
    context: "Grace reaches 120% planned capacity from Aug 24.",
    subject: "Grace Adeyemi",
    waitingDays: 2,
    waitingSince: "since Aug 5",
    actionLabel: "Resolve",
  },
  {
    id: "interview-feedback",
    kind: "Request",
    source: "Recruiting",
    title: "Interview feedback owed",
    context: "Senior Backend Engineer panel scorecard is incomplete.",
    subject: "Candidate 041",
    waitingDays: 1,
    waitingSince: "since yesterday",
    actionLabel: "Open",
  },
];

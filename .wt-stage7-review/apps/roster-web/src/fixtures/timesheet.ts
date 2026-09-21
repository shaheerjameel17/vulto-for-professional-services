/*
 * FDN-4 / VRS-F010 prototype fixture.
 *
 * The page receives already-resolved working-day columns from the calendar
 * index. Rows are shaped like Assignment/Pitch/category facts but remain
 * static: this is an interaction prototype, not a local graph simulation.
 */

export type TimesheetRow = {
  id: string;
  label: string;
  detail: string;
  kind: "billable" | "pitch" | "non-billable";
};

export const TIMESHEET_EMPLOYEE = {
  name: "Omar Farooq",
  entityId: "pk" as const,
  billableTarget: 44,
};

export const TIMESHEET_ROWS: TimesheetRow[] = [
  {
    id: "acme-rebrand",
    label: "Acme Rebrand",
    detail: "Acme Industrial",
    kind: "billable",
  },
  {
    id: "halo-phase-2",
    label: "Halo Phase 2",
    detail: "Halo Health",
    kind: "billable",
  },
  {
    id: "tandem-pitch",
    label: "Tandem pitch",
    detail: "Tandem Group",
    kind: "pitch",
  },
  {
    id: "non-billable",
    label: "Non-billable",
    detail: "Internal · Learning · Leave",
    kind: "non-billable",
  },
];

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Content,
  PageHeader,
  Table,
  Text,
  ToggleGroup,
  type TableColumn,
} from "@vulto/ui";
import { EMPLOYEES, type Employee } from "../../../fixtures/roster";
import { profileFor } from "../../../fixtures/profiles";
import { ENTITY_NAMES, type EntityId } from "../../../fixtures/calendar";

/*
 * FDN-25 — VRS-F002's People directory, per VPS-D002's Table.
 *
 * The previous version of this screen was a stacked list of names and
 * roles: no columns, no filters, no sorting — a picker, not the surface an
 * HR Admin actually lives on. This is the second-densest surface in the
 * product after the Bench Forecast and the first real test of whether
 * VPS-D002's Table specification survives a hundred rows, even though this
 * fixture only supplies fifteen.
 *
 * FINDING F9 AT TABLE SCALE, deliberately not patched here: VPS-D002
 * requires column headers at `micro` in `text-tertiary`, which computes to
 * roughly 2.6:1 — already logged against the Stat deviation in FDN-17, and
 * a table is nothing but column headers doing load-bearing work, which
 * pushes harder on the same floor. Recorded in Prototype_Findings.md rather
 * than patched locally; FDN-9 resolves it as a rule change, not a
 * per-component workaround.
 *
 * Row selection into a Panel summary and checkbox-based selection are
 * VPS-D002's Table behavior too, but nothing on this screen needs either
 * yet — clicking a row goes straight to the profile, which is the fastest
 * path to any person this screen exists to provide.
 */

type DirectoryRow = {
  employee: Employee;
  department: string;
  employmentType: string;
  managerName?: string;
  contractedHours?: number;
};

const ENTITY_FILTERS: { value: "all" | EntityId; label: string }[] = [
  { value: "all", label: "All entities" },
  { value: "uk", label: "UK" },
  { value: "pk", label: "PK" },
];

const TYPE_FILTERS: { value: "all" | string; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "FullTime", label: "Full time" },
  { value: "PartTime", label: "Part time" },
  { value: "Contractor", label: "Contractor" },
  { value: "Intern", label: "Intern" },
];

export default function PeoplePage() {
  const router = useRouter();
  const [entityFilter, setEntityFilter] = useState<"all" | EntityId>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | string>("all");

  const rows: DirectoryRow[] = useMemo(
    () =>
      EMPLOYEES.filter((e) => e.employeeType === "Employee").map((employee) => {
        const detail = profileFor(employee.employeeId);
        return {
          employee,
          department: detail?.department ?? "—",
          employmentType: detail?.employmentType ?? "—",
          managerName: detail?.managerName,
          contractedHours: detail?.contractedHours,
        };
      }),
    [],
  );

  const filteredRows = rows.filter((row) => {
    if (entityFilter !== "all" && row.employee.entityId !== entityFilter) return false;
    if (typeFilter !== "all" && row.employmentType !== typeFilter) return false;
    return true;
  });

  const columns: TableColumn<DirectoryRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.employee.fullName,
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.employee.fullName} size="sm" />
          <Text variant="body-medium" className="text-text-primary">
            {row.employee.fullName}
          </Text>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortable: true,
      sortValue: (row) => row.employee.jobTitle,
      render: (row) => (
        <Text variant="body" className="text-text-primary">
          {row.employee.jobTitle}
        </Text>
      ),
    },
    {
      key: "department",
      header: "Department",
      sortable: true,
      sortValue: (row) => row.department,
      render: (row) => (
        <Text variant="body" className="text-text-secondary">
          {row.department}
        </Text>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      sortable: true,
      sortValue: (row) => ENTITY_NAMES[row.employee.entityId],
      render: (row) => (
        <Text variant="body" className="text-text-secondary">
          {ENTITY_NAMES[row.employee.entityId]}
        </Text>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortable: true,
      sortValue: (row) => row.employmentType,
      render: (row) => <Badge tone="neutral">{row.employmentType}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: () => <Badge tone="success">Active</Badge>,
    },
    {
      key: "manager",
      header: "Reports to",
      sortable: true,
      sortValue: (row) => row.managerName ?? "",
      render: (row) => (
        <Text variant="body" className="text-text-secondary">
          {row.managerName ?? "—"}
        </Text>
      ),
    },
    {
      key: "hours",
      header: "Hours/wk",
      align: "right",
      sortable: true,
      sortValue: (row) => row.contractedHours ?? 0,
      render: (row) => (
        <Text variant="mono" className="text-text-primary">
          {row.contractedHours ?? "—"}
        </Text>
      ),
      width: "96px",
    },
  ];

  return (
    <>
      <PageHeader title="People" />
      <Content>
        <div className="mt-6 flex items-center gap-2">
          <ToggleGroup<"all" | EntityId>
            label="Entity"
            value={entityFilter}
            onChange={setEntityFilter}
            options={ENTITY_FILTERS}
          />
          <ToggleGroup<"all" | string>
            label="Employment type"
            value={typeFilter}
            onChange={setTypeFilter}
            options={TYPE_FILTERS}
          />
        </div>

        <div className="mt-4">
          <Table
            columns={columns}
            rows={filteredRows}
            rowKey={(row) => row.employee.employeeId}
            onRowClick={(row) => router.push(`/people/${row.employee.employeeId}`)}
            emptyState={
              <Text variant="body" className="text-text-secondary">
                No one matches these filters.
              </Text>
            }
          />
        </div>
      </Content>
    </>
  );
}

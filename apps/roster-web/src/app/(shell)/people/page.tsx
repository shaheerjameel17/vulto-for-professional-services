"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { employeeListForDirectoryQuery, type DirectoryEmployee } from "@vulto/graph";
import type { EmploymentType } from "@vulto/graph";
import { useShellBootstrap } from "../../../components/shell-bootstrap";
import { rememberPeopleOrder } from "../../../lib/people-order";
import { notificationRefusalMessage } from "../../../lib/notification-refusal";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Avatar,
  Badge,
  Button,
  Content,
  InlineAlert,
  MultiSelect,
  PageHeader,
  Table,
  Text,
  type TableColumn,
} from "@vulto/ui";
import {
  AddPersonDialog,
  type NewPersonDraft,
} from "../../../components/people/AddPersonDialog";

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
 * FDN-9 settled the table-header contrast rule: column headers are
 * load-bearing labels and use `text-secondary`, not `text-tertiary`.
 *
 * Row selection into a Panel summary and checkbox-based selection are
 * VPS-D002's Table behavior too, but nothing on this screen needs either
 * yet — clicking a row goes straight to the profile, which is the fastest
 * path to any person this screen exists to provide.
 */

type DirectoryRow = {
  employee: {
    employeeId: string;
    fullName: string;
    employeeCode: string;
    jobTitle: string;
    entityId: string;
  };
  lifecycleStatus: string;
  entityName: string;
  department: string;
  employmentType: string;
  managerName?: string;
  contractedHours?: number;
};

type DirectoryColumnKey =
  "code" | "role" | "department" | "entity" | "type" | "status" | "manager" | "hours";

const TYPE_FILTERS: { value: EmploymentType; label: string }[] = [
  { value: "FullTime", label: "Full time" },
  { value: "PartTime", label: "Part time" },
  { value: "Contractor", label: "Contractor" },
  { value: "Intern", label: "Intern" },
];

const COLUMN_OPTIONS: { value: DirectoryColumnKey; label: string }[] = [
  { value: "code", label: "Employee code" },
  { value: "role", label: "Role" },
  { value: "department", label: "Department" },
  { value: "entity", label: "Entity" },
  { value: "type", label: "Employment type" },
  { value: "status", label: "Status" },
  { value: "manager", label: "Reports to" },
  { value: "hours", label: "Hours per week" },
];

export default function PeoplePage() {
  const router = useRouter();
  const { client, workspaceId } = useShellBootstrap();
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(
    () =>
      client.subscribe(employeeListForDirectoryQuery(), ({ result }) => {
        if (
          result.kind === "device-query" &&
          result.name === "employee.listForDirectory"
        )
          setEmployees(result.data);
      }),
    [client],
  );
  const ENTITY_FILTERS = useMemo(
    () => [
      ...new Map(
        employees
          .filter((row) => row.entityId !== null)
          .map((row) => [
            row.entityId!,
            {
              value: row.entityId!,
              label: row.entityName ?? row.entityId!,
              keywords: row.entityName ?? "",
            },
          ]),
      ).values(),
    ],
    [employees],
  );
  /*
   * Every option selected, not none.
   *
   * An empty selection and a full one filter identically — `allLabel` covers
   * both, and MultiSelect treats "all selected" as no active filter. But the
   * popover is where the user finds out which is which, and opening it to a
   * column of empty checkboxes above a table showing every row states the
   * opposite of what is true. The control should agree with the table it
   * controls at rest.
   */
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<EmploymentType[]>(
    TYPE_FILTERS.map((option) => option.value),
  );
  const [visibleColumns, setVisibleColumns] = useState<DirectoryColumnKey[]>(
    COLUMN_OPTIONS.map((column) => column.value),
  );
  /*
   * FDN-44. Which columns appear and what order they appear in are two
   * different questions, and the Columns control was only answering the first.
   *
   * One piece of state answers the second, edited by two gestures onto the
   * same list: dragging a row in the Columns popover, or dragging a header in
   * the table itself. `name` is not in it — it is the row's identity and holds
   * the first position, which is why Table has a `pinned` flag at all.
   */
  const [columnOrder, setColumnOrder] = useState<DirectoryColumnKey[]>(
    COLUMN_OPTIONS.map((column) => column.value),
  );
  const [addPersonOpen, setAddPersonOpen] = useState(false);

  const rows: DirectoryRow[] = useMemo(
    () =>
      employees
        .filter((row) => row.operational["employee_type"] !== "Ghost")
        .map((row) => {
          const r = row.operational;
          return {
            employee: {
              employeeId: row.employeeId,
              fullName: String(r["full_name"] ?? ""),
              employeeCode: String(r["employee_code"] ?? ""),
              jobTitle: String(r["job_title"] ?? ""),
              entityId: row.entityId ?? "",
            },
            lifecycleStatus: row.lifecycleStatus,
            entityName: row.entityName ?? "—",
            department: String(r["department"] ?? "—"),
            employmentType: String(r["employment_type"] ?? "—"),
            managerName: row.managerName ?? undefined,
            contractedHours:
              typeof r["contracted_hours"] === "number"
                ? r["contracted_hours"]
                : undefined,
          };
        }),
    [employees],
  );
  const orderedRowsChange = useCallback(
    (ordered: DirectoryRow[]) => {
      rememberPeopleOrder(
        workspaceId,
        ordered.map((row) => row.employee.employeeId),
      );
    },
    [workspaceId],
  );

  async function createPerson(person: NewPersonDraft): Promise<boolean> {
    setRefusal(null);
    const outcome = await client.mutate("employee.create", {
      employee_id: crypto.randomUUID(),
      entity_id: person.entityId,
      effective_from: new Date().toISOString(),
      fields: {
        employee_code: person.employeeCode,
        full_name: person.fullName,
        email: person.email,
        job_title: person.jobTitle,
        department: person.department || null,
        employment_type: person.employmentType,
        start_date: person.startDate,
      },
    });
    if (!outcome.accepted) setRefusal(notificationRefusalMessage(outcome.reason));
    return outcome.accepted;
  }

  const filteredRows = rows.filter((row) => {
    if (entityFilter.length > 0 && !entityFilter.includes(row.employee.entityId))
      return false;
    if (
      typeFilter.length > 0 &&
      !typeFilter.includes(row.employmentType as EmploymentType)
    )
      return false;
    return true;
  });

  const allColumns: TableColumn<DirectoryRow>[] = [
    {
      key: "name",
      header: "Name",
      pinned: true,
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
      key: "code",
      header: "Code",
      sortable: true,
      sortValue: (row) => row.employee.employeeCode,
      render: (row) => (
        <Text variant="micro" className="numeric-tabular text-text-tertiary">
          {row.employee.employeeCode}
        </Text>
      ),
      width: "104px",
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
      sortValue: (row) => row.entityName,
      render: (row) => (
        <Text variant="body" className="text-text-secondary">
          {row.entityName}
        </Text>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortable: true,
      sortValue: (row) => row.employmentType,
      render: (row) => (
        <Badge tone="neutral" shape="pill">
          {row.employmentType}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge
          tone={row.lifecycleStatus === "Active" ? "success" : "neutral"}
          shape="pill"
        >
          {row.lifecycleStatus}
        </Badge>
      ),
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
        <Text variant="numeric" className="text-text-primary">
          {row.contractedHours ?? "—"}
        </Text>
      ),
      width: "96px",
    },
  ];
  /* Name first, then the visible columns in the order the user has put them. */
  const columns: TableColumn<DirectoryRow>[] = [
    allColumns.find((column) => column.key === "name")!,
    ...columnOrder
      .filter((key) => visibleColumns.includes(key))
      .map((key) => allColumns.find((column) => column.key === key))
      .filter((column): column is TableColumn<DirectoryRow> => column !== undefined),
  ];

  /* Table hands back every key it was given, `name` among them; the order
   * state holds only the movable ones. */
  const orderedColumnOptions = columnOrder
    .map((key) => COLUMN_OPTIONS.find((option) => option.value === key))
    .filter(
      (option): option is (typeof COLUMN_OPTIONS)[number] => option !== undefined,
    );

  return (
    <>
      <PageHeader
        title="People"
        headingLevel={1}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setAddPersonOpen(true)}>
            Add person
          </Button>
        }
      />
      <Content>
        <div className="sticky top-0 z-30 flex h-12 flex-wrap items-center gap-2 bg-bg-subtle">
          <MultiSelect<string>
            label="Entity"
            allLabel="All entities"
            value={entityFilter}
            onChange={setEntityFilter}
            options={ENTITY_FILTERS}
            searchable
            searchPlaceholder="Search entities"
            appearance="filter"
          />
          <MultiSelect<EmploymentType>
            label="Employment type"
            allLabel="All types"
            value={typeFilter}
            onChange={setTypeFilter}
            options={TYPE_FILTERS}
            appearance="filter"
          />
          <MultiSelect<DirectoryColumnKey>
            label="Columns"
            allLabel="All columns"
            value={visibleColumns}
            onChange={setVisibleColumns}
            onReorder={setColumnOrder}
            options={orderedColumnOptions}
            searchable
            searchPlaceholder="Search columns"
            appearance="filter"
          />
        </div>

        {refusal ? (
          <InlineAlert tone="danger" className="mt-4">
            {refusal}
          </InlineAlert>
        ) : null}

        <div className="pt-1">
          <Table
            columns={columns}
            rows={filteredRows}
            onOrderedRowsChange={orderedRowsChange}
            rowKey={(row) => row.employee.employeeId}
            appearance="directory"
            stickyHeaderClassName="top-12"
            /*
             * The table only knows about the columns it was given, so a drop
             * there reports the visible order and nothing about the hidden
             * ones. Rewriting the whole order from it would silently discard
             * every unchecked column. Instead the new sequence is dealt back
             * into the visible slots of the existing order, which leaves each
             * hidden column exactly where its owner left it — so unchecking a
             * column and checking it again returns it to its own position.
             */
            onReorderColumns={(keys) => {
              const moved = keys.filter(
                (key): key is DirectoryColumnKey => key !== "name",
              );
              setColumnOrder((current) => {
                // Copied inside the updater, not outside: React may call this
                // more than once for a single update, and an updater that
                // drains a shared queue is not idempotent.
                const queue = [...moved];
                return current.map((key) =>
                  visibleColumns.includes(key) ? (queue.shift() ?? key) : key,
                );
              });
            }}
            onRowClick={(row) => router.push(`/people/${row.employee.employeeId}`)}
            emptyState={
              <Text variant="body" className="text-text-secondary">
                No one matches these filters.
              </Text>
            }
          />
        </div>
      </Content>
      <AddPersonDialog
        open={addPersonOpen}
        onOpenChange={setAddPersonOpen}
        onCreate={createPerson}
        entities={ENTITY_FILTERS}
        refusal={refusal}
      />
    </>
  );
}

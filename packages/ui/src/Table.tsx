"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

/*
 * VPS-D002. The most-used component in the product.
 *
 * 32px rows. Header row at `micro`, uppercase, `text-tertiary`,
 * 1px bottom border-default. Rows carry no separators — separation is
 * `bg-hover` and alignment alone. Numeric columns right-aligned in `numeric`;
 * text columns left-aligned; no center alignment anywhere.
 *
 * FINDING F9, deliberately not patched here: the header row's `micro` in
 * `text-tertiary` computes to roughly 2.6:1, and a table is nothing but
 * column headers doing load-bearing work — see FDN-9, which resolves this as
 * a design-system rule change rather than a local fix.
 *
 * NOT YET BUILT: checkbox row selection, keyboard row navigation and
 * virtualisation above 100 rows. VPS-D002 specifies all three; no screen
 * composing this component yet needs them, and this component is not the
 * place to build ahead of that need. Sticky header, sort-on-click and hover
 * are what People actually uses, so that is what exists.
 */

export type TableColumn<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  /** Reserves a fixed width so short columns don't stretch to fill space. */
  width?: string;
};

export type TableProps<T> = {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Controlled selection for J/K-driven experience surfaces. */
  selectedRowKey?: string;
  emptyState?: ReactNode;
  appearance?: "default" | "directory";
};

type SortState = { key: string; direction: "asc" | "desc" } | null;

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedRowKey,
  emptyState,
  appearance = "default",
}: TableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);

  function toggleSort(column: TableColumn<T>) {
    if (!column.sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== column.key) return { key: column.key, direction: "asc" };
      if (prev.direction === "asc") return { key: column.key, direction: "desc" };
      return null;
    });
  }

  const sortedRows = (() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const withValue = rows.map((row) => ({ row, value: column.sortValue!(row) }));
    withValue.sort((a, b) => {
      if (a.value < b.value) return sort.direction === "asc" ? -1 : 1;
      if (a.value > b.value) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
    return withValue.map((w) => w.row);
  })();

  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const directory = appearance === "directory";

  return (
    <div className={cx(!directory && "overflow-hidden rounded-md border border-border-default")}>
      <table className="w-full border-collapse">
        <thead className={cx("sticky top-0 z-10", directory ? "bg-transparent" : "bg-bg-surface")}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cx(
                  directory ? "h-control bg-bg-active px-cell first:rounded-l-md last:rounded-r-md" : "h-8 border-b border-border-default px-cell",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                <button
                  type="button"
                  disabled={!column.sortable}
                  onClick={() => toggleSort(column)}
                  className={cx(
                    "inline-flex items-center gap-1",
                    column.sortable && "cursor-pointer hover:text-text-secondary",
                    column.align === "right" && "flex-row-reverse",
                  )}
                >
                  <Text variant="micro" className="text-text-tertiary">
                    {column.header}
                  </Text>
                  {column.sortable && sort?.key === column.key ? (
                    <Icon
                      icon={sort.direction === "asc" ? ChevronUp : ChevronDown}
                      size={16}
                      className="text-text-tertiary"
                    />
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const key = rowKey(row);
            const selected = selectedRowKey === key;
            return (
            <tr
              key={key}
              aria-selected={selected || undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cx(
                directory ? "h-timeline-row motion-fast transition-colors" : "h-row motion-fast transition-colors",
                onRowClick && "cursor-pointer hover:bg-bg-raised",
                selected && "bg-bg-selected",
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    "px-cell",
                    column.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

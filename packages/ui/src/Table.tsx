"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useReorder } from "./useReorder";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { Text } from "./Text";

/*
 * VPS-D002. The most-used component in the product.
 *
 * 32px rows. Header row at `micro`, uppercase, `text-secondary`, on a rounded
 * active strip. Rows carry no separators — separation is `bg-hover`, spacing
 * and alignment alone. Numeric columns right-aligned in `numeric`; text
 * columns left-aligned; no center alignment anywhere.
 *
 * NOT YET BUILT: checkbox row selection, keyboard row navigation and
 * virtualization above 100 rows. VPS-D002 specifies all three; no screen
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
  cellClassName?: string;
  /** Identity columns hold position: they cannot be dragged, and nothing can
   * be dropped onto them. A directory whose name column can be pushed into
   * the middle has stopped being a directory. */
  pinned?: boolean;
};

export type TableProps<T> = {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Controlled selection for J/K-driven experience surfaces. */
  selectedRowKey?: string;
  emptyState?: ReactNode;
  appearance?: "default" | "directory" | "queue";
  /** Offset used when another sticky control band sits above the table. */
  stickyHeaderClassName?: string;
  rowClassName?: string;
  /**
   * FDN-44. Enables drag-to-reorder on the column headers. Receives every
   * column key in its new order, pinned columns included and still in place.
   *
   * The caller owns the order — the same order the Columns control edits — so
   * dragging a header and dragging its row in that list are two gestures onto
   * one piece of state rather than two competing ones.
   */
  onReorderColumns?: (keys: string[]) => void;
};

type SortState = { key: string; direction: "asc" | "desc" } | null;

function HeaderLabel<T>({
  column,
  sort,
  onSort,
}: {
  column: TableColumn<T>;
  sort: SortState;
  onSort: () => void;
}) {
  const content = (
    <>
      {/* FDN-44: `text-primary`. FDN-9 already moved these off `text-tertiary`
       * on the grounds that a column header is a load-bearing label; at 11px,
       * uppercase and tracked, on a filled strip, `text-secondary` was still
       * reading as supporting text rather than as the label of a column. */}
      <Text variant="micro" className="text-text-primary">
        {column.header}
      </Text>
      {column.sortable && sort?.key === column.key ? (
        <Icon
          icon={sort.direction === "asc" ? ChevronUp : ChevronDown}
          size={16}
          className="text-text-secondary"
        />
      ) : null}
    </>
  );

  const layout = cx(
    "inline-flex items-center gap-1",
    column.align === "right" && "flex-row-reverse",
  );

  if (!column.sortable) {
    return <span className={layout}>{content}</span>;
  }

  return (
    <button
      type="button"
      onClick={onSort}
      className={cx(layout, "cursor-pointer hover:text-text-secondary")}
    >
      {content}
    </button>
  );
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedRowKey,
  emptyState,
  appearance = "default",
  stickyHeaderClassName,
  rowClassName,
  onReorderColumns,
}: TableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);

  /*
   * Column reordering runs on the shared pointer-event mechanism rather than
   * HTML5 drag-and-drop — see `useReorder` for why the native API was
   * abandoned. `isFixed` keeps pinned identity columns in place and stops
   * anything being inserted ahead of them.
   */
  const reorder = useReorder<string>({
    items: columns.map((column) => column.key),
    onReorder: (next) => onReorderColumns?.(next),
    axis: "horizontal",
    isFixed: (key) => columns.find((column) => column.key === key)?.pinned ?? false,
  });

  function toggleSort(column: TableColumn<T>) {
    if (!column.sortable) return;
    setSort((prev) => {
      if (!prev || prev.key !== column.key)
        return { key: column.key, direction: "asc" };
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
  const insetHeader = appearance !== "default";

  return (
    <div
      className={cx(
        !insetHeader && "overflow-hidden rounded-md border border-border-default",
      )}
    >
      <table
        className={cx(
          "w-full",
          // Queue rows want a real gap after the header pill and between
          // each other — border-spacing does that without touching any
          // cell's own padding, so the header's vertical centering is never
          // at risk of being pushed off by it again.
          //
          // FDN-44 puts the directory on `border-separate` too, at zero
          // spacing. A row's fill has to be able to carry a radius, and under
          // `border-collapse` cell backgrounds are painted into one shared
          // grid that no radius on the row can clip. At zero spacing the rows
          // still tile with no gap, so nothing about the directory's density
          // changes — only whether its hover can have corners.
          appearance === "queue"
            ? "border-separate border-spacing-x-0 border-spacing-y-2"
            : directory
              ? "border-separate border-spacing-0"
              : "border-collapse",
        )}
      >
        <thead
          className={cx(
            "sticky top-0 z-10",
            insetHeader ? "bg-transparent" : "bg-bg-surface",
            stickyHeaderClassName,
          )}
        >
          <tr>
            {columns.map((column, index) => {
              const movable = Boolean(onReorderColumns) && !column.pinned;
              return (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  /*
                   * The header cell is the drag source, and the sort button
                   * inside it keeps the click. A press that never moves fires
                   * `click` and no drag; a press that moves fires the drag and
                   * no click, so the two gestures do not have to be arbitrated.
                   */
                  ref={onReorderColumns ? reorder.register(column.key) : undefined}
                  {...(movable ? reorder.dragHandleProps(column.key) : {})}
                  className={cx(
                    // FDN-44: `bg-column-header`, not `bg-active` — see the
                    // token's own note. A state token was standing in for a
                    // structural surface and only worked in one of the two
                    // places this table is used.
                    "relative",
                    insetHeader
                      ? "h-control bg-bg-column-header px-cell first:rounded-l-md last:rounded-r-md"
                      : "h-8 border-b border-border-default px-cell",
                    column.align === "right" ? "text-right" : "text-left",
                    movable && "cursor-grab touch-none",
                    reorder.dragging === column.key && "opacity-40",
                    "motion-fast transition-colors",
                  )}
                >
                  {/*
                   * The insertion indicator sits in the gap between two columns,
                   * because that is the question the gesture asks — between
                   * which two, not onto which one. Absolutely positioned so it
                   * occupies no width: an indicator that takes space reflows
                   * every column to its right at the exact moment you are aiming
                   * at one of them.
                   */}
                  {onReorderColumns && reorder.dropIndex === index ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-0 border-l-2 border-brand-600"
                    />
                  ) : null}
                  {onReorderColumns &&
                  reorder.dropIndex === columns.length &&
                  index === columns.length - 1 ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 right-0 border-r-2 border-brand-600"
                    />
                  ) : null}
                  {/*
                   * FDN-44: an unsortable header is not a disabled button, it
                   * is not a button.
                   *
                   * Every header used to render as one, `disabled` when the
                   * column had no sort — and VPS-D002's own base rule puts
                   * `:disabled` at 40% opacity. So on the People directory,
                   * Status and Name-only columns were drawn at 40% of the
                   * weight of the columns beside them, which read as a
                   * contrast failure in the type and was actually a control
                   * state leaking onto a label. A label with nothing to press
                   * is a label.
                   */}
                  <HeaderLabel
                    column={column}
                    sort={sort}
                    onSort={() => toggleSort(column)}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const key = rowKey(row);
            const selected = selectedRowKey === key;
            return (
              /*
               * FDN-44. The row's fill lives on its cells, not on the row.
               *
               * A `<tr>` accepts `border-radius` and does nothing with it — the
               * background is painted by the cells, so the corners a row appears
               * to have are its first and last cell's. Carrying the fill down to
               * the cells and rounding the outer two is what actually gives a
               * hovered or selected row corners, and `group` keeps the hover a
               * whole-row gesture rather than a per-cell one.
               */
              <tr
                key={key}
                aria-selected={selected || undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx(
                  "group",
                  directory && "h-timeline-row",
                  onRowClick && "cursor-pointer",
                  rowClassName,
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      "px-cell motion-fast transition-colors",
                      insetHeader && "first:rounded-l-md last:rounded-r-md",
                      onRowClick && "group-hover:bg-bg-hover",
                      selected && "bg-bg-active",
                      column.align === "right" ? "text-right" : "text-left",
                      column.cellClassName,
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

"use client";

import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

/*
 * Drag-to-reorder, on pointer events rather than HTML5 drag-and-drop.
 *
 * The first implementation used the native `draggable` API and did not work in
 * practice. Three things are wrong with it here, and any one of them is enough:
 *
 *  - It is unreliable inside a Radix portal. An open Popover manages
 *    `pointer-events` on the document to implement dismissal, and a native drag
 *    session interacts badly with that.
 *  - Only the element carrying `draggable` starts a drag. The grip was the drag
 *    source, so grabbing the row — which is what anyone actually does — did
 *    nothing at all, silently.
 *  - It cannot be verified. Synthetic mouse input does not open a native drag
 *    session, so an automated check passes or fails for reasons unrelated to
 *    whether the feature works.
 *
 * Pointer events have none of those problems, and they give the drop indicator
 * a real position to render at instead of a highlighted target cell.
 *
 * `dropIndex` is an *insertion* index in 0..items.length — the slot the item
 * would land in, not the item it would displace. That distinction is what lets
 * the indicator sit in the gap between two rows rather than on top of one.
 */

export type ReorderAxis = "vertical" | "horizontal";

/** Movement, in pixels, before a press becomes a drag. Below this a press is
 * still a click, so a checkbox in the row keeps working. */
const DRAG_THRESHOLD = 4;

export type UseReorderOptions<T extends string> = {
  items: T[];
  onReorder: (next: T[]) => void;
  axis?: ReorderAxis;
  /** Items that hold their position — an identity column, say. They cannot be
   * dragged, and nothing can be inserted ahead of a leading run of them. */
  isFixed?: (item: T) => boolean;
};

export function useReorder<T extends string>({
  items,
  onReorder,
  axis = "vertical",
  isFixed,
}: UseReorderOptions<T>) {
  const [dragging, setDragging] = useState<T>();
  const [dropIndex, setDropIndex] = useState<number>();

  const nodes = useRef(new Map<T, HTMLElement>());
  const origin = useRef<{ item: T; x: number; y: number; active: boolean }>(undefined);
  /* State is read inside pointer handlers that run between renders, so the
   * live values live in refs and state exists only to drive the indicator. */
  const live = useRef<{ dragging?: T; dropIndex?: number }>({});

  const register = useCallback(
    (item: T) => (node: HTMLElement | null) => {
      if (node) nodes.current.set(item, node);
      else nodes.current.delete(item);
    },
    [],
  );

  /** The first slot an item may occupy, after any leading fixed items. */
  const firstMovable = (() => {
    if (!isFixed) return 0;
    let index = 0;
    while (index < items.length && isFixed(items[index]!)) index += 1;
    return index;
  })();

  const computeDropIndex = useCallback(
    (clientX: number, clientY: number) => {
      const position = axis === "vertical" ? clientY : clientX;
      let index = items.length;
      for (let i = 0; i < items.length; i += 1) {
        const node = nodes.current.get(items[i]!);
        if (!node) continue;
        const rect = node.getBoundingClientRect();
        const middle =
          axis === "vertical" ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        if (position < middle) {
          index = i;
          break;
        }
      }
      return Math.max(firstMovable, index);
    },
    [axis, items, firstMovable],
  );

  const finish = useCallback(() => {
    const item = live.current.dragging;
    const target = live.current.dropIndex;
    if (item !== undefined && target !== undefined) {
      const from = items.indexOf(item);
      if (from !== -1) {
        const next = items.slice();
        next.splice(from, 1);
        // Removing the item first shifts every later slot down by one, so an
        // insertion point beyond the original position has to come back one.
        const to = target > from ? target - 1 : target;
        if (to !== from) {
          next.splice(to, 0, item);
          onReorder(next);
        }
      }
    }
    origin.current = undefined;
    live.current = {};
    setDragging(undefined);
    setDropIndex(undefined);
  }, [items, onReorder]);

  const cancel = useCallback(() => {
    origin.current = undefined;
    live.current = {};
    setDragging(undefined);
    setDropIndex(undefined);
  }, []);

  /** Spread onto whatever should start the drag — the row, not just its grip. */
  const dragHandleProps = useCallback(
    (item: T) => {
      if (isFixed?.(item)) return {};
      return {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
          // Primary button only, and never from a nested control.
          if (event.button !== 0) return;
          origin.current = { item, x: event.clientX, y: event.clientY, active: false };
        },
        onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
          const start = origin.current;
          if (!start || start.item !== item) return;
          if (!start.active) {
            const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (moved < DRAG_THRESHOLD) return;
            start.active = true;
            live.current.dragging = item;
            setDragging(item);
            // Captured only once the press has become a drag, so a plain click
            // is never redirected away from the control it landed on.
            //
            // Guarded: capture throws for a pointer id the browser does not
            // consider active, and a throw here would abort the move handler
            // and strand the drag. Capture is an improvement to the gesture,
            // not a requirement of it — losing it degrades rather than breaks.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* no capture available; the drag still tracks the pointer */
            }
          }
          const next = computeDropIndex(event.clientX, event.clientY);
          live.current.dropIndex = next;
          setDropIndex(next);
        },
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
          if (origin.current?.active) {
            event.preventDefault();
            event.stopPropagation();
          }
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            /* nothing was captured */
          }
          finish();
        },
        onPointerCancel: cancel,
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key === "Escape" && origin.current) {
            event.preventDefault();
            cancel();
          }
        },
      };
    },
    [cancel, computeDropIndex, finish, isFixed],
  );

  /** VPS-D002's accessibility floor: every pointer gesture needs a keyboard
   * path. Alt+Arrow moves the item one slot. */
  const nudge = useCallback(
    (item: T, direction: -1 | 1) => {
      if (isFixed?.(item)) return;
      const from = items.indexOf(item);
      const to = from + direction;
      if (from === -1 || to < firstMovable || to >= items.length) return;
      if (isFixed?.(items[to]!)) return;
      const next = items.slice();
      next.splice(from, 1);
      next.splice(to, 0, item);
      onReorder(next);
    },
    [items, onReorder, isFixed, firstMovable],
  );

  return { dragging, dropIndex, register, dragHandleProps, nudge };
}

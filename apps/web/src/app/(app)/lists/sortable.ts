"use client";

import { useCallback, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type DropTarget = { key: string; after: boolean };

/** `items` with the item keyed `from` moved before or after the one keyed `to`. */
export function moveItem<T>(items: readonly T[], keyOf: (item: T) => string, from: string, target: DropTarget): T[] {
  const moving = items.find((item) => keyOf(item) === from);
  if (!moving || from === target.key) return [...items];
  const rest = items.filter((item) => keyOf(item) !== from);
  const index = rest.findIndex((item) => keyOf(item) === target.key);
  if (index < 0) return [...items];
  rest.splice(target.after ? index + 1 : index, 0, moving);
  return rest;
}

const EDGE = 64;

/**
 * Playlist-style reordering: drag a row by its handle (mouse, pen, or touch,
 * through pointer events), or focus the handle and press the up and down
 * arrows. Rows carry `rowProps(key)`; `onReorder` gets the new order.
 */
export function useSortable<T>({ items, keyOf, onReorder, disabled = false }: {
  items: readonly T[];
  keyOf: (item: T) => string;
  onReorder: (next: T[]) => void;
  disabled?: boolean;
}) {
  const scope = useId();
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const live = useRef<{ key: string; target: DropTarget | null } | null>(null);

  const finish = useCallback(
    (commit: boolean) => {
      const drag = live.current;
      live.current = null;
      setDragging(null);
      setTarget(null);
      if (!commit || !drag?.target || drag.target.key === drag.key) return;
      const next = moveItem(items, keyOf, drag.key, drag.target);
      if (next.some((item, index) => item !== items[index])) onReorder(next);
    },
    [items, keyOf, onReorder],
  );

  const handleProps = (key: string) => ({
    "data-sort-handle": true,
    style: { touchAction: "none" as const, cursor: disabled ? undefined : dragging ? "grabbing" : "grab" },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      live.current = { key, target: null };
      setDragging(key);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!live.current) return;
      if (event.clientY < EDGE) window.scrollBy(0, -12);
      else if (event.clientY > window.innerHeight - EDGE) window.scrollBy(0, 12);
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(`[data-sort-scope="${scope}"]`);
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const next = { key: row.dataset.sortKey!, after: event.clientY > rect.top + rect.height / 2 };
      live.current.target = next;
      setTarget((current) => (current?.key === next.key && current.after === next.after ? current : next));
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (disabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      const index = items.findIndex((item) => keyOf(item) === key);
      const neighbor = items[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (index < 0 || !neighbor) return;
      onReorder(moveItem(items, keyOf, key, { key: keyOf(neighbor), after: event.key === "ArrowDown" }));
    },
  });

  const rowProps = (key: string) => ({ "data-sort-scope": scope, "data-sort-key": key });

  /** Where the drop line shows on this row, if the drag is over it. */
  const indicator = (key: string): "before" | "after" | null =>
    dragging && target?.key === key && target.key !== dragging ? (target.after ? "after" : "before") : null;

  return { dragging, handleProps, rowProps, indicator };
}

/** The drop line on a row: an inset accent edge, so rows do not shift. */
export function dropIndicatorClass(drop: "before" | "after" | null) {
  return drop === "before" ? "shadow-[inset_0_2px_0_0_rgb(var(--accent-solid))]" : drop === "after" ? "shadow-[inset_0_-2px_0_0_rgb(var(--accent-solid))]" : undefined;
}

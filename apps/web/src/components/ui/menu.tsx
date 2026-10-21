"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { MotionPresence } from "./motion";

export type MenuItem = {
  key: string;
  label: string;
  /** A second, muted line under the label. */
  description?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void;
};

const enabledItems = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

/**
 * A "⋯" actions menu: a ghost icon trigger and a small popover of items.
 * Opens with focus on the first item; the arrow keys, Home, and End move
 * between items; Escape or an outside click closes it and returns focus to
 * the trigger; picking an item closes it first.
 */
export function Menu({ label, items, className }: { label: string; items: readonly MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    // Focus the first item once the popover is in the DOM.
    const frame = requestAnimationFrame(() => enabledItems(rootRef.current)[0]?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") return close(false);
    const buttons = enabledItems(rootRef.current);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown" ? (index + 1) % buttons.length
      : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
      : event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : null;
    if (next == null || buttons.length === 0) return;
    event.preventDefault();
    buttons[next]!.focus();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)} onKeyDown={onKeyDown}>
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant="ghost"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      <MotionPresence
        show={open}
        id={menuId}
        role="menu"
        aria-label={label}
        className="absolute right-0 top-[calc(100%+0.25rem)] z-30 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-card-hover"
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              close(true);
              item.onSelect();
            }}
            className={cn(
              "block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-subtle focus-visible:bg-subtle disabled:opacity-45",
              item.tone === "danger" ? "text-danger" : "text-fg",
            )}
          >
            <span className="block">{item.label}</span>
            {item.description && <span className="mt-0.5 block text-xs leading-snug text-muted">{item.description}</span>}
          </button>
        ))}
      </MotionPresence>
    </div>
  );
}

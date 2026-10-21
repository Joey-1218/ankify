"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";
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

type Place = { right: number; side: "top" | "bottom"; top?: number; bottom?: number };

const GAP = 4;
const enabledItems = (root: HTMLElement | null) => [...(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

/** Under the trigger, or above it when the window has more room there. */
function placeFor(trigger: HTMLElement, height: number): Place {
  const rect = trigger.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom;
  const right = Math.max(8, window.innerWidth - rect.right);
  return below < height + GAP * 2 && rect.top > below
    ? { right, side: "top", bottom: window.innerHeight - rect.top + GAP }
    : { right, side: "bottom", top: rect.bottom + GAP };
}

/**
 * A "⋯" actions menu: a ghost icon trigger and a small popover of items.
 * The popover is portaled to the body and pinned to the trigger, so a
 * scrolling table never clips it. Opens with focus on the first item; the
 * arrow keys, Home, and End move between items; Escape or an outside click
 * closes it and returns focus to the trigger; Tab closes it and moves on
 * from the trigger; picking an item closes it first.
 */
export function Menu({ label, items, className }: { label: string; items: readonly MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const mounted = useHydrated();

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (triggerRef.current) setPlace(placeFor(triggerRef.current, popoverRef.current?.offsetHeight ?? 0));
    };
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // Once the popover is in the DOM: place it by its real height, and focus the first item.
    const frame = requestAnimationFrame(() => {
      update();
      enabledItems(popoverRef.current)[0]?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      cancelAnimationFrame(frame);
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const toggle = () => {
    if (open) return close(false);
    // A first guess from the item count; the real height places it a frame later.
    setPlace(placeFor(triggerRef.current!, items.length * 44 + 12));
    setOpen(true);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    // Focus returns to the trigger before the browser moves it on.
    if (event.key === "Tab") return close(true);
    const buttons = enabledItems(popoverRef.current);
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
    <div className={cn("relative", className)}>
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant="ghost"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {mounted &&
        createPortal(
          <MotionPresence
            show={open && place != null}
            side={place?.side}
            ref={popoverRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onKeyDown}
            style={{ position: "fixed", top: place?.top, bottom: place?.bottom, right: place?.right }}
            className="z-[90] w-64 rounded-xl border border-border bg-surface p-1.5 shadow-card-hover"
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
          </MotionPresence>,
          document.body,
        )}
    </div>
  );
}

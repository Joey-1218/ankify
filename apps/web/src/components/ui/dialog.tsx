"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useHydrated } from "@/lib/use-hydrated";
import { useDialogA11y } from "@/lib/use-dialog-a11y";

/**
 * A modal panel over a dimmed page: a title row, a body, and an optional
 * footer of buttons. Focus moves in on open (to `initialFocusRef`, else the
 * first control), stays inside while open, and returns on close; Escape and
 * a click on the backdrop close it. `alertdialog` is for confirmations.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
  role = "dialog",
  initialFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Under the title, and the dialog's accessible description. */
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** The backdrop's name for assistive tech (it closes the dialog). */
  closeLabel: string;
  role?: "dialog" | "alertdialog";
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const mounted = useHydrated();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useDialogA11y({ open, onClose, containerRef: dialogRef, initialFocusRef });

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6" role="presentation">
      <button
        type="button"
        aria-label={closeLabel}
        tabIndex={-1}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="relative z-[101] flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          {description && (
            <div id={descriptionId} className="mt-1 whitespace-pre-line text-sm text-muted">
              {description}
            </div>
          )}
        </div>
        {children && <div className="min-h-0 overflow-y-auto px-5 py-4 text-sm">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PracticeSessionDto } from "@ankileet/contracts";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useLanguage } from "@/components/LanguageProvider";
import { notifyMistakesChanged } from "@/lib/mistakes-client";
import { notifyReviewQueueUpdated } from "@/lib/review-queue-event";

/** Deletes a finished session from the Sessions tab. The server undoes its
 *  rating or first-review schedule; the dialog says which before confirming. */
export function DeleteSessionButton({ session }: { session: PracticeSessionDto }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effect =
    session.rating.disposition === "submitted"
      ? t.sessions.deleteRated
      : session.type === "initial_learning" && session.status === "completed"
        ? t.sessions.deleteInitial
        : t.sessions.deleteNoSchedule;

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
  }

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/practice-sessions/${session.id}`, { method: "DELETE" }).catch(() => null);
    // Already gone (deleted in another tab) counts as done.
    if (res && (res.ok || res.status === 404)) {
      notifyReviewQueueUpdated();
      notifyMistakesChanged(session.problemId);
      setBusy(false);
      setOpen(false);
      router.refresh();
      return;
    }
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setError(
      body?.error === "undo_conflict"
        ? t.sessions.deleteLaterChange
        : body?.error === "open_session_conflict"
          ? t.sessions.deleteOpenSession
          : t.common.deleteFailed,
    );
    setBusy(false);
  }

  return (
    <>
      <Button size="xs" variant="ghost" aria-label={t.sessions.deleteLabel} onClick={() => setOpen(true)}>
        {t.common.delete}
      </Button>
      <ConfirmDialog
        open={open}
        title={t.sessions.deleteTitle}
        description={`${effect}\n${t.sessions.deleteCommon}`}
        cancelLabel={t.common.cancel}
        confirmLabel={t.common.delete}
        busy={busy}
        error={error}
        onClose={close}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}

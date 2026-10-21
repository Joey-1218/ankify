"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, ListPlus } from "lucide-react";
import type { ProblemStudyListsDto } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Menu } from "@/components/ui/menu";
import { notifyReviewQueueUpdated } from "@/lib/review-queue-event";
import { AddToListDialog } from "../../lists/add-to-list-dialog";
import { PROBLEMS_SEARCH_KEY } from "../problems-sort";

const noSubscription = () => () => {};
const storedSearch = () => {
  try {
    return sessionStorage.getItem(PROBLEMS_SEARCH_KEY) ?? "";
  } catch {
    return "";
  }
};

/** "All problems", back to the list as it was sorted. */
export function ProblemsBackLink() {
  const { t } = useLanguage();
  const search = useSyncExternalStore(noSubscription, storedSearch, () => "");
  return (
    <Link href={`/problems${search}` as Route} className={buttonClasses({ variant: "ghost", size: "sm", className: "-ml-3" })}>
      <ArrowLeft aria-hidden className="h-4 w-4" />
      {t.detail.allProblems}
    </Link>
  );
}

/** Practice the problem on LeetCode (or open it, once archived), and add it to lists. */
export function ProblemPrimaryActions({
  problemId,
  title,
  url,
  archived,
  customLists,
}: {
  problemId: string;
  title: string;
  url: string;
  archived: boolean;
  customLists: ProblemStudyListsDto["customLists"];
}) {
  const { t } = useLanguage();
  const d = t.detail;
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {archived ? (
        <a href={url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary" })}>
          <ExternalLink aria-hidden className="h-4 w-4" />
          {d.openLeetcode}
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary" })}>
          {d.practiceOnLeetcode}
        </a>
      )}
      <Button variant="secondary" onClick={() => setAdding(true)}>
        <ListPlus aria-hidden className="h-4 w-4" />
        {t.lists.addTo}
      </Button>
      <AddToListDialog open={adding} onClose={() => setAdding(false)} target={{ kind: "problem", problemId, title }} lists={customLists} />
    </div>
  );
}

/**
 * The problem's "⋯" menu: archive or restore it (reversible, so no
 * confirmation) or delete it, after a confirmation that says what goes.
 */
export function ProblemMenu({ problemId, title, archived }: { problemId: string; title: string; archived: boolean }) {
  const { t } = useLanguage();
  const d = t.detail;
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "PATCH" | "DELETE", fallback: string) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/problems/${problemId}`, {
      method,
      ...(method === "PATCH" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: !archived }) } : {}),
    }).catch(() => null);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? fallback);
      setBusy(false);
      return false;
    }
    notifyReviewQueueUpdated();
    return true;
  }

  async function toggleArchive() {
    if (await send("PATCH", d.archiveFailed)) router.refresh();
    setBusy(false);
  }

  async function remove() {
    if (!(await send("DELETE", d.deleteFailed))) return;
    router.replace("/problems");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {error && !deleting && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <Menu
        label={d.moreActions}
        items={[
          {
            key: "archive",
            label: archived ? d.unarchive : d.archive,
            description: archived ? d.unarchiveHint : d.archiveHint,
            disabled: busy,
            onSelect: () => void toggleArchive(),
          },
          { key: "delete", label: d.deleteProblem, tone: "danger", disabled: busy, onSelect: () => setDeleting(true) },
        ]}
      />
      <ConfirmDialog
        open={deleting}
        title={d.deletePrompt(title)}
        description={`${d.deleteWarning} ${d.deleteDescription}`}
        cancelLabel={t.common.cancel}
        confirmLabel={d.deleteForever}
        busy={busy}
        error={deleting ? error : null}
        onClose={() => {
          if (busy) return;
          setDeleting(false);
          setError(null);
        }}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

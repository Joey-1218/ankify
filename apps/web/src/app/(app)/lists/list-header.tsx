"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Pin } from "lucide-react";
import type { StudyListSummaryDto } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { STUDY_LIST_NAME_MAX } from "@ankileet/contracts";
import { pick, sendJson } from "./api";
import { ProgressBar } from "./progress-bar";

/** A list's title, progress, and the actions its kind allows. */
export function ListHeader({ list, excludedCount }: { list: StudyListSummaryDto; excludedCount: number }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(list.kind === "custom" ? list.name.en : "");
  const title = list.kind === "my_problems" ? t.lists.myProblems : pick(list.name, language);

  async function run(key: string, action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, after?: (data: unknown) => void) {
    setBusy(key);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) return setError(result.error);
    if (after) after(result.data);
    else router.refresh();
  }

  const follow = () =>
    run("follow", () => sendJson("POST", "/api/study-lists", { action: "follow", requestId: crypto.randomUUID(), builtinId: list.builtinId }));
  const copy = () =>
    run(
      "copy",
      () => sendJson("POST", "/api/study-lists", { action: "copy", requestId: crypto.randomUUID(), builtinId: list.builtinId, name: t.lists.copyName(pick(list.name, language)).slice(0, STUDY_LIST_NAME_MAX) }),
      (data) => router.push(`/lists/${(data as { list: StudyListSummaryDto }).list.id}` as Route),
    );
  const toggleActive = () => run("active", () => sendJson("PATCH", `/api/study-lists/${list.id}`, { active: !list.active }));
  const rename = () =>
    run("rename", () => sendJson("PATCH", `/api/study-lists/${list.id}`, { name: name.trim() }), () => {
      setRenaming(false);
      router.refresh();
    });
  const remove = () =>
    run("delete", () => sendJson("DELETE", `/api/study-lists/${list.id}`), () => {
      setConfirming(false);
      // The row is gone, so only the built-in list's own page still exists.
      if (list.kind === "custom") router.push("/lists");
      else router.replace(`/lists/builtin/${list.builtinId}` as Route);
    });

  const { learned, started, total } = list.progress;
  return (
    <header className="space-y-4">
      <Link href="/lists" className={buttonClasses({ variant: "ghost", size: "sm", className: "-ml-3" })}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t.lists.back}
      </Link>
      <div className="min-w-0 space-y-1">
          {renaming ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={STUDY_LIST_NAME_MAX} aria-label={t.lists.newListName} className="w-72" autoFocus />
              <Button type="submit" size="sm" variant="primary" disabled={busy != null || name.trim().length === 0}>
                {busy === "rename" && <Spinner />}
                {t.common.save}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                {t.common.cancel}
              </Button>
            </form>
          ) : (
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              {list.kind === "my_problems" && <Pin className="h-5 w-5 text-muted" aria-label={t.lists.pinned} />}
              {title}
            </h1>
          )}
          {list.author && (
            <p className="text-sm text-muted">
              {t.lists.by(pick(list.author, language))}
              {list.sourceUrl && (
                <>
                  {" · "}
                  <a href={list.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                    {t.lists.source}
                  </a>
                </>
              )}
            </p>
          )}
          {list.kind === "my_problems" && <p className="text-sm text-muted">{t.lists.myProblemsHelp}</p>}
          {list.followed && !list.active && <p className="text-sm text-muted">{t.lists.pausedHelp}</p>}
          {excludedCount > 0 && <p className="text-xs text-muted">{t.lists.excluded(excludedCount)}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {list.followed && !list.active && <Pill tone="warning">{t.lists.paused}</Pill>}
          {list.kind === "builtin" && !list.followed && (
            <Button variant="primary" size="sm" disabled={busy != null} onClick={() => void follow()}>
              {busy === "follow" && <Spinner />}
              {t.lists.follow}
            </Button>
          )}
          {list.followed && (
            <Button size="sm" disabled={busy != null} onClick={() => void toggleActive()} title={t.lists.pausedHelp}>
              {busy === "active" && <Spinner />}
              {list.active ? t.lists.pause : t.lists.resume}
            </Button>
          )}
          {list.kind === "builtin" && (
            <Button size="sm" disabled={busy != null} onClick={() => void copy()}>
              {busy === "copy" && <Spinner />}
              {t.lists.copy}
            </Button>
          )}
          {list.kind === "custom" && !renaming && (
            <Button size="sm" variant="ghost" disabled={busy != null} onClick={() => setRenaming(true)}>
              {t.lists.rename}
            </Button>
          )}
          {list.followed && (
            <Button size="sm" variant={list.kind === "custom" ? "danger" : "ghost"} disabled={busy != null} onClick={() => setConfirming(true)}>
              {list.kind === "custom" ? t.lists.deleteList : t.lists.unfollow}
            </Button>
          )}
        </div>
        {list.nextUp && (
          <a href={list.nextUp.url} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "primary", size: "sm", className: "max-w-full truncate" })}>
            {t.lists.nextUpLabel(pick(list.nextUp.title, language))}
          </a>
        )}
      </div>
      <div className="space-y-1.5">
        <ProgressBar label={title} valueText={t.lists.progress(learned, started, total)} learned={learned} started={started} total={total} />
        <p className="text-xs text-muted tabular-nums">{t.lists.progress(learned, started, total)}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t.lists.errors[error] ?? t.lists.failed}
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={list.kind === "custom" ? t.lists.deleteTitle : t.lists.unfollowTitle}
        description={list.kind === "custom" ? t.lists.deleteDescription : t.lists.unfollowDescription}
        cancelLabel={t.common.cancel}
        confirmLabel={list.kind === "custom" ? t.lists.deleteList : t.lists.unfollow}
        busy={busy === "delete"}
        error={error ? (t.lists.errors[error] ?? t.lists.failed) : null}
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
      />
    </header>
  );
}

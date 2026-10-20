"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STUDY_LIST_NAME_MAX, type StudyListsOverviewDto, type StudyListSummaryDto } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { pick, sendJson } from "./api";
import { ProgressBar } from "./progress-bar";

export function listHref(list: StudyListSummaryDto): Route {
  if (list.kind === "my_problems") return "/lists/my-problems" as Route;
  if (list.kind === "builtin") return `/lists/builtin/${list.builtinId}` as Route;
  return `/lists/${list.id}` as Route;
}

/** /lists: the user's lists (My problems first), a new-list form, and the built-in lists. */
export function ListsOverview({ overview }: { overview: StudyListsOverviewDto }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, method: "POST" | "PATCH", path: string, body: unknown, after?: (data: unknown) => void) {
    setBusy(key);
    setError(null);
    const result = await sendJson(method, path, body);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    if (after) after(result.data);
    router.refresh();
  }

  const create = () =>
    run("create", "POST", "/api/study-lists", { action: "create", requestId: crypto.randomUUID(), name: name.trim() }, (data) => {
      setName("");
      router.push(listHref((data as { list: StudyListSummaryDto }).list));
    });

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t.lists.errors[error] ?? t.lists.failed}
        </p>
      )}

      <section aria-label={t.lists.yours} className="space-y-3">
        <h2 className="text-lg font-semibold">{t.lists.yours}</h2>
        <Surface as="ul" className="divide-y divide-border overflow-hidden">
          {overview.lists.map((list) => (
            <li key={list.id ?? list.kind} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={listHref(list)} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {list.kind === "my_problems" ? t.lists.myProblems : pick(list.name, language)}
                </Link>
                {list.author && <span className="text-xs text-muted">{t.lists.by(list.author)}</span>}
                {list.followed && !list.active && <Pill tone="warning">{t.lists.paused}</Pill>}
                {list.followed && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy != null}
                    title={t.lists.pausedHelp}
                    onClick={() => void run(`active:${list.id}`, "PATCH", `/api/study-lists/${list.id}`, { active: !list.active })}
                  >
                    {busy === `active:${list.id}` && <Spinner />}
                    {list.active ? t.lists.pause : t.lists.resume}
                  </Button>
                )}
              </div>
              <ProgressBar
                label={list.kind === "my_problems" ? t.lists.myProblems : pick(list.name, language)}
                valueText={t.lists.progress(list.progress.learned, list.progress.started, list.progress.total)}
                learned={list.progress.learned}
                started={list.progress.started}
                total={list.progress.total}
              />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted">
                <span className="tabular-nums">{t.lists.progress(list.progress.learned, list.progress.started, list.progress.total)}</span>
                {list.nextUp && (
                  <a href={list.nextUp.url} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">
                    {t.lists.nextUpLabel(pick(list.nextUp.title, language))}
                  </a>
                )}
              </div>
            </li>
          ))}
        </Surface>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={STUDY_LIST_NAME_MAX}
            placeholder={t.lists.newListPlaceholder}
            aria-label={t.lists.newListName}
            className="w-72"
          />
          <Button type="submit" variant="secondary" disabled={busy != null || name.trim().length === 0}>
            {busy === "create" && <Spinner />}
            {t.lists.newList}
          </Button>
        </form>
      </section>

      <section aria-label={t.lists.builtinTitle} className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">{t.lists.builtinTitle}</h2>
          <p className="mt-1 text-sm text-muted">{t.lists.builtinSubtitle}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {overview.builtin.map((list) => (
            <Surface key={list.builtinId} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={listHref(list)} className="font-medium hover:underline">
                  {pick(list.name, language)}
                </Link>
                {list.followed ? (
                  <Pill tone="success">{t.lists.following}</Pill>
                ) : (
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={busy != null}
                    onClick={() => void run(`follow:${list.builtinId}`, "POST", "/api/study-lists", { action: "follow", requestId: crypto.randomUUID(), builtinId: list.builtinId })}
                  >
                    {busy === `follow:${list.builtinId}` && <Spinner />}
                    {t.lists.follow}
                  </Button>
                )}
              </div>
              <div className="mt-auto space-y-1.5">
                <ProgressBar
                  label={pick(list.name, language)}
                  valueText={t.lists.progress(list.progress.learned, list.progress.started, list.progress.total)}
                  learned={list.progress.learned}
                  started={list.progress.started}
                  total={list.progress.total}
                />
                <p className="text-xs text-muted tabular-nums">{t.lists.progress(list.progress.learned, list.progress.started, list.progress.total)}</p>
              </div>
            </Surface>
          ))}
        </div>
      </section>
    </div>
  );
}

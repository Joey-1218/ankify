"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, GripVertical } from "lucide-react";
import { STUDY_LIST_NAME_MAX, type StudyListAuthorGroupDto, type StudyListsOverviewDto, type StudyListSummaryDto } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { pick, sendJson } from "./api";
import { ProgressBar } from "./progress-bar";
import { dropIndicatorClass, useSortable } from "./sortable";

/** The share choices offered (the API takes 1-10). */
const SHARES = [1, 2, 3, 4, 5] as const;
/** localStorage: the author groups the viewer left open. */
const OPEN_GROUPS_KEY = "ankileet.lists.openGroups";

export function listHref(list: StudyListSummaryDto): Route {
  if (list.kind === "my_problems") return "/lists/my-problems" as Route;
  if (list.kind === "builtin") return `/lists/builtin/${list.builtinId}` as Route;
  return `/lists/${list.id}` as Route;
}

/**
 * /lists in two areas: the user's lists (My problems pinned first, the rest
 * reordered by dragging, deleted or unfollowed in place) and the built-in
 * lists, one collapsible group per author.
 */
export function ListsOverview({ overview }: { overview: StudyListsOverviewDto }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StudyListSummaryDto | null>(null);
  const mine = overview.lists[0]!;
  const [order, setOrder] = useState(() => overview.lists.slice(1));
  const [seeded, setSeeded] = useState(overview.lists);
  if (seeded !== overview.lists) {
    // A router.refresh() handed down newer lists.
    setSeeded(overview.lists);
    setOrder(overview.lists.slice(1));
  }
  const titleOf = (list: StudyListSummaryDto) => (list.kind === "my_problems" ? t.lists.myProblems : pick(list.name, language));

  async function run(key: string, method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body: unknown, after?: (data: unknown) => void) {
    setBusy(key);
    setError(null);
    const result = await sendJson(method, path, body);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    if (after) after(result.data);
    router.refresh();
    return true;
  }

  const create = () =>
    run("create", "POST", "/api/study-lists", { action: "create", requestId: crypto.randomUUID(), name: name.trim() }, (data) => {
      setName("");
      router.push(listHref((data as { list: StudyListSummaryDto }).list));
    });

  const reorder = async (next: StudyListSummaryDto[]) => {
    const previous = order;
    setOrder(next);
    const ok = await run("order", "PUT", "/api/study-lists", { listIds: next.map((list) => list.id) });
    if (!ok) setOrder(previous);
  };

  const remove = async (list: StudyListSummaryDto) => {
    const ok = await run(`delete:${list.id}`, "DELETE", `/api/study-lists/${list.id}`, undefined);
    if (ok) {
      setConfirming(null);
      setOrder((current) => current.filter((other) => other.id !== list.id));
    }
  };

  const sortable = useSortable({ items: order, keyOf: (list) => list.id!, onReorder: (next) => void reorder(next), disabled: busy != null });

  const row = (list: StudyListSummaryDto) => {
    const title = titleOf(list);
    const drop = list.id ? sortable.indicator(list.id) : null;
    return (
      <li
        key={list.id ?? list.kind}
        {...(list.id ? sortable.rowProps(list.id) : {})}
        className={cn(
          "relative space-y-2 px-4 py-3",
          list.id && sortable.dragging === list.id && "bg-subtle opacity-70",
          dropIndicatorClass(drop),
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {list.id ? (
            <button
              type="button"
              {...sortable.handleProps(list.id)}
              aria-label={t.lists.reorder(title)}
              title={t.lists.reorderHelp}
              className="-ml-2 rounded p-1 text-muted hover:bg-subtle hover:text-fg"
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <span className="-ml-2 w-6" aria-hidden />
          )}
          <span className="min-w-0 flex-1 basis-40">
            <Link href={listHref(list)} className="block truncate font-medium hover:underline">
              {title}
            </Link>
            {list.author && <span className="block truncate text-xs text-muted">{t.lists.by(pick(list.author, language))}</span>}
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {list.followed && !list.active && <Pill tone="warning">{t.lists.paused}</Pill>}
            {list.followed && list.active && (
              <Select
                size="sm"
                value={String(list.share)}
                onValueChange={(value) => void run(`share:${list.id}`, "PATCH", `/api/study-lists/${list.id}`, { share: Number(value) })}
                disabled={busy != null}
                aria-label={`${t.lists.share}: ${title}`}
                title={t.lists.share}
                className="w-20"
              >
                {SHARES.map((share) => (
                  <option key={share} value={String(share)}>
                    {t.lists.shareOption(share)}
                  </option>
                ))}
              </Select>
            )}
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
            {list.followed && (
              <Button
                size="xs"
                variant="ghost"
                className={list.kind === "custom" ? "text-danger" : undefined}
                disabled={busy != null}
                aria-label={`${list.kind === "custom" ? t.lists.deleteList : t.lists.unfollow}: ${title}`}
                onClick={() => {
                  setError(null);
                  setConfirming(list);
                }}
              >
                {list.kind === "custom" ? t.lists.deleteList : t.lists.unfollow}
              </Button>
            )}
          </span>
        </div>
        <ProgressBar
          label={title}
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
    );
  };

  return (
    <div className="space-y-10">
      {error && !confirming && (
        <p role="alert" className="text-sm text-danger">
          {t.lists.errors[error] ?? t.lists.failed}
        </p>
      )}

      <section aria-labelledby="lists-yours" className="space-y-3">
        <h2 id="lists-yours" className="text-lg font-semibold">
          {t.lists.yours}
        </h2>
        <Surface as="ul" className="divide-y divide-border overflow-hidden">
          {row(mine)}
          {order.map(row)}
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

      <section aria-labelledby="lists-builtin" className="space-y-4">
        <div>
          <h2 id="lists-builtin" className="text-lg font-semibold">
            {t.lists.builtinTitle}
          </h2>
          <p className="mt-1 text-sm text-muted">{t.lists.builtinSubtitle}</p>
        </div>
        <AuthorGroups groups={overview.builtinGroups} busy={busy} onFollow={(list) => void run(`follow:${list.builtinId}`, "POST", "/api/study-lists", { action: "follow", requestId: crypto.randomUUID(), builtinId: list.builtinId })} />
      </section>

      <ConfirmDialog
        open={confirming != null}
        title={confirming?.kind === "custom" ? t.lists.deleteTitle : t.lists.unfollowTitle}
        description={confirming?.kind === "custom" ? t.lists.deleteDescription : t.lists.unfollowDescription}
        cancelLabel={t.common.cancel}
        confirmLabel={confirming?.kind === "custom" ? t.lists.deleteList : t.lists.unfollow}
        busy={confirming != null && busy === `delete:${confirming.id}`}
        error={confirming && error ? (t.lists.errors[error] ?? t.lists.failed) : null}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && void remove(confirming)}
      />
    </div>
  );
}

const groupListeners = new Set<() => void>();

/** The stored open-group ids as raw JSON (a stable snapshot), or "[]". */
/** Open groups when this browser cannot store them (private mode, blocked storage). */
let fallbackOpen = "[]";

function openGroupsSnapshot() {
  try {
    return window.localStorage.getItem(OPEN_GROUPS_KEY) ?? fallbackOpen;
  } catch {
    return fallbackOpen;
  }
}

function subscribeOpenGroups(listener: () => void) {
  groupListeners.add(listener);
  const onStorage = (event: StorageEvent) => event.key === OPEN_GROUPS_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    groupListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function storeOpenGroups(ids: string[]) {
  const raw = JSON.stringify(ids);
  try {
    window.localStorage.setItem(OPEN_GROUPS_KEY, raw);
  } catch {
    // Storage is unavailable: the groups still toggle for this visit.
    fallbackOpen = raw;
  }
  groupListeners.forEach((listener) => listener());
}

function parseOpenGroups(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The sticky nav's height, so an open group's header sticks just below it. */
function subscribeNavHeight(listener: () => void) {
  const nav = document.querySelector("body header");
  if (!nav) return () => {};
  const observer = new ResizeObserver(listener);
  observer.observe(nav);
  return () => observer.disconnect();
}
const navHeightSnapshot = () => document.querySelector("body header")?.getBoundingClientRect().height ?? 0;

/**
 * One disclosure per author, collapsed until opened; the browser remembers
 * which are open. An open group's header sticks under the nav while its
 * lists scroll by, so it can be closed from anywhere in it.
 */
function AuthorGroups({ groups, busy, onFollow }: { groups: StudyListAuthorGroupDto[]; busy: string | null; onFollow: (list: StudyListSummaryDto) => void }) {
  const { t, language } = useLanguage();
  // Collapsed on the server and on first paint; then what this browser remembers.
  const openRaw = useSyncExternalStore(subscribeOpenGroups, openGroupsSnapshot, () => "[]");
  const open = useMemo(() => parseOpenGroups(openRaw), [openRaw]);
  const navHeight = useSyncExternalStore(subscribeNavHeight, navHeightSnapshot, () => 0);

  const toggle = (authorId: string) => storeOpenGroups(open.includes(authorId) ? open.filter((id) => id !== authorId) : [...open, authorId]);

  return (
    <Surface className="divide-y divide-border">
      {groups.map((group, index) => {
        const isOpen = open.includes(group.authorId);
        const followed = group.lists.filter((list) => list.followed).length;
        const panelId = `author-${group.authorId}`;
        const name = pick(group.name, language);
        const first = index === 0;
        const last = index === groups.length - 1;
        return (
          <section key={group.authorId} aria-label={name}>
            <h3 className={cn("z-10 bg-surface", isOpen && "sticky", first && "rounded-t-xl", last && !isOpen && "rounded-b-xl")} style={isOpen ? { top: navHeight } : undefined}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(group.authorId)}
                className={cn(
                  "flex w-full items-center gap-4 px-5 py-4 text-left transition-colors",
                  isOpen ? "bg-accent-soft/60 shadow-[inset_0_-1px_0_0_rgb(var(--border))] backdrop-blur" : "bg-surface hover:bg-subtle",
                  first && "rounded-t-xl",
                  last && !isOpen && "rounded-b-xl",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate font-semibold", isOpen && "text-accent")}>{name}</span>
                  <span className="mt-0.5 block text-xs text-muted tabular-nums">{t.lists.groupCount(group.lists.length, followed)}</span>
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted transition-transform duration-200", isOpen && "rotate-180 text-accent")} aria-hidden />
              </button>
            </h3>
            <ol id={panelId} hidden={!isOpen} className={cn("divide-y divide-border", isOpen ? "block" : "hidden", last && "overflow-hidden rounded-b-xl")}>
              {group.lists.map((list, position) => {
                const title = pick(list.name, language);
                const { learned, started, total } = list.progress;
                const percent = total > 0 ? Math.round((learned / total) * 100) : 0;
                const bar = (
                  <>
                    <ProgressBar label={title} valueText={t.lists.progress(learned, started, total)} learned={learned} started={started} total={total} />
                    <span className="w-8 shrink-0 text-right text-xs text-muted tabular-nums">{percent}%</span>
                  </>
                );
                return (
                  <li key={list.builtinId} className="group/row flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-subtle/60">
                    <span className="w-5 shrink-0 text-right text-xs text-muted tabular-nums" aria-hidden>
                      {position + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link href={listHref(list)} className="block truncate text-sm font-medium hover:text-accent">
                        {title}
                      </Link>
                      <span className="mt-0.5 block truncate text-xs text-muted tabular-nums">{t.lists.listMeta(total, learned)}</span>
                      {/* Phones: the bar sits under the name, so the name keeps its width. */}
                      <span className="mt-2 flex items-center gap-2 sm:hidden">{bar}</span>
                    </span>
                    <span className="hidden w-32 shrink-0 items-center gap-2 sm:flex">{bar}</span>
                    <span className="flex shrink-0 justify-end sm:w-24">
                      {list.followed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                          <Check className="h-3.5 w-3.5" aria-hidden />
                          {t.lists.following}
                        </span>
                      ) : (
                        <Button size="xs" variant="secondary" disabled={busy != null} onClick={() => onFollow(list)} aria-label={`${t.lists.follow}: ${title}`}>
                          {busy === `follow:${list.builtinId}` && <Spinner />}
                          {t.lists.follow}
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </Surface>
  );
}

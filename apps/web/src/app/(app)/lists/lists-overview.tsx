"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, GripVertical, Pin } from "lucide-react";
import { STUDY_LIST_NAME_MAX, type StudyListAuthorGroupDto, type StudyListsOverviewDto, type StudyListSummaryDto } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/field";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { pick, sendJson } from "./api";
import { ProgressBar } from "./progress-bar";
import { dropIndicatorClass, useSortable } from "./sortable";

/** localStorage: the author groups the viewer left open. */
const OPEN_GROUPS_KEY = "ankileet.lists.openGroups";

export function listHref(list: StudyListSummaryDto): Route {
  if (list.kind === "my_problems") return "/lists/my-problems" as Route;
  if (list.kind === "builtin") return `/lists/builtin/${list.builtinId}` as Route;
  return `/lists/${list.id}` as Route;
}

/**
 * /lists in two areas: the user's lists (My problems pinned first, the rest
 * reordered by dragging, with Pause, Rename, and Delete or Unfollow in a row
 * menu) and the built-in lists, one accordion item per author. Both use the
 * same row.
 */
export function ListsOverview({ overview }: { overview: StudyListsOverviewDto }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StudyListSummaryDto | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
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

  const rename = async () => {
    if (!renaming || !renaming.name.trim()) return;
    if (await run(`rename:${renaming.id}`, "PATCH", `/api/study-lists/${renaming.id}`, { name: renaming.name.trim() })) setRenaming(null);
  };

  const sortable = useSortable({ items: order, keyOf: (list) => list.id!, onReorder: (next) => void reorder(next), disabled: busy != null || renaming != null });

  const menuFor = (list: StudyListSummaryDto, title: string): MenuItem[] => [
    {
      key: "active",
      label: list.active ? t.lists.pause : t.lists.resume,
      description: list.active ? t.lists.pausedHelp : t.lists.resumeHelp,
      disabled: busy != null,
      onSelect: () => void run(`active:${list.id}`, "PATCH", `/api/study-lists/${list.id}`, { active: !list.active }),
    },
    ...(list.kind === "custom"
      ? [{ key: "rename", label: t.lists.rename, disabled: busy != null, onSelect: () => setRenaming({ id: list.id!, name: title }) }]
      : []),
    {
      key: "remove",
      label: list.kind === "custom" ? t.lists.deleteList : t.lists.unfollow,
      tone: list.kind === "custom" ? ("danger" as const) : ("default" as const),
      disabled: busy != null,
      onSelect: () => {
        setError(null);
        setConfirming(list);
      },
    },
  ];

  const yourRow = (list: StudyListSummaryDto) => {
    const title = titleOf(list);
    const pinned = list.kind === "my_problems";
    const editing = renaming && renaming.id === list.id ? renaming : null;
    const detail = pinned ? (
      t.lists.myProblemsHelp
    ) : (
      <>
        {list.author && <>{pick(list.author, language)}</>}
        {list.author && list.nextUp && " · "}
        {list.nextUp && (
          <a href={list.nextUp.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {t.lists.nextUpLabel(pick(list.nextUp.title, language))}
          </a>
        )}
      </>
    );
    return (
      <ListRow
        key={list.id ?? list.kind}
        list={list}
        title={title}
        rowProps={list.id ? sortable.rowProps(list.id) : undefined}
        className={cn(
          "first:rounded-t-xl last:rounded-b-xl",
          pinned && "bg-subtle/50",
          list.id && sortable.dragging === list.id && "bg-subtle opacity-70",
          list.id ? dropIndicatorClass(sortable.indicator(list.id)) : undefined,
        )}
        lead={
          pinned ? (
            <Pin className="h-4 w-4 text-muted" aria-label={t.lists.pinned} />
          ) : (
            <button
              type="button"
              {...sortable.handleProps(list.id!)}
              aria-label={t.lists.reorder(title)}
              title={t.lists.reorderHelp}
              className="rounded p-1 text-muted hover:bg-subtle hover:text-fg"
            >
              <GripVertical className="h-4 w-4" aria-hidden />
            </button>
          )
        }
        heading={
          editing ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
            >
              <Input
                value={editing.name}
                onChange={(event) => setRenaming({ id: editing.id, name: event.target.value })}
                onKeyDown={(event) => event.key === "Escape" && setRenaming(null)}
                maxLength={STUDY_LIST_NAME_MAX}
                aria-label={t.lists.newListName}
                className="h-8 w-56"
                autoFocus
              />
              <Button type="submit" size="xs" variant="primary" disabled={busy != null || editing.name.trim().length === 0}>
                {busy === `rename:${editing.id}` && <Spinner />}
                {t.common.save}
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setRenaming(null)}>
                {t.common.cancel}
              </Button>
            </form>
          ) : undefined
        }
        badges={list.followed && !list.active ? <Pill tone="warning">{t.lists.paused}</Pill> : null}
        detail={detail}
        trailing={pinned ? null : <Menu label={t.lists.actions(title)} items={menuFor(list, title)} />}
      />
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
        <Surface as="ul" className="divide-y divide-border">
          {yourRow(mine)}
          {order.map(yourRow)}
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

/**
 * One list as a row, the same in Your lists and in an author's lists: a lead
 * (handle, pin, or number), the name with its size and learned count, a
 * detail line, the progress bar with a percentage (under the name on phones),
 * and a trailing action.
 */
function ListRow({
  list,
  title,
  lead,
  heading,
  badges,
  detail,
  trailing,
  className,
  rowProps,
}: {
  list: StudyListSummaryDto;
  title: string;
  lead: React.ReactNode;
  /** Replaces the name link (an inline rename form). */
  heading?: React.ReactNode;
  badges?: React.ReactNode;
  detail?: React.ReactNode;
  trailing: React.ReactNode;
  className?: string;
  rowProps?: Record<string, string>;
}) {
  const { t } = useLanguage();
  const { learned, started, total } = list.progress;
  const percent = total > 0 ? Math.round((learned / total) * 100) : 0;
  const bar = (
    <>
      <ProgressBar label={title} valueText={t.lists.progress(learned, started, total)} learned={learned} started={started} total={total} />
      <span className="w-9 shrink-0 text-right text-xs text-muted tabular-nums">{percent}%</span>
    </>
  );
  return (
    <li {...rowProps} className={cn("flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-subtle/60", className)}>
      <span className="flex w-6 shrink-0 justify-center text-xs text-muted tabular-nums">{lead}</span>
      <span className="min-w-0 flex-1">
        {heading ?? (
          <span className="flex min-w-0 items-center gap-2">
            <Link href={listHref(list)} className="truncate text-sm font-medium hover:text-accent">
              {title}
            </Link>
            {badges}
          </span>
        )}
        <span className="mt-0.5 block truncate text-xs text-muted tabular-nums">{t.lists.listMeta(total, learned)}</span>
        {detail && <span className="mt-0.5 block truncate text-xs text-muted">{detail}</span>}
        {/* Phones: the bar sits under the name, so the name keeps its width. */}
        <span className="mt-2 flex items-center gap-2 sm:hidden">{bar}</span>
      </span>
      <span className="hidden w-32 shrink-0 items-center gap-2 sm:flex">{bar}</span>
      <span className="flex shrink-0 justify-end sm:w-24">{trailing}</span>
    </li>
  );
}

const groupListeners = new Set<() => void>();

/** Open groups when this browser cannot store them (private mode, blocked storage). */
let fallbackOpen = "[]";

/** The stored open-group ids as raw JSON (a stable snapshot), or "[]". */
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
              {group.lists.map((list, position) => (
                <ListRow
                  key={list.builtinId}
                  list={list}
                  title={pick(list.name, language)}
                  lead={<span aria-hidden>{position + 1}</span>}
                  trailing={
                    list.followed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        {t.lists.following}
                      </span>
                    ) : (
                      <Button size="xs" variant="secondary" disabled={busy != null} onClick={() => onFollow(list)} aria-label={`${t.lists.follow}: ${pick(list.name, language)}`}>
                        {busy === `follow:${list.builtinId}` && <Spinner />}
                        {t.lists.follow}
                      </Button>
                    )
                  }
                />
              ))}
            </ol>
          </section>
        );
      })}
    </Surface>
  );
}

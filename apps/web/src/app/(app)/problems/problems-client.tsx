"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown } from "lucide-react";
import type { LeetCodeDifficulty } from "@ankileet/core";
import { isMasteryCandidate } from "@ankileet/core/mastery";
import type {
  ProblemListItemDto,
  ProblemsArchiveResponseDto,
  ProblemsListPayloadDto,
} from "@ankileet/contracts";
import { DifficultyPill, FsrsStatePill, Pill } from "@/components/ui/pill";
import { Surface } from "@/components/ui/surface";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActiveIndicator } from "@/components/ui/motion";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { useLanguage } from "@/components/LanguageProvider";
import { notifyReviewQueueUpdated } from "@/lib/review-queue-event";
import { cn, formatRelative } from "@/lib/utils";
import {
  compareProblems,
  PROBLEM_SORT_DEFAULT_DIR,
  PROBLEM_SORT_KEYS,
  problemsSortSearch,
  type ProblemSort,
  type ProblemSortKey,
} from "./problems-sort";

type FilterState = {
  difficulty: LeetCodeDifficulty | "all";
  state: "all" | "new" | "learning" | "review" | "relearning" | "due" | "not-due" | "ready" | "archived";
  tag: string;
  search: string;
};

/** Due for review: initial learning finished and scheduled at or before now
 *  (legacy captures without a schedule count as due). */
function isProblemDue(problem: Pick<ProblemListItemDto, "enrollment" | "fsrsDue">, nowMs: number) {
  if (problem.enrollment !== "enrolled") return false;
  return !problem.fsrsDue || new Date(problem.fsrsDue).valueOf() <= nowMs;
}

export default function ProblemsPage({
  initialData,
  initialSort,
}: {
  initialData: ProblemsListPayloadDto;
  initialSort: ProblemSort;
}) {
  const { language, t } = useLanguage();
  const router = useRouter();
  const [problems, setProblems] = useState<ProblemListItemDto[]>(
    initialData.problems,
  );
  const [filters, setFilters] = useState<FilterState>({ difficulty: "all", state: "all", tag: "", search: "" });
  const [sort, setSort] = useState<ProblemSort>(initialSort);
  const [dueCount, setDueCount] = useState(initialData.dueCount);
  // The first page is never a cursor page, so the server always sends both.
  const [totalCount, setTotalCount] = useState(initialData.totalCount ?? 0);
  const [archivedCount, setArchivedCount] = useState(initialData.archivedCount ?? 0);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialData.nextCursor,
  );
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(
    () => new Date(initialData.serverNow).getTime(),
  );
  const skippedInitialFetch = useRef(false);

  // "Archived" is a fetch mode, not a client-side filter: the default list
  // endpoint excludes archived problems, so flipping to it refetches. Each
  // fetch returns the whole deck, so search, filters, and sorting run here.
  const showArchived = filters.state === "archived";

  useEffect(() => {
    if (!skippedInitialFetch.current) {
      skippedInitialFetch.current = true;
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setLoadError(null);
      setLoadMoreError(null);
      void (async () => {
      try {
        const params = new URLSearchParams();
        if (showArchived) params.set("archived", "1");
        const res = await fetch(`/api/problems?${params}`, { cache: "no-store" });
        if (res.redirected && new URL(res.url).pathname === "/login") {
          window.location.assign("/login?next=/problems");
          return;
        }
        if (res.status === 401) {
          window.location.assign("/login?next=/problems");
          return;
        }
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("application/json")) {
          throw new Error(`Failed to load problems (${res.status})`);
        }
        const json = await res.json();
        if (!active) return;
        setProblems(json.problems ?? []);
        setDueCount(json.dueCount ?? 0);
        setTotalCount(json.totalCount ?? 0);
        setArchivedCount(json.archivedCount ?? 0);
        setNextCursor(json.nextCursor ?? null);
        setNowMs(new Date(json.serverNow).getTime());
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Failed to load problems");
        }
      } finally {
        if (active) setLoading(false);
      }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [showArchived]);

  // Keep the sort in the URL, so coming back from a problem restores it.
  useEffect(() => {
    window.history.replaceState(null, "", `/problems${problemsSortSearch(sort)}`);
  }, [sort]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const params = new URLSearchParams({ cursor: nextCursor });
      if (showArchived) params.set("archived", "1");
      const res = await fetch(`/api/problems?${params}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.assign("/login?next=/problems");
        return;
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("application/json")) {
        throw new Error(`Failed to load problems (${res.status})`);
      }
      const json = await res.json();
      setProblems((current) => {
        const byId = new Map(current.map((problem) => [problem.id, problem]));
        for (const problem of json.problems ?? []) byId.set(problem.id, problem);
        return [...byId.values()];
      });
      setDueCount(json.dueCount ?? dueCount);
      setTotalCount(json.totalCount ?? totalCount);
      setNextCursor(json.nextCursor ?? null);
      setNowMs(new Date(json.serverNow).getTime());
    } catch (error) {
      setLoadMoreError(error instanceof Error ? error.message : "Failed to load problems");
    } finally {
      setLoadingMore(false);
    }
  }

  const allTags = useMemo(() => {
    const set = new Set<string>();
    problems.forEach((p) => p.topicTags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [problems]);

  const filtered = useMemo(() => {
    let list = [...problems];

    if (filters.difficulty !== "all") {
      list = list.filter((p) => p.difficulty === filters.difficulty);
    }

    switch (filters.state) {
      case "due":
        list = list.filter((p) => isProblemDue(p, nowMs));
        break;
      case "not-due":
        list = list.filter((p) => !isProblemDue(p, nowMs));
        break;
      case "ready":
        list = list.filter((p) => isMasteryCandidate(p));
        break;
      case "archived":
        // Server already returned only archived problems; nothing to narrow.
        break;
      default:
        if (filters.state !== "all") {
          list = list.filter((p) => p.fsrsState === filters.state);
        }
    }

    if (filters.tag) {
      list = list.filter((p) => p.topicTags.includes(filters.tag));
    }

    const q = filters.search.trim().toLowerCase();
    if (q) {
      // Matches the label as shown, so "146" finds "146. LRU Cache".
      list = list.filter((p) =>
        `${p.leetcodeId != null ? `${p.leetcodeId}. ` : ""}${p.title}`.toLowerCase().includes(q),
      );
    }

    return list.sort((a, b) => compareProblems(a, b, sort));
  }, [problems, filters, nowMs, sort]);

  const selectedShown = filtered.filter((p) => selected.has(p.id));
  const allShownSelected = filtered.length > 0 && selectedShown.length === filtered.length;

  const toggleSort = (key: ProblemSortKey) => {
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: PROBLEM_SORT_DEFAULT_DIR[key] }));
  };

  const setStateFilter = (state: FilterState["state"]) => {
    // A selection never carries over between the active and archived lists.
    if ((state === "archived") !== showArchived) {
      setSelected(new Set());
      setBulkError(null);
    }
    setFilters((f) => ({ ...f, state }));
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllShown = () => {
    setSelected((current) => {
      const next = new Set(current);
      for (const p of filtered) {
        if (allShownSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  };

  async function archiveSelected() {
    const ids = selectedShown.map((p) => p.id);
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const res = await fetch("/api/problems/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemIds: ids, archived: !showArchived }),
      });
      if (res.status === 401) {
        router.push("/login?next=/problems");
        return;
      }
      const json = (await res.json().catch(() => null)) as
        | (Partial<ProblemsArchiveResponseDto> & { error?: string })
        | null;
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error === "problem_limit_reached" ? t.problems.limitReached : t.problems.bulkArchiveFailed);
      }
      // The moved problems leave this list either way.
      const moved = new Set(ids);
      setProblems((current) => current.filter((p) => !moved.has(p.id)));
      setTotalCount((count) => Math.max(0, count - ids.length));
      setArchivedCount((count) => Math.max(0, count + (showArchived ? -ids.length : ids.length)));
      setSelected(new Set());
      if (json.dueCount != null) {
        setDueCount(json.dueCount);
        notifyReviewQueueUpdated(json.dueCount);
      }
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : t.problems.bulkArchiveFailed);
    } finally {
      setBulkBusy(false);
    }
  }

  const difficultyOptions: { value: FilterState["difficulty"]; label: string }[] = [
    { value: "all", label: t.problems.all },
    { value: "Easy", label: t.difficulty.Easy },
    { value: "Medium", label: t.difficulty.Medium },
    { value: "Hard", label: t.difficulty.Hard },
  ];
  const stateOptions: { value: FilterState["state"]; label: string }[] = [
    { value: "all", label: t.problems.all },
    { value: "due", label: t.problems.due },
    { value: "new", label: t.fsrs.new },
    { value: "learning", label: t.fsrs.learning },
    { value: "review", label: t.fsrs.review },
    { value: "relearning", label: t.fsrs.relearning },
    { value: "ready", label: t.problems.readyToArchive },
    { value: "archived", label: t.problems.archived },
  ];
  const sortLabels: Record<ProblemSortKey, string> = {
    due: t.problems.nextReviewCol,
    added: t.problems.sortAdded,
    practiced: t.problems.lastPracticedCol,
    number: t.problems.sortNumber,
    title: t.problems.sortTitle,
    difficulty: t.problems.diffCol,
    reps: t.problems.reviewsCol,
    lapses: t.problems.lapsesCol,
    sessions: t.problems.practicedCol,
  };
  const dateFormat = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric" });

  if (loading) {
    return (
      <PageFrame width="wide">
        <Surface className="p-10 text-center">
          <h1 className="text-2xl font-semibold">{t.problems.title}</h1>
          <p className="mt-3 text-sm text-muted">{t.problems.loading}</p>
        </Surface>
      </PageFrame>
    );
  }

  if (loadError) {
    return (
      <PageFrame width="wide">
        <Surface className="p-10 text-center">
          <h1 className="text-2xl font-semibold">{t.problems.title}</h1>
          <p className="mt-3 text-sm text-danger">{loadError}</p>
          <Link href="/login?next=/problems" className="mt-4 inline-flex text-sm font-medium text-accent hover:underline">
            {t.problems.signInAgain}
          </Link>
        </Surface>
      </PageFrame>
    );
  }

  // Once something is archived, keep the list (and its Archived view) reachable.
  if (!problems.length && !showArchived && archivedCount === 0) {
    return (
      <PageFrame width="wide">
        <Surface className="p-10 text-center">
          <h1 className="text-2xl font-semibold">{t.problems.title}</h1>
          <Pill tone="accent" className="mt-3">{t.common.empty}</Pill>
          <p className="mt-3 text-lg font-medium">{t.problems.noProblems}</p>
          <p className="mt-1 text-sm text-muted">
            {t.problems.addFirst}
          </p>
        </Surface>
      </PageFrame>
    );
  }

  const columns: { key: ProblemSortKey | "state"; label: string; help?: string; className: string }[] = [
    { key: "number", label: t.problems.titleCol, className: "" },
    { key: "difficulty", label: t.problems.diffCol, className: "hidden sm:table-cell" },
    { key: "due", label: t.problems.nextReviewCol, className: "" },
    { key: "practiced", label: t.problems.lastPracticedCol, className: "hidden md:table-cell" },
    { key: "sessions", label: t.problems.practicedCol, help: t.problems.practicedHelp, className: "hidden lg:table-cell" },
    { key: "reps", label: t.problems.reviewsCol, help: t.problems.reviewsHelp, className: "hidden md:table-cell" },
    { key: "lapses", label: t.problems.lapsesCol, help: t.problems.lapsesHelp, className: "hidden md:table-cell" },
    { key: "state", label: t.problems.stateCol, help: t.problems.stateHelp, className: "hidden sm:table-cell" },
    { key: "added", label: t.problems.addedCol, className: "hidden xl:table-cell" },
  ];

  return (
    <PageFrame width="wide" className="space-y-6">
      <PageHeader
        title={t.problems.title}
        description={t.problems.summary(filtered.length, totalCount, dueCount)}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Difficulty tabs */}
        <div className="flex rounded-lg border border-border bg-subtle p-0.5">
          {difficultyOptions.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, difficulty: o.value }))}
              className={cn(
                "relative isolate h-8 rounded-lg px-3 text-xs font-medium transition-colors",
                filters.difficulty === o.value
                  ? "text-fg"
                  : "text-muted hover:bg-surface/60 hover:text-fg",
              )}
            >
              {filters.difficulty === o.value && (
                <ActiveIndicator
                  layoutId="problem-difficulty-active"
                  className="absolute inset-0 z-0 rounded-lg bg-surface shadow-card"
                />
              )}
              <span className="relative z-10">{o.label}</span>
            </button>
          ))}
        </div>

        {/* State filter */}
        <Select
          aria-label={t.problems.filterStateAria}
          value={filters.state}
          onValueChange={(value) => setStateFilter(value as FilterState["state"])}
          className="w-auto"
        >
          {stateOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        {/* Tag filter */}
        <Select
          aria-label={t.problems.filterTagAria}
          value={filters.tag}
          onValueChange={(value) => setFilters((f) => ({ ...f, tag: value }))}
          className="w-auto"
        >
          <option value="">{t.problems.allTags}</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </Select>

        {/* Search */}
        <Input
          type="search"
          aria-label={t.problems.searchAria}
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder={t.problems.search}
          className="w-auto"
        />

        {/* Sort */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <span className="text-xs text-muted">{t.problems.sortBy}</span>
          <Select
            aria-label={t.problems.sortBy}
            value={sort.key}
            onValueChange={(value) => {
              const key = value as ProblemSortKey;
              setSort({ key, dir: PROBLEM_SORT_DEFAULT_DIR[key] });
            }}
            className="w-auto"
          >
            {PROBLEM_SORT_KEYS.map((key) => (
              <option key={key} value={key}>{sortLabels[key]}</option>
            ))}
          </Select>
          <Button
            size="icon"
            aria-label={sort.dir === "asc" ? t.problems.sortAscending : t.problems.sortDescending}
            title={sort.dir === "asc" ? t.problems.sortAscending : t.problems.sortDescending}
            onClick={() => setSort((prev) => ({ ...prev, dir: prev.dir === "asc" ? "desc" : "asc" }))}
          >
            {sort.dir === "asc"
              ? <ArrowUpNarrowWide aria-hidden className="h-4 w-4" />
              : <ArrowDownWideNarrow aria-hidden className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {nextCursor && (
        <p
          className="rounded-lg border border-accent-solid/20 bg-accent-soft px-3 py-2 text-xs text-muted"
          role="status"
        >
          {t.problems.partialResults(problems.length, totalCount)}
        </p>
      )}

      {/* Bulk actions */}
      {(selectedShown.length > 0 || bulkError) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-solid/20 bg-accent-soft px-3 py-2">
          {selectedShown.length > 0 && (
            <>
              <span className="text-sm font-medium tabular-nums">{t.problems.selectedCount(selectedShown.length)}</span>
              <Button size="sm" variant="primary" onClick={() => void archiveSelected()} disabled={bulkBusy}>
                {bulkBusy && <Spinner />}
                {showArchived
                  ? t.problems.unarchiveSelected(selectedShown.length)
                  : t.problems.archiveSelected(selectedShown.length)}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={bulkBusy}>
                {t.problems.clearSelection}
              </Button>
            </>
          )}
          {bulkError && <p className="text-xs text-danger" role="alert">{bulkError}</p>}
        </div>
      )}

      {/* Table */}
      <Surface className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="w-10 py-2.5 pl-4 pr-0">
                  <input
                    type="checkbox"
                    name="select-all"
                    aria-label={t.problems.selectAll}
                    checked={allShownSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedShown.length > 0 && !allShownSelected;
                    }}
                    onChange={toggleAllShown}
                    disabled={filtered.length === 0 || bulkBusy}
                    className="h-4 w-4 cursor-pointer rounded border-border accent-accent align-middle"
                  />
                </th>
                {columns.map((col) => {
                  const sortable = col.key !== "state";
                  const isSorted = sort.key === col.key;
                  return (
                    <th
                      key={col.key}
                      className={cn("px-4 py-2.5 font-medium", col.className)}
                      aria-sort={isSorted ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                      title={col.help}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key as ProblemSortKey)}
                          className="inline-flex select-none items-center gap-1 font-medium transition hover:text-fg"
                        >
                          {col.label}
                          {isSorted && <ChevronDown aria-hidden className={cn("h-3 w-3", sort.dir === "asc" && "rotate-180")} />}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1">{col.label}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isDue = isProblemDue(p, nowMs);
                const isSelected = selected.has(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={(e) => {
                      // The title link navigates itself (and opens new tabs); a drag that selects text is not a click.
                      if ((e.target as HTMLElement).closest("a") || !window.getSelection()?.isCollapsed) return;
                      router.push(`/problems/${p.id}`);
                    }}
                    className={cn(
                      "cursor-pointer border-b border-border/50 transition-colors hover:bg-subtle/50",
                      isSelected && "bg-subtle/70",
                    )}
                  >
                    {/* Selecting never reaches a click handler on the row (which may open the problem). */}
                    <td className="w-10 py-0 pl-4 pr-0" onClick={(e) => e.stopPropagation()}>
                      {/* The label widens the hit area around the small checkbox. */}
                      <label className="flex min-h-10 cursor-pointer items-center">
                        <input
                          type="checkbox"
                          name="selected-problems"
                          value={p.id}
                          aria-label={t.problems.selectRow(p.title)}
                          checked={isSelected}
                          onChange={() => toggleSelected(p.id)}
                          disabled={bulkBusy}
                          className="h-4 w-4 cursor-pointer rounded border-border accent-accent"
                        />
                      </label>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/problems/${p.id}`}
                        className="block font-medium hover:text-accent transition-colors"
                      >
                        <div className="truncate max-w-[320px]">
                          {p.leetcodeId != null && (
                            <span className="text-muted tabular-nums">{p.leetcodeId}. </span>
                          )}
                          {p.title}
                        </div>
                        {p.topicTags.length > 0 && (
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            {p.topicTags.map((t) => `#${t}`).join("  ")}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5">
                      <DifficultyPill difficulty={p.difficulty} language={language} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          isDue ? "text-accent font-medium" : "text-muted",
                        )}
                      >
                        {p.enrollment === "awaiting_initial"
                          ? t.common.notScheduled
                          : isDue && p.fsrsReps > 0
                            ? t.common.now
                            : formatRelative(p.fsrsDue, nowMs)}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-4 py-2.5 text-xs tabular-nums text-muted">
                      {formatRelative(p.lastPracticedAt, nowMs)}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-2.5 text-xs tabular-nums">{p.practiceCount}</td>
                    <td className="hidden md:table-cell px-4 py-2.5 text-xs tabular-nums">{p.fsrsReps}</td>
                    <td className={cn("hidden md:table-cell px-4 py-2.5 text-xs tabular-nums", p.fsrsLapses > 0 ? "text-danger" : "text-muted")}>
                      {p.fsrsLapses}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5">
                      <FsrsStatePill state={p.fsrsState} language={language} />
                    </td>
                    <td className="hidden xl:table-cell whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-muted">
                      {dateFormat.format(new Date(p.createdAt))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          showArchived && problems.length === 0 ? (
            <EmptyState title={t.problems.noArchived} description={t.problems.noArchivedDescription} />
          ) : filters.state === "ready" ? (
            <EmptyState title={t.problems.noReady} description={t.problems.noReadyDescription} />
          ) : (
            <EmptyState title={t.problems.noMatches} description={t.problems.noMatchesDescription} />
          )
        )}

        {nextCursor && (
          <div className="border-t border-border/50 px-4 py-3 text-center">
            <Button size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? t.problems.loadingMore : t.problems.loadMore}
            </Button>
            {loadMoreError && (
              <p className="mt-2 text-xs text-danger" role="alert">{loadMoreError}</p>
            )}
          </div>
        )}
      </Surface>
    </PageFrame>
  );
}

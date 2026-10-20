"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import type { StudyListDetailDto, StudyListEntryDto, StudyListEntryState } from "@ankileet/contracts";
import { useLanguage } from "@/components/LanguageProvider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { DifficultyPill, Pill } from "@/components/ui/pill";
import { Spinner } from "@/components/ui/spinner";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { pick, sendJson } from "./api";

const STATE_TONE: Record<StudyListEntryState, "neutral" | "warning" | "accent" | "success"> = {
  not_started: "neutral",
  attempted_before: "warning",
  in_progress: "accent",
  learned: "success",
  archived: "neutral",
};

const LEARNED = new Set<StudyListEntryState>(["learned", "archived"]);

/**
 * Every entry of a list. Built-in lists show chapters and sections (the
 * section's pattern included); custom lists can be reordered and trimmed;
 * any list can feed one of the user's custom lists ("add mode").
 */
export function ListEntries({ detail }: { detail: StudyListDetailDto }) {
  const { t, language } = useLanguage();
  const router = useRouter();
  const [entries, setEntries] = useState(detail.entries);
  const [seeded, setSeeded] = useState(detail.entries);
  if (seeded !== detail.entries) {
    // A router.refresh() handed down newer entries.
    setSeeded(detail.entries);
    setEntries(detail.entries);
  }
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const { list } = detail;
  const editable = list.kind === "custom";
  const addTargets = detail.customLists.filter((custom) => custom.id !== list.id);
  const nextKey = list.nextUp?.key ?? null;

  async function addToTarget(entry: StudyListEntryDto) {
    setBusy(`add:${entry.key}`);
    setError(null);
    // A problem in the deck is added by id; one only in a built-in list, by slug.
    const body = entry.problemId ? { source: "problem", problemId: entry.problemId } : { source: "builtin", slug: entry.slug };
    const result = await sendJson("POST", `/api/study-lists/${target}/items`, body);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setAdded((current) => new Set(current).add(`${target}:${entry.slug}`));
  }

  async function move(index: number, delta: -1 | 1) {
    const order = [...entries];
    const [entry] = order.splice(index, 1);
    order.splice(index + delta, 0, entry!);
    setEntries(order);
    setBusy(`move:${entry!.key}`);
    setError(null);
    const result = await sendJson("PUT", `/api/study-lists/${list.id}/items`, { itemIds: order.map((item) => item.itemId) });
    setBusy(null);
    if (!result.ok) {
      setEntries(entries);
      return setError(result.error);
    }
    router.refresh();
  }

  async function remove(entry: StudyListEntryDto) {
    setBusy(`remove:${entry.key}`);
    setError(null);
    const result = await sendJson("DELETE", `/api/study-lists/${list.id}/items/${entry.itemId}`);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setEntries((current) => current.filter((item) => item.key !== entry.key));
    router.refresh();
  }

  const row = (entry: StudyListEntryDto, index: number) => (
    <EntryRow
      key={entry.key}
      entry={entry}
      next={entry.key === nextKey}
      actions={
        <>
          {target && (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`${t.lists.add}: ${pick(entry.title, language)}`}
              disabled={busy != null || added.has(`${target}:${entry.slug}`)}
              onClick={() => void addToTarget(entry)}
            >
              {busy === `add:${entry.key}` ? <Spinner /> : added.has(`${target}:${entry.slug}`) ? <Check className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            </Button>
          )}
          {editable && (
            <>
              <Button size="icon" variant="ghost" aria-label={t.lists.moveUp} disabled={busy != null || index === 0} onClick={() => void move(index, -1)}>
                <ChevronUp className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t.lists.moveDown} disabled={busy != null || index === entries.length - 1} onClick={() => void move(index, 1)}>
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t.lists.remove} disabled={busy != null} onClick={() => void remove(entry)}>
                {busy === `remove:${entry.key}` ? <Spinner /> : <X className="h-4 w-4" aria-hidden />}
              </Button>
            </>
          )}
        </>
      }
    />
  );

  return (
    <div className="space-y-4">
      {addTargets.length > 0 && entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">{t.lists.addToLabel}</span>
          <Select value={target} onValueChange={setTarget} aria-label={t.lists.addTo} className="w-56">
            <option value="">{t.lists.addTo}</option>
            {addTargets.map((custom) => (
              <option key={custom.id} value={custom.id}>
                {custom.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t.lists.errors[error] ?? t.lists.failed}
        </p>
      )}
      {entries.length === 0 ? (
        <Surface>
          <EmptyState title={t.lists.empty} description={list.kind === "my_problems" ? t.lists.emptyMine : t.lists.emptyCustom} />
        </Surface>
      ) : detail.sections.length > 0 ? (
        <Chapters detail={detail} entries={entries} row={row} />
      ) : (
        <Surface as="ul" className="divide-y divide-border overflow-hidden">
          {entries.map(row)}
        </Surface>
      )}
    </div>
  );
}

/** Built-in lists: chapters as disclosure rows (the first open), sections inside. */
function Chapters({
  detail,
  entries,
  row,
}: {
  detail: StudyListDetailDto;
  entries: StudyListEntryDto[];
  row: (entry: StudyListEntryDto, index: number) => React.ReactNode;
}) {
  const { t, language } = useLanguage();
  const bySection = useMemo(() => {
    const map = new Map<string, { entry: StudyListEntryDto; index: number }[]>();
    entries.forEach((entry, index) => map.set(entry.sectionId!, [...(map.get(entry.sectionId!) ?? []), { entry, index }]));
    return map;
  }, [entries]);
  const nextSection = detail.list.nextUp?.sectionId ?? null;

  return (
    <div className="space-y-3">
      {detail.chapters.map((chapter) => {
        const sections = detail.sections.filter((section) => section.chapterId === chapter.id);
        const chapterEntries = sections.flatMap((section) => bySection.get(section.id) ?? []);
        const learned = new Set(chapterEntries.filter(({ entry }) => LEARNED.has(entry.state)).map(({ entry }) => entry.slug)).size;
        const total = new Set(chapterEntries.map(({ entry }) => entry.slug)).size;
        const holdsNext = sections.some((section) => section.id === nextSection);
        return (
          <Surface as="details" key={chapter.id} className="group overflow-hidden" open={holdsNext || undefined}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-subtle">
              <span className="flex items-center gap-2 font-medium">
                <ChevronDown className="h-4 w-4 -rotate-90 text-muted transition group-open:rotate-0" aria-hidden />
                {pick(chapter.title, language)}
              </span>
              <span className="text-xs text-muted tabular-nums">{t.lists.sectionProgress(learned, total)}</span>
            </summary>
            <div className="divide-y divide-border border-t border-border">
              {sections.map((section) => {
                const items = bySection.get(section.id) ?? [];
                if (items.length === 0) return null;
                const sectionLearned = new Set(items.filter(({ entry }) => LEARNED.has(entry.state)).map(({ entry }) => entry.slug)).size;
                const showTitle = section.id !== chapter.id;
                return (
                  <section key={section.id} aria-label={pick(section.title, language)}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-subtle/60 px-4 py-2">
                      {showTitle && <h3 className="text-sm font-medium">{pick(section.title, language)}</h3>}
                      <span className="text-xs text-muted">{pick(section.pattern.name, language)}</span>
                      {section.optional && <Pill>{t.lists.levels.optional}</Pill>}
                      <span className="ml-auto text-xs text-muted tabular-nums">{t.lists.sectionProgress(sectionLearned, new Set(items.map(({ entry }) => entry.slug)).size)}</span>
                    </div>
                    <ul className="divide-y divide-border">{items.map(({ entry, index }) => row(entry, index))}</ul>
                  </section>
                );
              })}
            </div>
          </Surface>
        );
      })}
    </div>
  );
}

function EntryRow({ entry, next, actions }: { entry: StudyListEntryDto; next: boolean; actions: React.ReactNode }) {
  const { t, language } = useLanguage();
  const title = pick(entry.title, language);
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5", next && "bg-accent-soft/50")}>
      <span className="w-12 shrink-0 text-xs text-muted tabular-nums">{entry.leetcodeId ?? ""}</span>
      <span className="min-w-0 flex-1">
        {entry.problemId ? (
          <Link href={`/problems/${entry.problemId}` as Route} className="text-sm font-medium hover:underline">
            {title}
          </Link>
        ) : (
          <a href={entry.url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">
            {title}
          </a>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {next && <Pill tone="accent">{t.lists.nextUp}</Pill>}
        {entry.level && entry.level !== "core" && <Pill>{t.lists.levels[entry.level]}</Pill>}
        {entry.paidOnly && <Pill tone="warning">{t.lists.premium}</Pill>}
        <DifficultyPill difficulty={entry.difficulty} language={language} />
        {entry.state !== "not_started" && <Pill tone={STATE_TONE[entry.state]}>{t.lists.states[entry.state]}</Pill>}
        {entry.rating != null && <span className="text-xs text-muted tabular-nums">{t.lists.ratingLabel(entry.rating)}</span>}
      </span>
      <span className="flex items-center gap-1">
        {entry.problemId && (
          <a href={entry.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
            LeetCode
          </a>
        )}
        {actions}
      </span>
    </li>
  );
}

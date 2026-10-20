import type {
  ProblemStudyListsDto,
  StudyListDetailDto,
  StudyListEntryDto,
  StudyListEntryState,
  StudyListProgressDto,
  StudyListsOverviewDto,
  StudyListSummaryDto,
} from "@ankileet/contracts";
import { getDb, schema, type StudyList, type StudyListItem } from "@ankileet/db";
import { and, asc, eq } from "drizzle-orm";
import type { DbTransaction } from "../practice-sessions/store";
import { builtinLists, getBuiltinList, type BuiltinList } from "./builtin";
import { patternName } from "./patterns";

type Db = ReturnType<typeof getDb> | DbTransaction;

export const MY_PROBLEMS_NAME = { en: "My problems", zh: "我的题目" } as const;
/** The URL id of My problems, which has no row. */
export const MY_PROBLEMS_ID = "my-problems";

type DeckProblem = {
  id: string;
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  leetcodeId: number | null;
  enrollment: "enrolled" | "awaiting_initial";
  archivedAt: Date | null;
  createdAt: Date;
};

/** The user's deck by slug, and every slug known attempted outside it. */
type PracticeIndex = { problems: Map<string, DeckProblem>; attempted: Set<string> };

async function loadPracticeIndex(db: Db, userId: string): Promise<PracticeIndex> {
  const p = schema.problems;
  const [problems, history] = await Promise.all([
    db
      .select({
        id: p.id,
        slug: p.leetcodeSlug,
        title: p.title,
        difficulty: p.difficulty,
        leetcodeId: p.leetcodeId,
        enrollment: p.enrollment,
        archivedAt: p.archivedAt,
        createdAt: p.createdAt,
      })
      .from(p)
      .where(eq(p.userId, userId)),
    db.select({ slug: schema.attemptHistory.slug }).from(schema.attemptHistory).where(eq(schema.attemptHistory.userId, userId)),
  ]);
  return { problems: new Map(problems.map((row) => [row.slug, row])), attempted: new Set(history.map((row) => row.slug)) };
}

function stateOf(index: PracticeIndex, slug: string): { state: StudyListEntryState; problemId: string | null } {
  const problem = index.problems.get(slug);
  if (!problem) return { state: index.attempted.has(slug) ? "attempted_before" : "not_started", problemId: null };
  if (problem.enrollment === "awaiting_initial") return { state: "in_progress", problemId: problem.id };
  return { state: problem.archivedAt ? "archived" : "learned", problemId: problem.id };
}

export const leetcodeProblemUrl = (slug: string) => `https://leetcode.com/problems/${slug}/`;

function builtinEntries(list: BuiltinList, index: PracticeIndex): StudyListEntryDto[] {
  return list.items.map((item) => ({
    key: `${item.sectionId}/${item.slug}`,
    itemId: null,
    slug: item.slug,
    leetcodeId: Number(item.frontendId),
    title: item.title,
    difficulty: item.difficulty,
    url: leetcodeProblemUrl(item.slug),
    paidOnly: item.paidOnly,
    rating: item.rating,
    level: item.level,
    sectionId: item.sectionId,
    ...stateOf(index, item.slug),
  }));
}

function customEntries(items: readonly StudyListItem[], index: PracticeIndex): StudyListEntryDto[] {
  return items.map((item) => ({
    key: item.id,
    itemId: item.id,
    slug: item.slug,
    leetcodeId: item.leetcodeId,
    title: { en: item.title, zh: item.titleZh ?? item.title },
    difficulty: item.difficulty,
    url: leetcodeProblemUrl(item.slug),
    paidOnly: null,
    rating: null,
    level: null,
    sectionId: null,
    ...stateOf(index, item.slug),
  }));
}

/** My problems: the deck's problems in no other list, newest first. */
function myProblemsEntries(index: PracticeIndex, memberSlugs: ReadonlySet<string>): StudyListEntryDto[] {
  return [...index.problems.values()]
    .filter((problem) => !memberSlugs.has(problem.slug))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((problem) => ({
      key: problem.id,
      itemId: null,
      slug: problem.slug,
      leetcodeId: problem.leetcodeId,
      title: { en: problem.title, zh: problem.title },
      difficulty: problem.difficulty,
      url: leetcodeProblemUrl(problem.slug),
      paidOnly: null,
      rating: null,
      level: null,
      sectionId: null,
      ...stateOf(index, problem.slug),
    }));
}

const STARTED: ReadonlySet<StudyListEntryState> = new Set(["in_progress", "learned", "archived"]);
const LEARNED: ReadonlySet<StudyListEntryState> = new Set(["learned", "archived"]);

function progressOf(entries: readonly StudyListEntryDto[]): StudyListProgressDto {
  const bySlug = new Map(entries.map((entry) => [entry.slug, entry.state]));
  let started = 0;
  let learned = 0;
  for (const state of bySlug.values()) {
    if (STARTED.has(state)) started += 1;
    if (LEARNED.has(state)) learned += 1;
  }
  return { total: bySlug.size, started, learned };
}

function nextUpOf(entries: readonly StudyListEntryDto[]) {
  return entries.find((entry) => entry.state === "not_started" || entry.state === "attempted_before") ?? null;
}

type UserLists = { rows: StudyList[]; itemsByList: Map<string, StudyListItem[]> };

async function loadUserLists(db: Db, userId: string): Promise<UserLists> {
  const l = schema.studyLists;
  const i = schema.studyListItems;
  const [rows, items] = await Promise.all([
    db.select().from(l).where(eq(l.userId, userId)).orderBy(asc(l.position), asc(l.createdAt), asc(l.id)),
    db.select().from(i).where(eq(i.userId, userId)).orderBy(asc(i.listId), asc(i.position), asc(i.id)),
  ]);
  const itemsByList = new Map<string, StudyListItem[]>();
  for (const item of items) itemsByList.set(item.listId, [...(itemsByList.get(item.listId) ?? []), item]);
  return { rows, itemsByList };
}

/** Slugs in any of the user's lists other than My problems. */
function memberSlugsOf({ rows, itemsByList }: UserLists): Set<string> {
  const slugs = new Set<string>();
  for (const row of rows) {
    if (row.kind === "custom") for (const item of itemsByList.get(row.id) ?? []) slugs.add(item.slug);
    else for (const item of getBuiltinList(row.builtinId!)?.items ?? []) slugs.add(item.slug);
  }
  return slugs;
}

function summaryOf(
  base: Pick<StudyListSummaryDto, "kind" | "name" | "author" | "sourceUrl" | "builtinId">,
  row: StudyList | null,
  entries: readonly StudyListEntryDto[],
): StudyListSummaryDto {
  return {
    ...base,
    id: row?.id ?? null,
    followed: row != null,
    active: row?.active ?? false,
    share: row?.share ?? 1,
    progress: progressOf(entries),
    nextUp: nextUpOf(entries),
  };
}

const builtinBase = (list: BuiltinList) => ({
  kind: "builtin" as const,
  name: list.name,
  author: list.author,
  sourceUrl: list.sourceUrl,
  builtinId: list.id,
});

const customBase = (row: StudyList) => ({
  kind: "custom" as const,
  name: { en: row.name!, zh: row.name! },
  author: null,
  sourceUrl: null,
  builtinId: null,
});

const myProblemsBase = { kind: "my_problems" as const, name: MY_PROBLEMS_NAME, author: null, sourceUrl: null, builtinId: null };

/** A user list row with its entries; a followed list whose built-in data is gone is skipped. */
function rowEntries(row: StudyList, lists: UserLists, index: PracticeIndex) {
  if (row.kind === "custom") return { base: customBase(row), entries: customEntries(lists.itemsByList.get(row.id) ?? [], index) };
  const builtin = getBuiltinList(row.builtinId!);
  return builtin ? { base: builtinBase(builtin), entries: builtinEntries(builtin, index) } : null;
}

/** /lists: My problems, the user's lists in order, and every built-in list. */
export async function loadStudyListsOverview(userId: string): Promise<StudyListsOverviewDto> {
  const db = getDb();
  const [index, lists] = await Promise.all([loadPracticeIndex(db, userId), loadUserLists(db, userId)]);
  const mine = myProblemsEntries(index, memberSlugsOf(lists));
  const followed = new Map(lists.rows.filter((row) => row.kind === "builtin").map((row) => [row.builtinId!, row]));
  return {
    lists: [
      summaryOf(myProblemsBase, null, mine),
      ...lists.rows.flatMap((row) => {
        const resolved = rowEntries(row, lists, index);
        return resolved ? [summaryOf(resolved.base, row, resolved.entries)] : [];
      }),
    ],
    builtin: builtinLists().map((list) => summaryOf(builtinBase(list), followed.get(list.id) ?? null, builtinEntries(list, index))),
  };
}

export type StudyListRef = { kind: "my_problems" } | { kind: "list"; id: string } | { kind: "builtin"; builtinId: string };

/** One list with every entry; null when it does not exist or is not the user's. */
export async function loadStudyListDetail(userId: string, ref: StudyListRef, db: Db = getDb()): Promise<StudyListDetailDto | null> {
  const [index, lists] = await Promise.all([loadPracticeIndex(db, userId), loadUserLists(db, userId)]);
  const customLists = lists.rows.filter((row) => row.kind === "custom").map((row) => ({ id: row.id, name: row.name! }));
  const empty = { chapters: [], sections: [], excludedCount: 0, customLists };

  if (ref.kind === "my_problems") {
    const entries = myProblemsEntries(index, memberSlugsOf(lists));
    return { ...empty, list: summaryOf(myProblemsBase, null, entries), entries };
  }

  const row = ref.kind === "list" ? lists.rows.find((candidate) => candidate.id === ref.id) : lists.rows.find((candidate) => candidate.kind === "builtin" && candidate.builtinId === ref.builtinId);
  if (ref.kind === "list" && !row) return null;
  if (row?.kind === "custom") {
    const entries = customEntries(lists.itemsByList.get(row.id) ?? [], index);
    return { ...empty, list: summaryOf(customBase(row), row, entries), entries };
  }
  const builtin = getBuiltinList(row?.builtinId ?? (ref.kind === "builtin" ? ref.builtinId : ""));
  if (!builtin) return null;
  const entries = builtinEntries(builtin, index);
  return {
    list: summaryOf(builtinBase(builtin), row ?? null, entries),
    chapters: builtin.chapters,
    sections: builtin.sections.map((section) => ({ ...section, pattern: { id: section.pattern, name: patternName(section.pattern) } })),
    entries,
    excludedCount: builtin.excluded.filter((entry) => entry.reason === "leetcode_cn_only").length,
    customLists,
  };
}

/** The lists a problem of the deck belongs to, and the custom lists it could join. */
export async function loadProblemStudyLists(userId: string, problemId: string): Promise<ProblemStudyListsDto | null> {
  const db = getDb();
  const p = schema.problems;
  const [problem] = await db.select({ slug: p.leetcodeSlug }).from(p).where(and(eq(p.id, problemId), eq(p.userId, userId))).limit(1);
  if (!problem) return null;
  const lists = await loadUserLists(db, userId);
  const contains = (row: StudyList) =>
    row.kind === "custom"
      ? (lists.itemsByList.get(row.id) ?? []).some((item) => item.slug === problem.slug)
      : (getBuiltinList(row.builtinId!)?.items ?? []).some((item) => item.slug === problem.slug);
  const memberRows = lists.rows.filter(contains);
  return {
    slug: problem.slug,
    memberOf:
      memberRows.length === 0
        ? [{ id: null, kind: "my_problems", name: MY_PROBLEMS_NAME, builtinId: null }]
        : memberRows.flatMap((row): ProblemStudyListsDto["memberOf"] => {
            if (row.kind === "custom") return [{ id: row.id, kind: "custom", name: customBase(row).name, builtinId: null }];
            const builtin = getBuiltinList(row.builtinId!);
            return builtin ? [{ id: row.id, kind: "builtin", name: builtin.name, builtinId: builtin.id }] : [];
          }),
    customLists: lists.rows
      .filter((row) => row.kind === "custom")
      .map((row) => ({ id: row.id, name: row.name!, contains: contains(row) })),
  };
}

export type ActiveListCandidates = {
  id: string;
  kind: "custom" | "builtin";
  builtinId: string | null;
  name: { en: string; zh: string };
  share: number;
  /** Every entry, for attributing recent first practices to the list. */
  slugs: ReadonlySet<string>;
  /** Entries not started yet (attempted-before included), in list order, one per slug. */
  candidates: StudyListEntryDto[];
  /** Pattern per section (built-in lists only). */
  sectionPatterns: ReadonlyMap<string, { id: string; name: { en: string; zh: string } }>;
};

/** The user's active lists in their order, with what each could offer next. */
export async function loadActiveListCandidates(userId: string, db: Db = getDb()): Promise<ActiveListCandidates[]> {
  const [index, lists] = await Promise.all([loadPracticeIndex(db, userId), loadUserLists(db, userId)]);
  return lists.rows
    .filter((row) => row.active)
    .flatMap((row) => {
      const resolved = rowEntries(row, lists, index);
      if (!resolved) return [];
      const builtin = row.kind === "builtin" ? getBuiltinList(row.builtinId!) : null;
      const seen = new Set<string>();
      const candidates = resolved.entries.filter(
        (entry) => (entry.state === "not_started" || entry.state === "attempted_before") && !seen.has(entry.slug) && seen.add(entry.slug),
      );
      return [
        {
          id: row.id,
          kind: row.kind,
          builtinId: row.builtinId,
          name: resolved.base.name,
          share: row.share,
          slugs: new Set(resolved.entries.map((entry) => entry.slug)),
          candidates,
          sectionPatterns: new Map(
            (builtin?.sections ?? []).map((section) => [section.id, { id: section.pattern, name: patternName(section.pattern) }]),
          ),
        },
      ];
    });
}

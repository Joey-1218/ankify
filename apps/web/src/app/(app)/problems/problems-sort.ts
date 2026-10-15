import type { ProblemListItemDto } from "@ankileet/contracts";

/** Sort keys of the problems list, each with the direction it starts in. */
export const PROBLEM_SORT_DEFAULT_DIR = {
  due: "asc",
  added: "desc",
  practiced: "desc",
  number: "asc",
  title: "asc",
  difficulty: "asc",
  reps: "desc",
  lapses: "desc",
  sessions: "desc",
} as const satisfies Record<string, SortDir>;

export type SortDir = "asc" | "desc";
export type ProblemSortKey = keyof typeof PROBLEM_SORT_DEFAULT_DIR;
export type ProblemSort = { key: ProblemSortKey; dir: SortDir };

export const PROBLEM_SORT_KEYS = Object.keys(PROBLEM_SORT_DEFAULT_DIR) as ProblemSortKey[];
export const DEFAULT_PROBLEM_SORT: ProblemSort = { key: "due", dir: "asc" };

const DIFFICULTY_ORDER = { Easy: 1, Medium: 2, Hard: 3 } as const;

type SortableProblem = Pick<
  ProblemListItemDto,
  | "id"
  | "title"
  | "leetcodeId"
  | "difficulty"
  | "enrollment"
  | "fsrsDue"
  | "fsrsReps"
  | "fsrsLapses"
  | "lastPracticedAt"
  | "practiceCount"
  | "createdAt"
>;

const time = (iso: string | null) => (iso ? Date.parse(iso) : null);

function sortValue(problem: SortableProblem, key: ProblemSortKey): number | string | null {
  switch (key) {
    case "due":
      // A problem still in its first practice has no review scheduled yet.
      return problem.enrollment === "awaiting_initial" ? null : time(problem.fsrsDue) ?? 0;
    case "added":
      return time(problem.createdAt);
    case "practiced":
      return time(problem.lastPracticedAt);
    case "number":
      return problem.leetcodeId;
    case "title":
      return problem.title;
    case "difficulty":
      return DIFFICULTY_ORDER[problem.difficulty] ?? 2;
    case "reps":
      return problem.fsrsReps;
    case "lapses":
      return problem.fsrsLapses;
    case "sessions":
      return problem.practiceCount;
  }
}

/** Missing values (unscheduled, never practiced, no number) sort last in both
 *  directions; ties fall back to the id so the order is stable. */
export function compareProblems(a: SortableProblem, b: SortableProblem, sort: ProblemSort) {
  const av = sortValue(a, sort.key);
  const bv = sortValue(b, sort.key);
  if (av === null || bv === null) {
    if (av !== bv) return av === null ? 1 : -1;
  } else {
    const order =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : (av as number) - (bv as number);
    if (order !== 0) return sort.dir === "asc" ? order : -order;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Reads `?sort=&dir=`; unknown values fall back to the default sort and a
 *  missing direction to the key's own default. */
export function parseProblemsSort(params: { sort?: string | string[]; dir?: string | string[] }): ProblemSort {
  const key = first(params.sort);
  if (!key || !(PROBLEM_SORT_KEYS as string[]).includes(key)) return DEFAULT_PROBLEM_SORT;
  const sortKey = key as ProblemSortKey;
  const dir = first(params.dir);
  return { key: sortKey, dir: dir === "asc" || dir === "desc" ? dir : PROBLEM_SORT_DEFAULT_DIR[sortKey] };
}

/** The query string for a sort: empty for the default sort. */
export function problemsSortSearch(sort: ProblemSort) {
  if (sort.key === DEFAULT_PROBLEM_SORT.key && sort.dir === DEFAULT_PROBLEM_SORT.dir) return "";
  return `?${new URLSearchParams({ sort: sort.key, dir: sort.dir })}`;
}

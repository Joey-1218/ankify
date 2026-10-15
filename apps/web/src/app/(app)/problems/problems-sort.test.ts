import { describe, expect, it } from "vitest";
import type { ProblemListItemDto } from "@ankileet/contracts";
import {
  compareProblems,
  DEFAULT_PROBLEM_SORT,
  parseProblemsSort,
  PROBLEM_SORT_KEYS,
  problemsSortSearch,
  type ProblemSort,
} from "./problems-sort";

function problem(id: string, patch: Partial<ProblemListItemDto> = {}): ProblemListItemDto {
  return {
    id,
    leetcodeSlug: id,
    leetcodeId: null,
    title: id,
    difficulty: "Medium",
    topicTags: [],
    fsrsDue: null,
    fsrsReps: 0,
    fsrsLapses: 0,
    fsrsState: "new",
    enrollment: "enrolled",
    fsrsStability: null,
    lastPracticedAt: null,
    practiceCount: 0,
    archivedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  };
}

const order = (list: ProblemListItemDto[], sort: ProblemSort) =>
  [...list].sort((a, b) => compareProblems(a, b, sort)).map((p) => p.id);

describe("compareProblems", () => {
  it("sorts by LeetCode number with unnumbered problems last in both directions", () => {
    const list = [problem("none"), problem("p146", { leetcodeId: 146 }), problem("p1", { leetcodeId: 1 })];
    expect(order(list, { key: "number", dir: "asc" })).toEqual(["p1", "p146", "none"]);
    expect(order(list, { key: "number", dir: "desc" })).toEqual(["p146", "p1", "none"]);
  });

  it("puts never-practiced problems after practiced ones", () => {
    const list = [
      problem("never"),
      problem("old", { lastPracticedAt: "2026-09-01T00:00:00.000Z" }),
      problem("recent", { lastPracticedAt: "2026-10-10T00:00:00.000Z" }),
    ];
    expect(order(list, { key: "practiced", dir: "desc" })).toEqual(["recent", "old", "never"]);
    expect(order(list, { key: "practiced", dir: "asc" })).toEqual(["old", "recent", "never"]);
  });

  it("lists unscheduled first practices after scheduled reviews, and legacy unscheduled ones as due", () => {
    const list = [
      problem("awaiting", { enrollment: "awaiting_initial" }),
      problem("later", { fsrsDue: "2026-10-20T00:00:00.000Z" }),
      problem("legacy"),
      problem("soon", { fsrsDue: "2026-10-16T00:00:00.000Z" }),
    ];
    expect(order(list, { key: "due", dir: "asc" })).toEqual(["legacy", "soon", "later", "awaiting"]);
  });

  it("sorts by date added, times practiced, and difficulty", () => {
    const list = [
      problem("a", { createdAt: "2026-10-02T00:00:00.000Z", practiceCount: 1, difficulty: "Hard" }),
      problem("b", { createdAt: "2026-10-03T00:00:00.000Z", practiceCount: 4, difficulty: "Easy" }),
      problem("c", { createdAt: "2026-10-01T00:00:00.000Z", practiceCount: 2, difficulty: "Medium" }),
    ];
    expect(order(list, { key: "added", dir: "desc" })).toEqual(["b", "a", "c"]);
    expect(order(list, { key: "sessions", dir: "desc" })).toEqual(["b", "c", "a"]);
    expect(order(list, { key: "difficulty", dir: "asc" })).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by id so the order is stable", () => {
    const list = [problem("b"), problem("a"), problem("c")];
    expect(order(list, { key: "reps", dir: "desc" })).toEqual(["a", "b", "c"]);
  });
});

describe("sort URL", () => {
  it("round-trips every key and direction", () => {
    for (const key of PROBLEM_SORT_KEYS) {
      for (const dir of ["asc", "desc"] as const) {
        const search = new URLSearchParams(problemsSortSearch({ key, dir }));
        expect(parseProblemsSort({ sort: search.get("sort") ?? undefined, dir: search.get("dir") ?? undefined })).toEqual({ key, dir });
      }
    }
  });

  it("leaves the default sort out of the URL", () => {
    expect(problemsSortSearch(DEFAULT_PROBLEM_SORT)).toBe("");
    expect(problemsSortSearch({ key: "added", dir: "desc" })).toBe("?sort=added&dir=desc");
  });

  it("ignores unknown values and uses the key's own default direction", () => {
    expect(parseProblemsSort({})).toEqual(DEFAULT_PROBLEM_SORT);
    expect(parseProblemsSort({ sort: "nope", dir: "desc" })).toEqual(DEFAULT_PROBLEM_SORT);
    expect(parseProblemsSort({ sort: "added" })).toEqual({ key: "added", dir: "desc" });
    expect(parseProblemsSort({ sort: "number", dir: "sideways" })).toEqual({ key: "number", dir: "asc" });
    expect(parseProblemsSort({ sort: ["practiced", "title"], dir: ["asc"] })).toEqual({ key: "practiced", dir: "asc" });
  });
});

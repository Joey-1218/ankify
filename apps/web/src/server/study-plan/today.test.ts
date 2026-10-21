import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PracticeSessionStartInput } from "@ankileet/contracts";
import { getDb, schema } from "@ankileet/db";
import { runSessionCommand, startPracticeSession } from "../practice-sessions/commands";
import { setStudyPlanSettings } from "../settings";
import { mergeAttemptHistory } from "../suggestions/history";
import { builtinLists, getBuiltinList } from "../study-lists/builtin";
import { createStudyList, updateStudyList } from "../study-lists/commands";
import { createTestDb } from "../test-db";
import { loadTodayPlan } from "./today";

const testDb = createTestDb();
const USER = "today-user";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000b";
const MIN = 60_000;
const DAY = 86_400_000;
const NOW = new Date("2026-10-20T15:00:00Z");
const uuid = () => crypto.randomUUID();
const LIST = "sliding-window-two-pointers";
const items = () => getBuiltinList(LIST)!.items;

async function start(slug: string, mode: PracticeSessionStartInput["mode"], now: Date, problemId?: string) {
  const item = items().find((candidate) => candidate.slug === slug);
  const result = await startPracticeSession(
    USER,
    {
      requestId: uuid(),
      target: problemId
        ? { kind: "problem", problemId }
        : { kind: "leetcode", problem: { leetcodeSlug: slug, title: item?.title.en ?? slug, difficulty: item?.difficulty ?? "Easy", url: `https://leetcode.com/problems/${slug}/`, topicTags: [], similarSlugs: [] } },
      mode,
      ownerToken: TAB,
      baseline: { state: "none" },
      supersedePendingRating: false,
    },
    now,
  );
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.response;
}

async function practiceNew(slug: string, startAt: Date, result: "solved" | "unsuccessful" = "solved") {
  const { session, problem } = await start(slug, "practice", startAt);
  const done = await runSessionCommand(USER, session.id, { type: "finish", requestId: uuid(), ownerToken: TAB, result, occurredAt: new Date(startAt.getTime() + 30 * MIN).toISOString() }, new Date(startAt.getTime() + 30 * MIN));
  if (!done.ok) throw new Error(`finish failed: ${done.error}`);
  return problem;
}

async function follow(builtinId = LIST) {
  const result = await createStudyList(USER, { action: "follow", requestId: uuid(), builtinId });
  if (!result.ok) throw new Error(result.error);
  return result.listId;
}

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await getDb().delete(schema.user);
  await getDb().insert(schema.user).values({ id: USER, name: "Today", email: "today@example.test" });
});
afterAll(() => testDb.cleanup());

describe("same-day re-solve", () => {
  it("starts an early review on the day the problem was scheduled as practice, and as a review the next day", async () => {
    const slug = items()[0]!.slug;
    const problem = await practiceNew(slug, new Date("2026-10-20T09:00:00Z"));
    const sameDay = await start(slug, "early_review", new Date("2026-10-20T18:00:00Z"), problem.id);
    expect(sameDay.session.type).toBe("voluntary_practice");
    await runSessionCommand(USER, sameDay.session.id, { type: "abandon", requestId: uuid(), ownerToken: TAB, occurredAt: "2026-10-20T18:05:00.000Z" }, new Date("2026-10-20T18:05:00Z"));
    const nextDay = await start(slug, "early_review", new Date("2026-10-21T08:00:00Z"), problem.id);
    expect(nextDay.session).toMatchObject({ type: "scheduled_review", reviewIntent: "early" });
  });
});

describe("today's plan", () => {
  it("fills an empty 60-minute day with the followed list's first two problems, and more on request", async () => {
    await follow();
    const plan = await loadTodayPlan(USER, { due: [] }, NOW);
    expect(plan.pace).toMatchObject({ reviews: 0, reviewMinutes: 12, newMinutes: 35, newSlots: 2, newStartedToday: 0, ownTimes: { review: false, new: false } });
    expect(plan.newProblems.map((pick) => [pick.slug, pick.reason, pick.extra])).toEqual([
      [items()[0]!.slug, "next", false],
      [items()[1]!.slug, "next", false],
    ]);
    expect(plan.newProblems[0]).toMatchObject({ list: { kind: "builtin", builtinId: LIST }, pattern: { id: "sliding_window.fixed" }, url: `https://leetcode.com/problems/${items()[0]!.slug}/` });
    expect(plan.moreAvailable).toBe(true);
    const more = await loadTodayPlan(USER, { due: [], extra: 1 }, NOW);
    expect(more.newProblems.map((pick) => pick.extra)).toEqual([false, false, true]);
  });

  it("counts a problem started today against the day's slots and moves on", async () => {
    await follow();
    await practiceNew(items()[0]!.slug, new Date(NOW.getTime() - 2 * 60 * MIN));
    const plan = await loadTodayPlan(USER, { due: [] }, NOW);
    expect(plan.pace).toMatchObject({ newSlots: 2, newStartedToday: 1 });
    expect(plan.newProblems.map((pick) => pick.slug)).toEqual([items()[1]!.slug]);
  });

  it("offers nothing from paused lists, without lists, or with a cap of zero", async () => {
    expect((await loadTodayPlan(USER, { due: [] }, NOW)).newProblems).toEqual([]);
    const listId = await follow();
    await setStudyPlanSettings(USER, { maxNewPerDay: 0 });
    expect((await loadTodayPlan(USER, { due: [] }, NOW)).newProblems).toEqual([]);
    await setStudyPlanSettings(USER, { maxNewPerDay: 5 });
    await updateStudyList(USER, listId, { active: false });
    const paused = await loadTodayPlan(USER, { due: [] }, NOW);
    expect(paused).toMatchObject({ activeLists: 0, newProblems: [], moreAvailable: false });
  });

  it("puts a weak pattern's next unseen problem first", async () => {
    await follow();
    const shortest = items().filter((item) => item.sectionId === "2.2");
    // Two new problems of the pattern, both not solved, three days ago.
    for (const [index, item] of shortest.slice(0, 2).entries()) {
      await practiceNew(item.slug, new Date(NOW.getTime() - 3 * DAY + index * 60 * MIN), "unsuccessful");
    }
    const plan = await loadTodayPlan(USER, { due: [] }, NOW);
    expect(plan.newProblems[0]).toMatchObject({ slug: shortest[2]!.slug, reason: "weak_pattern", pattern: { id: "sliding_window.variable.shortest" } });
    // The focus card names it, with the same problem to practice next, even while due reviews hide their patterns.
    expect(plan.settings.hidePatternsOnToday).toBe(true);
    expect(plan.focusPatterns).toEqual([
      {
        pattern: { id: "sliding_window.variable.shortest", name: expect.objectContaining({ en: expect.any(String) }) },
        weakness: expect.any(Number),
        next: expect.objectContaining({ slug: shortest[2]!.slug, list: { builtinId: LIST, name: getBuiltinList(LIST)!.name } }),
      },
    ]);

    // Once every built-in problem with the pattern is attempted, nothing is left to practice it.
    const rest = builtinLists().flatMap((list) => list.items.filter((item) => item.pattern === "sliding_window.variable.shortest").map((item) => item.slug));
    await mergeAttemptHistory(USER, { source: "user_marked", sourceAccount: null, entries: [...new Set(rest)].map((slug) => ({ slug, status: "attempted" as const })) });
    expect((await loadTodayPlan(USER, { due: [] }, NOW)).focusPatterns).toMatchObject([{ pattern: { id: "sliding_window.variable.shortest" }, next: null }]);
  });

  it("interleaves due reviews in a stable order and shows their patterns only when asked", async () => {
    const due = ["1.1", "1.1", "2.2", "3.2"].map((section, index) => {
      const item = items().filter((candidate) => candidate.sectionId === section)[index === 1 ? 1 : 0]!;
      return { id: `p${index}`, slug: item.slug };
    });
    const first = await loadTodayPlan(USER, { due }, NOW);
    expect([...first.reviewOrder].sort()).toEqual(["p0", "p1", "p2", "p3"]);
    expect((await loadTodayPlan(USER, { due }, NOW)).reviewOrder).toEqual(first.reviewOrder);
    const positions = ["p0", "p1"].map((id) => first.reviewOrder.indexOf(id));
    expect(Math.abs(positions[0]! - positions[1]!)).toBeGreaterThan(1);
    expect(first.reviewPatterns).toEqual({});
    await setStudyPlanSettings(USER, { hidePatternsOnToday: false });
    const shown = await loadTodayPlan(USER, { due }, NOW);
    expect(shown.reviewPatterns.p2).toEqual([{ id: "sliding_window.variable.shortest", name: expect.objectContaining({ en: expect.any(String) }) }]);
  });
});

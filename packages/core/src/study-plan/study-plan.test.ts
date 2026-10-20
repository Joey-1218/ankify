import { describe, expect, it } from "vitest";
import { computePatternProfile, type PatternSessionInput } from "./pattern-profile";
import { interleave, planNewProblems, type PlanList } from "./plan";
import { paceDay, STUDY_PLAN_DEFAULTS, typicalMinutes } from "./pace";

const NOW = new Date("2026-10-20T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

describe("pacing by a daily time budget", () => {
  const day = (reviews: number, dailyMinutes = 60, maxNewPerDay = 5) =>
    paceDay({ dailyMinutes, maxNewPerDay, reviews, reviewMinutes: 12, newMinutes: 35 }).newSlots;

  it("buys two new problems on an empty 60-minute day and one beside two reviews", () => {
    expect(day(0)).toBe(2);
    expect(day(2)).toBe(1);
    expect(paceDay({ dailyMinutes: 60, maxNewPerDay: 5, reviews: 2, reviewMinutes: 12, newMinutes: 35 }).plannedMinutes).toBe(59);
  });

  it("gives no new problems while reviews fill the day, and never cuts reviews", () => {
    expect(day(5)).toBe(0);
    expect(day(20)).toBe(0);
    expect(paceDay({ dailyMinutes: 60, maxNewPerDay: 5, reviews: 20, reviewMinutes: 12, newMinutes: 35 }).plannedMinutes).toBe(240);
  });

  it("stops at the daily cap, which the user may raise for cramming", () => {
    expect(day(0, 480)).toBe(5);
    expect(day(0, 480, 20)).toBe(14);
    expect(day(0, 60, 0)).toBe(0);
  });

  it("uses the user's median times once there are five sessions of a kind", () => {
    const minutes = (values: number[]) => values.map((value) => value * 60_000);
    expect(typicalMinutes(minutes([10, 20, 30, 40]), 35)).toEqual({ minutes: 35, own: false });
    expect(typicalMinutes(minutes([10, 20, 30, 40, 50]), 35)).toEqual({ minutes: 30, own: true });
    expect(typicalMinutes(minutes([1, 1, 1, 1, 1, 1]), 35).minutes).toBe(3);
    expect(typicalMinutes([0, 0, 0, 0, 0], 12)).toEqual({ minutes: 12, own: false });
    expect(STUDY_PLAN_DEFAULTS).toMatchObject({ dailyMinutes: 60, maxNewPerDay: 5, newMinutes: 35, reviewMinutes: 12 });
  });
});

describe("pattern profile", () => {
  let counter = 0;
  const session = (patterns: string[], overrides: Partial<PatternSessionInput> = {}): PatternSessionInput => ({
    id: `s${(counter += 1)}`,
    problemId: `p${counter}`,
    patterns,
    type: "initial_learning",
    status: "completed",
    outcome: "accepted",
    completedAt: daysAgo(1),
    rating: null,
    firstTryAccepted: true,
    ...overrides,
  });

  it("needs two sessions across two problems before calling a pattern weak", () => {
    const one = computePatternProfile({ now: NOW, sessions: [session(["a"], { outcome: "failed", firstTryAccepted: false })], mistakes: [] });
    expect(one[0]).toMatchObject({ pattern: "a", ready: false, weak: false });
    const two = computePatternProfile({
      now: NOW,
      sessions: [session(["a"], { outcome: "failed", firstTryAccepted: false }), session(["a"], { type: "scheduled_review", rating: 1, outcome: "failed" })],
      mistakes: [],
    });
    expect(two[0]).toMatchObject({ ready: true, weak: true, newProblems: { total: 1, firstTry: 0 } });
  });

  it("weighs first practices of new problems more than reviews", () => {
    const failures = (type: PatternSessionInput["type"]) =>
      computePatternProfile({
        now: NOW,
        sessions: [
          session(["a"], { type, outcome: "failed" }),
          session(["a"], { type, outcome: "failed" }),
          ...Array.from({ length: 4 }, () => session(["b"])),
        ],
        mistakes: [],
      }).find((stat) => stat.pattern === "a")!.weakness;
    expect(failures("initial_learning")).toBeGreaterThan(failures("voluntary_practice"));
  });

  it("counts a context's confirmed mistakes once, tallies causes, and ignores candidates", () => {
    const base = [session(["a"]), session(["a"])];
    const mistake = (category: "approach" | "invariant", contextKey: string, status: "confirmed" | "candidate" = "confirmed") => ({
      problemId: "p1",
      patterns: ["a"],
      category,
      status,
      createdAt: daysAgo(1),
      contextKey,
    });
    const [withMistakes] = computePatternProfile({
      now: NOW,
      sessions: base,
      mistakes: [mistake("approach", "session:x"), mistake("invariant", "session:x"), mistake("approach", "session:y"), mistake("invariant", "session:z", "candidate")],
    });
    const [clean] = computePatternProfile({ now: NOW, sessions: base, mistakes: [] });
    expect(withMistakes!.causes).toEqual({ approach: 2, invariant: 1 });
    expect(withMistakes!.weakness).toBeGreaterThan(clean!.weakness);
  });

  it("calls a pattern strong after three clean problems, and skips unfinished sessions and old evidence", () => {
    const strong = computePatternProfile({ now: NOW, sessions: [session(["a"]), session(["a"]), session(["a"]), session(["b"], { outcome: "failed" })], mistakes: [] });
    expect(strong.find((stat) => stat.pattern === "a")).toMatchObject({ strong: true, weak: false, problems: 3 });
    const ignored = computePatternProfile({
      now: NOW,
      sessions: [session(["a"], { status: "interrupted" }), session(["a"], { status: "abandoned" }), session(["a"], { completedAt: daysAgo(120) })],
      mistakes: [],
    });
    expect(ignored).toEqual([]);
  });
});

describe("new-problem plan", () => {
  const list = (id: string, share: number, slugs: string[], pattern: (slug: string) => string | null = () => null): PlanList => ({
    id,
    share,
    candidates: slugs.map((slug) => ({ slug, pattern: pattern(slug) })),
  });
  const plan = (lists: PlanList[], slots: number, extra: Partial<Parameters<typeof planNewProblems>[0]> = {}) =>
    planNewProblems({ seed: "u:2026-10-20", slots, lists, served: new Map(), weakPatterns: new Set(), checkPatterns: new Set(), ...extra });

  it("takes each list's next problems in order and splits slots by share", () => {
    const a = list("a", 2, ["a1", "a2", "a3", "a4"]);
    const b = list("b", 1, ["b1", "b2", "b3"]);
    const picks = plan([a, b], 6);
    expect(picks.filter((pick) => pick.listId === "a").map((pick) => pick.slug)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(picks.filter((pick) => pick.listId === "b").map((pick) => pick.slug)).toEqual(["b1", "b2"]);
    expect(picks.every((pick) => pick.reason === "next")).toBe(true);
  });

  it("evens out over days: a list that was served recently waits", () => {
    const picks = plan([list("a", 1, ["a1"]), list("b", 1, ["b1"])], 1, { served: new Map([["a", 3], ["b", 1]]) });
    expect(picks.map((pick) => pick.listId)).toEqual(["b"]);
  });

  it("puts a weak pattern's next problem first, and one check problem a day for a strong pattern", () => {
    const pattern = (slug: string) => slug.split("-")[0]!;
    const lists = [list("a", 1, ["fixed-1", "longest-1", "fixed-2", "count-1", "count-2"], pattern)];
    expect(plan(lists, 2, { weakPatterns: new Set(["count"]) }).map((pick) => [pick.slug, pick.reason])).toEqual([
      ["count-1", "weak_pattern"],
      ["count-2", "weak_pattern"],
    ]);
    expect(plan(lists, 3, { checkPatterns: new Set(["longest", "count"]) }).map((pick) => [pick.slug, pick.reason])).toEqual([
      ["longest-1", "check"],
      ["fixed-1", "next"],
      ["fixed-2", "next"],
    ]);
  });

  it("never picks a problem twice, and stops when the lists run out", () => {
    const picks = plan([list("a", 1, ["shared", "a1"]), list("b", 1, ["shared"])], 5);
    expect(picks.map((pick) => pick.slug).sort()).toEqual(["a1", "shared"]);
    expect(plan([], 3)).toEqual([]);
  });
});

describe("interleaving reviews", () => {
  const items = ["a1", "a2", "a3", "b1", "b2", "c1"].map((key) => ({ key, pattern: key[0]! }));
  const order = (seed: string) => interleave(items, (item) => item.key, (item) => item.pattern, seed);

  it("never puts two problems of one pattern in a row while another remains", () => {
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const result = order(seed);
      expect(result).toHaveLength(items.length);
      for (let i = 1; i < result.length; i += 1) expect(result[i]!.pattern).not.toBe(result[i - 1]!.pattern);
    }
  });

  it("is stable for a seed and changes with it", () => {
    expect(order("day-1")).toEqual(order("day-1"));
    const orders = new Set(["d1", "d2", "d3", "d4", "d5"].map((seed) => order(seed).map((item) => item.key).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

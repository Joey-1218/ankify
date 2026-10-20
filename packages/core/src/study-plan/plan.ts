import { unitHash } from "../daily-feed/random";

/**
 * Which new problems fill the day's slots (docs/STUDY_LISTS_PLAN.md, "Today").
 *
 * - Slots go to active lists in proportion to their shares by a deficit
 *   round-robin over recent history: `deficit = share · (served + handed out
 *   + 1) − (served_l + handed out_l)`, largest first, so over a couple of
 *   weeks each list gets its share. Ties break by a seeded hash.
 * - Within the list, a weak pattern's next unseen problem comes first (fresh
 *   problems, not re-solving known ones); then, once per day, a check problem
 *   for a pattern that looks strong; else the list's next problem in order.
 * - A problem is picked at most once, even when two lists hold it.
 */

export type PlanCandidate = { slug: string; pattern: string | null };

export type PlanList = {
  id: string;
  share: number;
  /** Problems not started yet, in list order. */
  candidates: readonly PlanCandidate[];
};

export type PlannedPick = {
  slug: string;
  listId: string;
  pattern: string | null;
  reason: "weak_pattern" | "check" | "next";
};

export function planNewProblems(input: {
  seed: string;
  slots: number;
  lists: readonly PlanList[];
  /** New problems each list gave in the allocation window. */
  served: ReadonlyMap<string, number>;
  weakPatterns: ReadonlySet<string>;
  /** Strong patterns due for a check problem. */
  checkPatterns: ReadonlySet<string>;
}): PlannedPick[] {
  const lists = input.lists.filter((list) => list.share > 0);
  const totalShare = lists.reduce((sum, list) => sum + list.share, 0);
  const handedOut = new Map<string, number>();
  const taken = new Set<string>();
  const checks = new Set(input.checkPatterns);
  let checkUsed = false;
  const picks: PlannedPick[] = [];

  const remaining = (list: PlanList) => list.candidates.filter((candidate) => !taken.has(candidate.slug));
  for (let slot = 0; slot < input.slots; slot += 1) {
    const available = lists.filter((list) => remaining(list).length > 0);
    if (available.length === 0) break;
    const total = lists.reduce((sum, list) => sum + (input.served.get(list.id) ?? 0) + (handedOut.get(list.id) ?? 0), 0) + 1;
    const deficit = (list: PlanList) =>
      (list.share / totalShare) * total - ((input.served.get(list.id) ?? 0) + (handedOut.get(list.id) ?? 0));
    const list = available.reduce((best, candidate) => {
      const difference = deficit(candidate) - deficit(best);
      if (Math.abs(difference) > 1e-9) return difference > 0 ? candidate : best;
      return unitHash(input.seed, candidate.id) > unitHash(input.seed, best.id) ? candidate : best;
    });

    const open = remaining(list);
    const weak = open.find((candidate) => candidate.pattern != null && input.weakPatterns.has(candidate.pattern));
    const check = !weak && !checkUsed ? open.find((candidate) => candidate.pattern != null && checks.has(candidate.pattern)) : undefined;
    const choice = weak ?? check ?? open[0]!;
    const reason = weak ? "weak_pattern" : check ? "check" : "next";
    if (check) {
      checkUsed = true;
      checks.delete(check.pattern!);
    }
    taken.add(choice.slug);
    handedOut.set(list.id, (handedOut.get(list.id) ?? 0) + 1);
    picks.push({ slug: choice.slug, listId: list.id, pattern: choice.pattern, reason });
  }
  return picks;
}

/**
 * A seeded order that mixes patterns: shuffled by a per-day seed (stable all
 * day), then never two of the same pattern in a row whenever an order like
 * that exists. Items without a pattern mix freely.
 *
 * With `n` items left, a pattern holding `c` of them can still be kept apart
 * only if `c ≤ n − c + 1`; at equality it must come next. So that pattern is
 * forced when it reaches the bound, and otherwise the next shuffled item that
 * does not repeat the previous pattern is taken.
 */
export function interleave<T>(items: readonly T[], keyOf: (item: T) => string, patternOf: (item: T) => string | null, seed: string): T[] {
  const pool = [...items].sort((a, b) => unitHash(seed, keyOf(a)) - unitHash(seed, keyOf(b)));
  const ordered: T[] = [];
  let previous: string | null = null;
  while (pool.length > 0) {
    const counts = new Map<string, number>();
    for (const item of pool) {
      const pattern = patternOf(item);
      if (pattern != null) counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    }
    const forced = [...counts].find(([pattern, count]) => pattern !== previous && 2 * count >= pool.length + 1)?.[0];
    let index = forced
      ? pool.findIndex((item) => patternOf(item) === forced)
      : pool.findIndex((item) => {
          const pattern = patternOf(item);
          return pattern == null || pattern !== previous;
        });
    if (index < 0) index = 0;
    const [item] = pool.splice(index, 1);
    ordered.push(item!);
    previous = patternOf(item!);
  }
  return ordered;
}

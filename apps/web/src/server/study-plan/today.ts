import type { StudyListPatternDto, TodayNewProblemDto, TodayPlanDto } from "@ankileet/contracts";
import { FEED_PARAMS, interleave, paceDay, planNewProblems, STUDY_PLAN_DEFAULTS, typicalMinutes } from "@ankileet/core";
import { getDb, schema } from "@ankileet/db";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { dueProblemCondition } from "../due-problems";
import { loadPatternProfile } from "../mistake-profile";
import { getReviewSettings, getStudyPlanSettings } from "../settings";
import { patternsForSlug } from "../study-lists/builtin";
import { loadActiveListCandidates, type ActiveListCandidates } from "../study-lists/lists";
import { patternName } from "../study-lists/patterns";
import { formatDateKeyInTimeZone, getZonedDayBounds } from "../time-zone";

const DAY_MS = 86_400_000;
/** A strong pattern gets a check problem at most this often. */
export const CHECK_INTERVAL_DAYS = 14;
/** "One more new problem" past the plan, at most this many a day. */
export const MAX_EXTRA_NEW = 20;

const patternDto = (id: string): StudyListPatternDto => ({ id, name: patternName(id as Parameters<typeof patternName>[0]) });

/** The pattern of a list entry: its section's in a built-in list, else the problem's first. */
function entryPattern(list: ActiveListCandidates, entry: { slug: string; sectionId: string | null }) {
  if (entry.sectionId) return list.sectionPatterns.get(entry.sectionId)?.id ?? null;
  return patternsForSlug(entry.slug)[0] ?? null;
}

/**
 * Today's plan: how many reviews the day holds, how many new problems the
 * daily time budget buys, which problems fill those slots from the active
 * lists, and the interleaved order of the due reviews. Derived on every read
 * from the user's own rows (nothing is stored), so starting a problem or
 * changing a setting shows at once.
 */
export async function loadTodayPlan(
  userId: string,
  options: { due: readonly { id: string; slug: string }[]; extra?: number },
  now = new Date(),
): Promise<TodayPlanDto> {
  const db = getDb();
  const ps = schema.practiceSessions;
  const [review, plan] = await Promise.all([getReviewSettings(userId), getStudyPlanSettings(userId)]);
  const { start: startOfDay } = getZonedDayBounds(review.timeZone, now);
  const dateKey = formatDateKeyInTimeZone(now, review.timeZone);
  const windowStart = new Date(now.getTime() - FEED_PARAMS.allocationWindowDays * DAY_MS);
  const count = sql<number>`count(*)`;

  const [[due], [doneToday], timings, [startedToday], recentFirsts, lists, patterns] = await Promise.all([
    db.select({ count }).from(schema.problems).where(dueProblemCondition(userId, now)),
    db
      .select({ count })
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.eventType, "self_recall_rated"),
          isNull(schema.reviewEvents.undoneAt),
          gte(schema.reviewEvents.occurredAt, startOfDay),
        ),
      ),
    db
      .select({ type: ps.type, activeMs: ps.activeMs })
      .from(ps)
      .where(
        and(
          eq(ps.userId, userId),
          eq(ps.status, "completed"),
          inArray(ps.type, ["initial_learning", "scheduled_review"]),
          gte(ps.completedAt, new Date(now.getTime() - FEED_PARAMS.maxEvidenceAgeDays * DAY_MS)),
        ),
      ),
    db.select({ count }).from(ps).where(and(eq(ps.userId, userId), eq(ps.type, "initial_learning"), gte(ps.startedAt, startOfDay))),
    db
      .select({ slug: schema.problems.leetcodeSlug })
      .from(ps)
      .innerJoin(schema.problems, and(eq(schema.problems.id, ps.problemId), eq(schema.problems.userId, ps.userId)))
      .where(and(eq(ps.userId, userId), eq(ps.type, "initial_learning"), gte(ps.startedAt, windowStart))),
    loadActiveListCandidates(userId, db),
    loadPatternProfile(userId, now),
  ]);

  const reviewTime = typicalMinutes(timings.filter((row) => row.type === "scheduled_review").map((row) => row.activeMs), STUDY_PLAN_DEFAULTS.reviewMinutes);
  const newTime = typicalMinutes(timings.filter((row) => row.type === "initial_learning").map((row) => row.activeMs), STUDY_PLAN_DEFAULTS.newMinutes);
  const reviewsDone = Number(doneToday?.count ?? 0);
  const reviewsLeft = Math.min(Number(due?.count ?? 0), Math.max(0, review.dailyReviewLimit - reviewsDone));
  const pace = paceDay({
    dailyMinutes: plan.dailyMinutes,
    maxNewPerDay: plan.maxNewPerDay,
    reviews: reviewsLeft + reviewsDone,
    reviewMinutes: reviewTime.minutes,
    newMinutes: newTime.minutes,
  });
  const newStartedToday = Number(startedToday?.count ?? 0);
  const planned = Math.max(0, pace.newSlots - newStartedToday);
  const extra = Math.max(0, Math.min(MAX_EXTRA_NEW, Math.trunc(options.extra ?? 0)));

  // A first practice counts for the first active list (in the user's order) that holds it.
  const served = new Map<string, number>();
  for (const { slug } of recentFirsts) {
    const holder = lists.find((list) => list.slugs.has(slug));
    if (holder) served.set(holder.id, (served.get(holder.id) ?? 0) + 1);
  }
  const weakPatterns = new Set(patterns.filter((stat) => stat.weak).map((stat) => stat.pattern));
  const checkPatterns = new Set(
    patterns
      .filter((stat) => stat.strong && (!stat.lastNewAt || now.getTime() - stat.lastNewAt.getTime() >= CHECK_INTERVAL_DAYS * DAY_MS))
      .map((stat) => stat.pattern),
  );

  const slots = planned + extra;
  const picks = planNewProblems({
    seed: `${userId}:${dateKey}`,
    // One past what is shown tells whether "one more" has anything to offer.
    slots: slots + 1,
    lists: lists.map((list) => ({
      id: list.id,
      share: list.share,
      candidates: list.candidates.map((entry) => ({ slug: entry.slug, pattern: entryPattern(list, entry) })),
    })),
    served,
    weakPatterns,
    checkPatterns,
  });

  const byId = new Map(lists.map((list) => [list.id, list]));
  const newProblems: TodayNewProblemDto[] = picks.slice(0, slots).map((pick, index) => {
    const list = byId.get(pick.listId)!;
    const entry = list.candidates.find((candidate) => candidate.slug === pick.slug)!;
    return {
      slug: entry.slug,
      leetcodeId: entry.leetcodeId,
      title: entry.title,
      difficulty: entry.difficulty,
      url: entry.url,
      state: entry.state === "attempted_before" ? "attempted_before" : "not_started",
      list: { id: list.id, kind: list.kind, builtinId: list.builtinId, name: list.name },
      pattern: pick.pattern ? patternDto(pick.pattern) : null,
      reason: pick.reason,
      extra: index >= planned,
    };
  });

  const seed = `${userId}:${dateKey}:reviews`;
  const firstPattern = (slug: string) => patternsForSlug(slug)[0] ?? null;
  return {
    dateKey,
    settings: plan,
    pace: {
      reviews: pace.reviews,
      reviewMinutes: pace.reviewMinutes,
      newMinutes: pace.newMinutes,
      ownTimes: { review: reviewTime.own, new: newTime.own },
      newSlots: pace.newSlots,
      newStartedToday,
      plannedMinutes: pace.plannedMinutes,
    },
    activeLists: lists.length,
    newProblems,
    moreAvailable: picks.length > slots,
    reviewOrder: interleave(options.due, (item) => item.id, (item) => firstPattern(item.slug), seed).map((item) => item.id),
    reviewPatterns: plan.hidePatternsOnToday
      ? {}
      : Object.fromEntries(options.due.map((item) => [item.id, patternsForSlug(item.slug).map(patternDto)])),
  };
}

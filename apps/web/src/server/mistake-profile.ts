import type { MistakeProfileDto, PatternProfileDto } from "@ankileet/contracts";
import {
  computeMistakeProfile,
  computePatternProfile,
  contextKey,
  FEED_PARAMS,
  PATTERN_PARAMS,
  PROFILE_READINESS,
  summarizeSession,
  type FsrsRating,
  type PatternStat,
  type ProfileMistakeInput,
  type ProfileSessionInput,
} from "@ankileet/core";
import { getDb, schema } from "@ankileet/db";
import { and, eq, gte, isNotNull, isNull, ne, or } from "drizzle-orm";
import { patternsForSlug } from "./study-lists/builtin";
import { loadPatternPractice } from "./study-lists/lists";
import { patternDto } from "./study-lists/patterns";

const TREND_DAYS = 30;
const MAX_EXAMPLES = 3;
const MAX_CANDIDATES = 20;
/** Problems to practice next under each weak pattern. */
const MAX_PRACTICE = 3;

/** The legacy context of a record made outside a practice session. */
export function legacySourceKey(row: {
  id: string;
  submissionId: string | null;
  quizSessionId: string | null;
  quizItemId: string | null;
  reviewEventId: string | null;
}) {
  if (row.submissionId) return `submission:${row.submissionId}`;
  if (row.quizSessionId && row.quizItemId) return `quiz:${row.quizSessionId}:${row.quizItemId}`;
  if (row.reviewEventId) return `review:${row.reviewEventId}`;
  return `record:${row.id}`;
}

/** Sessions, mistake records, and ratings of the last 90 days, user-scoped, as profile inputs. */
async function loadProfileEvidence(userId: string, now: Date) {
  const db = getDb();
  const since = new Date(now.getTime() - FEED_PARAMS.maxEvidenceAgeDays * 86_400_000);
  const ps = schema.practiceSessions;
  const p = schema.problems;
  const m = schema.mistakeRecords;
  const e = schema.reviewEvents;
  const o = schema.practiceSessionSubmissions;
  // Joins, not id lists: a long history must not hit the host-parameter limit.
  const sessionInWindow = and(eq(ps.userId, userId), or(gte(ps.completedAt, since), and(isNull(ps.completedAt), gte(ps.startedAt, since))));

  const [sessionRows, mistakeRows, legacyRatingRows, observationRows, sessionRatingRows] = await Promise.all([
    db
      .select({ session: ps, title: p.title, slug: p.leetcodeSlug, topicTags: p.topicTags })
      .from(ps)
      .innerJoin(p, and(eq(p.id, ps.problemId), eq(p.userId, ps.userId)))
      .where(sessionInWindow),
    db
      .select({ mistake: m, title: p.title, slug: p.leetcodeSlug, topicTags: p.topicTags })
      .from(m)
      .innerJoin(p, and(eq(p.id, m.problemId), eq(p.userId, m.userId)))
      .where(and(eq(m.userId, userId), gte(m.createdAt, since), ne(m.status, "dismissed"))),
    db
      .select({ problemId: e.problemId, topicTags: p.topicTags, rating: e.fsrsRating, occurredAt: e.occurredAt })
      .from(e)
      .innerJoin(p, and(eq(p.id, e.problemId), eq(p.userId, e.userId)))
      .where(
        and(
          eq(e.userId, userId),
          eq(e.eventType, "self_recall_rated"),
          isNull(e.undoneAt),
          isNull(e.practiceSessionId),
          isNotNull(e.fsrsRating),
          gte(e.occurredAt, since),
        ),
      ),
    db
      .select({ sessionId: o.sessionId, verdict: o.verdict, submittedAt: o.submittedAt, firstObservedAt: o.firstObservedAt, association: o.association, detailStatus: o.detailStatus })
      .from(o)
      .innerJoin(ps, and(eq(ps.id, o.sessionId), eq(ps.userId, o.userId)))
      .where(and(eq(o.userId, userId), sessionInWindow)),
    db
      .select({ sessionId: e.practiceSessionId, rating: e.fsrsRating })
      .from(e)
      .innerJoin(ps, and(eq(ps.id, e.practiceSessionId), eq(ps.userId, e.userId)))
      .where(and(eq(e.userId, userId), eq(e.eventType, "self_recall_rated"), isNull(e.undoneAt), sessionInWindow)),
  ]);

  const problems = new Map<string, { title: string; slug: string; topicTags: string[] }>();
  for (const row of [...sessionRows.map((item) => ({ id: item.session.problemId, ...item })), ...mistakeRows.map((item) => ({ id: item.mistake.problemId, ...item }))]) {
    problems.set(row.id, { title: row.title, slug: row.slug, topicTags: row.topicTags });
  }
  const topicsOf = (problemId: string) => problems.get(problemId)?.topicTags ?? [];

  const observationsBySession = new Map<string, typeof observationRows>();
  for (const row of observationRows) {
    const list = observationsBySession.get(row.sessionId) ?? [];
    list.push(row);
    observationsBySession.set(row.sessionId, list);
  }
  const ratingBySession = new Map(sessionRatingRows.flatMap((row) => (row.sessionId && row.rating ? [[row.sessionId, row.rating as FsrsRating] as const] : [])));

  const sessions: ProfileSessionInput[] = sessionRows.map(({ session: row }) => {
    const observations = observationsBySession.get(row.id) ?? [];
    const associated = observations.filter((item) => item.association === "automatic" || item.association === "confirmed");
    return {
      id: row.id,
      problemId: row.problemId,
      topics: topicsOf(row.problemId),
      status: row.status,
      outcome: row.outcome,
      completedAt: row.completedAt,
      rating: ratingBySession.get(row.id) ?? null,
      verdicts: associated.map((item) => ({ verdict: item.verdict, at: item.submittedAt ?? item.firstObservedAt })),
      partialCapture: row.captureCompleteness !== "complete" || associated.some((item) => item.detailStatus !== "complete"),
      ambiguousObservations: observations.filter((item) => item.association === "ambiguous").length,
    };
  });
  const mistakes: ProfileMistakeInput[] = mistakeRows.map(({ mistake: row }) => ({
    id: row.id,
    problemId: row.problemId,
    topics: topicsOf(row.problemId),
    category: row.primaryCategory,
    status: row.status,
    origin: row.origin,
    resolved: row.resolvedAt != null,
    createdAt: row.createdAt,
    practiceSessionId: row.practiceSessionId,
    legacySourceKey: legacySourceKey(row),
  }));

  const legacyRatings = legacyRatingRows.map((row) => ({ problemId: row.problemId, topics: row.topicTags, rating: row.rating as FsrsRating, at: row.occurredAt }));
  const typeBySession = new Map(sessionRows.map(({ session }) => [session.id, session.type]));
  return { sessions, mistakes, legacyRatings, mistakeRows, problems, typeBySession };
}

/**
 * The mistake profile from the user's own records, sessions, and ratings in
 * the last 90 days. Every query is scoped by user; aggregation happens in
 * `computeMistakeProfile()` (see `@ankileet/core`), so nothing derived is stored
 * that Undo, dismissal, or deletion could leave stale.
 */
export async function loadMistakeProfile(userId: string, now = new Date()): Promise<MistakeProfileDto> {
  return mistakeProfileOf(await loadProfileEvidence(userId, now), now);
}

type ProfileEvidence = Awaited<ReturnType<typeof loadProfileEvidence>>;

function mistakeProfileOf({ sessions, mistakes, legacyRatings, mistakeRows, problems }: ProfileEvidence, now: Date): MistakeProfileDto {
  const profile = computeMistakeProfile({ now, trendDays: TREND_DAYS, sessions, mistakes, legacyRatings });

  const mistakeById = new Map(mistakeRows.map(({ mistake }) => [mistake.id, mistake]));
  const describe = (id: string) => {
    const row = mistakeById.get(id)!;
    return {
      mistakeId: row.id,
      problemId: row.problemId,
      problemTitle: problems.get(row.problemId)?.title ?? "",
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
      practiceSessionId: row.practiceSessionId,
    };
  };

  return {
    generatedAt: now.toISOString(),
    windowDays: FEED_PARAMS.maxEvidenceAgeDays,
    halfLifeDays: FEED_PARAMS.halfLifeDays,
    readiness: { ...profile.readiness, required: { sessions: PROFILE_READINESS.sessions, problems: PROFILE_READINESS.problems } },
    categories: profile.categories.map((category) => ({
      category: category.category,
      weakness: Math.round(category.weakness * 1000) / 1000,
      weak: category.weak,
      ready: category.ready,
      contexts: category.contexts,
      problems: category.problems,
      unresolved: category.unresolved,
      resolved: category.resolved,
      cleanReviews: category.cleanReviews,
      lastSeenAt: category.lastSeenAt?.toISOString() ?? null,
      trend: { ...category.trend, periodDays: TREND_DAYS },
      examples: category.exampleIds.slice(0, MAX_EXAMPLES).map(describe),
    })),
    candidates: profile.candidateIds.slice(0, MAX_CANDIDATES).map((id) => ({ ...describe(id), category: mistakeById.get(id)!.primaryCategory })),
    topics: profile.topics.map((topic) => ({ ...topic, weakness: Math.round(topic.weakness * 1000) / 1000 })),
    signals: profile.signals,
    incomplete: profile.incomplete,
  };
}

/**
 * Pattern mastery from the same evidence: each session and confirmed mistake
 * counts for the patterns of its problem (built-in list sections holding its
 * slug). Problems in no built-in list have no pattern.
 */
export async function loadPatternProfile(userId: string, now = new Date()): Promise<PatternStat[]> {
  return patternProfileOf(await loadProfileEvidence(userId, now), now);
}

/** Both profiles from one read of the evidence (the /analysis page shows both). */
export async function loadProfiles(userId: string, now = new Date()): Promise<{ profile: MistakeProfileDto; patterns: PatternStat[] }> {
  const evidence = await loadProfileEvidence(userId, now);
  return { profile: mistakeProfileOf(evidence, now), patterns: patternProfileOf(evidence, now) };
}

/**
 * The pattern x cause profile as /analysis and its API show it: weak
 * patterns first (weakest first), each with problems to practice next, then
 * the rest by sessions.
 */
export async function patternProfileDto(userId: string, patterns: readonly PatternStat[], now = new Date()): Promise<PatternProfileDto> {
  const weak = patterns.filter((stat) => stat.weak);
  const rest = patterns.filter((stat) => !stat.weak).sort((a, b) => b.sessions - a.sessions || a.pattern.localeCompare(b.pattern));
  const next = await loadPatternPractice(userId, weak.map((stat) => stat.pattern), { limit: MAX_PRACTICE });
  return {
    generatedAt: now.toISOString(),
    windowDays: FEED_PARAMS.maxEvidenceAgeDays,
    required: { sessions: PATTERN_PARAMS.readySessions, problems: PATTERN_PARAMS.readyProblems },
    patterns: [...weak, ...rest].map((stat) => ({
      pattern: patternDto(stat.pattern),
      sessions: stat.sessions,
      problems: stat.problems,
      newProblems: stat.newProblems,
      weakness: Math.round(stat.weakness * 1000) / 1000,
      ready: stat.ready,
      weak: stat.weak,
      strong: stat.strong,
      causes: stat.causes,
      next: next.get(stat.pattern) ?? [],
    })),
  };
}

export async function loadPatternProfileDto(userId: string, now = new Date()): Promise<PatternProfileDto> {
  return patternProfileDto(userId, await loadPatternProfile(userId, now), now);
}

function patternProfileOf({ sessions, mistakes, problems, typeBySession }: ProfileEvidence, now: Date): PatternStat[] {
  const patternsOf = (problemId: string) => {
    const slug = problems.get(problemId)?.slug;
    return slug ? patternsForSlug(slug) : [];
  };
  return computePatternProfile({
    now,
    sessions: sessions.map((session) => ({
      id: session.id,
      problemId: session.problemId,
      patterns: patternsOf(session.problemId),
      type: typeBySession.get(session.id) ?? "voluntary_practice",
      status: session.status,
      outcome: session.outcome,
      completedAt: session.completedAt,
      rating: session.rating,
      firstTryAccepted: summarizeSession(session.verdicts).firstTryAccepted,
    })),
    mistakes: mistakes.map((mistake) => ({
      problemId: mistake.problemId,
      patterns: patternsOf(mistake.problemId),
      category: mistake.category,
      status: mistake.status,
      createdAt: mistake.createdAt,
      contextKey: contextKey(mistake),
    })),
  });
}

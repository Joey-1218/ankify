import { FEED_PARAMS, type FeedParams } from "../daily-feed/params";
import { ageInDays, decay, smoothedWeakness } from "../daily-feed/weakness";
import type { SkillDimension } from "../skills";
import type { FsrsRating } from "../types";

/**
 * Pattern mastery: how a technique (a built-in list section's pattern) holds
 * up across the user's sessions, by the same weakness model as dimensions and
 * topics (21-day half-life, 90-day window, Beta smoothing toward the user's
 * overall rate).
 *
 * - A session counts for every pattern of its problem: a rating (Again and
 *   Hard fail, Good and Easy pass) outranks the observed outcome; without a
 *   rating, Accepted passes and not solved fails.
 * - A first practice is a new problem, the transfer test of a pattern, so
 *   its evidence weighs `TRANSFER_FACTOR` more than a review of a known one.
 * - A context (a session, or a legacy record's source) with confirmed
 *   mistakes adds failure evidence once, and its causes are counted for the
 *   pattern x cause grid. Unconfirmed AI findings weigh nothing.
 * - Interrupted or abandoned sessions are not evidence.
 */

export const PATTERN_PARAMS = {
  /** First practices weigh this much more than reviews. */
  transferFactor: 1.5,
  outcomeFailed: 1,
  /** Sessions and distinct problems before a pattern can be called weak or strong. */
  readySessions: 2,
  readyProblems: 2,
  /** A strong pattern: this many problems, and weakness below the weak-exit line. */
  strongProblems: 3,
} as const;

export type PatternSessionInput = {
  id: string;
  problemId: string;
  patterns: readonly string[];
  type: "initial_learning" | "scheduled_review" | "voluntary_practice";
  status: "active" | "interrupted" | "completed" | "abandoned";
  outcome: "accepted" | "failed" | "unknown" | null;
  completedAt: Date | null;
  rating: FsrsRating | null;
  firstTryAccepted: boolean;
};

export type PatternMistakeInput = {
  problemId: string;
  patterns: readonly string[];
  category: SkillDimension;
  status: "candidate" | "confirmed" | "dismissed";
  createdAt: Date;
  /** The session it was recorded in; else the legacy source key. */
  contextKey: string;
};

export type PatternStat = {
  pattern: string;
  sessions: number;
  problems: number;
  /** First practices of new problems in the pattern, and how many were accepted on the first try. */
  newProblems: { total: number; firstTry: number };
  weakness: number;
  ready: boolean;
  weak: boolean;
  strong: boolean;
  /** Confirmed contexts per cause. */
  causes: Partial<Record<SkillDimension, number>>;
  /** The latest first practice of a new problem in the pattern. */
  lastNewAt: Date | null;
};

export function computePatternProfile(
  input: { now: Date; sessions: readonly PatternSessionInput[]; mistakes: readonly PatternMistakeInput[] },
  params: FeedParams = FEED_PARAMS,
): PatternStat[] {
  const { now } = input;
  const inWindow = (at: Date) => ageInDays(at, now) <= params.maxEvidenceAgeDays;
  const weight = (at: Date) => decay(ageInDays(at, now), params);
  type Entry = {
    fail: number;
    pass: number;
    sessions: number;
    problems: Set<string>;
    newTotal: number;
    newFirstTry: number;
    causes: Map<SkillDimension, Set<string>>;
    contexts: Set<string>;
    lastNewAt: Date | null;
  };
  const stats = new Map<string, Entry>();
  const entry = (pattern: string) => {
    let found = stats.get(pattern);
    if (!found) {
      found = { fail: 0, pass: 0, sessions: 0, problems: new Set(), newTotal: 0, newFirstTry: 0, causes: new Map(), contexts: new Set(), lastNewAt: null };
      stats.set(pattern, found);
    }
    return found;
  };

  for (const session of input.sessions) {
    if (session.status !== "completed" || !session.completedAt || !inWindow(session.completedAt) || session.patterns.length === 0) continue;
    const w = params.weights;
    const signal = session.rating
      ? { fail: session.rating === 1 ? w.ratingAgain : session.rating === 2 ? w.ratingHard : 0, pass: session.rating >= 3 ? w.ratingPass : 0 }
      : session.outcome === "accepted"
        ? { fail: 0, pass: w.ratingPass }
        : session.outcome === "failed"
          ? { fail: PATTERN_PARAMS.outcomeFailed, pass: 0 }
          : { fail: 0, pass: 0 };
    const isNew = session.type === "initial_learning";
    const factor = weight(session.completedAt) * (isNew ? PATTERN_PARAMS.transferFactor : 1);
    for (const pattern of session.patterns) {
      const target = entry(pattern);
      target.fail += signal.fail * factor;
      target.pass += signal.pass * factor;
      target.sessions += 1;
      target.problems.add(session.problemId);
      if (isNew) {
        target.newTotal += 1;
        if (session.outcome === "accepted" && session.firstTryAccepted) target.newFirstTry += 1;
        if (!target.lastNewAt || session.completedAt > target.lastNewAt) target.lastNewAt = session.completedAt;
      }
    }
  }

  for (const mistake of input.mistakes) {
    if (mistake.status !== "confirmed" || !inWindow(mistake.createdAt)) continue;
    for (const pattern of mistake.patterns) {
      const target = entry(pattern);
      if (!target.contexts.has(mistake.contextKey)) {
        target.contexts.add(mistake.contextKey);
        target.fail += params.weights.mistake * weight(mistake.createdAt);
      }
      const causes = target.causes.get(mistake.category) ?? new Set<string>();
      causes.add(mistake.contextKey);
      target.causes.set(mistake.category, causes);
    }
  }

  let totalFail = 0;
  let totalPass = 0;
  for (const value of stats.values()) {
    totalFail += value.fail;
    totalPass += value.pass;
  }
  const prior = Math.min(params.globalRateMax, Math.max(params.globalRateMin, (totalFail + 1) / (totalFail + totalPass + 2)));

  return [...stats.entries()]
    .map(([pattern, value]) => {
      const weakness = smoothedWeakness(value.fail, value.pass, prior, params).weakness;
      const problems = value.problems.size;
      const ready = value.sessions >= PATTERN_PARAMS.readySessions && problems >= PATTERN_PARAMS.readyProblems;
      return {
        pattern,
        sessions: value.sessions,
        problems,
        newProblems: { total: value.newTotal, firstTry: value.newFirstTry },
        weakness,
        ready,
        weak: ready && weakness >= params.weakEnter,
        strong: ready && problems >= PATTERN_PARAMS.strongProblems && weakness < params.weakExit,
        causes: Object.fromEntries([...value.causes].map(([category, contexts]) => [category, contexts.size])),
        lastNewAt: value.lastNewAt,
      };
    })
    .sort((a, b) => b.weakness - a.weakness || b.sessions - a.sessions || a.pattern.localeCompare(b.pattern));
}

/**
 * Pacing new problems by a daily time budget (docs/ARCHITECTURE.md, "Study
 * lists"). Reviews come first and are never cut to fit; the time left buys
 * new problems, up to a daily cap. Early on there is little to review, so
 * more new problems fit; as reviews build up, new problems taper by
 * themselves, and the day's total stays near the budget.
 */
export const STUDY_PLAN_DEFAULTS = {
  dailyMinutes: 60,
  maxNewPerDay: 5,
  hidePatternsOnToday: true,
  /** Typical minutes until the user's own medians are known. */
  newMinutes: 35,
  reviewMinutes: 12,
  /** Completed sessions of a kind before their median replaces the default. */
  ownTimesAfter: 5,
} as const;

export const STUDY_PLAN_LIMITS = {
  dailyMinutes: { min: 10, max: 960 },
  maxNewPerDay: { min: 0, max: 100 },
  /** A typical time is kept within these bounds, so one odd session cannot skew pacing. */
  typicalMinutes: { min: 3, max: 240 },
} as const;

/**
 * The typical minutes of a kind of session: the median of the user's own
 * active times once there are enough of them, else the default.
 */
export function typicalMinutes(activeMs: readonly number[], fallback: number, minSamples: number = STUDY_PLAN_DEFAULTS.ownTimesAfter) {
  const samples = activeMs.filter((value) => Number.isFinite(value) && value > 0);
  if (samples.length < minSamples) return { minutes: fallback, own: false };
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  const { min, max } = STUDY_PLAN_LIMITS.typicalMinutes;
  return { minutes: Math.min(max, Math.max(min, Math.round(medianMs / 60_000))), own: true };
}

export type DayPace = {
  /** Reviews the day holds: due now (within the daily limit) plus those done today. */
  reviews: number;
  reviewMinutes: number;
  newMinutes: number;
  /** New problems the day's budget buys, including those already started today. */
  newSlots: number;
  /** Planned minutes: reviews plus the new slots. */
  plannedMinutes: number;
};

/**
 * `new = round((budget − reviews × reviewMinutes) / newMinutes)`, clamped to
 * [0, maxNewPerDay]. Rounding to the nearest problem lets a 60-minute day with
 * nothing to review hold two 35-minute problems.
 */
export function paceDay(input: {
  dailyMinutes: number;
  maxNewPerDay: number;
  reviews: number;
  reviewMinutes: number;
  newMinutes: number;
}): DayPace {
  const left = input.dailyMinutes - input.reviews * input.reviewMinutes;
  const bought = input.newMinutes > 0 ? Math.round(left / input.newMinutes) : 0;
  const newSlots = Math.max(0, Math.min(input.maxNewPerDay, bought));
  return {
    reviews: input.reviews,
    reviewMinutes: input.reviewMinutes,
    newMinutes: input.newMinutes,
    newSlots,
    plannedMinutes: input.reviews * input.reviewMinutes + newSlots * input.newMinutes,
  };
}

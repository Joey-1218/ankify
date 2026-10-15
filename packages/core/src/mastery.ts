/** Thresholds for "Ready to archive": FSRS expects the user to still solve
 *  the problem months from now, after several rated reviews. */
export const MASTERY_CANDIDATE = { minStabilityDays: 90, minReviews: 3 } as const;

export type MasteryCandidateInput = {
  enrollment: "enrolled" | "awaiting_initial";
  fsrsState: "new" | "learning" | "review" | "relearning";
  fsrsReps: number;
  fsrsStability: number | null;
};

/** A problem the user has likely mastered: in steady review (not relearning),
 *  rated at least `minReviews` times, with stability of `minStabilityDays` or
 *  more (90% recall that many days after the last review). A hint for
 *  archiving only; nothing is archived automatically. */
export function isMasteryCandidate(problem: MasteryCandidateInput) {
  return (
    problem.enrollment === "enrolled" &&
    problem.fsrsState === "review" &&
    problem.fsrsReps >= MASTERY_CANDIDATE.minReviews &&
    (problem.fsrsStability ?? 0) >= MASTERY_CANDIDATE.minStabilityDays
  );
}

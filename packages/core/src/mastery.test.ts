import { describe, expect, it } from "vitest";
import { isMasteryCandidate, MASTERY_CANDIDATE, type MasteryCandidateInput } from "./mastery";

const mastered: MasteryCandidateInput = {
  enrollment: "enrolled",
  fsrsState: "review",
  fsrsReps: MASTERY_CANDIDATE.minReviews,
  fsrsStability: MASTERY_CANDIDATE.minStabilityDays,
};

describe("isMasteryCandidate", () => {
  it("accepts a problem exactly at both thresholds", () => {
    expect(isMasteryCandidate(mastered)).toBe(true);
  });

  it("needs enough stability and enough rated reviews", () => {
    expect(isMasteryCandidate({ ...mastered, fsrsStability: MASTERY_CANDIDATE.minStabilityDays - 0.1 })).toBe(false);
    expect(isMasteryCandidate({ ...mastered, fsrsStability: null })).toBe(false);
    expect(isMasteryCandidate({ ...mastered, fsrsReps: MASTERY_CANDIDATE.minReviews - 1 })).toBe(false);
  });

  it("excludes problems outside steady review", () => {
    for (const fsrsState of ["new", "learning", "relearning"] as const) {
      expect(isMasteryCandidate({ ...mastered, fsrsState })).toBe(false);
    }
    expect(isMasteryCandidate({ ...mastered, enrollment: "awaiting_initial" })).toBe(false);
  });
});

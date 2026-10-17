import { getDb, schema } from "@ankileet/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { listProblemMistakes } from "./mistakes";
import { listPracticeSessions } from "./practice-sessions/queries";
import { publicSubmissionColumns, toSubmissionDto } from "./public-dto";

export async function loadProblemDetail(userId: string, problemId: string) {
  const db = getDb();
  const [problem] = await db
    .select()
    .from(schema.problems)
    .where(and(eq(schema.problems.id, problemId), eq(schema.problems.userId, userId)))
    .limit(1);
  if (!problem) return null;

  const [submissions, reviewHistory, mistakes] = await Promise.all([
    db
      .select(publicSubmissionColumns)
      .from(schema.submissions)
      .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.problemId, problemId)))
      .orderBy(desc(schema.submissions.submittedAt))
      .limit(10),
    // The scheduling timeline: ratings and initial-review schedules, not undone
    // (Undo, or deleting the session that made them).
    db
      .select()
      .from(schema.reviewEvents)
      .where(
        and(
          eq(schema.reviewEvents.userId, userId),
          eq(schema.reviewEvents.problemId, problemId),
          inArray(schema.reviewEvents.eventType, ["self_recall_rated", "fsrs_scheduled"]),
          isNull(schema.reviewEvents.undoneAt),
        ),
      )
      .orderBy(desc(schema.reviewEvents.occurredAt))
      .limit(30),
    listProblemMistakes(userId, problemId),
  ]);
  const { sessions } = await listPracticeSessions(userId, { problemId, limit: 20 });

  return {
    problem,
    submissions: submissions.map(toSubmissionDto),
    timeline: reviewHistory.map((event) => ({
      id: event.id,
      kind: event.eventType === "fsrs_scheduled" ? ("scheduled" as const) : ("rated" as const),
      rating: event.fsrsRating,
      method: event.reviewMethod,
      practiceSessionId: event.practiceSessionId,
      occurredAt: event.occurredAt,
      nextDue: timelineDue(event.metadata),
      stability: event.fsrsStabilitySnap,
      difficulty: event.fsrsDifficultySnap,
    })),
    sessions,
    mistakes,
  };
}

/** The due date an event set: a rating's next review or the first review. */
function timelineDue(metadata: Record<string, unknown> | null): string | null {
  const meta = metadata as { result?: { nextDue?: unknown }; initialReview?: { due?: unknown } } | null;
  const due = meta?.result?.nextDue ?? meta?.initialReview?.due;
  return typeof due === "string" ? due : null;
}

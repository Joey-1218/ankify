import type { PracticeSessionDeleteResponseDto } from "@ankileet/contracts";
import { isSessionStale } from "@ankileet/core";
import { getDb, schema } from "@ankileet/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { undoRatingEvent } from "@/server/review-commands";
import { toProblemStatusDto } from "./dto";
import { undoInitialSchedule } from "./scheduling";
import { fail, loadProblem, loadSession, sessionDto, type SessionFailure } from "./store";

type DeleteResult = { ok: true; response: PracticeSessionDeleteResponseDto } | SessionFailure;

/** Carries a refusal out of the transaction so its writes roll back. */
class DeleteRefused extends Error {
  constructor(readonly failure: SessionFailure) {
    super(failure.error);
  }
}

const ps = schema.practiceSessions;

/**
 * Deletes a finished session the user calls invalid, together with what it
 * did. Its rating, or the first review its initial learning scheduled, is
 * undone first; that is refused while a later change to the problem's
 * schedule is still in effect (delete or undo that one first). Its mistake
 * records are deleted; observations, commands, analyses, AI jobs, and
 * improvements go with the row. The undone events stay as history without the
 * link, and the problem's LeetCode submissions stay. An open session is
 * abandoned instead (a stale one is history and may be deleted), and no
 * session is deleted while its problem has another live open one, so a
 * running session never sees its schedule change underneath it.
 */
export async function deletePracticeSession(userId: string, sessionId: string, now = new Date()): Promise<DeleteResult> {
  try {
    return await getDb().transaction(async (tx): Promise<DeleteResult> => {
      const session = await loadSession(tx, userId, sessionId);
      if (!session) return fail("session_not_found");
      const problem = (await loadProblem(tx, userId, session.problemId))!;
      const refuse = async (error: SessionFailure["error"]) =>
        new DeleteRefused(fail(error, await sessionDto(tx, userId, session, problem, now)));
      // An open session is abandoned instead, unless it is stale history.
      if (session.isOpen && !isSessionStale(session, now)) return fail("invalid_transition", await sessionDto(tx, userId, session, problem, now));
      const open = await tx
        .select()
        .from(ps)
        .where(and(eq(ps.userId, userId), eq(ps.problemId, session.problemId), eq(ps.isOpen, true)));
      if (open.some((row) => row.id !== session.id && !isSessionStale(row, now))) {
        return fail("open_session_conflict", await sessionDto(tx, userId, session, problem, now));
      }

      const e = schema.reviewEvents;
      // A session has at most one scheduling event (its rating, or its first
      // review); newest first all the same, so its own events never block.
      const events = await tx
        .select()
        .from(e)
        .where(and(eq(e.userId, userId), eq(e.practiceSessionId, session.id), isNull(e.undoneAt)))
        .orderBy(desc(e.scheduleRevision));
      for (const event of events) {
        const undone =
          event.eventType === "fsrs_scheduled"
            ? await undoInitialSchedule(tx, userId, event, now)
            : event.eventType === "self_recall_rated"
              ? await undoRatingEvent(tx, userId, event, now)
              : { ok: true as const };
        if (!undone.ok) throw await refuse("undo_conflict");
      }

      const m = schema.mistakeRecords;
      await tx.delete(m).where(and(eq(m.userId, userId), eq(m.practiceSessionId, session.id)));
      await tx.delete(ps).where(and(eq(ps.id, session.id), eq(ps.userId, userId)));
      const after = (await loadProblem(tx, userId, session.problemId))!;
      return { ok: true, response: { ok: true, deletedSessionId: session.id, problem: toProblemStatusDto(after, now) } };
    });
  } catch (error) {
    if (error instanceof DeleteRefused) return error.failure;
    throw error;
  }
}

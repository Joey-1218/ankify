import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PracticeSessionStartInput } from "@ankileet/contracts";
import { getDb, schema } from "@ankileet/db";
import { and, eq } from "drizzle-orm";
import { createMistake } from "../mistakes";
import { rateProblemReview } from "../review-commands";
import { loadReviewQueueData } from "../review-queue-data";
import { createTestDb } from "../test-db";
import { ingestSessionObservations, runSessionCommand, startPracticeSession } from "./commands";
import { deletePracticeSession } from "./delete";
import { ratePracticeSession } from "./scheduling";

const testDb = createTestDb();
const USER = "delete-owner";
const OTHER = "delete-other";
const TAB = "aaaaaaaa-0000-4000-8000-00000000000a";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = new Date(Math.floor(Date.now() / MIN) * MIN - 3 * DAY);
const at = (ms: number) => new Date(T0.getTime() + ms);
const uuid = () => crypto.randomUUID();

const db = () => getDb();
const problemRow = async (id: string) => (await db().select().from(schema.problems).where(eq(schema.problems.id, id)))[0]!;
const sessionRows = async (problemId: string) => db().select().from(schema.practiceSessions).where(eq(schema.practiceSessions.problemId, problemId));
const events = async (problemId: string) => db().select().from(schema.reviewEvents).where(eq(schema.reviewEvents.problemId, problemId));

function scheduling(row: Awaited<ReturnType<typeof problemRow>>) {
  return {
    enrollment: row.enrollment, fsrsDue: row.fsrsDue, fsrsStability: row.fsrsStability, fsrsDifficulty: row.fsrsDifficulty,
    fsrsReps: row.fsrsReps, fsrsLapses: row.fsrsLapses, fsrsState: row.fsrsState, fsrsLastReview: row.fsrsLastReview,
  };
}

async function start(overrides: Partial<PracticeSessionStartInput>, now: Date, userId = USER) {
  const result = await startPracticeSession(userId, {
    requestId: uuid(),
    target: { kind: "leetcode", problem: { leetcodeSlug: "two-sum", leetcodeId: 1, title: "Two Sum", difficulty: "Easy", url: "https://leetcode.com/problems/two-sum/", topicTags: [], similarSlugs: [] } },
    mode: "practice",
    ownerToken: TAB,
    baseline: { state: "none" },
    supersedePendingRating: false,
    ...overrides,
  }, now);
  if (!result.ok) throw new Error(`start failed: ${result.error}`);
  return result.response;
}

async function finish(sessionId: string, now: Date, result: "solved" | "unsuccessful" = "solved", userId = USER) {
  const response = await runSessionCommand(userId, sessionId, { type: "finish", requestId: uuid(), ownerToken: TAB, result, occurredAt: now.toISOString() }, now);
  if (!response.ok) throw new Error(`finish failed: ${response.error}`);
  return response.response.session;
}

async function insertDueProblem(id: string, slug: string, userId = USER) {
  await db().insert(schema.problems).values({
    id, userId, leetcodeSlug: slug, title: slug, difficulty: "Medium", url: `https://leetcode.com/problems/${slug}/`,
    fsrsState: "review", fsrsReps: 3, fsrsLapses: 0, fsrsStability: 6, fsrsDifficulty: 5, fsrsElapsedDays: 6, fsrsScheduledDays: 6,
    fsrsLastReview: at(-6 * DAY), fsrsDue: at(-HOUR),
  });
}

async function review(problemId: string, startAt: Date, result: "solved" | "unsuccessful") {
  const { session } = await start({ target: { kind: "problem", problemId }, mode: "due_review" }, startAt);
  return finish(session.id, new Date(startAt.getTime() + 20 * MIN), result);
}

beforeAll(() => testDb.migrate());
beforeEach(async () => {
  await db().delete(schema.user);
  await db().insert(schema.user).values([
    { id: USER, name: "Owner", email: "delete@example.test" },
    { id: OTHER, name: "Other", email: "delete-other@example.test" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("deleting a session", () => {
  it("undoes a review's rating and removes its evidence and mistakes, keeping LeetCode submissions", async () => {
    await insertDueProblem("p1", "one");
    const before = await problemRow("p1");
    const { session } = await start({ target: { kind: "problem", problemId: "p1" }, mode: "due_review" }, T0);
    await ingestSessionObservations(USER, session.id, {
      observations: [{ leetcodeSubmissionId: "9001", verdict: "Wrong Answer", submittedAt: at(MIN).toISOString(), detail: { language: "python3", code: "return 0" } }],
    }, at(MIN));
    await finish(session.id, at(20 * MIN), "unsuccessful");
    const mistake = await createMistake(USER, { sourceType: "practice_session", practiceSessionId: session.id, problemId: "p1", primaryCategory: "edge_case", requestId: uuid() });
    expect(mistake.ok).toBe(true);
    expect((await problemRow("p1")).fsrsLapses).toBe(1);

    const result = await deletePracticeSession(USER, session.id, at(HOUR));
    expect(result).toMatchObject({ ok: true, response: { deletedSessionId: session.id, problem: { id: "p1", due: true } } });

    expect(scheduling(await problemRow("p1"))).toEqual(scheduling(before));
    expect(await sessionRows("p1")).toEqual([]);
    const [rating] = (await events("p1")).filter((event) => event.eventType === "self_recall_rated");
    expect(rating).toMatchObject({ practiceSessionId: null, fsrsRating: 1, undoneAt: at(HOUR) });
    expect(await db().select().from(schema.mistakeRecords).where(eq(schema.mistakeRecords.userId, USER))).toEqual([]);
    expect(await db().select().from(schema.practiceSessionSubmissions).where(eq(schema.practiceSessionSubmissions.userId, USER))).toEqual([]);
    expect(await db().select().from(schema.practiceSessionCommands).where(eq(schema.practiceSessionCommands.userId, USER))).toEqual([]);
    expect((await db().select().from(schema.submissions).where(eq(schema.submissions.userId, USER))).map((row) => row.leetcodeSubmissionId)).toEqual(["9001"]);
    // Due again, and a new review can start and be rated.
    expect((await loadReviewQueueData(USER, 20)).problems.map((item) => item.id)).toEqual(["p1"]);
    expect((await review("p1", at(2 * HOUR), "unsuccessful")).rating.disposition).toBe("submitted");
  });

  it("puts a problem whose initial learning is deleted back to awaiting it", async () => {
    const { session, problem } = await start({}, T0);
    await finish(session.id, at(10 * MIN), "unsuccessful");
    expect(await problemRow(problem.id)).toMatchObject({ enrollment: "enrolled", scheduleRevision: 1 });

    const result = await deletePracticeSession(USER, session.id, at(HOUR));
    expect(result).toMatchObject({ ok: true, response: { problem: { enrollment: "awaiting_initial", fsrsDue: null, due: false } } });
    expect(await problemRow(problem.id)).toMatchObject({ enrollment: "awaiting_initial", fsrsDue: null, scheduleRevision: 2 });
    expect((await events(problem.id)).find((event) => event.eventType === "fsrs_scheduled")).toMatchObject({ practiceSessionId: null, undoneAt: at(HOUR) });
    expect((await loadReviewQueueData(USER, 20)).problems).toEqual([]);

    // The next attempt is initial learning again and schedules anew.
    const again = await start({}, at(2 * HOUR));
    expect(again.session.type).toBe("initial_learning");
    await finish(again.session.id, at(2 * HOUR + 10 * MIN));
    expect(await problemRow(problem.id)).toMatchObject({ enrollment: "enrolled", fsrsDue: at(2 * HOUR + 10 * MIN + DAY), scheduleRevision: 3 });
  });

  it("clears a pending rating, so other reviews can start", async () => {
    await insertDueProblem("p1", "one");
    await insertDueProblem("p2", "two");
    const pending = await review("p1", T0, "solved");
    expect(pending.rating.disposition).toBe("pending");
    const blocked = await startPracticeSession(USER, { requestId: uuid(), target: { kind: "problem", problemId: "p2" }, mode: "due_review", ownerToken: TAB, supersedePendingRating: false }, at(HOUR));
    expect(blocked).toMatchObject({ ok: false, error: "rating_pending" });

    const before = await problemRow("p1");
    expect((await deletePracticeSession(USER, pending.id, at(HOUR))).ok).toBe(true);
    expect(await problemRow("p1")).toEqual(before);
    expect((await start({ target: { kind: "problem", problemId: "p2" }, mode: "due_review" }, at(2 * HOUR))).created).toBe(true);
  });

  it("deletes a voluntary practice without touching the schedule", async () => {
    await insertDueProblem("p1", "one");
    const before = await problemRow("p1");
    const { session } = await start({ target: { kind: "problem", problemId: "p1" } }, T0);
    await finish(session.id, at(10 * MIN), "unsuccessful");
    expect((await deletePracticeSession(USER, session.id, at(HOUR))).ok).toBe(true);
    expect(await problemRow("p1")).toEqual(before);
    expect(await sessionRows("p1")).toEqual([]);
  });

  it("refuses open sessions, a problem with an open session, and another user's session", async () => {
    await insertDueProblem("p1", "one");
    const finished = await review("p1", T0, "unsuccessful");
    const open = await start({ target: { kind: "problem", problemId: "p1" } }, at(HOUR));

    expect(await deletePracticeSession(USER, open.session.id, at(HOUR))).toMatchObject({ ok: false, error: "invalid_transition", session: { id: open.session.id } });
    expect(await deletePracticeSession(USER, finished.id, at(HOUR))).toMatchObject({ ok: false, error: "open_session_conflict" });
    expect(await deletePracticeSession(OTHER, finished.id, at(HOUR))).toEqual({ ok: false, error: "session_not_found" });
    expect((await sessionRows("p1")).map((row) => row.id).sort()).toEqual([finished.id, open.session.id].sort());
  });

  it("deletes a stale interrupted session, which never scheduled anything", async () => {
    const { session, problem } = await start({}, T0);
    expect(await deletePracticeSession(USER, session.id, at(HOUR))).toMatchObject({ ok: false, error: "invalid_transition" });
    expect((await deletePracticeSession(USER, session.id, at(25 * HOUR))).ok).toBe(true);
    expect(await problemRow(problem.id)).toMatchObject({ enrollment: "awaiting_initial", scheduleRevision: 0 });
    expect((await start({}, at(26 * HOUR))).session.type).toBe("initial_learning");
  });

  it("refuses while a later scheduling change is in effect, changing nothing, and allows newest first", async () => {
    await insertDueProblem("p1", "one");
    const before = await problemRow("p1");
    const first = await review("p1", T0, "unsuccessful");
    // Due again a day after the lapse; rate the second review Good.
    const second = await review("p1", at(3 * DAY), "solved");
    expect((await ratePracticeSession(USER, second.id, { requestId: uuid(), rating: 3 }, at(3 * DAY + HOUR))).ok).toBe(true);
    const rated = await problemRow("p1");

    expect(await deletePracticeSession(USER, first.id, at(4 * DAY))).toMatchObject({ ok: false, error: "undo_conflict", session: { id: first.id } });
    expect(await problemRow("p1")).toEqual(rated);
    expect((await events("p1")).every((event) => event.undoneAt == null)).toBe(true);

    expect((await deletePracticeSession(USER, second.id, at(4 * DAY))).ok).toBe(true);
    expect((await deletePracticeSession(USER, first.id, at(4 * DAY))).ok).toBe(true);
    expect(scheduling(await problemRow("p1"))).toEqual(scheduling(before));
  });

  it("refuses an initial learning whose problem was reviewed since", async () => {
    const { session, problem } = await start({}, T0);
    await finish(session.id, at(10 * MIN));
    await rateProblemReview(USER, { problemId: problem.id, rating: 3, requestId: uuid() });
    expect(await deletePracticeSession(USER, session.id, at(HOUR))).toMatchObject({ ok: false, error: "undo_conflict" });
    expect(await problemRow(problem.id)).toMatchObject({ enrollment: "enrolled" });
    expect((await db().select().from(schema.practiceSessions).where(and(eq(schema.practiceSessions.id, session.id))))).toHaveLength(1);
  });
});

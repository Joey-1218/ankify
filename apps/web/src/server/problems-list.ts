import { getDb, schema } from "@ankileet/db";
import type { ProblemsListPayloadDto } from "@ankileet/contracts";
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { MAX_PROBLEMS_PER_USER } from "./resource-limits";

// One page holds a whole active deck (the cap counts only active problems),
// so sorting and filtering in the browser see every problem. Only an archived
// list larger than the cap pages.
const MAX_PROBLEMS_PAGE_SIZE = MAX_PROBLEMS_PER_USER;
export const DEFAULT_PROBLEMS_PAGE_SIZE = MAX_PROBLEMS_PAGE_SIZE;

type ProblemsCursor = { createdAt: string; id: string };

export class InvalidProblemsCursorError extends Error {}

function decodeCursor(value: string | null): { createdAt: Date; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as ProblemsCursor;
    const createdAt = new Date(parsed.createdAt);
    if (!parsed.id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id } satisfies ProblemsCursor),
  ).toString("base64url");
}

export async function loadProblemsList(
  userId: string,
  options: {
    search?: string;
    archivedOnly?: boolean;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<ProblemsListPayloadDto> {
  const db = getDb();
  const now = new Date();
  const search = options.search?.trim() ?? "";
  const archivedOnly = options.archivedOnly ?? false;
  const requestedLimit = options.limit ?? DEFAULT_PROBLEMS_PAGE_SIZE;
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_PROBLEMS_PAGE_SIZE)
    : DEFAULT_PROBLEMS_PAGE_SIZE;
  const cursorParam = options.cursor ?? null;
  const cursor = decodeCursor(cursorParam);
  if (cursorParam && !cursor) throw new InvalidProblemsCursorError();

  const baseConditions = [
    eq(schema.problems.userId, userId),
    archivedOnly ? isNotNull(schema.problems.archivedAt) : isNull(schema.problems.archivedAt),
  ];
  if (search) baseConditions.push(like(schema.problems.title, `%${search}%`));

  const cursorCondition = cursor
    ? or(
        lt(schema.problems.createdAt, cursor.createdAt),
        and(
          eq(schema.problems.createdAt, cursor.createdAt),
          lt(schema.problems.id, cursor.id),
        ),
      )
    : undefined;

  // Last completed practice of any type, and how many there were.
  const ps = schema.practiceSessions;
  const practiced = db
    .select({
      problemId: ps.problemId,
      lastPracticedAt: sql<Date | null>`max(coalesce(${ps.completedAt}, ${ps.startedAt}))`
        .mapWith(ps.completedAt)
        .as("last_practiced_at"),
      practiceCount: sql<number>`count(*)`.as("practice_count"),
    })
    .from(ps)
    .where(and(eq(ps.userId, userId), eq(ps.status, "completed")))
    .groupBy(ps.problemId)
    .as("practiced");

  const [problemRows, totalRows, archivedRows, [dueRow]] = await Promise.all([
    db
      .select({
        id: schema.problems.id,
        leetcodeSlug: schema.problems.leetcodeSlug,
        leetcodeId: schema.problems.leetcodeId,
        title: schema.problems.title,
        difficulty: schema.problems.difficulty,
        topicTags: schema.problems.topicTags,
        fsrsDue: schema.problems.fsrsDue,
        fsrsReps: schema.problems.fsrsReps,
        fsrsLapses: schema.problems.fsrsLapses,
        fsrsState: schema.problems.fsrsState,
        fsrsStability: schema.problems.fsrsStability,
        fsrsLastReview: schema.problems.fsrsLastReview,
        enrollment: schema.problems.enrollment,
        archivedAt: schema.problems.archivedAt,
        createdAt: schema.problems.createdAt,
        lastPracticedAt: practiced.lastPracticedAt,
        practiceCount: practiced.practiceCount,
      })
      .from(schema.problems)
      .leftJoin(practiced, eq(practiced.problemId, schema.problems.id))
      .where(and(...baseConditions, cursorCondition))
      .orderBy(desc(schema.problems.createdAt), desc(schema.problems.id))
      .limit(limit + 1),
    cursor
      ? Promise.resolve([])
      : db
          .select({ count: sql<number>`count(*)` })
          .from(schema.problems)
          .where(and(...baseConditions)),
    cursor
      ? Promise.resolve([])
      : db
          .select({ count: sql<number>`count(*)` })
          .from(schema.problems)
          .where(and(eq(schema.problems.userId, userId), isNotNull(schema.problems.archivedAt))),
    db
      .select({ count: sql<number>`count(*)` })
      .from(schema.problems)
      .where(dueProblemCondition(userId, now)),
  ]);

  const hasMore = problemRows.length > limit;
  const problems = hasMore ? problemRows.slice(0, limit) : problemRows;

  const lastProblem = problems.at(-1);

  return {
    problems: problems.map(({ fsrsLastReview, lastPracticedAt, practiceCount, ...problem }) => ({
      ...problem,
      lastPracticedAt: (lastPracticedAt ?? fsrsLastReview)?.toISOString() ?? null,
      practiceCount: practiceCount ?? 0,
      fsrsDue: problem.fsrsDue?.toISOString() ?? null,
      archivedAt: problem.archivedAt?.toISOString() ?? null,
      createdAt: problem.createdAt.toISOString(),
    })),
    dueCount: dueRow?.count ?? 0,
    serverNow: now.toISOString(),
    ...(cursor
      ? {}
      : { totalCount: totalRows[0]?.count ?? 0, archivedCount: archivedRows[0]?.count ?? 0 }),
    nextCursor:
      hasMore && lastProblem
        ? encodeCursor(lastProblem.createdAt, lastProblem.id)
        : null,
  };
}

import { getDb, schema } from "@ankileet/db";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { dueProblemCondition } from "./due-problems";
import { MAX_PROBLEMS_PER_USER } from "./resource-limits";

export type ProblemsArchiveResult =
  | { ok: true; updated: number; dueCount: number }
  | { ok: false; error: "problem_limit_reached"; message: string };

/** Archive or unarchive several of the user's problems in one transaction.
 *  Ids the user doesn't own, or already in the requested state, are skipped.
 *  Unarchiving may not take the active deck past the per-user cap. */
export async function setProblemsArchived(
  userId: string,
  problemIds: string[],
  archived: boolean,
  now = new Date(),
): Promise<ProblemsArchiveResult> {
  const p = schema.problems;
  const ids = [...new Set(problemIds)];
  return getDb().transaction(async (tx): Promise<ProblemsArchiveResult> => {
    const target = and(
      eq(p.userId, userId),
      inArray(p.id, ids),
      archived ? isNull(p.archivedAt) : isNotNull(p.archivedAt),
    );

    if (!archived) {
      const countWhere = async (where: ReturnType<typeof and>) => {
        const [row] = await tx.select({ count: sql<number>`count(*)` }).from(p).where(where);
        return row?.count ?? 0;
      };
      const active = await countWhere(and(eq(p.userId, userId), isNull(p.archivedAt)));
      const restoring = await countWhere(target);
      if (active + restoring > MAX_PROBLEMS_PER_USER) {
        return {
          ok: false,
          error: "problem_limit_reached",
          message: `Unarchiving these would pass the limit of ${MAX_PROBLEMS_PER_USER} active problems.`,
        };
      }
    }

    const updated = await tx
      .update(p)
      .set({ archivedAt: archived ? now : null, updatedAt: now })
      .where(target)
      .returning({ id: p.id });
    const [due] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(p)
      .where(dueProblemCondition(userId, now));
    return { ok: true, updated: updated.length, dueCount: due?.count ?? 0 };
  });
}

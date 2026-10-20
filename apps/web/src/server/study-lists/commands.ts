import type { StudyListCreateInput, StudyListItemAddInput, StudyListPatchInput } from "@ankileet/contracts";
import { getDb, schema, type StudyList } from "@ankileet/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { MAX_ITEMS_PER_STUDY_LIST, MAX_STUDY_LISTS_PER_USER } from "@/server/resource-limits";
import type { DbTransaction } from "../practice-sessions/store";
import { builtinProblem, getBuiltinList } from "./builtin";

const l = schema.studyLists;
const i = schema.studyListItems;

export type StudyListError =
  | "list_not_found"
  | "builtin_not_found"
  | "problem_not_found"
  /** The slug is in no built-in list, so the server has no metadata for it. */
  | "problem_not_listed"
  | "list_limit_reached"
  | "item_limit_reached"
  /** Built-in lists are read-only; renaming applies to custom lists. */
  | "not_editable"
  | "order_mismatch"
  | "request_conflict";

export type StudyListFailure = { ok: false; error: StudyListError; message?: string };

const fail = (error: StudyListError, message?: string): StudyListFailure => ({ ok: false, error, ...(message ? { message } : {}) });

async function loadRow(tx: DbTransaction, userId: string, listId: string) {
  const [row] = await tx.select().from(l).where(and(eq(l.id, listId), eq(l.userId, userId))).limit(1);
  return row ?? null;
}

/** Whether a stored list is what this request would have created. */
function sameRequest(row: StudyList, input: StudyListCreateInput) {
  if (input.action === "follow") return row.kind === "builtin" && row.builtinId === input.builtinId;
  return row.kind === "custom" && row.name === input.name;
}

/**
 * Creates a custom list, follows a built-in list, or copies one into a new
 * custom list (its distinct problems in list order). Idempotent per request
 * id; following a list already followed returns that list.
 */
export async function createStudyList(
  userId: string,
  input: StudyListCreateInput,
  now = new Date(),
): Promise<{ ok: true; listId: string; created: boolean } | StudyListFailure> {
  const builtin = input.action === "create" ? null : getBuiltinList(input.builtinId);
  if (input.action !== "create" && !builtin) return fail("builtin_not_found");

  return getDb().transaction(async (tx) => {
    const [replay] = await tx.select().from(l).where(and(eq(l.userId, userId), eq(l.requestId, input.requestId))).limit(1);
    if (replay) return sameRequest(replay, input) ? { ok: true, listId: replay.id, created: false } : fail("request_conflict");
    if (input.action === "follow") {
      const [followed] = await tx
        .select({ id: l.id })
        .from(l)
        .where(and(eq(l.userId, userId), eq(l.kind, "builtin"), eq(l.builtinId, input.builtinId)))
        .limit(1);
      if (followed) return { ok: true, listId: followed.id, created: false };
    }

    const [{ count, maxPosition } = { count: 0, maxPosition: -1 }] = await tx
      .select({ count: sql<number>`count(*)`, maxPosition: sql<number>`coalesce(max(${l.position}), -1)` })
      .from(l)
      .where(eq(l.userId, userId));
    if (Number(count) >= MAX_STUDY_LISTS_PER_USER) {
      return fail("list_limit_reached", `You can have up to ${MAX_STUDY_LISTS_PER_USER} lists. Delete or unfollow one first.`);
    }

    const id = nanoid(12);
    const inserted = await tx
      .insert(l)
      .values({
        id,
        userId,
        kind: input.action === "follow" ? "builtin" : "custom",
        builtinId: input.action === "follow" ? input.builtinId : null,
        name: input.action === "follow" ? null : input.name,
        requestId: input.requestId,
        position: Number(maxPosition) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: l.id });
    if (inserted.length === 0) {
      // A concurrent request followed the same list (or used the same id).
      const [winner] = await tx
        .select()
        .from(l)
        .where(and(eq(l.userId, userId), input.action === "follow" ? eq(l.builtinId, input.builtinId) : eq(l.requestId, input.requestId)))
        .limit(1);
      return winner && sameRequest(winner, input) ? { ok: true, listId: winner.id, created: false } : fail("request_conflict");
    }

    if (input.action === "copy") {
      const seen = new Set<string>();
      const rows = builtin!.items
        .filter((item) => !seen.has(item.slug) && seen.add(item.slug))
        .slice(0, MAX_ITEMS_PER_STUDY_LIST)
        .map((item, position) => ({
          id: nanoid(12),
          userId,
          listId: id,
          slug: item.slug,
          leetcodeId: Number(item.frontendId),
          title: item.title.en,
          titleZh: item.title.zh,
          difficulty: item.difficulty,
          position,
          createdAt: now,
          updatedAt: now,
        }));
      // Batched to stay under SQLite's host-parameter limit.
      for (let start = 0; start < rows.length; start += 50) await tx.insert(i).values(rows.slice(start, start + 50));
    }
    return { ok: true, listId: id, created: true };
  });
}

/** Renames a custom list, or pauses, resumes, or reweights any list. */
export async function updateStudyList(
  userId: string,
  listId: string,
  patch: StudyListPatchInput,
  now = new Date(),
): Promise<{ ok: true } | StudyListFailure> {
  return getDb().transaction(async (tx) => {
    const row = await loadRow(tx, userId, listId);
    if (!row) return fail("list_not_found");
    if (patch.name !== undefined && row.kind !== "custom") return fail("not_editable", "Built-in lists keep their own name.");
    await tx
      .update(l)
      .set({ ...patch, updatedAt: now })
      .where(and(eq(l.id, row.id), eq(l.userId, userId)));
    return { ok: true };
  });
}

/**
 * Deletes a custom list (its items cascade) or unfollows a built-in one.
 * Problems are untouched: one in no other list shows in My problems again.
 */
export async function deleteStudyList(userId: string, listId: string): Promise<{ ok: true } | StudyListFailure> {
  const deleted = await getDb()
    .delete(l)
    .where(and(eq(l.id, listId), eq(l.userId, userId)))
    .returning({ id: l.id });
  return deleted.length > 0 ? { ok: true } : fail("list_not_found");
}

/**
 * Adds a problem to the end of a custom list: one of the deck's, or one a
 * built-in list holds. Metadata comes from the server's own rows. Adding a
 * problem the list already has returns that item.
 */
export async function addStudyListItem(
  userId: string,
  listId: string,
  input: StudyListItemAddInput,
  now = new Date(),
): Promise<{ ok: true; itemId: string; created: boolean } | StudyListFailure> {
  return getDb().transaction(async (tx) => {
    const row = await loadRow(tx, userId, listId);
    if (!row) return fail("list_not_found");
    if (row.kind !== "custom") return fail("not_editable", "Built-in lists are read-only; copy one to edit it.");

    let target: { slug: string; leetcodeId: number | null; title: string; titleZh: string | null; difficulty: "Easy" | "Medium" | "Hard" };
    if (input.source === "problem") {
      const p = schema.problems;
      const [problem] = await tx
        .select({ slug: p.leetcodeSlug, leetcodeId: p.leetcodeId, title: p.title, difficulty: p.difficulty })
        .from(p)
        .where(and(eq(p.id, input.problemId), eq(p.userId, userId)))
        .limit(1);
      if (!problem) return fail("problem_not_found");
      target = { ...problem, titleZh: builtinProblem(problem.slug)?.title.zh ?? null };
    } else {
      const listed = builtinProblem(input.slug);
      if (!listed) return fail("problem_not_listed");
      target = { slug: listed.slug, leetcodeId: Number(listed.frontendId), title: listed.title.en, titleZh: listed.title.zh, difficulty: listed.difficulty };
    }

    const existing = async () => {
      const [item] = await tx
        .select({ id: i.id })
        .from(i)
        .where(and(eq(i.listId, row.id), eq(i.userId, userId), eq(i.slug, target.slug)))
        .limit(1);
      return item ?? null;
    };
    const found = await existing();
    if (found) return { ok: true, itemId: found.id, created: false };

    const [{ count, maxPosition } = { count: 0, maxPosition: -1 }] = await tx
      .select({ count: sql<number>`count(*)`, maxPosition: sql<number>`coalesce(max(${i.position}), -1)` })
      .from(i)
      .where(and(eq(i.listId, row.id), eq(i.userId, userId)));
    if (Number(count) >= MAX_ITEMS_PER_STUDY_LIST) {
      return fail("item_limit_reached", `A list holds up to ${MAX_ITEMS_PER_STUDY_LIST} problems.`);
    }
    const id = nanoid(12);
    const inserted = await tx
      .insert(i)
      .values({ id, userId, listId: row.id, ...target, position: Number(maxPosition) + 1, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning({ id: i.id });
    if (inserted.length > 0) {
      await tx.update(l).set({ updatedAt: now }).where(and(eq(l.id, row.id), eq(l.userId, userId)));
      return { ok: true, itemId: id, created: true };
    }
    const raced = await existing();
    return raced ? { ok: true, itemId: raced.id, created: false } : fail("request_conflict");
  });
}

/**
 * Removes a problem from a custom list. The problem stays in the deck; in no
 * other list, it shows in My problems again.
 */
export async function removeStudyListItem(userId: string, listId: string, itemId: string): Promise<{ ok: true } | StudyListFailure> {
  const deleted = await getDb()
    .delete(i)
    .where(and(eq(i.id, itemId), eq(i.listId, listId), eq(i.userId, userId)))
    .returning({ id: i.id });
  return deleted.length > 0 ? { ok: true } : fail("list_not_found");
}

/** Puts a custom list's items in the given order; it must name every item exactly once. */
export async function reorderStudyListItems(
  userId: string,
  listId: string,
  itemIds: readonly string[],
  now = new Date(),
): Promise<{ ok: true } | StudyListFailure> {
  return getDb().transaction(async (tx) => {
    const row = await loadRow(tx, userId, listId);
    if (!row) return fail("list_not_found");
    if (row.kind !== "custom") return fail("not_editable");
    const items = await tx
      .select({ id: i.id, position: i.position })
      .from(i)
      .where(and(eq(i.listId, row.id), eq(i.userId, userId)));
    const current = new Map(items.map((item) => [item.id, item.position]));
    if (new Set(itemIds).size !== itemIds.length || itemIds.length !== current.size || itemIds.some((id) => !current.has(id))) {
      return fail("order_mismatch", "The order must name every item of the list exactly once.");
    }
    const moved = itemIds.flatMap((id, position) => (current.get(id) === position ? [] : [{ id, position }]));
    for (let start = 0; start < moved.length; start += 100) {
      const chunk = moved.slice(start, start + 100);
      const cases = sql.join(chunk.map((item) => sql`when ${item.id} then ${item.position}`), sql` `);
      await tx
        .update(i)
        .set({ position: sql`case ${i.id} ${cases} end`, updatedAt: now })
        .where(and(eq(i.listId, row.id), eq(i.userId, userId), inArray(i.id, chunk.map((item) => item.id))));
    }
    return { ok: true };
  });
}

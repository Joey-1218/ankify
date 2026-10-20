import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@ankileet/db";
import { and, eq } from "drizzle-orm";
import { iterateAccountExport } from "../account-export";
import { upsertLeetcodeProblem } from "../problem-upsert";
import { mergeAttemptHistory } from "../suggestions/history";
import { createTestDb } from "../test-db";
import { getBuiltinList } from "./builtin";
import { addStudyListItem, createStudyList, deleteStudyList, removeStudyListItem, reorderStudyListItems, reorderStudyLists, updateStudyList } from "./commands";
import { loadProblemStudyLists, loadStudyListDetail, loadStudyListsOverview } from "./lists";

const testDb = createTestDb();
const USER = "lists-user";
const OTHER = "lists-other";
const uuid = () => crypto.randomUUID();
const BUILTIN = "sliding-window-two-pointers";
const builtin = () => getBuiltinList(BUILTIN)!;

async function addProblem(slug: string, enrollment: "enrolled" | "awaiting_initial" = "enrolled", userId = USER) {
  const result = await getDb().transaction((tx) =>
    upsertLeetcodeProblem(
      tx,
      userId,
      { leetcodeSlug: slug, title: `Title ${slug}`, difficulty: "Medium", url: `https://leetcode.com/problems/${slug}/`, topicTags: [], similarSlugs: [] },
      { enrollment },
    ),
  );
  if (!result.ok) throw new Error(result.error);
  return result.problem;
}

async function create(input: Parameters<typeof createStudyList>[1], userId = USER) {
  const result = await createStudyList(userId, input);
  if (!result.ok) throw new Error(result.error);
  return result;
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([
    { id: USER, email: "lists@example.test", name: "Lists" },
    { id: OTHER, email: "lists-other@example.test", name: "Other" },
  ]);
});
afterAll(() => testDb.cleanup());

describe("study lists", () => {
  it("puts every problem in My problems until a list holds it", async () => {
    const first = builtin().items[0]!;
    const own = await addProblem("custom-only-problem");
    const listed = await addProblem(first.slug);

    let overview = await loadStudyListsOverview(USER);
    expect(overview.lists[0]).toMatchObject({ kind: "my_problems", id: null, progress: { total: 2, started: 2, learned: 2 } });
    expect(overview.builtinGroups.map((group) => [group.authorId, group.lists.length])).toEqual([
      ["carl", 12],
      ["endlesscheng", 12],
    ]);
    // A built-in list counts the user's progress whether or not it is followed.
    const builtinSummaries = overview.builtinGroups.flatMap((group) => group.lists);
    expect(builtinSummaries.find((list) => list.builtinId === BUILTIN)).toMatchObject({ followed: false, progress: { started: 1 } });

    const follow = await create({ action: "follow", requestId: uuid(), builtinId: BUILTIN });
    overview = await loadStudyListsOverview(USER);
    expect(overview.lists.map((list) => list.kind)).toEqual(["my_problems", "builtin"]);
    expect(overview.lists[0]!.progress.total).toBe(1);
    const mine = await loadStudyListDetail(USER, { kind: "my_problems" });
    expect(mine!.entries.map((entry) => entry.problemId)).toEqual([own.id]);

    // Unfollowing returns the problem to My problems; nothing is deleted.
    expect(await deleteStudyList(USER, follow.listId)).toEqual({ ok: true });
    const back = await loadStudyListDetail(USER, { kind: "my_problems" });
    expect(back!.entries.map((entry) => entry.problemId).sort()).toEqual([own.id, listed.id].sort());
  });

  it("derives entry states, progress, and next up from the deck and attempt history", async () => {
    const [a, b, c, d] = builtin().items;
    await addProblem(b!.slug, "awaiting_initial");
    await mergeAttemptHistory(USER, { source: "user_marked", sourceAccount: null, entries: [{ slug: c!.slug, status: "attempted" }] });
    const archived = await addProblem(d!.slug);
    await getDb().update(schema.problems).set({ archivedAt: new Date() }).where(eq(schema.problems.id, archived.id));

    const detail = (await loadStudyListDetail(USER, { kind: "builtin", builtinId: BUILTIN }))!;
    const state = (slug: string) => detail.entries.find((entry) => entry.slug === slug)!.state;
    expect([a, b, c, d].map((item) => state(item!.slug))).toEqual(["learned", "in_progress", "attempted_before", "archived"]);
    expect(detail.list).toMatchObject({ followed: false, id: null, progress: { total: builtin().items.length > 0 ? new Set(builtin().items.map((item) => item.slug)).size : 0, started: 3, learned: 2 } });
    // Next up: the first entry not in the deck; attempted before still counts.
    expect(detail.list.nextUp!.slug).toBe(c!.slug);
    expect(detail.sections[0]).toMatchObject({ id: "1.1", pattern: { id: "sliding_window.fixed", name: { en: "Fixed-length sliding window" } } });
    expect(detail.excludedCount).toBe(4);
    expect(detail.entries[0]!.url).toBe(`https://leetcode.com/problems/${a!.slug}/`);
  });

  it("creates, follows, and copies idempotently, and refuses a reused request id", async () => {
    const requestId = uuid();
    const made = await create({ action: "create", requestId, name: "Warm-ups" });
    expect(made.created).toBe(true);
    expect(await createStudyList(USER, { action: "create", requestId, name: "Warm-ups" })).toEqual({ ok: true, listId: made.listId, created: false });
    expect(await createStudyList(USER, { action: "create", requestId, name: "Other name" })).toEqual({ ok: false, error: "request_conflict" });

    const followed = await create({ action: "follow", requestId: uuid(), builtinId: BUILTIN });
    expect((await create({ action: "follow", requestId: uuid(), builtinId: BUILTIN })).listId).toBe(followed.listId);
    expect(await createStudyList(USER, { action: "follow", requestId: uuid(), builtinId: "no-such-list" })).toMatchObject({ ok: false, error: "builtin_not_found" });

    const copy = await create({ action: "copy", requestId: uuid(), builtinId: BUILTIN, name: "My sliding window" });
    const copied = (await loadStudyListDetail(USER, { kind: "list", id: copy.listId }))!;
    const distinct = [...new Set(builtin().items.map((item) => item.slug))];
    expect(copied.list.kind).toBe("custom");
    expect(copied.entries.map((entry) => entry.slug)).toEqual(distinct);
    expect(copied.entries[0]!.title).toEqual(builtin().items[0]!.title);
    await deleteStudyList(USER, copy.listId);
    await deleteStudyList(USER, followed.listId);
  });

  it("adds by problem or built-in slug with server metadata, removes, and reorders", async () => {
    const { listId } = await create({ action: "create", requestId: uuid(), name: "Playlist" });
    const deck = await addProblem("deck-only-problem");
    const listed = builtin().items[5]!;

    const fromDeck = await addStudyListItem(USER, listId, { source: "problem", problemId: deck.id });
    const fromBuiltin = await addStudyListItem(USER, listId, { source: "builtin", slug: listed.slug });
    expect(fromDeck).toMatchObject({ ok: true, created: true });
    expect(await addStudyListItem(USER, listId, { source: "problem", problemId: deck.id })).toMatchObject({ ok: true, created: false });
    expect(await addStudyListItem(USER, listId, { source: "builtin", slug: "not-in-any-list" })).toMatchObject({ ok: false, error: "problem_not_listed" });
    expect(await addStudyListItem(USER, listId, { source: "problem", problemId: "missing" })).toMatchObject({ ok: false, error: "problem_not_found" });

    let detail = (await loadStudyListDetail(USER, { kind: "list", id: listId }))!;
    expect(detail.entries.map((entry) => [entry.slug, entry.title.en, entry.state])).toEqual([
      ["deck-only-problem", "Title deck-only-problem", "learned"],
      [listed.slug, listed.title.en, "not_started"],
    ]);
    // A problem in a custom list leaves My problems.
    const mine = await loadStudyListDetail(USER, { kind: "my_problems" });
    expect(mine!.entries.some((entry) => entry.slug === "deck-only-problem")).toBe(false);

    const ids = detail.entries.map((entry) => entry.itemId!);
    expect(await reorderStudyListItems(USER, listId, [...ids].reverse())).toEqual({ ok: true });
    detail = (await loadStudyListDetail(USER, { kind: "list", id: listId }))!;
    expect(detail.entries.map((entry) => entry.slug)).toEqual([listed.slug, "deck-only-problem"]);
    expect(await reorderStudyListItems(USER, listId, [ids[0]!])).toMatchObject({ ok: false, error: "order_mismatch" });
    expect(await reorderStudyListItems(USER, listId, [ids[0]!, ids[0]!])).toMatchObject({ ok: false, error: "order_mismatch" });

    // Removing the problem from its last list returns it to My problems.
    expect(await removeStudyListItem(USER, listId, (fromDeck as { itemId: string }).itemId)).toEqual({ ok: true });
    const again = await loadStudyListDetail(USER, { kind: "my_problems" });
    expect(again!.entries.some((entry) => entry.slug === "deck-only-problem")).toBe(true);
    expect(fromBuiltin).toMatchObject({ ok: true });
  });

  it("renames custom lists only, pauses and reweights any list, and keeps built-in lists read-only", async () => {
    const custom = await create({ action: "create", requestId: uuid(), name: "Before" });
    const followed = await create({ action: "follow", requestId: uuid(), builtinId: "binary-search" });
    expect(await updateStudyList(USER, custom.listId, { name: "After", share: 3 })).toEqual({ ok: true });
    expect(await updateStudyList(USER, followed.listId, { active: false })).toEqual({ ok: true });
    expect(await updateStudyList(USER, followed.listId, { name: "Mine now" })).toMatchObject({ ok: false, error: "not_editable" });
    expect(await addStudyListItem(USER, followed.listId, { source: "builtin", slug: builtin().items[0]!.slug })).toMatchObject({ ok: false, error: "not_editable" });

    const overview = await loadStudyListsOverview(USER);
    expect(overview.lists.find((list) => list.id === custom.listId)).toMatchObject({ name: { en: "After" }, share: 3, active: true });
    expect(overview.lists.find((list) => list.id === followed.listId)).toMatchObject({ active: false, followed: true });
  });

  it("reorders the user's lists, My problems staying first, and only with every list named once", async () => {
    const ids = (await loadStudyListsOverview(USER)).lists.flatMap((list) => (list.id ? [list.id] : []));
    expect(ids.length).toBeGreaterThan(1);
    const reversed = [...ids].reverse();
    expect(await reorderStudyLists(USER, reversed)).toEqual({ ok: true });
    const overview = await loadStudyListsOverview(USER);
    expect(overview.lists[0]!.kind).toBe("my_problems");
    expect(overview.lists.slice(1).map((list) => list.id)).toEqual(reversed);
    // A new list goes last.
    const added = await create({ action: "create", requestId: uuid(), name: "Newest" });
    expect((await loadStudyListsOverview(USER)).lists.at(-1)!.id).toBe(added.listId);
    const all = [...reversed, added.listId];
    expect(await reorderStudyLists(USER, reversed)).toMatchObject({ ok: false, error: "order_mismatch" });
    expect(await reorderStudyLists(USER, [...all, all[0]!])).toMatchObject({ ok: false, error: "order_mismatch" });
    const theirs = await create({ action: "create", requestId: uuid(), name: "Not yours" }, OTHER);
    expect(await reorderStudyLists(USER, [...all.slice(1), theirs.listId])).toMatchObject({ ok: false, error: "order_mismatch" });
    await deleteStudyList(USER, added.listId);
    await deleteStudyList(OTHER, theirs.listId);
  });

  it("lists a problem's memberships and the custom lists it could join", async () => {
    const first = builtin().items[0]!;
    const [problem] = await getDb().select().from(schema.problems).where(and(eq(schema.problems.userId, USER), eq(schema.problems.leetcodeSlug, first.slug)));
    const follow = await create({ action: "follow", requestId: uuid(), builtinId: BUILTIN });
    const lists = (await loadProblemStudyLists(USER, problem!.id))!;
    expect(lists.memberOf).toEqual([{ id: follow.listId, kind: "builtin", name: builtin().name, builtinId: BUILTIN }]);
    expect(lists.customLists.every((list) => list.contains === false)).toBe(true);
    expect(await loadProblemStudyLists(OTHER, problem!.id)).toBeNull();
  });

  it("scopes every read and write to the user, and exports the user's lists", async () => {
    const theirs = await create({ action: "create", requestId: uuid(), name: "Theirs" }, OTHER);
    expect(await loadStudyListDetail(USER, { kind: "list", id: theirs.listId })).toBeNull();
    expect(await updateStudyList(USER, theirs.listId, { active: false })).toMatchObject({ ok: false, error: "list_not_found" });
    expect(await addStudyListItem(USER, theirs.listId, { source: "builtin", slug: builtin().items[0]!.slug })).toMatchObject({ ok: false, error: "list_not_found" });
    expect(await deleteStudyList(USER, theirs.listId)).toMatchObject({ ok: false, error: "list_not_found" });
    expect((await loadStudyListsOverview(OTHER)).lists.map((list) => list.name.en)).toEqual(["My problems", "Theirs"]);

    const exported: { type: string; data: unknown }[] = [];
    for await (const row of iterateAccountExport({ id: USER, email: "lists@example.test", name: "Lists", image: null })) exported.push(row);
    const lists = exported.filter((row) => row.type === "study_list").map((row) => row.data as { userId: string; name: string | null });
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((list) => list.userId === USER)).toBe(true);
    expect(lists.some((list) => list.name === "Theirs")).toBe(false);
    expect(exported.some((row) => row.type === "study_list_item")).toBe(true);
  });
});

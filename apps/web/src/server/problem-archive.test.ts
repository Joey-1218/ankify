import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@ankileet/db";
import { setProblemsArchived } from "./problem-archive";
import { createTestDb } from "./test-db";

vi.mock("./resource-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resource-limits")>()),
  MAX_PROBLEMS_PER_USER: 4,
}));

const testDb = createTestDb();
const USER = "archive-owner";
const OTHER = "archive-other";
const NOW = new Date("2026-10-15T12:00:00.000Z");
const PAST = new Date("2026-10-10T00:00:00.000Z");
const FUTURE = new Date("2026-11-01T00:00:00.000Z");

function problemRow(userId: string, id: string, extra: Partial<typeof schema.problems.$inferInsert> = {}) {
  return {
    id,
    userId,
    leetcodeSlug: id,
    title: id,
    difficulty: "Easy" as const,
    url: `https://leetcode.com/problems/${id}/`,
    ...extra,
  };
}

async function archivedIds(userId: string) {
  const rows = await getDb()
    .select({ id: schema.problems.id, archivedAt: schema.problems.archivedAt })
    .from(schema.problems)
    .where(eq(schema.problems.userId, userId));
  return rows.filter((row) => row.archivedAt != null).map((row) => row.id).sort();
}

beforeAll(async () => {
  await testDb.migrate();
  await getDb().insert(schema.user).values([
    { id: USER, name: "Owner", email: "archive@example.test" },
    { id: OTHER, name: "Other", email: "archive-other@example.test" },
  ]);
  await getDb().insert(schema.problems).values([
    problemRow(USER, "due-a", { fsrsDue: PAST }),
    problemRow(USER, "due-b", { fsrsDue: PAST }),
    problemRow(USER, "later", { fsrsDue: FUTURE }),
    problemRow(USER, "old", { fsrsDue: FUTURE, archivedAt: PAST }),
    problemRow(USER, "old-2", { fsrsDue: FUTURE, archivedAt: PAST }),
    problemRow(OTHER, "foreign", { fsrsDue: PAST }),
  ]);
});
afterAll(() => testDb.cleanup());

it("archives only the caller's problems and reports the new due count", async () => {
  const result = await setProblemsArchived(USER, ["due-a", "later", "foreign", "missing"], true, NOW);
  expect(result).toEqual({ ok: true, updated: 2, dueCount: 1 });
  expect(await archivedIds(USER)).toEqual(["due-a", "later", "old", "old-2"]);
  expect(await archivedIds(OTHER)).toEqual([]);
});

it("counts only problems whose state changed", async () => {
  const result = await setProblemsArchived(USER, ["due-a", "old", "due-a"], true, NOW);
  expect(result).toMatchObject({ ok: true, updated: 0 });
  const [kept] = await getDb()
    .select({ archivedAt: schema.problems.archivedAt })
    .from(schema.problems)
    .where(eq(schema.problems.id, "old"));
  expect(kept!.archivedAt).toEqual(PAST);
});

it("refuses to unarchive past the active-problem cap, then restores within it", async () => {
  // Active: due-b. Cap 4: restoring all four archived would make 5.
  const refused = await setProblemsArchived(USER, ["due-a", "later", "old", "old-2"], false, NOW);
  expect(refused).toMatchObject({ ok: false, error: "problem_limit_reached" });
  expect(await archivedIds(USER)).toEqual(["due-a", "later", "old", "old-2"]);

  const restored = await setProblemsArchived(USER, ["due-a", "later", "old"], false, NOW);
  expect(restored).toEqual({ ok: true, updated: 3, dueCount: 2 });
  const active = await getDb()
    .select({ id: schema.problems.id })
    .from(schema.problems)
    .where(and(eq(schema.problems.userId, USER), isNull(schema.problems.archivedAt)));
  expect(active.map((row) => row.id).sort()).toEqual(["due-a", "due-b", "later", "old"]);
});

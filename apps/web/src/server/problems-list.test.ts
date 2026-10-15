import { afterAll, beforeAll, expect, it } from "vitest";
import { getDb, schema } from "@ankileet/db";
import { loadProblemsList } from "./problems-list";
import { createTestDb } from "./test-db";

const testDb = createTestDb();
const USER = "list-owner";
const OTHER = "list-other";
const DAY = 86_400_000;
const T0 = new Date("2026-10-01T00:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

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

let sessionSeq = 0;
function sessionRow(
  userId: string,
  problemId: string,
  status: "completed" | "abandoned",
  startedAt: Date,
  completedAt: Date | null,
) {
  sessionSeq += 1;
  return {
    id: `s${sessionSeq}`,
    userId,
    problemId,
    requestId: `r${sessionSeq}`,
    type: "voluntary_practice" as const,
    reviewIntent: "none" as const,
    status,
    isOpen: false,
    scheduleRevisionAtStart: 0,
    startedAt,
    completedAt,
  };
}

beforeAll(async () => {
  await testDb.migrate();
  const db = getDb();
  await db.insert(schema.user).values([
    { id: USER, name: "Owner", email: "list@example.test" },
    { id: OTHER, name: "Other", email: "list-other@example.test" },
  ]);
  await db.insert(schema.problems).values([
    problemRow(USER, "practiced"),
    problemRow(USER, "legacy", { fsrsLastReview: at(3) }),
    problemRow(USER, "untouched"),
    problemRow(USER, "shelved", { archivedAt: at(6) }),
    problemRow(OTHER, "foreign"),
  ]);
  await db.insert(schema.practiceSessions).values([
    sessionRow(USER, "practiced", "completed", at(1), at(1)),
    // Completion time wins over start time; a missing one falls back to start.
    sessionRow(USER, "practiced", "completed", at(4), null),
    sessionRow(USER, "practiced", "completed", at(2), at(5)),
    // Abandoned sessions don't count.
    sessionRow(USER, "practiced", "abandoned", at(8), at(8)),
    // Another user's sessions never leak into this user's list.
    sessionRow(OTHER, "foreign", "completed", at(9), at(9)),
  ]);
});
afterAll(() => testDb.cleanup());

it("reports the latest completed practice and how many there were", async () => {
  const list = await loadProblemsList(USER);
  const byId = Object.fromEntries(list.problems.map((p) => [p.id, p]));
  expect(Object.keys(byId).sort()).toEqual(["legacy", "practiced", "untouched"]);
  expect(byId.practiced).toMatchObject({ lastPracticedAt: at(5).toISOString(), practiceCount: 3 });
  // A legacy problem with ratings but no sessions falls back to its last rating.
  expect(byId.legacy).toMatchObject({ lastPracticedAt: at(3).toISOString(), practiceCount: 0 });
  expect(byId.untouched).toMatchObject({ lastPracticedAt: null, practiceCount: 0 });
  expect(list.archivedCount).toBe(1);
});

it("returns a deck larger than the old page size in one page", async () => {
  const db = getDb();
  await db.insert(schema.problems).values(
    Array.from({ length: 150 }, (_, i) => problemRow(USER, `bulk-${i}`, { leetcodeId: 1000 + i })),
  );
  const list = await loadProblemsList(USER);
  expect(list.problems).toHaveLength(153);
  expect(list.totalCount).toBe(153);
  expect(list.nextCursor).toBeNull();
});

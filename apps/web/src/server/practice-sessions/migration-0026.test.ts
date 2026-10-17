import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ankileet/db";
import { createTestDb, tableSql } from "../test-db";

// 0026 rebuilds review_events so its practice-session reference is cleared
// when a session is deleted. The rebuild must keep every event, and the DROP
// must not fire the ON DELETE SET NULL of mistake_records.review_event_id.
const testDb = createTestDb();

beforeAll(async () => {
  await testDb.migrate({ through: "0025_" });
});

afterAll(() => testDb.cleanup());

it("keeps every review event and the mistakes that point at them", async () => {
  const db = getDb();
  expect(await tableSql("review_events")).toMatch(/`practice_session_id` text REFERENCES practice_sessions\(id\),/);

  // Data written under 0025 (raw SQL: the current Drizzle schema is newer).
  await testDb.exec(`
    INSERT INTO user (id, name, email) VALUES ('u1', 'Owner', 'owner@example.test');
    INSERT INTO problems (id, user_id, leetcode_slug, title, difficulty, url)
      VALUES ('p1', 'u1', 'two-sum', 'Two Sum', 'Easy', 'https://leetcode.com/problems/two-sum/');
    INSERT INTO practice_sessions (id, user_id, problem_id, request_id, type, review_intent, schedule_revision_at_start, status, is_open)
      VALUES ('s1', 'u1', 'p1', 'r-start', 'scheduled_review', 'due', 0, 'completed', 0);
    INSERT INTO review_events (id, user_id, problem_id, event_type, fsrs_rating, request_id, practice_session_id, schedule_revision)
      VALUES ('e1', 'u1', 'p1', 'self_recall_rated', 1, 'r-rate', 's1', 1),
             ('e2', 'u1', 'p1', 'self_recall_rated', 3, 'r-legacy', NULL, NULL);
    INSERT INTO mistake_records (id, user_id, problem_id, primary_category, source_type, review_event_id, request_id)
      VALUES ('m1', 'u1', 'p1', 'conceptual', 'review', 'e1', 'r-mistake');
  `);

  await testDb.migrate();

  expect(await tableSql("review_events")).toMatch(/REFERENCES `practice_sessions`\(`id`\) ON UPDATE no action ON DELETE set null/);
  expect((await db.select().from(schema.reviewEvents)).map((row) => [row.id, row.practiceSessionId]).sort()).toEqual([
    ["e1", "s1"],
    ["e2", null],
  ]);
  expect((await db.select().from(schema.mistakeRecords))[0]).toMatchObject({ id: "m1", reviewEventId: "e1" });

  // Indexes were recreated: a session still gets at most one rating event.
  await expect(
    testDb.exec("INSERT INTO review_events (id, user_id, problem_id, event_type, practice_session_id) VALUES ('e3', 'u1', 'p1', 'self_recall_rated', 's1')"),
  ).rejects.toThrow();

  // Deleting the session now keeps its event as unlinked history.
  await db.delete(schema.practiceSessions).where(eq(schema.practiceSessions.id, "s1"));
  expect((await db.select().from(schema.reviewEvents).where(eq(schema.reviewEvents.id, "e1")))[0]).toMatchObject({ practiceSessionId: null });

  // Idempotent re-run.
  await testDb.migrate();
  expect(await db.select().from(schema.reviewEvents)).toHaveLength(2);
});

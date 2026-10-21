# Study lists: design and plan

Status: agreed with the owner on 2026-10-20; phases 1 to 3 are done (their
settled design is in ARCHITECTURE.md, "Study lists"), phase 4 is next.
When a phase ships, move its settled design into ARCHITECTURE.md and mark it
done here. Retire this file when every phase is done.

## Goal

A new user who doesn't know what to practice opens a list and follows it in
order. The whole practice workflow becomes list-based:

- **Built-in lists**, read-only, shared by everyone. The first ones come from
  灵茶山艾府's public problem lists on leetcode.cn (starting with
  [sliding window and two pointers](https://leetcode.cn/discuss/post/3578981/ti-dan-hua-dong-chuang-kou-ding-chang-bu-rzz7/)),
  moved to leetcode.com and credited with a link to the original post.
- **User lists**, playlist-style: create, rename, delete; add, remove, and
  reorder problems.

FSRS-6 and the extension work exactly as they do now. The mistake profile
gains a *pattern* axis (for example "variable-length window, find longest"),
so a user sees which technique they are weak at, and what kind of mistake
they make in it.

## Learning principles behind the design

| Principle | What the app does |
| --- | --- |
| Retrieval practice | A review is a full re-solve from a blank editor (unchanged). |
| Spacing | FSRS-6 schedules each problem; reviews widen as memory stabilizes. |
| Desirable difficulty | Target retention stays 0.9: reviews are effortful but mostly succeed. |
| Interleaving | Today mixes reviews from every list and hides pattern/list names until a review is finished, so recognizing the pattern is part of the work. |
| Schemas and transfer | Pattern mastery weighs first-try results on *unseen* problems of the pattern most; weak patterns get fresh problems, strong ones get a check problem. |
| Consolidation | A second solve on the same local day counts as practice but never moves the FSRS schedule. |
| Cognitive load | New problems are paced by a daily time budget so reviews never pile up. |

## Owner decisions (2026-10-20)

- Optional (选做) items are ordinary items with an "Optional" tag; nothing
  skips them. Premium items are ordinary items too; the study list ignores
  the paid flag (the separate suggestions feature still excludes paid
  problems).
- leetcode.cn-only items (LCP, LCR, 面试题) are replaced by their leetcode.com
  twin only when the post itself says they are identical (`同 X 题`);
  otherwise they are dropped. A replacement that already appears right next
  to it is not repeated. The list shows a one-line note that N
  leetcode.cn-only problems are not included.
- One FSRS memory per problem (unchanged). A problem in several lists has one
  schedule; practicing it anywhere counts everywhere.
- Every account has a **My problems** list. A problem started directly on
  LeetCode (not from a list) lands there. Removing a problem from its last
  list moves it to My problems; it is never silently dropped from review.
  Deleting a problem stays a separate action on the problem page.
- Several lists can be active at once. Today shows due reviews from every
  problem, as now.
- Following a built-in list shows author updates; "Copy to my lists" makes an
  editable snapshot.
- Pattern failure evidence: confirmed mistakes *and* outcomes (rated Again or
  Hard, or finished not solved), as topic signals already do. A pattern needs
  the same readiness as a cause category: 2 sessions across 2 problems.
  Problems in no built-in list have no pattern (only LeetCode topics).
- Pattern and list names are hidden on Today until a review is finished (on
  by default, a setting turns it off).
- Strong patterns get one unseen check problem from their section, even if it
  bends the list order.
- No "next in list" in the extension popup. A self-written "key idea" note is
  left for a later version.

## Pacing: a daily time budget

The user sets a daily study time (default 60 minutes) and a cap on new
problems per day (default 5, no upper bound: interview cramming at 8 hours a
day is allowed). Each day:

1. Reviews come first. Their time is due reviews x the user's typical review
   time. Reviews are never cut to fit the budget (only the existing daily
   review limit applies).
2. New problems = round(remaining time / typical new-problem time), at most
   the cap, at least 0.
3. Typical times start at 35 minutes (new) and 12 minutes (review) and switch
   to the user's own medians (`practice_sessions.active_ms`) once 5 sessions
   of the kind exist.

Day one has nothing to review, so 60 minutes gives 2 new problems; a typical
later day is 2 reviews and 1 new problem. A simulation with the app's FSRS-6
settings on the 272-problem list (35/12 minutes):

| Budget | New/day: week 1, month 1, month 6 | Minutes/day: week 1, month 6 | List done |
| --- | --- | --- | --- |
| 60 | 1.4, 0.9, 0.6 | 62, 59 | ~207 problems after a year |
| 90 | 2.3, 1.2, 1.2 | 97, 101 | day 297 |
| 120 | 2.6, 1.3, 0.9 | 111, 122 | day 229 |

Fixed counts are not stable: 1/day climbs from 42 to 133 minutes by month 9;
2/day peaks near 200 minutes by month 3. A 60-day look-ahead planner did no
better than the simple rule.

New-problem slots go to the active lists in equal turns by a seeded deficit
round-robin (the suggestion planner's rotation). (Per-list shares were tried
and removed on 2026-10-21: the owner found the weight control confusing.) Weak-pattern
priority and the strong-pattern check decide *which* item fills a slot, not
how many slots there are. "One more new problem" is always available.

## Data model

Built-in list content is committed data, like the suggestion catalog:
`apps/web/src/server/study-lists/builtin/<list-id>.json`, generated by
`scripts/study-list-import.mjs` and validated by a Zod schema at load. It
holds only problem identities (slug, LeetCode number), LeetCode's English and
Chinese titles, difficulty, paid flag, contest rating, the optional flag, the
section path with our own English labels, the pattern id, and the
attribution. None of the author's explanations or solution links are copied.

```
BuiltinList { id, version, name{en,zh}, author, sourceUrl, generatedAt,
              metadataSite: "leetcode.com" | "leetcode.cn",
              sections[{ id, title{en,zh}, pattern, optional }],
              items[{ slug, frontendId, title{en,zh}, difficulty, paidOnly,
                      rating|null, sectionId }],
              excluded[{ cnId, title, reason }] }
```

New tables (migration `0027_study_lists`, phase 2):

- `study_lists`: one row per custom list or followed built-in list. `user_id`,
  `kind` (`custom` | `builtin`), `builtin_id` (for `builtin`), `name` (for
  `custom`), `request_id`, `active`, `share`, `position`, timestamps.
  Unique: (user, builtin_id) for followed lists; (user, request_id).
- `study_list_items`: items of custom lists. `user_id`, `list_id`, `slug`,
  `leetcode_id`, `title`, `title_zh`, `difficulty`, `position`, timestamps.
  Unique (list, slug). Built-in items are never copied into the table;
  progress joins `problems` by (user, slug).
- Settings key `study_plan` (phase 3): `dailyMinutes` (default 60),
  `maxNewPerDay` (default 5), `hidePatternsOnToday` (default true).

**My problems is computed, not stored** (decided in phase 2): it is every
problem in the deck that is in no custom list and no followed built-in list.
That gives the agreed behavior (problems started outside a list land there;
removing a problem from its last list or unfollowing a list puts it back)
with no backfill and nothing to keep in sync. It holds only problems already
in the deck, so it never supplies new problems and has no pacing settings.

A problem's patterns: every pattern of every built-in section containing its
slug, whether or not the user follows that list. Patterns live in the
built-in JSON, so they need no table.

### Patterns of the first list

Sections that differ only in level (basic, advanced) share a pattern.

| Pattern id | Sections |
| --- | --- |
| `sliding_window.fixed` | 1.1, 1.2 |
| `sliding_window.variable.longest` | 2.1.1, 2.1.2 |
| `sliding_window.variable.shortest` | 2.2 |
| `sliding_window.variable.count_at_most` | 2.3.1 |
| `sliding_window.variable.count_at_least` | 2.3.2 |
| `sliding_window.variable.count_exact` | 2.3.3 |
| `sliding_window.variable.other` | 2.4 |
| `two_pointers.reverse` | 3.1 |
| `two_pointers.opposite` | 3.2 |
| `two_pointers.same_direction` | 3.3 |
| `two_pointers.outward` | 3.4 |
| `two_pointers.in_place` | 3.5 |
| `two_pointers.matrix` | 3.6 |
| `two_sequences.two_pointers` | 4.1 |
| `two_sequences.subsequence` | 4.2 |
| `three_pointers` | 5 |
| `group_loop` | 6 |

## Behavior

- **Item state** for the user, derived on read: not started (no problem row),
  in progress (awaiting initial learning or open session), learned (enrolled),
  archived. Items whose slug is only in `attempt_history` show "attempted
  before" and are still offered.
- **Next up** of a list: the first not-started item in list order.
- **Start from a list**: open the problem on LeetCode; the extension starts
  the session as for any problem, and the problem joins its lists by slug.
- **Problems started on LeetCode** outside any list show in My problems.
- **Remove from a list**: deletes the item; a problem in no other list shows
  in My problems again.
- **Follow / unfollow / copy** a built-in list; copy creates a `custom` list
  whose items are the built-in items at that moment.
- **Same-day re-solve**: an early review whose problem was last scheduled or
  rated on the same local day starts as voluntary practice (no rating).

## Today

1. Due reviews from every problem, shuffled by a seeded order within the
   day's due set (still capped by the daily review limit). Pattern and list
   names are hidden until the review is finished.
2. New problems: the day's slots (pacing above) filled from active lists in
   share order. Within a list: a weak pattern's next unseen item first, then
   a pending check problem for a strong pattern, else next up.
3. "One more new problem" appends the next slot.

## Mistake profile

`computeMistakeProfile()` gains pattern stats beside topic stats, computed
the same way (fail/pass weights, Beta smoothing, readiness), plus a
per-pattern breakdown of confirmed causes. `/analysis` shows a pattern x
cause grid; a weak pattern links to its section's next unseen items.
First-try results on a problem's initial learning session weigh more for
pattern mastery (transfer evidence) than reviews of known problems.

## Phases

1. **Built-in list data** (done): import script, committed JSON for all 12
   lists, schema, loader, tests.
2. **Lists** (done): migration, list API (contracts first), `/lists`,
   `/lists/[id]`, and `/lists/builtin/[builtinId]` pages, follow/copy,
   add/remove/reorder, the problem page's Lists panel. Starting a problem
   from a list is opening it on LeetCode (the extension starts the session).
3. **Today planner** (done): `study_plan` settings, time-budget pacing,
   list shares, interleaved reviews with hidden patterns, weak-pattern
   priority, check problems, the same-day rule, and the pattern stats the
   planner needs (`computePatternProfile()`, including causes per pattern).
   The extension popup keeps its most-overdue-first order; only Today
   interleaves.
4. **Pattern profile**: the pattern x cause grid on `/analysis` from the
   phase 3 stats, weak patterns on Today's focus card, and links from a weak
   pattern to its section's next unseen problems.

Each phase passes `pnpm typecheck`, `pnpm lint`, and `pnpm test` before it is
committed, and updates ARCHITECTURE.md and HANDOFF.md.

## Imported lists (2026-10-20)

All 12 lists from 灵茶山艾府's index post
([如何科学刷题](https://leetcode.cn/discuss/post/3141566/ru-he-ke-xue-shua-ti-by-endlesscheng-q3yd/),
"完整题单"), metadata read from leetcode.com, 288 patterns:

| List | Items | Unique problems | Excluded (leetcode.cn only or same as) |
| --- | --- | --- | --- |
| Sliding window and two pointers | 281 | 274 | 5 |
| Binary search | 135 | 135 | 3 |
| Monotonic stack | 63 | 63 | 0 |
| Grid graphs | 66 | 66 | 8 |
| Bit manipulation | 127 | 126 | 2 |
| Graph algorithms | 173 | 170 | 9 |
| Dynamic programming | 708 | 607 | 27 |
| Common data structures | 628 | 585 | 24 |
| Math | 329 | 319 | 15 |
| Greedy and thinking | 540 | 512 | 11 |
| Linked lists, trees, and backtracking | 426 | 411 | 13 |
| Strings | 96 | 78 | 2 |

Carl's (代码随想录) lists from [programmercarl.com/algo](https://programmercarl.com/algo/),
added the same day: his 11 core topics in the site's order, graph theory left
out (its problems are on Kamacoder, in ACM mode), and his extra problems.
Each article is a source of problems: its own problem is core, the ones it
recommends (相关题目推荐) are stretch, and a problem is kept once per list.
221 items, 200 unique problems, 16 of them in no 灵茶山艾府 list (2,750
unique problems across all 24 lists); 3 new patterns (`array.simulation`,
`hash.basic`, `linked_list.design`).

| List | Items | Stretch | Excluded (Kamacoder, 剑指 Offer, 面试题) |
| --- | --- | --- | --- |
| Arrays | 13 | 7 | 3 |
| Linked Lists | 5 | 0 | 1 |
| Hash Tables | 11 | 3 | 0 |
| Strings | 5 | 0 | 2 |
| Two Pointers | 12 | 4 | 2 |
| Stacks and Queues | 7 | 0 | 0 |
| Binary Trees | 40 | 2 | 0 |
| Backtracking | 14 | 0 | 0 |
| Greedy | 17 | 0 | 0 |
| Dynamic Programming | 37 | 0 | 0 |
| Monotonic Stack | 5 | 0 | 0 |
| Extra Problems | 55 | 0 | 3 |

In English, every label is our own (the lists and their order are borrowed,
not the wording); only an author's name may be Chinese.

The files total 1.3 MB of server-only JSON, parsed once per server instance
on first use. Patterns (phase 4) need every list anyway, so they are not
loaded per list.

## Open items

- Ask 灵茶山艾府 and Carl for permission before shipping the lists to users. Only
  problem identities, LeetCode's titles, ratings, and the section structure
  are stored (none of the posts' text), but the selection and grouping are
  the author's work, and every list page credits and links the source post.

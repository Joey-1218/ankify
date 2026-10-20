# Study lists: design and plan

Status: agreed with the owner on 2026-10-20; implementation in progress (see
"Phases"). When a phase ships, move its settled design into ARCHITECTURE.md
and mark it done here. Retire this file when every phase is done.

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

Each active list has a **share** (weight, default 1). New-problem slots go to
lists by a seeded deficit round-robin over the shares (the suggestion
planner's rotation), so over a week each list gets its share. Weak-pattern
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

New tables (one migration):

- `study_lists`: one row per user list or followed built-in list. `user_id`,
  `kind` (`my_problems` | `custom` | `builtin`), `builtin_id` (for
  `builtin`), `name` (for `custom`), `active`, `share`, `position`,
  timestamps. Unique: (user, builtin_id) for followed lists; one
  `my_problems` per user.
- `study_list_items`: items of `custom` and `my_problems` lists. `user_id`,
  `list_id`, `slug`, `title`, `difficulty`, `position` (gapped integers for
  cheap reorder), `added_at`. Unique (list, slug). Built-in items are never
  copied into the table; progress joins `problems` by (user, slug).
- Settings key `study_plan`: `dailyMinutes` (default 60), `maxNewPerDay`
  (default 5), `hidePatternsOnToday` (default true).

Migration backfill: create every user's My problems list and add each of
their non-deleted problems to it.

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
- **Start from a list**: the normal practice-session start
  (`startSessionInTransaction()`), with the list's metadata as the target;
  the new problem joins My problems only if it is in no active list.
- **Problems started on LeetCode** (extension, not from a list): added to My
  problems in the start transaction when they are new to Ankileet.
- **Remove from a list**: deletes the item; if the problem then belongs to no
  list, it is added to My problems in the same transaction.
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

1. **Built-in list data**: import script, committed JSON for the first list,
   schema, loader, tests. (No UI.)
2. **Lists**: migration, My problems backfill, list API (contracts first),
   `/lists` and `/lists/[id]` pages, follow/copy, add/remove/reorder, start
   from a list, auto-add to My problems.
3. **Today planner**: `study_plan` settings, time-budget pacing, shares,
   interleaved reviews with hidden patterns, weak-pattern priority, check
   problems, same-day rule.
4. **Pattern profile**: pattern stats and the pattern x cause grid.

Each phase passes `pnpm typecheck`, `pnpm lint`, and `pnpm test` before it is
committed, and updates ARCHITECTURE.md and HANDOFF.md.

## Open items

- `leetcode.com` is not reachable from the cloud dev environment, so the first
  import reads metadata (English titles, difficulty, paid flag) from
  leetcode.cn's API and records `metadataSite: "leetcode.cn"`. Rerun the
  import with leetcode.com reachable to verify every slug and take
  leetcode.com's paid flags before launch.
- Ask 灵茶山艾府 before promoting the lists publicly.

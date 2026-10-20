# Architecture

Canonical description of how ankileet is built. `CLAUDE.md` and `AGENTS.md` link
here instead of repeating it; update this file when the architecture changes.
Local setup and tests: [DEVELOPMENT.md](DEVELOPMENT.md). Production and
releases: [DEPLOYMENT.md](DEPLOYMENT.md). Current state and open work:
[HANDOFF.md](HANDOFF.md).

## Shape of the system

A modular monolith: one Next.js deployment (web app + API) on Vercel, a Chrome
MV3 extension, and a single database. pnpm workspaces:

| Package | Role |
| --- | --- |
| `apps/web` | Next.js 16 App Router: pages, API routes, Vercel Queue consumer, all server logic in `src/server/` |
| `apps/extension` | Chrome MV3 extension (content script, background worker, popup/side panel) |
| `packages/db` | Drizzle schema (`src/schema.ts`), migrations (`drizzle/`), `getDb()` client, env profile loading |
| `packages/core` | Browser-safe domain logic: FSRS wrapper (`fsrs.ts`), practice-session rules, mistake profile, weakness model, suggestion planner, shared types |
| `packages/contracts` | Zod request schemas and JSON-safe DTOs shared by web, extension, and DB JSON columns |
| `packages/api-client` | Isomorphic AI-job client (start, poll, cancel) used by web and extension; caller supplies `fetch` |

Boundaries: browser code never imports `@ankileet/db`; public APIs return DTOs
from `@ankileet/contracts`, never raw Drizzle rows; `apps/web/src/lib/` is
browser-safe helpers only; DB/auth/AI/queue code lives in `apps/web/src/server/`
and API routes stay thin HTTP adapters.

## Data and persistence

- **Database**: Turso (libSQL) in Preview/Production, a local SQLite file in
  development/QA. `getDb()` picks Turso when `TURSO_DATABASE_URL` is set and
  refuses local SQLite on Vercel. Every Drizzle transaction opens with
  `BEGIN IMMEDIATE` (libSQL's default `write` mode), so writers are serialized.
- **Profiles**: `ANKILEET_PROFILE` selects `local` (default), `qa`, `preview`, or
  `production` env files for CLI tools (`loadDbEnv()` in `packages/db/src/client.ts`).
  Production runtime reads Vercel env vars, not files.
- **Migrations**: edit `schema.ts`, run `pnpm db:generate`, commit the generated
  SQL + snapshot, apply with `pnpm db:migrate` (local) or the documented release
  flow (`pnpm db:release`, see [DEPLOYMENT.md](DEPLOYMENT.md#database-operations)). Migrations are additive; apply
  them before deploying code that depends on them.
- **Isolation**: every business table carries `userId` and every query is scoped
  by it, including raw SQL. `problems.leetcodeSlug`/`leetcodeId` are unique per
  user. User deletion cascades to all user-owned rows except the credit ledger
  and purchase records, which are kept for accounting; deleting forfeits any
  purchased credits and requires the user's explicit acknowledgement.

Tables (all in `packages/db/src/schema.ts`):

| Table | Purpose |
| --- | --- |
| `user`, `session`, `account`, `verification` | Better Auth |
| `problems` | One LeetCode problem per user; holds the FSRS state (problem-level scheduling), notes, `archivedAt`, a monotonic `schedule_revision`, and `enrollment` (`awaiting_initial` until a session's initial learning completes) |
| `submissions` | Captured attempts incl. code and failing test details; a LeetCode submission id identifies an attempt |
| `practice_sessions`, `practice_session_submissions`, `practice_session_commands` | Tracked attempts on LeetCode, their submission observations, and command idempotency records (see Practice sessions) |
| `cards` | Q&A flashcards; `aiStatus` `candidate | failed | ready`; integer `version` for optimistic concurrency |
| `quiz_sessions` | 5-item quizzes (`active | completed | archived`), answers, score |
| `review_events` | Append-only history with FSRS snapshots; ratings are undone by stamping `undoneAt`; newer events record session, policy, method, and schedule-revision provenance (the session link is cleared when the session is deleted, after its events were undone) |
| `mistake_records` | Causes of failure, confirmed by the user (or AI candidates awaiting confirmation), linked to a submission, quiz answer, rating, or practice session, with structured evidence references; partial unique indexes dedupe per source and category |
| `practice_improvements` | Retired "Skill handled well" confirmations. Kept for history and export; no longer written or counted (improvement is derived from clean reviews) |
| `ai_jobs` | Durable async card, quiz, and session-analysis commands (see below) |
| `session_analyses` | Immutable session-analysis results, cached per evidence version, analyzer version, provider, and model (see Session analysis) |
| `suggestion_candidates` | Verified LeetCode metadata (title, difficulty, paid flag, topics, source, `verified_at`) of problems that may be suggested |
| `study_lists`, `study_list_items` | The user's custom lists and followed built-in lists (with `active` and `share` for pacing), and custom-list items by slug (see Study lists) |
| `attempt_history`, `attempt_history_coverage` | Attempted problems by slug and source, independent of `problems` rows, and how much of a LeetCode account's history was read (see New-problem suggestions) |
| `agent_sessions`, `agent_runs`, `agent_messages`, `agent_steps` | Persistent Study Coach conversations |
| `settings` | Per-user key/value: encrypted AI config, review/generation prefs, onboarding, rate-limit windows, starter-credit counter, Stripe customer ids |
| `ai_credit_balances`, `ai_credit_ledger`, `credit_purchases` | Hosted AI credits (see Paid AI credits) |

## Authentication and authorization

- Better Auth with Google OAuth (`/api/auth/[...all]`). Signup is public;
  `ANKILEET_DISABLE_SIGNUP=true` pauses new accounts only.
- `src/proxy.ts` (Next 16 proxy convention) is only a cookie gate and the
  extension CORS preflight handler. Every server page calls `requirePageUser()`
  and every API route calls `getRequestUser()` (cookie-cached) or
  `getRequestSessionUser()` (fresh session; used for settings, account, billing).
- Public routes: `/`, `/login`, `/welcome`, `/privacy`, `/terms`, `/api/auth/*`,
  `/api/queues/*` (Vercel Queue callbacks), `/api/billing/webhook` (Stripe
  signature), and `/api/qa/login` in the QA profile only.
- The extension reuses the web session cookie (`credentials: include`); its API
  origin is fixed at build time (`ANKILEET_EXTENSION_API_ORIGIN`), and production
  CORS allows only `ANKILEET_EXTENSION_ORIGINS`.
- Production fails closed without `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  Google credentials, and `AI_KEY_ENCRYPTION_SECRET`;
  `scripts/check-vercel-env.mjs` validates Vercel env at build time.

## Review scheduling (FSRS)

- FSRS-6 via `ts-fsrs` in `packages/core/src/fsrs.ts`. Elapsed days are
  recomputed from `last_review`, never trusted from storage. Only the
  **problem** is scheduled. Every FSRS write advances `problems.schedule_revision`
  and records its policy on the review event:
  - `leetcode_full_solve_v1` (sessions): default weights, 90% retention, fuzz,
    short-term learning steps disabled, so every grade yields a day-based
    interval. A rating is computed as of the review's completion time, so a
    rating given hours later schedules from when the review happened.
  - `initial_delay_v1`: finishing initial learning schedules the first review
    `initialReviewDelayHours` (1-168, default 24) after completion; the state
    stays `new` and no rating is recorded (`fsrs_scheduled` event).
  - `legacy_self_recall_v1`: `POST /api/review/rate` (default FSRS with
    minute-scale learning steps), kept for old clients until cutover. It
    refuses problems still awaiting initial learning.
- `POST /api/practice-sessions/:id/rating` is the exactly-once session rating:
  a completed review (due, or explicitly early) whose rating is pending (or
  `deferred`, from the retired "Rate later") and whose problem schedule is
  unchanged since the session started. One rating event per session is
  enforced by a unique index; the response is stored for replay. Voluntary
  practice, capture, and dashboard visits never change the schedule.
- **Same-day re-solve**: an early review requested on the local day the
  problem was last scheduled (first-review schedule) or rated, neither undone,
  starts as voluntary practice (`startSessionInTransaction()`). It counts as
  practice and never moves the schedule: memories consolidate overnight, so a
  second solve the same day is not a spaced retrieval.
- A review finished as not solved (`result: "unsuccessful"`, the panel's
  "Finish anyway") is rated Again in the finish transaction: failing to
  produce a correct solution is a lapse, and Hard/Good/Easy all mean
  recall succeeded. The event has no request id and
  `metadata.automatic: "unsuccessful_finish"`; it undoes like any rating.
  Not for a review whose schedule changed since it started (superseded).
- Otherwise the rating is due right after Finish: rate, or skip (`dismiss_rating`).
  `defer_rating` answers `rating_defer_retired`. An unresolved rating
  expires 24 hours after completion (computed on read) without touching
  FSRS. A due or early review does not start while another problem's
  finished review awaits its rating (`rating_pending` names that session and
  problem).
- Undo (`undo_rating` session command, or `POST /api/review/undo`) restores the
  event's `metadata.undo` snapshot. It is allowed only while the event still
  accounts for the current revision: the revision must equal the event's plus
  two per later scheduling event that was itself undone (each such event and
  its Undo advanced it once). Any other change blocks it, even one that keeps
  the repetition count; successive Undo still works. An undone session can
  never be rated again. Events from before migration 0021 use the legacy
  repetition check.
- The due condition (`server/due-problems.ts`) excludes archived problems and
  problems awaiting initial learning; the daily limit and time zone come from
  per-user review settings. `GET /api/review/overview` returns due (most
  overdue first, within the daily limit), upcoming, pending ratings, open
  sessions, and today's counts, which keep reviews, initial learning, and
  completed sessions apart. Retrievability of a never-reviewed problem is
  "not yet estimated" (`retrievabilityEstimate()` returns `null`).

## Practice sessions

The extension-first workflow tracks each attempt at a problem as a practice
session. The server owns the lifecycle; the extension reports.
Pure rules live in `packages/core/src/practice-session.ts`, services in
`server/practice-sessions/`.

- **Kinds**: `initial_learning` (a problem new to Ankileet, created
  `awaiting_initial` and kept out of the queue), `scheduled_review` (due, or
  explicitly started early), `voluntary_practice` (never changes the schedule).
- **Finish check** (extension panel, `finishCheckOf()` in `page-session.ts`):
  Finish stops and asks first when the session has no submission, or none
  accepted, provided LeetCode could be read throughout (complete capture,
  baseline set, available now) and nothing is still being judged. "Keep
  working" goes back; "Finish anyway" sends `unsuccessful`. When tracking
  was unreliable, not seeing a submission proves nothing and Finish goes
  ahead. The check follows the evidence, so a new submission updates or
  clears it.
- **Lifecycle**: `active` → `completed` | `abandoned`. An active session whose
  owner lease lapsed reads as `interrupted` (never a failure); after 24 hours
  without activity it is stale history and a new session is required. One
  open session per problem (partial unique index on `is_open`).
- **Ownership**: the controlling tab holds a 60 s lease renewed by heartbeats.
  Another tab takes over explicitly; afterwards the old tab can neither
  heartbeat, finish, nor rate. Without a live lease any tab may resume.
  Closing the controlling tab sends `release` (from the extension worker's
  `tabs.onRemoved`, for the sessions that tab controlled): the lease and token
  are cleared, so the session reads as `interrupted` with Resume at once
  instead of "open in another tab" until the lease runs out.
- **Observations**: submission verdicts are stored per session even without
  code details; details go through `storeSubmissions()` (capture's identity
  rules). LeetCode's submission time (and the baseline id seen at start)
  places each observation; historical submissions stay unassigned and
  boundary cases are kept as ambiguous rather than guessed. A LeetCode
  submission id belongs to at most one session per user.
- **Idempotency**: start and every non-heartbeat command carry a request id;
  a replay returns the stored response and a changed payload is `409`.
  Heartbeats report cumulative per-tab timing merged with `max()`.
- **Timing**: estimated foreground (`activeMs`) and tracked (`observedMs`)
  time are stored apart from wall time; completion times from the client are
  clamped into the session window and flagged when adjusted.
- **Deletion** (`DELETE /api/practice-sessions/:id`, `delete.ts`, the web
  problem page only): a finished or stale session the user calls invalid is
  deleted with what it did, in one transaction. Its rating is undone, or the
  first review its initial learning scheduled (the problem awaits initial
  learning again, unscheduled); either is refused with `undo_conflict` while
  a later scheduling change is in effect, by the same revision rule as Undo
  (`undoRevisionFor()`), so the newest goes first. Its mistake records are
  deleted; observations, commands, analyses, AI jobs, and improvements
  cascade; the undone events stay with the link cleared. LeetCode
  submissions stay with the problem. A live open session is abandoned
  instead (`invalid_transition`), and nothing is deleted while its problem
  has another live open session (`open_session_conflict`). A running
  analysis of a deleted session commits nothing (`loadRunningJob()`).
- **API**: `POST/GET /api/practice-sessions`, `GET /api/practice-sessions/current`,
  `GET/DELETE /api/practice-sessions/:id`, `POST .../:id/commands`,
  `POST .../:id/submissions`. Tabs send `X-Ankileet-Owner-Token` on reads.
- **Kill switch**: `ANKILEET_DISABLED_WORKFLOWS` (comma-separated workflow ids)
  disables a workflow's routes and removes it from `GET /api/capabilities`.

### Mistake evidence and profile

The profile shows *recurring causes* of failure across problems ("I keep
mishandling DFS base cases"), not topic statistics. Categories are one stable
set, `SKILL_DIMENSIONS` in `packages/core/src/skills.ts`, mirrored by
`skillDimensionEnum` in contracts (a test keeps them equal):

| ID | Boundary |
| --- | --- |
| `approach` | Picked an unsuitable technique (not: implemented a good one badly) |
| `invariant` | Wrong DP state, recursion contract, or loop invariant |
| `edge_case` | Empty input, boundaries, base cases, initial values |
| `complexity` | TLE/MLE traced to a cost decision |
| `implementation` | Indexing, return values, scope, pointer/null handling |
| `conceptual` | Doesn't know what a technique guarantees |
| `other` | Evidence is thin or nothing fits |

A record has one primary category (so counts never double-count) and up to 8
free-form tags. A LeetCode status (`Wrong Answer`, `TLE`) never becomes a
category by itself: it is a symptom. Records the user creates are
`confirmed`; AI findings are `ai_suggested` until confirmed or dismissed.

- A mistake record belongs to a practice session when made on it, or when its
  submission or rating came from one (derived server-side). Evidence
  references (observations, submissions, code ranges, judge output) must
  belong to the same user and problem; they are facts, apart from the
  inferred summary.
- `GET /api/mistakes/profile` computes the profile on every read from
  user-scoped joins over the last 90 days (`server/mistake-profile.ts` loads,
  `computeMistakeProfile()` in `packages/core` aggregates). Each (session or
  legacy source, category) counts once, only confirmed records weigh, AI
  candidates are listed apart, and nothing derived is stored, so Undo,
  dismissal, and resolution take effect immediately.
- Accepted verdicts and Good/Easy ratings are topic success, not mastery of
  a dimension. A dimension's weakness is lowered by *clean reviews*, derived
  on read: a later completed, accepted session (not rated Again) on a problem
  with a confirmed mistake of that dimension, where the session has no
  record (confirmed or suggested) of it.
- **Readiness**: personalized targeting needs three completed sessions across
  two problems; a category needs confirmed evidence from two sessions across
  two problems.
- **Topic signals**: per topic, sessions with Accepted, failed, and first-try
  counts; a session's rating (Again/Hard fail, Good/Easy pass) outranks its
  observed outcome. Interrupted or abandoned sessions and missing evidence are
  never failures, and incomplete evidence is labeled rather than counted as
  success.

### Weakness model

Shared by the profile and the suggestion planner; constants in `FEED_PARAMS`
(`packages/core/src/daily-feed/params.ts`). Evidence weighs `0.5^(age / 21
days)` and is ignored after 90 days. A confirmed mistake is fail weight 3
(x0.25 once resolved); a clean review is pass weight 2. For each dimension `d`
with summed fail and pass weights `F_d`, `S_d`:

```
p̄   = clamp((ΣF + 1) / (ΣF + ΣS + 2), 0.15, 0.60)   # the user's overall failure rate
p_d = (F_d + 3·p̄) / (F_d + S_d + 3)                 # Beta posterior mean, prior strength 3
c_d = F_d / (F_d + 2)                                # how much failure evidence exists
w_d = p_d · c_d                                      # weakness
```

`d` is weak when `w_d ≥ 0.25`, and once served as weak it stays weak until
`w_d < 0.15` (hysteresis). Worked values used as test fixtures: one fresh
confirmed mistake and nothing else gives `w = 0.48` (weak); one invariant
mistake 21 days old followed by two clean passes gives `0.126` (recovered).
Several weak dimensions share slots in proportion to `w_d` (each clamped to
[0.15, 0.6] of an 85 % split, 15 % to general practice) through a seeded
deficit round-robin over 14 days, so allocation converges to the shares
without one type crowding out the rest.

`planDailyFeed()` in `packages/core/src/daily-feed/` is the original, fully
tested engine for a mixed daily drill/quiz feed. The app never calls it; its
weakness, share, and rotation code is what `planSuggestion()` reuses.

## AI configuration and hosted keys

`server/settings.ts:getAiRuntimeSettings()` decides which key an AI call uses:

1. The user's own provider/model/key (AES-256-GCM encrypted with
   `AI_KEY_ENCRYPTION_SECRET`; APIs expose only `hasApiKey`). Always wins and
   never spends credits (`source: "user"`).
2. Otherwise the server's hosted key when `ANKILEET_STARTER_AI_API_KEY` is set
   (`source: "starter"`). Work on this key spends hosted credits (card 1, quiz
   2, Study Coach turn 5): free starter credits if they cover the cost, else
   purchased credits (`server/ai-credits.ts`).
3. Otherwise a clear `AI_NOT_CONFIGURED` / `AI_KEY_MISSING` error.

Providers: Anthropic, OpenAI, Google Gemini (`@ai-sdk/google`), and
OpenAI-compatible presets (DeepSeek) built in `server/ai.ts`. Calls run with
DeepSeek thinking off (the Fast/Thinking choice was retired; a stored
`reasoningMode` reads as `fast`); Gemini counts thinking against the output
cap, so `providerCallOptions()` keeps its thinking low and adds headroom.

**Adding a key** (Settings and the /today onboarding card share
`components/ai-key-setup.tsx`): the user chooses a provider, then enters its
key; there is no model field. `POST /api/settings/ai-key` →
`server/ai-connection.ts:verifyAndSaveAiKey()` reads the provider's model list
with the key, tries the best-ranked models in order with one structured-output
probe, and stores provider, model, key, and `modelCheckedAt` only when one
answers. This is the only way to store a key (`POST /api/settings` no longer
accepts AI fields), so a key entered under the wrong provider is never saved.
A rejected key whose prefix names another provider (`sk-ant-`, `AIza`,
`sk-proj-`, DeepSeek's `sk-` + 32 hex) returns `key_provider_mismatch`, and the
UI offers to switch. `DELETE /api/settings/ai-key` removes the key and keeps
the provider.

**Model choice** (`server/ai-model-choice.ts`): `rankAnalysisModels()` ranks a
provider's live list by family rules for its fast tier (newest Claude Haiku,
GPT `-mini` alias, stable Gemini Flash, DeepSeek Flash), so new releases need no
code change. `FALLBACK_ANALYSIS_MODEL` is used only when the list can't be read
or nothing matches. Before each analysis, the worker re-reads the list when the
pick is older than 7 days (`ensureCurrentAnalysisModel()`; a list it can't read
keeps the stored model), and after a model-not-found error it picks again and
retries once.

## Asynchronous AI generation (cards and quizzes)

> **Suspended (extension-first Phase 6B):** Study Coach, card and quiz
> generation, and credit sales are off by default. Their routes answer `410
> workflow_suspended` (`legacyWorkflowResponse()`), and capabilities list them
> as deprecations. Card and quiz jobs queued before the suspension fail in the
> runner before any provider call, which refunds their hosted credit once. The
> Stripe webhook and credit accounting keep working. An operator can re-enable
> one explicitly with `ANKILEET_ENABLED_LEGACY_WORKFLOWS`; no rollback does.

Card and quiz generation never run inside the request:

1. `POST /api/ai-jobs` (via `packages/api-client`) → `ai-generation/start.ts` →
   `jobs.ts:createAiJob()`. The job row stores the encrypted input, provider,
   model, language, and preconditions (expected card version / quiz session).
   The idempotency key (`requestId`) and an active-resource dedup key are
   unique per user; a hosted credit is spent in the same transaction as the insert.
2. The job id is published to the Vercel Queue topic `ankileet-ai-generation`
   (`dispatch.ts`, idempotent by job id). If publishing fails, the job is failed
   and its credit refunded. The QA profile uses `scripts/qa-worker.ts` instead.
3. `api/queues/ai-generation` → `runner.ts:processAiJob()` claims the job with
   a 270 s lease (a partial unique index allows one `running` job per user),
   re-checks the AI configuration, calls the model, and commits the business
   result together with the terminal job state in one transaction, so a
   redelivery can never create a second card or quiz.
4. States: `queued → running → succeeded | failed | cancelled | superseded`.
   Retryable errors requeue (up to `maxAttempts` = 3, 30-120 s backoff); a
   changed card version or quiz session marks the job `superseded`. Clients
   poll `GET /api/ai-jobs/:id`; `DELETE` cancels.
5. Hosted-credit refunds: `failed`, `superseded`, and cancelled-before-start
   jobs return their credit exactly once.

## Session analysis (BYOK)

One model call explains one completed practice session (`server/session-analysis/`).

- **Start**: `POST /api/ai-jobs` with `session_analyze` (manual), or planned inside
  the finish transaction when automatic analysis is on for the
  deployment (default; `ANKILEET_AUTOMATIC_ANALYSIS=disabled` switches it off),
  for the user (settings `analysis.automatic`, default on), and the session
  has captured code (`hasAnalyzableCode()` in core, the same rule as a manual
  analysis). Every session kind qualifies alike, accepted or not, so a review
  is analyzed exactly like a first practice. Automatic jobs run ~15 s after Finish
  (`runAfter`), so late verdicts are read; one job per session and evidence
  digest (`auto:<session>:<digest>`); no daily cap. Only the user's own key is accepted, at creation and again before
  execution; there is no hosted fallback and no credit spend. A provider
  change since creation fails the job (`ai_configuration_changed`); a newer
  model picked by the server does not, and the job records the model it ran on.
- **Evidence**: the whole verdict sequence plus representative code revisions
  (diffs where shorter) and judge output, bounded to 32,000 characters; what was
  left out is recorded in `coverage`. Output is schema-validated once (no repair
  loop), capped at 2,000 tokens, one provider call per attempt, three attempts.
- **Cache and staleness**: `session_analyses` rows are immutable and unique per
  (user, session, evidence digest, analyzer version, provider, model); unchanged
  evidence returns the cached analysis as an already-succeeded job. Staleness is
  computed on read against the current digest.
- **Commit**: the analysis, its `ai_suggested` candidate mistakes (one per new
  category, linked by `finding.mistakeId`), and the terminal job state commit in
  one transaction. A newer analysis replaces the session's earlier *open*
  candidates (confirmed and dismissed ones stay; a category already confirmed
  gets no new candidate). Findings that cite no attempt, and all findings when
  the model reports `insufficientEvidence`, are dropped server-side.
- **Corrections**: confirming with another category is one PATCH
  (`status` + `primaryCategory`). The suggested category stays readable as
  `MistakeRecordDto.suggestedCategory` (from the candidate's request id), so
  "corrected from" is shown without a schema change.
- **Budgets**: manual 10 per local day; automatic has no cap (bounded by
  eligibility, one job per evidence state, and `MAX_ACTIVE_JOBS_PER_USER`).
  Active jobs and jobs that reached a provider attempt count toward the manual
  budget; cache hits and jobs that ended before any attempt do not.
- **Provider errors**: 401/403, or an auth failure reported without a status
  (invalid key, `LoadAPIKeyError`), fail the job at once (`ai_request_rejected`);
  429 and 5xx retry, never sooner than the provider's `Retry-After`.
- **Dispatch recovery**: `ai_jobs.dispatched_at` marks queue acceptance. Queued
  jobs without it are re-sent by `redispatchStrandedJobs()`, from the popup's
  overview request, the analysis state request, and
  `GET /api/cron/ai-dispatch` (Bearer `CRON_SECRET`; not yet scheduled).
- **Read**: `GET /api/practice-sessions/:id/analysis`; the extension panel and
  the web problem page (Sessions tab, loaded when visible) show status and
  confirm/correct/dismiss controls. The Mistakes tab lists open suggestions
  first; manual entry is a secondary link.
- **Kill switch**: `ANKILEET_DISABLED_WORKFLOWS=session_analysis` refuses new jobs
  (`503 workflow_disabled`) and fails queued ones before any provider call.
  Stored analyses, candidates, and confirmed mistakes stay.

## Study lists

Practice is organized in lists (design and phases:
[STUDY_LISTS_PLAN.md](STUDY_LISTS_PLAN.md)). FSRS stays problem-level: a
problem in several lists has one schedule, and practicing it anywhere counts
everywhere. Lists organize problems and pace new ones (Today planner below).

- **Built-in lists** are committed data in
  `apps/web/src/server/study-lists/builtin/<id>.json`, generated by
  `scripts/study-list-import.mjs` from a leetcode.cn list post and a config in
  `scripts/study-lists/` (DEVELOPMENT.md, "Adding a built-in study list").
  `builtin.ts` validates every file at load and registers it in `SOURCES`;
  they hold problem identities, LeetCode's English and Chinese titles,
  difficulty, paid flag, contest rating, the level (`core`, `optional`,
  `stretch`), and chapters and sections with a pattern each. Twelve lists
  (灵茶山艾府's topic lists) are imported, all on leetcode.com.
- **Patterns** (`patterns.ts`) name the technique a section practices,
  finer than LeetCode topics. Ids are stable (history will be keyed by them);
  a problem's patterns are those of every built-in section containing its
  slug, followed or not (`patternsForSlug()`).
- **Tables**: `study_lists` has one row per custom list (`kind = custom`,
  `name`) or followed built-in list (`kind = builtin`, `builtin_id`, unique
  per user), with `active`, `share` (1-10), `position`, and the creating
  `request_id` (unique per user, so create/follow/copy are idempotent).
  `study_list_items` holds custom-list items by slug, with the title,
  Chinese title, difficulty, and LeetCode number taken from the server's own
  rows (the deck or a built-in list, never the request), and a composite
  foreign key pinning each item to its list's owner. Built-in items are never
  copied into the database; a copy makes a custom list of the distinct slugs.
- **My problems is not stored**: it is every problem of the deck whose slug is
  in no custom list item and no followed built-in list. So a problem started
  on LeetCode outside any list, a problem removed from its last list, and the
  started problems of an unfollowed list all show there with nothing to keep
  in sync. It never supplies new problems.
- **Entry state** is derived on read by slug (`server/study-lists/lists.ts`):
  `in_progress` (awaiting initial learning), `learned` (enrolled),
  `archived`, `attempted_before` (only in `attempt_history`), or
  `not_started`. Progress counts distinct slugs; "next up" is the first entry
  in list order not started (attempted-before included). Optional and premium
  entries are ordinary entries.
- **Starting** a list problem is opening it on LeetCode; the extension starts
  the session as for any problem, and the new problem joins its lists by
  slug.
- **Today planner** (`server/study-plan/today.ts`, pure logic in
  `packages/core/src/study-plan/`), derived on every read, nothing stored:
  - Pacing by a daily time budget (`study_plan` settings: `dailyMinutes`
    default 60, `maxNewPerDay` default 5 up to 100, `hidePatternsOnToday`
    default on). The day's reviews are due now within the daily limit plus
    those rated today; `newSlots = round((dailyMinutes − reviews ×
    reviewMinutes) / newMinutes)` clamped to [0, maxNewPerDay], minus new
    problems already started today. Reviews are never cut. Typical times are
    12 and 35 minutes until five completed sessions of a kind exist, then the
    median of `practice_sessions.active_ms` (last 90 days).
  - Slots go to active lists by share through a deficit round-robin over the
    last 14 days of first practices (each counted for the first active list
    holding it), ties broken by a seeded hash. Within a list: the next unseen
    problem of a weak pattern first (`weak_pattern`), then at most one check
    problem a day for a strong pattern not checked in 14 days (`check`), else
    the next problem in order (`next`). "One more new problem" (`?more=N`)
    shows picks past the plan.
  - Pattern stats (`computePatternProfile()`, `loadPatternProfile()` over the
    mistake profile's evidence): every completed session counts for its
    problem's patterns (rating outranks outcome), first practices weigh 1.5x
    (transfer), a context with confirmed mistakes adds failure weight once
    and counts its causes. Ready at 2 sessions across 2 problems; weak at
    weakness 0.25+; strong at 3+ problems and weakness below 0.15.
  - Due reviews on Today are shown in a seeded interleaved order (stable for
    the day) that never puts two problems of one pattern next to each other
    when an order like that exists; their patterns are hidden unless the
    setting is off. The extension popup keeps most overdue first.
- **API** (contracts in `packages/contracts/src/study-lists.ts`):
  `GET/POST /api/study-lists` (overview; create, follow, copy),
  `GET/PATCH/DELETE /api/study-lists/:id` (`my-problems` for My problems;
  rename custom lists, pause, reweight; delete or unfollow),
  `POST/PUT /api/study-lists/:id/items` (add by problem id or built-in slug;
  reorder with every item id once), `DELETE /api/study-lists/:id/items/:itemId`,
  `GET /api/study-lists/builtin/:builtinId`, and
  `GET /api/problems/:id/study-lists`. Lists and items are in the account
  export.

## New-problem suggestions

Suggestions target problems the user has never attempted; no model invents or
explains them.

- **Candidates** need verified metadata: a title, a difficulty, and LeetCode's
  paid flag as read from LeetCode, with the time it was read. Sources:
  - similar questions of problems the user practiced. The extension sends
    them with the problem, and `upsertLeetcodeProblem()` records them in the
    same transaction.
  - the committed catalog (`server/suggestions/catalog.json`), generated from
    LeetCode's problem list by `scripts/leetcode-catalog.js` (see
    DEVELOPMENT.md): 177 free Easy and Medium problems across 20 core topics,
    generated 2026-10-12.
- **Attempted problems** are never suggested. They are:
  - every problem row, archived ones included;
  - `attempt_history`, which holds LeetCode status reads, the user's own
    "already attempted", and the slug of a deleted problem. Deleting a problem
    records its slug first, so it can never look new.
- **Coverage**: history counts as complete only for a coverage scope read to
  its last page. Nothing infers completeness from a partial list.
- **Prerequisites** (no scheduled import or background job is involved):
  - A first suggestion needs at least one verified, free, never-attempted
    candidate. The catalog gives a fresh account general-practice picks from
    day one; similar questions of practiced problems add targeted ones.
  - Personalized picks also need a personalized profile (3 completed sessions
    across 2 problems) and a weak dimension confirmed in 2+ sessions across
    2+ problems.
  - The QA seed provides both: `apps/web/scripts/suggestion-fixture.ts`
    (practice history, confirmed edge-case mistakes, similar-question
    candidates, and deliberate exclusions), checked by
    `server/suggestions/qa-fixture.test.ts`.
- **Planner**: `planSuggestion()` (`packages/core/src/suggestions/`) is pure
  and deterministic. Its seed is the user, local date, ordinal, and planner
  version.
  - Once the profile is personalized, weak dimensions confirmed across
    problems share suggestions through the daily feed's weighted rotation;
    the rest is general practice.
  - A targeted pick prefers similar questions of problems with confirmed
    mistakes in the dimension, then topic affinity, then the same or easier
    difficulty.
  - General practice prefers the user's practiced topics and their recent
    difficulty (Easy with no history).
  - Explanations state only what the metadata shows. "Similar to X" names a
    category only when a mistake of that category was confirmed on X; a
    topic-only match is reported as a topic.
- **Persistence**: `suggestions` rows freeze each target, its explanation, the
  planner version, and a novelty label.
  - Novelty is `no_prior_attempt_found` only when a LeetCode account's
    accepted and tried lists were both read to the end within 30 days;
    otherwise it is `unverified`.
  - Unique indexes cover (user, local date, ordinal), (user, request id), and
    (user, slug) while pending, so racing requests cannot duplicate a slot or
    a target.
  - `POST /api/suggestions` with `daily` allocates the day's suggestion once
    and later returns it; `extra` appends the next ordinal (at most 20 a day).
    Nothing is stored when no problem is eligible.
  - `POST /api/suggestions/:id/actions` acts once per suggestion, idempotent
    per request id:
    - skip and already attempted store today's replacement in the same
      transaction, and already attempted also records `user_marked` history;
    - start runs the practice-session start in the same transaction
      (`startSessionInTransaction()`). A problem new to Ankileet starts initial
      learning; one already in the deck is started by id, so its own metadata
      is never overwritten.
  - Any new practice session on a problem with a pending suggestion (from the
    popup, the problem page, or after opening it from `/suggestions`) marks
    that suggestion started and links the session, in the start's
    transaction.
  - A started suggestion reports its session's outcome on read.
  - `GET /api/suggestions` lists today's suggestions.
  - `POST /api/attempt-history` merges LeetCode status reads, with their
    coverage.
  - The kill switch is `ANKILEET_DISABLED_WORKFLOWS=suggestions`.

## Study Coach

Suspended by default; see the note under Asynchronous AI generation. The web
app no longer mounts the Coach UI. The server runtime below remains, guarded,
until the legacy code is removed.

- `POST /api/agent/turns` → `agent/store.ts:beginAgentTurn()` creates the
  session (on first message), an idempotent run with its page/problem context,
  and the user message, and spends a hosted credit, all in one transaction.
  One run per session may be active.
- `agent/runtime.ts` runs an AI SDK `ToolLoopAgent` (max 8 steps, 175 s) with
  tools from `agent/tools.ts`: read tools (queue, problems, context,
  submissions, cards, quiz state) run immediately; `open_problem` navigates;
  card/quiz writes are *proposals* that create an AI job only after the user
  approves (`/api/agent/steps/:id/approve`).
- Events stream as NDJSON. Client disconnect aborts the model call
  (`agent_interrupted`, no credit refund); other failures mark the run failed
  and refund. Stale runs are failed as interrupted on the next turn. Long
  sessions are compacted into summaries (`compaction.ts`).

## Paid AI credits (suspended)

New purchases are suspended by default; see the note under Asynchronous AI
generation. Balances, the ledger, refunds, and the webhook still work. Nothing
was ever sold on ankileet.com. Configuration is in
[DEPLOYMENT.md](DEPLOYMENT.md#legacy-workflows).

- **Packs and costs** are server-side only: `CREDIT_PACKS` in
  `server/billing/config.ts` ($4.99 → 100, $9.99 → 250, $19.99 → 600) and
  `CREDIT_COST` in `server/ai-credits.ts` (card 1, quiz 2, Coach turn 5; 20
  free starter credits per account). Checkout sends inline `price_data`, so the
  client names only a `packId`; Session metadata freezes `userId`, `packId`,
  and `credits`. Billing is on only when both Stripe variables and the hosted
  key are set; live keys are refused outside Production, test keys on it.
- **Data**: `ai_credit_balances` (`CHECK balance >= 0`, cascades with the
  user); append-only `ai_credit_ledger` (`spend`, `refund`, `purchase`,
  `stripe_refund`, `forfeit`, `adjustment`, per bucket `starter | paid`,
  unique per reason, reference, and bucket); `credit_purchases` (unique per
  Checkout Session). Ledger and purchases have no foreign key to `user`, so
  they survive account deletion for accounting.
- **Spending**: `spendHostedCredit()` runs in the transaction that creates the
  job or Coach run; free credits go first, purchased credits pay the rest, by
  conditional updates, so a short balance spends nothing
  (`starter_credits_exhausted`, 403). `refundHostedCredit()` returns each part
  to its bucket at most once: on `failed`, `superseded`, cancelled-before-start
  jobs, and failed (not interrupted) Coach runs.
- **Fulfillment**: both the webhook (`checkout.session.completed`,
  `async_payment_succeeded`) and the success redirect call
  `fulfillCheckoutSessionById()`, which re-reads the Session from Stripe,
  ignores the event payload, grants only paid `mode=payment` Sessions for an
  existing user, and records an already-refunded charge without credits. A
  full `charge.refunded` removes up to that purchase's credits; partial
  refunds and disputes are logged for manual review.
- **Account deletion** with purchased credits requires
  `acknowledgeCreditForfeit: true` (else `409`) and writes a `forfeit` row.
- **Reconciliation** (spends on failed work that were never returned):

  ```sql
  SELECT l.user_id, l.ref_type, l.ref_id, l.bucket, l.delta
  FROM ai_credit_ledger l
  LEFT JOIN ai_credit_ledger r
    ON r.reason = 'refund' AND r.ref_type = l.ref_type AND r.ref_id = l.ref_id AND r.bucket = l.bucket
  LEFT JOIN ai_jobs j ON l.ref_type = 'ai_job' AND j.id = l.ref_id
  LEFT JOIN agent_runs a ON l.ref_type = 'agent_run' AND a.id = l.ref_id
  WHERE l.reason = 'spend'
    AND r.id IS NULL
    AND (
      j.status IN ('failed', 'superseded')
      OR (j.status = 'cancelled' AND j.started_at IS NULL)
      OR (a.status = 'failed' AND a.error_code <> 'agent_interrupted')
    );
  ```

Tests: `server/ai-credits*`, `account.test.ts`,
`ai-generation/jobs.credits.test.ts`, `agent/store.credits.test.ts`, and
`server/billing` (a real Stripe SDK offline, with signed test webhooks).
Before selling anything, verify in Stripe test mode end to end, including a
refund, and update the terms and privacy policy.

## Rate limits and caps

`server/rate-limit.ts` is a DB-backed fixed-window limiter per user and scope
(`agent` 12/min, `ai` 20/min, `capture` 60/min, `sessions` 120/min, `mistakes` 60/min, `suggestions` 60/min, `lists` 60/min, `billing` 10/min). Hard caps
limit cards and quiz sessions per problem, active AI jobs per user, and study
lists (50 per user, 2,000 problems per custom list).

## The extension

The extension is the daily surface. Three contexts, each with one job:

- **Content script** (`src/content/`, LeetCode problem pages only): reads
  LeetCode through its own GraphQL endpoint with the page's session
  (`leetcode-client.ts`; every read reports `available`, `signed_out`,
  `unavailable`, or `partial`, so an error is never "no submissions"), tracks
  the practice session of the problem in the URL (`page-session.ts`: foreground
  activity from visibility and focus only, polling every 15 s while visible and
  at once on focus, a final poll before Finish, then the Finish check), and renders the compact panel
  in a shadow root (`panel.ts`). Resetting LeetCode's editor is an explicit
  action; "Import past submissions" stores history for a problem already in
  the deck through `POST /api/capture` (never a schedule change).
- **Background worker** (`src/background/`): the only API client. It validates
  every message and its sender (`shared/protocol.ts`: top-frame LeetCode
  problem pages or this extension's pages), attaches each tab's owner token
  (`chrome.storage.session`, never visible to pages), requires the server to
  acknowledge a start, and sends finish, abandon, ratings, and observations
  through a durable IndexedDB outbox (`outbox.ts`): persisted before sending,
  replayed with the same id, delivered in order per session, paused on 401,
  scoped to one account and API origin, retried with backoff and a
  `chrome.alarms` wake-up. The toolbar badge shows due reviews plus pending
  ratings.
- **Popup** (`src/popup/`): today's view from `GET /api/review/overview` (open
  sessions, pending ratings, due and upcoming problems), today's new-problem
  suggestions, notes for the problem in the active tab, and settings
  (language, theme, sync status).
  - Suggestions (`background/suggestions.ts`):
    - it asks for the day's suggestion when today has none;
    - its actions are Start practice, Skip, Already attempted, and Another
      suggestion;
    - each shows its explanation and its novelty label.
  - Opening a due review, or starting a suggestion, starts the session before
    navigating and binds the session's token to the new tab. An open tab of
    the problem uses its own token.
  - When that tab sets the session's baseline, it also sends the LeetCode
    metadata it just read. This completes a problem created from stored
    metadata (description, topics, similar questions).

The API origin is fixed at build time (`ANKILEET_EXTENSION_API_ORIGIN`); the
extension reuses the web session cookie, and production CORS allows only
`ANKILEET_EXTENSION_ORIGINS`. Permissions: `storage`, `tabs`, `alarms`; hosts:
`leetcode.com` and the API origin.

## Web pages

- `/`: the public landing (signed-in users go to `/today`).
- `/today`: the dashboard and onboarding. `server/dashboard.ts` gathers the
  popup's review overview, the last week's completed sessions, recent
  practice, focus areas from the profile, and today's suggestions; Today's
  plan (`loadTodayPlan()`) adds the day's new problems from the active lists
  and orders the due reviews (see Study lists, "Today planner").
- `/lists`: My problems and the user's lists with progress, next up, and
  Pause/Resume; a new-list form; and every built-in list to follow.
  `/lists/builtin/[builtinId]` shows a built-in list by chapter and section
  (pattern, level, rating, state) with Follow, Unfollow, Pause, and Copy;
  `/lists/[id]` and `/lists/my-problems` show a custom list (reorder, remove,
  rename, delete) or My problems. Any list can add its problems to one of
  the user's custom lists.
- `/problems` and `/problems/[id]` (the detail page also shows the problem's
  lists and adds it to a custom list):
  - archive, unarchive, delete; the list archives or unarchives several
    selected problems at once (`POST /api/problems/archive`, which refuses
    to unarchive past the active-problem cap);
  - the list loads the whole active deck in one page (the cap counts only
    active problems), so search, filters, and sorting see every problem.
    Sort keys (`problems-sort.ts`, kept in `?sort=&dir=`): next review, date
    added, last practiced (latest completed session of any type, else the
    last rating), LeetCode number, title, difficulty, reviews, times
    forgotten, times practiced. "Ready to archive" lists likely-mastered
    problems (`isMasteryCandidate()` in core: steady review, 3+ rated
    reviews, stability of 90+ days);
  - the Mistakes tab;
  - the Sessions tab (evidence, active time, rating, and Delete for a
    finished or stale session, with a confirmation that says what it undoes);
  - History as the scheduling timeline of ratings and initial-review
    schedules (undone ones hidden);
  - the next review date;
  - "Practice on LeetCode".
- `/suggestions`: today's new-problem suggestions, the same items as the
  popup.
- `/analysis`: the mistake profile, then the FSRS dashboard.
- `/settings`: AI provider, AI credits, language and region, study plan
  (daily time, new problems per day, hiding patterns on Today), review
  schedule and first-review delay, session-analysis automation, account
  export and delete.
- `/privacy` and `/terms`.

The retired web review workspace (`/review`) redirects to
`/today?retired=review`, which explains that reviews happen on LeetCode.

## Testing

- `pnpm test` runs Vitest from the repo root (`vitest.config.ts` maps `@/` to
  `apps/web/src`).
- Database tests use `apps/web/src/server/test-db.ts`, which points `getDb()`
  at a throwaway, fully migrated SQLite file (never Turso). Failure injection
  uses SQLite triggers created through `testDb.exec()`.
- Local libSQL runs transactions synchronously: concurrent in-process writers
  fail fast with `SQLITE_BUSY` rather than interleave, and a failed
  `BEGIN IMMEDIATE` can leave that process's connection locked. Keep such
  concurrency tests in their own file (see `*.concurrency.test.ts`).

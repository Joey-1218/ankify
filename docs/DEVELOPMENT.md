# Development

How to run ankileet locally, test it, and change it safely. The coding rules
are in [CLAUDE.md](../CLAUDE.md) (mirrored in `AGENTS.md`); the design is in
[ARCHITECTURE.md](ARCHITECTURE.md); shipping is in [DEPLOYMENT.md](DEPLOYMENT.md).

## Setup

Node 22 and pnpm 10.

```bash
pnpm install
cp .env.example .env.local     # fill BETTER_AUTH_SECRET, Google OAuth, AI_KEY_ENCRYPTION_SECRET
pnpm dev                       # migrates local SQLite, then http://localhost:3000
```

Keep `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` empty in `.env.local`: local
work uses `packages/db/local.db` and must never reach Production. AI provider
keys are saved per user in Settings, never read from server env. Google
sign-in locally needs `http://localhost:3000/api/auth/callback/google` on the
OAuth client.

## Environments

| Profile | Database | Env file | Commands |
| --- | --- | --- | --- |
| `local` (default) | `packages/db/local.db` | `.env.local` | `pnpm dev`, `dev:all`, `db:migrate`, `db:studio`, `db:generate` |
| `qa` | `packages/db/qa.db`, reseeded | `.env.qa` (committed) + optional `.env.qa.local` | `pnpm dev:qa`, `dev:qa:all`, `qa:reset`, `dev:demo`, `demo:reset` |
| `preview` | its own Turso DB | `.env.preview.local` | `db:migrate:preview`, `db:studio:preview` |
| `production` | `database-ankileet` | `.env.production.local` | `db:backup`, `db:release`, `db:studio:prod` only |

`ANKILEET_PROFILE` picks the env file for CLI tools; the deployed app reads
Vercel variables, never files. Each environment has its own database, auth
secret, and encryption secret.

**QA profile** (no Google needed). `pnpm dev:qa` resets deterministic fixtures
and starts the web app plus a local AI worker in place of Vercel Queues.
Sign in at `http://localhost:3000/api/qa/login` (or the QA buttons on
`/login`). `pnpm dev:demo` loads an English demo deck (24 problems, two months
of history) for screenshots. `--keep-data` restarts without reseeding. For
real model calls in QA, put `ANKILEET_QA_AI_PROVIDER`, `_MODEL`,
`_REASONING_MODE`, and `_API_KEY` in `.env.qa.local`.

## The extension locally

| Goal | Command | Load in `chrome://extensions` |
| --- | --- | --- |
| Live editing against localhost | `pnpm dev:ext` (or `pnpm dev:all`) | `apps/extension/dist` (needs the Vite server running) |
| A stable localhost build | `cd apps/extension && pnpm exec vite build --mode development --outDir dist-local` | `apps/extension/dist-local` |
| Against Production | `ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm extension:build:unpacked` | `apps/extension/dist-unpacked` |

Turn on Developer mode → Load unpacked. After each rebuild, click reload on
the extension card and **refresh open LeetCode tabs** (Chrome injects content
scripts only into pages loaded afterwards). Sign in on the web app first; the
extension reuses that session. A bare production build without
`ANKILEET_EXTENSION_API_ORIGIN` fails on purpose.

## Changing the schema

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate`, and commit the new SQL and snapshot.
3. `pnpm db:migrate` locally; tests migrate their own throwaway databases.
4. Never edit or delete an applied migration; fix forward with a new one.
   Keep migrations additive so the previous code still runs on the new schema
   (expand, deploy, contract). Production migrates before the deploy
   ([DEPLOYMENT.md](DEPLOYMENT.md#database-operations)).

## Tests

| Command | What |
| --- | --- |
| `pnpm test` | Vitest: ~520 unit, DB, contract, and route tests. DB tests use `createTestDb()` (a migrated throwaway SQLite file) |
| `pnpm typecheck`, `pnpm lint` | All packages; web lint allows its 5 known warnings |
| `pnpm test:e2e` | Playwright on bundled Chromium (run `pnpm test:e2e:install` once): ~47 browser tests with the real extension, an isolated QA server, a LeetCode fixture, a fake AI provider, and axe accessibility checks |
| `pnpm test:visual` | Screenshot regression for the panel, popup, and web pages, light and dark (baselines in `tests/visual/__screenshots__`) |
| `pnpm qa:provider-smoke` | One real analysis per provider key in `.env.smoke.local` (`SMOKE_DEEPSEEK_API_KEY`, `SMOKE_OPENAI_API_KEY`, `SMOKE_ANTHROPIC_API_KEY`, `SMOKE_GOOGLE_API_KEY`, optional `SMOKE_<P>_MODEL` to pin a model; otherwise the key goes through Settings' verify-and-save and the model is auto-picked), plus an invalid-key check. All four passed on 2026-10-01. On 2026-10-15 DeepSeek, OpenAI, and Anthropic passed with auto-picked models; Gemini verified but its analysis got 503 "high demand" from Google |
| `ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm release:check` | The full gate before merging to main |

Keep deliberate-concurrency DB tests in `*.concurrency.test.ts` files: local
libSQL fails concurrent writers fast with `SQLITE_BUSY`.

**Live LeetCode checks.** The browser tests run against a fixture. Two
read-only console scripts check the real site; paste either into DevTools on
a signed-in `leetcode.com/problems/<slug>/` page:

- `scripts/leetcode-live-probe.js` checks the GraphQL fields the extension
  depends on and prints a report without code or ids. Run it when LeetCode
  changes or tracking breaks.
- `scripts/leetcode-catalog.js` regenerates
  `apps/web/src/server/suggestions/catalog.json`, the cold-start list of
  problems to suggest; commit it after `catalog.test.ts` passes.

## Adding a built-in study list

Built-in lists are generated files in
`apps/web/src/server/study-lists/builtin/`, one per list, read from a public
problem list post on leetcode.cn (灵茶山艾府's lists share one format) plus
LeetCode's own metadata. Only problem identities, LeetCode titles, ratings,
and the section structure are kept; none of the post's text.

1. Write `scripts/study-lists/<list-id>.json`: the list's names, author,
   source URL, a title for each chapter (`一、` headings) and each section
   (`§x.y` headings, or a chapter with problems directly under it), and the
   section's pattern. Copy an existing config as the template. A new pattern
   goes into `apps/web/src/server/study-lists/patterns.ts` with English and
   Chinese names; never rename an existing pattern id.
2. Run `pnpm study-lists:import scripts/study-lists/<list-id>.json`. It reads
   the post, maps every section (an unmapped section or an unexpected link
   format stops it), reads metadata from leetcode.com, and writes
   `builtin/<list-id>.json`. leetcode.cn-only problems are replaced only when
   the post says they are the same as a listed problem (`同 X 题`) or the
   config's `replacements` names one; the rest are listed under `excluded`.
   Where leetcode.com is unreachable, `--metadata-site leetcode.cn` reads the
   same English titles from leetcode.cn (rerun against leetcode.com before
   launch), and `--input post.html` reads a saved copy of the post.
3. Register the file in `SOURCES` in `study-lists/builtin.ts` (the array's
   order is the order users see).
4. Run `pnpm vitest run apps/web/src/server/study-lists scripts/study-list-import.test.mjs`
   and commit the config, the generated file, and the registry line. To pick
   up the author's later edits, rerun step 2 and commit the result.

## Manual QA checklist

Run through this in `pnpm dev:qa` (or on Production with a test account)
after user-visible changes:

1. **Connect:** with a web session, the popup shows data at once; without
   one, it offers Sign in, then loads after "I've signed in". No token.
2. **First practice:** on a new problem, Start practice; submissions appear in
   the panel live with verdicts; Accepted shows Finish but doesn't end the
   session; finishing schedules a first review a day later, with no rating.
   Finish with no submission (or none accepted) stops to ask: Keep working,
   or Finish anyway (recorded as not solved).
3. **Review:** open a due review from the popup; the session starts before the
   page loads; after Finish, rate (Again/Hard/Good/Easy) or skip; the next
   review date moves; a second due review won't start until the pending rating
   is resolved. Finish anyway on a review without an Accepted submission
   rates it Again at once ("Rated Again. Next review ...").
4. **Other practice:** a deck problem that isn't due offers Practice without
   reviewing (never moves the schedule) and Review early (ends with a
   rating). A second tab of a live session offers Continue here; closing the
   controlling tab shows Resume at once; a session idle for a day is stale.
5. **Offline:** all ankileet traffic goes through the extension's service
   worker, so going Offline in a LeetCode tab's DevTools only cuts LeetCode.
   Stop `pnpm dev:qa` instead (or set Offline in the service worker's own
   DevTools), then submit, finish, and rate: each says it's saved and will
   sync; after restarting with `pnpm dev:qa --keep-data`, it lands once. Queued work never syncs to a
   different ankileet account; it waits for the first one.
6. **Analysis:** in Settings choose a provider, then add its key (Back
   returns to the provider choice). A key the provider rejects is not saved;
   a working one shows the auto-picked analysis model. Then Analyze session (or let
   automatic analysis run ~15 s after Finish); suggested mistakes can be
   confirmed, recategorized, or dismissed and count only once confirmed. An
   invalid key fails at once with a clear message.
7. **Suggestions:** the popup and `/suggestions` offer a never-attempted
   problem with its reason; Start, Skip, Already attempted, and Another
   suggestion each work once.
8. **Delete a session:** on a problem page's Sessions tab, Delete a finished
   session; the dialog says what it undoes. A rated review's schedule goes
   back to before it; a deleted first practice puts the problem back to
   awaiting first practice. Deleting an older review while a newer one's
   rating stands says to delete that one first.
9. **Web:** `/today`, `/problems` and a problem page (Sessions, Mistakes,
   History tabs), `/analysis` (profile, then FSRS charts), `/settings` (export
   and delete account), in light and dark, English and 中文, at phone width,
   and by keyboard (every focused control shows the orange ring).
10. **LeetCode itself:** the panel follows LeetCode's theme without a reload
   and never covers Submit/Run; signing out of LeetCode mid-session shows a
   warning rather than "no submissions".

Known gaps, not bugs: no Undo button for a rating (the server supports it).

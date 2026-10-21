# Handoff

Where ankileet stands and what's next, for whoever picks it up (a person or
an agent with repo access and no conversation history). Verify claims against
the code and `git log`; update this file when the state changes.

Read in this order: [CLAUDE.md](../CLAUDE.md) (rules and UI conventions),
[ARCHITECTURE.md](ARCHITECTURE.md) (how it works),
[DEVELOPMENT.md](DEVELOPMENT.md) (run and test it),
[DEPLOYMENT.md](DEPLOYMENT.md) (ship it).

## State (2026-10-17)

- **Live:** `https://ankileet.com` on Vercel (`iad1`) with Turso
  (`aws-us-east-1`), all 27 migrations applied. Google sign-in, practice
  sessions through the extension, and BYOK session analysis (DeepSeek) were
  verified end to end in Production.
- **Session endings and deletion: web side live since 2026-10-17** (`bb9e95e`,
  deployment `ankileet-olqb9tkwz`; smoke checks passed). Migration
  `0026_session_delete_review_events_fk` (a `review_events` rebuild) was
  applied first; it kept all 93 events (backup
  `backups/database-ankileet-20261017-164848.db`). The panel changes ship
  with the 0.3.1 extension upload. That push to `main` did not start a
  Vercel build by itself; it was deployed from the dashboard.
- **Extension 0.3.0:** **published** on the Chrome Web Store on 2026-10-15
  ([listing](https://chromewebstore.google.com/detail/ankileet/ghkeifmaeopfjhnhakkeeafkalagndnj), ID `ghkeifmaeopfjhnhakkeeafkalagndnj`).
  Production accepts both the store ID and the unpacked ID. The Google OAuth
  app is published (In production), so anyone with a Google account can sign
  in; no test-user list.
- **Gate:** `ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm
  release:check` passes (2026-10-17): 571 unit
  tests, 55 browser tests, 7 screenshot tests, builds, manifest check; the
  audit leaves only low/moderate advisories. Without the origin the
  extension build fails closed, after the tests. Git worktrees under `.claude/worktrees/` make the
  root `eslint .` and vitest scan their copies, so remove them before running
  the gate.
- **Product scope:** spaced repetition of whole LeetCode problems. The
  extension tracks practice sessions on leetcode.com; FSRS-6 schedules each
  problem; finished sessions can be analyzed on the user's own AI key; the
  mistake profile counts confirmed causes of failure; suggestions offer
  never-attempted problems. Study Coach, AI cards and quizzes, and paid
  credits are suspended in code.
- **Suggestion catalog:** generated 2026-10-12 (177 problems), so new
  accounts get a general-practice pick before they have practice history.
  Too small for the long run; see "Planned for 0.3.1".
- **Database:** every deployment uses the one main database,
  `database-ankileet`. The per-deployment copies from 2026-10-12 were merged
  into it and deleted (Known issues).

## History

- **Ankify** (Jimin Yang, `Jiminyang1/ankify`): flashcard-style review with AI
  cards, quizzes, Study Coach, and Stripe credit packs.
- **Extension-first refactor** (Phases 0–7, September–October 2026, commits
  up to `b2830a6`): practice sessions instead of capture, session-based FSRS,
  a durable extension outbox, session evidence and BYOK analysis, the mistake
  profile, new-problem suggestions, the web dashboard, and suspension of the
  legacy AI workflows.
- **Post-refactor QA rounds** (`520936b`..`3d4b17b`): live submission
  tracking, mandatory rate-or-skip after a review, clearer sign-in and outage
  states, AI-first mistakes, automatic analysis, a LeetCode-native look,
  accessibility and screenshot tests, and four verified AI providers.
- **Fork as ankileet** (`68f5c1d`, 2026-10-12): Jimin's direction became
  interview mocks, so this fork was renamed and deployed independently.
  Jimin's later provider-registry commits were merged with `-s ours`
  (`395e547`): in history, not in the code. A snapshot of the pre-rename tree
  is `refs/backup/pre-ankileet-rename`.
- **Launch** (`2ab6249`, `6922425`): patched dependencies, Production docs,
  privacy policy and terms for a free BYOK service.
- **Post-launch fixes** (2026-10-12/13): ankileet's own extension development
  key (`2126471`); a build guard against per-deployment database copies
  (`cec61d9`); Settings drops the "Using your own key ... free credits" notice
  and both language menus share one set of labels, English / Simplified
  Chinese, 英语 / 简体中文 in the Chinese UI (`2338d08`); popup screenshot
  baselines for the ankileet name and the catalog's new-account pick
  (`38d39ce`).
- **Problems list management** (2026-10-15): bulk archive/unarchive from the
  list with a "Ready to archive" filter for likely-mastered problems; the
  whole active deck loads at once so sorting is correct past 100 problems;
  new sorts and columns for date added, last practiced, LeetCode number, and
  times practiced; the sort is kept in the URL.
- **AI key setup fix** (2026-10-15): a tester saved a DeepSeek key while
  Settings still said OpenAI / gpt-5.5. Save stored provider, model, and key
  without checking them, so the key was sent to OpenAI and analysis failed.
  Now Settings and onboarding ask for a provider first, then its key (with
  Back), and store the key only after the provider accepts it. A key that looks like another provider's
  gets "Use X instead". There is no model field: the server picks the
  provider's fast model from its live list and re-checks it weekly. Existing
  users move to the picked model before their next analysis. The DeepSeek
  Fast/Thinking toggle is gone. See ARCHITECTURE.md, "Adding a key" and
  "Model choice".
- **Session endings and deletion** (2026-10-17, `feat/session-endings`): a
  tester clicked Finish without submitting; the wrong solution was never
  seen, and the empty session counted as a finished attempt. Now Finish
  stops when nothing was submitted or accepted (Keep working, or Finish
  anyway as not solved), a review finished as not solved is rated Again at
  once, "End as unsuccessful" is gone, and a finished session can be
  deleted on the web problem page, undoing its rating or first-review
  schedule (migration 0026). See ARCHITECTURE.md, "Review scheduling" and
  "Practice sessions".

Planning documents that drove this work (the refactor plan and its
checkpoint log, the next-phase plan, the mistake-profile and daily-feed
designs, the paid-credits audit, the manual test guide) were retired on
2026-10-12; their essentials are in the four docs above. Read any of them with
`git show 6922425:docs/<NAME>.md` (`EXTENSION_FIRST_REFACTOR_PLAN`,
`EXTENSION_FIRST_CHECKPOINTS`, `NEXT_PHASE_PLAN`, `SESSION_HANDOFF`,
`MISTAKE_PROFILE_PLAN`, `DAILY_FEED_PLAN`, `PAID_AI_CREDITS`,
`PRE_COMMIT_AUDIT`, `TEST_GUIDE`, `RELEASE_CHECKLIST`, `SELF_HOSTING`).

## Next steps

### Now that the extension is public

- **Tell testers** who used the unpacked build to remove it and install from
  the store. Their data is on the server, so nothing is lost.

### Extension updates

Later extension updates: bump `version` in
`apps/extension/manifest.config.ts`, ship the web side first, then build,
zip, and upload a new package (DEPLOYMENT.md, "Extension release").

### Study lists (merged to main 2026-10-20)

A list-based practice workflow: built-in lists (Carl's 12 and
灵茶山艾府's 12 topic lists, moved to leetcode.com, grouped by author on
`/lists`), playlist-style user lists (drag to reorder, a row menu to pause,
rename, or delete), a daily time budget for new problems, and a pattern
axis in the mistake profile. The settled design is in ARCHITECTURE.md,
"Study lists" (the planning doc was retired once every phase shipped).
Merged from branch `claude/determined-pasteur-cid59n`; migration
`0027_study_lists` was applied to Production first. All four phases are done:

1. the importers and all 24 lists;
2. lists in the database, the list API, the `/lists` pages, and the
   problem page's Lists panel;
3. Today's plan: a daily time budget, equal turns across active lists,
   weak-pattern priority and check problems, interleaved reviews,
   study-plan settings, and the same-day re-solve rule;
4. the pattern profile: the pattern x cause grid on `/analysis`
   (`GET /api/mistakes/patterns`), weak patterns with a problem to practice
   next on Today's focus card.

Later polish on the branch: per-list shares removed (equal turns), My
problems pinned as the first row of Your lists, an "All lists" back
button on every list page, and the problems pages reworked: a "⋯" menu on
each row (Add to list, Archive), Add to list for selected problems, a
playlist-style add-to-list dialog, and a redesigned problem page (header
with actions and list links, a stats strip, full-width tabs; the resizable
side rail is gone).

Still open: the web screenshot baselines (Today, Lists, `/analysis`,
Problems, problem page) must be regenerated on the owner's machine after
review, since the nav, the problem page, Today, and `/analysis` changed.
Ask 灵茶山艾府 and Carl for permission before shipping the lists to users.
Browser tests run in a cloud container only with
a scratch `PLAYWRIGHT_BROWSERS_PATH` that maps Playwright's expected
Chromium build to the installed one (the container's build is older).

### Planned for 0.3.1

The owner wants both of these in the next release (extension 0.3.1 and the
web side that ships with it):

1. **Suggest from all of LeetCode.** The 177-problem `catalog.json` is too
   small: the same few problems keep coming up in the daily suggestions, and
   a "similar to a problem you practiced" pick often loses to a general one.
   Draw suggestions from the full LeetCode problem set instead. Until then,
   rerun `scripts/leetcode-catalog.js` now and then.
2. **ankileet's own icon.** `apps/extension/public/icons` (16, 32, 48, 128 px)
   are still Ankify's, unchanged since before the fork, so the store listing
   shows the same picture as Jimin's Ankify listing. Replace them with an
   ankileet icon, and update the store listing's icon and screenshots with
   the 0.3.1 upload. The web's `apps/web/public/icon-32.png` and
   `apple-touch-icon.png` are the same old picture; replace them together
   (`ankileet-mark.svg`, added at the rename, can be the starting point).
3. **Session endings** (merged; web side live): upload the panel's Finish
   check and the removal of "End as unsuccessful" with 0.3.1. Until then
   the 0.3.0 extension works against the live server; its "End as
   unsuccessful" now rates a review Again without asking.

**Owner decisions and console work:**

- Google Auth Platform (optional polish): verify `ankileet.com` in Search
  Console and finish Branding. The app is already published, so sign-in is
  open to everyone either way.
- Automatic analysis is `disabled` in Production. Unset
  `ANKILEET_AUTOMATIC_ANALYSIS` to turn it on for users with their own key
  (each can still turn it off in Settings).
- A daily dispatch-recovery cron is optional on Hobby (DEPLOYMENT.md).
- **Social preview image.** `apps/web/public/og.png` (1200×630) is the
  picture shown when an ankileet.com link is shared in Slack, Discord, X,
  iMessage, and similar apps (Open Graph / Twitter card metadata in
  `apps/web/src/app/(public)/page.tsx`). It still shows the old Ankify UI with
  quizzes and Study Coach. To replace it: run `pnpm dev:demo`, sign in at
  `http://localhost:3000/api/qa/login`, open `/today` or `/analysis` in a
  1200×630 window (or crop to it), save the screenshot over `og.png`, update
  the `alt` text in `page.tsx` to describe it, and ship. Check it with a
  link-preview tool such as opengraph.xyz; apps cache previews for a while.
- A support email for the store listing and OAuth branding, and optionally
  renaming the GitHub repo (then update the issue link in
  `privacy-content.tsx` and the README clone URL).

**Engineering backlog, roughly in priority order:**

1. Run `scripts/leetcode-live-probe.js` on real LeetCode: submission tracking,
   Submit detection, sign-out, and the theme signal are verified only against
   the fixture.
2. Rating Undo in the UI (the server supports `undo_rating`).
3. Dead-code cleanup: unused i18n `agent`/`quiz` groups, `LanguageToggle`,
   `ThemeToggle`, unused `components/ui` primitives.
4. Legacy removal (the plan's "M4"): drop Study Coach, card, quiz, and credit
   code, then their tables in a separate contract migration, after checking
   every reader, foreign key, and the account export. Keep confirmed mistake
   records whose evidence pointed at quizzes.
5. Retire `legacy_review` routes in code (no client has called them since
   0.3.0).

## Known issues and risks

- **Per-deployment database copies (2026-10-12).** The Turso integration's
  `branch` deployment action was on for Production, so each of the day's
  deployments ran on its own `dpl-<deployment id>` copy of the database and
  `database-ankileet` never received a write; after every deploy users had to
  sign in again and their history looked deleted. The action was turned off,
  the copies' data was merged into `database-ankileet` (one user per email,
  duplicate problems folded into the earliest; dumps in the gitignored
  `backups/`), and `check-vercel-env.mjs` now fails a Production build that
  points at a `dpl-` copy. The merge was verified and the `dpl-*` databases
  were deleted on 2026-10-13. See DEPLOYMENT.md, "One database for every
  deployment". The owner's account may still show one stale active Two Sum
  voluntary session (started 2026-10-12 21:55 UTC) from the merge; finishing
  or abandoning it is harmless.
- **Analysis model choice depends on provider naming.** The rules in
  `server/ai-model-choice.ts` (Haiku, GPT `-mini`, Gemini Flash, DeepSeek
  Flash) assume the fast tier keeps those family names; if a provider renames
  it, the pick falls back to `FALLBACK_ANALYSIS_MODEL`. `pnpm
  qa:provider-smoke` shows each provider's live pick. On 2026-10-15, with
  fresh keys, DeepSeek (`deepseek-flash`), OpenAI (`gpt-5.4-mini`), and
  Anthropic (`claude-haiku-5-5`) passed end to end. Gemini verified on
  `gemini-3.7-flash` (3.8 Flash was busy), but its analysis got 503 "high
  demand" on all three attempts. The worker retries the same model on a 503;
  switching to the next ranked model, as verification does, is a possible
  improvement.
- `@ai-sdk/google` is pinned to `4.0.50`: newer releases target a newer
  provider spec than `ai@7.0.58` and fail typecheck. Upgrade all `ai` and
  `@ai-sdk/*` packages together.
- DeepSeek logs a harmless "responseFormat not supported" warning on each
  analysis.
- The time zone comes from the device (web `TimeZoneSync`, the extension's
  overview request); Settings doesn't show it.
- The e2e QA settings persist across specs; keep specs independent of order.
  `web.spec.ts` "the suggestions page acts on the same items as the popup"
  passes alone and in the full suite, but fails (on `main` too) when run
  with only the outbox tests of `cutover.spec.ts` and `sessions.spec.ts`
  before it: the replacement's "Already attempted" card stays. Not
  investigated yet.
- Vercel Hobby is for non-commercial use. Before charging money, move to
  Vercel Pro or to Cloudflare Workers (OpenNext, Cloudflare Queues behind
  `dispatchAiJob()`); the custom domain keeps that move invisible to the
  extension.
- Until 2026-10-12 the unpacked build reused Ankify's development key, so its
  ID (`gcldkcaidjnkaagngppblefddapdpaeb`) is Ankify's store listing ID. ankileet
  now has its own key (ID `dboijhnmohmpceamddfchbjicdgcgnlg`); the old ID must
  not stay in `ANKILEET_EXTENSION_ORIGINS`, because Production would then
  trust an extension someone else publishes.

## Working agreements

- `main` deploys Production. Work on a branch, run the gate, merge, push.
- Migrations before the code that needs them; never edit an applied one.
- Never touch Ankify's Vercel project, database, or store listing.
- Never put live Stripe keys outside Production, a short-lived Turso token in
  Vercel, or any secret in chat, commits, or logs. `AI_KEY_ENCRYPTION_SECRET`
  never changes.
- Commit messages end with the `Co-Authored-By` line your tool requires.

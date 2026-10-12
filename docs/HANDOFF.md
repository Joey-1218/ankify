# Handoff

Where ankileet stands and what's next, for whoever picks it up (a person or
an agent with repo access and no conversation history). Verify claims against
the code and `git log`; update this file when the state changes.

Read in this order: [CLAUDE.md](../CLAUDE.md) (rules and UI conventions),
[ARCHITECTURE.md](ARCHITECTURE.md) (how it works),
[DEVELOPMENT.md](DEVELOPMENT.md) (run and test it),
[DEPLOYMENT.md](DEPLOYMENT.md) (ship it).

## State (2026-10-12)

- **Live:** `https://ankileet.com` on Vercel (`iad1`) with Turso
  (`aws-us-east-1`), all 26 migrations applied. Google sign-in, practice
  sessions through the extension, and BYOK session analysis (DeepSeek) were
  verified end to end in Production.
- **Extension 0.3.0:** submitted to the Chrome Web Store, **in review**.
  Testers use the unpacked Production build (see DEPLOYMENT.md). While the
  Google OAuth app is in Testing mode, testers must be listed as test users.
- **Gate:** `pnpm release:check` passes: about 520 unit tests, 47 browser
  tests, builds, manifest check; the audit leaves only low/moderate advisories.
- **Product scope:** spaced repetition of whole LeetCode problems. The
  extension tracks practice sessions on leetcode.com; FSRS-6 schedules each
  problem; finished sessions can be analyzed on the user's own AI key; the
  mistake profile counts confirmed causes of failure; suggestions offer
  never-attempted problems. Study Coach, AI cards and quizzes, and paid
  credits are suspended in code.
- **Suggestion catalog:** generated 2026-10-12 (177 problems), so new
  accounts get suggestions before they have practice history.

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

Planning documents that drove this work (the refactor plan and its
checkpoint log, the next-phase plan, the mistake-profile and daily-feed
designs, the paid-credits audit, the manual test guide) were retired on
2026-10-12; their essentials are in the four docs above. Read any of them with
`git show 6922425:docs/<NAME>.md` (`EXTENSION_FIRST_REFACTOR_PLAN`,
`EXTENSION_FIRST_CHECKPOINTS`, `NEXT_PHASE_PLAN`, `SESSION_HANDOFF`,
`MISTAKE_PROFILE_PLAN`, `DAILY_FEED_PLAN`, `PAID_AI_CREDITS`,
`PRE_COMMIT_AUDIT`, `TEST_GUIDE`, `RELEASE_CHECKLIST`, `SELF_HOSTING`).

## Next steps

**When the store approves the extension** (DEPLOYMENT.md, "After the first
approval"):

1. Add the store ID to `ANKILEET_EXTENSION_ORIGINS` and set
   `NEXT_PUBLIC_EXTENSION_INSTALL_URL`; redeploy.
2. Point the README's "Install the extension" section at the listing.
3. Install from the store and run one session.

**Owner decisions and console work:**

- Google Auth Platform: verify `ankileet.com` in Search Console, finish
  Branding, and publish the app (External), so anyone can sign in.
- Automatic analysis is `disabled` in Production. Unset
  `ANKILEET_AUTOMATIC_ANALYSIS` to turn it on for users with their own key
  (each can still turn it off in Settings).
- A daily dispatch-recovery cron is optional on Hobby (DEPLOYMENT.md).
- A social preview image (`og.png`), a support email for the store and OAuth
  branding, and optionally renaming the GitHub repo (then update the issue
  link in `privacy-content.tsx` and the README clone URL).

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
6. Keep `catalog.json` fresh by rerunning `scripts/leetcode-catalog.js` now and
   then.

## Known issues and risks

- `@ai-sdk/google` is pinned to `4.0.50`: newer releases target a newer
  provider spec than `ai@7.0.58` and fail typecheck. Upgrade all `ai` and
  `@ai-sdk/*` packages together.
- DeepSeek logs a harmless "responseFormat not supported" warning on each
  analysis.
- The time zone comes from the device (web `TimeZoneSync`, the extension's
  overview request); Settings doesn't show it.
- The e2e QA settings persist across specs; keep specs independent of order.
- Vercel Hobby is for non-commercial use. Before charging money, move to
  Vercel Pro or to Cloudflare Workers (OpenNext, Cloudflare Queues behind
  `dispatchAiJob()`); the custom domain keeps that move invisible to the
  extension.
- The unpacked build's ID equals Ankify's store listing ID, so the two can't
  be installed in one Chrome profile.

## Working agreements

- `main` deploys Production. Work on a branch, run the gate, merge, push.
- Migrations before the code that needs them; never edit an applied one.
- Never touch Ankify's Vercel project, database, or store listing.
- Never put live Stripe keys outside Production, a short-lived Turso token in
  Vercel, or any secret in chat, commits, or logs. `AI_KEY_ENCRYPTION_SECRET`
  never changes.
- Commit messages end with the `Co-Authored-By` line your tool requires.

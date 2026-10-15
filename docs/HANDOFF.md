# Handoff

Where ankileet stands and what's next, for whoever picks it up (a person or
an agent with repo access and no conversation history). Verify claims against
the code and `git log`; update this file when the state changes.

Read in this order: [CLAUDE.md](../CLAUDE.md) (rules and UI conventions),
[ARCHITECTURE.md](ARCHITECTURE.md) (how it works),
[DEVELOPMENT.md](DEVELOPMENT.md) (run and test it),
[DEPLOYMENT.md](DEPLOYMENT.md) (ship it).

## State (2026-10-13)

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

Planning documents that drove this work (the refactor plan and its
checkpoint log, the next-phase plan, the mistake-profile and daily-feed
designs, the paid-credits audit, the manual test guide) were retired on
2026-10-12; their essentials are in the four docs above. Read any of them with
`git show 6922425:docs/<NAME>.md` (`EXTENSION_FIRST_REFACTOR_PLAN`,
`EXTENSION_FIRST_CHECKPOINTS`, `NEXT_PHASE_PLAN`, `SESSION_HANDOFF`,
`MISTAKE_PROFILE_PLAN`, `DAILY_FEED_PLAN`, `PAID_AI_CREDITS`,
`PRE_COMMIT_AUDIT`, `TEST_GUIDE`, `RELEASE_CHECKLIST`, `SELF_HOSTING`).

## Next steps

### When the Chrome Web Store approves the extension

The store build gets its own 32-letter extension ID, different from the
unpacked ID (`dboijhnmohmpceamddfchbjicdgcgnlg`). The server only accepts
requests from extension IDs listed in `ANKILEET_EXTENSION_ORIGINS`, so until
step 2 is done **the store version can't sign in or sync**. Do steps 1–4 the
same day the approval email arrives.

1. **Find the store ID.** In the Chrome Web Store developer dashboard, open
   the item: the ID is shown under its name (also the last part of the public
   listing URL, `https://chromewebstore.google.com/detail/<name>/<ID>`). It is
   32 letters `a`–`p`. Below, `<ID>` means that value; never type the angle
   brackets.
2. **Tell Production about it.** Replace the origins variable, keeping the
   unpacked ID so your own and testers' unpacked copies keep working, then
   add the install link (run from the repo root):

   ```bash
   vercel env rm ANKILEET_EXTENSION_ORIGINS production --yes
   printf '%s' "chrome-extension://dboijhnmohmpceamddfchbjicdgcgnlg,chrome-extension://<ID>" \
     | vercel env add ANKILEET_EXTENSION_ORIGINS production
   printf '%s' "https://chromewebstore.google.com/detail/<ID>" \
     | vercel env add NEXT_PUBLIC_EXTENSION_INSTALL_URL production
   ```

   Rules the build checks: each origin is exactly `chrome-extension://` plus
   the ID, comma-separated, no spaces, no trailing slash. In the dashboard
   instead: Project → Settings → Environment Variables, edit or add the two
   names for **Production** only.
3. **Redeploy** so the new values take effect (see "Redeploying" in
   DEPLOYMENT.md). `NEXT_PUBLIC_*` values are baked in at build time, so this
   must be a fresh build, not just a restart:

   ```bash
   vercel ls ankileet --prod                         # copy the newest Ready URL
   vercel redeploy <that url> --target production
   vercel ls ankileet --prod                         # wait for the new row: Ready
   ```

   If the build fails with `ANKILEET_EXTENSION_ORIGINS must contain ...`, the
   value has a typo or a leftover `<ID>`: fix it in step 2 and redeploy.
4. **Check it end to end:**
   - `https://ankileet.com`: "Get the extension" now opens your store listing
     (`curl -s https://ankileet.com/ | grep -o 'chromewebstore[^"]*'` shows
     `<ID>`).
   - In Chrome, remove or turn off the unpacked ankileet (both would add a
     panel on LeetCode), install from the store, sign in on ankileet.com,
     click the extension icon: the popup shows your data with no sign-in
     error.
   - Open a LeetCode problem, Start practice, submit once, Finish. The session
     appears on `/today`.
   - If the popup keeps asking to sign in or says it can't reach ankileet,
     step 2 or 3 didn't take: check the variable value, then redeploy again.
5. **Update the README** (`README.md`, "Install the extension"): replace the
   build-from-source paragraph with a store link, keeping the build steps as
   an alternative, e.g.

   ```markdown
   Install **[ankileet from the Chrome Web Store](https://chromewebstore.google.com/detail/<ID>)**.

   To build it yourself instead (Node 22 and pnpm 10): ...the existing steps...
   ```

   Also point the top-of-page "Install the extension" link at the store URL.
   Commit and push to `main` (this deploys again, which is fine).
6. **Tell testers** who used the unpacked zip to remove it and install from
   the store. Their data is on the server, so nothing is lost.
7. **Clean up docs:** in DEPLOYMENT.md's Production identity and variables
   tables, record the store ID and the new `NEXT_PUBLIC_EXTENSION_INSTALL_URL`;
   in this file, change the State section to "published" and delete this
   checklist.

Later extension updates: bump `version` in
`apps/extension/manifest.config.ts`, ship the web side first, then build,
zip, and upload a new package (DEPLOYMENT.md, "Extension release").

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

**Owner decisions and console work:**

- Google Auth Platform: verify `ankileet.com` in Search Console, finish
  Branding, and publish the app (External), so anyone can sign in.
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

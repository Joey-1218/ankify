# Ankileet release checklist

Use this checklist for the first public release and for later releases that
change authentication, storage, migrations, permissions, or data handling.

Canonical Production Web/API origin: `https://ankileet.com`.
`ANKILEET_EXTENSION_API_ORIGIN` is an Extension build-time variable, not a Vercel
runtime variable.

Canonical Production data target: the Vercel Turso integration database
`database-ankileet` in organization
`vercel-icfg-zya5xbvroaxq7vt9lfgh5xfg`. No other database may be used for
Production migrations. Follow
[`DEPLOYMENT.md`](DEPLOYMENT.md) for the full identity and verification runbook.

## 1. Prepare Preview

- [ ] Create a dedicated Preview Turso database. Never point Preview at Production.
- [ ] Configure the Preview Vercel variables listed in `.env.example`, including
      `ANKILEET_DEPLOYMENT_ENV=preview` and normally `ANKILEET_DISABLE_SIGNUP=true`.
- [ ] Use a stable Preview branch domain for `BETTER_AUTH_URL` and register its
      Google OAuth callback when Preview login is needed.
- [ ] Apply pending Preview migrations from one controlled terminal:

  ```bash
  pnpm db:migrate:preview
  ```

- [ ] Run the release gate locally:

  ```bash
  ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm release:check
  ```

## 2. Verify Preview

- [ ] Sign in with two unrelated Google accounts and confirm each sees only its own data.
- [ ] Capture one problem and both an accepted and failed submission.
- [ ] Configure an AI provider, generate and confirm a card, then complete a quiz.
- [ ] Rate a review and confirm the next due date and Analysis history.
- [ ] Sign into the web app, open the extension, and confirm it connects without
      creating or pasting a token. Then sign out on the web and confirm the
      extension requests sign-in again.
- [ ] Download the Settings data export and confirm it contains no login secret
      or encrypted AI-key envelope.
- [ ] Confirm `/privacy`, `/terms`, and `/robots.txt` are public.
- [ ] Confirm an unauthenticated app page redirects to `/login` and an
      unauthenticated API request returns `401`.
- [ ] Inspect Vercel logs for secrets, provider response bodies, or user code.
- [ ] If paid AI credits are enabled: run the manual Stripe test-mode procedure
      in [`PAID_AI_CREDITS.md`](PAID_AI_CREDITS.md) (card and Link purchase,
      resent event, full and partial refund) against Preview with test keys and
      a Preview webhook endpoint.

## 3. Prepare Production data

- [ ] Run `turso org switch vercel-icfg-zya5xbvroaxq7vt9lfgh5xfg` and confirm
      `turso db list` returns `database-ankileet` with the canonical integration URL.
- [ ] Run read-only migration/user/problem counts against `database-ankileet` and
      compare them with the Drizzle journal and authenticated Production UI.
- [ ] Confirm Vercel Production uses `TURSO_DATABASE_URL` and
      `TURSO_AUTH_TOKEN`, and every `ANKILEET_*` name (no leftover `ANKIFY_*`).
- [ ] Confirm Production has its own auth secret, Google OAuth credentials, and
      encryption secret.
- [ ] Keep `AI_KEY_ENCRYPTION_SECRET` backed up and stable for this database.
- [ ] Back up and migrate before deploying code that depends on a new schema:

  ```bash
  pnpm db:release
  ```

- [ ] Use expand/deploy/contract rather than a single breaking migration.
- [ ] Confirm `ANKILEET_DISABLE_SIGNUP=false` for public registration.
- [ ] Migration `0012_next_black_tarantula.sql` drops the retired `apikey`
      table. Confirm old manual extension tokens are no longer needed.

## 4. Deploy Production web

- [ ] In Vercel, use `apps/web` as Root Directory and enable source files from
      outside the root directory.
- [ ] Confirm all Production variables, `BETTER_AUTH_URL=https://ankileet.com`,
      and `ANKILEET_DEPLOYMENT_ENV=production`.
- [ ] Confirm `ANKILEET_EXTENSION_ORIGINS` contains the exact stable extension ID;
      cookie-session CORS and Better Auth trusted origins depend on it.
- [ ] Deploy only after CI and `pnpm release:check` pass.
- [ ] Verify `/login`, `/privacy`, `/terms`, OAuth callback, app redirects,
      authenticated API access, CSP/security headers, and one complete review flow.
- [ ] Confirm Vercel runtime logs contain neither provider response bodies nor
      API-key fragments; retain only classified error codes and safe request identifiers.
- [ ] Confirm the authenticated deployment shows recognizable data from
      `database-ankileet`.
- [ ] Open Study Coach and complete one real Agent turn with a valid provider
      key, including a read-only tool call and streaming response.
- [ ] Confirm the `ankileet-ai-generation` Queue trigger is deployed and one
      queued Card or Quiz job reaches a terminal success state.
- [ ] In Google Auth Platform, set the audience to External and publish the app.
- [ ] Use the public root URL as the OAuth homepage, `/privacy` as the privacy
      policy, and `/terms` as the terms URL. Verify domain ownership in Search Console.
- [ ] Request only the standard `openid`, `email`, and `profile` scopes and
      complete Google's brand verification before broad promotion.

## 5. Package the Chrome extension

- [ ] Build with the exact HTTPS Production API origin:

  ```bash
  ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm --filter @ankileet/extension build
  ```

- [ ] Inspect `apps/extension/dist/manifest.json`: exact LeetCode/API hosts only,
      no localhost, wildcard Vercel, `activeTab`, or `scripting` permissions.
- [ ] Load the packaged build, test automatic web-session login and capture/review, then refresh
      already-open LeetCode tabs after updating the extension.
- [ ] Use `https://ankileet.com/privacy` as the Chrome Web Store privacy-policy URL.
- [ ] Complete the Chrome Web Store privacy disclosures for authentication data,
      website content, user code/submissions, and remote AI processing.
- [ ] If the Web Store ID differs from the unpacked-build ID, update Production
      `ANKILEET_EXTENSION_ORIGINS=chrome-extension://<web-store-id>` and redeploy.

## 6. Rollout and recovery

- [ ] Monitor signup rate, database growth, Vercel usage, and rate-limit records.
      AI remains BYOK, so provider usage is charged to each user's provider account.
- [ ] Keep the pre-migration backup until the release has been exercised in Production.
- [ ] Roll back application code independently of migrations. Never run destructive
      contract migrations until all deployed code uses the expanded schema.
- [ ] Test account deletion with a disposable user and confirm sign-in,
      problems, cards, submissions, quizzes, history, and settings are gone.

# Deployment

The runbook for ankileet Production: what runs where, how to ship a change,
how to touch the database safely, and how to release the extension. Local
setup and tests are in [DEVELOPMENT.md](DEVELOPMENT.md); how the system works
is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Production identity

As of 2026-10-12:

| Resource | Value |
| --- | --- |
| Web/API origin | `https://ankileet.com` (`www` redirects to the apex). The domain is registered on Vercel |
| Vercel project | `ankileet` in team `amor-6509`, Root Directory `apps/web`, "Include source files outside the Root Directory" on |
| Function region | `iad1` (`apps/web/vercel.json`), next to the database |
| Node | 22.x (`engines` in the root and `apps/web` `package.json`) |
| Database | Turso via the Vercel Turso integration: organization `vercel-icfg-zya5xbvroaxq7vt9lfgh5xfg`, database `database-ankileet`, region `aws-us-east-1` |
| Database URL | `libsql://database-ankileet-vercel-icfg-zya5xbvroaxq7vt9lfgh5xfg.aws-us-east-1.turso.io` |
| AI queue | Vercel Queue topic `ankileet-ai-generation` (trigger declared in `apps/web/vercel.json`) |
| Google OAuth | One Web client. Redirect URIs `https://ankileet.com/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google` |
| Extension | Unpacked/dev ID `gcldkcaidjnkaagngppblefddapdpaeb` (fixed by the dev `key` in `apps/extension/manifest.config.ts`). The Chrome Web Store listing gets its own ID |

ankileet began as a fork of Ankify and is deployed independently of it.
Never run a migration, backup, or deploy against Ankify's resources
(`ankify-pi.vercel.app`, Turso `database-ankify`, region `hnd1`, or its store
listing). Select the database by the exact organization and URL above, never
by a plausible name.

## Production variables

All live in Vercel → Project → Settings → Environment Variables →
Production, marked Sensitive. `scripts/check-vercel-env.mjs` validates them at
build time, so a bad value fails the deployment instead of the site.

| Variable | Value / rule |
| --- | --- |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Managed by the Turso integration. Never paste a short-lived CLI token here |
| `BETTER_AUTH_URL` | `https://ankileet.com` |
| `BETTER_AUTH_SECRET` | Production-only random secret |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The Production OAuth client |
| `AI_KEY_ENCRYPTION_SECRET` | **Never change it.** Rotating or losing it makes every saved user AI key unreadable, even after a backup restore. Keep a copy in a password manager |
| `ANKILEET_DEPLOYMENT_ENV` | `production` |
| `ANKILEET_EXTENSION_ORIGINS` | Comma-separated `chrome-extension://<32-letter id>` origins, no trailing slash. Today: the unpacked ID. After store approval: the unpacked ID **and** the store ID |
| `ANKILEET_DISABLE_SIGNUP` | `false`. `true` pauses new accounts; existing users still sign in |
| `ANKILEET_AUTOMATIC_ANALYSIS` | `disabled` today. Unset it to turn automatic analysis on for users with their own key |
| `ANKILEET_DISABLED_WORKFLOWS` | Optional kill switches, e.g. `legacy_review`, `session_analysis`, `suggestions` |
| `NEXT_PUBLIC_EXTENSION_INSTALL_URL` | Unset until the store listing is live (the site then links to the README's build instructions). Then `https://chromewebstore.google.com/detail/<store id>` |
| `CRON_SECRET` | Optional; only with the dispatch cron below |

Not set (legacy, suspended): `ANKILEET_STARTER_AI_*`, `STRIPE_*`,
`ANKILEET_ENABLED_LEGACY_WORKFLOWS`. See "Legacy workflows" below before
setting any of them.

Changing a variable does nothing to the running deployment: redeploy after
saving (`vercel redeploy <current production url> --target production`, or
Deployments → ⋯ → Redeploy). Set values with `printf '%s' "$VALUE" | vercel env
add NAME production` so no trailing newline sneaks in, and never paste guide
placeholders such as `<STORE_ID>` literally.

## Shipping a change

`main` is Production: every push to `main` deploys `https://ankileet.com`.
Other branches never deploy (`git.deploymentEnabled` in `apps/web/vercel.json`).
So work on a branch and merge only what passed the gate.

1. **Branch** from an up-to-date main:

   ```bash
   git switch main && git pull --ff-only && pnpm install --frozen-lockfile
   git switch -c feat/<name>
   ```

2. **Develop** locally ([DEVELOPMENT.md](DEVELOPMENT.md)). Local work never
   points at Production: `.env.local` keeps `TURSO_*` empty.
3. **Gate.** Stop your own dev servers first (the browser tests start theirs):

   ```bash
   ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm release:check
   ```

   It runs typecheck, lint, unit tests, browser tests, the production builds,
   the manifest check, and a dependency audit (high/critical fails). It passes
   only if it finishes without `ELIFECYCLE`. If the audit fails, bump the
   direct dependency or raise the pin in the root `pnpm.overrides`, then
   `pnpm install` and rerun; don't skip it.
4. **Migrate Production first**, only if the change added files under
   `packages/db/drizzle/` (see "Database operations").
5. **Merge and push**:

   ```bash
   git switch main && git pull --ff-only
   git merge --no-ff feat/<name> && git push origin main
   ```

6. **Watch and smoke-test**:

   ```bash
   vercel ls ankileet --prod                  # newest row: Building → Ready
   vercel inspect <deployment-url> --logs     # if it failed
   for p in / /login /privacy /terms /today /api/me; do
     printf "%s " "$(curl -s -o /dev/null -w '%{http_code}' https://ankileet.com$p)"
   done; echo                                 # expect: 200 200 200 200 307 401
   ```

   Then by hand: sign in, open `/today`, run one practice session through the
   extension, and one session analysis if AI code changed.

Common build failures (Build Logs, search `Vercel environment validation
failed`):

| Message | Fix |
| --- | --- |
| `X is required` | Add the missing Production variable, redeploy |
| `ANKILEET_EXTENSION_ORIGINS must contain comma-separated chrome-extension://<32-character-id> origins` | A malformed or placeholder origin; fix the value, redeploy |
| `ANKILEET_DEPLOYMENT_ENV ... does not match VERCEL_ENV` | Must be `production` |
| `LOCAL_DB_PATH must not be set on Vercel` | Delete that variable |
| `no such table` (runtime) | The migration step was skipped: migrate, then redeploy |

### When something breaks

- **Bad web code:** `vercel rollback <last good deployment url>` (or Instant
  Rollback in the dashboard), then fix forward on a branch. A rollback does not
  undo migrations, so it's safe only if the old code works with the new schema;
  that's why migrations are additive (expand, deploy, contract).
- **AI analysis misbehaves:** `ANKILEET_AUTOMATIC_ANALYSIS=disabled` stops
  automatic jobs; `ANKILEET_DISABLED_WORKFLOWS=session_analysis` refuses all new
  jobs and fails queued ones before any provider call. Redeploy. Stored
  analyses and confirmed mistakes stay.
- **Suggestions misbehave:** add `suggestions` to `ANKILEET_DISABLED_WORKFLOWS`.
  Allocation and actions answer `503`; stored rows stay.
- **A migration failed:** don't deploy the code that needs it. Keep the error
  and the backup, and fix with a **new** migration; never edit an applied one.
- **Data loss or corruption:** stop and keep the current database and backups
  untouched. Restoring a backup discards everything written after it.

## Database operations

Migrations never run during a Vercel build. Apply them from one terminal,
**before** deploying code that needs them.

1. Identify the database, read-only:

   ```bash
   turso auth login
   turso org switch vercel-icfg-zya5xbvroaxq7vt9lfgh5xfg
   turso db show database-ankileet        # URL must match the table above
   turso db shell database-ankileet "SELECT COUNT(*) FROM __drizzle_migrations;"
   ```

   The count must equal the entries already applied in
   `packages/db/drizzle/meta/_journal.json` (26 as of 2026-10-12). A mismatch
   means stop.
2. Put a short-lived token in the gitignored `.env.production.local`:

   ```bash
   turso db tokens create database-ankileet --expiration 1d
   ```

   ```dotenv
   TURSO_DATABASE_URL="libsql://database-ankileet-vercel-icfg-zya5xbvroaxq7vt9lfgh5xfg.aws-us-east-1.turso.io"
   TURSO_AUTH_TOKEN="<the 1-day token>"
   ```

3. Back up and migrate: `pnpm db:release` writes
   `backups/database-ankileet-<time>.db`, checks its foreign keys, then applies
   pending migrations. Re-run the count; it must equal the journal's entries.
   Keep the backup until the release has passed its smoke test.

Notes:

- `pnpm db:backup` alone makes a backup. Backups contain sessions and
  encrypted keys: keep the ones you retain in encrypted storage.
- Never invalidate all database tokens: that also kills the Vercel runtime
  credential.
- Preview, if you ever enable it, needs its own Turso database, secrets,
  `ANKILEET_DEPLOYMENT_ENV=preview`, a stable branch domain for
  `BETTER_AUTH_URL`, and normally `ANKILEET_DISABLE_SIGNUP=true`; migrate it
  with `pnpm db:migrate:preview`. Remove the `main`-only rule in `vercel.json`
  to allow Preview deployments.

## Extension release

The API origin is compiled into the extension; users can't point a build at
another server.

| Build | Command | Use |
| --- | --- | --- |
| Unpacked (keeps the dev `key`, ID `gcldkcaidjnkaagngppblefddapdpaeb`) | `ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm extension:build:unpacked` → `apps/extension/dist-unpacked` | Your own Chrome and testers during store review (zip the folder) |
| Store (no `key`) | `ANKILEET_EXTENSION_API_ORIGIN=https://ankileet.com pnpm --filter @ankileet/extension build` → `apps/extension/dist` | Zip the folder's contents and upload |

`pnpm extension:check-manifest` enforces the store rules: only `leetcode.com`
and the exact API host, no `key`, no localhost, `activeTab`, or `scripting`.
Permissions are `storage`, `tabs`, and `alarms`.

Store listing material (icon, screenshots, description, permission
justifications) is in `apps/extension/store-assets/`. Privacy policy URL:
`https://ankileet.com/privacy`.

**After the first approval:**

1. Add the store ID to Production: `ANKILEET_EXTENSION_ORIGINS=chrome-extension://gcldkcaidjnkaagngppblefddapdpaeb,chrome-extension://<store id>`,
   and set `NEXT_PUBLIC_EXTENSION_INSTALL_URL=https://chromewebstore.google.com/detail/<store id>`.
   Redeploy. Without the origin, the store build can't sign in.
2. Point the README's install section at the listing.
3. Remove the unpacked copy (both would add a panel to LeetCode), install
   from the store, and run one practice session. The unpacked build shares
   its ID with Ankify's listing, so the two can't be installed side by side.

**Updates:** bump `version` in `apps/extension/manifest.config.ts` (the store
rejects a version it already has), ship the commit as above, then build, zip,
and upload under Package → Upload new package. Deploy the web app first and
keep it accepting what the previous extension version sends: users update
hours or days later and can't downgrade, so a bad extension release is fixed
forward with a higher version.

## Google sign-in

Google Auth Platform (Cloud Console), for the Production client:

- **Branding:** app name, support email, homepage `https://ankileet.com`,
  privacy `https://ankileet.com/privacy`, terms `https://ankileet.com/terms`,
  authorized domain `ankileet.com`. Google requires proof of ownership: add the
  domain as a **Domain** property in Search Console with the same Google
  account, put its `google-site-verification=…` TXT record in Vercel DNS
  (`vercel dns add ankileet.com @ TXT "google-site-verification=…"`), and verify.
- **Audience:** External. While in Testing, only listed test users can sign
  in. Publishing with only `openid`, `email`, and `profile` scopes needs no
  security review, though Google may verify the branding.

## AI dispatch recovery (optional cron)

Analysis jobs are published to the queue after their transaction commits. A
job whose publish failed waits with `dispatched_at` unset and is re-sent on the
same user's next popup, problem-page, or analysis request. A cron can re-send
them for everyone:

1. Vercel Hobby allows only daily crons (a more frequent schedule fails the
   deploy), so on Hobby rely on request-time recovery or use a daily schedule.
2. Set `CRON_SECRET` (32+ random characters) and add to `apps/web/vercel.json`:
   `"crons": [{ "path": "/api/cron/ai-dispatch", "schedule": "0 9 * * *" }]`.
3. Verify `curl -H "Authorization: Bearer $CRON_SECRET" https://ankileet.com/api/cron/ai-dispatch`
   returns `{"stranded":0,"dispatched":0}` and the same request without the
   header returns `401`. The route answers `404` while `CRON_SECRET` is unset.

## Legacy workflows

Study Coach, AI card/quiz generation, and credit checkout are suspended in
code (`410 workflow_suspended`). `ANKILEET_ENABLED_LEGACY_WORKFLOWS` re-enables
one deliberately; they need the hosted key (`ANKILEET_STARTER_AI_API_KEY` plus
`_PROVIDER`, `_MODEL`, `_CREDITS`), and checkout also needs `STRIPE_SECRET_KEY`
and `STRIPE_WEBHOOK_SECRET` (live keys only on Production, test keys
elsewhere; both the build check and the runtime refuse a mismatch) with a
Stripe webhook at `https://ankileet.com/api/billing/webhook` for
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, and
`charge.refunded`. Never remove the hosted key while users hold purchased
credits. The privacy policy and terms describe a free, BYOK-only service, so
update them before re-enabling anything paid.

`legacy_review` (`POST /api/review/rate` and `/undo`) serves pre-0.3.0
extensions only; no current client calls it. With
`ANKILEET_DISABLED_WORKFLOWS=legacy_review` those routes answer `426
upgrade_required`.

## Running your own instance

The same steps work for a self-hosted copy: create a Vercel project with Root
Directory `apps/web`, provision Turso through the integration in a region near
the function region in `vercel.json`, set the variables above with your own
domain and secrets, register your OAuth redirect URI, run `pnpm db:release`
against your database, deploy, and build the extension with
`ANKILEET_EXTENSION_API_ORIGIN=https://<your domain>`.

# Deploying SocialOS

A step-by-step guide from an empty account to a live product. After each step, **Settings → Setup
checklist** in the app shows what's still missing.

## 1. Supabase (database, login, file storage)

1. Create a project at https://supabase.com/dashboard. Pick the region closest to your customers.
   Use a paid plan for production: free projects pause when idle and have no point-in-time backups.
2. Run the 15 migrations in `supabase/migrations/` in filename order (SQL editor, or
   `npx supabase link --project-ref <ref>` then `npx supabase db push`).
3. **Authentication → URL configuration:** Site URL = `https://YOUR-DOMAIN`, add
   `https://YOUR-DOMAIN/auth/callback` to Redirect URLs.
4. **Authentication → Providers → Email:** keep **Confirm email** on. Invitations rely on people
   proving they own their email address.
5. **Authentication → SMTP:** send login emails through Resend (step 4) so they come from your domain.
6. Copy the project URL, publishable key and secret key (Project Settings → API keys).

## 2. Hosting (Vercel or any Node host)

1. Import the repository. Root directory: `apps/web`. Framework: Next.js.
2. Background jobs and uploads run for up to 300 seconds; make sure your plan allows functions that long.
3. Add the environment variables from `apps/web/.env.example`:
   - `APP_URL=https://YOUR-DOMAIN` (no trailing slash)
   - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
   - `CRON_SECRET` and `MEDIA_PROXY_SECRET`: generate each with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - Leave `ENABLE_MOCK_ACCOUNTS` unset.
   - `LEGAL_*` company details. The legal pages are built at deploy time, so redeploy after changing them.
4. Connect your domain.
5. Check `https://YOUR-DOMAIN/api/health` returns `{"ok":true}`. Point an uptime monitor at it.

## 3. Scheduled jobs

In the Supabase SQL editor, fill in your URL and `CRON_SECRET` in `supabase/ops/schedule-publisher.sql`
and run it once. It schedules publishing (every minute), inbox (5 min), analytics (15 min), research
(hourly) and maintenance (daily). The Setup checklist shows when each last ran.

## 4. Email (Resend)

Verify your sending domain at https://resend.com, then set `RESEND_API_KEY` and
`ALERT_EMAIL_FROM` (e.g. `SocialOS <alerts@YOUR-DOMAIN>`). This covers alerts, invitations, approvals
and payment failures.

## 5. Billing (Stripe)

See README → Billing. Test with `sk_test_` keys first, then repeat in live mode: `npm run
stripe:setup -w @socialos/web -- --live`, then set up the live webhook and Customer Portal. Mark your own
organization free: `update organizations set billing_exempt = true where slug = '...';`

## 6. AI and images

`ANTHROPIC_API_KEY` is required for every AI feature. Image keys (Cloudflare, Gemini, OpenAI) and
`PEXELS_API_KEY` are optional; each option appears once its key is set. Set spending limits in each
provider's console as a backstop to the per-plan budgets.

## 7. Social platform apps

Each platform needs a developer app. Until it's approved for public use, only the app's own
admins and testers can connect. Use these for every app:

- Redirect URL: `https://YOUR-DOMAIN/api/oauth/{meta|linkedin|x|youtube|tiktok|threads}/callback`
- Privacy Policy: `https://YOUR-DOMAIN/legal/privacy`
- Terms: `https://YOUR-DOMAIN/legal/terms`
- Data deletion instructions: `https://YOUR-DOMAIN/legal/data-deletion`
- App icon: `apps/web/public/brand/`

The permissions to request are in README → Connecting real platforms. Reviews usually ask for a screen
recording that shows each permission being used, so record: connecting an account, scheduling a post,
the Analytics page and the Inbox.

| Platform | Before going public |
|---|---|
| Meta (Facebook, Instagram) | Business verification; App Review for each permission; switch the app to Live |
| Threads | App Review for threads_* permissions |
| LinkedIn | Apply for the Community Management API; the review takes weeks. Add the `*_social_feed` permissions to `LINKEDIN_SCOPES` once they're granted |
| X | A paid API tier: posting, reading replies and metrics all use credits |
| YouTube / Google | OAuth consent screen verification (sensitive scopes), a YouTube API compliance audit so uploads can be public, and a quota increase. The default daily quota covers only a few uploads |
| TikTok | Content Posting API audit (until then posts are private) and domain verification. Re-check the adapter against TikTok's docs first; it was built without access to them |

## 8. Before you invite customers

- Every required item on the Setup checklist is green, and every scheduled job ran recently.
- A lawyer has reviewed the privacy policy and terms (look for `[bracketed]` placeholders).
- Do a full run with real accounts: connect → schedule → publish → metrics appear → comment →
  reply, and a Stripe checkout with a test card.
- Backups: confirm point-in-time recovery is enabled in Supabase.
- Rotate any keys that were ever pasted into chat, email or tickets.

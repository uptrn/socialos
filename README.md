# SocialOS

Multi-brand social media scheduling and publishing (module 1 of the SocialOS platform).
Spec: `socialos_technical_documentation_v2.md`. Design system: `docs/product/design-system.md`.

## Structure

```
packages/core     Platform rules, validation, adapter interface, mock adapter, scheduler logic (no I/O)
apps/web          Next.js 16 app: auth, media library, composer, calendar, queue, publish endpoint
supabase          Database migrations and database tests (PGlite)
```

## What works today

- Sign up / sign in, create an organization with a first brand (timezone per brand)
- Media library: direct browser → storage uploads, image/video metadata captured
- Composer: one post to many accounts; per-platform post type, caption, thread, media and options
  (Instagram, Facebook, Threads, LinkedIn, X, TikTok, YouTube); live validation against platform limits
- Schedule, publish now, save draft, unschedule
- Scheduler: due jobs are claimed atomically, published, retried with backoff, or stopped for a person
  to decide; never auto-retries when a post might already be live
- Calendar (brand timezone) and queue (upcoming / needs attention / published)
- Simulated accounts (development) that exercise the full flow without posting anywhere

- Connect accounts via OAuth for all seven platforms: Facebook Pages + Instagram (Meta login),
  LinkedIn company pages, X, YouTube channels, TikTok and Threads. Tokens are stored encrypted in
  Supabase Vault and refreshed automatically where the platform allows it.
- Real publishing adapters (`packages/core/src/adapters`), built from each platform's current API docs
  and tested against scripted API responses (not yet against the live platforms):

  | Platform | Post types | Notes |
  |---|---|---|
  | Facebook Page | text/link, photo, multi-photo, video, reel, story | first comment |
  | Instagram | image, carousel (≤10), reel, story | first comment, collaborators |
  | LinkedIn | text, 1–20 images, video, PDF document | video uploaded in parts |
  | X | text, up to 4 images, video, threads | 5 MB chunked media upload |
  | YouTube | video, Short | resumable upload spread over several runs |
  | TikTok | video, photo post | photo posts need a verified public `APP_URL` domain (served via `/m/…`) |
  | Threads | text, image, video, carousel (≤20), threads | |

- **Brand Brain** (`/brand`): each brand's description, audience, products, voice, words to use/avoid,
  approved and banned claims, default hashtags, call to action and example posts.
- **AI (Phase 2)** via the Anthropic API (`ANTHROPIC_API_KEY`, default model `claude-opus-5`):
  - *Write with AI* in the composer: a short brief becomes a draft per selected account, written for
    each platform from the Brand Brain, trimmed to each platform's limits, with the AI's assumptions shown.
  - *AI check*: free rule checks (avoided words, banned claims) plus a model review that flags claims the
    Brand Brain doesn't support.
  - Every AI call goes through one gateway (`apps/web/lib/ai/gateway.ts`): monthly budget per organization,
    prompt caching of the Brand Brain, server-side refusal fallback, and a run log with cost (`/usage`).
- **Research agent** (`/research`): searches the web for current news, trends, audience questions and
  competitor moves for a brand (keywords and competitors are set in the Brand Brain), then saves ranked
  post ideas with an angle, suggested platforms, risk level and sources. Only links the searches actually
  returned are kept. "Create post" opens the composer with the idea pre-filled for *Write with AI*.
  Optional weekly automatic runs per brand.
- **Creative studio** (`/creative`): branded graphics from templates — carousels (3–10 slides), quote
  cards, announcements and big-number stats — in square, portrait, story and landscape sizes. Claude
  writes the slide text (or you type it); the app renders JPEGs with the brand's colors, font and logo
  (set under Brand Brain → Visual identity) and saves them to the media library. "Use in a post" opens
  the composer with the images selected. Dev preview of every layout: `/api/dev/creative-sample?layout=cover`.
- **AI images** (Creative → AI images), three tiers behind one image layer (`apps/web/lib/images`); each
  appears only when its key is set:
  - *Free*: FLUX.1 Schnell on Cloudflare Workers AI (Apache 2.0; free daily allocation). Square output,
    center-cropped to the chosen size.
  - *Standard*: Google Gemini image (`gemini-3.1-flash-image`; no free tier).
  - *Premium*: OpenAI GPT Image (model set by `OPENAI_IMAGE_MODEL`).
  The Brand Brain visual style and colors are added to every prompt; images are saved as JPEG at the exact
  post size, marked as AI-generated, logged with cost on `/usage`, and flagged `is_ai_generated` on Instagram.
- **Stock photos** (Creative → Stock photos): free Pexels search and import, with the photographer's
  credit stored on each photo and the required "Photos provided by Pexels" link shown.
- Email alerts (via Resend) when a post fails, needs checking or is paused, and when an account's
  access is expiring or has expired.
- Daily maintenance: refreshes tokens, flags expired accounts, cleans up abandoned connection attempts.
- **SaaS billing** (Stripe): every new organization starts a 14-day free trial (no card). Plans (Starter
  $49, Growth $149, Agency $399; yearly = 2 months free) set brand and account limits, the monthly AI
  budget and which features are available (`packages/core/src/billing/plans.ts`). Settings → Billing shows
  usage, opens Stripe Checkout and the Stripe Customer Portal. A failed payment gets a 7-day grace period;
  after that, or when the trial ends without a plan, the workspace is read-only: drafts still save, but
  scheduling, AI and new accounts are blocked and due posts are paused (not lost). Settings also adds brands.
- **Team** (`/team`): owners and admins invite people by email as Admin, Manager, Reviewer or Viewer.
  The link works for 7 days, only for the invited email address, and is shown to copy when email (Resend)
  isn't set up. Only a hash of the token is stored. Members can have their role changed or be removed,
  and can leave. Only owners manage owners, and an organization always keeps at least one owner. These
  rules are enforced in the database functions. People in several organizations switch between them in
  the sidebar.
- **Analytics** (`/analytics`): each published post's views, reach, likes, comments, shares, saves and
  clicks are collected 1 hour, 1 day, 3 days, 7 days and 30 days after publishing (Instagram stories at
  1, 6 and 20 hours, before their insights expire). The page shows totals with a comparison against the
  previous period, a daily chart, a breakdown by platform and the top posts. "Explain my results" asks AI
  what worked and what to try next, citing the posts it's based on. Metric sources are listed in
  `packages/core/src/analytics/fetchers.ts`. Facebook video views and all of TikTok are unverified.
  **Accounts connected before Analytics existed must be reconnected** to grant the new insights permissions
  (Meta, Threads, TikTok); until then the page shows a note on those posts.
- **Approvals**: turn on "Require approval" per brand in Settings. Managers' Schedule / Publish now then
  become "Submit for approval". The post is locked, including against direct database writes, and
  owners, admins and reviewers are emailed. On `/approvals` they see each platform version with its
  media. Approve schedules the post for the requested time, or now if that has passed. Request changes
  sends it back to draft with a required note, which the author sees in the composer and the calendar.
  Authors can withdraw a waiting post to edit it. Owners and admins schedule directly. Every step is
  kept in `post_reviews` and the audit log.
- **Inbox** (`/inbox`): comments on published posts from Facebook, Instagram, Threads, LinkedIn, YouTube
  and X. They're read every 15 minutes for the first 2 days, hourly for a week, every 6 hours until
  day 30. Each comment shows its thread and the post it's on, and questions are marked. Editors can
  reply publicly from the brand's account, get up to three AI-drafted replies in the brand voice
  ("Suggest reply", never sent automatically; risky comments are flagged for a person), hide comments
  (Facebook, Instagram and Threads) and mark them done. Replies made directly on the platform settle
  the comment automatically. Notes:
  - X reads replies through recent search (last 7 days only; uses paid API credits).
  - LinkedIn needs `r/w_organization_social_feed` added via `LINKEDIN_SCOPES` and doesn't share
    commenter names.
  - TikTok has no comments API for this kind of app.
  - Accounts connected before the Inbox existed must be reconnected for the new permissions.

Platform limits live in `packages/core/src/platforms/specs.ts`. Instagram, LinkedIn and Threads are
verified against their docs (2026-09-26); the rest are marked unverified and the composer says so.
**TikTok** was built without access to developers.tiktok.com (unreachable from the build machine), so
check its adapter against the official docs before enabling it.

Each platform switches on once its app credentials are set (see `apps/web/.env.example`). Until a
platform approves your app for public use, only the app's own admins/testers can connect, and
YouTube (unaudited project) and TikTok (unaudited app) force uploads to private.

## Tracked links and conversions

- When a post publishes, each link in it becomes a short link `{APP_URL}/l/{code}` (or `SHORT_LINK_BASE_URL`).
  The link counts the click, ignoring link-preview bots, then redirects with UTM tags: source = platform,
  medium = social, campaign = post title, content = platform + post id. UTM tags the author already set
  are kept.
- Links aren't changed on Instagram and TikTok (caption links aren't clickable there), when a brand turns
  tracking off, or when the short link would push the post over the platform's length limit.
- Clicks store no IP addresses: only a daily-rotating anonymous visitor hash, country and referring site.
- **Conversions:** the website snippet (Settings → Links and conversions) stores the click id `sos_cid` in
  a first-party cookie and sends `socialos.track('signup' | 'purchase', { value, currency, id })`. For
  reliability, the site's backend can also call `POST /api/conversions` with a server key. Conversions
  must belong to a real click on that brand's links (at most 50 per click, 90 days); an `id` makes
  repeats count once.
- Analytics adds link clicks and conversions per post, a Top links table, and passes them to the AI
  insights.

## Launch readiness

- Public pages: landing page with pricing (`/`), `/legal/privacy`, `/legal/terms` and
  `/legal/data-deletion`. These are templates that describe how SocialOS actually handles data,
  including the YouTube/Google disclosures; set the `LEGAL_*` variables and have them reviewed by a lawyer.
- Settings → **Setup checklist** (owners and admins): what's configured, what's still required, and when
  each scheduled job last ran.
- Settings → **Danger zone**: delete the organization (cancels Stripe, deletes files, data and stored
  tokens) or your own account. Needed for GDPR and Meta's data deletion rules.
- `/api/health` for uptime monitoring, security headers, invitations limited to 30 per hour, and CI
  (`.github/workflows/ci.yml`: tests, typecheck, lint, build).
- Step-by-step production guide: **[docs/deploy.md](docs/deploy.md)**.

## Setup

1. **Supabase project** (free tier is fine): create one at https://supabase.com/dashboard.
2. **Apply the database migrations** (fifteen files), either:
   - SQL editor: run each file in `supabase/migrations/` in filename order, or
   - CLI: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
3. **Environment:** copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the values from
   Project Settings → API Keys / Data API. Generate `CRON_SECRET` with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
4. **Auth:** in Supabase → Authentication → URL Configuration, set Site URL to `http://localhost:3000`
   and add `http://localhost:3000/auth/callback` to Redirect URLs.
5. Install and run:

```bash
npm install
npm run dev -w @socialos/web      # http://localhost:3000
npm run worker -w @socialos/web   # second terminal: publishes due posts every 30 s
```

## Tests

```bash
npm test          # core unit tests + database tests
npm run test:db   # migrations + tenant isolation + scheduler invariants on in-memory Postgres
```

## Connecting real platforms

Register `{APP_URL}/api/oauth/{provider}/callback` as the redirect URL in each developer app, where
`{provider}` is `meta`, `linkedin`, `x`, `youtube`, `tiktok` or `threads`. Then put the credentials in
`apps/web/.env.local` (names in `.env.example`) and use Accounts → Connect.

| Provider | Where | Permissions / products to request |
|---|---|---|
| Meta | developers.facebook.com (Business app, Facebook Login for Business) | pages_show_list, pages_read_engagement, pages_manage_posts, business_management, instagram_basic, instagram_content_publish, read_insights, instagram_manage_insights, pages_read_user_content, pages_manage_engagement, instagram_manage_comments |
| LinkedIn | linkedin.com/developers (linked to your company page) | Community Management API: w_organization_social, r_organization_social, rw_organization_admin |
| X | developer.x.com (OAuth 2.0, Web App, paid API tier for posting) | tweet.read, tweet.write, users.read, media.write, offline.access |
| YouTube | Google Cloud console (YouTube Data API v3, OAuth client "Web application") | youtube.upload, youtube.readonly, youtube.force-ssl; request an audit to publish publicly |
| TikTok | developers.tiktok.com (Login Kit + Content Posting API, Direct Post) | user.info.basic, video.publish, video.list; verify your domain; audit to post publicly |
| Threads | developers.facebook.com (app with the Threads use case) | threads_basic, threads_content_publish, threads_manage_insights, threads_read_replies, threads_manage_replies |

Token lifetimes: Meta Page tokens don't expire; Threads 60 days (auto-refreshed); LinkedIn 60 days
(reconnect unless your app has refresh tokens); X 2 hours, YouTube ~1 hour, TikTok 24 hours (all
auto-refreshed before publishing).

## Billing (Stripe)

1. In Stripe (test mode first), copy the secret key into `STRIPE_SECRET_KEY` in `apps/web/.env.local`.
2. Create the products and prices: `npm run stripe:setup -w @socialos/web`. It creates prices with lookup
   keys `socialos_{starter|growth|agency}_{monthly|yearly}`, and the app finds prices by these keys. To change
   a price, create a new price in Stripe and move the lookup key to it (tick "transfer lookup key").
3. **Webhook:** Developers → Webhooks → add endpoint `{APP_URL}/api/webhooks/stripe` with events
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`. Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`. Locally: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
4. **Customer Portal:** Settings → Billing → Customer portal: allow updating payment methods, cancelling,
   and switching plans between the six SocialOS prices.
5. **Your own team** doesn't pay: in the Supabase SQL editor run
   `update organizations set billing_exempt = true where slug = '<your-org-slug>';` (Internal plan, no limits).

Stripe test cards: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0341` fails on renewal (tests the grace period).

## Production scheduling

After deploying, run `supabase/ops/schedule-publisher.sql` once in the Supabase SQL editor (fill in
your app URL and `CRON_SECRET`). Supabase then calls `POST /api/cron/publish` every minute and
`POST /api/cron/maintenance` daily at 03:00 UTC, `POST /api/cron/inbox` every 5 minutes (comments),
`POST /api/cron/analytics` every 15 minutes (post metrics), and `POST /api/cron/research` hourly (weekly
research for brands that turned it on). If you already ran an earlier version of the script, run just
the blocks you're missing (`socialos-analytics`, `socialos-inbox`).
The endpoint is safe to call concurrently. Vercel Cron works too.

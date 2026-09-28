import 'server-only';
import { aiConfigured } from './ai/gateway';
import { stripeConfigured } from './billing/stripe';
import { CRON_JOBS, type CronJob } from './heartbeat';
import { IMAGE_PROVIDERS } from './images/providers';
import { pexelsConfigured } from './images/pexels';
import { legalConfigured } from './legal';
import { PROVIDERS } from './oauth/providers';
import { createAdminClient } from './supabase/server';

export interface SetupItem {
  label: string;
  ok: boolean;
  /** Needed before launch (otherwise optional). */
  required: boolean;
  hint: string;
}

export interface SetupSection {
  title: string;
  items: SetupItem[];
}

const env = (...names: string[]) => names.every((n) => !!process.env[n]);

/** What's configured, from environment variables and the database. Never returns secret values. */
export async function setupStatus(): Promise<{ sections: SetupSection[]; heartbeats: { job: CronJob; label: string; lastRun: string | null; ok: boolean; late: boolean }[] }> {
  const appUrl = process.env.APP_URL ?? '';
  const sections: SetupSection[] = [
    {
      title: 'Core',
      items: [
        { label: 'App URL', ok: appUrl.startsWith('https://'), required: true, hint: 'APP_URL must be your public https:// address (OAuth callbacks, email links, webhooks).' },
        { label: 'Supabase service key', ok: env('SUPABASE_SECRET_KEY'), required: true, hint: 'SUPABASE_SECRET_KEY for the server.' },
        { label: 'Cron secret', ok: (process.env.CRON_SECRET ?? '').length >= 32, required: true, hint: 'CRON_SECRET, at least 32 random characters.' },
        { label: 'Media link secret', ok: (process.env.MEDIA_PROXY_SECRET ?? '').length >= 32, required: true, hint: 'MEDIA_PROXY_SECRET, at least 32 random characters.' },
        { label: 'Simulated accounts off', ok: process.env.ENABLE_MOCK_ACCOUNTS !== 'true', required: true, hint: 'Leave ENABLE_MOCK_ACCOUNTS unset in production.' },
        { label: 'Email (Resend)', ok: env('RESEND_API_KEY', 'ALERT_EMAIL_FROM'), required: true, hint: 'RESEND_API_KEY and ALERT_EMAIL_FROM on a verified domain: alerts, invitations, approvals.' },
        { label: 'Platform admins', ok: env('PLATFORM_ADMIN_EMAILS'), required: true, hint: 'PLATFORM_ADMIN_EMAILS: comma-separated emails of SocialOS staff who can open /admin (suspend, trials, internal plan).' },
        { label: 'Legal pages', ok: legalConfigured(), required: true, hint: 'LEGAL_COMPANY_NAME, LEGAL_CONTACT_EMAIL, LEGAL_ADDRESS, LEGAL_JURISDICTION. Have the texts reviewed.' },
      ],
    },
    {
      title: 'Billing',
      items: [
        { label: 'Stripe key', ok: stripeConfigured(), required: true, hint: 'STRIPE_SECRET_KEY, then run npm run stripe:setup.' },
        { label: 'Stripe webhook', ok: env('STRIPE_WEBHOOK_SECRET'), required: true, hint: `Webhook to ${appUrl || '{APP_URL}'}/api/webhooks/stripe; secret in STRIPE_WEBHOOK_SECRET.` },
        { label: 'Live mode', ok: (process.env.STRIPE_SECRET_KEY ?? '').startsWith('sk_live'), required: false, hint: 'Switch to live keys when you start charging.' },
      ],
    },
    {
      title: 'AI and images',
      items: [
        { label: 'Claude (writing, checks, research, insights, replies)', ok: aiConfigured(), required: true, hint: 'ANTHROPIC_API_KEY.' },
        { label: 'Free AI images (Cloudflare)', ok: IMAGE_PROVIDERS.free.configured(), required: false, hint: 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.' },
        { label: 'Standard AI images (Gemini)', ok: IMAGE_PROVIDERS.standard.configured(), required: false, hint: 'GEMINI_API_KEY.' },
        { label: 'Premium AI images (OpenAI)', ok: IMAGE_PROVIDERS.premium.configured(), required: false, hint: 'OPENAI_API_KEY.' },
        { label: 'Stock photos (Pexels)', ok: pexelsConfigured(), required: false, hint: 'PEXELS_API_KEY.' },
      ],
    },
    {
      title: 'Social platforms',
      items: Object.values(PROVIDERS).map((p) => ({
        label: p.label,
        ok: p.configured(),
        required: false,
        hint: `Developer app credentials; redirect URL ${appUrl || '{APP_URL}'}/api/oauth/${p.id}/callback. Public use needs the platform's app review.`,
      })),
    },
  ];

  const { data } = await createAdminClient().from('system_heartbeats').select('name, last_run_at, last_ok');
  const byName = new Map((data ?? []).map((h) => [h.name, h]));
  const now = Date.now();
  const heartbeats = (Object.keys(CRON_JOBS) as CronJob[]).map((job) => {
    const h = byName.get(job);
    const lastRun = h?.last_run_at ?? null;
    // Late when it hasn't run for 3 intervals (at least 10 minutes).
    const late = !lastRun || now - new Date(lastRun).getTime() > Math.max(3 * CRON_JOBS[job].everyMin, 10) * 60_000;
    return { job, label: CRON_JOBS[job].label, lastRun, ok: !!h?.last_ok, late };
  });
  return { sections, heartbeats };
}

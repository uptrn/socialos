import 'server-only';
import type { Notifier } from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';

// Operational email alerts via Resend (resend.com/docs/api-reference/emails/send-email).
// Without RESEND_API_KEY, alerts are only logged.

const STATUS_TEXT: Record<string, string> = {
  failed: 'could not be published',
  needs_revision: 'was rejected by the platform and needs changes',
  needs_check: 'may or may not have been published — please check the account',
  missed: 'missed its scheduled time while the system was unavailable',
  paused: 'is paused because the social account needs to be reconnected',
};

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function sendEmail(opts: { to: string[]; subject: string; html: string; idempotencyKey: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!opts.to.length) return;
  if (!apiKey) {
    console.log(`[notify] (email disabled) ${opts.subject} -> ${opts.to.join(', ')}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': opts.idempotencyKey.slice(0, 256) },
    body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM ?? 'SocialOS <alerts@example.com>', to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) console.error(`[notify] email failed (${res.status}): ${await res.text().catch(() => '')}`);
}

export async function alertRecipients(db: SupabaseClient, orgId: string, extraUser?: string | null): Promise<string[]> {
  const { data } = await db.rpc('org_alert_recipients', { p_org: orgId, p_extra_user: extraUser ?? null });
  return ((data ?? []) as { email: string }[]).map((r) => r.email);
}

function layout(title: string, body: string, link: { href: string; label: string }) {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0b1a3e">
    <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
    ${body}
    <p><a href="${link.href}" style="display:inline-block;background:#1453f5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(link.label)}</a></p>
    <p style="color:#5b6788;font-size:12px">You receive this because you are an owner or admin in SocialOS.</p>
  </div>`;
}

/** Emails owners/admins and the post's author when a publish job needs a person to act. */
export class EmailJobNotifier implements Notifier {
  constructor(private readonly db: SupabaseClient) {}

  async jobNeedsAttention(jobId: string, status: string, message: string) {
    try {
      const { data: job } = await this.db
        .from('publish_jobs')
        .select('org_id, platform, posts(title, created_by), social_accounts(display_name)')
        .eq('id', jobId)
        .single();
      if (!job) return;
      const post = job.posts as unknown as { title: string | null; created_by: string | null };
      const account = job.social_accounts as unknown as { display_name: string };
      const to = await alertRecipients(this.db, job.org_id, post.created_by);
      const title = `"${post.title || 'Untitled post'}" on ${account.display_name} ${STATUS_TEXT[status] ?? `is ${status}`}`;
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      await sendEmail({
        to,
        subject: `SocialOS: ${title}`,
        html: layout(title, `<p><strong>Reason:</strong> ${escapeHtml(message)}</p>`, { href: `${appUrl}/queue?tab=attention`, label: 'Open queue' }),
        idempotencyKey: `job:${jobId}:${status}`,
      });
    } catch (e) {
      // Alerts must never break publishing.
      console.error('[notify] job alert failed', e);
    }
  }
}

export async function sendAccountAlert(
  db: SupabaseClient,
  account: { id: string; org_id: string; display_name: string; platform: string },
  kind: 'expiring' | 'expired',
  detail: string,
) {
  const to = await alertRecipients(db, account.org_id);
  const title =
    kind === 'expired'
      ? `${account.display_name} (${account.platform}) is disconnected`
      : `${account.display_name} (${account.platform}) needs reconnecting soon`;
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  await sendEmail({
    to,
    subject: `SocialOS: ${title}`,
    html: layout(title, `<p>${escapeHtml(detail)}</p><p>Scheduled posts to this account will pause until it is reconnected.</p>`, {
      href: `${appUrl}/accounts`,
      label: 'Reconnect account',
    }),
    idempotencyKey: `account:${account.id}:${kind}:${new Date().toISOString().slice(0, 10)}`,
  });
}

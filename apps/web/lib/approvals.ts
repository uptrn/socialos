import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeHtml, sendEmail } from './notify';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

function email(title: string, body: string, link: { href: string; label: string }) {
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0b1a3e">
    <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
    ${body}
    <p><a href="${link.href}" style="display:inline-block;background:#1453f5;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(link.label)}</a></p>
  </div>`;
}

async function members(db: SupabaseClient, orgId: string) {
  const { data } = await db.rpc('org_member_list', { p_org: orgId });
  return (data ?? []) as { user_id: string; email: string; role: string }[];
}

async function postInfo(db: SupabaseClient, postId: string) {
  const { data } = await db.from('posts').select('org_id, title, submitted_by, brands(name), post_variants(caption)').eq('id', postId).single();
  const caption = (data?.post_variants as unknown as { caption: string }[] | undefined)?.[0]?.caption ?? '';
  return {
    orgId: data?.org_id as string,
    submittedBy: data?.submitted_by as string | null,
    brand: (data?.brands as unknown as { name: string } | null)?.name ?? 'your brand',
    label: data?.title || caption.split('\n')[0]?.slice(0, 80) || 'Untitled post',
  };
}

/** Emails owners, admins and reviewers (except the submitter) that a post is waiting. Never throws. */
export async function notifySubmitted(db: SupabaseClient, postId: string) {
  try {
    const post = await postInfo(db, postId);
    const to = (await members(db, post.orgId)).filter((m) => ['owner', 'admin', 'reviewer'].includes(m.role) && m.user_id !== post.submittedBy).map((m) => m.email);
    await sendEmail({
      to,
      subject: `Approval needed: ${post.label}`,
      html: email(`A ${post.brand} post is waiting for approval`, `<p>${escapeHtml(post.label)}</p>`, { href: `${appUrl()}/approvals`, label: 'Review it' }),
      idempotencyKey: `submitted:${postId}:${Date.now()}`,
    });
  } catch (e) {
    console.error('[approvals] submit email failed', (e as Error).message);
  }
}

/** Emails the submitter the decision. Never throws. */
export async function notifyDecision(db: SupabaseClient, postId: string, decision: 'approved' | 'rejected', note: string | null, scheduledFor?: string) {
  try {
    const post = await postInfo(db, postId);
    const author = (await members(db, post.orgId)).find((m) => m.user_id === post.submittedBy);
    if (!author) return;
    const when = scheduledFor ? ` It is scheduled for ${new Date(scheduledFor).toUTCString()}.` : '';
    await sendEmail({
      to: [author.email],
      subject: decision === 'approved' ? `Approved: ${post.label}` : `Changes requested: ${post.label}`,
      html: email(
        decision === 'approved' ? 'Your post was approved' : 'Your post needs changes',
        `<p>${escapeHtml(post.label)}</p>${decision === 'approved' ? `<p>${escapeHtml(when.trim())}</p>` : ''}${note ? `<p><b>Note:</b> ${escapeHtml(note)}</p>` : ''}`,
        decision === 'approved' ? { href: `${appUrl()}/queue`, label: 'Open queue' } : { href: `${appUrl()}/compose?post=${postId}`, label: 'Edit the post' },
      ),
      idempotencyKey: `${decision}:${postId}:${Date.now()}`,
    });
  } catch (e) {
    console.error('[approvals] decision email failed', (e as Error).message);
  }
}

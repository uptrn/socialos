'use server';

import { getSpec, PublishError, replyOutputSchema, replySystemPrompt, replyUserPrompt, type Platform, type PostType, type ReplyOutput } from '@socialos/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { accountCredentials } from '@/lib/accounts';
import { AiError, runAgent } from '@/lib/ai/gateway';
import { BillingError, getAccess, requireFeature } from '@/lib/billing/access';
import { loadBrandProfileRow, toBrandProfile } from '@/lib/brand-profile';
import { inboxConnector } from '@/lib/inbox/sync';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

interface CommentRow {
  id: string;
  org_id: string;
  brand_id: string;
  social_account_id: string;
  job_id: string | null;
  platform: Platform;
  external_id: string;
  parent_external_id: string | null;
  author_name: string;
  text: string;
  from_brand: boolean;
  hidden: boolean;
  permalink: string | null;
  publish_jobs: { external_post_id: string; published_at: string | null; post_variants: { caption: string; post_type: PostType } | null } | null;
}

const SELECT = 'id, org_id, brand_id, social_account_id, job_id, platform, external_id, parent_external_id, author_name, text, from_brand, hidden, permalink, publish_jobs(external_post_id, published_at, post_variants(caption, post_type))';

/** Loads a comment the user may act on (same org, a brand they can see, editor role). */
async function loadComment(commentId: string) {
  const ws = await getWorkspace();
  if (!ws.canEdit) throw new Error('You do not have permission to handle comments.');
  const { data } = await createAdminClient().from('inbox_comments').select(SELECT).eq('id', z.string().uuid().parse(commentId)).eq('org_id', ws.org.id).maybeSingle();
  const comment = data as unknown as CommentRow | null;
  if (!comment || !ws.brands.some((b) => b.id === comment.brand_id)) throw new Error('Comment not found.');
  return { ws, comment };
}

const postRef = (c: CommentRow) => ({
  externalPostId: c.publish_jobs?.external_post_id ?? '',
  postType: c.publish_jobs?.post_variants?.post_type ?? 'text',
  publishedAt: new Date(c.publish_jobs?.published_at ?? Date.now()),
});

export async function replyToComment(commentId: string, text: string): Promise<{ error?: string }> {
  const body = z.string().trim().min(1, 'Write a reply first.').max(2000, 'Keep replies under 2,000 characters.').safeParse(text);
  if (!body.success) return { error: body.error.issues[0]?.message };
  const { ws, comment } = await loadComment(commentId);
  if (!comment.publish_jobs) return { error: 'The original post is no longer available.' };
  if ((await getAccess(ws.org.id)).state === 'locked') return { error: 'Your subscription is not active.' };

  const db = createAdminClient();
  try {
    const { credentials, mock } = await accountCredentials(db, comment.social_account_id);
    const connector = inboxConnector(comment.platform, mock);
    if (!connector) return { error: 'Replies are not available for this platform.' };
    const { externalId } = await connector.reply(credentials, postRef(comment), comment.external_id, body.data);

    const now = new Date().toISOString();
    await db.from('inbox_comments').upsert(
      {
        org_id: comment.org_id,
        brand_id: comment.brand_id,
        social_account_id: comment.social_account_id,
        job_id: comment.job_id,
        platform: comment.platform,
        external_id: externalId,
        parent_external_id: comment.external_id,
        author_name: 'You',
        from_brand: true,
        text: body.data,
        commented_at: now,
        status: 'done',
        replied_by: ws.userId,
      },
      { onConflict: 'social_account_id,external_id', ignoreDuplicates: true },
    );
    await db.from('inbox_comments').update({ status: 'done', handled_by: ws.userId, handled_at: now }).eq('id', comment.id);
    await db.from('audit_logs').insert({
      org_id: comment.org_id, brand_id: comment.brand_id, actor_type: 'user', actor_id: ws.userId,
      action: 'comment.replied', resource_type: 'comment', resource_id: comment.id,
    });
    revalidatePath('/inbox');
    return {};
  } catch (e) {
    if (e instanceof PublishError && e.errorClass === 'ambiguous') {
      return { error: 'We lost the connection while sending. The reply may have been posted: check the post before trying again.' };
    }
    if (e instanceof PublishError && e.errorClass === 'auth_expired') return { error: 'Reconnect this account to reply.' };
    return { error: e instanceof Error ? e.message : 'Could not send the reply.' };
  }
}

export async function setCommentStatus(commentIds: string[], status: 'open' | 'done'): Promise<{ error?: string }> {
  const ws = await getWorkspace();
  if (!ws.canEdit) return { error: 'You do not have permission to handle comments.' };
  const ids = z.array(z.string().uuid()).max(500).parse(commentIds);
  const done = status === 'done';
  const { error } = await createAdminClient()
    .from('inbox_comments')
    .update({ status, handled_by: done ? ws.userId : null, handled_at: done ? new Date().toISOString() : null })
    .in('id', ids)
    .eq('org_id', ws.org.id)
    .in('brand_id', ws.brands.map((b) => b.id));
  revalidatePath('/inbox');
  return error ? { error: error.message } : {};
}

export async function hideComment(commentId: string, hidden: boolean): Promise<{ error?: string }> {
  const { ws, comment } = await loadComment(commentId);
  const db = createAdminClient();
  try {
    const { credentials, mock } = await accountCredentials(db, comment.social_account_id);
    const connector = inboxConnector(comment.platform, mock);
    if (!connector?.canHide || !connector.hide) return { error: 'This platform does not allow hiding comments through its API.' };
    await connector.hide(credentials, comment.external_id, hidden);
    await db.from('inbox_comments').update({ hidden, ...(hidden ? { status: 'done', handled_by: ws.userId, handled_at: new Date().toISOString() } : {}) }).eq('id', comment.id);
    await db.from('audit_logs').insert({
      org_id: comment.org_id, brand_id: comment.brand_id, actor_type: 'user', actor_id: ws.userId,
      action: hidden ? 'comment.hidden' : 'comment.unhidden', resource_type: 'comment', resource_id: comment.id,
    });
    revalidatePath('/inbox');
    return {};
  } catch (e) {
    return { error: e instanceof PublishError && e.errorClass === 'auth_expired' ? 'Reconnect this account first.' : (e as Error).message };
  }
}

export async function suggestReply(commentId: string): Promise<{ error?: string; output?: ReplyOutput }> {
  const { ws, comment } = await loadComment(commentId);
  try {
    await requireFeature(ws.org.id, 'content_ai');
    const db = createAdminClient();
    // The conversation so far: the comment this one answers and earlier replies to the same comment.
    const threadRoot = comment.parent_external_id ?? comment.external_id;
    const { data: thread } = await db
      .from('inbox_comments')
      .select('author_name, text, from_brand, external_id, commented_at')
      .eq('social_account_id', comment.social_account_id)
      .or(`external_id.eq.${JSON.stringify(threadRoot)},parent_external_id.eq.${JSON.stringify(threadRoot)}`)
      .neq('id', comment.id)
      .order('commented_at')
      .limit(12);
    const brand = ws.brands.find((b) => b.id === comment.brand_id)!;
    const profile = toBrandProfile(brand.name, await loadBrandProfileRow(comment.brand_id));
    const output = await runAgent({
      agent: 'reply',
      orgId: ws.org.id,
      brandId: comment.brand_id,
      userId: ws.userId,
      system: replySystemPrompt(profile),
      user: replyUserPrompt({
        platformLabel: getSpec(comment.platform).label,
        postCaption: comment.publish_jobs?.post_variants?.caption ?? '',
        thread: (thread ?? []).map((t) => ({ author: t.author_name, text: t.text, fromBrand: t.from_brand })),
        comment: { author: comment.author_name, text: comment.text },
      }),
      schema: replyOutputSchema,
      effort: 'low',
      logInput: { platform: comment.platform, length: comment.text.length },
    });
    return { output };
  } catch (e) {
    return { error: e instanceof AiError || e instanceof BillingError ? e.message : 'Could not suggest a reply.' };
  }
}

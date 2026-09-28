'use server';

import { PLATFORMS, POST_TYPES, hasBlockingIssues, localToUtc, validateVariant, type ValidationIssue } from '@socialos/core';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { toMediaInfo } from '@/lib/posts';
import { getAccess } from '@/lib/billing/access';
import type { MediaRow } from '@/lib/media';
import { createAdminClient, createUserClient } from '@/lib/supabase/server';
import { needsApproval, requireBrandEditor } from '@/lib/workspace';
import { notifySubmitted } from '@/lib/approvals';
import { storedPostIsValid } from '@/lib/post-checks';

const variantSchema = z.object({
  socialAccountId: z.string().uuid(),
  platform: z.enum(PLATFORMS),
  postType: z.enum(POST_TYPES),
  caption: z.string().max(70000),
  threadParts: z.array(z.string().max(5000)).max(25),
  options: z.record(z.string(), z.unknown()),
  media: z.array(z.object({ mediaId: z.string().uuid(), altText: z.string().max(4000).optional() })).max(35),
});

const payloadSchema = z.object({
  postId: z.string().uuid().optional(),
  brandId: z.string().uuid(),
  title: z.string().max(200),
  variants: z.array(variantSchema).min(1, 'Choose at least one account to post to.'),
  intent: z.enum(['draft', 'schedule', 'now']),
  scheduleLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
});

export type ComposerPayload = z.input<typeof payloadSchema>;

export interface SubmitResult {
  ok: boolean;
  postId?: string;
  error?: string;
  /** Blocking issues keyed by social account id. */
  issues?: Record<string, ValidationIssue[]>;
  scheduledFor?: string;
  shiftedForDst?: boolean;
  /** Sent for approval instead of scheduled. */
  pendingApproval?: boolean;
}

export async function submitPost(input: ComposerPayload): Promise<SubmitResult> {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const data = parsed.data;
  const ws = await requireBrandEditor(data.brandId);

  // Validate against platform rules using media metadata from the database, not the client.
  const mediaIds = [...new Set(data.variants.flatMap((v) => v.media.map((m) => m.mediaId)))];
  const supabase = await createUserClient();
  const { data: mediaRows } = mediaIds.length
    ? await supabase
        .from('media_assets')
        .select('id, kind, mime_type, size_bytes, width, height, duration_sec, page_count, storage_path, original_name')
        .in('id', mediaIds)
        .eq('brand_id', data.brandId)
        .eq('status', 'ready')
    : { data: [] as MediaRow[] };
  const mediaById = new Map(((mediaRows ?? []) as MediaRow[]).map((m) => [m.id, m]));
  if (mediaById.size !== mediaIds.length) return { ok: false, error: 'Some selected media is no longer available.' };

  const issuesByAccount: Record<string, ValidationIssue[]> = {};
  for (const v of data.variants) {
    issuesByAccount[v.socialAccountId] = validateVariant({
      platform: v.platform,
      postType: v.postType,
      caption: v.caption,
      threadParts: v.threadParts,
      media: v.media.map((m) => toMediaInfo(mediaById.get(m.mediaId)!)),
      options: v.options,
    });
  }

  const { data: postId, error } = await supabase.rpc('save_post_draft', {
    p_post: {
      id: data.postId,
      brand_id: data.brandId,
      title: data.title,
      variants: data.variants.map((v) => ({
        social_account_id: v.socialAccountId,
        platform: v.platform,
        post_type: v.postType,
        caption: v.caption,
        thread_parts: v.threadParts.filter((p) => p.trim()),
        options: v.options,
        validation: issuesByAccount[v.socialAccountId],
        media: v.media.map((m) => ({ media_id: m.mediaId, alt_text: m.altText })),
      })),
    },
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calendar');

  if (data.intent === 'draft') return { ok: true, postId };

  // Drafts are always allowed; scheduling needs an active subscription.
  const access = await getAccess(ws.org.id);
  if (access.state === 'locked') return { ok: false, postId, error: `${access.message ?? 'Your subscription is not active.'} Your draft was saved.` };

  const blocking = Object.fromEntries(Object.entries(issuesByAccount).filter(([, list]) => hasBlockingIssues(list)));
  if (Object.keys(blocking).length) {
    return { ok: false, postId, error: 'Fix the highlighted problems before scheduling. Your draft was saved.', issues: blocking };
  }

  let at = new Date();
  let shifted = false;
  if (data.intent === 'schedule') {
    if (!data.scheduleLocal) return { ok: false, postId, error: 'Choose a date and time.' };
    const converted = localToUtc(data.scheduleLocal, ws.brand.timezone);
    at = converted.utc;
    shifted = converted.shifted;
    if (at.getTime() < Date.now() - 60_000) return { ok: false, postId, error: 'That time is in the past.' };
  }

  if (needsApproval(ws, ws.brand)) {
    // "Publish now" asks for it to go out as soon as it's approved.
    return submitForApproval(postId as string, data.intent === 'now' ? null : at, ws.userId, shifted);
  }
  return schedule(postId as string, at, ws.userId, shifted);
}

async function submitForApproval(postId: string, at: Date | null, userId: string, shifted: boolean): Promise<SubmitResult> {
  if (!(await storedPostIsValid(postId))) return { ok: false, postId, error: 'Post failed validation.' };
  const admin = createAdminClient();
  const { error } = await admin.rpc('submit_post_for_approval', { p_post: postId, p_at: at?.toISOString() ?? null, p_actor: userId });
  if (error) return { ok: false, postId, error: error.message };
  await notifySubmitted(admin, postId);
  revalidatePath('/approvals');
  revalidatePath('/calendar');
  return { ok: true, postId, pendingApproval: true, scheduledFor: at?.toISOString(), shiftedForDst: shifted };
}

async function schedule(postId: string, at: Date, userId: string, shifted: boolean): Promise<SubmitResult> {
  const admin = createAdminClient();
  // Re-validate immediately before scheduling.
  if (!(await storedPostIsValid(postId))) return { ok: false, postId, error: 'Post failed validation.' };
  const { error } = await admin.rpc('schedule_post', { p_post: postId, p_at: at.toISOString(), p_actor: userId });
  if (error) return { ok: false, postId, error: error.message };
  revalidatePath('/queue');
  revalidatePath('/calendar');
  return { ok: true, postId, scheduledFor: at.toISOString(), shiftedForDst: shifted };
}

export async function cancelPost(postId: string, brandId: string) {
  const ws = await requireBrandEditor(brandId);
  const admin = createAdminClient();
  const { data: post } = await admin.from('posts').select('id').eq('id', postId).eq('brand_id', brandId).eq('org_id', ws.org.id).single();
  if (!post) throw new Error('Post not found');
  const { error } = await admin.rpc('cancel_post', { p_post: postId, p_actor: ws.userId });
  if (error) throw new Error(error.message);
  revalidatePath('/queue');
  revalidatePath('/calendar');
}

export async function deleteDraft(postId: string, brandId: string) {
  await requireBrandEditor(brandId);
  const supabase = await createUserClient();
  const { error } = await supabase.from('posts').delete().eq('id', postId).eq('brand_id', brandId).eq('status', 'draft');
  if (error) throw new Error(error.message);
  revalidatePath('/calendar');
}

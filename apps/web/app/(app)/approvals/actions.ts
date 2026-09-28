'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { notifyDecision } from '@/lib/approvals';
import { getAccess } from '@/lib/billing/access';
import { storedPostIsValid } from '@/lib/post-checks';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

const noteSchema = z.string().trim().max(2000);

/** The post, if it belongs to the user's current organization. */
async function ownPost(postId: string) {
  const ws = await getWorkspace();
  const { data } = await createAdminClient().from('posts').select('id').eq('id', z.string().uuid().parse(postId)).eq('org_id', ws.org.id).maybeSingle();
  if (!data) throw new Error('Post not found');
  return ws;
}

function refresh() {
  revalidatePath('/approvals');
  revalidatePath('/calendar');
  revalidatePath('/queue');
  revalidatePath('/', 'layout'); // sidebar count
}

// Role checks happen in the database functions as well; these give friendly messages first.

export async function approvePost(postId: string, note: string): Promise<{ error?: string; scheduledFor?: string }> {
  const ws = await ownPost(postId);
  if (!ws.canApprove) return { error: 'Only owners, admins and reviewers can approve posts.' };
  if ((await getAccess(ws.org.id)).state === 'locked') return { error: 'Your subscription is not active, so posts cannot be scheduled.' };
  if (!(await storedPostIsValid(postId))) return { error: 'This post no longer passes the platform checks. Reject it with a note so the author can fix it.' };

  const db = createAdminClient();
  const { data, error } = await db.rpc('approve_post', { p_post: postId, p_actor: ws.userId, p_note: noteSchema.parse(note) || null });
  if (error) return { error: error.message };
  await notifyDecision(db, postId, 'approved', noteSchema.parse(note) || null, data as string);
  refresh();
  return { scheduledFor: data as string };
}

export async function rejectPost(postId: string, note: string): Promise<{ error?: string }> {
  const ws = await ownPost(postId);
  if (!ws.canApprove) return { error: 'Only owners, admins and reviewers can reject posts.' };
  const text = noteSchema.parse(note);
  if (!text) return { error: 'Say what needs to change.' };

  const db = createAdminClient();
  const { error } = await db.rpc('reject_post', { p_post: postId, p_actor: ws.userId, p_note: text });
  if (error) return { error: error.message };
  await notifyDecision(db, postId, 'rejected', text);
  refresh();
  return {};
}

/** Takes a waiting post back to draft and opens it for editing. */
export async function withdrawPost(postId: string) {
  const ws = await ownPost(postId);
  const { error } = await createAdminClient().rpc('withdraw_post', { p_post: postId, p_actor: ws.userId });
  if (error) throw new Error(error.message);
  refresh();
  redirect(`/compose?post=${postId}`);
}

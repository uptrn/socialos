'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getStripe, stripeConfigured } from '@/lib/billing/stripe';
import { createAdminClient, createUserClient } from '@/lib/supabase/server';
import { BRAND_COOKIE, getWorkspace, ORG_COOKIE } from '@/lib/workspace';

/** Deletes every stored file under {orgId}/ in the media bucket. */
async function deleteOrgFiles(db: SupabaseClient, orgId: string) {
  const bucket = db.storage.from('media');
  const { data: folders, error } = await bucket.list(orgId, { limit: 1000 });
  if (error) throw new Error(`Could not list files: ${error.message}`);
  for (const folder of folders ?? []) {
    // Brand folders contain the files; loop until each is empty.
    for (;;) {
      const { data: files, error: listError } = await bucket.list(`${orgId}/${folder.name}`, { limit: 1000 });
      if (listError) throw new Error(`Could not list files: ${listError.message}`);
      if (!files?.length) break;
      const { error: removeError } = await bucket.remove(files.map((f) => `${orgId}/${folder.name}/${f.name}`));
      if (removeError) throw new Error(`Could not delete files: ${removeError.message}`);
      if (files.length < 1000) break;
    }
  }
}

/**
 * Permanently deletes the current organization: cancels its subscription, deletes its files, then all
 * its data (posts, media records, accounts and their stored tokens, metrics, comments, members).
 */
export async function deleteOrganization(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const ws = await getWorkspace();
  if (ws.role !== 'owner') return { error: 'Only owners can delete the organization.' };
  if (String(formData.get('confirm') ?? '').trim() !== ws.org.name) return { error: `Type "${ws.org.name}" exactly to confirm.` };

  const db = createAdminClient();
  const { data: sub } = await db.from('subscriptions').select('stripe_subscription_id, status').eq('org_id', ws.org.id).maybeSingle();
  if (sub?.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(sub.status)) {
    if (!stripeConfigured()) return { error: 'Billing is not reachable, so the subscription cannot be cancelled. Nothing was deleted.' };
    try {
      await getStripe().subscriptions.cancel(sub.stripe_subscription_id);
    } catch (e) {
      return { error: `Could not cancel the subscription (${(e as Error).message}). Nothing was deleted.` };
    }
  }

  try {
    await deleteOrgFiles(db, ws.org.id);
  } catch (e) {
    return { error: `${(e as Error).message}. Your data was not deleted; try again.` };
  }
  const { error } = await db.rpc('delete_organization', { p_org: ws.org.id, p_actor: ws.userId });
  if (error) return { error: error.message };

  const jar = await cookies();
  jar.delete(ORG_COOKIE);
  jar.delete(BRAND_COOKIE);
  redirect('/calendar'); // another organization, or onboarding if none is left
}

/** Deletes the signed-in user's account. Organizations they are the only owner of must be deleted or handed over first. */
export async function deleteMyAccount(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const ws = await getWorkspace();
  if (String(formData.get('confirm') ?? '').trim() !== 'DELETE') return { error: 'Type DELETE to confirm.' };

  const db = createAdminClient();
  const { data: owned } = await db.rpc('sole_owned_orgs', { p_user: ws.userId });
  const names = ((owned ?? []) as { name: string }[]).map((o) => o.name);
  if (names.length) {
    return { error: `You're the only owner of ${names.join(', ')}. Make someone else an owner (Team) or delete the organization first.` };
  }
  const { error } = await db.auth.admin.deleteUser(ws.userId);
  if (error) return { error: error.message };

  await (await createUserClient()).auth.signOut();
  redirect('/login');
}

'use server';

import { PLATFORMS } from '@socialos/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Candidate } from '@/lib/oauth/providers';
import { z } from 'zod';
import { BillingError, requireCapacity } from '@/lib/billing/access';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

async function capacityError(orgId: string, count: number): Promise<string | null> {
  try {
    await requireCapacity(orgId, 'socialAccounts', count);
    return null;
  } catch (e) {
    if (e instanceof BillingError) return e.message;
    throw e;
  }
}

const mockSchema = z.object({
  platform: z.enum(PLATFORMS),
  displayName: z.string().trim().min(1).max(80),
});

/** Development only: adds an account that publishes through the mock adapter. */
export async function addMockAccount(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  if (!serverEnv.mockAccountsEnabled()) return { error: 'Simulated accounts are disabled.' };
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) return { error: 'Only owners and admins can connect accounts.' };

  const parsed = mockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const limit = await capacityError(ws.org.id, 1);
  if (limit) return { error: limit };

  const admin = createAdminClient();
  const { error } = await admin.from('social_accounts').insert({
    org_id: ws.org.id,
    brand_id: ws.brand.id,
    platform: parsed.data.platform,
    external_account_id: `mock-${crypto.randomUUID()}`,
    display_name: parsed.data.displayName,
    scopes: ['mock'],
    connected_by: ws.userId,
  });
  if (error) return { error: error.message };

  await admin.from('audit_logs').insert({
    org_id: ws.org.id, brand_id: ws.brand.id, actor_type: 'user', actor_id: ws.userId,
    action: 'social_account.connected', resource_type: 'social_account', details: { platform: parsed.data.platform, mock: true },
  });
  revalidatePath('/accounts');
  return {};
}

export async function disconnectAccount(accountId: string) {
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) throw new Error('Only owners and admins can disconnect accounts.');
  const admin = createAdminClient();
  const { data: account } = await admin.from('social_accounts').select('id').eq('id', accountId).eq('org_id', ws.org.id).single();
  if (!account) throw new Error('Account not found');

  // Keeps the row (old posts reference it), marks it revoked and deletes the stored token.
  const { error } = await admin.rpc('revoke_social_account', { p_account: accountId, p_actor: ws.userId });
  if (error) throw new Error(error.message.includes('scheduled posts') ? 'This account has scheduled posts. Cancel them before disconnecting.' : error.message);
  revalidatePath('/accounts');
}

const finishSchema = z.object({
  stateId: z.string().uuid(),
  selected: z.array(z.coerce.number().int().nonnegative()).min(1, 'Select at least one account.'),
});

/** Connects the accounts the user picked after signing in to a provider. */
export async function finishConnection(_prev: { error?: string }, formData: FormData): Promise<{ error?: string }> {
  const parsed = finishSchema.safeParse({ stateId: formData.get('stateId'), selected: formData.getAll('selected') });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) return { error: 'Only owners and admins can connect accounts.' };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('oauth_states')
    .select('id, user_id, org_id, brand_id, secret_id, expires_at')
    .eq('id', parsed.data.stateId)
    .single();
  if (!row || row.user_id !== ws.userId || row.org_id !== ws.org.id || !row.secret_id || new Date(row.expires_at) < new Date()) {
    return { error: 'This connection has expired. Please connect again.' };
  }

  const { data: secret } = await admin.rpc('read_secret', { p_id: row.secret_id });
  const candidates = JSON.parse(secret as string) as Candidate[];

  // Reconnecting an account that is already connected doesn't use another slot.
  const picked = parsed.data.selected.map((i) => candidates[i]).filter((c): c is Candidate => !!c);
  const { data: existing } = await admin
    .from('social_accounts')
    .select('platform, external_account_id')
    .eq('org_id', ws.org.id)
    .neq('status', 'revoked')
    .in('external_account_id', picked.map((c) => c.externalId));
  const known = new Set((existing ?? []).map((a) => `${a.platform}:${a.external_account_id}`));
  const added = picked.filter((c) => !known.has(`${c.platform}:${c.externalId}`)).length;
  const limit = added ? await capacityError(ws.org.id, added) : null;
  if (limit) return { error: limit };

  for (const index of parsed.data.selected) {
    const c = candidates[index];
    if (!c) continue;
    const { error } = await admin.rpc('connect_social_account', {
      p_org: row.org_id,
      p_brand: row.brand_id,
      p_platform: c.platform,
      p_external_id: c.externalId,
      p_display_name: c.name,
      p_avatar_url: c.avatarUrl ?? null,
      p_credentials: JSON.stringify(c.credentials),
      p_token_expires_at: c.expiresAt ?? null,
      p_scopes: c.scopes,
      p_actor: ws.userId,
    });
    if (error) return { error: `Could not connect ${c.name}: ${error.message}` };
  }

  // The parked credentials are no longer needed.
  await admin.rpc('delete_secret', { p_id: row.secret_id });
  await admin.from('oauth_states').delete().eq('id', row.id);
  revalidatePath('/accounts');
  redirect('/accounts?connected=1');
}

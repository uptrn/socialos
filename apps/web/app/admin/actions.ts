'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import { createAdminClient } from '@/lib/supabase/server';

const orgId = z.string().uuid();

async function audit(orgIdValue: string, actorId: string, action: string, details: Record<string, unknown> = {}) {
  await createAdminClient().from('audit_logs').insert({
    org_id: orgIdValue,
    actor_type: 'platform_admin',
    actor_id: actorId,
    action,
    resource_type: 'organization',
    resource_id: orgIdValue,
    details,
  });
}

function refresh(id: string) {
  revalidatePath('/admin');
  revalidatePath(`/admin/orgs/${id}`);
}

/** Stops all publishing, AI and scheduling for an organization. Due posts are paused, not lost. */
export async function suspendOrganization(id: string, reason: string): Promise<{ error?: string }> {
  const admin = await requirePlatformAdmin();
  const text = z.string().trim().min(3, 'Give a reason (shown to the customer).').max(500).safeParse(reason);
  if (!text.success) return { error: text.error.issues[0]?.message };
  const { error } = await createAdminClient()
    .from('organizations')
    .update({ suspended_at: new Date().toISOString(), suspended_reason: text.data })
    .eq('id', orgId.parse(id));
  if (error) return { error: error.message };
  await audit(id, admin.id, 'organization.suspended', { reason: text.data });
  refresh(id);
  return {};
}

export async function unsuspendOrganization(id: string): Promise<{ error?: string }> {
  const admin = await requirePlatformAdmin();
  const { error } = await createAdminClient().from('organizations').update({ suspended_at: null, suspended_reason: null }).eq('id', orgId.parse(id));
  if (error) return { error: error.message };
  await audit(id, admin.id, 'organization.unsuspended');
  refresh(id);
  return {};
}

/** Internal / partner organizations: free, with Internal plan limits. */
export async function setBillingExempt(id: string, exempt: boolean): Promise<{ error?: string }> {
  const admin = await requirePlatformAdmin();
  const { error } = await createAdminClient().from('organizations').update({ billing_exempt: exempt === true }).eq('id', orgId.parse(id));
  if (error) return { error: error.message };
  await audit(id, admin.id, exempt ? 'organization.billing_exempt_on' : 'organization.billing_exempt_off');
  refresh(id);
  return {};
}

/** Extends a no-card trial (or restarts an expired one) by some days from now or from its current end. */
export async function extendTrial(id: string, days: number): Promise<{ error?: string }> {
  const admin = await requirePlatformAdmin();
  const n = z.number().int().min(1).max(90).safeParse(days);
  if (!n.success) return { error: 'Choose 1 to 90 days.' };
  const db = createAdminClient();
  const { data: sub } = await db.from('subscriptions').select('status, trial_ends_at, stripe_subscription_id').eq('org_id', orgId.parse(id)).maybeSingle();
  if (sub?.stripe_subscription_id) return { error: 'This organization has a Stripe subscription; change its trial in Stripe instead.' };
  const base = Math.max(Date.now(), sub?.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : 0);
  const ends = new Date(base + n.data * 86_400_000).toISOString();
  const { error } = await db.from('subscriptions').upsert({ org_id: id, plan: 'trial', status: 'trialing', trial_ends_at: ends }, { onConflict: 'org_id' });
  if (error) return { error: error.message };
  await audit(id, admin.id, 'organization.trial_extended', { days: n.data, trial_ends_at: ends });
  refresh(id);
  return {};
}

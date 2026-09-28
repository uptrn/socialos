import 'server-only';
import { canUse, computeAccess, planFor, PLANS, type BillingAccess, type Feature } from '@socialos/core';
import { cache } from 'react';
import { createAdminClient } from '../supabase/server';

export class BillingError extends Error {}

export const FEATURE_LABELS: Record<Feature, string> = {
  publishing: 'Scheduling and publishing',
  content_ai: 'Write with AI',
  qa_ai: 'AI check',
  graphics: 'Branded graphics',
  stock_photos: 'Stock photos',
  ai_images_free: 'Free AI images',
  ai_images_standard: 'Standard AI images',
  ai_images_premium: 'Premium AI images',
  research: 'Research',
  research_weekly: 'Weekly automatic research',
};

/** The organization's plan and billing state (cached per request). */
export const getAccess = cache(async (orgId: string): Promise<BillingAccess> => {
  const db = createAdminClient();
  const [{ data: sub }, { data: org }] = await Promise.all([
    db.from('subscriptions').select('plan, status, trial_ends_at, past_due_since, stripe_subscription_id').eq('org_id', orgId).maybeSingle(),
    db.from('organizations').select('billing_exempt, suspended_at, suspended_reason').eq('id', orgId).single(),
  ]);
  return computeAccess(
    sub
      ? {
          plan: sub.plan,
          status: sub.status,
          trialEndsAt: sub.trial_ends_at ? new Date(sub.trial_ends_at) : null,
          pastDueSince: sub.past_due_since ? new Date(sub.past_due_since) : null,
          stripeSubscriptionId: sub.stripe_subscription_id,
        }
      : null,
    !!org?.billing_exempt,
    new Date(),
    org?.suspended_at ? { reason: org.suspended_reason } : null,
  );
});

/** Throws a friendly BillingError unless the plan includes the feature and the account is usable. */
export async function requireFeature(orgId: string, feature: Feature): Promise<BillingAccess> {
  const access = await getAccess(orgId);
  if (access.state === 'locked') throw new BillingError(access.message ?? 'Your subscription is not active.');
  if (!canUse(access, feature)) {
    const plan = planFor(feature);
    throw new BillingError(`${FEATURE_LABELS[feature]} is available on the ${plan ? PLANS[plan].label : 'higher'} plan. Upgrade in Settings → Billing.`);
  }
  return access;
}

export async function getUsage(orgId: string): Promise<{ brands: number; socialAccounts: number }> {
  const { data } = await createAdminClient().rpc('org_usage_counts', { p_org: orgId });
  const row = (Array.isArray(data) ? data[0] : data) as { brands: number; social_accounts: number } | null;
  return { brands: row?.brands ?? 0, socialAccounts: row?.social_accounts ?? 0 };
}

/** Throws unless adding `count` more brands / social accounts stays within the plan. */
export async function requireCapacity(orgId: string, kind: 'brands' | 'socialAccounts', count = 1) {
  const access = await getAccess(orgId);
  if (access.state === 'locked') throw new BillingError(access.message ?? 'Your subscription is not active.');
  const usage = await getUsage(orgId);
  const limit = access.limits[kind];
  if (usage[kind] + count > limit) {
    const noun = kind === 'brands' ? 'brands' : 'social accounts';
    throw new BillingError(`Your ${access.limits.label} plan includes ${limit} ${noun} (you have ${usage[kind]}). Upgrade in Settings → Billing for more.`);
  }
}

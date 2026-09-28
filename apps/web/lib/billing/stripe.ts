import 'server-only';
import { PLANS, planFromLookupKey, type PaidPlan } from '@socialos/core';
import Stripe from 'stripe';
import { createAdminClient } from '../supabase/server';

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Billing is not set up yet (STRIPE_SECRET_KEY).');
  // API version is pinned by the installed SDK (stripe@22: 2026-08-26.dahlia).
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/** Stripe customer for an organization, created on first use. */
export async function ensureCustomer(orgId: string, orgName: string, email: string | null): Promise<string> {
  const db = createAdminClient();
  const { data: sub } = await db.from('subscriptions').select('stripe_customer_id').eq('org_id', orgId).maybeSingle();
  if (sub?.stripe_customer_id) return sub.stripe_customer_id;

  const customer = await getStripe().customers.create(
    { name: orgName, email: email ?? undefined, metadata: { org_id: orgId } },
    { idempotencyKey: `customer-${orgId}` },
  );
  await db.from('subscriptions').upsert({ org_id: orgId, stripe_customer_id: customer.id }, { onConflict: 'org_id' });
  return customer.id;
}

/**
 * Copies a Stripe subscription onto our subscriptions row. The plan comes from the price's
 * lookup key (socialos_{plan}_{interval}); the period end lives on the subscription item.
 */
export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const db = createAdminClient();
  const item = sub.items.data[0];
  const plan: PaidPlan | null = planFromLookupKey(item?.price.lookup_key);
  let orgId = sub.metadata?.org_id;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  if (!orgId) {
    const { data } = await db.from('subscriptions').select('org_id').eq('stripe_customer_id', customerId).maybeSingle();
    orgId = data?.org_id;
  }
  if (!orgId) throw new Error(`No organization for Stripe customer ${customerId}`);

  const { data: current } = await db.from('subscriptions').select('past_due_since, stripe_subscription_id, status').eq('org_id', orgId).maybeSingle();
  // An org has one live subscription; ignore late events about an older, replaced one.
  if (current?.stripe_subscription_id && current.stripe_subscription_id !== sub.id && sub.status === 'canceled') return;

  await db.from('subscriptions').upsert(
    {
      org_id: orgId,
      plan: plan ?? 'trial',
      status: sub.status,
      trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_end: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end,
      past_due_since: sub.status === 'past_due' ? (current?.past_due_since ?? new Date().toISOString()) : null,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
    },
    { onConflict: 'org_id' },
  );
}

export function planPriceLabel(plan: PaidPlan) {
  return PLANS[plan].monthlyUsd ? `$${PLANS[plan].monthlyUsd}/month` : '';
}

'use server';

import { PAID_PLANS, priceLookupKey } from '@socialos/core';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ensureCustomer, getStripe } from '@/lib/billing/stripe';
import { isSaasMode } from '@/lib/mode';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

async function requireOwner() {
  if (!isSaasMode()) throw new Error('Billing is switched off.');
  const ws = await getWorkspace();
  if (!['owner', 'admin'].includes(ws.role)) throw new Error('Only owners and admins can manage billing.');
  return ws;
}

/** Starts Stripe Checkout for a plan, or opens the portal if the org already has a live subscription. */
export async function startCheckout(formData: FormData) {
  const { plan, interval } = z
    .object({ plan: z.enum(PAID_PLANS), interval: z.enum(['monthly', 'yearly']) })
    .parse({ plan: formData.get('plan'), interval: formData.get('interval') });
  const ws = await requireOwner();
  const stripe = getStripe();

  const { data: sub } = await createAdminClient().from('subscriptions').select('stripe_subscription_id, status, trial_ends_at').eq('org_id', ws.org.id).maybeSingle();
  if (sub?.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(sub.status)) {
    // Plan changes on an existing subscription go through the portal (proration handled by Stripe).
    return openPortal();
  }

  const lookupKey = priceLookupKey(plan, interval);
  const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`Stripe price "${lookupKey}" not found. Run the Stripe setup script (see README).`);

  // Subscribing during the free trial keeps the remaining trial days (Stripe needs the end 48h+ away).
  const trialEnd = sub?.status === 'trialing' && sub.trial_ends_at ? Math.floor(new Date(sub.trial_ends_at).getTime() / 1000) : 0;
  const keepTrial = trialEnd > Date.now() / 1000 + 48 * 3600;

  const customer = await ensureCustomer(ws.org.id, ws.org.name, ws.email);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: ws.org.id,
    line_items: [{ price: price.id, quantity: 1 }],
    subscription_data: { metadata: { org_id: ws.org.id }, ...(keepTrial ? { trial_end: trialEnd } : {}) },
    allow_promotion_codes: true,
    success_url: `${appUrl()}/settings/billing?checkout=success`,
    cancel_url: `${appUrl()}/settings/billing?checkout=cancelled`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout link.');
  redirect(session.url);
}

/** Stripe Customer Portal: change plan, update card, download invoices, cancel. */
export async function openPortal() {
  const ws = await requireOwner();
  const customer = await ensureCustomer(ws.org.id, ws.org.name, ws.email);
  const session = await getStripe().billingPortal.sessions.create({ customer, return_url: `${appUrl()}/settings/billing` });
  redirect(session.url);
}

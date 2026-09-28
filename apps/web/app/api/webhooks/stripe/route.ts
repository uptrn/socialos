import type Stripe from 'stripe';
import { NextResponse, type NextRequest } from 'next/server';
import { getStripe, syncSubscription } from '@/lib/billing/stripe';
import { alertRecipients, sendEmail } from '@/lib/notify';
import { createAdminClient } from '@/lib/supabase/server';

// Stripe webhook. Configure the endpoint in Stripe with these events:
// checkout.session.completed, customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted, invoice.payment_failed
export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return NextResponse.json({ error: 'not configured' }, { status: 400 });

  let event: Stripe.Event;
  try {
    // The signature covers the raw body, so read it as text before parsing.
    event = getStripe().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const db = createAdminClient();
  // Stripe may deliver an event more than once; process each id once.
  const { error: dup } = await db.from('stripe_events').insert({ id: event.id, type: event.type });
  if (dup) return NextResponse.json({ received: true, duplicate: true });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          await syncSubscription(await getStripe().subscriptions.retrieve(id));
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object);
        break;
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        const { data: sub } = await db.from('subscriptions').select('org_id').eq('stripe_customer_id', customerId ?? '').maybeSingle();
        if (sub) {
          const to = await alertRecipients(db, sub.org_id);
          const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
          await sendEmail({
            to,
            subject: 'SocialOS: your payment failed',
            html: `<p>We couldn't take your latest SocialOS payment. Please update your card within 7 days to keep publishing.</p><p><a href="${appUrl}/settings/billing">Update billing</a></p>`,
            idempotencyKey: `invoice-failed:${invoice.id}`,
          });
        }
        break;
      }
    }
  } catch (e) {
    // Let Stripe retry: forget the event so the retry is processed.
    await db.from('stripe_events').delete().eq('id', event.id);
    console.error('[stripe] webhook failed', event.type, e);
    return NextResponse.json({ error: 'processing failed' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

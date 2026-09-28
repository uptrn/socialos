// Creates the SocialOS products and prices in Stripe (safe to run again).
// The app finds prices by lookup key: socialos_{plan}_{monthly|yearly}.
//
//   STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup -w @socialos/web
//
// Uses a test-mode key unless --live is passed.
import Stripe from 'stripe';

// Keep in sync with PLANS in packages/core/src/billing/plans.ts. Yearly = 10 months (2 free).
const PLANS = [
  { id: 'starter', name: 'SocialOS Starter', monthlyUsd: 49 },
  { id: 'growth', name: 'SocialOS Growth', monthlyUsd: 149 },
  { id: 'agency', name: 'SocialOS Agency', monthlyUsd: 399 },
];

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('Set STRIPE_SECRET_KEY first.');
if (key.startsWith('sk_live') && !process.argv.includes('--live')) {
  throw new Error('This is a live key. Run with --live if you really mean to create live prices.');
}
const stripe = new Stripe(key);

for (const plan of PLANS) {
  const existing = await stripe.products.search({ query: `metadata['socialos_plan']:'${plan.id}'` });
  const product =
    existing.data[0] ??
    (await stripe.products.create({ name: plan.name, metadata: { socialos_plan: plan.id } }, { idempotencyKey: `socialos-product-${plan.id}` }));

  for (const interval of ['monthly', 'yearly']) {
    const lookupKey = `socialos_${plan.id}_${interval}`;
    const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
    if (found.data[0]) {
      console.log(`✓ ${lookupKey} exists (${found.data[0].id})`);
      continue;
    }
    const price = await stripe.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: (interval === 'monthly' ? plan.monthlyUsd : plan.monthlyUsd * 10) * 100,
      recurring: { interval: interval === 'monthly' ? 'month' : 'year' },
      lookup_key: lookupKey,
      tax_behavior: 'exclusive',
    });
    console.log(`+ ${lookupKey} created (${price.id})`);
  }
}
console.log('\nDone. Next: configure the Customer Portal and the webhook (see README → Billing).');

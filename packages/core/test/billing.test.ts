import { describe, expect, it } from 'vitest';
import { canUse, computeAccess, planFor, planFromLookupKey, priceLookupKey, type SubscriptionRecord } from '../src';

const NOW = new Date('2026-10-01T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const sub = (over: Partial<SubscriptionRecord>): SubscriptionRecord => ({ plan: 'growth', status: 'active', trialEndsAt: null, pastDueSince: null, stripeSubscriptionId: 'sub_1', ...over });

describe('computeAccess', () => {
  it('runs a no-card trial and locks when it ends', () => {
    const trial = computeAccess(sub({ plan: 'trial', status: 'trialing', trialEndsAt: days(3.5), stripeSubscriptionId: null }), false, NOW);
    expect(trial).toMatchObject({ plan: 'trial', state: 'trialing', trialDaysLeft: 4 });
    expect(computeAccess(sub({ plan: 'trial', status: 'trialing', trialEndsAt: days(-1) }), false, NOW).state).toBe('locked');
  });

  it('gives active paid plans their limits', () => {
    const a = computeAccess(sub({ plan: 'starter' }), false, NOW);
    expect(a).toMatchObject({ plan: 'starter', state: 'active' });
    expect(a.limits.brands).toBe(1);
  });

  it('allows a grace period after a failed payment, then locks', () => {
    expect(computeAccess(sub({ status: 'past_due', pastDueSince: days(-2) }), false, NOW).state).toBe('grace');
    expect(computeAccess(sub({ status: 'past_due', pastDueSince: days(-8) }), false, NOW).state).toBe('locked');
  });

  it('locks canceled or unknown subscriptions and exempts internal orgs', () => {
    expect(computeAccess(sub({ status: 'canceled' }), false, NOW).state).toBe('locked');
    expect(computeAccess(null, false, NOW).state).toBe('locked');
    expect(computeAccess(null, true, NOW)).toMatchObject({ plan: 'internal', state: 'active' });
  });
});

describe('features', () => {
  it('gates features by plan and blocks everything when locked', () => {
    const starter = computeAccess(sub({ plan: 'starter' }), false, NOW);
    expect(canUse(starter, 'content_ai')).toBe(true);
    expect(canUse(starter, 'research')).toBe(false);
    expect(canUse(computeAccess(sub({ status: 'canceled' }), false, NOW), 'publishing')).toBe(false);
    expect(planFor('research')).toBe('growth');
    expect(planFor('ai_images_premium')).toBe('agency');
  });

  it('maps Stripe price lookup keys to plans', () => {
    expect(priceLookupKey('growth', 'yearly')).toBe('socialos_growth_yearly');
    expect(planFromLookupKey('socialos_agency_monthly')).toBe('agency');
    expect(planFromLookupKey('other_price')).toBeNull();
  });
});

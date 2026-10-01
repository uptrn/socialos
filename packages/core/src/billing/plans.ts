// SaaS plans and access rules. Prices are the proposal from the business plan; the real
// amounts live in Stripe (found by lookup key), so changing a price needs no code change.

export const FEATURES = [
  'publishing', // scheduling and publishing
  'content_ai', // Write with AI
  'qa_ai', // AI check
  'graphics', // Creative studio templates
  'stock_photos',
  'ai_images_free',
  'ai_images_standard',
  'ai_images_premium',
  'research', // Research agent (manual runs)
  'research_weekly', // automatic weekly research
] as const;
export type Feature = (typeof FEATURES)[number];

export const PAID_PLANS = ['starter', 'growth', 'agency'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type PlanId = PaidPlan | 'trial' | 'internal' | 'free';

export interface PlanLimits {
  label: string;
  monthlyUsd: number | null; // shown in the app; the charged amount comes from Stripe
  brands: number;
  socialAccounts: number;
  /** Monthly AI spend cap in USD (text, research and images together). */
  aiBudgetUsd: number;
  features: Feature[];
}

const ALL_FEATURES = [...FEATURES];

export const PLANS: Record<PlanId, PlanLimits> = {
  trial: { label: 'Free trial', monthlyUsd: null, brands: 3, socialAccounts: 15, aiBudgetUsd: 10, features: ALL_FEATURES.filter((f) => f !== 'ai_images_premium' && f !== 'research_weekly') },
  starter: {
    label: 'Starter',
    monthlyUsd: 49,
    brands: 1,
    socialAccounts: 5,
    aiBudgetUsd: 10,
    features: ['publishing', 'content_ai', 'qa_ai', 'graphics', 'stock_photos', 'ai_images_free'],
  },
  growth: {
    label: 'Growth',
    monthlyUsd: 149,
    brands: 3,
    socialAccounts: 15,
    aiBudgetUsd: 40,
    features: ALL_FEATURES.filter((f) => f !== 'ai_images_premium'),
  },
  agency: { label: 'Agency', monthlyUsd: 399, brands: 15, socialAccounts: 75, aiBudgetUsd: 150, features: ALL_FEATURES },
  // Our own portfolio and custom (Enterprise) deals: set billing_exempt on the organization.
  internal: { label: 'Internal', monthlyUsd: null, brands: 1000, socialAccounts: 10000, aiBudgetUsd: 1000, features: ALL_FEATURES },
  // Company mode (billing switched off, invite-only): everything included. The AI cap is a safety
  // net for the AI bill and can be changed with AI_MONTHLY_BUDGET_USD.
  free: { label: 'Company', monthlyUsd: null, brands: 100, socialAccounts: 1000, aiBudgetUsd: 200, features: ALL_FEATURES },
};

export const TRIAL_DAYS = 14;
export const PAYMENT_GRACE_DAYS = 7;

export type BillingState = 'trialing' | 'active' | 'grace' | 'locked';

export interface SubscriptionRecord {
  plan: string;
  status: string; // Stripe subscription status, or 'trialing' for our no-card trial
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
  stripeSubscriptionId: string | null;
}

export interface BillingAccess {
  plan: PlanId;
  limits: PlanLimits;
  state: BillingState;
  /** Why the account is limited, for display. */
  message?: string;
  trialDaysLeft?: number;
  /** Suspended by SocialOS staff (abuse, fraud, legal): locked regardless of billing. */
  suspended?: boolean;
}

const DAY = 86_400_000;

/**
 * Access while billing is switched off: everyone on the Free plan (internal organizations keep the
 * Internal plan); only a suspension by SocialOS staff locks a workspace.
 */
export function computeFreeAccess(exempt: boolean, suspension?: { reason: string | null } | null): BillingAccess {
  const plan: PlanId = exempt ? 'internal' : 'free';
  const access: BillingAccess = { plan, limits: PLANS[plan], state: 'active' };
  if (!suspension) return access;
  return { ...access, state: 'locked', suspended: true, message: `This workspace is suspended${suspension.reason ? `: ${suspension.reason}` : ''}. Contact support.` };
}

/** Billing access, overridden by a suspension from SocialOS staff. */
export function computeAccess(sub: SubscriptionRecord | null, exempt: boolean, now: Date, suspension?: { reason: string | null } | null): BillingAccess {
  const access = computeBillingAccess(sub, exempt, now);
  if (!suspension) return access;
  return {
    ...access,
    state: 'locked',
    suspended: true,
    trialDaysLeft: undefined,
    message: `This workspace is suspended${suspension.reason ? `: ${suspension.reason}` : ''}. Contact support.`,
  };
}

/**
 * What an organization may do right now.
 * - trialing: no-card trial (or Stripe trial) still running
 * - active: paid and current
 * - grace: payment failed recently; everything still works for PAYMENT_GRACE_DAYS
 * - locked: trial over without a plan, canceled, or unpaid past the grace period -> read-only
 */
function computeBillingAccess(sub: SubscriptionRecord | null, exempt: boolean, now: Date): BillingAccess {
  if (exempt) return { plan: 'internal', limits: PLANS.internal, state: 'active' };
  const paidPlan = (PAID_PLANS as readonly string[]).includes(sub?.plan ?? '') ? (sub!.plan as PaidPlan) : null;

  if (!sub) {
    return { plan: 'trial', limits: PLANS.trial, state: 'locked', message: 'No subscription found. Choose a plan to continue.' };
  }

  if (sub.status === 'trialing') {
    const endsAt = sub.trialEndsAt;
    if (endsAt && endsAt.getTime() > now.getTime()) {
      const plan: PlanId = paidPlan ?? 'trial';
      return { plan, limits: PLANS[plan], state: 'trialing', trialDaysLeft: Math.ceil((endsAt.getTime() - now.getTime()) / DAY) };
    }
    return { plan: 'trial', limits: PLANS.trial, state: 'locked', message: 'Your free trial has ended. Choose a plan to keep publishing.' };
  }

  if (!paidPlan) return { plan: 'trial', limits: PLANS.trial, state: 'locked', message: 'Choose a plan to continue.' };

  switch (sub.status) {
    case 'active':
      return { plan: paidPlan, limits: PLANS[paidPlan], state: 'active' };
    case 'past_due': {
      const since = sub.pastDueSince ?? now;
      const graceEnds = since.getTime() + PAYMENT_GRACE_DAYS * DAY;
      if (now.getTime() < graceEnds) {
        return { plan: paidPlan, limits: PLANS[paidPlan], state: 'grace', message: `Your last payment failed. Update your card within ${Math.ceil((graceEnds - now.getTime()) / DAY)} day(s) to avoid interruption.` };
      }
      return { plan: paidPlan, limits: PLANS[paidPlan], state: 'locked', message: 'Payment is overdue. Update your card to continue.' };
    }
    default:
      // canceled, unpaid, incomplete, incomplete_expired, paused
      return { plan: paidPlan, limits: PLANS[paidPlan], state: 'locked', message: 'Your subscription is not active. Choose a plan to continue.' };
  }
}

export function canUse(access: BillingAccess, feature: Feature): boolean {
  return access.state !== 'locked' && access.limits.features.includes(feature);
}

/** Cheapest paid plan that includes a feature, for upgrade prompts. */
export function planFor(feature: Feature): PaidPlan | null {
  return PAID_PLANS.find((p) => PLANS[p].features.includes(feature)) ?? null;
}

export const priceLookupKey = (plan: PaidPlan, interval: 'monthly' | 'yearly') => `socialos_${plan}_${interval}`;

export function planFromLookupKey(key: string | null | undefined): PaidPlan | null {
  const match = key?.match(/^socialos_(starter|growth|agency)_(monthly|yearly)$/);
  return (match?.[1] as PaidPlan | undefined) ?? null;
}

import { PAID_PLANS, PLANS, type Feature } from '@socialos/core';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { FEATURE_LABELS, getAccess, getUsage } from '@/lib/billing/access';
import { stripeConfigured } from '@/lib/billing/stripe';
import { createAdminClient, createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { BillingButtons, PlanButton } from './billing-buttons';

export const metadata: Metadata = { title: 'Billing' };

const STATE_LABEL = { trialing: 'Free trial', active: 'Active', grace: 'Payment failed', locked: 'Inactive' } as const;

function Meter({ label, used, limit, money = false }: { label: string; used: number; limit: number; money?: boolean }) {
  const pct = Math.min(100, (used / Math.max(limit, 1)) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular font-semibold">
          {money ? `$${used.toFixed(2)} / $${limit}` : `${used} / ${limit}`}
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={pct >= 90 ? 'h-full bg-danger' : 'bg-brand-gradient h-full'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function BillingPage({ searchParams }: PageProps<'/settings/billing'>) {
  const { checkout } = await searchParams;
  const ws = await getWorkspace();
  const [access, usage] = await Promise.all([getAccess(ws.org.id), getUsage(ws.org.id)]);
  const supabase = await createUserClient();
  const { data: sub } = await supabase.from('subscriptions').select('current_period_end, cancel_at_period_end, stripe_subscription_id').eq('org_id', ws.org.id).maybeSingle();
  const { data: spent } = await createAdminClient().rpc('org_ai_spend_this_month', { p_org: ws.org.id });
  const canManage = ['owner', 'admin'].includes(ws.role);
  const hasStripeSub = !!sub?.stripe_subscription_id;
  const enabled = stripeConfigured();

  return (
    <>
      <PageHeader title="Billing" description={ws.org.name} />
      {checkout === 'success' && <p className="mb-5 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">Thank you! Your subscription is being activated (this can take a few seconds).</p>}
      {access.message && <p className={clsx('mb-5 rounded-lg px-4 py-3 text-sm', access.state === 'locked' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>{access.message}</p>}

      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="space-y-5 p-5">
          <div>
            <p className="text-sm text-muted">Current plan</p>
            <p className="mt-1 text-2xl font-bold">{access.limits.label}</p>
            <p className="mt-1 text-sm">
              <span className={clsx('font-semibold', access.state === 'locked' ? 'text-danger' : access.state === 'grace' ? 'text-warning' : 'text-success')}>{STATE_LABEL[access.state]}</span>
              {access.state === 'trialing' && access.trialDaysLeft !== undefined && <span className="text-muted"> · {access.trialDaysLeft} day(s) left</span>}
              {sub?.current_period_end && access.state === 'active' && (
                <span className="text-muted">
                  {' '}· {sub.cancel_at_period_end ? 'ends' : 'renews'} {new Date(sub.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              )}
            </p>
          </div>
          <Meter label="Brands" used={usage.brands} limit={access.limits.brands} />
          <Meter label="Social accounts" used={usage.socialAccounts} limit={access.limits.socialAccounts} />
          <Meter label="AI this month" used={Number(spent ?? 0)} limit={access.limits.aiBudgetUsd} money />
          {canManage && enabled && hasStripeSub && <BillingButtons />}
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {PAID_PLANS.map((plan) => {
            const p = PLANS[plan];
            const current = access.plan === plan && access.state !== 'locked' && hasStripeSub;
            return (
              <Card key={plan} className={clsx('flex flex-col p-5', current && 'ring-2 ring-brand')}>
                <p className="font-semibold">{p.label}</p>
                <p className="mt-1">
                  <span className="text-3xl font-bold">${p.monthlyUsd}</span>
                  <span className="text-sm text-muted">/month</span>
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                  <li>{p.brands} brand{p.brands > 1 ? 's' : ''}</li>
                  <li>{p.socialAccounts} social accounts</li>
                  <li>${p.aiBudgetUsd} of AI per month</li>
                  {p.features.map((f: Feature) => (
                    <li key={f} className="flex gap-1.5 text-muted">
                      <Check size={14} className="mt-0.5 shrink-0 text-success" />
                      {FEATURE_LABELS[f]}
                    </li>
                  ))}
                </ul>
                <div className="mt-5">
                  {current ? (
                    <p className="text-center text-sm font-semibold text-brand">Your plan</p>
                  ) : canManage && enabled ? (
                    <PlanButton plan={plan} label={hasStripeSub ? 'Switch plan' : `Choose ${p.label}`} />
                  ) : (
                    <p className="text-center text-xs text-muted">{enabled ? 'Ask an owner to change plans' : 'Billing is not set up yet'}</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">Prices exclude tax. Annual billing gets two months free. Need more brands or custom terms? Contact us about Enterprise.</p>
    </>
  );
}

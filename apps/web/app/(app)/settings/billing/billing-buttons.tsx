'use client';

import type { PaidPlan } from '@socialos/core';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui';
import { openPortal, startCheckout } from './actions';

function Submit({ children, variant = 'primary' }: { children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} className="w-full">
      {pending ? 'Opening Stripe…' : children}
    </Button>
  );
}

export function PlanButton({ plan, label }: { plan: PaidPlan; label: string }) {
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  return (
    <form action={startCheckout} className="space-y-2">
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />
      <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs font-semibold">
        {(['monthly', 'yearly'] as const).map((i) => (
          <button key={i} type="button" onClick={() => setInterval(i)} className={`flex-1 rounded-md py-1 ${interval === i ? 'bg-surface shadow-card' : 'text-muted'}`}>
            {i === 'monthly' ? 'Monthly' : 'Yearly (2 months free)'}
          </button>
        ))}
      </div>
      <Submit>{label}</Submit>
    </form>
  );
}

export function BillingButtons() {
  return (
    <form action={openPortal}>
      <Submit variant="secondary">Manage billing (card, invoices, cancel)</Submit>
    </form>
  );
}

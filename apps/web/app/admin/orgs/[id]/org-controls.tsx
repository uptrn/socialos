'use client';

import { useState, useTransition } from 'react';
import { Button, inputClass } from '@/components/ui';
import { extendTrial, setBillingExempt, suspendOrganization, unsuspendOrganization } from '../../actions';

export function OrgControls({ id, suspended, exempt, stripeManaged }: { id: string; suspended: boolean; exempt: boolean; stripeManaged: boolean }) {
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(14);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, message: string) =>
    start(async () => {
      const res = await fn();
      setError(res.error);
      setDone(res.error ? undefined : message);
    });

  return (
    <div className="space-y-5">
      <div>
        <p className="font-medium">{suspended ? 'Suspended' : 'Suspend'}</p>
        <p className="text-sm text-muted">Stops publishing (due posts are paused, not lost), AI features and scheduling within a minute. The reason is shown to the customer.</p>
        {suspended ? (
          <Button type="button" variant="secondary" size="sm" className="mt-2" disabled={pending} onClick={() => run(() => unsuspendOrganization(id), 'Suspension lifted.')}>
            Lift suspension
          </Button>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason, e.g. spam reported by Meta" aria-label="Suspension reason" className={`${inputClass} max-w-md`} />
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={pending || reason.trim().length < 3}
              onClick={() => {
                if (window.confirm('Suspend this organization now?')) run(() => suspendOrganization(id, reason), 'Suspended.');
              }}
            >
              Suspend
            </Button>
          </div>
        )}
      </div>

      <div>
        <p className="font-medium">Internal plan</p>
        <p className="text-sm text-muted">Free, with Internal plan limits. For your own brands or partners.</p>
        <Button type="button" variant="secondary" size="sm" className="mt-2" disabled={pending} onClick={() => run(() => setBillingExempt(id, !exempt), exempt ? 'Back on normal billing.' : 'Now on the Internal plan.')}>
          {exempt ? 'Remove Internal plan' : 'Make Internal (free)'}
        </Button>
      </div>

      {!stripeManaged && (
        <div>
          <p className="font-medium">Trial</p>
          <p className="text-sm text-muted">Extend the free trial, or restart an expired one.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days" className={`${inputClass} w-24`} />
            <span className="text-sm text-muted">days</span>
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => run(() => extendTrial(id, days), `Trial extended by ${days} days.`)}>
              Extend trial
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      {done && <p className="text-sm text-success">{done}</p>}
    </div>
  );
}

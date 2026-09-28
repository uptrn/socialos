'use client';

import { PLATFORMS } from '@socialos/core';
import { useActionState, useState, useTransition } from 'react';
import { PLATFORM_META } from '@/components/platform';
import { Button, Field, inputClass } from '@/components/ui';
import { addMockAccount, disconnectAccount } from './actions';

export function MockAccountForm() {
  const [state, action, pending] = useActionState(addMockAccount, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      <Field label="Platform">
        <select name="platform" className={inputClass}>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_META[p].label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Account name">
        <input name="displayName" required className={inputClass} placeholder="Acme (test)" />
      </Field>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" variant="secondary" disabled={pending} className="w-full">
        {pending ? 'Adding…' : 'Add simulated account'}
      </Button>
    </form>
  );
}

export function DisconnectButton({ accountId }: { accountId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await disconnectAccount(accountId);
            } catch (e) {
              setError((e as Error).message);
            }
          })
        }
      >
        Disconnect
      </Button>
      {error && <p className="max-w-56 text-right text-xs text-danger">{error}</p>}
    </div>
  );
}

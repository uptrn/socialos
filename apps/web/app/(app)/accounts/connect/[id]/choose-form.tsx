'use client';

import type { Platform } from '@socialos/core';
import { useActionState } from 'react';
import { PLATFORM_META, PlatformIcon } from '@/components/platform';
import { Button } from '@/components/ui';
import { finishConnection } from '../../actions';

export function ChooseAccountsForm({
  stateId,
  candidates,
}: {
  stateId: string;
  candidates: { index: number; platform: Platform; name: string; avatarUrl?: string }[];
}) {
  const [state, action, pending] = useActionState(finishConnection, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="stateId" value={stateId} />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {candidates.map((c) => (
          <li key={c.index}>
            <label className="flex cursor-pointer items-center gap-3 px-4 py-3">
              <input type="checkbox" name="selected" value={c.index} defaultChecked className="h-4 w-4 accent-[var(--brand-blue)]" />
              <PlatformIcon platform={c.platform} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="text-xs text-muted">{PLATFORM_META[c.platform].label}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {state.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Connecting…' : 'Connect selected accounts'}
      </Button>
    </form>
  );
}

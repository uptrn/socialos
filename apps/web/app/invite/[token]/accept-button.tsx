'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { acceptInvite } from './actions';

export function AcceptButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInvite.bind(null, token), {});
  return (
    <form action={action} className="space-y-3">
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
      {state.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}

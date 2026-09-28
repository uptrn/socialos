'use client';

import { useActionState, useState } from 'react';
import { Button, Card, Field, inputClass } from '@/components/ui';
import { createWorkspace } from './actions';

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createWorkspace, {});
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

  return (
    <Card className="p-6">
      <h1 className="text-xl font-bold">Set up your workspace</h1>
      <p className="mt-1 text-sm text-muted">You can add more brands and invite your team later. Joining an existing team instead? Open the invitation link from your email.</p>
      <form action={action} className="mt-6 space-y-4">
        <Field label="Company name">
          <input name="orgName" required className={inputClass} placeholder="Upturn Technologies" />
        </Field>
        <Field label="First brand" hint="The product or business you'll post for first.">
          <input name="brandName" required className={inputClass} placeholder="Clear Builders" />
        </Field>
        <Field label="Brand timezone" hint="Posts are scheduled in this timezone.">
          <input name="timezone" required defaultValue={timezone} className={inputClass} />
        </Field>
        {state.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{state.error}</p>}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </Card>
  );
}

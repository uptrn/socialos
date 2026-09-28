'use client';

import { useActionState, useRef, useSyncExternalStore } from 'react';
import { Button, Field, inputClass } from '@/components/ui';
import { addBrand } from './actions';

const noSubscribe = () => () => {};
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function AddBrandForm() {
  const [state, action, pending] = useActionState(addBrand, {});
  // Default to the browser's timezone (only known on the client; UTC during server render).
  const timezone = useSyncExternalStore(noSubscribe, browserTimezone, () => 'UTC');
  const form = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={form}
      action={async (fd) => {
        await action(fd);
        form.current?.reset();
      }}
      className="grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end"
    >
      <Field label="Brand name">
        <input name="name" required className={inputClass} placeholder="New brand" />
      </Field>
      <Field label="Timezone">
        <input key={timezone} name="timezone" required defaultValue={timezone} className={inputClass} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add brand'}
      </Button>
      {state.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger sm:col-span-3">{state.error}</p>}
    </form>
  );
}

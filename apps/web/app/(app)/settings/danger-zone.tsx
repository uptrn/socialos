'use client';

import { useActionState, useState } from 'react';
import { Button, Card, inputClass } from '@/components/ui';
import { deleteMyAccount, deleteOrganization } from './danger-actions';

function Confirmed({
  title,
  body,
  word,
  button,
  action,
}: {
  title: string;
  body: string;
  word: string;
  button: string;
  action: (prev: { error?: string }, formData: FormData) => Promise<{ error?: string }>;
}) {
  const [state, run, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted">{body}</p>
        </div>
        {!open && (
          <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
            {button}
          </Button>
        )}
      </div>
      {open && (
        <form action={run} className="mt-3 space-y-2">
          <label className="block text-sm">
            Type <b>{word}</b> to confirm. This cannot be undone.
            <input name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className={`${inputClass} mt-1`} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" disabled={pending || typed.trim() !== word}>
              {pending ? 'Deleting…' : button}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {state.error && <p className="text-sm text-danger">{state.error}</p>}
        </form>
      )}
    </div>
  );
}

export function DangerZone({ orgName, isOwner }: { orgName: string; isOwner: boolean }) {
  return (
    <Card className="border-danger/40 p-5">
      <h2 className="font-semibold text-danger">Danger zone</h2>
      <div className="mt-1 divide-y divide-border">
        {isOwner && (
          <Confirmed
            title="Delete this organization"
            body="Cancels the subscription and permanently deletes all brands, posts, media, connected accounts (and their stored access), analytics, comments and team access."
            word={orgName}
            button="Delete organization"
            action={deleteOrganization}
          />
        )}
        <Confirmed
          title="Delete my account"
          body="Removes your login and your access to every organization. Content you created stays with the organizations."
          word="DELETE"
          button="Delete my account"
          action={deleteMyAccount}
        />
      </div>
    </Card>
  );
}

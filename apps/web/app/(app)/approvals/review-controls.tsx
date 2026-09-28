'use client';

import { useState, useTransition } from 'react';
import { Button, inputClass } from '@/components/ui';
import { approvePost, rejectPost, withdrawPost } from './actions';

export function ReviewControls({ postId, timezone }: { postId: string; timezone: string }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start] = useTransition();

  if (done) return <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{done}</p>;

  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Note for the author (required to request changes)"
        aria-label="Review note"
        className={inputClass}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await approvePost(postId, note);
              if (res.error) return setError(res.error);
              const when = new Date(res.scheduledFor!).toLocaleString('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
              setDone(`Approved and scheduled for ${when}.`);
            })
          }
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await rejectPost(postId, note);
              if (res.error) return setError(res.error);
              setDone('Sent back to the author with your note.');
            })
          }
        >
          Request changes
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function WithdrawButton({ postId }: { postId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => start(() => withdrawPost(postId))}>
      {pending ? 'Opening…' : 'Withdraw and edit'}
    </Button>
  );
}

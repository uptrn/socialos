'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { cancelPost } from '../compose/actions';
import { retryJob } from './actions';

function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  return { pending, error, run };
}

export function CancelPostButton({ postId, brandId }: { postId: string; brandId: string }) {
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <div className="mt-1 flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex gap-1">
          <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => cancelPost(postId, brandId))}>
            Unschedule
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          Unschedule
        </Button>
      )}
      {error && <p className="max-w-xs text-xs text-danger">{error}</p>}
    </div>
  );
}

export function RetryJobButton({ jobId, brandId, needsCheck }: { jobId: string; brandId: string; needsCheck: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useAction();

  if (needsCheck && confirming) {
    return (
      <div className="w-full rounded-lg bg-warning/10 p-3 text-xs">
        <p className="font-semibold text-warning">This post may already be live.</p>
        <p className="mt-1 text-muted">Check the account on the platform first. Retrying when it already posted will create a duplicate.</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => retryJob(jobId, brandId))}>
            It&apos;s not live — retry
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
        {error && <p className="mt-1 text-danger">{error}</p>}
      </div>
    );
  }
  return (
    <>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => (needsCheck ? setConfirming(true) : run(() => retryJob(jobId, brandId)))}>
        Retry
      </Button>
      {error && <p className="w-full pl-9 text-xs text-danger">{error}</p>}
    </>
  );
}

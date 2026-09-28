'use client';

import { Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { createPostFromIdea, runResearchNow, setResearchStatus } from './actions';

export function RunResearchButton({ brandId }: { brandId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const res = await runResearchNow(brandId);
            setMessage(res.ok ? { ok: true, text: `Found ${res.count} new idea${res.count === 1 ? '' : 's'}.` } : { ok: false, text: res.error ?? 'Research failed.' });
          })
        }
      >
        <Sparkles size={16} /> {pending ? 'Researching… (1–3 min)' : 'Run research'}
      </Button>
      {message && <p className={`text-xs ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</p>}
    </div>
  );
}

export function ItemActions({ itemId, brandId, status }: { itemId: string; brandId: string; status: string }) {
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

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      {/* The action redirects to the composer; Next.js handles the navigation. */}
      <Button size="sm" disabled={pending} onClick={() => start(() => createPostFromIdea(itemId, brandId))}>
        Create post
      </Button>
      {status !== 'saved' && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setResearchStatus(itemId, brandId, 'saved'))}>
          Save
        </Button>
      )}
      {status !== 'dismissed' && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setResearchStatus(itemId, brandId, 'dismissed'))}>
          Dismiss
        </Button>
      )}
      {status === 'dismissed' && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setResearchStatus(itemId, brandId, 'new'))}>
          Restore
        </Button>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

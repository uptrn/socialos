'use client';

import { Check, Copy } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { createServerKey, setLinkTracking } from './actions';

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 pr-12 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        aria-label="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
        }}
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted hover:bg-surface hover:text-text"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export function TrackingToggle({ brandId, initial }: { brandId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            const res = await setLinkTracking(brandId, next);
            if (res.error) {
              setOn(!next);
              setError(res.error);
            }
          });
        }}
        className="h-4 w-4 accent-[var(--brand-blue)]"
      />
      Track links in this brand&apos;s posts
      {error && <span className="text-danger">{error}</span>}
    </label>
  );
}

export function ServerKey({ brandId, hasKey }: { brandId: string; hasKey: boolean }) {
  const [key, setKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {key ? (
        <>
          <p className="text-sm text-warning">Copy this key now. It won&apos;t be shown again.</p>
          <CodeBlock code={key} />
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (hasKey && !window.confirm('Create a new key? The current key stops working immediately.')) return;
              start(async () => {
                const res = await createServerKey(brandId);
                setError(res.error);
                setKey(res.key);
              });
            }}
          >
            {hasKey ? 'Replace server key' : 'Create server key'}
          </Button>
          <span className="text-xs text-muted">{hasKey ? 'A key exists (only its fingerprint is stored).' : 'No key yet.'}</span>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

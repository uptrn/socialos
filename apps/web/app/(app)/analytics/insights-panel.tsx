'use client';

import { Sparkles } from 'lucide-react';
import { useState, useTransition } from 'react';
import { PlatformIcon } from '@/components/platform';
import { Button } from '@/components/ui';
import { explainResults, type InsightsResult } from './actions';

const CONFIDENCE = { high: 'Strong pattern', medium: 'Likely', low: 'Early signal' } as const;

export function InsightsPanel({ brandId, range, canRun }: { brandId: string; range: string; canRun: boolean }) {
  const [result, setResult] = useState<InsightsResult | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">What&apos;s working</h2>
          <p className="text-sm text-muted">AI reads this period&apos;s numbers and suggests what to post next.</p>
        </div>
        {canRun && (
          <Button type="button" variant="secondary" disabled={pending} onClick={() => start(async () => setResult(await explainResults({ brandId, range })))}>
            <Sparkles size={16} />
            {pending ? 'Analyzing…' : result?.ok ? 'Analyze again' : 'Explain my results'}
          </Button>
        )}
      </div>

      {result?.error && <p className="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">{result.error}</p>}

      {result?.output && (
        <div className="mt-4 space-y-4 text-sm">
          <p>{result.output.summary}</p>
          <ul className="space-y-3">
            {result.output.insights.map((i, idx) => (
              <li key={idx} className="rounded-lg border border-border p-3">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{i.title}</span>
                  <span className="text-xs text-muted">{CONFIDENCE[i.confidence]}</span>
                </p>
                <p className="mt-1 text-muted">{i.detail}</p>
                {i.evidence.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {i.evidence.map((n) => {
                      const post = result.posts?.[n - 1];
                      if (!post) return null;
                      const chip = (
                        <>
                          <PlatformIcon platform={post.platform} size={16} />
                          <span className="max-w-48 truncate">{post.caption || '(no caption)'}</span>
                        </>
                      );
                      return post.url ? (
                        <a key={n} href={post.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs hover:underline">
                          {chip}
                        </a>
                      ) : (
                        <span key={n} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs">
                          {chip}
                        </span>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {result.output.nextSteps.length > 0 && (
            <div>
              <p className="font-semibold">Try next</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                {result.output.nextSteps.map((s, idx) => (
                  <li key={idx}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

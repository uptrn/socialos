'use client';

import { CONTENT_GOALS, type ContentGoal, type Platform, type PostType, type QaFinding } from '@socialos/core';
import clsx from 'clsx';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, Card, Field, inputClass } from '@/components/ui';
import { generateDrafts, reviewDraft, type GenerateResult } from './ai-actions';

const GOAL_LABELS: Record<ContentGoal, string> = {
  awareness: 'Awareness',
  engagement: 'Engagement',
  traffic: 'Website visits',
  signups: 'Sign-ups / trials',
  announcement: 'Announcement',
};

export type Drafts = NonNullable<GenerateResult['drafts']>;

/** "Write with AI" panel: brief in, per-account drafts out. */
export function AiAssist({
  brandId,
  targets,
  onDrafts,
  initialBrief,
}: {
  brandId: string;
  targets: { key: string; platform: Platform; postType: PostType }[];
  onDrafts: (drafts: Drafts) => void;
  initialBrief?: string;
}) {
  const [open, setOpen] = useState(!!initialBrief);
  const [brief, setBrief] = useState(initialBrief ?? '');
  const [goal, setGoal] = useState<ContentGoal>('engagement');
  const [link, setLink] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="w-full justify-start border-violet/40 text-violet">
        <Sparkles size={16} /> Write with AI
      </Button>
    );
  }

  return (
    <Card className="space-y-4 border-violet/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-violet">
          <Sparkles size={16} /> Write with AI
        </h2>
        <button type="button" className="text-xs text-muted hover:text-text" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <Field label="What's the post about?">
        <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} className={inputClass} placeholder="We just launched job costing reports: see profit per job in one click." />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Goal">
          <select value={goal} onChange={(e) => setGoal(e.target.value as ContentGoal)} className={inputClass}>
            {CONTENT_GOALS.map((g) => (
              <option key={g} value={g}>
                {GOAL_LABELS[g]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Link (optional)">
          <input type="url" value={link} onChange={(e) => setLink(e.target.value)} className={inputClass} placeholder="https://" />
        </Field>
      </div>
      <Button
        type="button"
        disabled={pending || targets.length === 0}
        onClick={() =>
          start(async () => {
            const res = await generateDrafts({ brandId, brief, goal, link, targets });
            setResult(res);
            if (res.ok && res.drafts) onDrafts(res.drafts);
          })
        }
      >
        {pending ? 'Writing…' : targets.length ? `Draft for ${targets.length} account${targets.length > 1 ? 's' : ''}` : 'Choose accounts first'}
      </Button>

      {result?.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{result.error}</p>}
      {result?.ok && (
        <div className="space-y-2 text-xs">
          <p className="text-success">Drafts added to each platform tab. Review them before scheduling.</p>
          {!!result.brandGaps?.length && (
            <p className="text-warning">
              Your <Link href="/brand" className="underline">Brand Brain</Link> is missing: {result.brandGaps.join(', ')}. Drafts will be more generic.
            </p>
          )}
          {!!result.assumptions?.length && (
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="font-semibold">The AI assumed:</p>
              <ul className="mt-1 list-disc pl-4 text-muted">
                {result.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** "AI check" for one account's text: brand-rule checks plus a model review. */
export function AiCheck({ brandId, platform, text }: { brandId: string; platform: Platform; text: string }) {
  const [findings, setFindings] = useState<QaFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkedText, setCheckedText] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stale = checkedText !== null && checkedText !== text;

  return (
    <div className="ml-7 mt-2">
      <button
        type="button"
        disabled={pending || !text.trim()}
        className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline disabled:opacity-50"
        onClick={() =>
          start(async () => {
            const res = await reviewDraft({ brandId, platform, text });
            setFindings(res.findings ?? []);
            setError(res.error ?? null);
            setCheckedText(text);
          })
        }
      >
        <Sparkles size={12} /> {pending ? 'Checking…' : findings ? 'Check again' : 'AI check'}
      </button>
      {error && <p className="mt-1 text-xs text-warning">{error}</p>}
      {findings && !stale && findings.length === 0 && !error && <p className="mt-1 text-xs text-success">No problems found.</p>}
      {findings && stale && <p className="mt-1 text-xs text-muted">Text changed since the last check.</p>}
      {findings && !stale && findings.length > 0 && (
        <ul className="mt-1 space-y-1.5">
          {findings.map((f, i) => (
            <li key={i} className={clsx('rounded-md p-2 text-xs', f.severity === 'error' ? 'bg-danger/10' : 'bg-warning/10')}>
              <span className={clsx('font-semibold', f.severity === 'error' ? 'text-danger' : 'text-warning')}>“{f.quote}”</span> — {f.problem}
              {f.suggestion && <span className="block text-muted">Try: {f.suggestion}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

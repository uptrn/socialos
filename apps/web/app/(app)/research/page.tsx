import type { Platform } from '@socialos/core';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PlatformIcon } from '@/components/platform';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { aiConfigured } from '@/lib/ai/gateway';
import { loadBrandProfileRow } from '@/lib/brand-profile';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { ItemActions, RunResearchButton } from './research-controls';

export const metadata: Metadata = { title: 'Research' };
// A research run (several web searches + analysis) can take a couple of minutes.
export const maxDuration = 300;

const TABS = { new: 'New', saved: 'Saved', used: 'Used', dismissed: 'Dismissed' } as const;
type Tab = keyof typeof TABS;

const KIND_LABEL: Record<string, string> = { trend: 'Trend', news: 'News', competitor: 'Competitor', question: 'Audience question', evergreen: 'Evergreen' };

interface Item {
  id: string;
  topic: string;
  summary: string;
  why_relevant: string;
  angle: string;
  platforms: string[];
  format: string;
  priority: number;
  risk: 'low' | 'medium' | 'high';
  kind: string;
  sources: { title: string; url: string; published?: string }[];
  created_at: string;
}

export default async function ResearchPage({ searchParams }: PageProps<'/research'>) {
  const { tab: tabParam } = await searchParams;
  const tab: Tab = typeof tabParam === 'string' && tabParam in TABS ? (tabParam as Tab) : 'new';
  const ws = await getWorkspace();
  const supabase = await createUserClient();
  const [{ data }, profile] = await Promise.all([
    supabase
      .from('research_items')
      .select('id, topic, summary, why_relevant, angle, platforms, format, priority, risk, kind, sources, created_at')
      .eq('brand_id', ws.brand.id)
      .eq('status', tab)
      .order('created_at', { ascending: false })
      .order('priority', { ascending: false })
      .limit(100),
    loadBrandProfileRow(ws.brand.id),
  ]);
  const items = (data ?? []) as Item[];
  const enabled = aiConfigured();
  const setup = profile.research_keywords.length === 0 && profile.competitors.length === 0;

  return (
    <>
      <PageHeader
        title="Research"
        description={`Current topics and news worth posting about for ${ws.brand.name}, with sources.`}
        actions={ws.canEdit && enabled && <RunResearchButton brandId={ws.brand.id} />}
      />

      {!enabled && <Card className="mb-5 p-4 text-sm text-muted">Research needs AI to be set up (ANTHROPIC_API_KEY).</Card>}
      {enabled && setup && (
        <Card className="mb-5 border-warning/40 bg-warning/5 p-4 text-sm">
          Add research keywords and competitors in the <Link href="/brand" className="font-semibold text-brand underline">Brand Brain</Link> for more focused results.
        </Card>
      )}

      <div className="mb-5 flex gap-1 border-b border-border">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <Link key={key} href={`/research?tab=${key}`} className={clsx('-mb-px border-b-2 px-3 py-2.5 text-sm font-medium', tab === key ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text')}>
            {TABS[key]}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState title={tab === 'new' ? 'No new ideas' : `Nothing ${TABS[tab].toLowerCase()}`} body={tab === 'new' ? 'Run research to find current topics for this brand.' : 'Ideas you act on appear here.'} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => (
            <Card key={item.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className={clsx('tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', item.priority >= 8 ? 'bg-brand-gradient text-white' : 'bg-surface-2 text-text')} title="Priority">
                  {item.priority}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">{KIND_LABEL[item.kind] ?? item.kind}</span>
                    {item.risk !== 'low' && (
                      <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', item.risk === 'high' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning')}>{item.risk} risk</span>
                    )}
                  </div>
                  <h2 className="mt-1.5 font-semibold">{item.topic}</h2>
                </div>
              </div>
              <p className="mt-3 text-sm">{item.summary}</p>
              <p className="mt-2 text-sm text-muted"><span className="font-medium text-text">Why it matters: </span>{item.why_relevant}</p>
              <div className="mt-3 rounded-lg bg-violet/5 p-3 text-sm">
                <span className="font-semibold text-violet">Post idea: </span>
                {item.angle}
                {item.format && <span className="text-muted"> · {item.format}</span>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                {item.platforms.map((p) => (
                  <PlatformIcon key={p} platform={p as Platform} size={20} />
                ))}
              </div>
              <ul className="mt-3 space-y-1 text-xs">
                {item.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                      <ExternalLink size={11} />
                      <span className="line-clamp-1">{s.title}</span>
                    </a>
                    {s.published && <span className="text-muted"> · {s.published}</span>}
                  </li>
                ))}
              </ul>
              {ws.canEdit && <ItemActions itemId={item.id} brandId={ws.brand.id} status={tab} />}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

import { looksLikeQuestion, type Platform } from '@socialos/core';
import clsx from 'clsx';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PLATFORM_META } from '@/components/platform';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { inboxConnector } from '@/lib/inbox/sync';
import { inboxSince } from '@/lib/inbox/window';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { InboxList, type InboxItem } from './inbox-list';

export const metadata: Metadata = { title: 'Inbox' };

const FILTERS = { open: 'To do', done: 'Done', all: 'All' } as const;
type Filter = keyof typeof FILTERS;

interface Row {
  id: string;
  social_account_id: string;
  platform: Platform;
  external_id: string;
  parent_external_id: string | null;
  author_name: string;
  from_brand: boolean;
  text: string;
  commented_at: string;
  permalink: string | null;
  hidden: boolean;
  status: 'open' | 'done';
  social_accounts: { display_name: string } | null;
  publish_jobs: { published_url: string | null; post_variants: { caption: string } | null } | null;
}

export default async function InboxPage({ searchParams }: PageProps<'/inbox'>) {
  const { status: statusParam, platform: platformParam } = await searchParams;
  const filter: Filter = typeof statusParam === 'string' && statusParam in FILTERS ? (statusParam as Filter) : 'open';
  const platform = typeof platformParam === 'string' && platformParam in PLATFORM_META ? (platformParam as Platform) : null;
  const ws = await getWorkspace();
  const supabase = await createUserClient();

  // Everything recent for this brand, so threads (parents and replies) can be shown together.
  const since = inboxSince();
  let query = supabase
    .from('inbox_comments')
    .select('id, social_account_id, platform, external_id, parent_external_id, author_name, from_brand, text, commented_at, permalink, hidden, status, social_accounts(display_name), publish_jobs(published_url, post_variants(caption))')
    .eq('brand_id', ws.brand.id)
    .gte('commented_at', since)
    .order('commented_at', { ascending: false })
    .limit(1000);
  if (platform) query = query.eq('platform', platform);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const key = (accountId: string, externalId: string) => `${accountId}|${externalId}`;
  const byExternal = new Map(rows.map((r) => [key(r.social_account_id, r.external_id), r]));
  const childrenOf = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.parent_external_id) continue;
    const k = key(r.social_account_id, r.parent_external_id);
    childrenOf.set(k, [...(childrenOf.get(k) ?? []), r]);
  }

  const counts = { open: 0, done: 0, all: 0 };
  for (const r of rows) {
    if (r.from_brand) continue;
    counts.all += 1;
    counts[r.status] += 1;
  }

  const items: InboxItem[] = rows
    .filter((r) => !r.from_brand && (filter === 'all' || r.status === filter))
    .map((r) => {
      const parent = r.parent_external_id ? byExternal.get(key(r.social_account_id, r.parent_external_id)) : undefined;
      const replies = (childrenOf.get(key(r.social_account_id, r.external_id)) ?? []).sort((a, b) => a.commented_at.localeCompare(b.commented_at));
      return {
        id: r.id,
        platform: r.platform,
        accountName: r.social_accounts?.display_name ?? '',
        authorName: r.author_name,
        text: r.text,
        at: r.commented_at,
        permalink: [r.permalink, r.publish_jobs?.published_url].find((u) => u?.startsWith('https://')) ?? null,
        hidden: r.hidden,
        status: r.status,
        question: looksLikeQuestion(r.text),
        canHide: !!inboxConnector(r.platform, false)?.canHide,
        post: r.publish_jobs?.post_variants?.caption.split('\n')[0]?.slice(0, 120) ?? '',
        inReplyTo: parent ? { author: parent.from_brand ? 'You' : parent.author_name, text: parent.text.slice(0, 200) } : null,
        replies: replies.map((c) => ({ id: c.id, author: c.from_brand ? 'You' : c.author_name, fromBrand: c.from_brand, text: c.text, at: c.commented_at })),
      };
    });

  const { data: notes } = await supabase.from('inbox_sync').select('note, publish_jobs!inner(brand_id, platform)').eq('publish_jobs.brand_id', ws.brand.id).not('note', 'is', null).limit(5);

  const href = (params: { status?: Filter; platform?: Platform | null }) => {
    const sp = new URLSearchParams();
    const s = params.status ?? filter;
    const p = params.platform === undefined ? platform : params.platform;
    if (s !== 'open') sp.set('status', s);
    if (p) sp.set('platform', p);
    const qs = sp.toString();
    return `/inbox${qs ? `?${qs}` : ''}`;
  };
  const platformsPresent = [...new Set(rows.map((r) => r.platform))];

  return (
    <>
      <PageHeader title="Inbox" description={`${ws.brand.name} · comments on your posts from the last 60 days`} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-surface-2 p-0.5 text-sm font-semibold">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <Link key={f} href={href({ status: f })} className={clsx('rounded-md px-3 py-1.5', f === filter ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text')}>
              {FILTERS[f]} <span className="tabular text-xs text-muted">{counts[f]}</span>
            </Link>
          ))}
        </div>
        {platformsPresent.length > 1 && (
          <div className="flex flex-wrap gap-1 text-xs font-semibold">
            <Link href={href({ platform: null })} className={clsx('rounded-full px-3 py-1', !platform ? 'bg-brand/10 text-brand' : 'text-muted hover:text-text')}>
              All platforms
            </Link>
            {platformsPresent.map((p) => (
              <Link key={p} href={href({ platform: p })} className={clsx('rounded-full px-3 py-1', platform === p ? 'bg-brand/10 text-brand' : 'text-muted hover:text-text')}>
                {PLATFORM_META[p].label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {(notes ?? []).length > 0 && (
        <Card className="mb-4 p-4 text-sm">
          <p className="font-semibold">Some comments couldn&apos;t be read</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {[...new Set((notes ?? []).map((n) => n.note))].map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={filter === 'open' ? 'All caught up' : 'No comments here'}
          body="New comments on your published posts appear here within a few minutes. TikTok comments aren't available through TikTok's API."
        />
      ) : (
        <InboxList items={items} canEdit={ws.canEdit} />
      )}
    </>
  );
}

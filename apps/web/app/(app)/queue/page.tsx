import type { Platform } from '@socialos/core';
import { utcToLocal } from '@socialos/core';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PlatformIcon } from '@/components/platform';
import { buttonClass, Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';
import { CancelPostButton, RetryJobButton } from './queue-actions';

export const metadata: Metadata = { title: 'Queue' };

const TABS = {
  upcoming: { label: 'Upcoming', statuses: ['scheduled', 'publishing'] },
  attention: { label: 'Needs attention', statuses: [] },
  published: { label: 'Published', statuses: ['published', 'partially_published'] },
} as const;
type TabKey = keyof typeof TABS;

const ATTENTION_JOB_STATUSES = ['failed', 'needs_revision', 'needs_check', 'missed', 'paused'];

interface QueuePost {
  id: string;
  title: string | null;
  status: string;
  scheduled_at: string | null;
  publish_jobs: {
    id: string;
    platform: Platform;
    status: string;
    published_url: string | null;
    last_error_message: string | null;
    next_attempt_at: string | null;
    social_accounts: { display_name: string } | null;
  }[];
  post_variants: { caption: string }[];
}

function formatLocal(iso: string, tz: string) {
  const local = utcToLocal(new Date(iso), tz);
  const date = new Date(`${local}:00Z`);
  return date.toLocaleString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default async function QueuePage({ searchParams }: PageProps<'/queue'>) {
  const { tab: tabParam } = await searchParams;
  const tab: TabKey = typeof tabParam === 'string' && tabParam in TABS ? (tabParam as TabKey) : 'upcoming';
  const ws = await getWorkspace();
  const supabase = await createUserClient();

  let query = supabase
    .from('posts')
    .select('id, title, status, scheduled_at, publish_jobs(id, platform, status, published_url, last_error_message, next_attempt_at, social_accounts(display_name)), post_variants(caption)')
    .eq('brand_id', ws.brand.id)
    .limit(100);

  if (tab === 'attention') {
    // A post needs attention if any of its jobs does, whatever the post's overall status.
    const { data: jobs } = await supabase
      .from('publish_jobs')
      .select('post_id')
      .eq('brand_id', ws.brand.id)
      .in('status', ATTENTION_JOB_STATUSES)
      .limit(500);
    query = query.in('id', [...new Set((jobs ?? []).map((j) => j.post_id))]);
  } else {
    query = query.in('status', [...TABS[tab].statuses]);
  }
  query = tab === 'published' ? query.order('scheduled_at', { ascending: false }) : query.order('scheduled_at', { ascending: true });
  const { data } = await query;
  const posts = ((data ?? []) as unknown as QueuePost[]).map((p) => ({
    ...p,
    publish_jobs: p.publish_jobs.filter((j) => j.status !== 'cancelled'),
  }));

  return (
    <>
      <PageHeader
        title="Queue"
        description={`Times shown in ${ws.brand.timezone}.`}
        actions={ws.canEdit && <Link href="/compose" className={buttonClass()}>New post</Link>}
      />

      <div className="mb-5 flex gap-1 border-b border-border">
        {(Object.keys(TABS) as TabKey[]).map((key) => (
          <Link
            key={key}
            href={`/queue?tab=${key}`}
            className={clsx('-mb-px border-b-2 px-3 py-2.5 text-sm font-medium', tab === key ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text')}
          >
            {TABS[key].label}
          </Link>
        ))}
      </div>

      {posts.length === 0 ? (
        <EmptyState
          title={tab === 'upcoming' ? 'Nothing scheduled' : tab === 'attention' ? 'All clear' : 'Nothing published yet'}
          body={tab === 'upcoming' ? 'Scheduled posts appear here until they go live.' : tab === 'attention' ? 'Posts that failed or need a decision appear here.' : 'Published posts and their links appear here.'}
        />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const canCancel = ws.canEdit && post.status === 'scheduled';
            return (
              <Card key={post.id} className="p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold">{post.title || 'Untitled post'}</p>
                      <StatusBadge status={post.status} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{post.post_variants[0]?.caption || 'No caption'}</p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-sm font-semibold">{post.scheduled_at ? formatLocal(post.scheduled_at, ws.brand.timezone) : '—'}</p>
                    {canCancel && <CancelPostButton postId={post.id} brandId={ws.brand.id} />}
                  </div>
                </div>

                <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                  {post.publish_jobs.map((job) => (
                    <li key={job.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                      <PlatformIcon platform={job.platform} size={22} />
                      <span className="min-w-0 flex-1 truncate">{job.social_accounts?.display_name}</span>
                      {job.status === 'retrying' && job.next_attempt_at && (
                        <span className="tabular text-xs text-muted">next try {formatLocal(job.next_attempt_at, ws.brand.timezone)}</span>
                      )}
                      <StatusBadge status={job.status} />
                      {job.published_url && (
                        <a href={job.published_url} target="_blank" rel="noreferrer" className="text-brand" title="View post">
                          <ExternalLink size={15} />
                        </a>
                      )}
                      {ws.canEdit && ATTENTION_JOB_STATUSES.includes(job.status) && (
                        <RetryJobButton jobId={job.id} brandId={ws.brand.id} needsCheck={job.status === 'needs_check'} />
                      )}
                      {job.last_error_message && (
                        <p className={clsx('w-full pl-9 text-xs', job.status === 'published' ? 'text-warning' : 'text-danger')}>
                          {job.status === 'published' ? 'Note: ' : ''}
                          {job.last_error_message}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

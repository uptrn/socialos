import type { Platform } from '@socialos/core';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DateTime } from 'luxon';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PlatformIcon } from '@/components/platform';
import { buttonClass, Card, PageHeader, StatusBadge } from '@/components/ui';
import { createUserClient } from '@/lib/supabase/server';
import { getWorkspace } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Calendar' };

interface CalendarPost {
  id: string;
  title: string | null;
  status: string;
  scheduled_at: string | null;
  review_note?: string | null;
  post_variants: { platform: Platform; caption: string }[];
}

const STATUS_DOT: Record<string, string> = {
  pending_approval: 'bg-violet',
  scheduled: 'bg-brand',
  publishing: 'bg-cyan',
  published: 'bg-success',
  partially_published: 'bg-warning',
  failed: 'bg-danger',
};

export default async function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  const { m } = await searchParams;
  const ws = await getWorkspace();
  const tz = ws.brand.timezone;
  const today = DateTime.now().setZone(tz);
  const requested = typeof m === 'string' ? DateTime.fromFormat(m, 'yyyy-MM', { zone: tz }) : null;
  const month = (requested?.isValid ? requested : today).startOf('month');

  // Grid runs Monday..Sunday covering the whole month.
  const gridStart = month.startOf('week');
  const gridEnd = month.endOf('month').endOf('week');

  const supabase = await createUserClient();
  const [{ data: scheduled }, { data: drafts }] = await Promise.all([
    supabase
      .from('posts')
      .select('id, title, status, scheduled_at, post_variants(platform, caption)')
      .eq('brand_id', ws.brand.id)
      .neq('status', 'draft')
      .neq('status', 'cancelled')
      .gte('scheduled_at', gridStart.toUTC().toISO()!)
      .lte('scheduled_at', gridEnd.toUTC().toISO()!)
      .order('scheduled_at'),
    supabase
      .from('posts')
      .select('id, title, status, scheduled_at, review_note, post_variants(platform, caption)')
      .eq('brand_id', ws.brand.id)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(20),
  ]);

  const byDay = new Map<string, CalendarPost[]>();
  for (const post of (scheduled ?? []) as CalendarPost[]) {
    const key = DateTime.fromISO(post.scheduled_at!).setZone(tz).toISODate()!;
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }

  const days: DateTime[] = [];
  for (let d = gridStart; d <= gridEnd; d = d.plus({ days: 1 })) days.push(d);

  return (
    <>
      <PageHeader
        title="Calendar"
        description={`${ws.brand.name} · ${tz}`}
        actions={ws.canEdit && <Link href="/compose" className={buttonClass()}>New post</Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-semibold">{month.toFormat('LLLL yyyy')}</h2>
            <div className="flex items-center gap-1">
              <Link href={`/calendar?m=${month.minus({ months: 1 }).toFormat('yyyy-MM')}`} className={buttonClass('ghost', 'sm')} aria-label="Previous month">
                <ChevronLeft size={16} />
              </Link>
              <Link href="/calendar" className={buttonClass('secondary', 'sm')}>
                Today
              </Link>
              <Link href={`/calendar?m=${month.plus({ months: 1 }).toFormat('yyyy-MM')}`} className={buttonClass('ghost', 'sm')} aria-label="Next month">
                <ChevronRight size={16} />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = day.toISODate()!;
              const posts = byDay.get(key) ?? [];
              const inMonth = day.month === month.month;
              const isToday = day.hasSame(today, 'day');
              return (
                <div key={key} className={clsx('min-h-28 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0', !inMonth && 'bg-surface-2/50')}>
                  <div className={clsx('tabular mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs', isToday ? 'bg-brand font-bold text-white' : inMonth ? 'text-text' : 'text-muted/60')}>
                    {day.day}
                  </div>
                  <div className="space-y-1">
                    {posts.slice(0, 3).map((p) => (
                      <Link
                        key={p.id}
                        href={p.status === 'pending_approval' ? '/approvals' : `/queue?tab=${p.status === 'published' ? 'published' : 'upcoming'}`}
                        className="flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-1 text-[11px] hover:bg-brand/10"
                        title={p.title ?? p.post_variants[0]?.caption}
                      >
                        <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[p.status] ?? 'bg-muted')} />
                        <span className="tabular shrink-0 text-muted">{DateTime.fromISO(p.scheduled_at!).setZone(tz).toFormat('HH:mm')}</span>
                        <span className="truncate font-medium">{p.title || p.post_variants[0]?.caption || 'Post'}</span>
                      </Link>
                    ))}
                    {posts.length > 3 && <p className="px-1.5 text-[11px] text-muted">+{posts.length - 3} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-5 xl:self-start">
          <h2 className="font-semibold">Drafts</h2>
          {drafts?.length ? (
            <ul className="mt-3 space-y-2">
              {(drafts as CalendarPost[]).map((d) => (
                <li key={d.id}>
                  <Link href={`/compose?post=${d.id}`} className="block rounded-lg border border-border p-3 hover:border-brand/50">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{d.title || 'Untitled draft'}</p>
                      {d.review_note ? (
                        <span className="shrink-0 rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">Changes requested</span>
                      ) : (
                        <StatusBadge status="draft" />
                      )}
                    </div>
                    <div className="mt-2 flex gap-1">
                      {d.post_variants.map((v, i) => (
                        <PlatformIcon key={i} platform={v.platform} size={18} />
                      ))}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No drafts.</p>
          )}
        </Card>
      </div>
    </>
  );
}

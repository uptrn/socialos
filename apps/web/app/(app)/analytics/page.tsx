import { byDay, byPlatform, change, totals, type Totals } from '@socialos/core';
import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PLATFORM_META, PlatformIcon } from '@/components/platform';
import { Card, EmptyState, PageHeader, buttonClass } from '@/components/ui';
import { dayKey, dayRange, loadBrandMetrics, loadLinkStats, RANGES, type RangeKey } from '@/lib/analytics/data';
import { getWorkspace } from '@/lib/workspace';
import { DailyChart } from './daily-chart';
import { InsightsPanel } from './insights-panel';

export const metadata: Metadata = { title: 'Analytics' };

const DAY = 86_400_000;
const num = (v: number | null) => (v === null ? '–' : v.toLocaleString('en-US'));
const compact = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k` : v.toLocaleString('en-US'));
const pct = (v: number | null, digits = 1) => (v === null ? '–' : `${(v * 100).toFixed(digits)}%`);

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted">no earlier data</span>;
  const up = value >= 0;
  // Direction is carried by the sign and word, not only by color.
  return (
    <span className={clsx('text-xs font-semibold', up ? 'text-success' : 'text-danger')}>
      {up ? '▲' : '▼'} {Math.abs(value * 100).toFixed(0)}% <span className="font-normal text-muted">vs previous period</span>
    </span>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta: number | null }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="tabular mt-1 text-3xl font-bold tracking-tight">{value}</p>
      <div className="mt-1">
        <Delta value={delta} />
      </div>
    </Card>
  );
}

export default async function AnalyticsPage({ searchParams }: PageProps<'/analytics'>) {
  const { range: rangeParam } = await searchParams;
  const range: RangeKey = typeof rangeParam === 'string' && rangeParam in RANGES ? (rangeParam as RangeKey) : '30';
  const days = Number(range);
  const ws = await getWorkspace();
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);

  const previousFrom = new Date(from.getTime() - days * DAY);
  const links = await loadLinkStats(ws.brand.id, previousFrom);
  const [rows, previousRows] = await Promise.all([
    loadBrandMetrics(ws.brand.id, from, now, links),
    loadBrandMetrics(ws.brand.id, previousFrom, from, links),
  ]);
  const sum = (list: typeof rows, key: 'linkClicks' | 'conversions') => list.reduce((s, r) => s + r[key], 0);
  const currentJobs = new Set(rows.map((r) => r.jobId));
  const topLinks = links.filter((l) => l.jobId && currentJobs.has(l.jobId) && l.clicks > 0).sort((a, b) => b.clicks - a.clicks).slice(0, 8);
  const tracking = links.length > 0;
  const measured = rows.filter((r) => r.collectedAt);
  const waiting = rows.length - measured.length;
  const t: Totals = totals(measured);
  const p: Totals = totals(previousRows.filter((r) => r.collectedAt));
  const daily = byDay(measured, dayKey(ws.brand.timezone), dayRange(days, ws.brand.timezone, now));
  const platforms = byPlatform(measured);
  const top = [...measured].sort((a, b) => b.engagements - a.engagements).slice(0, 10);
  const notes = rows.filter((r) => r.note);

  const rangeTabs = (
    <div className="flex rounded-lg bg-surface-2 p-0.5 text-sm font-semibold">
      {(Object.keys(RANGES) as RangeKey[]).map((k) => (
        <Link key={k} href={`/analytics?range=${k}`} className={clsx('rounded-md px-3 py-1.5', k === range ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text')}>
          {k} days
        </Link>
      ))}
    </div>
  );

  if (rows.length === 0 && previousRows.length === 0) {
    return (
      <>
        <PageHeader title="Analytics" description={`${ws.brand.name} · ${RANGES[range]}`} actions={rangeTabs} />
        <EmptyState
          title="No published posts yet"
          body="Numbers appear about an hour after a post goes live, then update after 1 day, 3 days, 7 days and 30 days."
          action={
            <Link href="/compose" className={buttonClass()}>
              Create a post
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Analytics" description={`${ws.brand.name} · ${RANGES[range]} · posts published in this period`} actions={rangeTabs} />

      <div className={clsx('grid gap-4 sm:grid-cols-2', tracking ? 'lg:grid-cols-3' : 'xl:grid-cols-4')}>
        <Stat label="Posts published" value={compact(rows.length)} delta={change(rows.length, previousRows.length)} />
        <Stat label="Views" value={compact(t.views)} delta={change(t.views, p.views)} />
        <Stat label="Engagements" value={compact(t.engagements)} delta={change(t.engagements, p.engagements)} />
        <Stat label="Engagement rate" value={pct(t.engagementRate)} delta={change(t.engagementRate, p.engagementRate)} />
        {tracking && (
          <>
            <Stat label="Link clicks" value={compact(sum(rows, 'linkClicks'))} delta={change(sum(rows, 'linkClicks'), sum(previousRows, 'linkClicks'))} />
            <Stat label="Conversions" value={compact(sum(rows, 'conversions'))} delta={change(sum(rows, 'conversions'), sum(previousRows, 'conversions'))} />
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Engagements = likes + comments + shares + saves. Engagement rate = engagements ÷ views, for posts that report views.
        {tracking && ' Link clicks count people (not preview bots) opening tracked links; conversions come from your website snippet or server.'}
        {waiting > 0 && ` ${waiting} new post${waiting === 1 ? ' is' : 's are'} waiting for first numbers.`}
      </p>

      <Card className="mt-5 p-5">
        <DailyChart data={daily} />
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-5">
          <h2 className="font-semibold">By platform</h2>
          <table className="mt-3 w-full text-sm tabular">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="pb-2 font-medium">Platform</th>
                <th className="pb-2 text-right font-medium">Posts</th>
                <th className="pb-2 text-right font-medium">Views</th>
                <th className="pb-2 text-right font-medium">Engagements</th>
                <th className="pb-2 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map(({ platform, totals: pt }) => (
                <tr key={platform} className="border-t border-border">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <PlatformIcon platform={platform} size={20} />
                      {PLATFORM_META[platform].label}
                    </span>
                  </td>
                  <td className="py-2 text-right">{num(pt.posts)}</td>
                  <td className="py-2 text-right">{num(pt.views)}</td>
                  <td className="py-2 text-right">{num(pt.engagements)}</td>
                  <td className="py-2 text-right">{pct(pt.engagementRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">Platforms count views differently, so compare rates within a platform.</p>
        </Card>

        <Card className="p-5">
          <InsightsPanel brandId={ws.brand.id} range={range} canRun={ws.canEdit} />
        </Card>
      </div>

      <Card className="mt-5 overflow-hidden">
        <h2 className="px-5 pt-5 font-semibold">Top posts</h2>
        <div className="overflow-x-auto">
          <table className="mt-3 w-full min-w-[720px] text-sm tabular">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-5 pb-2 font-medium">Post</th>
                <th className="pb-2 text-right font-medium">Views</th>
                <th className="pb-2 text-right font-medium">Likes</th>
                <th className="pb-2 text-right font-medium">Comments</th>
                <th className="pb-2 text-right font-medium">Shares</th>
                <th className="pb-2 text-right font-medium">Saves</th>
                <th className="pb-2 text-right font-medium">Clicks</th>
                {tracking && <th className="pb-2 text-right font-medium">Link clicks</th>}
                {tracking && <th className="pb-2 text-right font-medium">Conv.</th>}
                <th className="px-5 pb-2 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.jobId} className="border-t border-border">
                  <td className="max-w-md px-5 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <PlatformIcon platform={r.platform} size={20} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.caption.split('\n')[0] || '(no caption)'}</p>
                        <p className="text-xs text-muted">
                          {r.accountName} · {r.postType} ·{' '}
                          {r.publishedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: ws.brand.timezone })}
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-brand hover:underline">
                              Open <ExternalLink size={11} />
                            </a>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-right">{num(r.views)}</td>
                  <td className="py-2.5 text-right">{num(r.likes)}</td>
                  <td className="py-2.5 text-right">{num(r.comments)}</td>
                  <td className="py-2.5 text-right">{num(r.shares)}</td>
                  <td className="py-2.5 text-right">{num(r.saves)}</td>
                  <td className="py-2.5 text-right">{num(r.clicks)}</td>
                  {tracking && <td className="py-2.5 text-right">{num(r.linkClicks)}</td>}
                  {tracking && <td className="py-2.5 text-right">{num(r.conversions)}</td>}
                  <td className="px-5 py-2.5 text-right">{pct(r.views ? r.engagements / r.views : null)}</td>
                </tr>
              ))}
              {top.length === 0 && (
                <tr>
                  <td colSpan={tracking ? 10 : 8} className="px-5 py-6 text-center text-muted">
                    No numbers yet for this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-muted">
          – means the platform doesn&apos;t report that number. &quot;Clicks&quot; are reported by the platform; &quot;Link clicks&quot; are counted by SocialOS tracked links.
        </p>
      </Card>

      {topLinks.length > 0 && (
        <Card className="mt-5 p-5">
          <h2 className="font-semibold">Top links</h2>
          <table className="mt-3 w-full text-sm tabular">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="pb-2 font-medium">Destination</th>
                <th className="pb-2 text-right font-medium">Clicks</th>
                <th className="pb-2 text-right font-medium">Conversions</th>
                <th className="pb-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {topLinks.map((l) => (
                <tr key={l.code} className="border-t border-border">
                  <td className="max-w-md py-2">
                    <span className="flex items-center gap-2">
                      <PlatformIcon platform={l.platform} size={18} />
                      <span className="truncate" title={l.destination}>
                        {l.destination.replace(/^https?:\/\//, '')}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 text-right">{num(l.clicks)}</td>
                  <td className="py-2 text-right">{num(l.conversions)}</td>
                  <td className="py-2 text-right">{l.conversionValue ? l.conversionValue.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {notes.length > 0 && (
        <Card className="mt-5 p-5">
          <h2 className="font-semibold">Collection notes</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {notes.slice(0, 10).map((r) => (
              <li key={r.jobId} className="flex items-start gap-2">
                <PlatformIcon platform={r.platform} size={18} className="mt-0.5" />
                <span>
                  <span className="text-muted">{r.caption.split('\n')[0]?.slice(0, 60) || '(no caption)'}: </span>
                  {r.note}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

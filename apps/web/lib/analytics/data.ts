import 'server-only';
import type { MetricRow, Platform, PostType } from '@socialos/core';
import { createUserClient } from '../supabase/server';

export const RANGES = { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' } as const;
export type RangeKey = keyof typeof RANGES;

export interface AnalyticsRow extends MetricRow {
  jobId: string;
  postType: PostType;
  engagements: number;
  collectedAt: Date | null;
  note: string | null;
  url: string | null;
  caption: string;
  accountName: string;
  /** Clicks on SocialOS tracked links in this post (humans only). */
  linkClicks: number;
  conversions: number;
}

export interface LinkStat {
  code: string;
  destination: string;
  platform: Platform;
  jobId: string | null;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

/** Tracked links created since `from` (links are created when posts publish) with their conversions. */
export async function loadLinkStats(brandId: string, from: Date): Promise<LinkStat[]> {
  const supabase = await createUserClient();
  const since = new Date(from.getTime() - 86_400_000).toISOString();
  const [{ data: links }, { data: conversions }] = await Promise.all([
    supabase.from('tracked_links').select('id, code, destination, platform, job_id, clicks').eq('brand_id', brandId).gte('created_at', since).limit(5000),
    supabase.from('conversions').select('link_id, value').eq('brand_id', brandId).not('link_id', 'is', null).gte('occurred_at', since).limit(20000),
  ]);
  const conv = new Map<string, { n: number; value: number }>();
  for (const c of conversions ?? []) {
    const cur = conv.get(c.link_id!) ?? { n: 0, value: 0 };
    conv.set(c.link_id!, { n: cur.n + 1, value: cur.value + Number(c.value ?? 0) });
  }
  return (links ?? []).map((l) => ({
    code: l.code,
    destination: l.destination,
    platform: l.platform as Platform,
    jobId: l.job_id,
    clicks: l.clicks,
    conversions: conv.get(l.id)?.n ?? 0,
    conversionValue: conv.get(l.id)?.value ?? 0,
  }));
}

const SELECT =
  'job_id, platform, post_type, published_at, views, reach, likes, comments, shares, saves, clicks, engagements, collected_at, note, publish_jobs(published_url, post_variants(caption)), social_accounts(display_name)';

interface DbRow {
  job_id: string;
  platform: Platform;
  post_type: PostType;
  published_at: string;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  engagements: number;
  collected_at: string | null;
  note: string | null;
  publish_jobs: { published_url: string | null; post_variants: { caption: string } | null } | null;
  social_accounts: { display_name: string } | null;
}

// bigint columns can arrive as strings.
const n = (v: number | string | null) => (v === null ? null : Number(v));

/** Published posts of a brand in [from, to), newest first. Reads through RLS as the signed-in user. */
export async function loadBrandMetrics(brandId: string, from: Date, to: Date, links: LinkStat[] = []): Promise<AnalyticsRow[]> {
  const byJob = new Map<string, { clicks: number; conversions: number }>();
  for (const l of links) {
    if (!l.jobId) continue;
    const cur = byJob.get(l.jobId) ?? { clicks: 0, conversions: 0 };
    byJob.set(l.jobId, { clicks: cur.clicks + l.clicks, conversions: cur.conversions + l.conversions });
  }
  const supabase = await createUserClient();
  const { data, error } = await supabase
    .from('post_metrics')
    .select(SELECT)
    .eq('brand_id', brandId)
    .gte('published_at', from.toISOString())
    .lt('published_at', to.toISOString())
    .order('published_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as DbRow[]).map((r) => ({
    jobId: r.job_id,
    platform: r.platform,
    postType: r.post_type,
    publishedAt: new Date(r.published_at),
    views: n(r.views),
    reach: n(r.reach),
    likes: n(r.likes),
    comments: n(r.comments),
    shares: n(r.shares),
    saves: n(r.saves),
    clicks: n(r.clicks),
    engagements: Number(r.engagements),
    collectedAt: r.collected_at ? new Date(r.collected_at) : null,
    note: r.note,
    url: r.publish_jobs?.published_url ?? null,
    caption: r.publish_jobs?.post_variants?.caption ?? '',
    accountName: r.social_accounts?.display_name ?? '',
    linkClicks: byJob.get(r.job_id)?.clicks ?? 0,
    conversions: byJob.get(r.job_id)?.conversions ?? 0,
  }));
}

/** YYYY-MM-DD in a timezone. */
export function dayKey(timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (d: Date) => fmt.format(d);
}

/** The last `days` calendar days (brand timezone), oldest first, ending today. */
export function dayRange(days: number, timeZone: string, now = new Date()): string[] {
  const key = dayKey(timeZone);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(key(new Date(now.getTime() - i * 86_400_000)));
  return [...new Set(out)];
}

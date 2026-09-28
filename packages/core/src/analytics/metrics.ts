import type { Platform, PostType } from '../platforms/types';

/**
 * Normalized post metrics. Platforms name and count these differently; null means the
 * platform doesn't report it (not zero).
 *   views   impressions / plays / views
 *   reach   unique accounts reached
 *   shares  shares + reposts + quotes
 *   saves   saves / bookmarks
 *   clicks  link clicks
 */
export interface PostMetrics {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
}

export const EMPTY_METRICS: PostMetrics = { views: null, reach: null, likes: null, comments: null, shares: null, saves: null, clicks: null };

/** Likes + comments + shares + saves (clicks aren't reported everywhere, so they're kept out). */
export function engagements(m: Pick<PostMetrics, 'likes' | 'comments' | 'shares' | 'saves'>): number {
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
}

/** Engagements per view, or null when views are unknown or zero. */
export function engagementRate(m: PostMetrics): number | null {
  return m.views ? engagements(m) / m.views : null;
}

// ---------------------------------------------------------------------------
// Collection schedule: metrics are fetched a few times after publishing, when
// they change most, then frozen.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
/** Hours after publishing. */
export const METRIC_CHECKPOINTS_H = [1, 24, 72, 168, 720];
/** Instagram story insights disappear after 24 hours. */
const STORY_CHECKPOINTS_H = [1, 6, 20];

export function metricCheckpoints(platform: Platform, postType: PostType): number[] {
  return postType === 'story' && platform === 'instagram' ? STORY_CHECKPOINTS_H : METRIC_CHECKPOINTS_H;
}

/** When to collect next, or null when collection is finished. */
export function nextCollectionAt(publishedAt: Date, now: Date, platform: Platform, postType: PostType): Date | null {
  for (const h of metricCheckpoints(platform, postType)) {
    const at = new Date(publishedAt.getTime() + h * HOUR);
    // A checkpoint a few minutes from now counts as done (we just collected).
    if (at.getTime() > now.getTime() + 10 * 60_000) return at;
  }
  return null;
}

/** After a failed collection: try again in 6 hours, unless collection would be over by then. */
export function retryCollectionAt(publishedAt: Date, now: Date, platform: Platform, postType: PostType): Date | null {
  const retry = new Date(now.getTime() + 6 * HOUR);
  const last = metricCheckpoints(platform, postType).at(-1)!;
  return retry.getTime() <= publishedAt.getTime() + (last + 24) * HOUR ? retry : null;
}

// ---------------------------------------------------------------------------
// Dashboard maths
// ---------------------------------------------------------------------------

export interface MetricRow extends PostMetrics {
  platform: Platform;
  publishedAt: Date;
}

export interface Totals {
  posts: number;
  views: number;
  engagements: number;
  /** Engagements / views over posts that report views. */
  engagementRate: number | null;
}

export function totals(rows: MetricRow[]): Totals {
  let views = 0;
  let viewedEngagements = 0;
  let all = 0;
  for (const r of rows) {
    const e = engagements(r);
    all += e;
    if (r.views) {
      views += r.views;
      viewedEngagements += e;
    }
  }
  return { posts: rows.length, views, engagements: all, engagementRate: views ? viewedEngagements / views : null };
}

export function byPlatform(rows: MetricRow[]): { platform: Platform; totals: Totals }[] {
  const groups = new Map<Platform, MetricRow[]>();
  for (const r of rows) groups.set(r.platform, [...(groups.get(r.platform) ?? []), r]);
  return [...groups.entries()]
    .map(([platform, list]) => ({ platform, totals: totals(list) }))
    .sort((a, b) => b.totals.engagements - a.totals.engagements);
}

/** Per-day totals by publish date (in the given day key function, e.g. brand timezone). */
export function byDay(rows: MetricRow[], dayKey: (d: Date) => string, days: string[]): { day: string; posts: number; views: number; engagements: number }[] {
  const map = new Map(days.map((d) => [d, { day: d, posts: 0, views: 0, engagements: 0 }]));
  for (const r of rows) {
    const bucket = map.get(dayKey(r.publishedAt));
    if (!bucket) continue;
    bucket.posts += 1;
    bucket.views += r.views ?? 0;
    bucket.engagements += engagements(r);
  }
  return [...map.values()];
}

/** Relative change, or null when there's nothing to compare against. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

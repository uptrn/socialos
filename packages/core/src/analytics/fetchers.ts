// Reads post metrics from each platform. Sources (checked 2026-09-27):
//  Instagram  GET /{ig-media-id}/insights  (instagram_manage_insights). "impressions" is deprecated;
//             `views` covers feed, reels and stories. Story insights exist for 24 hours only.
//  Facebook   post fields (reactions/comments/shares; pages_read_engagement) plus best-effort
//             insights `post_media_view` / `post_total_media_view_unique` (read_insights). Meta
//             replaced impression metrics with view metrics in Nov 2025 and June 2026. Video/reel
//             view counts are best effort (unverified).
//  Threads    GET /{media-id}/insights?metric=views,likes,replies,reposts,quotes,shares (threads_manage_insights)
//  X          GET /2/tweets?ids=..&tweet.fields=public_metrics[,non_public_metrics] (non-public: own posts, 30 days)
//  LinkedIn   GET /rest/organizationalEntityShareStatistics with shares=List(..)/ugcPosts=List(..)
//             (rw_organization_admin; lifetime stats; posts missing from the answer have 0 activity)
//  YouTube    GET /youtube/v3/videos?part=statistics (youtube.readonly)
//  TikTok     POST /v2/video/query/ (video.list). UNVERIFIED: built without access to TikTok's docs.
import { PublishError } from '../adapters/errors';
import { requestJson, type FetchLike } from '../adapters/http';
import type { AccountCredentials } from '../adapters/types';
import type { Platform, PostType } from '../platforms/types';
import { EMPTY_METRICS, type PostMetrics } from './metrics';

export interface MetricsTarget {
  jobId: string;
  externalPostId: string;
  postType: PostType;
  publishedAt: Date;
}

export type MetricsOutcome =
  | { metrics: PostMetrics; note?: string }
  /** The post can't be measured (deleted, or the platform has no metrics for it). Stop collecting. */
  | { gone: true; note: string };

export interface MetricsFetcher {
  platform: Platform;
  /** Metrics for posts of one account. Throws for failures that affect the whole account (e.g. expired token). */
  fetch(account: AccountCredentials, targets: MetricsTarget[]): Promise<Map<string, MetricsOutcome>>;
}

export type MetricsRegistry = Partial<Record<Platform, MetricsFetcher>>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
const sum = (...values: (number | null)[]): number | null => (values.every((v) => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0));

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** A platform "not found" for one post means it was deleted. */
function isNotFound(e: unknown): boolean {
  return e instanceof PublishError && (e.platformCode === '404' || /does not exist|not found|cannot be loaded/i.test(e.message));
}

/** Runs one post at a time, so a problem with one post doesn't hide the others. */
async function perPost(targets: MetricsTarget[], one: (t: MetricsTarget) => Promise<MetricsOutcome>): Promise<Map<string, MetricsOutcome>> {
  const out = new Map<string, MetricsOutcome>();
  for (const t of targets) {
    try {
      out.set(t.jobId, await one(t));
    } catch (e) {
      // Other errors (expired token, rate limit, outage) apply to the whole account.
      if (!isNotFound(e)) throw e;
      out.set(t.jobId, { gone: true, note: 'The post no longer exists on the platform.' });
    }
  }
  return out;
}

/** Insight values come as values[0].value or total_value.value depending on the metric. */
function insightValues(data: { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } }[]): Record<string, number | null> {
  return Object.fromEntries(data.map((d) => [d.name, num(d.total_value?.value ?? d.values?.[0]?.value)]));
}

// ---------------------------------------------------------------------------

export class InstagramMetrics implements MetricsFetcher {
  readonly platform = 'instagram' as const;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: { graphVersion: string; fetch?: FetchLike }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  fetch(account: AccountCredentials, targets: MetricsTarget[]) {
    return perPost(targets, async (t) => {
      const story = t.postType === 'story';
      const metric = story ? 'views,reach,shares,total_interactions' : 'views,reach,likes,comments,shares,saved';
      const qs = new URLSearchParams({ metric, access_token: account.accessToken });
      const res = await requestJson<{ data: { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } }[] }>(
        this.fetchImpl,
        `https://graph.facebook.com/${this.opts.graphVersion}/${t.externalPostId}/insights?${qs}`,
        { stage: 'prepare', what: 'Instagram insights' },
      );
      const v = insightValues(res.data);
      return {
        metrics: story
          ? // Stories have no likes/comments; their other interactions (replies, reactions) are counted under likes
            // so story engagement isn't lost from totals.
            { ...EMPTY_METRICS, views: v.views ?? null, reach: v.reach ?? null, shares: v.shares ?? null, likes: typeof v.total_interactions === 'number' ? Math.max(0, v.total_interactions - (v.shares ?? 0)) : null }
          : { ...EMPTY_METRICS, views: v.views ?? null, reach: v.reach ?? null, likes: v.likes ?? null, comments: v.comments ?? null, shares: v.shares ?? null, saves: v.saved ?? null },
      };
    });
  }
}

export class FacebookMetrics implements MetricsFetcher {
  readonly platform = 'facebook' as const;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: { graphVersion: string; fetch?: FetchLike }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private get<T>(path: string, params: Record<string, string>, token: string, what: string) {
    const qs = new URLSearchParams({ ...params, access_token: token });
    return requestJson<T>(this.fetchImpl, `https://graph.facebook.com/${this.opts.graphVersion}/${path}?${qs}`, { stage: 'prepare', what });
  }

  fetch(account: AccountCredentials, targets: MetricsTarget[]) {
    return perPost(targets, async (t): Promise<MetricsOutcome> => {
      if (t.postType === 'story') return { gone: true, note: 'Facebook does not report story metrics through its API.' };
      const token = account.accessToken;
      const video = t.postType === 'video' || t.postType === 'reel';
      const summary = (name: string) => `${name}.summary(total_count).limit(0)`;

      const fields = await this.get<{ shares?: { count?: number }; reactions?: { summary?: { total_count?: number } }; likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } }>(
        t.externalPostId,
        { fields: video ? [summary('likes'), summary('comments')].join(',') : ['shares', summary('reactions'), summary('comments')].join(',') },
        token,
        'Facebook post counts',
      );
      const metrics: PostMetrics = {
        ...EMPTY_METRICS,
        likes: num(fields.reactions?.summary?.total_count ?? fields.likes?.summary?.total_count),
        comments: num(fields.comments?.summary?.total_count),
        shares: video ? null : (num(fields.shares?.count) ?? 0),
      };

      // Views need read_insights and change names often; missing views don't fail the post.
      let note: string | undefined;
      try {
        if (video) {
          const metric = t.postType === 'reel' ? 'blue_reels_play_count' : 'total_video_views';
          const res = await this.get<{ data: { name: string; values?: { value: unknown }[] }[] }>(`${t.externalPostId}/video_insights`, { metric }, token, 'Facebook video insights');
          metrics.views = insightValues(res.data)[metric] ?? null;
        } else {
          const res = await this.get<{ data: { name: string; values?: { value: unknown }[] }[] }>(
            `${t.externalPostId}/insights`,
            { metric: 'post_media_view,post_total_media_view_unique' },
            token,
            'Facebook post insights',
          );
          const v = insightValues(res.data);
          metrics.views = v.post_media_view ?? null;
          metrics.reach = v.post_total_media_view_unique ?? null;
        }
      } catch (e) {
        if (e instanceof PublishError && (e.errorClass === 'auth_expired' || e.errorClass === 'rate_limited')) throw e;
        note = 'Views unavailable. Reconnect the account to allow insights.';
      }
      return { metrics, note };
    });
  }
}

export class ThreadsMetrics implements MetricsFetcher {
  readonly platform = 'threads' as const;
  private readonly fetchImpl: FetchLike;
  constructor(opts: { fetch?: FetchLike } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  fetch(account: AccountCredentials, targets: MetricsTarget[]) {
    return perPost(targets, async (t) => {
      const qs = new URLSearchParams({ metric: 'views,likes,replies,reposts,quotes,shares', access_token: account.accessToken });
      const res = await requestJson<{ data: { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } }[] }>(
        this.fetchImpl,
        `https://graph.threads.net/v1.0/${t.externalPostId}/insights?${qs}`,
        { stage: 'prepare', what: 'Threads insights' },
      );
      const v = insightValues(res.data);
      return { metrics: { ...EMPTY_METRICS, views: v.views ?? null, likes: v.likes ?? null, comments: v.replies ?? null, shares: sum(v.reposts ?? null, v.quotes ?? null, v.shares ?? null) } };
    });
  }
}

interface XTweet {
  id: string;
  public_metrics?: { retweet_count?: number; reply_count?: number; like_count?: number; quote_count?: number; bookmark_count?: number; impression_count?: number };
  non_public_metrics?: { url_link_clicks?: number };
}

export class XMetrics implements MetricsFetcher {
  readonly platform = 'x' as const;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  constructor(opts: { fetch?: FetchLike; now?: () => Date } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  async fetch(account: AccountCredentials, targets: MetricsTarget[]) {
    const out = new Map<string, MetricsOutcome>();
    const recent = this.now().getTime() - 29 * 86_400_000;
    for (const batch of chunks(targets, 100)) {
      // Link clicks (non-public) exist only for the owner's posts from the last 30 days.
      const withClicks = batch.every((t) => t.publishedAt.getTime() > recent);
      const qs = new URLSearchParams({ ids: batch.map((t) => t.externalPostId).join(','), 'tweet.fields': withClicks ? 'public_metrics,non_public_metrics' : 'public_metrics' });
      const res = await requestJson<{ data?: XTweet[] }>(this.fetchImpl, `https://api.x.com/2/tweets?${qs}`, {
        stage: 'prepare',
        what: 'X post metrics',
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      const byId = new Map((res.data ?? []).map((tw) => [tw.id, tw]));
      for (const t of batch) {
        const tw = byId.get(t.externalPostId);
        if (!tw) {
          out.set(t.jobId, { gone: true, note: 'The post no longer exists on X.' });
          continue;
        }
        const p = tw.public_metrics ?? {};
        out.set(t.jobId, {
          metrics: {
            views: num(p.impression_count),
            reach: null,
            likes: num(p.like_count),
            comments: num(p.reply_count),
            shares: sum(num(p.retweet_count), num(p.quote_count)),
            saves: num(p.bookmark_count),
            clicks: num(tw.non_public_metrics?.url_link_clicks),
          },
        });
      }
    }
    return out;
  }
}

export class LinkedInMetrics implements MetricsFetcher {
  readonly platform = 'linkedin' as const;
  private readonly fetchImpl: FetchLike;
  constructor(private readonly opts: { apiVersion: string; fetch?: FetchLike }) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async fetch(account: AccountCredentials, targets: MetricsTarget[]) {
    const out = new Map<string, MetricsOutcome>();
    const org = account.externalAccountId;
    if (!org.startsWith('urn:li:organization:')) {
      for (const t of targets) out.set(t.jobId, { gone: true, note: 'LinkedIn provides post statistics for company pages only.' });
      return out;
    }
    for (const batch of chunks(targets, 20)) {
      const list = (prefix: string) => batch.filter((t) => t.externalPostId.startsWith(prefix)).map((t) => encodeURIComponent(t.externalPostId));
      const shares = list('urn:li:share:');
      const ugc = list('urn:li:ugcPost:');
      let url = `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}`;
      if (shares.length) url += `&shares=List(${shares.join(',')})`;
      if (ugc.length) url += `&ugcPosts=List(${ugc.join(',')})`;

      const res = await requestJson<{ elements?: { share?: string; ugcPost?: string; totalShareStatistics?: Record<string, number> }[] }>(this.fetchImpl, url, {
        stage: 'prepare',
        what: 'LinkedIn post statistics',
        headers: { Authorization: `Bearer ${account.accessToken}`, 'Linkedin-Version': this.opts.apiVersion, 'X-Restli-Protocol-Version': '2.0.0' },
      });
      const byUrn = new Map((res.elements ?? []).map((e) => [e.share ?? e.ugcPost ?? '', e.totalShareStatistics ?? {}]));
      for (const t of batch) {
        if (!t.externalPostId.startsWith('urn:li:share:') && !t.externalPostId.startsWith('urn:li:ugcPost:')) {
          out.set(t.jobId, { gone: true, note: 'Unknown LinkedIn post id.' });
          continue;
        }
        // Posts without any activity are left out of the answer: all zeros.
        const s = byUrn.get(t.externalPostId) ?? {};
        out.set(t.jobId, {
          metrics: {
            views: num(s.impressionCount) ?? 0,
            reach: num(s.uniqueImpressionsCount),
            likes: Math.max(0, num(s.likeCount) ?? 0),
            comments: num(s.commentCount) ?? 0,
            shares: num(s.shareCount) ?? 0,
            saves: null,
            clicks: num(s.clickCount) ?? 0,
          },
        });
      }
    }
    return out;
  }
}

export class YouTubeMetrics implements MetricsFetcher {
  readonly platform = 'youtube' as const;
  private readonly fetchImpl: FetchLike;
  constructor(opts: { fetch?: FetchLike } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async fetch(account: AccountCredentials, targets: MetricsTarget[]) {
    const out = new Map<string, MetricsOutcome>();
    for (const batch of chunks(targets, 50)) {
      const qs = new URLSearchParams({ part: 'statistics', id: batch.map((t) => t.externalPostId).join(',') });
      const res = await requestJson<{ items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
        this.fetchImpl,
        `https://www.googleapis.com/youtube/v3/videos?${qs}`,
        { stage: 'prepare', what: 'YouTube statistics', headers: { Authorization: `Bearer ${account.accessToken}` } },
      );
      const byId = new Map((res.items ?? []).map((i) => [i.id, i.statistics ?? {}]));
      for (const t of batch) {
        const s = byId.get(t.externalPostId);
        out.set(
          t.jobId,
          s
            ? { metrics: { ...EMPTY_METRICS, views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) } }
            : { gone: true, note: 'The video no longer exists on YouTube.' },
        );
      }
    }
    return out;
  }
}

export class TikTokMetrics implements MetricsFetcher {
  readonly platform = 'tiktok' as const;
  private readonly fetchImpl: FetchLike;
  constructor(opts: { fetch?: FetchLike } = {}) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async fetch(account: AccountCredentials, targets: MetricsTarget[]) {
    const out = new Map<string, MetricsOutcome>();
    // Until TikTok returns the public post id (e.g. private posts from unaudited apps) only the publish id is known.
    const known = targets.filter((t) => /^\d+$/.test(t.externalPostId));
    for (const t of targets) if (!known.includes(t)) out.set(t.jobId, { gone: true, note: 'TikTok did not return a public post id, so metrics are unavailable.' });

    for (const batch of chunks(known, 20)) {
      const res = await requestJson<{ data?: { videos?: { id: string; view_count?: number; like_count?: number; comment_count?: number; share_count?: number }[] } }>(
        this.fetchImpl,
        'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count',
        {
          stage: 'prepare',
          what: 'TikTok video metrics',
          method: 'POST',
          headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters: { video_ids: batch.map((t) => t.externalPostId) } }),
        },
      );
      const byId = new Map((res.data?.videos ?? []).map((v) => [String(v.id), v]));
      for (const t of batch) {
        const v = byId.get(t.externalPostId);
        out.set(
          t.jobId,
          v
            ? { metrics: { ...EMPTY_METRICS, views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) } }
            : { gone: true, note: 'The video no longer exists on TikTok.' },
        );
      }
    }
    return out;
  }
}

/** Simulated metrics for mock accounts: deterministic per post, growing with age. */
export class MockMetrics implements MetricsFetcher {
  constructor(readonly platform: Platform, private readonly now: () => Date = () => new Date()) {}

  async fetch(_account: AccountCredentials, targets: MetricsTarget[]) {
    const out = new Map<string, MetricsOutcome>();
    for (const t of targets) {
      let h = 0;
      for (const c of t.externalPostId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      const base = 200 + (h % 5000);
      const ageH = Math.max(0, (this.now().getTime() - t.publishedAt.getTime()) / 3_600_000);
      const growth = 1 - Math.exp(-ageH / 30);
      const views = Math.round(base * growth);
      const rate = 0.01 + ((h >>> 8) % 80) / 1000; // 1%–9%
      const engaged = views * rate;
      out.set(t.jobId, {
        metrics: {
          views,
          reach: Math.round(views * 0.8),
          likes: Math.round(engaged * 0.7),
          comments: Math.round(engaged * 0.12),
          shares: Math.round(engaged * 0.1),
          saves: Math.round(engaged * 0.08),
          clicks: Math.round(views * 0.004),
        },
      });
    }
    return out;
  }
}

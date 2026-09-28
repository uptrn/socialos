import 'server-only';
import {
  FacebookMetrics,
  InstagramMetrics,
  LinkedInMetrics,
  MockMetrics,
  nextCollectionAt,
  PublishError,
  retryCollectionAt,
  ThreadsMetrics,
  TikTokMetrics,
  XMetrics,
  YouTubeMetrics,
  type MetricsFetcher,
  type MetricsTarget,
  type Platform,
  type PostType,
} from '@socialos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountCredentials } from '../accounts';
import { getAccess } from '../billing/access';
import { LINKEDIN_API_VERSION, META_GRAPH_VERSION } from '../oauth/providers';

const REAL: Record<Platform, () => MetricsFetcher> = {
  instagram: () => new InstagramMetrics({ graphVersion: META_GRAPH_VERSION }),
  facebook: () => new FacebookMetrics({ graphVersion: META_GRAPH_VERSION }),
  threads: () => new ThreadsMetrics(),
  x: () => new XMetrics(),
  linkedin: () => new LinkedInMetrics({ apiVersion: LINKEDIN_API_VERSION }),
  youtube: () => new YouTubeMetrics(),
  tiktok: () => new TikTokMetrics(),
};

interface DueRow {
  job_id: string;
  org_id: string;
  social_account_id: string;
  platform: Platform;
  post_type: PostType;
  published_at: string;
  external_post_id: string;
}

export interface CollectSummary {
  claimed: number;
  updated: number;
  failedAccounts: number;
}

const DAY = 86_400_000;

/** Collects metrics for posts that are due, grouped by account (one token refresh and batch per account). */
export async function collectDueMetrics(db: SupabaseClient, now = new Date(), limit = 200): Promise<CollectSummary> {
  const { data, error } = await db.rpc('claim_due_metrics', { p_now: now.toISOString(), p_limit: limit });
  if (error) throw new Error(`claim metrics: ${error.message}`);
  const rows = (data ?? []) as DueRow[];
  const summary: CollectSummary = { claimed: rows.length, updated: 0, failedAccounts: 0 };

  const byAccount = new Map<string, DueRow[]>();
  for (const r of rows) byAccount.set(r.social_account_id, [...(byAccount.get(r.social_account_id) ?? []), r]);

  for (const [accountId, list] of byAccount) {
    const first = list[0]!;
    const targets: MetricsTarget[] = list.map((r) => ({ jobId: r.job_id, externalPostId: r.external_post_id, postType: r.post_type, publishedAt: new Date(r.published_at) }));
    const retryOrStop = (r: DueRow) => retryCollectionAt(new Date(r.published_at), now, r.platform, r.post_type)?.toISOString() ?? null;

    // Inactive workspaces aren't measured (saves API quota); check again tomorrow.
    if ((await getAccess(first.org_id)).state === 'locked') {
      await Promise.all(list.map((r) => db.from('post_metrics').update({ next_collect_at: new Date(now.getTime() + DAY).toISOString() }).eq('job_id', r.job_id)));
      continue;
    }

    try {
      const { credentials, mock } = await accountCredentials(db, accountId);
      const fetcher = mock ? new MockMetrics(first.platform, () => now) : REAL[first.platform]();
      const results = await fetcher.fetch(credentials, targets);

      for (const r of list) {
        const outcome = results.get(r.job_id);
        if (!outcome) {
          await db.from('post_metrics').update({ next_collect_at: retryOrStop(r), note: 'No data returned.' }).eq('job_id', r.job_id);
        } else if ('gone' in outcome) {
          await db.from('post_metrics').update({ next_collect_at: null, note: outcome.note }).eq('job_id', r.job_id);
        } else {
          const next = nextCollectionAt(new Date(r.published_at), now, r.platform, r.post_type);
          await db.rpc('record_post_metrics', {
            p_job: r.job_id,
            p_metrics: outcome.metrics,
            p_collected_at: now.toISOString(),
            p_next: next?.toISOString() ?? null,
            p_note: outcome.note ?? null,
          });
          summary.updated += 1;
        }
      }
    } catch (e) {
      summary.failedAccounts += 1;
      const message =
        e instanceof PublishError && e.errorClass === 'auth_expired'
          ? 'Reconnect this account to keep collecting metrics.'
          : e instanceof PublishError && e.errorClass === 'rate_limited'
            ? 'The platform rate-limited us; trying again later.'
            : `Could not collect metrics: ${(e as Error).message}`.slice(0, 500);
      console.error(`[analytics] account ${accountId}:`, (e as Error).message);
      await Promise.all(list.map((r) => db.from('post_metrics').update({ next_collect_at: retryOrStop(r), note: message }).eq('job_id', r.job_id)));
    }
  }
  return summary;
}
